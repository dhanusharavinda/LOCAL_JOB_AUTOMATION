/**
 * Shared content-script engine.
 *
 * Per-ATS scripts hand it a tiny adapter:
 *   - atsName              ('linkedin', 'greenhouse', etc.) - for telemetry
 *   - currentJobUrl()      - the canonical URL the dashboard would store
 *   - externalJobId?()     - optional: posting id the server can match on
 *   - findFormRoot()       - return the form (or null until it appears)
 *   - openFormIfNeeded()   - click the page's native Apply button if the form is collapsed
 *   - submitButtonSelectors - CSS selectors used to detect the user's Submit click
 *   - extraFieldHandlers?(form, profile) - ATS-specific overrides
 *
 * The engine drives lifecycle: wait for form → fetch context →
 * mount overlay → on Fill click, fill all fields → surface free-text
 * questions for AI drafting → on Submit click, POST /api/apply/track.
 */

import { mountOverlay, type OverlayApi } from "./overlay";
import { collectFormControls, findLabel, classifyField, findResumeFileInputs, isFieldRequired } from "./selectors";
import { fillControl, attachFileToInput, selectOption, setCheckbox, setNativeValue, type FillableEl } from "./filler";
import { mountFieldButtons, type FieldButtonsApi } from "./field-buttons";
import type { ApplyProfile, JobContext } from "../../api";

export interface AtsAdapter {
  atsName: string;
  currentJobUrl(): string;
  externalJobId?(): string | null;
  findFormRoot(): HTMLElement | null;
  openFormIfNeeded?(): Promise<void> | void;
  submitButtonSelectors: string[];
  extraFieldHandlers?(form: HTMLElement, profile: ApplyProfile): { filledKeys: Set<string> };
}

interface EngineState {
  ctx: JobContext | null;
  overlay: OverlayApi | null;
  trackedSubmit: boolean;
  currentAdapter: AtsAdapter | null;
  fillQueued: boolean;
  fieldButtons: FieldButtonsApi | null;
}

const STATE: EngineState = {
  ctx: null,
  overlay: null,
  trackedSubmit: false,
  currentAdapter: null,
  fillQueued: false,
  fieldButtons: null,
};

