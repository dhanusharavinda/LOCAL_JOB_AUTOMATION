/**
 * Inline per-field AI buttons (Simplify-style).
 *
 * Adds a small floating "✨ AI" button next to every text field the
 * engine surfaced as a pending question. Click → calls the same AI-
 * draft handler the overlay uses, then writes the result directly
 * into the field.
 *
 * Implementation:
 *   - One Shadow-DOM-rooted host element at top-level. All buttons
 *     live inside it, so the host page's CSS can't bleed in or out.
 *   - Each button is `position: fixed` and updated on every animation
 *     frame via `getBoundingClientRect` of its target field. Survives
 *     scrolling, resizing, and React re-layouts cheaply.
 *   - Buttons hide themselves when their target field scrolls out of
 *     view or gets unmounted from the DOM.
 *
 * Public surface: `mountFieldButtons(items, handlers)` returns a
 * destroy() function. Re-mount cleanly destroys the old layer.
 */

export interface FieldButtonItem {
  id: string;
  el: HTMLTextAreaElement | HTMLInputElement;
  label: string;
  /** Called when the user clicks the inline ✨ AI button.
   *  Returns the drafted text or null. The button manages its own
   *  loading state during the await. */
  onDraft: (id: string) => Promise<string | null>;
  /** Called after a draft completes; the engine writes the value into
   *  the field via setNativeValue. */
  onApply: (id: string, value: string) => void;
}

export interface FieldButtonsApi {
  destroy(): void;
  refresh(): void;
}

const HOST_ID = "go-candid8-field-buttons-host";

export function mountFieldButtons(items: FieldButtonItem[]): FieldButtonsApi {
  // Idempotent - destroy any previous mount.
  const existing = document.getElementById(HOST_ID);
  if (existing) existing.remove();

  if (items.length === 0) {
    return { destroy: () => { /* noop */ }, refresh: () => { /* noop */ } };
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  // Pointer-events:none on the host so the wrapper doesn't intercept
  // clicks on the page below; we re-enable pointer-events on each
  // button individually.
  host.style.cssText =
    "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483645;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${css()}</style>`;

  interface Tracked {
    item: FieldButtonItem;
    btn: HTMLButtonElement;
  }
  const tracked: Tracked[] = [];

  for (const it of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fab";
    btn.title = `AI-draft answer for: ${truncate(it.label, 60)}`;
    btn.innerHTML = `<span class="fab-spark">✨</span><span class="fab-label">AI</span>`;
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // don't blur the field
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add("loading");
      btn.setAttribute("disabled", "true");
      btn.querySelector(".fab-label")!.textContent = "…";
      try {
        const ans = await it.onDraft(it.id);
        if (ans) it.onApply(it.id, ans);
      } catch { /* surfaced by overlay */ }
      finally {
        btn.classList.remove("loading");
        btn.removeAttribute("disabled");
        btn.querySelector(".fab-label")!.textContent = "AI";
      }
    });
    shadow.appendChild(btn);
    tracked.push({ item: it, btn });
  }

  // Reposition every button against its target field.
  // requestAnimationFrame loop is cheap and covers scroll, resize,
  // and React-driven layout shifts without separate listeners.
  let raf = 0;
  let alive = true;
  function tick() {
    if (!alive) return;
    for (const t of tracked) {
      const r = t.item.el.getBoundingClientRect();
      const onScreen =
        r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
      if (!onScreen) {
        t.btn.style.display = "none";
        continue;
      }
      t.btn.style.display = "";
      // Park the button on the right edge of the field, just inside.
      // Top-aligned with a small offset so it doesn't overlap a 1-line
      // input's text. For multiline (textarea) targets we anchor to
      // the top so the button stays consistent as the user types.
      const top = Math.max(8, r.top + 6);
      const left = Math.max(8, r.right - 60);
      t.btn.style.top = `${top}px`;
      t.btn.style.left = `${left}px`;
    }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  return {
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      host.remove();
    },
    refresh() {
      // No-op: the rAF loop already polls. Method exists in case the
      // caller wants to force an early reposition after a programmatic
      // DOM change.
    },
  };
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function css(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; }
    .fab {
      position: fixed;
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: linear-gradient(135deg, #ff5722 0%, #ff7043 100%);
      color: #ffffff;
      border: 0;
      border-radius: 999px;
      box-shadow: 0 4px 12px rgba(255, 87, 34, 0.35);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0.04em;
      cursor: pointer;
      user-select: none;
      transition: transform 120ms ease, box-shadow 120ms ease, opacity 200ms ease;
      opacity: 0.9;
    }
    .fab:hover {
      opacity: 1;
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(255, 87, 34, 0.45);
    }
    .fab:active {
      transform: translateY(0);
      box-shadow: 0 2px 6px rgba(255, 87, 34, 0.35);
    }
    .fab[disabled], .fab.loading {
      opacity: 0.7;
      cursor: wait;
    }
    .fab.loading .fab-spark {
      animation: pulse 900ms ease-in-out infinite;
    }
    .fab-spark { font-size: 12px; line-height: 1; }
    .fab-label { font-size: 10px; }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.25); }
    }
  `;
}
