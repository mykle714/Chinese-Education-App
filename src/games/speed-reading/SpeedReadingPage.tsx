import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import LeafPage from "../../components/LeafPage";
import type { Language } from "../../types";
import ProvisionalCardsNotice from "../../components/ProvisionalCardsNotice";
import SortProvisionalCta from "../../components/SortProvisionalCta";
import LeafPageHeader from "../../components/LeafPageHeader";
import GameEndPopup from "../runtime/GameEndPopup";
import { useAuth } from "../../AuthContext";
import { markFlashcard } from "../../api/flashcards";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useTTS } from "../../hooks/useTTS";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { useGameWins } from "../../hooks/useGameWins";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import SpeedReadingOption, { type OptionFeedback } from "./SpeedReadingOption";
import SpeedReadingPrompt from "./SpeedReadingPrompt";
import SpeedReadingFloatIndicator, { type FloatIndicator, type FloatKind } from "./SpeedReadingFloatIndicator";
import { loadGlyph } from "../../components/handwriting/GlyphSvg";
import { useSidewaysStage } from "../runtime/useSidewaysStage";
import { playCorrectSound, playWrongSound } from "../runtime/gameSounds";
import { buildRound } from "./buildRound";
import { useSpeedReadingQueue } from "./useSpeedReadingQueue";
import {
    FEEDBACK_MS,
    GAME_KEY,
    MAX_GLYPH_PX,
    MEDAL_THRESHOLDS,
    MIN_GLYPH_PX,
    OPTION_CHAR_GAP_PX,
    OPTION_PADDING_X_PX,
    OPTION_ROW_GAP_PX,
    MEDAL_LABEL,
    TARGET_ROUNDS,
    WIN_LEVEL,
    WRONG_PENALTY_MS,
    formatClock,
    indicatorLifetime,
    medalFor,
} from "./constants";
import type { Phase, Round } from "./types";

/**
 * Speed Reading — read the pinyin and definition, then tap the word that matches.
 *
 * Both options are REAL words differing in exactly one character, so the player
 * cannot get there by shape alone: they have to actually read. Where Bubble Match
 * tests meaning-recall and Word Search tests scanning, this tests READING SPEED —
 * how fast a known word is recognised under a clock.
 *
 * Flow: loading → (blocked) → ready ⇄ feedback → ended
 * A single difficulty; there is no level picker, in-game or on the hub.
 *
 * ── The run is a RACE, not a sprint ─────────────────────────────────────────
 * The player answers a FIXED TARGET_ROUNDS (20) rounds and the clock counts UP;
 * the score is the finishing time and LOWER IS BETTER. There is no time cap — a
 * run ends when the 20th round is answered (or, degenerately, when the card
 * queue drains, which ends it with no medal).
 *
 * Every round counts toward the 20, right or wrong. A wrong answer is charged
 * WRONG_PENALTY_MS instead of being replayed, because with a count-up clock a
 * blind tap is otherwise the fastest possible round.
 *
 * ── There is NO Skip ────────────────────────────────────────────────────────
 * The two options are the only controls on the screen; every round must be
 * answered. Skip existed under the one-minute format, where ducking a hard word
 * cost you the seconds it took to decide to duck it. In a race that logic
 * inverts: skipping would be the cheapest way past a word you cannot read, i.e.
 * a free reroll, and pricing it (a penalty) only turns it into a strictly worse
 * version of guessing — a guess pays the same and might be right. A control the
 * player should never rationally use does not belong on the screen, so it is
 * gone rather than penalized.
 *
 * ── The clock does not pause during feedback ────────────────────────────────
 * Feedback time is charged to the player. That is what makes FEEDBACK_MS a real
 * cost rather than free reading time.
 *
 * ── Answer feedback: sound + a float from the tap point ─────────────────────
 * A pick fires three things at once: a synthesized rising/falling blip
 * (games/runtime/gameSounds), a ✓/✗ that floats up from the exact tap
 * coordinates, and the button colour. The first two land where attention
 * already is — the ear and the tap point — which is what lets FEEDBACK_MS stay
 * as short as it is.
 *
 * ── Marks ───────────────────────────────────────────────────────────────────
 * Emits READING marks, positive AND negative. This is the app's first source of
 * negative reading marks, and that is intended: a player who taps randomly scores
 * ~50% and earns negatives at that rate. The marks are an honest record of the
 * answers given, and a player who guesses genuinely does not know the reading. No
 * accuracy floor, no mark suppression, and — with Skip gone — no unmarked path
 * through a round: every round shown produces exactly one mark.
 *
 * See docs/SPEED_READING_GAME.md.
 */
