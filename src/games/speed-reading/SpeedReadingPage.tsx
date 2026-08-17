import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import LeafPage from "../../components/LeafPage";
import type { Language } from "../../types";
import ProvisionalCardsNotice from "../../components/ProvisionalCardsNotice";
import ProvisionalSortOffer from "../../components/ProvisionalSortOffer";
import { useProvisionalSortOffer } from "../../hooks/useProvisionalSortOffer";
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
import SpeedReadingOptionText from "./SpeedReadingOptionText";
import SpeedReadingTapZone from "./SpeedReadingTapZone";
import SpeedReadingPrompt from "./SpeedReadingPrompt";
import { useSidewaysStage } from "../runtime/useSidewaysStage";
import { playCorrectSound, playWrongSound } from "../runtime/gameSounds";
import { buildRound, buildSentenceRound } from "./buildRound";
import { roundPrompt } from "./roundPrompt";
import { useSpeedReadingQueue } from "./useSpeedReadingQueue";
import {
    FEEDBACK_MS,
    GAME_KEY,
    MARK_TYPE,
    MEDAL_THRESHOLDS,
    MEDAL_LABEL,
    OPTION_GLYPH_SIZE,
    OPTION_SENTENCE_GLYPH_SIZE,
    SENTENCE_ROUNDS,
    TARGET_ROUNDS,
    WIN_LEVEL,
    WRONG_PENALTY_MS,
    formatClock,
    medalFor,
} from "./constants";
import type { OptionFeedback, Phase, Round } from "./types";
import GamePausedOverlay from "../runtime/GamePausedOverlay";
import { useBackgroundPause } from "../runtime/useBackgroundPause";

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
 * ── The last two rounds are SENTENCES ───────────────────────────────────────
 * The final SENTENCE_ROUNDS (2) rounds escalate from "read this word" to "read
 * this word in context": both options are the same EXAMPLE SENTENCE, differing
 * at one character inside the target word, and the prompt shows the sentence's
 * pinyin and translation and narrates the sentence. Same controls, same
 * one-character invariant, more to scan — so the run ends on its hardest reading.
 *
 * Their cards are RESERVED AT LOAD (useSpeedReadingQueue), from the initial pool
 * only, and only from cards whose det row carries an example sentence containing
 * the headword. The finale therefore never depends on what a mid-run top-up
 * returns. A round's kind is decided by its ORDINAL, and the ordinal comes from
 * `answeredRef` (see `nextRound`) — the prebuilt round carries the ordinal it was
 * made for and is discarded if the run moves under it.
 *
 * ── Tap your side of the screen ─────────────────────────────────────────────
 * The controls are the LEFT and RIGHT HALVES of the play area, not the words:
 * the whole left half picks option A, the whole right half picks option B, and
 * the tapped half tints green or red. The words are display-only labels sitting
 * in a `pointer-events: none` layer above the zones (SpeedReadingTapZone,
 * SpeedReadingOptionWord).
 *
 * ── There is NO Skip ────────────────────────────────────────────────────────
 * The two halves are the only controls on the screen (bar the prompt's speaker);
 * every round must be answered. Skip existed under the one-minute format, where ducking a hard word
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
 * ── Answer feedback: a sound and the tapped half's tint ─────────────────────
 * A pick fires two things at once: a synthesized rising/falling blip
 * (games/runtime/gameSounds) and a green/red tint over the half that was
 * tapped. The sound is what lets FEEDBACK_MS stay as short as it is — it needs
 * no eye movement at all.
 *
 * A ✓/✗ used to float up from the exact tap coordinates, carrying a red +3s on a
 * wrong answer; it was removed by request. ⚠️ Nothing now shows the penalty at
 * the moment it is charged — it is only visible as the clock running ahead of
 * the elapsed time.
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
    /**
     * Sideways rendering. Rotates the whole game 90° whenever its container is
     * taller than wide, which is what makes device rotation a non-event — see
     * the hook. Everything below the frame lives in STAGE coordinates.
     */
    const stage = useSidewaysStage();

    // The option row's width used to be measured here (ResizeObserver) to derive
    // a per-round glyph size. The options now render as a fixed-size cpcd row
    // (OPTION_GLYPH_SIZE) that wraps instead of shrinking, so nothing on this
    // page depends on that width any more.

    // ── Round construction ───────────────────────────────────────────────────
    /**
     * Pull cards until one yields a playable round.
     *
     * `roundNumber` is 1-based and decides the KIND: the last SENTENCE_ROUNDS of
     * the run (19 and 20 of 20) are built from the cards the queue reserved at
     * load, as sentence rounds. If that reservation is empty — a pool where too
     * few cards carry an example sentence, which the queue warns about — the
     * round degrades to an ordinary word round rather than ending the run.
     *
     * A card is UNPLAYABLE when it has no CJK characters, or when the distractor
     * ladder is exhausted (every library character already appears in the word).
     * Those are dropped here at dequeue, and the drop counts toward the top-up
     * trigger.
     */
    const takeRound = useCallback((roundNumber: number): Round | null => {
        if (roundNumber > TARGET_ROUNDS - SENTENCE_ROUNDS) {
            const entry = queue.dequeueSentenceCard();
            // Reserved cards are pre-checked for a usable sentence, so a null
            // build here means only that the distractor ladder ran dry.
            const built = entry ? buildSentenceRound(entry, queue.distractorsRef.current) : null;
            if (built) return built;
        }
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
     * Warm a round's cloud audio.
     *
     * An un-cached word needs a synthesis round-trip, and half a second of
     * silence at the top of a round is half a second added to the player's time.
     * Calling this one round AHEAD moves that cost into the time the player is
     * already spending reading the current round.
     *
     * The glyphs used to be prefetched here too (the stroke corpus behind the
     * old `GlyphSvg` options needed a dynamic import in dev / a CDN fetch in
     * prod, showing as empty buttons on a miss). The options are plain font text
     * now — nothing to load — so only audio is warmed.
     */
    const prefetchRound = useCallback((r: Round) => {
        // No-ops when TTS is off or the card has no audio; caches otherwise. A
        // sentence round narrates the SENTENCE, so it warms a different cache key
        // than the headword — the cloud cache is keyed on text+pinyin+voice.
        if (r.kind === "sentence") {
            const { speechText, speechPinyin } = roundPrompt(r);
            ttsRef.current.prefetchSentence(speechText, speechPinyin);
            return;
        }
        ttsRef.current.prefetch(r.entry);
    }, []);

    /**
     * The round AFTER the one on screen, built and audio-prefetched while the
     * player is still reading the current one. Advancing then costs a single
     * synchronous setState instead of a build plus an audio fetch.
     *
     * TAGGED with the ordinal it was built for. A round's KIND depends on its
     * ordinal (the last SENTENCE_ROUNDS of a run are sentence rounds), so a
     * prebuilt round is only valid at the position it was made for; if the run is
     * re-armed under it, it must be discarded rather than shown out of turn.
     */
    const pendingRoundRef = useRef<{ ordinal: number; round: Round } | null>(null);

    /**
     * Show the next round. Consumes the prebuilt one when it is the right one,
     * then immediately prepares the one after it.
     *
     * ── The ordinal comes from `answeredRef`, never from a build counter ─────
     * `answeredRef.current + 1` IS the round about to be shown, because every
     * round shown is answered exactly once (there is no Skip). Counting
     * CONSTRUCTED rounds instead looks equivalent and is not — it drifts ahead of
     * the player on any build that doesn't reach the screen, and React
     * StrictMode double-invokes the run-start effect in dev, so such a counter
     * starts ahead and lands the sentence finale in the middle of the run.
     * Deriving the ordinal from ANSWERS is self-correcting: however many rounds
     * were built and thrown away, round 19 is still the one shown after 18
     * answers.
     */
    const nextRound = useCallback((): boolean => {
        const ordinal = answeredRef.current + 1;
        const pending = pendingRoundRef.current;
        pendingRoundRef.current = null;
        // Reuse the prebuilt round only if it was built for THIS position.
        let upcoming = pending && pending.ordinal === ordinal ? pending.round : null;
        if (!upcoming) upcoming = takeRound(ordinal);
        if (!upcoming) return false; // queue drained
        setRound(upcoming);
        setPicked(null);

        // Prepare one round ahead. Costs one extra card off the queue, which the
        // top-up already accounts for. Not past the target: a 21st round would
        // never be shown, and building one would burn a card — and, once the
        // finale's reservation is empty, would pull a word card for nothing.
        const ahead = ordinal < TARGET_ROUNDS ? takeRound(ordinal + 1) : null;
        if (ahead) {
            pendingRoundRef.current = { ordinal: ordinal + 1, round: ahead };
            prefetchRound(ahead);
        }
        return true;
    }, [takeRound, prefetchRound]);

    // ── Run start ────────────────────────────────────────────────────────────
    /**
     * The `runId` this effect has already armed a run for, so it arms each run
     * EXACTLY once. React StrictMode invokes mount effects twice in dev, and a
     * second arming is not harmless: it burns the cards of the round already
     * built, re-narrates, and re-stamps the clock's origin. State can't be the
     * guard here — the first invocation's `setPhase` has not flushed by the time
     * the second runs — so it has to be a ref.
     */
    const armedRunRef = useRef<number | null>(null);
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
        if (armedRunRef.current === runId) return;
        armedRunRef.current = runId;

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
        // Runs once per runId, the first time the queue reports ready. `nextRound`
        // is intentionally excluded: it changes identity with the queue and would
        // restart the run.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queue.ready, queue.loading, queue.blockMessage, user?.id, runId]);

    // ── Popup pause gate ─────────────────────────────────────────────────────
    // No game clock may run while a MODAL popup covers the board. Speed Reading's
    // clock counts UP and IS the score, so the seconds spent reading the
    // provisional-cards notice — which opens on the very first round — would
    // otherwise be charged straight to the player's time. The notice is a
    // full-screen input-blocking overlay, so a frozen clock buys no free study.
    // Shared rule across all four games — see docs/GAMES_FEATURE.md § Popups pause
    // the clock.
    // BACKGROUNDING IS THE SECOND SOURCE for this same boolean — the app-wide rule
    // (docs/GAMES_FEATURE.md § Backgrounding pauses the clock). This game's score IS
    // its elapsed time, so an unpaused background spell was charged directly to the
    // player's result.
    const { paused: backgroundPaused, resume: resumeFromBackground } =
        useBackgroundPause(phase === "playing");
    const clockPaused = noticeOpen || backgroundPaused;
    /** `Date.now()` when the current pause began, or null while running. */
    const pausedAtRef = useRef<number | null>(null);
    useEffect(() => {
        if (clockPaused) {
            pausedAtRef.current = Date.now();
            return;
        }
        if (pausedAtRef.current === null) return;
        // Push the run's ORIGIN forward by the paused span. Every reader of the
        // clock (the display interval and the end-of-run `finalMs`) measures from
        // startAtRef, so moving it is all that's needed to un-bill the pause.
        startAtRef.current += Date.now() - pausedAtRef.current;
        pausedAtRef.current = null;
        setElapsedMs(Date.now() - startAtRef.current);
    }, [clockPaused]);

    // ── Clock ────────────────────────────────────────────────────────────────
    // Counts UP and never expires: the run ends on the round count, not on time,
    // so this interval only drives the display.
    useEffect(() => {
        if (phase !== "ready" && phase !== "feedback") return;
        if (clockPaused) return; // frozen display while a popup is up
        const id = setInterval(() => {
            setElapsedMs(Date.now() - startAtRef.current);
        }, 200);
        return () => clearInterval(id);
    }, [phase, clockPaused]);

    // Clear any pending timers on unmount.
    useEffect(() => () => {
        if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
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
        markFlashcard({ cardId, isCorrect, type: MARK_TYPE })
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

    /** Charge a wrong answer. Ref first: `advance` reads it. */
    const addPenalty = useCallback(() => {
        penaltyRef.current += WRONG_PENALTY_MS;
        setPenaltyMs(penaltyRef.current);
    }, []);

    const onPick = useCallback((index: number) => {
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
        mark(round.entry.id, option.isCorrect);
        advanceTimerRef.current = setTimeout(advance, FEEDBACK_MS);
    }, [phase, round, mark, advance, addPenalty]);

    /**
     * Narrate the round's clue: the headword on a word round, the whole example
     * sentence on a finale round. `speakSentence` is the right call for both — it
     * is just "speak this text with this optional pinyin hint" — and the hint
     * matters, since cloud TTS otherwise has to guess every heteronym in the line.
     */
    const speak = useCallback(() => {
        if (!round) return;
        const { speechText, speechPinyin } = roundPrompt(round);
        void tts.speakSentence(speechText, speechPinyin);
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
        // Built from the previous run's queue; the reload replaces that queue.
        pendingRoundRef.current = null;
        winRecordedRef.current = false;
        // Round numbering is derived from this, so zeroing it restarts the
        // ordinals — and with them the new run's sentence finale.
        answeredRef.current = 0;
        penaltyRef.current = 0;
        setScore(0);
        setAnswered(0);
        setPenaltyMs(0);
        setPicked(null);
        setRound(null);
        setElapsedMs(0);
        setPhase("loading");
        setRunId((n) => n + 1);
    }, []);

    // ── Render ───────────────────────────────────────────────────────────────
    const clock = formatClock(totalMs);
    /**
     * The round's clue (pinyin + English + what the speaker says), derived from
     * the round's KIND — the headword's for a word round, the example sentence's
     * for a finale round. See roundPrompt.
     */
    const prompt = round ? roundPrompt(round) : null;

    /**
     * Feedback paint for one half.
     *
     * ONLY THE TAPPED HALF is ever painted: green when the pick was right, red
     * when it was wrong. The untapped half stays neutral in both cases — a wrong
     * pick deliberately does NOT light the correct side green. The feedback
     * answers "was I right?", which is the question the player asked by tapping;
     * showing them the answer they failed to read turns a reading test into a
     * flashcard reveal, and at FEEDBACK_MS (180ms) there is no time to learn
     * from it anyway.
     */
    const feedbackFor = (index: number): OptionFeedback => {
        if (phase !== "feedback" || !round || picked === null) return "none";
        if (index !== picked) return "none";
        return round.options[index].isCorrect ? "correct" : "wrong";
    };

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
     * It names the round the player is LOOKING AT, not the number completed: the
     * first word on screen reads `1/20` and the last reads `20/20`. That is
     * `answered + 1` while a round is awaiting its answer, and plain `answered`
     * once it has been answered — during the feedback window the same word is
     * still on screen, so the number must not tick over to the next round early.
     * A run that ends short (drained queue) keeps the last round it showed.
     *
     * The clock turns red once the run can no longer medal (past bronze), which
     * is the count-up equivalent of the old "last 10 seconds" warning: both say
     * "the thing you were racing has slipped away".
     */
    // Which round is on screen — see the doc-comment above. Clamped at both ends:
    // never 0 (the loading header would read "0/20") and never past the target.
    const currentRound = Math.min(
        phase === "ready" ? answered + 1 : Math.max(answered, 1),
        TARGET_ROUNDS,
    );
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
                {currentRound}/{TARGET_ROUNDS}
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

    // End-of-run offer to keep the lent cards; opens a beat after the end popup.
    const sortOffer = useProvisionalSortOffer(phase === "ended", queue.provisional);

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
            // Rows come straight from the served queue — no extra round-trip.
            rows={queue.provisionalTable}
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

                {(phase === "ready" || phase === "feedback" || phase === "ended") && round && prompt && (
                    <Box
                        className="speed-reading__play"
                        sx={{
                            position: "relative",
                            flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: "center",
                        }}
                    >
                        {/* ── The controls: the two HALVES of the play area ─────
                            An answer is "tap your side of the screen", not "hit the
                            word" — a target half the play area wide, which under a
                            clock is the whole ergonomic story. These zones are the
                            BACKGROUND layer, stretched over the full area; the
                            visible content floats above them with pointer events
                            off, so a tap anywhere on a half reaches its zone
                            regardless of what is drawn on top. The zone also paints
                            the green/red answer feedback (see SpeedReadingTapZone).

                            There is nothing else on this screen — the two halves are
                            the ONLY controls, apart from the prompt's speaker button.
                            Skip was removed: see the page doc-comment. */}
                        <Box
                            className="speed-reading__zones"
                            sx={{ position: "absolute", inset: 0, display: "flex", flexDirection: "row" }}
                        >
                            {/* The zones are positional, not word-bound — only the index matters. */}
                            {round.options.map((_option, i) => (
                                <SpeedReadingTapZone
                                    key={i}
                                    side={i === 0 ? "left" : "right"}
                                    feedback={feedbackFor(i)}
                                    // Frozen during feedback so a double-tap can't
                                    // mark the next round.
                                    disabled={phase !== "ready"}
                                    onPick={() => onPick(i)}
                                />
                            ))}
                        </Box>

                        {/* Prompt and options are ONE GROUP, centred in the play
                            area. The prompt sits directly on top of the words
                            rather than being pushed to the top of the screen: the
                            player reads the prompt and then compares the options in
                            one motion, so the eye should not have to travel the
                            height of the page between them.

                            ⚠️ This whole layer is `pointer-events: none` so every
                            tap falls through to the zones behind it. Anything added
                            here that must be tappable has to re-enable pointer
                            events for itself — the speaker button already does (see
                            SpeedReadingPrompt). */}
                        <Box
                            className="speed-reading__stack"
                            sx={{
                                position: "relative",
                                pointerEvents: "none",
                                flex: 1, minHeight: 0, width: "100%", display: "flex",
                                flexDirection: "column", alignItems: "center",
                                justifyContent: "center", gap: 1.5, py: 2.5,
                            }}
                        >
                            <SpeedReadingPrompt
                                pinyin={prompt.pinyin}
                                english={prompt.english}
                                onSpeak={speak}
                                // `speakingKey` is the TEXT being spoken, which on
                                // a finale round is the sentence, not the headword.
                                speaking={tts.speakingKey === prompt.speechText}
                                compact={round.kind === "sentence"}
                            />

                            {/* Options sit SIDE BY SIDE, so the pair is read as one
                                unit — they differ by a single character, and that is
                                the comparison the game asks for. Each word takes an
                                equal share of the row and the row has NO gap, so each
                                word sits centred on the tap zone behind it — the word
                                is the label of its half.

                                The cost is width: each word gets half the screen, and
                                it is a fixed-size cpcd row (OPTION_GLYPH_SIZE = "xl")
                                that WRAPS rather than shrinking when it doesn't fit.
                                Both options are the same length, so they wrap the same
                                way and neither side hints at the answer. */}
                            <Box
                                className="speed-reading__options"
                                sx={{
                                    width: "100%",
                                    display: "flex",
                                    flexDirection: "row",
                                    alignItems: "stretch",
                                }}
                            >
                                {round.options.map((option, i) => (
                                    <SpeedReadingOptionText
                                        key={i}
                                        option={option}
                                        // Both halves always get the SAME size —
                                        // a per-option size would leak the answer.
                                        size={round.kind === "sentence"
                                            ? OPTION_SENTENCE_GLYPH_SIZE
                                            : OPTION_GLYPH_SIZE}
                                    />
                                ))}
                            </Box>
                        </Box>
                    </Box>
                )}

                {/* Non-minimizable on purpose: no minimize handlers are passed, so the ×
                    and the corner puck are not rendered. Unlike the other games there is
                    no post-run cleanup to do on the board — the run is a fixed set of
                    rounds and the board behind is spent — so the only exits are Play
                    Again and Back to Games.

                    The comment sits OUTSIDE the `&&` on purpose: a JSX comment is an
                    expression, so as the first child of a `cond && ( … )` body it makes
                    two siblings with no fragment around them, which esbuild rejects
                    outright (tsc lets it through, so the repo typechecks and the build
                    still fails). */}
                {phase === "ended" && (
                    <GameEndPopup classPrefix="speed-reading">
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

                {/* Opens a beat after the end popup and stacks over it, collapsing to
                    the opposite corner. Renders nothing unless this run used lent cards. */}
                <ProvisionalSortOffer
                    open={sortOffer.open}
                    words={queue.provisional}
                    language={(user?.selectedLanguage ?? "zh") as Language}
                    onDismiss={sortOffer.dismiss}
                    minimized={sortOffer.minimized}
                    onMinimize={sortOffer.onMinimize}
                    onRestore={sortOffer.onRestore}
                />
            </Box>
            </Box>
            )}

            {/* Backgrounding paused the round — the app-wide rule
                (docs/GAMES_FEATURE.md § Backgrounding pauses the clock). A SIBLING of
                the board, like GameEndPopup, so the layout does not change shape when
                paused; it covers the board so the pause cannot be used as a free look
                at it, and the clock only restarts when the player taps Resume. */}
            <GamePausedOverlay
                open={backgroundPaused}
                onResume={resumeFromBackground}
                classPrefix="speed-reading"
            />
        </LeafPage>
        </>
    );
};

export default SpeedReadingPage;