// Cross-script message listener - registered exactly once per page.
// The popup sends `{ type: "go-candid8/fill-now" }` after injecting a
// content script via chrome.scripting.executeScript, which converts the
// "two-click" UX (mount panel → click Fill) into a single click. If
// bootstrap hasn't finished context-fetching when the message arrives,
// we queue the fill and bootstrap runs it as soon as ctx is ready.
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage && !(window as any).__GO_CANDID8_FILL_LISTENER__) {
  (window as any).__GO_CANDID8_FILL_LISTENER__ = true;
  chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    if (msg?.type === "go-candid8/fill-now") {
      if (STATE.overlay && STATE.ctx?.profile && STATE.currentAdapter) {
        // Ready - fill immediately.
        fillNow(STATE.currentAdapter).catch(() => { /* engine surfaces errors via overlay */ });
      } else {
        // Bootstrap still in flight - queue and let bootstrap pick it up.
        STATE.fillQueued = true;
      }
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
}

declare const __DASHBOARD_URL__: string | undefined;
const DASHBOARD_URL =
  (typeof __DASHBOARD_URL__ !== "undefined" && __DASHBOARD_URL__) ||
  "http://localhost:5173";

export async function bootstrap(adapter: AtsAdapter): Promise<void> {
  // Re-mount support: if a previous bootstrap on this page already
  // mounted an overlay, destroy it before mounting fresh. This handles
  // SPA navigation where the URL changed but the page never reloaded
  // (LinkedIn, Workday, modern Greenhouse) AND lets the popup's
  // "Open auto-fill panel" button rescue a stuck panel.
  const prior = STATE.overlay;
  if (prior && typeof prior.destroy === "function") {
    try { prior.destroy(); } catch { /* noop */ }
  }
  if (STATE.fieldButtons) {
    try { STATE.fieldButtons.destroy(); } catch { /* noop */ }
    STATE.fieldButtons = null;
  }
  STATE.overlay = null;
  STATE.ctx = null;
  STATE.trackedSubmit = false;
  STATE.currentAdapter = adapter;
  (window as any).__GO_CANDID8_BOOTSTRAPPED__ = adapter.atsName;

  // Mount the overlay early so the user sees a sign-in CTA even before
  // we've verified the job is in their tracker.
  const overlay = mountOverlay({
    onFill: () => fillNow(adapter),
    onAiAnswer: async (qid) => {
      const q = pendingQuestions.get(qid);
      if (!q) return null;
      const resp = await callBackground<{ answer: string; cached: boolean }>("/api/apply/answer", {
        method: "POST",
        body: { jobId: STATE.ctx?.job?.id || undefined, question: q.label, maxWords: 150 },
      });
      return resp.answer;
    },
    onApplyAiAnswer: (qid, answer) => {
      const q = pendingQuestions.get(qid);
      if (!q) return;
      setNativeValue(q.el, answer);
    },
    onPickOption: (qid, optionLabel) => {
      const q = pendingOptions.get(qid);
      if (!q) return;
      applyOptionPick(q, optionLabel);
    },
    onAiPickOption: async (qid) => {
      const q = pendingOptions.get(qid);
      if (!q) return null;
      const resp = await callBackground<{ answer: string; cached: boolean }>("/api/apply/answer", {
        method: "POST",
        body: {
          jobId: STATE.ctx?.job?.id || undefined,
          question: q.label,
          options: q.options.map((o) => o.label),
          maxWords: 30,
        },
      });
      return (resp.answer || "").trim();
    },
    onOpenDashboard: () => window.open(DASHBOARD_URL, "_blank"),
  });
  STATE.overlay = overlay;
  overlay.setHeadline("Looking up this job…");

  // Fetch job context + profile from the server.
  // First try the tracked-job lookup; on 404 fall back to /page-context
  // which returns just the user's profile (no resume URL, no jobId).
  // The fallback path is what makes the extension work on custom careers
  // pages that aren't in the dashboard yet.
  try {
    const url = adapter.currentJobUrl();
    const externalId = adapter.externalJobId?.() || undefined;
    let ctx: JobContext;
    try {
      ctx = await callBackground<JobContext>("/api/apply/job-context-by-url", {
        method: "GET",
        query: externalId ? { url, external_id: externalId } : { url },
      });
    } catch (err: any) {
      if (err?.status !== 404) throw err;
      // Untracked page - get profile only.
      ctx = await callBackground<JobContext>("/api/apply/page-context", { method: "GET" });
    }
    STATE.ctx = ctx;
    if (ctx.job?.id) {
      overlay.setHeadline(`${ctx.job.job_title} • ${ctx.job.company_name}`);
    } else {
      const pageTitle = String(document.title || "").slice(0, 80);
      overlay.setHeadline(pageTitle ? `Untracked: ${pageTitle}` : "Untracked page");
    }
    if (typeof ctx.cached_answers_count === "number") {
      overlay.setBankCount(ctx.cached_answers_count);
    }
    if (!ctx.profile?.full_name || !ctx.profile?.email) {
      overlay.showError("Set up your profile in Options before filling forms.");
    } else if (ctx.job?.id) {
      overlay.showInfo("Click Fill form to populate the application.");
    } else {
      overlay.showInfo("Untracked page. Profile fields will fill; tailored resume + tracking are skipped.");
    }
  } catch (err: any) {
    if (err?.status === 401 || err?.code === "not_signed_in" || err?.code === "unauthorized") {
      overlay.setHeadline("Sign in required");
      overlay.showError("Open the extension popup and sign in to use auto-apply.");
    } else {
      overlay.setHeadline("Lookup failed");
      overlay.showError(err?.message || "Could not load this job.");
    }
  }

  // Wire up Submit-click detection. The user's click on the page's
  // native Submit triggers /api/apply/track. We attach a delegated
  // listener at document level because submit buttons inside SPAs
  // re-render and direct addEventListener becomes stale.
  installSubmitWatcher(adapter);

  // If the popup queued a fill while bootstrap was running (or while we
  // were waiting on the API), run it now. Profile must be set up for
  // fill to do anything useful.
  if (STATE.fillQueued && STATE.ctx?.profile?.full_name && STATE.ctx?.profile?.email) {
    STATE.fillQueued = false;
    fillNow(adapter).catch(() => { /* surface via overlay */ });
  }
}

// Free-text questions awaiting AI draft.
const pendingQuestions = new Map<string, { label: string; el: HTMLTextAreaElement | HTMLInputElement }>();

// Bounded-option questions (select / radio group). The overlay shows
// them as click-to-pick chips; the AI-suggest button asks the model
// which option fits best given the candidate's profile + the job.
interface PendingOption {
  label: string;
  options: Array<{ label: string; el?: HTMLInputElement; value?: string }>;
  selectEl?: HTMLSelectElement;
  kind: "select" | "radio" | "checkbox";
}
const pendingOptions = new Map<string, PendingOption>();

function applyOptionPick(q: PendingOption, optionLabel: string): void {
  if (q.kind === "select" && q.selectEl) {
    selectOption(q.selectEl, optionLabel);
    return;
  }
  if (q.kind === "radio") {
    const hit = q.options.find((o) => o.label.toLowerCase() === optionLabel.toLowerCase()) ||
                q.options.find((o) => o.label.toLowerCase().includes(optionLabel.toLowerCase()));
    if (hit?.el) hit.el.click();
    return;
  }
  if (q.kind === "checkbox") {
    const yes = /^(yes|true|on|1)$/i.test(optionLabel);
    const target = q.options.find((o) => o.el)?.el;
    if (target) setCheckbox(target, yes);
  }
}

async function fillNow(adapter: AtsAdapter): Promise<void> {
  if (!STATE.overlay) return;
  if (!STATE.ctx) {
    STATE.overlay.showError("No job context loaded.");
    return;
  }
  const profile = STATE.ctx.profile;
  if (!profile?.full_name || !profile?.email) {
    STATE.overlay.showError("Profile is missing name or email. Open Options.");
    return;
  }

  STATE.overlay.setStatus("filling");

  // If the form is hidden behind a "Apply" CTA, open it first.
  if (adapter.openFormIfNeeded) await adapter.openFormIfNeeded();

  // Wait up to 3s for the form to appear in the DOM.
  let form = adapter.findFormRoot();
  for (let i = 0; i < 15 && !form; i++) {
    await sleep(200);
    form = adapter.findFormRoot();
  }
  if (!form) {
    // Last-resort: scan the whole document. Worse field-targeting
    // (we may pick up unrelated inputs in nav/footer) but better than
    // a hard-fail when an ATS lays out fields without a form element.
    STATE.overlay.showInfo("Form element not found; scanning the whole page.");
    form = document.body;
  }

  // Resume PDF upload - happens BEFORE the field walk so that any
  // ATS that auto-extracts name/email from the resume gets a chance
  // to populate those fields, which we'll then overwrite with the
  // user's profile values.
  //
  // On untracked pages (no jobId), STATE.ctx.job.resume_url is whatever
  // the server's /page-context returned as the most-recent fallback;
  // it may be null, in which case we just skip the file-input step.
  let resumeAttached = 0;
  if (STATE.ctx?.job?.resume_url) {
    resumeAttached = await uploadResumeToFileInputs(
      form,
      STATE.ctx.job.resume_url,
      makeResumeFilename(profile, STATE.ctx.job)
    );
  }

  // ATS-specific overrides first (LinkedIn often has aria-labels we want
  // to map directly). Their filledKeys set tells us not to double-fill.
  const filledKeys = adapter.extraFieldHandlers?.(form, profile).filledKeys ?? new Set<string>();

  let filled = resumeAttached;
  let unfilled = 0;
  let needReview = 0;
  pendingQuestions.clear();
  pendingOptions.clear();

  const controls = collectFormControls(form);
  // Pre-group radio buttons by name so we treat each group as one question.
  const seenRadioGroups = new Set<string>();

  // Cache lookup map (normalize the same way the server does in apply.ts).
  const cache = profile.custom_answers || {};
  const normKey = (s: string) =>
    s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

  for (const el of controls) {
    // Wrap each field's classification + fill in try/catch so one
    // throwing field (paste-blocked, readonly, hidden behind a
    // controlled component that rejects programmatic value setting,
    // ...) doesn't kill the rest of the loop. We default to "unfilled"
    // on any throw and move on to the next field.
    try {
    if (alreadyTouched(el)) { filled++; continue; }
    const label = findLabel(el);

    // Skip read-only / paste-blocked fields explicitly. They're
    // typically "retype email" or "confirm password" UI traps that
    // we shouldn't try to programmatically populate.
    const itype = (el as HTMLInputElement).type || "";
    const readOnly =
      (el as HTMLInputElement).readOnly ||
      (el as HTMLInputElement).hasAttribute("readonly") ||
      itype === "password";
    if (readOnly) { unfilled++; continue; }

    // 1. Profile classifier - known field types (name/email/phone/etc).
    //    Also reads name/id/autocomplete/data-testid attrs so React
    //    forms with `name="firstName"` but a noisy parent label still
    //    match the right profile field.
    const cls = classifyField(label, el);
    if (cls && !filledKeys.has(cls.key)) {
      const ok = fillControl(el, cls.key, profile);
      if (ok) { filled++; filledKeys.add(cls.key); continue; }
    }

    // 2. Cache lookup - did the user answer this exact question before?
    //    Only applies to text-shaped inputs; option pickers can't take
    //    free text so a cached string can't be applied directly.
    const isTextish =
      el.tagName === "TEXTAREA" ||
      (el.tagName === "INPUT" &&
        ["text", "email", "url", "tel", "search", ""].includes((el as HTMLInputElement).type));

    // 2a. Detect combobox / autocomplete inputs. These LOOK like text
    //     inputs to the DOM but are paired with a popup option list
    //     (React-Select, Material-UI Select, Workday's "Add" pickers,
    //     etc.). Without this check, the engine falls through to the
    //     AI-drafting branch below and writes a full sentence into a
    //     slot meant for an option pick — the candidate sees "I have
    //     5 years of experience with..." in a "Country" dropdown.
    //
    //     Detection signals (any one is enough):
    //       - role="combobox" / "listbox" / "searchbox"
    //       - aria-autocomplete ∈ {list, both, inline}
    //       - aria-haspopup attribute present
    //       - aria-controls / aria-owns pointing at a listbox-shaped id
    //       - immediate sibling/parent has role="listbox" or
    //         role="option" children
    //
    //     Per the user's explicit instruction: "if auto fill can
    //     select option make it do or else dont fill out texts" — so
    //     when we can't safely extract the option list, we SKIP the
    //     field rather than draft a sentence. The user can fill it
    //     manually post-fill.
    const looksLikeCombobox = (() => {
      const role = (el.getAttribute("role") || "").toLowerCase();
      if (role === "combobox" || role === "listbox" || role === "searchbox") return true;
      const autoc = (el.getAttribute("aria-autocomplete") || "").toLowerCase();
      if (autoc === "list" || autoc === "both" || autoc === "inline") return true;
      if (el.hasAttribute("aria-haspopup")) return true;
      // aria-controls / aria-owns pointing at a listbox element.
      for (const attr of ["aria-controls", "aria-owns"]) {
        const refId = el.getAttribute(attr);
        if (refId) {
          const target = document.getElementById(refId);
          if (target?.getAttribute("role") === "listbox") return true;
        }
      }
      // Container hint: parent/grandparent contains a listbox role
      // OR multiple [role="option"] children — common in custom
      // dropdowns where the input doesn't expose ARIA but the popup
      // does.
      let p: HTMLElement | null = el.parentElement;
      for (let i = 0; i < 3 && p; i++) {
        if (p.querySelector('[role="listbox"]')) return true;
        if (p.querySelectorAll('[role="option"]').length >= 2) return true;
        p = p.parentElement;
      }
      // Label hint as a last resort. "Select your country" / "Choose
      // a degree" labels on short inputs strongly imply option-pick.
      // We keep this conservative (only fire when label contains an
      // unambiguous select verb AND the input has no maxlength suggesting
      // free text).
      const lbl = (label || "").toLowerCase();
      const hasSelectVerb = /\b(select|choose|pick)\b/.test(lbl);
      const looksShort = !el.getAttribute("maxlength") || parseInt(el.getAttribute("maxlength") || "0", 10) <= 60;
      if (hasSelectVerb && looksShort) return true;
      return false;
    })();

    if (isTextish && looksLikeCombobox) {
      // Combobox-shaped input. Don't drift the AI-drafting branch into
      // writing a sentence here. We could attempt to extract options
      // from aria-controls listboxes, but each ATS implements them
      // differently — better to skip cleanly and let the user pick.
      unfilled++;
      continue;
    }

    if (isTextish && label) {
      const cached = cache[normKey(label)];
      if (typeof cached === "string" && cached.trim().length > 0) {
        setNativeValue(el, cached);
        filled++;
        continue;
      }
    }

    // 3. SELECT - surface as option-pick.
    if (el.tagName === "SELECT") {
      const select = el as HTMLSelectElement;
      const opts = Array.from(select.options)
        .filter((o) => o.value !== "" && (o.textContent || "").trim().length > 0)
        .map((o) => ({ label: (o.textContent || o.value || "").trim(), value: o.value }));
      if (opts.length > 0) {
        const id = `s${pendingOptions.size}`;
        pendingOptions.set(id, { label: label || `Select #${pendingOptions.size + 1}`, options: opts, selectEl: select, kind: "select" });
        needReview++;
        continue;
      }
    }

    // 4. RADIO - surface the whole group as one question.
    if ((el as HTMLInputElement).type === "radio") {
      const name = (el as HTMLInputElement).name;
      if (!name || seenRadioGroups.has(name)) continue;
      seenRadioGroups.add(name);
      const group = controls.filter((c) => (c as HTMLInputElement).type === "radio" && (c as HTMLInputElement).name === name) as HTMLInputElement[];
      const groupLabel = label || findLabel(group[0]) || `Question (${name})`;
      const opts = group.map((r) => ({
        label: (findLabel(r) || r.value || "Option").trim(),
        el: r,
        value: r.value,
      }));
      const id = `r${pendingOptions.size}`;
      pendingOptions.set(id, { label: groupLabel, options: opts, kind: "radio" });
      needReview++;
      continue;
    }

    // 5. CHECKBOX (single, not part of a group) - surface as Yes/No.
    if ((el as HTMLInputElement).type === "checkbox") {
      const id = `c${pendingOptions.size}`;
      pendingOptions.set(id, {
        label: label || "Checkbox",
        kind: "checkbox",
        options: [{ label: "Yes", el: el as HTMLInputElement }, { label: "No", el: el as HTMLInputElement }],
      });
      needReview++;
      continue;
    }

    // 6. TEXT-ish input or TEXTAREA that wasn't matched/cached - surface
    //    for AI drafting. Drop the old "looks like an essay" gate; novel
    //    short questions ("desired start date as a sentence") are still
    //    better answered by AI than left blank.
    if (isTextish) {
      const id = `q${pendingQuestions.size}`;
      pendingQuestions.set(id, { label: label || `Question #${pendingQuestions.size + 1}`, el: el as HTMLTextAreaElement | HTMLInputElement });
      needReview++;
      continue;
    }

    unfilled++;
    } catch {
      // Field threw mid-fill (paste-blocked, frozen by a host React
      // wrapper, hidden behind an iframe boundary, ...). Skip and keep
      // going so one bad field doesn't kill autofill for the whole form.
      unfilled++;
    }
  }

  STATE.overlay.setReport({ filled, unfilled, review: needReview });
  STATE.overlay.setAiQuestions(
    Array.from(pendingQuestions.entries()).map(([id, q]) => ({
      id, label: q.label, current: (q.el as HTMLTextAreaElement | HTMLInputElement).value || "",
    }))
  );
  STATE.overlay.setOptionQuestions(
    Array.from(pendingOptions.entries()).map(([id, q]) => {
      let current = "";
      if (q.kind === "select" && q.selectEl) {
        const sel = q.selectEl.options[q.selectEl.selectedIndex];
        current = sel?.textContent?.trim() || "";
      } else if (q.kind === "radio") {
        const checked = q.options.find((o) => o.el?.checked);
        current = checked?.label || "";
      }
      return { id, label: q.label, options: q.options.map((o) => o.label), current };
    })
  );

  // ── Inline per-field "✨ AI" buttons ──────────────────────────────────
  // Mount a small floating button next to every pending text field so
  // the user can re-draft an answer in-place without opening the
  // overlay's AI section. Mirrors Simplify Jobs' UX. The button calls
  // the same /api/apply/answer endpoint and writes back via setNativeValue.
  if (STATE.fieldButtons) {
    try { STATE.fieldButtons.destroy(); } catch { /* noop */ }
    STATE.fieldButtons = null;
  }
  const buttonItems = Array.from(pendingQuestions.entries()).map(([id, q]) => ({
    id,
    el: q.el,
    label: q.label,
    onDraft: async (qid: string) => {
      const item = pendingQuestions.get(qid);
      if (!item) return null;
      const resp = await callBackground<{ answer: string; cached: boolean }>("/api/apply/answer", {
        method: "POST",
        body: { jobId: STATE.ctx?.job?.id || undefined, question: item.label, maxWords: 150 },
      });
      return resp.answer || null;
    },
    onApply: (qid: string, value: string) => {
      const item = pendingQuestions.get(qid);
      if (!item) return;
      setNativeValue(item.el, value);
    },
  }));
  STATE.fieldButtons = mountFieldButtons(buttonItems);

  // ── Strict-fill: required text fields are NEVER left blank ───────────
  // For every required pending text field, kick off an AI draft in
  // parallel (concurrency = 3 to keep cost predictable on big forms).
  // Optional fields stay blank - user clicks the inline ✨ button if
  // they want them drafted too.
  STATE.overlay.setStatus("filled");
  const requiredPending = Array.from(pendingQuestions.entries())
    .filter(([_id, q]) => isFieldRequired(q.el));

  if (requiredPending.length > 0) {
    STATE.overlay.showInfo(
      `Auto-drafting ${requiredPending.length} required text field${requiredPending.length === 1 ? "" : "s"} with AI…`
    );
    await runWithConcurrency(requiredPending, 3, async ([_id, q]) => {
      try {
        // Hard timeout per field so a single stuck OpenAI call (slow
        // model, network blip) cannot block the rest of the batch.
        // The field stays empty and the user can retry via the inline
        // ✨ AI button.
        const resp = await Promise.race<{ answer: string; cached: boolean } | null>([
          callBackground<{ answer: string; cached: boolean }>("/api/apply/answer", {
            method: "POST",
            body: { jobId: STATE.ctx?.job?.id || undefined, question: q.label, maxWords: 150 },
          }),
          new Promise((resolve) => setTimeout(() => resolve(null), 25_000)),
        ]);
        if (resp?.answer) {
          try { setNativeValue(q.el, resp.answer); } catch { /* paste-blocked field */ }
        }
      } catch { /* skip; user can retry via inline ✨ */ }
    });
    // Refresh the overlay's AI cards so the new values show up.
    STATE.overlay.setAiQuestions(
      Array.from(pendingQuestions.entries()).map(([id, q]) => ({
        id, label: q.label, current: (q.el as HTMLTextAreaElement | HTMLInputElement).value || "",
      }))
    );
  }

  const parts: string[] = [`Filled ${filled}`];
  if (resumeAttached > 0) {
    const source = STATE.ctx?.job?.resume_source || "tailored";
    const sourceLabel =
      source === "tailored" ? "tailored resume"
      : source === "main"   ? "main uploaded resume (no tailored version exists for this job)"
                            : "resume";
    parts.push(`uploaded ${sourceLabel} to ${resumeAttached} field${resumeAttached === 1 ? "" : "s"}`);
  } else if (STATE.ctx?.job?.resume_url) {
    parts.push("(form has no resume upload field; tailored resume was not attached)");
  }
  if (requiredPending.length > 0) parts.push(`AI-drafted ${requiredPending.length} required text question(s)`);
  if (needReview > 0)     parts.push(`${needReview} question(s) below - review or regenerate via the ✨ AI button next to each field`);
  parts.push("Review and click the site's Submit button.");
  STATE.overlay.showInfo(parts.join(" • "));
}

/**
 * Run an async map over `items` with at most `n` concurrent in-flight
 * promises. Used by strict-fill so a 10-question form doesn't open 10
 * simultaneous OpenAI requests. Order of execution is preserved enough
 * for our purposes - we don't return values.
 */
async function runWithConcurrency<T>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += n) {
    await Promise.all(items.slice(i, i + n).map(fn));
  }
}

