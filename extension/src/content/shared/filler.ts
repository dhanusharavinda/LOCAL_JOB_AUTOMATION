/**
 * Field-fill primitives.
 *
 * Modern React/Vue forms ignore programmatic .value assignment because
 * the framework's controlled-input wrapper only updates state on real
 * user-driven events. The dance below - set the property via the
 * native descriptor + dispatch a synthetic input event - is the
 * standard workaround that drives React's reconciler the same way a
 * real keystroke does.
 */

import type { ApplyProfile } from "../../api";

export type FillableEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Force-set a value on a controlled input so the framework picks it up. */
export function setNativeValue(el: FillableEl, value: string): void {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  const setter = desc?.set;
  if (setter) setter.call(el, value);
  else (el as any).value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Click a checkbox/radio idempotently, dispatching the right events. */
export function setCheckbox(el: HTMLInputElement, checked: boolean): void {
  if (el.checked === checked) return;
  el.click();
}

/**
 * Pick the matching option from a <select>. Tolerates case + partial
 * match (e.g. "Yes" matching "yes, I am authorized").
 *
 * Uses setNativeValue (instead of `el.value = ...`) so React's tracked
 * value system picks up the new value - directly assigning .value is
 * tracked-bypassed in React 16+ and the onChange handler thinks
 * nothing changed.
 */
export function selectOption(el: HTMLSelectElement, value: string): boolean {
  const target = value.toLowerCase().trim();
  let chosen: HTMLOptionElement | null = null;
  for (const opt of Array.from(el.options)) {
    const text = (opt.textContent || opt.value || "").toLowerCase().trim();
    if (text === target) { chosen = opt; break; }
  }
  if (!chosen) {
    for (const opt of Array.from(el.options)) {
      const text = (opt.textContent || opt.value || "").toLowerCase().trim();
      if (text && (text.includes(target) || target.includes(text))) { chosen = opt; break; }
    }
  }
  if (!chosen) return false;
  setNativeValue(el, chosen.value);
  return true;
}

/**
 * Resolve the profile value for a logical field key.
 *
 * Falls through to multiple sources: full_name → name parts, single
 * salary number → "min-max" string, etc.
 */
export function valueForKey(key: string, profile: ApplyProfile): string | null {
  switch (key) {
    case "full_name":  return profile.full_name || null;
    case "first_name": {
      const n = (profile.full_name || "").trim().split(/\s+/);
      return n[0] || null;
    }
    case "last_name": {
      const n = (profile.full_name || "").trim().split(/\s+/);
      return n.length > 1 ? n.slice(1).join(" ") : null;
    }
    case "email":         return profile.email || null;
    case "phone":         return profile.phone || null;
    case "linkedin":      return profile.linkedin_url || null;
    case "github":        return profile.github_url || null;
    case "portfolio":     return profile.portfolio_url || null;
    case "street":        return profile.street || null;
    case "city":          return profile.city || null;
    case "state_region":  return profile.state_region || null;
    case "postcode":      return profile.postcode || null;
    case "country":       return profile.country || null;
    case "pronouns":      return profile.pronouns || null;
    case "work_auth":     return profile.work_auth_status || null;
    case "sponsorship":
      return profile.requires_sponsorship == null ? null : profile.requires_sponsorship ? "Yes" : "No";
    case "relocate":
      return profile.willing_to_relocate == null ? null : profile.willing_to_relocate ? "Yes" : "No";
    case "salary_exp": {
      if (profile.salary_min || profile.salary_max) {
        const cur = profile.salary_currency || "USD";
        if (profile.salary_min && profile.salary_max) return `${cur} ${profile.salary_min} - ${profile.salary_max}`;
        return `${cur} ${profile.salary_min || profile.salary_max}`;
      }
      return null;
    }
    case "start_date":   return profile.start_date || null;
    case "years_exp":    return profile.years_experience == null ? null : String(profile.years_experience);
    case "university":   return profile.university || null;
    case "degree":       return profile.highest_degree || null;
    case "graduation":   return profile.graduation_year == null ? null : String(profile.graduation_year);
    case "gender":       return profile.gender || null;
    case "ethnicity":    return profile.ethnicity || null;
    case "veteran":      return profile.veteran_status || null;
    case "disability":   return profile.disability_status || null;
    default:             return null;
  }
}

/**
 * Fill one form control given its discovered logical field key.
 * Returns true if a value was placed, false otherwise.
 */
export function fillControl(el: FillableEl, key: string, profile: ApplyProfile): boolean {
  const v = valueForKey(key, profile);
  if (v == null) return false;

  if (el.tagName === "SELECT") {
    return selectOption(el as HTMLSelectElement, v);
  }
  const input = el as HTMLInputElement;
  if (input.type === "checkbox") {
    setCheckbox(input, /^(yes|true|1)$/i.test(v));
    return true;
  }
  if (input.type === "radio") {
    // Match against the radio's value or label text.
    const target = v.toLowerCase().trim();
    const text = (input.parentElement?.textContent || input.value || "").toLowerCase().trim();
    if (text === target || text.includes(target) || target.includes(text)) {
      input.click();
      return true;
    }
    return false;
  }
  setNativeValue(el, v);
  return true;
}

export interface FillReport {
  filled: number;
  unfilled: Array<{ key: string; label: string; el: FillableEl }>;
  freeText: Array<{ label: string; el: HTMLTextAreaElement }>;
}

/**
 * Drop a resume PDF into a <input type="file"> field.
 *
 * `<input type="file">.files` is read-only by spec, but a DataTransfer
 * is the standard browser-blessed way to set it programmatically.
 * Most React form libraries (react-hook-form, formik, custom Ashby
 * widgets) listen to the `change` event we dispatch right after, so
 * the upload kicks off the same way it would for a real user pick.
 */
export function attachFileToInput(input: HTMLInputElement, file: File): boolean {
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

export function looksLikeEssayField(el: FillableEl, label: string): boolean {
  if (el.tagName !== "TEXTAREA") return false;
  const t = label.toLowerCase();
  if (!t) return true;
  // Long-form prompts.
  return /(why|tell|describe|explain|share|cover letter|interest|motivat|achievement|challenge|problem|strength|weakness)/.test(t);
}
