import { useState } from "react";
import { CREATOR } from "./CreatorPage";
import { LinkedInIcon } from "./icons";

/**
 * "Ask for an invite" block.
 *
 * Sending a cold DM is a small amount of friction that stops people
 * actually doing it, so the message is written for them: copy, open
 * LinkedIn, paste, send.
 */

const TEMPLATE =
  "Hi Dhanush, I saw GO CANDID8 on your LinkedIn and I'd love to try it. " +
  "Could you send me an invite link? Thanks!";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context and can be blocked, so fall
    // back to the old selection trick before giving up.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function RequestAccess({
  className = "",
  title = "Ask me for a link",
}: {
  className?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleCopy() {
    const ok = await copyText(TEMPLATE);
    setFailed(!ok);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  }

  return (
    <div className={`rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-4 ${className}`}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
        {title}
      </div>

      {/* The message itself, selectable so it can be copied by hand too. */}
      <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 py-3 text-sm text-[var(--text-secondary)] leading-relaxed select-all">
        {TEMPLATE}
      </p>

      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <button
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[var(--accent)] text-[#0c0e14] font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          {copied ? "Copied, now paste it to me" : "Copy message"}
        </button>
        <a
          href={CREATOR.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#0a66c2] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          <LinkedInIcon size={16} /> Open LinkedIn
        </a>
      </div>

      {failed && (
        <p className="mt-2 text-xs text-amber-300">
          Your browser blocked the copy. Select the message above and copy it manually.
        </p>
      )}
      <p className="mt-2.5 text-[11px] text-[var(--text-ghost)]">
        Copy the message, open my profile, and send it. I'll reply with your own invite link.
      </p>
    </div>
  );
}