/**
 * Fetch the user's tailored resume PDF (via background, see
 * "resume/fetch" handler) and drop it into every <input type="file">
 * inside `root` whose label suggests a resume upload. Returns the
 * count of inputs that received the file.
 *
 * The fetched blob is cached for the lifetime of this content-script
 * load - multiple file inputs on the same page (rare but possible)
 * reuse it.
 */
let _cachedResumeFile: File | null = null;
async function uploadResumeToFileInputs(root: HTMLElement, signedUrl: string, filename: string): Promise<number> {
  const inputs = findResumeFileInputs(root);
  if (inputs.length === 0) return 0;

  if (!_cachedResumeFile || _cachedResumeFile.name !== filename) {
    try {
      const resp = await new Promise<{ ok: boolean; data?: { base64: string; contentType: string }; error?: string }>(
        (resolve) => chrome.runtime.sendMessage({ type: "resume/fetch", url: signedUrl }, resolve)
      );
      if (!resp?.ok || !resp.data?.base64) {
        STATE.overlay?.showError(`Could not download your tailored resume: ${resp?.error || "unknown error"}`);
        return 0;
      }
      const bytes = Uint8Array.from(atob(resp.data.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: resp.data.contentType || "application/pdf" });
      _cachedResumeFile = new File([blob], filename, { type: blob.type });
    } catch (err: any) {
      STATE.overlay?.showError(`Resume download failed: ${err?.message || err}`);
      return 0;
    }
  }

  let n = 0;
  for (const input of inputs) {
    if (attachFileToInput(input, _cachedResumeFile)) n++;
  }
  return n;
}

