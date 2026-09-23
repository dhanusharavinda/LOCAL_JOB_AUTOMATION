/**
 * Free speech-to-text using the browser's own engine, with Whisper kept
 * as the fallback.
 *
 * Why bother: Whisper bills $0.006 per minute and is 58% of what an
 * interview session costs. The browser's SpeechRecognition is free.
 *
 * Why it is not the only path: this was tried before and reverted for a
 * good reason. Chrome's implementation streams audio to Google's
 * servers, so it fails with a `network` error on corporate networks,
 * blocked endpoints and slow links, and Safari and Firefox either lack
 * it or gate it. Losing transcription mid-interview is far worse than
 * the cost it saves.
 *
 * So: try the free engine, and the moment it errors or returns nothing,
 * hand the recorded audio to Whisper. The caller records to a Blob
 * regardless, which costs nothing if it is never uploaded, so the
 * fallback needs no second attempt from the user.
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

function getCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Whether the free engine exists at all in this browser. */
export function browserSpeechAvailable(): boolean {
  return getCtor() !== null;
}

export interface BrowserSpeechHandle {
  /** Stop listening and resolve with whatever was heard. */
  stop: () => void;
  /** Give up without waiting for a result. */
  abort: () => void;
  /** Resolves with the final transcript, or rejects if the engine failed. */
  done: Promise<string>;
}

/**
 * Start listening. Resolves with the transcript when `stop()` is called
 * or the engine ends on its own; rejects when the engine errors, which
 * is the caller's signal to upload the recorded audio to Whisper.
 *
 * `onInterim` gets partial text so the UI can show words appearing,
 * which is most of why the browser engine feels better than waiting for
 * a round trip.
 */
export function startBrowserSpeech(onInterim?: (text: string) => void): BrowserSpeechHandle | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;

  let finalText = "";
  let settled = false;
  let resolve!: (v: string) => void;
  let reject!: (e: Error) => void;
  const done = new Promise<string>((res, rej) => { resolve = res; reject = rej; });

  rec.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0]?.transcript || "";
      if (e.results[i].isFinal) finalText += chunk;
      else interim += chunk;
    }
    onInterim?.((finalText + " " + interim).trim());
  };

  rec.onerror = (e: any) => {
    if (settled) return;
    settled = true;
    // "no-speech" and "aborted" are ordinary, not failures of the engine.
    const code = String(e?.error || "unknown");
    if (code === "no-speech" || code === "aborted") {
      resolve(finalText.trim());
      return;
    }
    reject(new Error(`browser-speech:${code}`));
  };

  rec.onend = () => {
    if (settled) return;
    settled = true;
    resolve(finalText.trim());
  };

  try {
    rec.start();
  } catch {
    return null;   // already running, or blocked outright
  }

  /**
   * Settle no matter what.
   *
   * The engine is supposed to fire `onend` after `stop()`, but it does
   * not always: a recogniser that failed to start cleanly, or one the
   * browser has torn down, can go silent and never call back. The
   * caller awaits this promise in the middle of answering a question,
   * so a promise that never settles freezes the interview and makes
   * every button look broken. Never trust it to finish on its own.
   */
  const settleSoon = (ms: number) => {
    setTimeout(() => {
      if (settled) return;
      settled = true;
      try { rec.abort(); } catch { /* already gone */ }
      resolve(finalText.trim());
    }, ms);
  };

  return {
    stop: () => {
      try { rec.stop(); } catch { /* already stopped */ }
      // Give it a moment to deliver the last words, then give up.
      settleSoon(1200);
    },
    abort: () => {
      settled = true;
      try { rec.abort(); } catch { /* already stopped */ }
      resolve(finalText.trim());
    },
    done,
  };
}
