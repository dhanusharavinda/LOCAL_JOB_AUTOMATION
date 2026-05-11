/**
 * Floating overlay panel injected on every supported ATS page.
 *
 * Built without React on the content-script side to keep the bundle
 * tiny (~6KB) and avoid the overhead of mounting React inside an
 * untrusted page. We use a Shadow DOM wrapper so the host page's CSS
 * can't bleed into our panel and vice-versa.
 *
 * Public surface:
 *   const panel = mountOverlay({...});
 *   panel.setStatus({ filled: 4, unfilled: 2 });
 *   panel.attachAiAnswer(handler);
 */

export interface OverlayApi {
  setHeadline(text: string): void;
  setStatus(status: "idle" | "filling" | "filled" | "error", detail?: string): void;
  setReport(report: { filled: number; unfilled: number; review: number }): void;
  setAiQuestions(questions: Array<{ id: string; label: string; current: string }>): void;
  setOptionQuestions(questions: Array<{ id: string; label: string; options: string[]; current: string }>): void;
  setBankCount(n: number): void;
  showError(msg: string): void;
  showInfo(msg: string): void;
  destroy(): void;
}

export interface OverlayHandlers {
  onFill: () => void;
  onAiAnswer?: (questionId: string) => Promise<string | null>;
  onApplyAiAnswer?: (questionId: string, answer: string) => void;
  onPickOption?: (questionId: string, optionLabel: string) => void;
  onAiPickOption?: (questionId: string) => Promise<string | null>;
  onOpenDashboard?: () => void;
}

