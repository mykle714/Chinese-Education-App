import { useCallback, useEffect, useRef, useState } from "react";
import { useBackgroundPause } from "../../games/runtime/useBackgroundPause";
import { useTTS } from "../../hooks/useTTS";
import type { TTSLang } from "../../services/tts";
import type { SegmentSpan } from "./documentSegmentation";
import { buildReadAloudClauses, type ReadAloudClause } from "./readAloudClauses";
import { scrollSelectionIntoView } from "./textSelectionUtils";

/**
 * READ ALOUD — the Reader's play button (ReaderReadAloudButton): reads the document aloud
 * from the caret, one clause per clip (readAloudClauses.ts), moving the word highlight
 * along with the audio.
 *
 * ── How the highlight follows the audio ────────────────────────────────────────────
 * The clause is exact: one clause = one clip, and the next clip starts only when the last
 * one ENDS, so the page cannot drift out of sync however long the document is. Inside a
 * clause the current word is ESTIMATED: when the clip starts, the provider reports its real
 * length (TTSRequest.onStart), and each word gets a slice of that length in proportion to
 * its syllable weight (ReadAloudClause.spanStartFractions). An error stays inside one
 * clause.
 * When the provider cannot report a length (the browser-voice fallback), the clause is
 * paced on `learnedMsPerUnit`: the average speaking speed of the cloud clips this
 * session.
 *
 * ── The selection IS the highlight ─────────────────────────────────────────────────
 * Each word is selected in the reading textarea through `selectRange`, exactly as a
 * learner tap would select it, so the keycap shows the word being heard and the Pinyin view
 * paints it, and a stop leaves the caret on the estimated current word (owner's call
 * 2026-11-17). Stopping therefore has nothing to restore.
 *
 * ── Stopping ───────────────────────────────────────────────────────────────────────
 * `stop()` runs on any tap, click or key press while playing (ANY INPUT STOPS IT, below),
 * on unmount and when the document content changes. The input is NOT swallowed: after the
 * stop it does whatever it would have done, so a tap on the text steps on from the word
 * being read and a tap on a button presses it. A touch DRAG does not stop it: it scrolls the
 * reading box (ReaderTapOverlay), and that drag or a wheel calls `noteManualScroll`, pausing
 * the view's follow of the current word for FOLLOW_RESUME_MS (`isFollowPaused`, also read by
 * ReaderCpcdView). A clip that never actually starts
 * (onStart never fired, e.g. iOS refusing the audio context) also ends the run, because
 * without that guard the loop would race through the whole document in silence.
 *
 * ── Which voice ────────────────────────────────────────────────────────────────────
 * A clip is read in the DOCUMENT's language (`documentLang`), not the learner's study
 * language, and an English run inside a Chinese document (ReadAloudClause.voice ===
 * "english") is read by the English voice, so English words don't get a Chinese accent.
 * The learner's male/female Narration voice applies to both (the server maps the role per
 * language: server/services/TTSService.ts → voiceForLang).
 * Where two runs meet inside a clause with no punctuation between them (a SEAM:
 * ReadAloudClause.joinsPrevious / joinsNext), the synthesized silence on that edge of both
 * clips is trimmed (TTSRequest.trimSilence), so the switch is not heard as a ~350 ms pause.
 *
 * Plays through the MANUAL narration path (`speakSentence`): the learner pressed play, so
 * it speaks even on Mute, like every speaker button (docs/AUDIO_PLAYBACK.md § 4).
 *
 * Layer: feature hook (src/features/reader). Depends on useTTS, readAloudClauses,
 * textSelectionUtils. Used by ReaderDocumentPage.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Read aloud"; docs/AUDIO_PLAYBACK.md § 3c.
 */

