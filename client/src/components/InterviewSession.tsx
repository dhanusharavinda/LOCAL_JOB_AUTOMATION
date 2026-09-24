import { useEffect, useRef, useState } from "react";
import { startBrowserSpeech, BrowserSpeechHandle } from "../browserSpeech";
import {
  interviewStart, interviewTurn, interviewScore, interviewTtsBlob, interviewAbandon, interviewStt,
  type InterviewQuestion, type InterviewRubric, type InterviewMetrics, type InterviewDifficulty,
} from "../api";

/**
 * AI interview practice. Single component covers the whole flow:
 *
 *   launcher  pick mode + job-vs-manual + fine-tune note
 *   mic_check 30s mic + STT smoke test
 *   running   live voice loop (TTS asks, user answers, decide step)
 *   scoring   server-side rubric + metrics
 *   review    rendered scoring + readiness score
 *
 * Voice stack:
 *   - MediaRecorder + OpenAI Whisper for STT. We deliberately avoid
 *     Chrome's built-in SpeechRecognition because it routes audio
 *     through Google's servers and fails (network error) on corp /
 *     slow / firewall-restricted networks. Whisper round-trips through
 *     OUR server, so it works wherever the dashboard works.
 *   - OpenAI tts-1 for the AI voice, proxied through /api/interview/tts.
 *   - Web Audio API analyser drives a silence-based VAD; a manual
 *     "I'm done" button is always available as the manual stop.
 */

type Phase = "launcher" | "mic_check" | "starting" | "running" | "scoring" | "review" | "error";
type RunningSub = "speaking" | "listening" | "deciding";
type DecidingPhase = "transcribing" | "considering" | "next_question" | "scoring";

interface JobOption { id: number; job_title: string; company_name: string }

interface Props {
  /** Pre-pick a tracked job. The launcher still lets the user override. */
  initialJobId?: number | null;
  initialJobTitle?: string | null;
  initialCompanyName?: string | null;
  jobOptions?: JobOption[];
  onClose: () => void;
}

interface TranscriptEntry {
  qIdx: number;
  role: "ai" | "user";
  text: string;
  t_start: number;
  t_end: number;
}

const SILENCE_MS_DEFAULT = 1500;
const SILENCE_MS_MAX = 4000;