/**
 * Build the recruiter-facing filename: <Fullname>_<JobTitle>_<Company>.pdf.
 * Slug each segment to ASCII so file managers and ATS uploads behave.
 * Total length capped at ~120 chars so we don't trip Windows' MAX_PATH on
 * downloads in case the recruiter saves the file locally.
 */
function makeResumeFilename(profile: ApplyProfile, job: { job_title?: string | null; company_name?: string | null }): string {
  const slug = (s: string | null | undefined) =>
    String(s || "").trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  const name    = slug(profile.full_name)     || "Application";
  const title   = slug(job.job_title)         || "Role";
  const company = slug(job.company_name)      || "Company";
  let base = `${name}_${title}_${company}`;
  if (base.length > 120) base = base.slice(0, 120).replace(/_$/, "");
  return `${base}.pdf`;
}

function alreadyTouched(el: FillableEl): boolean {
  if (el.tagName === "SELECT") return !!(el as HTMLSelectElement).value;
  if (el.tagName === "TEXTAREA") return !!(el as HTMLTextAreaElement).value;
  const input = el as HTMLInputElement;
  if (input.type === "checkbox" || input.type === "radio") return false;
  return !!input.value;
}

function installSubmitWatcher(adapter: AtsAdapter) {
  const handler = async (e: MouseEvent) => {
    if (STATE.trackedSubmit) return;
    const t = e.target as HTMLElement | null;
    if (!t) return;
    let match: HTMLElement | null = null;
    for (const sel of adapter.submitButtonSelectors) {
      try {
        const closest = t.closest(sel);
        if (closest) { match = closest as HTMLElement; break; }
      } catch { /* invalid selector - skip */ }
    }
    if (!match) return;
    if (!STATE.ctx) return;

    STATE.trackedSubmit = true;

    // Profile-bank learning. Always runs (even on untracked pages) so
    // that answers given on a custom careers site still feed the bank
    // for future supported-ATS applications.
    try {
      const snapshot = collectAnsweredQuestions();
      if (snapshot.length > 0) {
        callBackground("/api/apply/learn", {
          method: "POST",
          body: { entries: snapshot },
        }).catch(() => { /* learning is best-effort */ });
      }
    } catch { /* never let learning errors block tracking */ }

    // Tracked-job path: PATCH the existing kanban row to applied.
    // Untracked-page path: surface a CONFIRMATION CARD with pre-
    // filled fields so the user explicitly chooses to add this to
    // their kanban (or skips). This replaces the prior fire-and-
    // forget auto-create: heuristic extraction is sometimes wrong
    // (LinkedIn job titles drift, company-on-careers-page is
    // ambiguous, etc.), and silently adding a wrong-looking row
    // was more annoying than helpful.
    const jobId = STATE.ctx.job?.id;
    if (!jobId) {
      if (!STATE.overlay?.showKanbanPrompt) {
        // Older overlay build without the prompt method. Fall back
        // to the silent message so we don't crash.
        STATE.overlay?.showInfo("Answers saved to your profile bank. (Open the dashboard to add this to your kanban.)");
        return;
      }
      const guess = guessUntrackedJobMetadata();
      let confirmed: { title: string; company: string; location: string; job_type: string; url: string } | null = null;
      try {
        confirmed = await STATE.overlay.showKanbanPrompt({
          title: guess.title,
          company: guess.company,
          location: guess.location,
          url: guess.url,
        });
      } catch {
        // Prompt errored out (shouldn't happen) — fall back to
        // skipping the kanban add. Answers are already saved.
        STATE.overlay?.showInfo("Answers saved to your profile bank.");
        return;
      }
      if (!confirmed) {
        STATE.overlay?.showInfo("Answers saved to your profile bank. Application not added to kanban.");
        return;
      }
      try {
        const result = await callBackground("/api/apply/track-untracked", {
          method: "POST",
          body: {
            job_title: confirmed.title,
            company_name: confirmed.company,
            job_link: confirmed.url,
            location: confirmed.location,
            job_type: confirmed.job_type,
            method: `extension_${adapter.atsName}_untracked`,
            apply_url: confirmed.url,
          },
        });
        const existed = (result as any)?.existed === true;
        STATE.overlay?.showInfo(
          existed
            ? "Found this in your kanban already, moved to Applied. Good luck."
            : "Added to your kanban as Applied. Good luck."
        );
      } catch (err: any) {
        STATE.overlay?.showInfo("Answers saved to your profile bank. (Couldn't add to kanban: " + (err?.message || "network error") + ")");
      }
      return;
    }
    try {
      await callBackground("/api/apply/track", {
        method: "POST",
        body: {
          jobId,
          method: `extension_${adapter.atsName}`,
          success: true,
        },
      });
      STATE.overlay?.showInfo("Submission tracked + answers saved to your profile bank. Good luck.");
    } catch {
      // The user clicked Submit even if our track call failed - don't
      // get in the way. Reset the flag so a retry is possible.
      STATE.trackedSubmit = false;
    }
  };
  document.addEventListener("click", handler, true);
}