// Cloud clips carry a little silence at each end. A word is placed inside the speech
// portion only. Tuned by ear, not measured.
const CLIP_LEAD_MS = 60;
const CLIP_TAIL_MS = 150;
// What is left of the edge silence on a TRIMMED edge (a voice-run seam — see "Which voice"):
// CloudTTSProvider's TRIM_PAD_SEC.
const TRIMMED_EDGE_MS = 30;
// How many clauses ahead to synthesize, so the next clip is cached before its turn.
const PREFETCH_AHEAD = 2;
// Fallback speaking speed before any cloud clip has been measured (≈ 4 syllables/s).
const DEFAULT_MS_PER_UNIT = 250;
// Weight of the newest measurement in the running average.
const RATE_SMOOTHING = 0.3;
// After the learner scrolls during a read (a touch drag or a wheel), the
// view stops following the word being read for this long after the LAST scroll step, then
// snaps back to it on the next word.
const FOLLOW_RESUME_MS = 3000;
// A touch that moves less than this is a tap (stops the read); more is a scroll. Same slop
// as ReaderTapOverlay's MOVE_THRESHOLD_PX, so the two agree on what a tap is.
const TAP_SLOP_PX = 10;
/** Marks the Read/Stop pill, which handles its own stop (see ANY INPUT STOPS IT). */
export const READ_ALOUD_CONTROL_ATTR = "data-read-aloud-control";
const READ_ALOUD_CONTROL_SELECTOR = `[${READ_ALOUD_CONTROL_ATTR}]`;

// The session's measured speaking speed, ms per syllable unit. Module-level so it survives
// leaving and reopening a document. Only the browser-voice fallback reads it.
let learnedMsPerUnit = DEFAULT_MS_PER_UNIT;

/**
 * The TTS language for a document's own clips. Only zh is mapped; for any other document
 * this returns undefined, so useTTS falls back to the study language exactly as before
 * (Spanish is paused — its documents keep the old behaviour).
 */
function documentTTSLang(documentLanguage: string | undefined): TTSLang | undefined {
    return documentLanguage === "zh" ? "zh-CN" : undefined;
}

// The language an English run is read in.
const ENGLISH_TTS_LANG: TTSLang = "en-US";

interface UseReaderReadAloudArgs {
    content: string;
    spans: SegmentSpan[];
    // Word → pinyin (the Pinyin display mode's map), or null for a language without a hint.
    pronunciations: Map<string, string> | null;
    inputRef: React.RefObject<HTMLTextAreaElement | null>;
    // useTextSelection.selectRange — selects a word as if the learner had placed it.
    selectRange: (start: number, end: number) => void;
    // The document's language ("zh", "es", …). Picks the TTS language for its clips, and
    // only "zh" turns on the English voice runs.
    documentLanguage: string | undefined;
    // Whether the textarea is the visible view. In the Pinyin mode ReaderCpcdView scrolls
    // itself to the selection, so only the text mode needs the textarea scrolled.
    textareaVisible: boolean;
}