export default function InterviewSession({
  initialJobId, initialJobTitle, initialCompanyName, jobOptions = [], onClose,
}: Props) {
  // ── Phase-1 launcher state ─────────────────────────────────────────────
  // Fast path: when a tracked job is pre-selected (e.g. "Practice for this
  // role" from the Interview kanban column), skip the launcher entirely
  // and go straight to mic check. The job's description + the user's
  // resume are already auto-picked server-side at /api/interview/start,
  // so making the user click through Mode + Source pickers is just
  // friction. They can still flip mode from the mic-check screen.
  const autoSkipLauncher = initialJobId != null;
  const [phase, setPhase] = useState<Phase>(autoSkipLauncher ? "mic_check" : "launcher");
  const [error, setError] = useState<string>("");
  const [mode, setMode] = useState<"behavioral" | "technical">("behavioral");
  const [difficulty, setDifficulty] = useState<InterviewDifficulty>("medium");
  const [useManual, setUseManual] = useState(initialJobId == null);
  const [pickedJobId, setPickedJobId] = useState<number | null>(initialJobId ?? null);
  const [manualJd, setManualJd] = useState("");
  const [manualResume, setManualResume] = useState("");
  // Resume upload, same as the tailor: nobody wants to paste raw text.
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [parsingResume, setParsingResume] = useState(false);
  const [resumeDragOver, setResumeDragOver] = useState(false);
  const resumeFileRef = useRef<HTMLInputElement | null>(null);
  const [fineTune, setFineTune] = useState("");

  // ── Mic check ──────────────────────────────────────────────────────────
  const [micLevel, setMicLevel] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioLevelRafRef = useRef<number>(0);
  // The MediaStream from the mic check has to be held in a ref so
  // stopMicCheck() can stop its tracks. Closing the AudioContext alone
  // does NOT release the underlying tracks, which keeps the OS mic
  // indicator on AND blocks SpeechRecognition from grabbing the mic
  // for the live phase on some Chrome builds.
  const micCheckStreamRef = useRef<MediaStream | null>(null);
  // Live-phase listening status, surfaced so the user knows when the
  // mic actually failed (permission denied, no device, etc.) instead
  // of staring at a silent orb.
  const [listenWarning, setListenWarning] = useState<string>("");
  // Typed-answer fallback. When SpeechRecognition fails fatally
  // (network error, mic blocked, etc.), the user can type their
  // answer here and it's submitted as the turn's transcript when
  // they click I'm done.
  const [typedAnswer, setTypedAnswer] = useState<string>("");

  // ── Session state ─────────────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<number | null>(null);
  // Refs mirror the state for code that runs inside async chains.
  //
  // The first question is asked from a setTimeout in beginSession, so
  // every function it chains into (listening, the silence detector,
  // finishUserTurn, and the "I'm done" button wired up in that same
  // listening call) runs in the closure from the render BEFORE
  // setSessionId / setQuestions landed: sessionId null, questions [].
  // finishUserTurn's `if (!sessionId) return` then exited silently right
  // after transcription and the screen sat on "Considering your answer"
  // forever. Reading through refs makes the chain see current values no
  // matter which render created it.
  const sessionIdRef = useRef<number | null>(null);
  const questionsRef = useRef<InterviewQuestion[]>([]);
  const followUpDepthRef = useRef<number>(0);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const [followUpDepth, setFollowUpDepth] = useState(0);
  const [pendingPrompt, setPendingPrompt] = useState<string>("");
  const [sub, setSub] = useState<RunningSub>("speaking");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [interim, setInterim] = useState<string>("");
  // Sub-phase of "deciding" so the user sees actual progress instead
  // of a single "Considering your answer..." that hangs for 5-10s
  // while Whisper transcribes, /turn decides, and the next TTS warms.
  const [decidingPhase, setDecidingPhase] = useState<DecidingPhase | null>(null);
  const [decidingElapsedSec, setDecidingElapsedSec] = useState(0);
  // Mirror the transcript on a ref so finishAndScore() sees the very
  // latest entries even when called immediately after setTranscript().
  // React batches state updates - without this ref the score endpoint
  // would receive a transcript missing the final user turn (and any
  // AI prompts pushed from the same render cycle), and the rubric
  // would be computed against an incomplete record.
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const pushTranscript = (entry: TranscriptEntry) => {
    transcriptRef.current = [...transcriptRef.current, entry];
    setTranscript(transcriptRef.current);
  };

  // ── Final result ──────────────────────────────────────────────────────
  const [readiness, setReadiness] = useState<number | null>(null);
  const [rubric, setRubric] = useState<InterviewRubric | null>(null);
  const [metrics, setMetrics] = useState<InterviewMetrics | null>(null);

  // ── Refs for audio + STT lifecycle ────────────────────────────────────
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // Object URL of the current TTS clip. Kept alive until the NEXT clip
  // loads so the tap-to-play fallback can replay it after an autoplay
  // block; revoking on 'ended' would break that replay.
  const ttsUrlRef = useRef<string | null>(null);
  // True when the browser refused audio.play() (autoplay policy). The
  // UI shows a "Play question" button that satisfies the user-gesture
  // requirement; once one gesture-driven play succeeds, the SAME element
  // is reused for all later clips so they play unblocked.
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  // What Whisper heard, surfaced during "deciding" so the user can see
  // their words landed instead of wondering whether the mic worked.
  const [lastHeard, setLastHeard] = useState<string>("");
  // Seconds of recording in the current listening turn (UI only).
  const [listenElapsedSec, setListenElapsedSec] = useState(0);
  const turnStartRef = useRef<number>(0);
  const silenceTimerRef = useRef<number | null>(null);
  const adaptiveSilenceMsRef = useRef<number>(SILENCE_MS_DEFAULT);
  // Prevents finishUserTurn from running twice concurrently. Without
  // this, a VAD-triggered auto-finish + a manual "I'm done" click can
  // both call finishUserTurn at the same time, double-fire /stt + /turn,
  // duplicate transcript entries, and race state setters into a stuck
  // "deciding" sub-state.
  const finishingRef = useRef<boolean>(false);

  // Whisper-based STT. We hold one mic stream, one MediaRecorder, and
  // one Web Audio analyser per turn so the recorder's chunks and the
  // VAD's RMS readings come from the same audio source. The stream is
  // torn down explicitly on stop - Chrome won't release the mic
  // indicator until every track is .stop()ed.
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordMediaRef = useRef<MediaRecorder | null>(null);
  // The browser's free speech engine, running alongside the recorder.
  // Whichever produces text first wins; the recording is the fallback.
  const browserSpeechRef = useRef<BrowserSpeechHandle | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const vadCtxRef = useRef<AudioContext | null>(null);
  const vadRafRef = useRef<number>(0);
  const vadHasSpokenRef = useRef<boolean>(false);
  // Resolves with the recorded Blob once the recorder has flushed.
  const recordStopResolverRef = useRef<((blob: Blob | null) => void) | null>(null);

  // Synthesized breathing animation for the orb. We deliberately do NOT
  // open a second mic stream alongside SpeechRecognition: that doubled
  // both the perf cost (60fps React re-renders driven by the analyser)
  // and the failure surface (Chrome occasionally refused the second
  // getUserMedia and silently broke STT). The orb still feels alive
  // because the curve speeds up while listening, and the CSS transitions
  // smooth out the gaps between updates.
  //
  // Updates are throttled to ~10fps via setInterval. The orb's inline
  // `transition: transform 90ms` interpolates between ticks, so the
  // visual is still smooth at this rate but React re-renders 6x less.
  const [audioLevel, setAudioLevel] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      const t = (Date.now() - start) / 1000;
      const speed = sub === "speaking" ? 3.0 : sub === "listening" ? 2.2 : 1.5;
      const amp   = sub === "speaking" ? 35  : sub === "listening" ? 28  : 18;
      setAudioLevel((amp * (Math.sin(t * speed) + 1)) / 2);
    }, 100);
    return () => window.clearInterval(id);
  }, [sub]);

  // Cleanup on unmount.
  useEffect(() => () => stopAllAudio(), []);

  // Elapsed-seconds counter for the "deciding" phase so the user
  // sees something change every second instead of staring at a
  // static label and wondering if it's frozen.
  useEffect(() => {
    if (sub !== "deciding") {
      if (decidingElapsedSec !== 0) setDecidingElapsedSec(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      setDecidingElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);

  // Recording timer while listening: "0:07" ticking next to the status
  // label proves the mic turn is live.
  useEffect(() => {
    if (sub !== "listening") {
      if (listenElapsedSec !== 0) setListenElapsedSec(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      setListenElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);

  // ── Browser support check ─────────────────────────────────────────────
  // We need MediaRecorder + getUserMedia. Both are available in every
  // modern desktop browser (Chrome, Firefox, Edge, Safari 14.1+).
  const recorderSupported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof (window as any).MediaRecorder !== "undefined";

  // Auto-skip path: if a tracked job was preselected, kick the mic-check
  // setup on mount so the meter is already live by the time the user
  // looks at the screen. Without this, we'd render an empty mic_check
  // panel because startMicCheck() normally fires from the launcher's
  // "Continue" button. The user gesture from clicking "Practice for
  // this role" carries through to satisfy getUserMedia's gesture rule.
  useEffect(() => {
    if (autoSkipLauncher) startMicCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Phase transitions ─────────────────────────────────────────────────
  async function startMicCheck() {
    setError("");
    if (!recorderSupported) {
      setError("Your browser doesn't support MediaRecorder. Try Chrome, Edge, Firefox, or Safari 14.1+.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micCheckStreamRef.current = stream;
      // Audio level meter
      audioCtxRef.current = new AudioContext();
      const src = audioCtxRef.current.createMediaStreamSource(stream);
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
        setMicLevel(Math.min(100, peak));
        audioLevelRafRef.current = requestAnimationFrame(tick);
      };
      tick();
      setPhase("mic_check");
      // No STT smoke test here anymore - the live phase uses Whisper,
      // which requires uploading the audio to transcribe. Doing that
      // for every "one two three" mic check would be wasteful. The
      // audio meter is enough to confirm the mic is wired up.
    } catch (err: any) {
      setError(err?.message || "Microphone permission denied.");
    }
  }

  function stopMicCheck() {
    if (audioLevelRafRef.current) { cancelAnimationFrame(audioLevelRafRef.current); audioLevelRafRef.current = 0; }
    try { audioCtxRef.current?.close(); } catch { /* noop */ }
    audioCtxRef.current = null;
    // Releasing the underlying tracks is what frees the mic for the
    // live recorder that runs next. Closing the AudioContext alone
    // leaves the tracks live and the OS mic indicator on.
    try { micCheckStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    micCheckStreamRef.current = null;
    setMicLevel(0);
  }

  /**
   * Unlock audio playback inside a real user gesture. Browsers block
   * audio.play() calls that happen outside a click (autoplay policy),
   * and our first TTS clip plays 5-15s AFTER the "Start interview"
   * click (question generation takes that long), far past the gesture
   * window. Playing a silent clip NOW, synchronously in the click
   * handler, marks this <audio> element as user-activated; we then
   * reuse the SAME element for every TTS clip, which browsers allow.
   * This was the root cause of "the interviewer never speaks": every
   * play() was rejected and the rejection was silently swallowed.
   */
  const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
  function unlockAudio() {
    if (!audioElRef.current) audioElRef.current = new Audio();
    const a = audioElRef.current;
    a.src = SILENT_WAV;
    a.play().catch(() => { /* even if this is blocked, the tap-to-play fallback covers us */ });
  }

  async function beginSession() {
    unlockAudio();
    stopMicCheck();
    setPhase("starting");
    setError("");
    try {
      const resp = await interviewStart({
        jobId: useManual ? undefined : (pickedJobId ?? undefined),
        manualJd: useManual ? manualJd : undefined,
        manualResumeText: useManual ? manualResume : undefined,
        fineTuneFocus: fineTune || undefined,
        mode,
        difficulty,
      });
      sessionIdRef.current = resp.sessionId;
      questionsRef.current = resp.questions;
      followUpDepthRef.current = 0;
      setSessionId(resp.sessionId);
      setQuestions(resp.questions);
      setQIdx(0);
      setFollowUpDepth(0);
      transcriptRef.current = [];
      setTranscript([]);
      setPhase("running");
      // Kick off the first question.
      setTimeout(() => askQuestion(resp.questions[0].question, 0), 200);
    } catch (err: any) {
      setError(err?.message || "Could not start session.");
      setPhase("error");
    }
  }

  // ── TTS playback ──────────────────────────────────────────────────────
  // Reuses ONE persistent <audio> element (unlocked in beginSession's
  // click) instead of a fresh element per clip. A fresh element has no
  // user-activation, so browsers block its play() and the interviewer
  // goes silent. If play() is still rejected, we surface a "Play
  // question" button (a real gesture) instead of swallowing the error.
  async function speak(text: string): Promise<void> {
    setSub("speaking");
    if (!audioElRef.current) audioElRef.current = new Audio();
    const audio = audioElRef.current;
    try { audio.pause(); } catch { /* noop */ }
    // Previous clip's object URL can be released now that a new clip
    // is replacing it.
    if (ttsUrlRef.current) { URL.revokeObjectURL(ttsUrlRef.current); ttsUrlRef.current = null; }
    try {
      const blob = await interviewTtsBlob(text, sessionIdRef.current ?? undefined);
      const url = URL.createObjectURL(blob);
      ttsUrlRef.current = url;
      audio.src = url;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => { if (!settled) { settled = true; clearTimeout(guard); resolve(); } };
        // A stalled stream can leave `onended` unfired forever, which
        // would freeze the question before listening ever starts. No
        // spoken question runs past two minutes, so this only fires
        // when something has gone wrong.
        const guard = setTimeout(finish, 120_000);
        audio.onended = finish;
        audio.onerror = finish;
        audio.play().then(() => {
          setVoiceBlocked(false);
        }).catch(() => {
          // Autoplay blocked. Show the tap-to-play fallback and move on
          // so the turn isn't stranded; the question text is on screen.
          setVoiceBlocked(true);
          finish();
        });
      });
    } catch {
      // TTS failed; render the question on screen and let user read it.
    }
  }

  /** Gesture-driven replay for the autoplay-blocked case. One successful
   *  play from a real tap unlocks the element for all later clips. */
  function tapToPlay() {
    const a = audioElRef.current;
    if (!a || !a.src) return;
    a.currentTime = 0;
    a.play().then(() => setVoiceBlocked(false)).catch(() => { /* still blocked; button stays */ });
  }

  async function askQuestion(text: string, qIdxToAsk: number) {
    setPendingPrompt(text);
    setListenWarning("");
    setLastHeard("");
    pushTranscript({ qIdx: qIdxToAsk, role: "ai", text, t_start: Date.now(), t_end: Date.now() });
    await speak(text);
    await startListening(qIdxToAsk);
  }

  // ── STT listening (MediaRecorder → Whisper) ───────────────────────────
  //
  // For each user turn:
  //   1. Acquire a mic stream + start a MediaRecorder on it.
  //   2. Run a Web Audio analyser on the SAME stream to drive a
  //      simple voice-activity detector (silence-after-speech →
  //      auto-stop). The user can also click "I'm done" to stop early.
  //   3. On stop, await the recorder's final chunk, build a Blob,
  //      POST it to /api/interview/stt for Whisper transcription.
  //   4. Continue with the existing /turn decide step using the
  //      transcribed text as the user's answer.
  async function startListening(qIdxFor: number) {
    setSub("listening");
    setInterim("");
    setListenWarning("");
    setTypedAnswer("");
    turnStartRef.current = Date.now();
    adaptiveSilenceMsRef.current = SILENCE_MS_DEFAULT;
    recordChunksRef.current = [];
    vadHasSpokenRef.current = false;

    if (!recorderSupported) {
      setListenWarning("Your browser doesn't support audio recording. Type your answer below and click I'm done.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      const msg = err?.name === "NotAllowedError"
        ? "Microphone permission was blocked. Allow mic access in your browser site settings, or type your answer below."
        : "Couldn't access the microphone. Close any other app holding it (Zoom, Meet, OBS) or type your answer below.";
      setListenWarning(msg);
      return;
    }
    recordStreamRef.current = stream;

    // MediaRecorder. Pick the best mime the browser supports; Chrome
    // gives audio/webm;codecs=opus, Safari gives audio/mp4. Whisper
    // accepts both.
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
      "",
    ];
    let chosenMime = "";
    for (const m of candidates) {
      if (m === "" || (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(m))) {
        chosenMime = m;
        break;
      }
    }
    let recorder: MediaRecorder;
    try {
      recorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime })
        : new MediaRecorder(stream);
    } catch (err: any) {
      setListenWarning("Couldn't start the recorder. Type your answer below and click I'm done.");
      stream.getTracks().forEach((t) => t.stop());
      recordStreamRef.current = null;
      return;
    }
    recordMediaRef.current = recorder;

    // Start the free engine in parallel. It shares the mic permission
    // already granted, costs nothing, and gives live interim text. If
    // it is missing or fails, the recording above still goes to Whisper.
    try {
      browserSpeechRef.current = startBrowserSpeech((text) => setInterim(text));
    } catch {
      browserSpeechRef.current = null;
    }

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) recordChunksRef.current.push(ev.data);
    };
    recorder.onstop = () => {
      const type = chosenMime || recordChunksRef.current[0]?.type || "audio/webm";
      const blob = recordChunksRef.current.length > 0
        ? new Blob(recordChunksRef.current, { type })
        : null;
      const resolve = recordStopResolverRef.current;
      recordStopResolverRef.current = null;
      if (resolve) resolve(blob);
    };
    recorder.onerror = (ev: any) => {
      console.warn("MediaRecorder error:", ev?.error || ev);
      // Fall through - the stop handler will resolve with whatever
      // chunks we collected so far.
    };
    // Tick chunks every 250ms so we have data even if the user
    // disconnects abruptly (closes tab, kills mic mid-turn).
    recorder.start(250);

    // Hard failsafe: if the VAD never fires (very quiet mic that stays
    // under the speech threshold, or an AudioContext quirk), auto-finish
    // the turn after 90s so the session can never silently stall on one
    // question. Cleared by stopRecog().
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = window.setTimeout(() => {
      if (recordMediaRef.current?.state === "recording") finishUserTurn(qIdxFor);
    }, 90_000);

    // Web Audio analyser drives the VAD. We share the stream with
    // MediaRecorder - both consumers can read the same MediaStream.
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      // No AudioContext available - fall back to a simple max-duration
      // timer (60s) since we can't detect silence. User can still hit
      // I'm done manually.
      window.setTimeout(() => {
        if (recordMediaRef.current?.state === "recording") finishUserTurn(qIdxFor);
      }, 60_000);
      return;
    }
    vadCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    // VAD parameters. Tuned by hand against my own voice + ambient
    // room noise; tweak SPEECH_RMS if false-triggering on background.
    const SPEECH_RMS = 0.025;
    let silenceStart = 0;
    let lastUiUpdate = 0;

    const tick = () => {
      const recState = recordMediaRef.current?.state;
      if (recState !== "recording") {
        // Recorder stopped (manual click or auto-finish); halt VAD.
        return;
      }
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = Date.now();

      if (rms > SPEECH_RMS) {
        if (!vadHasSpokenRef.current) vadHasSpokenRef.current = true;
        silenceStart = 0;
        // Soft "live captioning" - show a recording indicator that
        // wiggles with the level so the user knows they're being heard.
        if (now - lastUiUpdate > 200) {
          setInterim("Listening...");
          lastUiUpdate = now;
        }
      } else if (vadHasSpokenRef.current) {
        // Started silence after speech. Auto-finish if it persists.
        if (silenceStart === 0) silenceStart = now;
        if (now - silenceStart > adaptiveSilenceMsRef.current) {
          finishUserTurn(qIdxFor);
          return;
        }
      }
      vadRafRef.current = requestAnimationFrame(tick);
    };
    vadRafRef.current = requestAnimationFrame(tick);
  }

  function clickDone() {
    if (sub === "speaking" || sub === "deciding") return;
    finishUserTurn(qIdx);
  }

  function stopRecog() {
    // Halt VAD + recorder. The recorder's onstop callback resolves
    // any in-flight `stopAndAwaitBlob` promise so finishUserTurn can
    // assemble the audio blob.
    if (vadRafRef.current) cancelAnimationFrame(vadRafRef.current);
    vadRafRef.current = 0;
    try { vadCtxRef.current?.close(); } catch { /* noop */ }
    vadCtxRef.current = null;
    if (silenceTimerRef.current) { window.clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    const rec = recordMediaRef.current;
    if (rec && rec.state === "recording") {
      try { rec.stop(); } catch { /* noop */ }
    }
    // Release the mic tracks. Must happen AFTER recorder.stop() so the
    // final dataavailable chunk lands.
    setTimeout(() => {
      try { recordStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      recordStreamRef.current = null;
    }, 50);
  }

  function stopAllAudio() {
    stopRecog();
    try { audioElRef.current?.pause(); } catch { /* noop */ }
    if (ttsUrlRef.current) { URL.revokeObjectURL(ttsUrlRef.current); ttsUrlRef.current = null; }
    stopMicCheck();
  }

  /** Wait up to `timeoutMs` for the recorder's final blob. Resolves
   *  null if no audio was captured. */
  function awaitFinalBlob(timeoutMs = 1500): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = recordMediaRef.current;
      if (!rec) { resolve(null); return; }
      // If recorder is already inactive AND chunks are present, build
      // the blob synchronously. Otherwise stop() will fire onstop.
      if (rec.state === "inactive") {
        const type = recordChunksRef.current[0]?.type || "audio/webm";
        resolve(recordChunksRef.current.length > 0 ? new Blob(recordChunksRef.current, { type }) : null);
        return;
      }
      const t = window.setTimeout(() => {
        recordStopResolverRef.current = null;
        const type = recordChunksRef.current[0]?.type || "audio/webm";
        resolve(recordChunksRef.current.length > 0 ? new Blob(recordChunksRef.current, { type }) : null);
      }, timeoutMs);
      recordStopResolverRef.current = (blob) => {
        window.clearTimeout(t);
        resolve(blob);
      };
      try { rec.stop(); } catch { /* noop */ }
    });
  }

  async function finishUserTurn(qIdxFor: number) {
    // Re-entrancy guard. VAD silence detection and the manual "I'm done"
    // click both call this; a fast double-trigger would otherwise double-
    // fire /stt + /turn, push duplicate transcript rows, and race state.
    if (finishingRef.current) return;
    finishingRef.current = true;
    try {
      await runFinishUserTurn(qIdxFor);
    } finally {
      finishingRef.current = false;
    }
  }

  async function runFinishUserTurn(qIdxFor: number) {
    setSub("deciding");
    setInterim("");
    // Reflect what's actually happening so the user isn't staring at
    // a frozen "Considering your answer..." message for 8 seconds.
    setDecidingPhase("transcribing");
    if (vadRafRef.current) cancelAnimationFrame(vadRafRef.current);
    vadRafRef.current = 0;

    const t_start = turnStartRef.current;
    const t_end = Date.now();

    // Capture the audio first, then transcribe via Whisper. If the
    // user typed in the fallback box (mic blocked etc.), prefer that.
    const typed = typedAnswer.trim();
    let answer = "";
    if (typed) {
      answer = typed;
      stopRecog(); // we don't need the audio
    } else {
      const blob = await awaitFinalBlob();
      // Tear down the mic now that we've grabbed the audio.
      try { vadCtxRef.current?.close(); } catch { /* noop */ }
      vadCtxRef.current = null;
      try { recordStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      recordStreamRef.current = null;
      // Whisper hates clips under ~0.1s ("audio too short"). Skip the
      // round-trip when the user clearly didn't say anything.
      // The browser's own engine, if it managed to hear anything, is
      // free. Whisper costs $0.006/min and is most of what a session
      // costs, so it is the fallback rather than the default. The audio
      // was recorded either way, so falling back needs nothing from the
      // user.
      const speech = browserSpeechRef.current;
      browserSpeechRef.current = null;
      if (speech) {
        speech.stop();
        try {
          // Hard bound. This runs in the middle of answering a question,
          // so nothing here may block the turn: if the engine does not
          // report back in time we drop it and let Whisper do the work,
          // which is exactly what happens on a network that blocks it.
          const heard = await Promise.race([
            speech.done,
            new Promise<string>((r) => setTimeout(() => r(""), 2500)),
          ]);
          if (heard && heard.trim().length > 0) answer = heard.trim();
        } catch (err: any) {
          // Expected on corp networks, where Chrome cannot reach
          // Google's speech endpoint. Whisper picks it up below.
          console.info("Browser speech unavailable, using Whisper:", err?.message || err);
        }
      }

      if (!answer && blob && blob.size > 2000) {
        try {
          answer = (await interviewStt(blob, 25_000, {
            sessionId: sessionIdRef.current ?? undefined,
            seconds: (t_end - t_start) / 1000,
          })).trim();
        } catch (err: any) {
          // Surface the actual error so a hung /stt is visible. The
          // user sees the warning + the typed-answer fallback box.
          // We continue with empty answer so the flow doesn't dead-end.
          console.warn("Whisper transcription failed:", err?.message || err);
          setListenWarning(err?.message || "Couldn't transcribe your answer. Type it below and click I'm done.");
        }
      } else if (!answer && (!blob || blob.size === 0)) {
        console.warn("MediaRecorder produced no audio - recording may have failed silently.");
      }
    }

    pushTranscript({ qIdx: qIdxFor, role: "user", text: answer, t_start, t_end });
    setTypedAnswer("");
    // Echo what Whisper heard so the user trusts the pipeline. Shown
    // in the deciding state under the status label.
    if (answer) setLastHeard(answer);

    const sid = sessionIdRef.current;
    const qs = questionsRef.current;
    if (!sid || qs.length === 0) {
      // Was a silent `return` that left the orb on "Considering your
      // answer" with no way out. If it ever happens again it must be
      // visible, not a frozen screen.
      console.error("[interview] turn finished with no session in scope", { sid, questions: qs.length });
      setDecidingPhase(null);
      setError("The session lost track of itself. Please start a new round; this one does not count against your week.");
      setPhase("error");
      return;
    }

    // Fast path: if this was the last question, skip the /turn decide
    // call entirely. There's no follow-up vs next decision to make - 
    // we're heading to scoring no matter what /turn would say. Saves
    // a 2-5s OpenAI round-trip on the most painful step of the loop.
    const isLastQuestion = qIdxFor + 1 >= qs.length;
    if (isLastQuestion) {
      setDecidingPhase("scoring");
      await finishAndScore();
      setDecidingPhase(null);
      return;
    }

    try {
      setDecidingPhase("considering");
      // Hard timeout on /turn so a hanging OpenAI call can't strand
      // the user. After 12s of no response we just move on - better
      // a missed follow-up than a frozen modal.
      const decision = await raceWithTimeout(
        interviewTurn({ sessionId: sid, qIdx: qIdxFor, answer, followUpDepth: followUpDepthRef.current }),
        12_000,
        { action: "next" as const, followUpQuestion: undefined, ack: undefined },
        (reason, err) => {
          // Moving on is still the right recovery - a stalled decide step
          // must not strand the candidate mid-interview - but it is a
          // degraded turn, not a decision the interviewer made, so say so.
          const detail = reason === "timeout"
            ? "the decide step took longer than 12s"
            : ((err as any)?.message || "the decide step failed");
          console.error(`[interview] follow-up skipped: ${detail}`, err ?? "");
          setListenWarning(`Skipped the follow-up - ${detail}. Continuing with the next question.`);
        },
      );
      // The decider returns a short spoken reaction ("Nice - that's a
      // concrete example.") that we prepend to whatever comes next so
      // the exchange sounds like a conversation, not a question machine.
      const ack = (decision.ack || "").trim();
      const withAck = (q: string) => (ack ? `${ack} ${q}` : q);
      if (decision.action === "follow_up" && decision.followUpQuestion) {
        followUpDepthRef.current += 1;
        setFollowUpDepth((d) => d + 1);
        setDecidingPhase("next_question");
        await askQuestion(withAck(decision.followUpQuestion), qIdxFor);
        setDecidingPhase(null);
        return;
      }
      // Move to next question.
      const nextIdx = qIdxFor + 1;
      if (nextIdx >= qs.length) {
        setDecidingPhase("scoring");
        await finishAndScore();
        setDecidingPhase(null);
        return;
      }
      setQIdx(nextIdx);
      followUpDepthRef.current = 0;
      setFollowUpDepth(0);
      setDecidingPhase("next_question");
      await askQuestion(withAck(qs[nextIdx].question), nextIdx);
      setDecidingPhase(null);
    } catch (err: any) {
      setDecidingPhase(null);
      setError(err?.message || "Decide step failed.");
      setPhase("error");
    }
  }

  async function finishAndScore() {
    const sid = sessionIdRef.current;
    if (!sid) {
      setError("Session was lost before scoring could run. Please start a new practice round.");
      setPhase("error");
      return;
    }
    stopAllAudio();
    setPhase("scoring");

    // Read from the ref, NOT the transcript state. The ref is always
    // up-to-date - state may still be one render behind the latest
    // pushTranscript() call when finishAndScore is invoked from the
    // synchronous tail of finishUserTurn().
    const finalTranscript = transcriptRef.current;
    // Guard: scoring an empty transcript would 400 server-side and
    // leave the user staring at "Scoring..." until we error out.
    if (finalTranscript.length === 0 || !finalTranscript.some((t) => t.role === "user")) {
      setError("No answers were captured during the session. Try a new round and make sure your mic is working.");
      setPhase("error");
      return;
    }

    try {
      const res = await interviewScore({ sessionId: sid, transcript: finalTranscript });
      setReadiness(res.readiness_score);
      setRubric(res.rubric);
      setMetrics(res.metrics);
      setPhase("review");
    } catch (err: any) {
      // Don't strand the user on a "loading" screen if the score
      // endpoint blips. Surface a clear error and let them retry,
      // since the session row itself stays "active" until we mark
      // it completed (so a retry hits the same session).
      console.error("Score endpoint failed:", err);
      setError(err?.message || "Scoring failed. Click Retry to try again, or close to abandon the session.");
      setPhase("error");
    }
  }

  async function abandon() {
    const sidToAbandon = sessionIdRef.current;
    if (sidToAbandon) { try { await interviewAbandon(sidToAbandon); } catch { /* noop */ } }
    stopAllAudio();
    onClose();
  }


  /** Parse a dropped or chosen resume into text. Mirrors the tailor. */
  async function parseResumeFile(file: File) {
    setError("");
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "docx") {
      setError("Upload a PDF or DOCX resume.");
      return;
    }
    setParsingResume(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch(ext === "pdf" ? "/api/parse-pdf" : "/api/parse-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64 }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not read that file.");
      }
      const data = await res.json();
      if (!data.text || data.text.trim().length < 30) {
        throw new Error("Could not pull enough text out of that file. Try a different format.");
      }
      setManualResume(data.text);
      setResumeFileName(file.name);
    } catch (err: any) {
      setError(err?.message || "Could not read that file.");
    } finally {
      setParsingResume(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) phase === "review" || phase === "launcher" || phase === "error" ? onClose() : null; }}>
      <div
        style={{
          ...panel,
          // During the live voice loop, the panel becomes dark so the
          // reactive orb's gradient fills the whole modal seamlessly.
          background: "#06070a",
          color: "#e8eaed",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            ...header,
            // Hide header chrome during running so the orb composition
            // stays uncluttered. We keep just an absolute-positioned
            // close button inside runningWrap via the End session link.
            display: phase === "running" ? "none" : "flex",
            background: phase === "scoring" ? "transparent" : undefined,
            borderBottomColor: phase === "scoring" ? "rgba(255,255,255,0.08)" : undefined,
            color: "#e8eaed",
          }}
        >
          <div>
            <div style={{ ...brand, display: "flex", alignItems: "center", gap: 8 }}>
              Interview Practice
              <span style={betaBadge}>BETA</span>
            </div>
            {(initialJobTitle || pickedJobId) && phase === "launcher" && (
              <div style={muted}>{initialJobTitle} {initialCompanyName ? "at " + initialCompanyName : ""}</div>
            )}
          </div>
          <button
            onClick={() => phase === "running" ? abandon() : onClose()}
            style={{
              ...closeBtn,
              color: "#8b8fa3",
            }}
            aria-label="Close"
          >
            x
          </button>
        </div>

        {/* Phase: launcher */}
        {phase === "launcher" && (
          <div style={body}>
            <Section title="Mode">
              <div style={{ display: "flex", gap: 10 }}>
                <ChoiceCard
                  label="Behavioral"
                  desc="STAR-format questions on past experience, conflict, leadership"
                  active={mode === "behavioral"}
                  onClick={() => setMode("behavioral")}
                />
                <ChoiceCard
                  label="Technical"
                  desc="Concept and verbal-system-design; you explain, no whiteboard"
                  active={mode === "technical"}
                  onClick={() => setMode("technical")}
                />
              </div>
            </Section>

            <Section title="Difficulty" help="Easy = warm-up screening tone. Medium = realistic mid-round bar. Hard = senior-level, follow-up heavy.">
              <div style={{ display: "flex", gap: 10 }}>
                <ChoiceCard
                  label="Easy"
                  desc="Friendly opener questions, shallow follow-ups"
                  active={difficulty === "easy"}
                  onClick={() => setDifficulty("easy")}
                />
                <ChoiceCard
                  label="Medium"
                  desc="Realistic interview bar, balanced rigour"
                  active={difficulty === "medium"}
                  onClick={() => setDifficulty("medium")}
                />
                <ChoiceCard
                  label="Hard"
                  desc="Senior bar, sharp follow-ups, edge cases"
                  active={difficulty === "hard"}
                  onClick={() => setDifficulty("hard")}
                />
              </div>
            </Section>

            <Section title="Source">
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <SmallToggle label="Tracked job" active={!useManual} onClick={() => setUseManual(false)} />
                <SmallToggle label="Manual JD + resume" active={useManual} onClick={() => setUseManual(true)} />
              </div>

              {!useManual ? (
                <select value={pickedJobId ?? ""} onChange={(e) => setPickedJobId(e.target.value ? parseInt(e.target.value, 10) : null)} style={input}>
                  <option value="">Pick a job from your tracker...</option>
                  {jobOptions.map((j) => (
                    <option key={j.id} value={j.id}>{j.job_title} at {j.company_name}</option>
                  ))}
                </select>
              ) : (
                <>
                  <label style={lblWrap}>
                    <div style={fieldName}>Job description</div>
                    <textarea value={manualJd} onChange={(e) => setManualJd(e.target.value)} style={textarea} placeholder="Paste the JD here..." />
                  </label>
                  <label style={lblWrap}>
                    <div style={fieldName}>Your resume (optional - uses your stored resume if blank)</div>
                    <div
                      onDragOver={(e) => { e.preventDefault(); setResumeDragOver(true); }}
                      onDragLeave={() => setResumeDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setResumeDragOver(false);
                        const f = e.dataTransfer.files?.[0];
                        if (f) parseResumeFile(f);
                      }}
                      onClick={() => resumeFileRef.current?.click()}
                      style={{
                        border: `1px dashed ${resumeDragOver ? "#f97316" : "rgba(255,255,255,0.18)"}`,
                        background: resumeDragOver ? "rgba(249,115,22,0.10)" : "#0c0e14",
                        borderRadius: 10,
                        padding: "18px 14px",
                        textAlign: "center",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        ref={resumeFileRef}
                        type="file"
                        accept=".pdf,.docx"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) parseResumeFile(f);
                          if (resumeFileRef.current) resumeFileRef.current.value = "";
                        }}
                      />
                      {parsingResume ? (
                        <div style={{ fontSize: 13, color: "#8b8fa3" }}>Reading your resume...</div>
                      ) : resumeFileName ? (
                        <div>
                          <div style={{ fontSize: 13, color: "#5cc46a", fontWeight: 600 }}>{resumeFileName}</div>
                          <div style={{ fontSize: 11, color: "#8b8fa3", marginTop: 3 }}>
                            Loaded. Click to replace.
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize: 13, color: "#e8eaed" }}>Drop your resume here, or click to choose</div>
                          <div style={{ fontSize: 11, color: "#8b8fa3", marginTop: 3 }}>PDF or DOCX</div>
                        </div>
                      )}
                    </div>
                    {manualResume && !resumeFileName && (
                      <textarea
                        value={manualResume}
                        onChange={(e) => setManualResume(e.target.value)}
                        style={{ ...textarea, marginTop: 8 }}
                        placeholder="Or paste resume text here..."
                      />
                    )}
                    {!manualResume && (
                      <button
                        type="button"
                        onClick={() => setManualResume(" ")}
                        style={{ background: "none", border: 0, color: "#8b8fa3", fontSize: 11, cursor: "pointer", marginTop: 6, padding: 0, textAlign: "left" }}
                      >
                        or paste the text instead
                      </button>
                    )}
                  </label>
                </>
              )}
            </Section>

            <div style={{
              marginBottom: 14,
              padding: "12px 14px",
              borderRadius: 10,
              background: "rgba(249,115,22,0.10)",
              border: "1px solid rgba(249,115,22,0.30)",
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#f97316", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 5 }}>
                One practice interview a week
              </div>
              <div style={{ fontSize: 12.5, color: "#e8eaed", lineHeight: 1.55 }}>
                This is free, and you get one round a week, so treat it like the real thing:
                somewhere quiet, headphones on, about 10 minutes. Five questions with follow-ups,
                then a written score.
              </div>
              <div style={{ fontSize: 11.5, color: "#8b8fa3", marginTop: 6, lineHeight: 1.5 }}>
                It only counts once you have answered a couple of questions, so backing out early
                costs you nothing. If a reply is slow, wait rather than closing: your answers are
                saved as you go.
              </div>
            </div>

            <Section title="Fine-tune (optional)" help="One sentence telling the interviewer what to focus on, e.g. 'I'm rusty on system design questions; lean into those'.">
              <textarea value={fineTune} onChange={(e) => setFineTune(e.target.value)} style={textarea} placeholder="What should the interviewer focus on?" />
            </Section>

            {error && <div style={errorBox}>{error}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={onClose} style={secondaryBtn}>Cancel</button>
              <button
                onClick={startMicCheck}
                disabled={!useManual && !pickedJobId}
                style={{ ...primaryBtn, opacity: (!useManual && !pickedJobId) ? 0.5 : 1 }}
              >
                Continue to mic check
              </button>
            </div>
          </div>
        )}

        {/* Phase: mic check */}
        {phase === "mic_check" && (
          <div style={body}>
            {autoSkipLauncher && initialJobTitle && (
              <div style={autoPickBox}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#5cc46a", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 4 }}>
                  Auto-picked
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#e8eaed" }}>
                  {initialJobTitle}{initialCompanyName ? ` at ${initialCompanyName}` : ""}
                </div>
                <div style={{ fontSize: 12, color: "#8b8fa3", marginTop: 4 }}>
                  Using this job's description and your uploaded resume.
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "#8b8fa3" }}>Mode:</span>
                  <SmallToggle label="Behavioral" active={mode === "behavioral"} onClick={() => setMode("behavioral")} />
                  <SmallToggle label="Technical" active={mode === "technical"} onClick={() => setMode("technical")} />
                  <span style={{ fontSize: 11, color: "#8b8fa3", marginLeft: 8 }}>Difficulty:</span>
                  <SmallToggle label="Easy" active={difficulty === "easy"} onClick={() => setDifficulty("easy")} />
                  <SmallToggle label="Medium" active={difficulty === "medium"} onClick={() => setDifficulty("medium")} />
                  <SmallToggle label="Hard" active={difficulty === "hard"} onClick={() => setDifficulty("hard")} />
                </div>
              </div>
            )}
            <h3 style={{ margin: "0 0 6px 0" }}>Mic check</h3>
            <p style={muted}>Say "one, two, three" and confirm the meter moves. This catches bad mic situations before you invest 15 minutes.</p>
            <div style={meterWrap}>
              <div style={{ ...meterBar, width: `${micLevel}%`, background: micLevel > 30 ? "#2e7d32" : micLevel > 10 ? "#ff9800" : "#c62828" }} />
            </div>
            <div style={{ marginTop: 12, padding: 10, background: "#12151c", borderRadius: 8, fontFamily: "monospace", fontSize: 12, color: "#8b8fa3" }}>
              {micLevel > 30
                ? "Mic looks great - go for it."
                : micLevel > 10
                ? "Mic working. Speak a bit louder if you can."
                : "Speak now to test. If the bar stays flat, check your input device or browser permissions."}
            </div>
            {error && <div style={errorBox}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
              {/* When auto-skipping, "Back" lands the user on the launcher
                  so they can override the auto-picked source if they
                  really want to (e.g. paste a different JD). */}
              <button onClick={() => { stopMicCheck(); setPhase("launcher"); }} style={secondaryBtn}>
                {autoSkipLauncher ? "More options" : "Back"}
              </button>
              <button onClick={beginSession} style={primaryBtn}>Start interview</button>
            </div>
          </div>
        )}

        {/* Phase: starting */}
        {phase === "starting" && (
          <div style={{ ...body, textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 14, color: "#8b8fa3" }}>Generating questions tailored to your role...</div>
          </div>
        )}

        {/* Phase: running - reactive voice interface
            Dark gradient takeover; the orb sits in the middle and pulses
            with audio. Mode color flips based on who's speaking:
              speaking (AI)     - warm orange
              listening (user)  - cool green
              deciding          - cool violet (the model is thinking) */}
        {phase === "running" && (
          <div style={runningWrap}>
            <style>{orbKeyframes}</style>

            <div style={runningStatusRow}>
              <span>Q {qIdx + 1} of {questions.length}{followUpDepth > 0 ? ` - follow-up ${followUpDepth}` : ""}</span>
              <span style={{ opacity: 0.7 }}>
                {statusLabel(sub, decidingPhase)}
                {sub === "listening" ? ` · ${fmtSecs(listenElapsedSec)}` : ""}
                {sub === "deciding" && decidingElapsedSec > 1 ? ` · ${decidingElapsedSec}s` : ""}
              </span>
            </div>

            <div style={runningPrompt}>{pendingPrompt}</div>

            {/* Autoplay-blocked fallback: the browser refused to play the
                interviewer's voice without a fresh tap. One tap here
                unlocks the shared audio element for the whole session. */}
            {voiceBlocked && (
              <button onClick={tapToPlay} style={playQuestionBtn}>
                🔊 Tap to hear the question
              </button>
            )}

            {listenWarning ? (
              // Typing fallback layout. STT errored out (network or
              // permission), so we hide the orb to free vertical space
              // and give the textarea + warning the room they need.
              // Otherwise the orb's minHeight: 280 collides with the
              // textarea and pushes the controls off the modal.
              <div style={fallbackStage}>
                <div style={runningWarning}>{listenWarning}</div>
                <textarea
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  placeholder="Type your answer here..."
                  style={runningFallbackInput}
                  autoFocus
                />
              </div>
            ) : (
              <>
                <div style={orbStage}>
                  <ReactiveOrb mode={subToOrbMode(sub)} audioLevel={audioLevel} />
                </div>

                <div style={runningTranscript}>
                  <div style={{ ...runningTranscriptText, color: interim ? "#fff" : "rgba(255,255,255,0.4)" }}>
                    {interim || statusHelper(sub, decidingPhase)}
                    {sub === "deciding" && lastHeard && (
                      <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.65)", fontStyle: "italic" }}>
                        You said: "{lastHeard.length > 180 ? lastHeard.slice(0, 180) + "..." : lastHeard}"
                      </div>
                    )}
                    {sub === "deciding" && decidingElapsedSec >= 12 && (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#ffd1c2" }}>
                        Still thinking. Your answer is saved, so please keep this window open.
                        It picks up on its own.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            <div style={runningControls}>
              <button onClick={abandon} style={runningEndBtn}>End session</button>
              {(() => {
                const hasTyped = typedAnswer.trim().length > 0;
                // Enabled in listening, OR whenever the user has typed
                // something into the fallback box (covers the case where
                // STT errored out and the user is past "listening" sub).
                const enabled = sub === "listening" || hasTyped;
                return (
                  <button
                    onClick={clickDone}
                    disabled={!enabled}
                    style={{
                      ...runningDoneBtn,
                      background: enabled ? "#fff" : "rgba(255,255,255,0.18)",
                      color: enabled ? "#1a1a1a" : "rgba(255,255,255,0.5)",
                      cursor: enabled ? "pointer" : "not-allowed",
                    }}
                  >
                    I'm done
                  </button>
                );
              })()}
            </div>
          </div>
        )}

        {/* Phase: scoring */}
        {phase === "scoring" && (
          <div style={{ ...body, textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 14, color: "#8b8fa3" }}>Scoring your responses...</div>
          </div>
        )}

        {/* Phase: review */}
        {phase === "review" && rubric && metrics && (
          <div style={body}>
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
              <div style={{
                width: 72, height: 72, borderRadius: "50%",
                background: readinessColor(readiness),
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, fontWeight: 800,
              }}>{readiness ?? "-"}</div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>Readiness score</div>
                <div style={muted}>Based on {metrics.turn_count} answers, {Math.round(metrics.total_seconds)}s of speech, {metrics.wpm} wpm.</div>
              </div>
            </div>

            <Section title="Dimensions">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {Object.entries(rubric.dimensions || {}).map(([k, v]) => (
                  <div key={k} style={dimCell}>
                    <div style={{ fontSize: 11, color: "#8b8fa3", textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: scoreColor(Number(v)) }}>{v}</div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Speech metrics">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
                <Metric label="Words/minute" value={metrics.wpm} />
                <Metric label="Filler words" value={`${metrics.filler_count} (${metrics.filler_per_100w}/100w)`} />
                <Metric label="Hedging phrases" value={metrics.hedging_count} />
                <Metric label="Self-corrections" value={metrics.self_correct_count} />
                <Metric label="Total speech" value={`${Math.round(metrics.total_seconds)}s`} />
                <Metric label="Total words" value={metrics.total_words} />
              </div>
            </Section>

            {(rubric.weak_areas_to_prep && rubric.weak_areas_to_prep.length > 0) && (
              <Section title="What to prep before the real interview">
                <ul style={{ marginTop: 4, paddingLeft: 18 }}>
                  {rubric.weak_areas_to_prep.map((w, i) => <li key={i} style={{ marginBottom: 4, fontSize: 13 }}>{w}</li>)}
                </ul>
              </Section>
            )}

            {(rubric.stories_used && rubric.stories_used.length > 0) && (
              <Section title="Stories you used">
                <div style={{ fontSize: 12, color: "#8b8fa3" }}>{rubric.stories_used.join(", ")}</div>
              </Section>
            )}

            {(rubric.by_question && rubric.by_question.length > 0) && (
              <Section title="Per-question feedback">
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto" }}>
                  {rubric.by_question.map((q) => (
                    <div key={q.q_idx} style={qCard}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>Q{q.q_idx + 1}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: scoreColor(q.score) }}>{q.score}</div>
                      </div>
                      <div style={{ fontSize: 12, color: "#8b8fa3" }}>{questions[q.q_idx]?.question || ""}</div>
                      {q.pull_quote && <div style={{ fontSize: 11, color: "#8b8fa3", marginTop: 4, fontStyle: "italic" }}>"{q.pull_quote}"</div>}
                      {q.gaps?.length > 0 && (
                        <div style={{ fontSize: 11, color: "#ef6b6b", marginTop: 4 }}>
                          Gaps: {q.gaps.join("; ")}
                        </div>
                      )}
                      {q.model_answer && (
                        <div style={{ fontSize: 11, color: "#5cc46a", marginTop: 6, padding: "6px 8px", background: "rgba(46,125,50,0.14)", borderRadius: 6, border: "1px solid rgba(46,125,50,0.35)" }}>
                          <span style={{ fontWeight: 700 }}>Stronger answer: </span>{q.model_answer}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={onClose} style={primaryBtn}>Close</button>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div style={body}>
            <div style={errorBox}>{error}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={onClose} style={secondaryBtn}>Close</button>
              {/* Retry only makes sense when we have audio captured
                  (sessionId set + transcript with at least one user
                  turn). If scoring blipped, this kicks /score again. */}
              {sessionId && transcriptRef.current.some((t) => t.role === "user") && (
                <button onClick={finishAndScore} style={primaryBtn}>Retry scoring</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reusable bits ─────────────────────────────────────────────────────────
function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {help && <div style={{ fontSize: 11, color: "#8b8fa3", marginBottom: 8 }}>{help}</div>}
      {children}
    </div>
  );
}

function ChoiceCard({ label, desc, active, onClick }: { label: string; desc: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: 12, borderRadius: 10,
      border: active ? "2px solid #ff5722" : "1px solid rgba(255,255,255,0.12)",
      background: active ? "rgba(249,115,22,0.12)" : "#0c0e14",
      cursor: "pointer", textAlign: "left",
    }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: "#8b8fa3" }}>{desc}</div>
    </button>
  );
}

function SmallToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 12px", borderRadius: 16, border: 0, fontSize: 12, fontWeight: 600,
      background: active ? "#f97316" : "#12151c", color: active ? "#06070a" : "#8b8fa3", cursor: "pointer",
    }}>{label}</button>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={dimCell}>
      <div style={{ fontSize: 11, color: "#8b8fa3" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function readinessColor(n: number | null): string {
  if (n == null) return "#8b8fa3";
  if (n >= 80) return "#2e7d32";
  if (n >= 60) return "#ff9800";
  return "#c62828";
}
function scoreColor(n: number): string {
  if (n >= 80) return "#2e7d32";
  if (n >= 60) return "#ff9800";
  return "#c62828";
}

// ── Inline styles ─────────────────────────────────────────────────────────
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
};
const panel: React.CSSProperties = {
  background: "#0c0e14", borderRadius: 14, width: "min(720px, 100%)",
  maxHeight: "92vh", display: "flex", flexDirection: "column",
  boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
};
const header: React.CSSProperties = {
  padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)",
  display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
};
const body: React.CSSProperties = { padding: 20, overflowY: "auto" };
const brand: React.CSSProperties = { fontSize: 18, fontWeight: 700 };
const muted: React.CSSProperties = { color: "#8b8fa3", fontSize: 12, marginTop: 2 };
const betaBadge: React.CSSProperties = {
  fontSize: 9, fontWeight: 800, letterSpacing: "0.08em",
  padding: "2px 6px", borderRadius: 4,
  background: "rgba(255, 152, 0, 0.15)", color: "#e6982a",
  border: "1px solid rgba(255, 152, 0, 0.35)",
};
const closeBtn: React.CSSProperties = { background: "transparent", border: 0, fontSize: 20, cursor: "pointer", color: "#8b8fa3", lineHeight: 1 };
const fieldName: React.CSSProperties = { fontSize: 12, color: "#8b8fa3", marginBottom: 4, fontWeight: 600 };
const lblWrap: React.CSSProperties = { display: "block", marginBottom: 8 };
const input: React.CSSProperties = { width: "100%", padding: "8px 10px", font: "inherit", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, background: "#0c0e14", boxSizing: "border-box" };
const textarea: React.CSSProperties = { ...input, minHeight: 80, resize: "vertical", fontFamily: "inherit" };
const primaryBtn: React.CSSProperties = { padding: "10px 18px", border: 0, borderRadius: 8, background: "#f97316", color: "#06070a", fontWeight: 600, cursor: "pointer" };
const secondaryBtn: React.CSSProperties = { padding: "10px 14px", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, background: "#0c0e14", color: "#8b8fa3", fontWeight: 600, cursor: "pointer", fontSize: 12 };
const errorBox: React.CSSProperties = { background: "rgba(198,40,40,0.16)", color: "#ef6b6b", padding: 10, borderRadius: 8, fontSize: 12, marginTop: 12 };
const meterWrap: React.CSSProperties = { width: "100%", height: 12, background: "#12151c", borderRadius: 6, overflow: "hidden", marginTop: 8 };
const autoPickBox: React.CSSProperties = {
  padding: "12px 14px", borderRadius: 10, marginBottom: 14,
  background: "rgba(46,125,50,0.14)", border: "1px solid rgba(46,125,50,0.35)",
};
const meterBar: React.CSSProperties = { height: "100%", transition: "width 60ms linear, background 200ms" };
const dimCell: React.CSSProperties = { padding: "8px 10px", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, background: "#12151c" };
const qCard: React.CSSProperties = { padding: 10, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, background: "#0c0e14" };

// ── Running-phase styles (Siri-style dark reactive interface) ──────────
const runningWrap: React.CSSProperties = {
  background: "linear-gradient(180deg, #06070d 0%, #0f1024 60%, #1a0f24 100%)",
  color: "#ffffff",
  padding: "20px 24px 22px",
  minHeight: 540,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  borderRadius: "0 0 14px 14px",
  marginTop: -1,
};
const runningStatusRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase",
  color: "rgba(255,255,255,0.55)",
};
const runningPrompt: React.CSSProperties = {
  fontSize: 17, lineHeight: 1.45, color: "#e8eaff",
  textAlign: "center", maxWidth: 540, margin: "0 auto",
  fontWeight: 500, minHeight: 52,
};
const orbStage: React.CSSProperties = {
  display: "flex", justifyContent: "center", alignItems: "center",
  margin: "8px auto 6px", flex: 1, minHeight: 280,
};
const runningTranscript: React.CSSProperties = {
  padding: 14,
  borderRadius: 14,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  minHeight: 64,
  textAlign: "center",
};
const runningTranscriptText: React.CSSProperties = {
  fontSize: 14, lineHeight: 1.5, transition: "color 240ms",
};
const runningWarning: React.CSSProperties = {
  marginTop: 10, padding: "8px 10px", borderRadius: 8,
  background: "rgba(255, 87, 34, 0.18)", color: "#ffd1c2",
  fontSize: 12, lineHeight: 1.4,
};
const fallbackStage: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minHeight: 0,
};
const runningFallbackInput: React.CSSProperties = {
  // flex:1 + minHeight:0 lets the textarea fill the remaining space
  // inside the flex column without pushing the controls off-screen.
  flex: 1, minHeight: 0,
  width: "100%", padding: "10px 12px",
  borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)", color: "#fff",
  fontSize: 14, lineHeight: 1.5, resize: "none",
  fontFamily: "inherit", boxSizing: "border-box", outline: "none",
};
const runningControls: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4,
};
const runningEndBtn: React.CSSProperties = {
  background: "transparent", border: 0, color: "rgba(255,255,255,0.55)",
  cursor: "pointer", fontSize: 13, textDecoration: "underline",
};
const runningDoneBtn: React.CSSProperties = {
  padding: "12px 28px", borderRadius: 28, border: 0,
  fontWeight: 700, fontSize: 14, transition: "background 200ms, color 200ms",
};
const playQuestionBtn: React.CSSProperties = {
  margin: "0 auto", padding: "10px 20px", borderRadius: 22,
  border: "1px solid rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.12)",
  color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
};

// Keyframes injected once via a <style> tag inside the running phase.
const orbKeyframes = `
@keyframes orbBreathe {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 0.95; }
}
@keyframes orbDrift {
  0%, 100% { transform: translate(0, 0); }
  33%      { transform: translate(4%, -3%); }
  66%      { transform: translate(-3%, 4%); }
}
`;

function statusLabel(sub: RunningSub, deciding: DecidingPhase | null): string {
  if (sub === "speaking") return "Interviewer is speaking";
  if (sub === "listening") return "Listening";
  if (deciding === "transcribing") return "Transcribing";
  if (deciding === "next_question") return "Asking next";
  if (deciding === "scoring") return "Scoring";
  return "Thinking";
}
function statusHelper(sub: RunningSub, deciding: DecidingPhase | null): string {
  if (sub === "speaking") return "Listen to the question.";
  if (sub === "deciding") {
    if (deciding === "transcribing") return "Transcribing your answer...";
    if (deciding === "next_question") return "Lining up the next question...";
    if (deciding === "scoring") return "Scoring your session...";
    return "Considering your answer...";
  }
  return "Speak your answer naturally. Tap I'm done when finished.";
}
function subToOrbMode(sub: RunningSub): "speaking" | "listening" | "thinking" {
  return sub === "listening" ? "listening" : sub === "speaking" ? "speaking" : "thinking";
}
/** 67 -> "1:07" for the recording timer. */
function fmtSecs(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Race a promise against a hard wall-clock timeout. Returns the
 * promise's resolved value, OR `fallback` if the timer fires first.
 * Used to keep /turn from stranding the user when OpenAI is slow.
 */
/**
 * Resolve `p`, or the fallback if it rejects or outruns `ms`.
 *
 * `onFallback` is what makes a silent degradation debuggable. Without it
 * this helper turned EVERY /turn failure - an expired token, a 429 from
 * the interview limiter, a 500, a dropped connection - into a perfectly
 * ordinary-looking `{ action: "next" }`. The interview just stopped
 * asking follow-ups and nothing anywhere said why: no console entry, no
 * banner, no failed request the user could point at. Callers now get told
 * which happened so they can log it and warn the user.
 */
function raceWithTimeout<T>(
  p: Promise<T>,
  ms: number,
  fallback: T,
  onFallback?: (reason: "timeout" | "error", err?: unknown) => void,
): Promise<T> {
  return new Promise((resolve) => {
    const t = window.setTimeout(() => { onFallback?.("timeout"); resolve(fallback); }, ms);
    p.then(
      (v) => { window.clearTimeout(t); resolve(v); },
      (err) => { window.clearTimeout(t); onFallback?.("error", err); resolve(fallback); },
    );
  });
}

/**
 * Reactive orb. Three concentric layers:
 *   - outer ripple (slowest, mostly transparent gradient)
 *   - mid ripple   (medium opacity gradient)
 *   - core orb     (the bright glowing center)
 *
 * Every layer's scale is driven by `audioLevel` (0-100). The core
 * also has a strong glow shadow that intensifies at higher levels.
 * Color shifts smoothly between modes via 600ms transitions.
 */
function ReactiveOrb({ mode, audioLevel }: { mode: "speaking" | "listening" | "thinking"; audioLevel: number }) {
  const colorPrimary =
    mode === "speaking" ? "#ff5722" : mode === "listening" ? "#00d18f" : "#7d8dff";
  const colorGlow =
    mode === "speaking" ? "#ffab91" : mode === "listening" ? "#26ffb0" : "#b5c0ff";

  const lvl = Math.max(0, Math.min(100, audioLevel));
  const coreScale = 1 + lvl / 240;          // 1.0 .. 1.42
  const midScale = 1 + lvl / 380;
  const outerScale = 1 + lvl / 520;
  const glowAlpha = Math.min(0.85, 0.35 + lvl / 180);

  return (
    <div style={{
      position: "relative", width: 320, height: 320,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {/* Outer ripple */}
      <div style={{
        position: "absolute", width: "100%", height: "100%", borderRadius: "50%",
        background: `radial-gradient(circle, ${colorPrimary}15, transparent 65%)`,
        transform: `scale(${outerScale})`,
        animation: "orbBreathe 3.4s ease-in-out infinite, orbDrift 9s ease-in-out infinite",
        transition: "transform 220ms ease-out, background 600ms",
      }} />
      {/* Mid ripple */}
      <div style={{
        position: "absolute", width: "70%", height: "70%", borderRadius: "50%",
        background: `radial-gradient(circle, ${colorPrimary}28, ${colorPrimary}08 60%, transparent 80%)`,
        transform: `scale(${midScale})`,
        animation: "orbBreathe 2.6s ease-in-out infinite",
        transition: "transform 160ms ease-out, background 600ms",
      }} />
      {/* Core orb */}
      <div style={{
        position: "absolute", width: "48%", height: "48%", borderRadius: "50%",
        background: `radial-gradient(circle at 32% 30%, ${colorGlow}, ${colorPrimary} 60%, ${colorPrimary}d0 100%)`,
        boxShadow: `0 0 80px ${colorPrimary}${alphaHex(glowAlpha)}, 0 0 36px ${colorGlow}80, inset 0 0 30px ${colorGlow}30`,
        transform: `scale(${coreScale})`,
        transition: "transform 90ms ease-out, background 600ms, box-shadow 220ms",
      }} />
      {/* Highlight specular */}
      <div style={{
        position: "absolute", top: "33%", left: "35%",
        width: "9%", height: "9%", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,255,255,0.85), transparent 70%)",
        opacity: mode === "thinking" ? 0.4 : 0.85,
        transition: "opacity 400ms",
      }} />
    </div>
  );
}

/** Convert a 0-1 alpha to a 2-char hex pair, defensive against NaN. */
function alphaHex(a: number): string {
  const v = Math.max(0, Math.min(1, isFinite(a) ? a : 0));
  return Math.round(v * 255).toString(16).padStart(2, "0");
}
