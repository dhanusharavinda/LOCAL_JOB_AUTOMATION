/**
 * DOM-selector helpers shared across every per-ATS content script.
 *
 * Most ATS forms expose either a stable `name`, `id`, or `aria-label`
 * for each field. The bigger question is matching label TEXT against
 * profile fields - different ATSs phrase the same question differently
 * ("First Name" vs "Given name" vs "First / forename"), so we match
 * against a small token bag per field.
 */

export interface MatchHit {
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  label: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Token bags per logical profile field. Lowercase, partial-match.
 *
 * Tokens are matched against the label, name, id, autocomplete, and
 * data-testid attributes after each is normalized (hyphens/underscores
 * collapsed to spaces). The longest matching token wins, so more
 * specific phrases ("first name") outrank generic ones ("name") when
 * both appear in the haystack.
 */
export const FIELD_TOKENS: Record<string, string[]> = {
  // First-name should be matched BEFORE full_name because "first name" is
  // longer than the generic "name" token and our scorer picks the longest.
  first_name:   ["first name", "given name", "forename", "fname"],
  last_name:    ["last name", "family name", "surname", "lname"],
  full_name:    ["full name", "your name", "candidate name", "applicant name", "name"],
  email:        ["email", "e mail"],
  phone:        ["phone", "mobile", "cell", "telephone", "phone number"],
  linkedin:     ["linkedin", "linked in"],
  github:       ["github", "git hub"],
  portfolio:    ["portfolio", "personal site", "personal website", "website url", "your website"],
  street:       ["street", "address line 1", "address 1", "street address"],
  city:         ["city", "town"],
  state_region: ["state", "province", "region", "county"],
  postcode:     ["postcode", "postal code", "zip", "zip code"],
  country:      ["country", "country of residence"],
  work_auth:    ["work authorization", "authorized to work", "right to work", "are you legally", "legally authorized", "authorization to work"],
  sponsorship:  ["sponsorship", "visa sponsor", "require sponsorship", "need sponsorship"],
  relocate:     ["relocate", "willing to relocate", "relocation"],
  salary_exp:   ["salary expectation", "expected salary", "compensation expectation", "desired salary", "salary range"],
  start_date:   ["start date", "earliest start", "available to start", "notice period"],
  years_exp:    ["years of experience", "years experience", "experience years"],
  university:   ["university", "school", "college", "alma mater"],
  degree:       ["highest degree", "level of education", "education level", "degree"],
  graduation:   ["graduation", "year graduated", "year of graduation", "graduation year"],
  gender:       ["gender", "what is your gender"],
  ethnicity:    ["ethnicity", "race", "racial"],
  veteran:      ["veteran"],
  disability:   ["disability"],
  pronouns:     ["pronoun"],
};

/**
 * Return the visible label text for a form control. Looks at:
 *   1. <label for=id> - the canonical association
 *   2. enclosing <label> - content scripts seeing modern React forms
 *   3. preceding sibling text (heuristic for hand-rolled HTML)
 *   4. aria-label / aria-labelledby
 *   5. placeholder (last resort)
 */
export function findLabel(el: HTMLElement): string {
  if (el.id) {
    const lbl = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (lbl) return cleanText(lbl.textContent);
  }
  const parentLabel = el.closest("label");
  if (parentLabel) return cleanText(parentLabel.textContent);

  const aria = el.getAttribute("aria-label");
  if (aria) return cleanText(aria);

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ref = document.getElementById(labelledBy);
    if (ref) return cleanText(ref.textContent);
  }

  const placeholder = (el as HTMLInputElement).placeholder;
  if (placeholder) return cleanText(placeholder);

  // Walk up looking for a heading-ish text node.
  let node: HTMLElement | null = el.parentElement;
  for (let i = 0; i < 4 && node; i++) {
    const txt = cleanText(node.textContent).slice(0, 200);
    if (txt && txt.length < 200) return txt;
    node = node.parentElement;
  }
  return "";
}

/**
 * Match a control against FIELD_TOKENS by examining EVERY signal we can
 * pull from it: discovered label, name attr, id, autocomplete, and
 * data-testid. The classifier picks the strongest match across all
 * signals - so a field labeled "Name" but with `name="firstName"` still
 * resolves to first_name (because the attr signal is more specific
 * than the user-facing label).
 */
export function classifyField(label: string, el?: HTMLElement | null): { key: string; score: number } | null {
  const candidates = [label];
  if (el) {
    candidates.push(
      el.getAttribute("name") || "",
      el.id || "",
      el.getAttribute("autocomplete") || "",
      el.getAttribute("data-testid") || "",
      el.getAttribute("data-test") || "",
      el.getAttribute("data-qa") || "",
    );
  }
  const haystacks = candidates.map(normalizeLabel).filter(Boolean);
  if (haystacks.length === 0) return null;

  let best: { key: string; score: number } | null = null;
  for (const [key, tokens] of Object.entries(FIELD_TOKENS)) {
    for (const t of tokens) {
      for (const h of haystacks) {
        if (h.includes(t)) {
          // Score = matched-token length / haystack length, capped at 1.
          // Prefer matches in shorter haystacks (an attr "first_name"
          // beats a label that says "First name and last name").
          const score = t.length / Math.max(h.length, t.length);
          if (!best || score > best.score) best = { key, score };
        }
      }
    }
  }
  return best;
}