/**
 * Best-effort job metadata extraction for the untracked one-click flow.
 * Heuristics, in order of preference:
 *
 *   title:    og:title meta, then h1.textContent, then document.title
 *             (stripped of " - Company" / " | Company" suffixes when
 *             we can detect them).
 *   company:  og:site_name, then trailing part of document.title after
 *             " at " / " | " / " - ", then the hostname's branded part.
 *   location: page text near the title that matches "City, Country"
 *             shapes, otherwise empty (user can fill on the card).
 *   url:      window.location.href (cleaned of fragment + UTM-ish
 *             query params so the duplicate-check matches across
 *             visits to the same posting).
 */
function guessUntrackedJobMetadata(): { title: string; company: string; location: string; url: string } {
  const docTitle = (document.title || "").trim();
  // ── title ──
  const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content?.trim() || "";
  const h1 = document.querySelector("h1")?.textContent?.trim() || "";
  let title = (ogTitle || h1 || docTitle).slice(0, 200);
  // Strip a trailing " - Company" / " | Company" if it looks like one.
  // We won't be perfect; the user can edit the card.
  title = title.replace(/\s+[|\-–—]\s+[^|\-–—]{2,80}$/, "").trim();

  // ── company ──
  let company =
    document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content?.trim() ||
    "";
  if (!company && docTitle) {
    // Try " at Company" / " | Company" / " - Company" patterns.
    const m = docTitle.match(/\s+at\s+([^|\-–—]{2,80})\s*$/i)
      || docTitle.match(/\s+[|\-–—]\s+([^|\-–—]{2,80})\s*$/);
    if (m) company = m[1].trim();
  }
  if (!company) {
    // Fallback: capitalize the bare host (boards.greenhouse.io/atlassian
    // → "Atlassian" via path; apply.workable.com/foo → "Foo").
    try {
      const url = new URL(window.location.href);
      const parts = url.pathname.split("/").filter(Boolean);
      const guessFromPath = parts[0] || "";
      const host = url.hostname.replace(/^www\./, "");
      company = (guessFromPath || host.split(".")[0] || "Unknown").replace(/[-_]+/g, " ");
      company = company.charAt(0).toUpperCase() + company.slice(1);
    } catch {
      company = "Unknown";
    }
  }
  company = company.slice(0, 200);

  // ── location (best effort) ──
  let location = "";
  const bodyText = document.body?.innerText?.slice(0, 4000) || "";
  // City, Country / Country / "Remote" / "Hybrid" — pick the first match
  // near the top of the page.
  const locMatch = bodyText.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?),\s*(?:[A-Z][a-zA-Z]+|[A-Z]{2,3})\b/);
  if (locMatch) location = locMatch[0].slice(0, 120);
  else if (/\bRemote\b/i.test(bodyText.slice(0, 1500))) location = "Remote";

  // ── url (strip tracking params + hash) ──
  let cleanUrl = window.location.href;
  try {
    const u = new URL(cleanUrl);
    u.hash = "";
    // Drop common tracking params so the same posting visited twice
    // dedups against the same kanban row.
    const TRACKING = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gh_src", "gh_jid", "ref", "fbclid", "gclid"];
    TRACKING.forEach((p) => u.searchParams.delete(p));
    cleanUrl = u.toString();
  } catch { /* keep raw */ }

  return { title, company, location, url: cleanUrl };
}