const SpeedReadingPage: React.FC = () => {
    usePageTitle("Speed Reading");
    const navigate = useNavigate();
    const { user } = useAuth();
    const tts = useTTS();
    const { recordWin } = useGameWins(GAME_KEY);

    // Block the mobile browser's edge-swipe-back gesture while mounted — an edge
    // swipe would otherwise navigate away mid-round.
    useBlockEdgeSwipe(true);

    const [phase, setPhase] = useState<Phase>("loading");
    const [round, setRound] = useState<Round | null>(null);
    const [picked, setPicked] = useState<number | null>(null);
    /** Correct picks so far — reported at the end, but NOT the score. */
    const [score, setScore] = useState(0);
    /** Rounds answered so far, out of TARGET_ROUNDS. */
    const [answered, setAnswered] = useState(0);
    /** Wall-clock time since the first round landed, ticked while playing. */
    const [elapsedMs, setElapsedMs] = useState(0);
    /** Accumulated WRONG_PENALTY_MS, one charge per wrong answer. */
    const [penaltyMs, setPenaltyMs] = useState(0);
    const [popupMinimized, setPopupMinimized] = useState(false);
    /** The ✓/✗ currently floating up from the last tap, or null. */
    const [floatIndicator, setFloatIndicator] = useState<FloatIndicator | null>(null);
    /** Bumped by Play Again; drives the queue's reload and re-arms the run. */
    const [runId, setRunId] = useState(0);

    const queue = useSpeedReadingQueue(!!user, runId);
    // Announce lent cards before the first round narrates. Speed Reading plays a fixed
    // known set, so the notice names them (docs/PROVISIONAL_CARDS.md).
    const [noticeOpen, setNoticeOpen] = useState(false);
    // Feedback timer, cleared on unmount and on run end so a pending advance can
    // never fire into an ended run.
    const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** `Date.now()` at the first round of the run — the clock's origin. */
    const startAtRef = useRef<number>(0);
    /**
     * Answered-round count and penalty total as REFS.
     *
     * Both are read inside the pick handler to decide, in the same tick, whether
     * the run is over and what the final time is; the matching state exists only
     * for rendering. Reading them out of state there would see the previous
     * render's values and let a 21st round start.
     */
    const answeredRef = useRef(0);
    const penaltyRef = useRef(0);
    /** Removes the float indicator once its animation has finished. */
    const floatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Monotonic id, so each pick mounts a fresh element and restarts the CSS. */
    const floatIdRef = useRef(0);
    /**
     * Sideways rendering. Rotates the whole game 90° whenever its container is
     * taller than wide, which is what makes device rotation a non-event — see
     * the hook. Everything below the frame lives in STAGE coordinates.
     */
    const stage = useSidewaysStage();

    /** The rotated stage element — the float indicator's positioning parent. */
    const contentRef = useRef<HTMLDivElement | null>(null);

    // ── Measured option row ──────────────────────────────────────────────────
    /**
     * Live width of the two-button row, in px. Drives `glyphSize`, which cannot
     * be a fixed ladder now that each button only gets half the row.
     *
     * Observed rather than read once: a phone rotation or the iOS URL bar
     * collapsing changes it mid-run, and a stale width would either overflow the
     * button or waste half of it.
     */
    const [optionsWidth, setOptionsWidth] = useState(0);
    const optionsRowRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = optionsRowRef.current;
        if (!el) return;
        setOptionsWidth(el.getBoundingClientRect().width);
        // ResizeObserver is supported everywhere this app runs; the guard is for
        // test environments (jsdom) where it may be absent.
        if (typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width;
            if (w) setOptionsWidth(w);
        });
        ro.observe(el);
        return () => ro.disconnect();
        // Keyed on `phase` because the row only exists in the play phases — the
        // effect has to re-attach when it mounts. Re-observing on every phase
        // change is cheap and keeps the dependency honest.
    }, [phase]);

    // ── Round construction ───────────────────────────────────────────────────
    /**
     * Pull cards until one yields a playable round.
     *
     * A card is UNPLAYABLE when it has no CJK characters, or when the distractor
     * ladder is exhausted (every library character already appears in the word).
     * Those are dropped here at dequeue, and the drop counts toward the top-up
     * trigger.
     */
    const takeRound = useCallback((): Round | null => {
        // Bounded so an entire queue of unplayable cards can't spin forever.
        for (let attempts = 0; attempts < 40; attempts++) {
            const entry = queue.dequeue();
            if (!entry) return null; // queue drained
            const built = buildRound(entry, queue.distractorsRef.current);
            if (built) return built;
        }
        return null;
    }, [queue]);

    /**
     * Live `tts` handle for callbacks that must NOT take it as a dependency.
     * `useTTS()` returns a fresh object every render, so depending on it would
     * churn `prefetchRound` → `nextRound` → `advance` → `onPick` on every render.
     */
    const ttsRef = useRef(tts);
    ttsRef.current = tts;

    /**
     * Warm a round's assets: the stroke corpus for its glyphs, and the cloud
     * audio for its word.
     *
     * `GlyphSvg` paints a CACHED glyph on its first frame but has to wait on a
     * dynamic import (dev) or a CDN fetch (prod) for one it has never seen — up
     * to 8 characters' worth of network at the round change, showing as empty
     * buttons. Auto-narration has the same problem in the audio dimension: an
     * un-cached word needs a synthesis round-trip, and half a second of silence
     * at the top of a round is half a second added to the player's time. Calling
     * this one round AHEAD moves both costs into the time the player is already
     * spending reading the current round.
     */
    const prefetchRound = useCallback((r: Round) => {
        for (const option of r.options) {
            for (const ch of option.chars) {
                // loadGlyph memoizes and swallows its own errors; nothing to await.
                void loadGlyph(ch);
            }
        }
        // No-ops when TTS is off or the card has no audio; caches otherwise.
        ttsRef.current.prefetch(r.entry);
    }, []);

    /**
     * The round AFTER the one on screen, built and glyph-prefetched while the
     * player is still reading the current one. Advancing then costs a single
     * synchronous setState instead of a build plus a glyph load.
     */
    const pendingRoundRef = useRef<Round | null>(null);

    /**
     * Show the next round. Consumes the prebuilt one when there is one, then
     * immediately prepares the one after it.
     */
    const nextRound = useCallback((): boolean => {
        const upcoming = pendingRoundRef.current ?? takeRound();
        pendingRoundRef.current = null;
        if (!upcoming) return false; // queue drained
        setRound(upcoming);
        setPicked(null);

        // Prepare one round ahead. Costs one extra card off the queue, which the
        // top-up already accounts for; the last prepared round is simply dropped
        // when the clock runs out.
        const ahead = takeRound();
        pendingRoundRef.current = ahead;
        if (ahead) prefetchRound(ahead);
        return true;
    }, [takeRound, prefetchRound]);

    // ── Run start ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!user) {
            setPhase("blocked");
            return;
        }
        if (queue.loading) return;
        if (queue.blockMessage) {
            setPhase("blocked");
            return;
        }
        if (!queue.ready) return;

        // Arm the shared AudioContext before the first round auto-narrates. The
        // tap that opened this page happened on the previous screen, so by the
        // time the queue resolves there is no gesture in flight; without this,
        // mobile autoplay policy can leave the context suspended and swallow the
        // first word.
        tts.unlockAudio();

        // Start the clock at the first playable round, not at mount — otherwise a
        // slow initial fetch would be charged to the player's time.
        if (nextRound()) {
            setNoticeOpen(queue.provisional.length > 0);
            startAtRef.current = Date.now();
            setElapsedMs(0);
            setPhase("ready");
        } else {
            setPhase("blocked");
        }
        // Runs once the queue reports ready. `nextRound` is intentionally excluded:
        // it changes identity with the queue and would restart the run.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queue.ready, queue.loading, queue.blockMessage, user?.id]);

    // ── Clock ────────────────────────────────────────────────────────────────
    // Counts UP and never expires: the run ends on the round count, not on time,
    // so this interval only drives the display.
    useEffect(() => {
        if (phase !== "ready" && phase !== "feedback") return;
        const id = setInterval(() => {
            setElapsedMs(Date.now() - startAtRef.current);
        }, 200);
        return () => clearInterval(id);
    }, [phase]);

    // Clear any pending timers on unmount.
    useEffect(() => () => {
        if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
        if (floatTimerRef.current) clearTimeout(floatTimerRef.current);
    }, []);

    // ── Marks ────────────────────────────────────────────────────────────────
    /**
     * Record a READING mark. Fire-and-forget with a `.catch()` — the game never
     * blocks on it, and a failure only logs.
     */
    // excludeIds defaults to []: the game doesn't use the replacement card the
    // endpoint returns, so there's nothing to dedupe against. No `token` dep —
    // markFlashcard resolves the auth header at call time, so this callback's
    // identity survives the silent refresh (CLAUDE.md).
    const mark = useCallback((cardId: number, isCorrect: boolean) => {
        markFlashcard({ cardId, isCorrect, type: "reading" })
            .catch((err) => console.error(`[SpeedReading] mark failed → card ${cardId}:`, err));
    }, []);

    // ── Ending and advancing ─────────────────────────────────────────────────
    /**
     * Stop the run and freeze the clock.
     *
     * The final time is taken from `Date.now()` rather than from the `elapsedMs`
     * state, which is up to one 200ms tick stale — the score has to be the real
     * elapsed time, not the last thing painted. The clock interval unsubscribes on
     * the phase change, so this value is what the popup keeps showing.
     */
    const endRun = useCallback(() => {
        if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
        setElapsedMs(Date.now() - startAtRef.current);
        setPhase("ended");
        setPopupMinimized(false);
    }, []);

    const advance = useCallback(() => {
        // The target was reached by the answer that started this feedback.
        if (answeredRef.current >= TARGET_ROUNDS) {
            endRun();
            return;
        }
        if (nextRound()) {
            setPhase("ready");
        } else {
            // Queue drained (a failed top-up, or a run of unplayable cards). End
            // the run rather than stalling on an empty screen — an unfinished run
            // earns no medal however fast it was, see `medal` below.
            endRun();
        }
    }, [nextRound, endRun]);

    /**
     * Spawn the ✓/✗ — and, on a wrong answer, the red +3s — at the tap point.
     *
     * The event's clientX/clientY are viewport coordinates; the stage converts
     * them into its own space, which is the space the overlay is positioned in.
     *
     * The penalty must appear where the player just looked: a +3s that surfaced
     * somewhere else (or only on the clock) would not be connected to the tap
     * that caused it.
     */
    const spawnFloatIndicator = useCallback((event: React.MouseEvent<HTMLElement>, kind: FloatKind) => {
        // MUST go through the stage: when it is rotated, `clientX/clientY` and
        // the stage's own bounding rect are in different coordinate systems, and
        // the naive `clientX - rect.left` is wrong by a 90° rotation rather than
        // by an offset. See useSidewaysStage.toStageCoords.
        const { x, y } = stage.toStageCoords(event.clientX, event.clientY);
        floatIdRef.current += 1;
        setFloatIndicator({ x, y, kind, id: floatIdRef.current });
        // Unmount after the animation so a stale node can't linger over the next
        // round. Restarted (not stacked) on a rapid second tap. A penalty float
        // lives longer than a plain ✓ — a number has to be read, not glanced at.
        if (floatTimerRef.current) clearTimeout(floatTimerRef.current);
        floatTimerRef.current = setTimeout(() => setFloatIndicator(null), indicatorLifetime(kind));
    }, [stage]);

    /** Charge a wrong answer. Ref first: `advance` reads it. */
    const addPenalty = useCallback(() => {
        penaltyRef.current += WRONG_PENALTY_MS;
        setPenaltyMs(penaltyRef.current);
    }, []);

    const onPick = useCallback((index: number, event: React.MouseEvent<HTMLElement>) => {
        if (phase !== "ready" || !round) return;
        const option = round.options[index];
        setPicked(index);
        setPhase("feedback");
        // Every round counts toward the target, right or wrong; a wrong one is
        // paid for in seconds instead of in an extra round. There is no Skip, so
        // this is the only path that advances the counter.
        answeredRef.current += 1;
        setAnswered(answeredRef.current);
        if (option.isCorrect) setScore((s) => s + 1);
        else addPenalty();
        // Sound first: it is the fastest cue to reach the player, and it must not
        // wait on the mark request or the render.
        if (option.isCorrect) playCorrectSound();
        else playWrongSound();
        spawnFloatIndicator(event, option.isCorrect ? "correct" : "wrong");
        mark(round.entry.id, option.isCorrect);
        advanceTimerRef.current = setTimeout(advance, FEEDBACK_MS);
    }, [phase, round, mark, advance, spawnFloatIndicator, addPenalty]);

    const speak = useCallback(() => {
        if (!round) return;
        void tts.speakSentence(round.entry.entryKey, round.entry.pronunciation ?? undefined);
    }, [round, tts]);

    /**
     * Auto-narration: every round speaks its word as it lands, without the
     * player having to reach for the speaker button. Under a clock, a tap spent
     * on the speaker is a tap not spent answering, so the audio has to arrive on
     * its own to be usable at all — the speaker button stays for replays.
     *
     * Guarded on ROUND IDENTITY rather than on a dep list: `speak` changes
     * identity whenever `tts` does (every render), so this effect re-runs
     * constantly and the ref is what makes narration fire exactly once per
     * round. Playback is not cancelled on advance — the next round's speak()
     * cancels the previous utterance itself (useTTS.speakText).
     */
    const spokenRoundRef = useRef<Round | null>(null);
    useEffect(() => {
        // "ready" only: no narration during feedback, and none once the run ends.
        if (phase !== "ready" || !round) return;
        if (spokenRoundRef.current === round) return;
        spokenRoundRef.current = round;
        speak();
    }, [phase, round, speak]);

    // ── Score ────────────────────────────────────────────────────────────────
    /**
     * The score: wall-clock time plus penalties, LOWER IS BETTER. Live during the
     * run (so the penalty is felt the moment it lands) and frozen at the end.
     */
    const totalMs = elapsedMs + penaltyMs;
    /**
     * A medal requires a FINISHED run. A run cut short by a drained queue has a
     * small time that would otherwise buy a gold for answering three rounds.
     */
    const finished = answered >= TARGET_ROUNDS;
    const medal = finished ? medalFor(totalMs) : null;

    // Record the win once per run, when it ends with a medal.
    const winRecordedRef = useRef(false);
    useEffect(() => {
        if (phase !== "ended" || winRecordedRef.current) return;
        if (medal) {
            winRecordedRef.current = true;
            recordWin(WIN_LEVEL);
        }
    }, [phase, medal, recordWin]);

    /**
     * Play Again — reset every piece of run state and reload the queue.
     *
     * NOT `navigate` to this same route: React Router matches the same route, so
     * the component never unmounts and none of this state would clear. Bumping
     * `runId` re-runs the queue's loader (fresh cards and a fresh distractor
     * pool), and the run-start effect re-arms when it reports ready again.
     */
    const playAgain = useCallback(() => {
        if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
        if (floatTimerRef.current) clearTimeout(floatTimerRef.current);
        setFloatIndicator(null);
        // Built from the previous run's queue; the reload replaces that queue.
        pendingRoundRef.current = null;
        winRecordedRef.current = false;
        answeredRef.current = 0;
        penaltyRef.current = 0;
        setScore(0);
        setAnswered(0);
        setPenaltyMs(0);
        setPicked(null);
        setRound(null);
        setElapsedMs(0);
        setPopupMinimized(false);
        setPhase("loading");
        setRunId((n) => n + 1);
    }, []);

    // ── Render ───────────────────────────────────────────────────────────────
    const clock = formatClock(totalMs);

    /** Feedback paint for one option. */
    const feedbackFor = (index: number): OptionFeedback => {
        if (phase !== "feedback" || !round) return "none";
        if (round.options[index].isCorrect) return "correct";
        // Only the option the player actually tapped turns red; the untapped
        // wrong option on a correct answer stays neutral.
        return index === picked ? "wrong" : "none";
    };

    /**
     * Glyph size, MEASURED rather than tabulated.
     *
     * The options sit SIDE BY SIDE, so each button gets about half the row —
     * roughly 165px on a 390px phone, against ~350px when they were stacked. A
     * hardcoded size-per-length ladder cannot survive that: it was tuned for the
     * full width and a 4-character word would overflow its button. So the row's
     * real width is measured and the glyph is whatever actually fits.
     *
     * Both buttons always get the SAME size — the one-character invariant means
     * both options have equal length — so size can never hint at the answer.
     */
    const charCount = round?.options[0].chars.length ?? 1;
    const glyphSize = React.useMemo(() => {
        // Fall back to a conservative size until the first measurement lands.
        const rowWidth = optionsWidth || 320;
        const perButton = (rowWidth - OPTION_ROW_GAP_PX) / 2;
        const drawable =
            perButton - OPTION_PADDING_X_PX * 2 - (charCount - 1) * OPTION_CHAR_GAP_PX;
        // Clamped: MIN keeps a 4-character word legible on a narrow phone, MAX
        // stops a single character ballooning on a tablet.
        return Math.max(MIN_GLYPH_PX, Math.min(MAX_GLYPH_PX, Math.floor(drawable / charCount)));
    }, [optionsWidth, charCount]);

    const centered = (children: React.ReactNode) => (
        <Box
            className="speed-reading__overlay"
            sx={{
                flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 2.5, px: 4, textAlign: "center",
            }}
        >
            {children}
        </Box>
    );

    /**
     * Progress and clock, drawn in the header inside the rotated stage.
     *
     * The round counter has to be on screen now that the run ends on a count
     * rather than on a countdown — without it the player cannot tell whether they
     * are on round 3 or round 19. It sits left of the clock, in the secondary
     * colour, so the time stays the headline.
     *
     * The clock turns red once the run can no longer medal (past bronze), which
     * is the count-up equivalent of the old "last 10 seconds" warning: both say
     * "the thing you were racing has slipped away".
     */
    const clockEl = (
        <Box
            className="speed-reading__status"
            sx={{ display: "flex", alignItems: "baseline", gap: 1 }}
        >
            <Typography
                className="speed-reading__progress"
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.body,
                    fontWeight: WEIGHT.medium,
                    color: COLORS.textSecondary,
                }}
            >
                {Math.min(answered, TARGET_ROUNDS)}/{TARGET_ROUNDS}
            </Typography>
            <Typography
                className="speed-reading__clock"
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.bodyLg,
                    fontWeight: WEIGHT.bold,
                    color: totalMs > MEDAL_THRESHOLDS.bronze ? COLORS.redMain : COLORS.onSurface,
                    minWidth: 44,
                    textAlign: "right",
                }}
            >
                {clock}
            </Typography>
        </Box>
    );

    return (
        // Leaf page: no footer, slides up on enter. `hideHeader` because this
        // game is SIDEWAYS — the header has to live inside the rotated stage, not
        // upright at the top of a portrait screen — so the back handler comes
        // through the render-prop form of children instead.
        <>
        <ProvisionalCardsNotice
            open={noticeOpen}
            onDismiss={() => setNoticeOpen(false)}
            surfaceName="Speed Reading"
            words={queue.provisional}
            language={(user?.selectedLanguage ?? "zh") as Language}
        />
        <LeafPage
            title="Speed Reading"
            onBack={() => navigate("/games")}
            hideHeader
        >
            {({ onBack: leaveGame }) => (
            <Box
                // NOT rotated: this is the container whose SHAPE decides whether
                // the stage rotates, and the only element whose bounding rect is
                // a true rect (see useSidewaysStage.toStageCoords).
                className="speed-reading__frame"
                ref={stage.outerRef}
                sx={{
                    position: "relative",
                    flex: 1,
                    minHeight: 0,
                    overflow: "hidden",
                    // Nothing on this page scrolls.
                    touchAction: "none",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    WebkitTouchCallout: "none",
                }}
            >
            <Box
                className={`speed-reading__content${stage.rotated ? " speed-reading__content--sideways" : ""}`}
                // Positioning frame for the float indicator.
                ref={contentRef}
                style={stage.stageStyle}
            >
                <LeafPageHeader title="Speed Reading" onBack={leaveGame} rightContent={clockEl} />
                {phase === "loading" && centered(<DelayedCircularProgress className="speed-reading__spinner" />)}

                {phase === "blocked" && centered(
                    <>
                        <Typography
                            className="speed-reading__block-msg"
                            sx={{ fontSize: SIZE.subtitle, color: COLORS.onSurface, lineHeight: LEADING.normal }}
                        >
                            {queue.blockMessage
                                || (!user ? "Sign in to play Speed Reading."
                                    : "No cards are playable right now. Study more cards and try again.")}
                        </Typography>
                        <Button className="speed-reading__block-back" variant="contained" onClick={() => navigate("/games")}>
                            Back to Games
                        </Button>
                    </>
                )}

                {(phase === "ready" || phase === "feedback" || phase === "ended") && round && (
                    <Box
                        className="speed-reading__play"
                        sx={{
                            flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: "center", py: 2.5, px: 2.5, gap: 2,
                        }}
                    >
                        {/* Prompt and options are ONE GROUP, centred in the play
                            area. The prompt sits directly on top of the buttons
                            rather than being pushed to the top of the screen: the
                            player reads the prompt and then compares the options in
                            one motion, so the eye should not have to travel the
                            height of the page between them.

                            There is nothing else on this screen — the two options
                            are the ONLY controls. Skip was removed: see the page
                            doc-comment. */}
                        <Box
                            className="speed-reading__stack"
                            sx={{
                                flex: 1, minHeight: 0, width: "100%", display: "flex",
                                flexDirection: "column", alignItems: "center",
                                justifyContent: "center", gap: 1.5,
                            }}
                        >
                            <SpeedReadingPrompt
                                entry={round.entry}
                                onSpeak={speak}
                                speaking={tts.speakingKey === round.entry.entryKey}
                            />

                            {/* Options sit SIDE BY SIDE, so the pair is read as one
                                unit — they differ by a single character, and that is
                                the comparison the game asks for.

                                The cost is width: each button gets about half the row,
                                so glyphs are smaller than when the options stacked.
                                That is why `glyphSize` is MEASURED off this row rather
                                than tabulated by word length — see the note there.
                                Equal flex plus the shared glyph size keeps the two
                                buttons identical boxes, so neither hints at the
                                answer. */}
                            <Box
                                className="speed-reading__options"
                                ref={optionsRowRef}
                                sx={{
                                    width: "100%",
                                    display: "flex",
                                    flexDirection: "row",
                                    gap: `${OPTION_ROW_GAP_PX}px`,
                                }}
                            >
                                {round.options.map((option, i) => (
                                    <SpeedReadingOption
                                        key={i}
                                        option={option}
                                        feedback={feedbackFor(i)}
                                        // Frozen during feedback so a double-tap can't
                                        // mark the next round.
                                        disabled={phase !== "ready"}
                                        onPick={(event) => onPick(i, event)}
                                        glyphSize={glyphSize}
                                    />
                                ))}
                            </Box>
                        </Box>
                    </Box>
                )}

                {/* Keyed by id so a second tap mounts a NEW element and the
                    float animation restarts from the top. */}
                {floatIndicator && (
                    <SpeedReadingFloatIndicator key={floatIndicator.id} indicator={floatIndicator} />
                )}

                {phase === "ended" && (
                    <GameEndPopup
                        classPrefix="speed-reading"
                        minimized={popupMinimized}
                        onMinimize={() => setPopupMinimized(true)}
                        onRestore={() => setPopupMinimized(false)}
                    >
                        <Typography
                            className="speed-reading__popup-title"
                            sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}
                        >
                            {medal ? `${MEDAL_LABEL[medal]}!` : finished ? "Finished!" : "Out of cards"}
                        </Typography>
                        {/* The TIME is the score, so it is the biggest thing in the
                            popup; accuracy and the penalty it bought are the
                            breakdown underneath. An unfinished run (drained queue)
                            has no meaningful time — say so instead of showing one
                            that looks like a record. */}
                        {finished ? (
                            <>
                                <Typography
                                    className="speed-reading__popup-time"
                                    sx={{ fontSize: SIZE.heading, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}
                                >
                                    {formatClock(totalMs)}
                                </Typography>
                                <Typography className="speed-reading__popup-score" sx={{ fontSize: SIZE.body, color: COLORS.textSecondary }}>
                                    {score}/{TARGET_ROUNDS} correct
                                    {penaltyMs > 0 && ` · +${Math.round(penaltyMs / 1000)}s penalty`}
                                </Typography>
                            </>
                        ) : (
                            <Typography className="speed-reading__popup-score" sx={{ fontSize: SIZE.body, color: COLORS.textSecondary }}>
                                Ran out of cards after {answered} of {TARGET_ROUNDS} — no time recorded.
                            </Typography>
                        )}
                        <Box
                            className="speed-reading__popup-actions"
                            sx={{ display: "flex", flexDirection: "column", gap: 1.25, width: "100%" }}
                        >
                            {/* Renders nothing unless this run used lent cards. */}
                            <SortProvisionalCta
                                words={queue.provisional}
                                language={(user?.selectedLanguage ?? "zh") as Language}
                            />
                            <Button
                                className="speed-reading__popup-again"
                                variant="contained"
                                onClick={playAgain}
                                sx={{ py: 1.25, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.bold }}
                            >
                                Play Again
                            </Button>
                            <Button
                                className="speed-reading__popup-back"
                                variant="outlined"
                                onClick={() => navigate("/games")}
                                sx={{ py: 1, borderRadius: "14px", textTransform: "none", fontWeight: WEIGHT.medium }}
                            >
                                Back to Games
                            </Button>
                        </Box>
                    </GameEndPopup>
                )}
            </Box>
            </Box>
            )}
        </LeafPage>
        </>
    );
};

export default SpeedReadingPage;