/**
 * Normalize a label or attribute string into space-separated lowercase
 * tokens. Strips required-marker asterisks, collapses hyphens and
 * underscores to spaces (so `first-name` and `first_name` both become
 * `first name` and match the FIELD_TOKENS bag), and dedupes whitespace.
 */
function normalizeLabel(s: string): string {
  return s.toLowerCase()
    .replace(/[*]/g, "")
    .replace(/[_\-/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(s: string | null | undefined): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

/** Polyfill since CSS.escape is recent and content scripts may run on older sites. */
function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && (CSS as any).escape) return (CSS as any).escape(s);
  return s.replace(/[^\w-]/g, (m) => `\\${m}`);
}

/** Return every fill-able form control in the document, deduped. */
export function collectFormControls(root: ParentNode = document): Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> {
  const sel = "input, textarea, select";
  const all = Array.from(root.querySelectorAll(sel)) as Array<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >;
  return all.filter((el) => {
    if (el.disabled) return false;
    const t = (el as HTMLInputElement).type;
    if (t === "hidden" || t === "submit" || t === "button" || t === "reset") return false;
    return true;
  });
}

/**
 * Find the smallest visible container that has inputs whose labels
 * match every keyword in `keywords` (case-insensitive partial match).
 *
 * Used as a fallback for ATSs that don't expose a real <form> element:
 * if we can find a single container with a Name input AND an Email
 * input inside it, that's almost certainly the application form.
 *
 * Returns the document.body if no tighter container is found, so the
 * caller never has to handle null and the engine's full-doc walk still
 * gets a chance to fill what it can.
 */
export function findContainerWithInputs(keywords: string[]): HTMLElement {
  const inputs = Array.from(document.querySelectorAll("input, textarea")) as Array<
    HTMLInputElement | HTMLTextAreaElement
  >;
  // For each keyword, pick the FIRST input whose discovered label matches.
  const matched: HTMLElement[] = [];
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    const hit = inputs.find((i) => {
      if ((i as HTMLInputElement).type === "hidden") return false;
      const lbl = findLabel(i).toLowerCase();
      const name = (i.getAttribute("name") || "").toLowerCase();
      const id   = (i.id || "").toLowerCase();
      return lbl.includes(k) || name.includes(k) || id.includes(k);
    });
    if (hit) matched.push(hit);
  }
  if (matched.length < keywords.length) return document.body;

  // Lowest common ancestor of all matched inputs.
  let lca: HTMLElement = matched[0];
  for (let i = 1; i < matched.length; i++) {
    lca = lowestCommonAncestor(lca, matched[i]);
  }
  // Walk up one level if the LCA is the input itself (degenerate case).
  if (matched.includes(lca) && lca.parentElement) lca = lca.parentElement;
  return lca || document.body;
}

function lowestCommonAncestor(a: HTMLElement, b: HTMLElement): HTMLElement {
  const ancestors = new Set<HTMLElement>();
  let n: HTMLElement | null = a;
  while (n) { ancestors.add(n); n = n.parentElement; }
  n = b;
  while (n) {
    if (ancestors.has(n)) return n;
    n = n.parentElement;
  }
  return document.body;
}

/**
 * Decide whether a control is "required" - the user must put SOMETHING
 * here or the form won't submit. Three signals:
 *   1. `required` HTML attribute
 *   2. `aria-required="true"`
 *   3. An asterisk ("*") in the discovered label, the gold-standard
 *      visual convention every ATS uses
 *
 * Used by the engine's strict-fill mode: required text fields with no
 * profile match get an AI-drafted answer auto-inserted instead of
 * being left blank. Optional fields stay blank unless the user clicks
 * the inline AI button.
 */
export function isFieldRequired(el: HTMLElement): boolean {
  if (el.hasAttribute("required")) return true;
  const aria = el.getAttribute("aria-required");
  if (aria && aria.toLowerCase() === "true") return true;
  // Asterisk in label (handles both "Name *" and "Name<span>*</span>").
  const label = findLabel(el);
  if (label && /\*/.test(label)) return true;
  return false;
}

/**
 * Find every <input type="file"> in `root` whose discovered label
 * suggests a resume / CV upload. Returns them in DOM order so the
 * caller can prefer the first match.
 */
export function findResumeFileInputs(root: ParentNode): HTMLInputElement[] {
  const all = Array.from(root.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
  return all.filter((el) => {
    if (el.disabled) return false;
    const text = (
      findLabel(el) +
      " " +
      (el.getAttribute("name") || "") +
      " " +
      (el.id || "") +
      " " +
      (el.accept || "")
    ).toLowerCase();
    return /resume|cv\b|curriculum\s*vitae/.test(text);
  });
}