/**
 * Walk the document AT submit time to capture what the user actually
 * has in each filled field. Skips known profile fields (name, email,
 * phone, etc) - those already live in apply_profiles, no need to
 * duplicate. Only saves the question text + the user's answer for
 * fields the engine didn't recognize via classifyField.
 */
function collectAnsweredQuestions(): Array<{ question: string; answer: string }> {
  const out: Array<{ question: string; answer: string }> = [];
  const seen = new Set<string>();
  const inputs = Array.from(document.querySelectorAll("input, textarea, select")) as Array<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >;
  for (const el of inputs) {
    const tag = el.tagName;
    const itype = (el as HTMLInputElement).type || "";
    if (itype === "hidden" || itype === "password" || itype === "file") continue;

    const label = findLabel(el);
    if (!label || label.length < 3) continue;
    if (classifyField(label, el as HTMLElement)) continue;  // built-in profile fields stay in profile

    let value = "";
    if (tag === "SELECT") {
      const sel = el as HTMLSelectElement;
      value = sel.options[sel.selectedIndex]?.textContent?.trim() || "";
    } else if (itype === "checkbox") {
      value = (el as HTMLInputElement).checked ? "Yes" : "No";
    } else if (itype === "radio") {
      if (!(el as HTMLInputElement).checked) continue;
      value = findLabel(el) || (el as HTMLInputElement).value;
      // Use the question label, not the radio's option label.
      const groupLabel = findRadioGroupLabel(el as HTMLInputElement) || label;
      if (groupLabel) {
        if (seen.has(groupLabel)) continue;
        seen.add(groupLabel);
        out.push({ question: groupLabel, answer: value });
      }
      continue;
    } else {
      value = (el as HTMLInputElement | HTMLTextAreaElement).value || "";
    }

    if (!value || value.length < 1 || value.length > 4000) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ question: label, answer: value });
  }
  return out;
}

function findRadioGroupLabel(radio: HTMLInputElement): string {
  // Common pattern: a fieldset/legend or a wrapper div containing the
  // question text plus the option radios. Walk up until we find a
  // container with text that's not just an option label.
  let n: HTMLElement | null = radio.parentElement;
  for (let i = 0; i < 5 && n; i++) {
    const legend = n.querySelector("legend");
    if (legend?.textContent) return legend.textContent.replace(/\s+/g, " ").trim();
    const aria = n.getAttribute("aria-labelledby");
    if (aria) {
      const ref = document.getElementById(aria);
      if (ref?.textContent) return ref.textContent.replace(/\s+/g, " ").trim();
    }
    n = n.parentElement;
  }
  return "";
}

// ── Background-bridged fetch ───────────────────────────────────────────
function callBackground<T = any>(path: string, init?: { method?: string; body?: any; query?: Record<string, string> }): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "api/call", path, init }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || "Extension messaging failed"));
        return;
      }
      if (resp?.ok) resolve(resp.data as T);
      else reject(Object.assign(new Error(resp?.error || "Request failed"), { code: resp?.code, status: resp?.status }));
    });
  });
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