export function useReaderReadAloud({
    content,
    spans,
    pronunciations,
    inputRef,
    selectRange,
    documentLanguage,
    textareaVisible,
}: UseReaderReadAloudArgs) {
    const tts = useTTS();
    const { speakSentence, prefetchSentence, cancel, unlockAudio } = tts;
    const [playing, setPlayingState] = useState(false);
    // Ref twin of `playing` for cleanups: they must cancel audio only while a run is live,
    // or leaving the page would also silence a word the keycap's speaker had started.
    const playingRef = useRef(false);
    const setPlaying = useCallback((value: boolean) => {
        playingRef.current = value;
        setPlayingState(value);
    }, []);
    // Bumped by every start/stop. A run (and its timers) checks it to know it is stale.
    const runIdRef = useRef(0);
    const wordTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    // performance.now() until which the view does not scroll to the word being read.
    const followPausedUntilRef = useRef(0);
    const noteManualScroll = useCallback(() => {
        followPausedUntilRef.current = performance.now() + FOLLOW_RESUME_MS;
    }, []);
    const isFollowPaused = useCallback(() => performance.now() < followPausedUntilRef.current, []);

    // Latest values for the async loop and timers, which outlive the render that started them.
    const latestRef = useRef({ selectRange, textareaVisible });
    latestRef.current = { selectRange, textareaVisible };

    const clearWordTimers = useCallback(() => {
        for (const t of wordTimersRef.current) clearTimeout(t);
        wordTimersRef.current = [];
    }, []);

    const selectWord = useCallback((span: SegmentSpan) => {
        latestRef.current.selectRange(span.start, span.end);
        const textarea = inputRef.current;
        if (textarea && latestRef.current.textareaVisible && !isFollowPaused()) scrollSelectionIntoView(textarea);
    }, [inputRef, isFollowPaused]);

    const stop = useCallback(() => {
        runIdRef.current++;
        followPausedUntilRef.current = 0;
        clearWordTimers();
        if (playingRef.current) cancel();
        setPlaying(false);
    }, [cancel, clearWordTimers, setPlaying]);

    // Lay the clause's words out over the clip's length (see the hook doc).
    const scheduleWords = useCallback((clause: ReadAloudClause, durationMs: number | null, runId: number) => {
        clearWordTimers();
        const total = durationMs ?? clause.totalWeight * learnedMsPerUnit;
        // Edge silence still in the clip: the full margin, or the pad on a trimmed seam edge.
        const lead = durationMs === null ? 0 : clause.joinsPrevious ? TRIMMED_EDGE_MS : CLIP_LEAD_MS;
        const tail = durationMs === null ? 0 : clause.joinsNext ? TRIMMED_EDGE_MS : CLIP_TAIL_MS;
        const speechMs = Math.max(0, total - lead - tail);
        clause.spans.forEach((span, i) => {
            if (i === 0) return; // already selected when the clause began
            const at = lead + clause.spanStartFractions[i] * speechMs;
            wordTimersRef.current.push(setTimeout(() => {
                if (runIdRef.current === runId) selectWord(span);
            }, at));
        });
    }, [clearWordTimers, selectWord]);

    const start = useCallback(() => {
        // Called from the button's click: prime the audio sinks inside the gesture, since
        // every clip after the first plays from code that runs after an await.
        unlockAudio();
        const runId = ++runIdRef.current;
        const caret = inputRef.current?.selectionStart ?? 0;
        const splitEnglishRuns = documentLanguage === "zh";
        const documentLang = documentTTSLang(documentLanguage);
        const clipLang = (clause: ReadAloudClause) => (clause.voice === "english" ? ENGLISH_TTS_LANG : documentLang);
        let clauses = buildReadAloudClauses(content, spans, caret, pronunciations, splitEnglishRuns);
        // Caret after the last word: read from the top instead of doing nothing.
        if (clauses.length === 0) clauses = buildReadAloudClauses(content, spans, 0, pronunciations, splitEnglishRuns);
        if (clauses.length === 0) return;
        setPlaying(true);

        void (async () => {
            for (let i = 0; i < clauses.length; i++) {
                if (runIdRef.current !== runId) return;
                for (const ahead of clauses.slice(i + 1, i + 1 + PREFETCH_AHEAD)) {
                    prefetchSentence(ahead.text, ahead.pronunciation, undefined, clipLang(ahead), ahead.joinsPrevious || ahead.joinsNext);
                }
                const clause = clauses[i];
                selectWord(clause.spans[0]);
                let started = false;
                await speakSentence(clause.text, clause.pronunciation, undefined, {
                    lang: clipLang(clause),
                    trimSilence: { start: clause.joinsPrevious, end: clause.joinsNext },
                    onStart: (durationMs) => {
                        if (runIdRef.current !== runId) return;
                        started = true;
                        scheduleWords(clause, durationMs, runId);
                        // Learn the speed from the document's own voice only: an English
                        // clip's letters are weighted by a rough guess (charWeight).
                        if (durationMs !== null && clause.totalWeight > 0 && clause.voice === "document") {
                            const measured = durationMs / clause.totalWeight;
                            learnedMsPerUnit += RATE_SMOOTHING * (measured - learnedMsPerUnit);
                        }
                    },
                });
                if (runIdRef.current !== runId) return;
                clearWordTimers();
                // No sound came out: end the run rather than racing on in silence.
                if (!started) break;
                // Land on the clause's last word, in case its timer had not fired yet.
                selectWord(clause.spans[clause.spans.length - 1]);
            }
            if (runIdRef.current === runId) setPlaying(false);
        })().catch((err) => {
            console.warn("[useReaderReadAloud] read-aloud run failed:", err);
            if (runIdRef.current === runId) setPlaying(false);
        });
    }, [content, spans, pronunciations, documentLanguage, inputRef, unlockAudio, prefetchSentence, speakSentence, selectWord, scheduleWords, clearWordTimers, setPlaying]);

    // ANY INPUT STOPS IT, AND STILL DOES ITS OWN JOB (owner's call 2026-11-17): a tap, click
    // or key press while playing stops the reading and then reaches its target as usual, so
    // a tap on the text steps from the word being read, the keycap's speaker speaks, the
    // switch switches. Window CAPTURE-phase listeners, so they run before any target handler
    // and swallow nothing.
    //   - Key press: stops at once (an arrow key then moves on from the word being read).
    //   - Mouse: stops on pointerdown, before a desktop click on the textarea moves the
    //     caret (otherwise the run would overwrite it until the button came up).
    //   - Touch / pen: stops on pointerup, and only for a TAP (moved ≤ TAP_SLOP_PX). A drag
    //     is a scroll (ReaderTapOverlay proxies it to the reading box) and keeps reading;
    //     it and a wheel pause the follow instead (`noteManualScroll`).
    //   - The Read/Stop pill (`[data-read-aloud-control]`) is left to its own onClick, which
    //     still sees `playing` and stops. Stopping here first would flip it back to "Read"
    //     before the click lands, and the click would start the reading again.
    useEffect(() => {
        if (!playing) return;
        const onReadAloudControl = (event: Event) =>
            event.target instanceof Element && event.target.closest(READ_ALOUD_CONTROL_SELECTOR) !== null;
        let touchStart: { x: number; y: number; moved: boolean } | null = null;
        const onKeyDown = () => stop();
        const onPointerDown = (event: PointerEvent) => {
            if (onReadAloudControl(event)) return;
            if (event.pointerType === "mouse") {
                stop();
                return;
            }
            touchStart = { x: event.clientX, y: event.clientY, moved: false };
        };
        const onPointerMove = (event: PointerEvent) => {
            if (!touchStart) return;
            if (!touchStart.moved && Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y) <= TAP_SLOP_PX) return;
            touchStart.moved = true;
            noteManualScroll();
        };
        const onPointerUp = (event: PointerEvent) => {
            const gesture = touchStart;
            touchStart = null;
            if (!gesture || gesture.moved || onReadAloudControl(event)) return;
            stop();
        };
        const onPointerCancel = () => {
            touchStart = null;
        };
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", onPointerUp, true);
        window.addEventListener("pointercancel", onPointerCancel, true);
        window.addEventListener("wheel", noteManualScroll, { capture: true, passive: true });
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("pointermove", onPointerMove, true);
            window.removeEventListener("pointerup", onPointerUp, true);
            window.removeEventListener("pointercancel", onPointerCancel, true);
            window.removeEventListener("wheel", noteManualScroll, true);
        };
    }, [playing, stop, noteManualScroll]);

    // BACKGROUNDING STOPS THE READING: switching to another app, locking the screen or
    // hiding the tab ends the run (useBackgroundPause: `visibilitychange` + iOS `pagehide`).
    // Stopping IS the pause — the caret stays on the word being read, so Read picks up
    // from there on return.
    const { paused: backgrounded } = useBackgroundPause(playing);
    useEffect(() => {
        if (backgrounded) stop();
    }, [backgrounded, stop]);

    // The document changed under the run (a save): its offsets are meaningless now.
    const stopRef = useRef(stop);
    stopRef.current = stop;
    useEffect(() => {
        return () => {
            if (playingRef.current) stopRef.current();
        };
    }, [content]);

    return { playing, start, stop, noteManualScroll, isFollowPaused };
}