export function mountOverlay(handlers: OverlayHandlers): OverlayApi {
  // Idempotent - calling twice on the same page is a no-op.
  const existing = document.getElementById("go-candid8-overlay-host");
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = "go-candid8-overlay-host";
  host.style.cssText = "all: initial; position: fixed; top: 80px; right: 24px; z-index: 2147483646;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>${overlayCss()}</style>
    <div class="panel" role="dialog" aria-label="GO CANDID8 auto-apply">
      <div class="header">
        <div class="brand-row">
          <div class="brand">GO <span class="accent">CANDID8</span></div>
          <span class="bank-chip" data-bank style="display:none" title="Answers saved in your profile bank - pre-fill future applications instantly">
            <span class="bank-icon">📚</span>
            <span class="bank-count" data-bank-count>0</span>
          </span>
        </div>
        <button class="close" title="Hide" aria-label="Hide">×</button>
      </div>
      <div class="body">
        <div class="headline" data-headline>Detecting form…</div>
        <div class="report" data-report></div>
        <button class="primary" data-fill>Fill form</button>
        <div class="opt-section" data-opt></div>
        <div class="ai-section" data-ai></div>
        <div class="info" data-info></div>
        <div class="error" data-error></div>
        <div class="footer">
          <span class="muted">You always click Submit on the site.</span>
          <a class="dashboard-link" href="#" data-dashboard>Dashboard</a>
        </div>
      </div>
    </div>
  `;

  const panel = shadow.querySelector(".panel") as HTMLElement;
  const headline = shadow.querySelector("[data-headline]") as HTMLElement;
  const report = shadow.querySelector("[data-report]") as HTMLElement;
  const fillBtn = shadow.querySelector("[data-fill]") as HTMLButtonElement;
  const aiSection = shadow.querySelector("[data-ai]") as HTMLElement;
  const optSection = shadow.querySelector("[data-opt]") as HTMLElement;
  const errorEl = shadow.querySelector("[data-error]") as HTMLElement;
  const infoEl = shadow.querySelector("[data-info]") as HTMLElement;
  const closeBtn = shadow.querySelector(".close") as HTMLButtonElement;
  const bankChip = shadow.querySelector("[data-bank]") as HTMLElement;
  const bankCountEl = shadow.querySelector("[data-bank-count]") as HTMLElement;
  const dashLink = shadow.querySelector("[data-dashboard]") as HTMLAnchorElement;

  fillBtn.addEventListener("click", () => handlers.onFill());
  closeBtn.addEventListener("click", () => host.remove());
  dashLink.addEventListener("click", (e) => {
    e.preventDefault();
    handlers.onOpenDashboard?.();
  });

  // Make the panel draggable from the header.
  enableDrag(host, panel.querySelector(".header") as HTMLElement);

  return {
    setHeadline(text) { headline.textContent = text; },
    setStatus(status, detail) {
      panel.dataset.status = status;
      if (status === "filling") {
        fillBtn.disabled = true;
        fillBtn.textContent = "Filling…";
      } else if (status === "filled") {
        fillBtn.disabled = false;
        fillBtn.textContent = "Fill again";
      } else if (status === "error") {
        fillBtn.disabled = false;
        fillBtn.textContent = "Retry fill";
        if (detail) errorEl.textContent = detail;
      } else {
        fillBtn.disabled = false;
        fillBtn.textContent = "Fill form";
      }
    },
    setReport({ filled, unfilled, review }) {
      report.innerHTML = "";
      const r = document.createElement("div");
      r.className = "report-row";
      r.innerHTML =
        `<span class="chip ok">${filled} filled</span>` +
        (review > 0 ? ` <span class="chip warn">${review} need review</span>` : "") +
        (unfilled > 0 ? ` <span class="chip muted">${unfilled} skipped</span>` : "");
      report.appendChild(r);
    },
    setAiQuestions(questions) {
      aiSection.innerHTML = "";
      if (!questions.length) return;
      const head = document.createElement("div");
      head.className = "ai-head";
      head.textContent = "Free-text questions - let AI draft answers in your voice:";
      aiSection.appendChild(head);
      for (const q of questions) {
        const card = document.createElement("div");
        card.className = "ai-card";
        card.dataset.qid = q.id;
        card.innerHTML = `
          <div class="ai-q">${escapeHtml(q.label || "Open-ended question")}</div>
          <textarea class="ai-a" rows="3">${escapeHtml(q.current || "")}</textarea>
          <div class="ai-actions">
            <button class="ai-gen" type="button">Draft with AI</button>
            <button class="ai-apply" type="button" disabled>Apply</button>
            <span class="ai-status muted"></span>
          </div>
        `;
        const ta = card.querySelector(".ai-a") as HTMLTextAreaElement;
        const genBtn = card.querySelector(".ai-gen") as HTMLButtonElement;
        const applyBtn = card.querySelector(".ai-apply") as HTMLButtonElement;
        const status = card.querySelector(".ai-status") as HTMLElement;

        genBtn.addEventListener("click", async () => {
          if (!handlers.onAiAnswer) return;
          genBtn.disabled = true;
          status.textContent = "Drafting…";
          try {
            const ans = await handlers.onAiAnswer(q.id);
            if (ans) {
              ta.value = ans;
              applyBtn.disabled = false;
              status.textContent = "Drafted. Edit if needed, then Apply.";
            } else {
              status.textContent = "No answer generated.";
            }
          } catch (err: any) {
            status.textContent = err?.message || "Draft failed.";
          } finally {
            genBtn.disabled = false;
          }
        });
        ta.addEventListener("input", () => { applyBtn.disabled = !ta.value.trim(); });
        applyBtn.addEventListener("click", () => {
          handlers.onApplyAiAnswer?.(q.id, ta.value);
          status.textContent = "Applied to the form.";
        });
        aiSection.appendChild(card);
      }
    },
    setOptionQuestions(questions) {
      optSection.innerHTML = "";
      if (!questions.length) return;
      const head = document.createElement("div");
      head.className = "ai-head";
      head.textContent = "Options to pick - click a chip, or let AI suggest:";
      optSection.appendChild(head);
      for (const q of questions) {
        const card = document.createElement("div");
        card.className = "ai-card";
        card.dataset.qid = q.id;
        const labelEl = document.createElement("div");
        labelEl.className = "ai-q";
        labelEl.textContent = q.label || "Option question";
        card.appendChild(labelEl);

        const chips = document.createElement("div");
        chips.className = "opt-chips";
        for (const opt of q.options) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "opt-chip";
          chip.textContent = opt;
          if (opt === q.current) chip.classList.add("opt-chip-active");
          chip.addEventListener("click", () => {
            handlers.onPickOption?.(q.id, opt);
            for (const c of Array.from(chips.querySelectorAll(".opt-chip"))) {
              c.classList.remove("opt-chip-active");
            }
            chip.classList.add("opt-chip-active");
            status.textContent = "Picked.";
          });
          chips.appendChild(chip);
        }
        card.appendChild(chips);

        const actions = document.createElement("div");
        actions.className = "ai-actions";
        const aiBtn = document.createElement("button");
        aiBtn.type = "button";
        aiBtn.className = "ai-gen";
        aiBtn.textContent = "AI suggest";
        const status = document.createElement("span");
        status.className = "ai-status muted";
        actions.appendChild(aiBtn);
        actions.appendChild(status);
        card.appendChild(actions);

        aiBtn.addEventListener("click", async () => {
          if (!handlers.onAiPickOption) return;
          aiBtn.disabled = true;
          status.textContent = "Thinking…";
          try {
            const choice = await handlers.onAiPickOption(q.id);
            if (choice) {
              for (const c of Array.from(chips.querySelectorAll<HTMLButtonElement>(".opt-chip"))) {
                if (c.textContent === choice) {
                  c.classList.add("opt-chip-active");
                  handlers.onPickOption?.(q.id, choice);
                } else {
                  c.classList.remove("opt-chip-active");
                }
              }
              status.textContent = `AI picked: ${choice}`;
            } else {
              status.textContent = "No suggestion.";
            }
          } catch (err: any) {
            status.textContent = err?.message || "Suggest failed.";
          } finally {
            aiBtn.disabled = false;
          }
        });

        optSection.appendChild(card);
      }
    },
    setBankCount(n) {
      if (!bankChip || !bankCountEl) return;
      if (typeof n !== "number" || n <= 0) {
        bankChip.style.display = "none";
      } else {
        bankCountEl.textContent = String(n);
        bankChip.style.display = "";
      }
    },
    showError(msg) { errorEl.textContent = msg; infoEl.textContent = ""; },
    showInfo(msg)  { infoEl.textContent  = msg; errorEl.textContent = ""; },
    destroy() { host.remove(); },
  };
}

function enableDrag(host: HTMLElement, handle: HTMLElement) {
  let dx = 0, dy = 0, dragging = false;
  handle.style.cursor = "move";
  handle.addEventListener("mousedown", (e) => {
    dragging = true;
    const rect = host.getBoundingClientRect();
    dx = e.clientX - rect.left;
    dy = e.clientY - rect.top;
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    host.style.left = `${e.clientX - dx}px`;
    host.style.top  = `${e.clientY - dy}px`;
    host.style.right = "auto";
  });
  window.addEventListener("mouseup", () => { dragging = false; });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function overlayCss(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; }
    .panel {
      width: 340px; max-height: 80vh; overflow: auto;
      background: #ffffff; color: #1a1a1a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      border: 1px solid #e0e0e0; border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.18);
    }
    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 14px; border-bottom: 1px solid #f0f0f0;
      background: #fafafa; border-radius: 12px 12px 0 0;
      user-select: none;
    }
    .brand-row { display: flex; align-items: center; gap: 8px; }
    .brand { font-weight: 700; font-size: 13px; letter-spacing: 0.04em; }
    .brand .accent { color: #ff5722; }
    .bank-chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 12px;
      background: #f0f4ff; color: #2e3a87; font-size: 11px; font-weight: 600;
      cursor: default;
    }
    .bank-icon { font-size: 11px; line-height: 1; }
    .bank-count { font-variant-numeric: tabular-nums; }
    .close {
      background: transparent; border: 0; font-size: 18px; line-height: 1;
      cursor: pointer; color: #555; padding: 0 6px;
    }
    .body { padding: 14px; }
    .headline { font-weight: 600; margin-bottom: 8px; }

    .report { margin-bottom: 10px; }
    .chip {
      display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px;
      margin-right: 4px;
    }
    .chip.ok    { background: #e8f5e9; color: #2e7d32; }
    .chip.warn  { background: #fff3e0; color: #e65100; }
    .chip.muted { background: #f1f1f1; color: #666; }

    .primary {
      width: 100%; padding: 10px 14px; border: 0; border-radius: 8px;
      background: #1a1a1a; color: #fff; font-weight: 700; cursor: pointer;
    }
    .primary:hover:not(:disabled) { background: #000; }
    .primary:disabled { opacity: 0.6; cursor: not-allowed; }

    .ai-section { margin-top: 14px; }
    .ai-head { font-weight: 600; font-size: 12px; margin-bottom: 8px; color: #444; }
    .ai-card {
      border: 1px solid #eaeaea; border-radius: 8px; padding: 10px;
      margin-bottom: 8px; background: #fafafa;
    }
    .ai-q { font-weight: 600; margin-bottom: 6px; font-size: 12px; }
    .ai-a {
      width: 100%; font: inherit; padding: 6px 8px; border: 1px solid #d4d4d4;
      border-radius: 6px; background: #fff; resize: vertical;
    }
    .ai-actions { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
    .ai-actions button {
      padding: 6px 10px; border: 0; border-radius: 6px; cursor: pointer; font-weight: 600;
      font-size: 11px;
    }
    .ai-gen { background: #ff5722; color: #fff; }
    .ai-gen:hover:not(:disabled) { background: #e64a19; }
    .ai-apply { background: #f1f1f1; color: #1a1a1a; }
    .ai-apply:hover:not(:disabled) { background: #e5e5e5; }
    .ai-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
    .ai-status { font-size: 11px; }
    .muted { color: #777; }

    .opt-section { margin-top: 14px; }
    .opt-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .opt-chip {
      border: 1px solid #d4d4d4; background: #fff; color: #1a1a1a;
      padding: 5px 10px; border-radius: 14px; font: inherit; font-size: 11px;
      cursor: pointer;
    }
    .opt-chip:hover { border-color: #ff5722; color: #ff5722; }
    .opt-chip-active {
      background: #1a1a1a; color: #fff; border-color: #1a1a1a;
    }
    .opt-chip-active:hover { color: #fff; border-color: #1a1a1a; }

    .info  { color: #2e7d32; font-size: 12px; margin-top: 8px; }
    .error { color: #c62828; font-size: 12px; margin-top: 8px; }

    .footer {
      margin-top: 12px; padding-top: 10px; border-top: 1px solid #f0f0f0;
      display: flex; justify-content: space-between; align-items: center;
      font-size: 11px;
    }
    .dashboard-link { color: #ff5722; text-decoration: none; font-weight: 600; }
    .dashboard-link:hover { text-decoration: underline; }
  `;
}
