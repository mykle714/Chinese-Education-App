import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Box, Button, Typography } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import type { Language } from "../../types";
import ProvisionalCardsNotice from "../../components/ProvisionalCardsNotice";
import ProvisionalSortOffer from "../../components/ProvisionalSortOffer";
import { useProvisionalSortOffer } from "../../hooks/useProvisionalSortOffer";
import { GameCentered, GameFrame } from "../shared/GameFrame";
import { GameCountdown } from "../shared/GameCountdown";
import { useGameCountdown } from "../shared/useGameCountdown";
import { GAME_FRAME_EXIT_CLEARANCE_PX } from "../shared/gameFrameExit";
import { usePersonalBest } from "../shared/usePersonalBest";
import { useAuth } from "../../AuthContext";
import { markFlashcard } from "../../api/flashcards";
import { useTTS } from "../../hooks/useTTS";
import { useGameWins } from "../../hooks/useGameWins";
import { isProvisional } from "../../utils/provisionalCards";
import { SIZE, LEADING } from "../../theme/scale";
import SpeedReadingOptionText from "./SpeedReadingOptionText";
import SpeedReadingTapZone from "./SpeedReadingTapZone";
import SpeedReadingPrompt from "./SpeedReadingPrompt";
import { ROTATION_DEG, useSidewaysStage } from "../runtime/useSidewaysStage";
import { useBackgroundPause } from "../runtime/useBackgroundPause";
import { buildRound, buildSentenceRound } from "./buildRound";
import { roundPrompt } from "./roundPrompt";
import { useSpeedReadingQueue, type SpeedReadingOpening } from "./useSpeedReadingQueue";
import {
    FEEDBACK_MS,
    GAME_KEY,
    MARK_TYPE,
    OPTION_GLYPH_SIZE,
    OPTION_SENTENCE_GLYPH_SIZE,
    SENTENCE_ROUNDS,
    TARGET_ROUNDS,
    WIN_LEVEL,
    formatClock,
    runResultTiers,
} from "./constants";
import type { GameStageFrameProps } from "../types";
import type { FlpBreakResults } from "../flpBreak/types";
import type { OptionFeedback, Phase, Round } from "./types";

/** The game's name: the break's title beside Leave. */
const TITLE = "Speed Reading";

export interface SpeedReadingStageProps {
    /** The break's chrome — `GameBreakFrame` in the flp (docs/FLP_GAME_BREAKS.md § 6). */
    Frame: ComponentType<GameStageFrameProps>;
    /** The working loop to seed the opening batch with (§ 4). */
    seedIds?: number[];
    /** The pool + distractors, fetched while card 10 was on screen. */
    prefetched?: SpeedReadingOpening | null;
    /** Close the break with no results to show (a break that never dealt). */
    onDone: () => void;
    /** The destination `onDone` names, for the blocked screen's "Back to …". */
    doneLabel: string;
    /** FlpBreakStageProps `onRunEnded`: hands the results to the flp's card. */
    onRunEnded?: (results: FlpBreakResults) => void;
    /** FlpBreakStageProps `onCardCleared`. */
    onCardCleared?: (cardId: number) => void;
}

/**
 * Speed Reading — the STAGE: round state machine, card supply, marks and the run clock.
 * BREAK-ONLY: the game has no route of its own (src/games/registry.ts), so its one host
 * is an flp game break (src/games/flpBreak/speedReadingBreak.ts, docs/FLP_GAME_BREAKS.md
 * § 6).
 *
 * Read the pinyin and definition, then tap the word that matches. Both options are REAL
 * words differing in exactly one character, so the player cannot get there by shape
 * alone: they have to actually read. Where Bubble Match tests meaning-recall and Word
 * Search tests scanning, this tests READING SPEED — how fast a known word is recognised.
 *
 * Flow: loading → (blocked) → ready ⇄ feedback → ended
 * A single difficulty; there is no level picker, in-game or on the hub.
 *
 * ── The break host ──────────────────────────────────────────────────────────
 *   - the chrome: no header. `GameFrame` draws Leave + the title top-left and drops its
 *     panel, and since the frame is inside the rotated stage, Leave turns with the game;
 *   - the opening batch is seeded with the working loop, prefetched;
 *   - the results go to the flp's card (`onRunEnded`) — there is no end popup;
 *   - the way out: Leave ENDS a live run into its results card and closes the break
 *     from any other phase.
 *
 * ── The run is a RACE, not a sprint ─────────────────────────────────────────
 * The player answers a FIXED TARGET_ROUNDS (20) rounds and the clock counts UP;
 * the score is the finishing time and LOWER IS BETTER. There is no time cap — a
 * run ends when the 20th round is answered (or, degenerately, when the card
 * queue drains, which ends it with no tiers).
 *
 * NOTHING about the run's progress is drawn during play (changed 2026-11-04): no clock
 * (Match Speed, Word Search and Writing Grid show none either), no round counter and no
 * tick strip. The clock still runs and pauses exactly as before; the finishing time,
 * the accuracy and the speed / accuracy tiers appear on the break's results card. The
 * board is the prompt and the two halves, nothing else.
 *
 * Every round counts toward the 20, right or wrong, and a wrong answer is not replayed.
 * It costs no time (the +3s WRONG_PENALTY_MS was removed with the medals): a blind tap
 * is the fastest possible round, so it is priced by the run's ACCURACY tier instead.
 *
 * ── The last round is a SENTENCE ────────────────────────────────────────────
 * The final SENTENCE_ROUNDS (1) round escalates from "read this word" to "read
 * this word in context": both options are the same EXAMPLE SENTENCE, differing
 * at one character inside the target word, and the prompt shows the sentence's
 * pinyin and translation and narrates the sentence. Same controls, same
 * one-character invariant, more to scan — so the run ends on its hardest reading.
 *
 * Its card is RESERVED AT LOAD (useSpeedReadingQueue), from the initial pool
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
 * SpeedReadingOptionText).
 *
 * ── There is NO Skip ────────────────────────────────────────────────────────
 * The two halves are the only controls on the board (bar the prompt's speaker);
 * every round must be answered. In a race, skipping would be the cheapest way past a
 * word you cannot read, i.e. a free reroll, and pricing it only turns it into a strictly
 * worse version of guessing. See docs/SPEED_READING_GAME.md § There is no Skip.
 *
 * ── The clock does not pause during feedback ────────────────────────────────
 * Feedback time is charged to the player. That is what makes FEEDBACK_MS a real
 * cost rather than free reading time.
 *
 * ── Marks ───────────────────────────────────────────────────────────────────
 * Emits READING marks, positive AND negative: an honest record of the answers given.
 * No accuracy floor, no mark suppression, and no unmarked path through a round: every
 * round shown produces exactly one mark. A correct RECORDED mark on an owned card also
 * reports `onCardCleared` (docs/FLP_GAME_BREAKS.md § 4a).
 *
 * Docs: docs/SPEED_READING_GAME.md, docs/FLP_GAME_BREAKS.md.
 */
const SpeedReadingStage: React.FC<SpeedReadingStageProps> = ({
    Frame,
    seedIds,
    prefetched,
    onDone,
    doneLabel,
    onRunEnded,
    onCardCleared,
}) => {
    // Read through a ref: `mark` is deliberately stable.
    const onCardClearedRef = useRef(onCardCleared);
    onCardClearedRef.current = onCardCleared;
    const { user } = useAuth();
    const tts = useTTS();
    const { recordWin } = useGameWins(GAME_KEY);

    // `useBlockEdgeSwipe(true)` is the HOST's job (the flp break area): it must hold for
    // the whole time the game is on screen.

    const [phase, setPhase] = useState<Phase>("loading");
    /**
     * The pre-run 3·2·1 is up over the first round (src/games/shared/GameCountdown.tsx).
     * A flag beside `phase` rather than a phase: the round is drawn and "ready" in every
     * sense but input, narration and the clock, which all wait for the release.
     */
    const [counting, setCounting] = useState(false);
    const [round, setRound] = useState<Round | null>(null);
    const [picked, setPicked] = useState<number | null>(null);
    /** Correct picks so far — reported at the end, but NOT the score. */
    const [score, setScore] = useState(0);
    /** Rounds answered so far, out of TARGET_ROUNDS. */
    const [answered, setAnswered] = useState(0);
    /**
     * Wall-clock time since the first round landed. No longer ticked for display (the
     * clock is not drawn); written when a pause ends and when the run ends, which is
     * when the results read it.
     */
    const [elapsedMs, setElapsedMs] = useState(0);
    /** The break's Leave ended the run short: no time, no tiers, no personal best. */
    const [leftEarly, setLeftEarly] = useState(false);

    // One run per mount: a break plays once and hands its results to the flp's card.
    const queue = useSpeedReadingQueue({
        enabled: !!user,
        seedIds,
        prefetched,
    });
    // Announce lent cards before the first round narrates. Speed Reading plays a fixed
    // known set, so the notice names them (docs/PROVISIONAL_CARDS.md).
    const [noticeOpen, setNoticeOpen] = useState(false);
    // Feedback timer, cleared on unmount and on run end so a pending advance can
    // never fire into an ended run.
    const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** `Date.now()` at the first round of the run — the clock's origin. */
    const startAtRef = useRef<number>(0);
    /**
     * Answered-round count as a REF.
     *
     * Read inside the pick handler to decide, in the same tick, whether the run is
     * over; the matching state exists only for rendering. Reading it out of state
     * there would see the previous render's value and let a 21st round start.
     */
    const answeredRef = useRef(0);
    /**
     * Sideways rendering. Rotates the whole game 90° whenever its container is
     * taller than wide, which is what makes device rotation a non-event — see
     * the hook. Everything below the frame lives in STAGE coordinates.
     */
    const stage = useSidewaysStage();

    // ── Round construction ───────────────────────────────────────────────────
    /**
     * Pull cards until one yields a playable round.
     *
     * `roundNumber` is 1-based and decides the KIND: the last SENTENCE_ROUNDS of
     * the run (round 20 of 20) is built from the card the queue reserved at load,
     * as a sentence round. If that reservation is empty — a pool where too
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
     * Warm a round's cloud audio one round AHEAD, so a synthesis round-trip is spent
     * while the player is still reading the current round rather than added to their
     * time. A sentence round narrates the SENTENCE, a different cache key than the
     * headword (the cloud cache is keyed on text+pinyin+voice).
     */
    const prefetchRound = useCallback((r: Round) => {
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
     * CONSTRUCTED rounds instead drifts ahead of the player on any build that
     * doesn't reach the screen, and React StrictMode double-invokes the run-start
     * effect in dev, so such a counter starts ahead and lands the sentence finale in
     * the middle of the run. Deriving the ordinal from ANSWERS is self-correcting.
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

        // Prepare one round ahead. Not past the target: a 21st round would never be
        // shown, and building one would burn a card.
        const ahead = ordinal < TARGET_ROUNDS ? takeRound(ordinal + 1) : null;
        if (ahead) {
            pendingRoundRef.current = { ordinal: ordinal + 1, round: ahead };
            prefetchRound(ahead);
        }
        return true;
    }, [takeRound, prefetchRound]);

    // ── Run start ────────────────────────────────────────────────────────────
    /**
     * Whether this effect has already armed the run, so it arms it EXACTLY once.
     * React StrictMode invokes mount effects twice in dev, and a second arming
     * burns the cards of the round already built, re-narrates, and re-stamps the
     * clock's origin. State can't be the guard here — the first invocation's
     * `setPhase` has not flushed by the time the second runs.
     */
    const armedRef = useRef(false);
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
        if (armedRef.current) return;
        armedRef.current = true;

        // Arm the shared AudioContext before the first round auto-narrates. The tap
        // that opened this run happened before the queue resolved, so there is no
        // gesture in flight; without this, mobile autoplay policy can leave the
        // context suspended and swallow the first word.
        tts.unlockAudio();

        // Start the clock at the first playable round, not at mount — otherwise a
        // slow initial fetch would be charged to the player's time.
        if (nextRound()) {
            setNoticeOpen(queue.provisional.length > 0);
            startAtRef.current = Date.now();
            setElapsedMs(0);
            setCounting(true);
            setPhase("ready");
        } else {
            setPhase("blocked");
        }
        // Runs once, the first time the queue reports ready. `nextRound` is
        // intentionally excluded: it changes identity with the queue and would
        // restart the run.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queue.ready, queue.loading, queue.blockMessage, user?.id]);

    // ── Popup pause gate ─────────────────────────────────────────────────────
    // No game clock may run while a MODAL popup covers the board, and none while the
    // app is backgrounded (docs/GAMES_FEATURE.md § Popups pause the clock,
    // § Backgrounding pauses the clock). This game's score IS its elapsed time, so
    // either would be charged straight to the player's result. The live phases are
    // "ready" and "feedback" (feedback time is part of the clock, see ./types.ts).
    const { paused: backgroundPaused } =
        useBackgroundPause(phase === "ready" || phase === "feedback");
    // The countdown is the third source: its span is un-billed exactly like a pause.
    const clockPaused = noticeOpen || backgroundPaused || counting;

    // 3·2·1 over the first round, once the lent-cards notice is dismissed (it sits under
    // the countdown's screen-wide dim, so the two are never up together). Holds while the
    // app is backgrounded. Gated on "ready", so a Leave mid-count takes the dim down.
    const countdownStep = useGameCountdown({
        active: counting && phase === "ready" && !noticeOpen,
        paused: backgroundPaused,
        onRelease: () => setCounting(false),
    });
    /** `Date.now()` when the current pause began, or null while running. */
    const pausedAtRef = useRef<number | null>(null);
    useEffect(() => {
        if (clockPaused) {
            pausedAtRef.current = Date.now();
            return;
        }
        if (pausedAtRef.current === null) return;
        // Push the run's ORIGIN forward by the paused span. Every reader of the clock
        // (the end-of-run `endRun`) measures from startAtRef, so moving it is all that's
        // needed to un-bill the pause.
        startAtRef.current += Date.now() - pausedAtRef.current;
        pausedAtRef.current = null;
        setElapsedMs(Date.now() - startAtRef.current);
    }, [clockPaused]);

    // Clear any pending timers on unmount.
    useEffect(() => () => {
        if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    }, []);

    // ── Marks ────────────────────────────────────────────────────────────────
    /**
     * Record a READING mark. Fire-and-forget with a `.catch()` — the game never
     * blocks on it, and a failure only logs.
     *
     * A correct mark the server RECORDED, on a card the learner owns, takes that card
     * off the Deck Tower and out of the flp's working loop (`onCardCleared`,
     * docs/FLP_GAME_BREAKS.md § 4a). Not a suppressed mark (the card was resting), not a
     * lent card, and not a focused break's off-set card (`outsideFocus`): none of those
     * was ever on the tower.
     *
     * No `token` dep — markFlashcard resolves the auth header at call time, so this
     * callback's identity survives the silent refresh (CLAUDE.md).
     */
    const mark = useCallback((entry: Round["entry"], isCorrect: boolean) => {
        markFlashcard({ cardId: entry.id, isCorrect, type: MARK_TYPE, surface: "speed-reading" })
            .then((result) => {
                if (isCorrect && !result.suppressed && !isProvisional(entry) && !entry.outsideFocus) {
                    onCardClearedRef.current?.(entry.id);
                }
            })
            .catch((err) => console.error(`[SpeedReading] mark failed → card ${entry.id}:`, err));
    }, []);

    // ── Ending and advancing ─────────────────────────────────────────────────
    /**
     * Stop the run and freeze the clock. The final time is taken from `Date.now()`,
     * not from state, so the score is the real elapsed time.
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
            // Queue drained (a failed top-up, or a run of unplayable cards). End the
            // run rather than stalling on an empty screen — an unfinished run earns no
            // tiers however fast it was, see `finished` below.
            endRun();
        }
    }, [nextRound, endRun]);

    const onPick = useCallback((index: number) => {
        if (phase !== "ready" || !round || counting) return;
        const option = round.options[index];
        setPicked(index);
        setPhase("feedback");
        // Every round counts toward the target, right or wrong; a wrong one lowers the
        // accuracy tier instead of costing an extra round. There is no Skip, so this is
        // the only path that advances the counter.
        answeredRef.current += 1;
        setAnswered(answeredRef.current);
        if (option.isCorrect) setScore((s) => s + 1);
        mark(round.entry, option.isCorrect);
        advanceTimerRef.current = setTimeout(advance, FEEDBACK_MS);
    }, [phase, round, counting, mark, advance]);

    /**
     * Narrate the round's clue: the headword on a word round, the whole example
     * sentence on a finale round. `speakSentence` is "speak this text with this
     * optional pinyin hint", and the hint matters for heteronyms.
     */
    const speak = useCallback(() => {
        if (!round) return;
        const { speechText, speechPinyin } = roundPrompt(round);
        void tts.speakSentence(speechText, speechPinyin);
    }, [round, tts]);

    /**
     * The AUTOMATIC variant of speak(): gated by the autoplay setting, so it stays
     * silent in 'off' mode. The speaker BUTTON keeps the manual `speak`.
     */
    const autoSpeak = useCallback(() => {
        if (!round) return;
        const { speechText, speechPinyin } = roundPrompt(round);
        void tts.autoSpeakSentence(speechText, speechPinyin);
    }, [round, tts]);

    /**
     * Auto-narration: every round speaks its clue as it lands — under a clock, a tap
     * spent on the speaker is a tap not spent answering. Guarded on ROUND IDENTITY
     * rather than on a dep list: `autoSpeak` changes identity whenever `tts` does
     * (every render), so the ref is what makes narration fire exactly once per round.
     */
    const spokenRoundRef = useRef<Round | null>(null);
    useEffect(() => {
        // "ready" only: no narration during feedback, and none once the run ends. The first
        // round waits for the countdown, so its word lands with the release beep, not under the count.
        if (phase !== "ready" || !round || counting) return;
        if (spokenRoundRef.current === round) return;
        spokenRoundRef.current = round;
        autoSpeak();
    }, [phase, round, counting, autoSpeak]);

    // ── Score ────────────────────────────────────────────────────────────────
    /** The score: wall-clock time, LOWER IS BETTER. Read at the end. */
    const totalMs = elapsedMs;
    /**
     * Tiers, a win and a personal best all require a FINISHED run. A run cut short by a
     * drained queue (or by a break's Leave) has a small time that would otherwise buy
     * speed tier 1.
     */
    const finished = answered >= TARGET_ROUNDS;

    // Record the win once, when the run ends finished (wins are not gated on a tier).
    const winRecordedRef = useRef(false);
    useEffect(() => {
        if (phase !== "ended" || winRecordedRef.current) return;
        if (finished) {
            winRecordedRef.current = true;
            recordWin(WIN_LEVEL);
        }
    }, [phase, finished, recordWin]);

    // Fastest finished run (docs/SPEED_READING_GAME.md § Personal best). The game has a
    // single difficulty, so every run competes under one "default" mode key. Only a run that completed all TARGET_ROUNDS is recorded.
    // `record` guards a second submit itself, so this effect re-running is harmless.
    // `newBestRef` holds the verdict for the break's results card, which can settle after
    // the Stage unmounts. Declared BEFORE the `onRunEnded` effect below, which reads it in
    // the same commit.
    const { best: personalBestMs, record: recordPersonalBest } =
        usePersonalBest("speed-reading", "default");
    const newBestRef = useRef<Promise<boolean>>(Promise.resolve(false));
    useEffect(() => {
        if (phase !== "ended" || !finished) return;
        newBestRef.current = recordPersonalBest(totalMs);
    }, [phase, finished, totalMs, recordPersonalBest]);

    // End-of-run offer to keep the lent cards; opens a beat after the run ends.
    const sortOffer = useProvisionalSortOffer(phase === "ended", queue.provisional);
    const dismissSortOffer = sortOffer.dismiss;

    /**
     * The break's Leave (docs/FLP_GAME_BREAKS.md § 2). A LIVE run ends where it is,
     * so it has no finishing time, and so no tiers, win or personal best. A run whose
     * 20th answer is already in (its feedback window) simply ends finished. A finished
     * run is only still here for the sort offer: Leave is its "not now". From every
     * other phase there is nothing to show, so the break closes.
     */
    const leaveBreak = useCallback(() => {
        if (phase === "ready" || phase === "feedback") {
            if (answeredRef.current < TARGET_ROUNDS) setLeftEarly(true);
            endRun();
            return;
        }
        if (phase === "ended") {
            dismissSortOffer();
            return;
        }
        onDone();
        // `dismissSortOffer` is a fresh closure over stable setters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, onDone, endRun]);

    /** The run's heading on the break's results card. */
    const resultTitle = leftEarly ? "Run ended"
        : finished ? "Finished!"
        : "Out of cards";
    /** The breakdown line under a finished run's time. */
    const accuracyLine = `${score}/${TARGET_ROUNDS} correct`;

    // The run reports to the flp (there is no end popup), which is what starts the
    // shrink back to the card. A lent-card offer holds it: the offer lives over
    // this board, so it has to be answered before the board goes.
    const sortOfferPending = queue.provisional.length > 0 && !sortOffer.dismissed;
    useEffect(() => {
        if (phase !== "ended" || sortOfferPending) return;
        const bestBefore = personalBestMs;
        const finalMs = totalMs;
        onRunEnded?.({
            title: resultTitle,
            tiers: finished ? runResultTiers(finalMs, score) : null,
            score: finished ? formatClock(finalMs) : `${answered} of ${TARGET_ROUNDS} rounds`,
            details: finished ? [accuracyLine] : [`${score}/${answered} correct · no time recorded`],
            personalBest: finished
                ? newBestRef.current.then((isNew) => {
                    const best = isNew ? finalMs : bestBefore;
                    return best === null ? null : { game: "speed-reading", best, isNewBest: isNew };
                })
                : Promise.resolve(null),
        });
        // Once per run: nothing on the board can move after the run ends.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, sortOfferPending]);

    // ── Render ───────────────────────────────────────────────────────────────
    /**
     * The round's clue (pinyin + English + what the speaker says), derived from the
     * round's KIND — the headword's for a word round, the example sentence's for a
     * finale round. See roundPrompt.
     */
    const prompt = round ? roundPrompt(round) : null;

    /**
     * Feedback paint for one half. ONLY THE TAPPED HALF is ever painted: green when the
     * pick was right, red when it was wrong. A wrong pick deliberately does NOT light the
     * correct side green — that would turn a reading test into a flashcard reveal.
     */
    const feedbackFor = (index: number): OptionFeedback => {
        if (phase !== "feedback" || !round || picked === null) return "none";
        if (index !== picked) return "none";
        return round.options[index].isCorrect ? "correct" : "wrong";
    };

    // Shared with the other games (`GameCentered`), which also owns the rule that text
    // sitting on the accent ground is white rather than ink.
    const centered = (children: React.ReactNode) => (
        <GameCentered className="speed-reading__overlay">{children}</GameCentered>
    );

    /**
     * There is no HUD and no header: the board starts below Leave's row, as Match
     * Speed's does, so the arrow and title never sit over the prompt or a tap zone.
     */
    const exitClearance = (
        <Box className="speed-reading__exit-clearance" sx={{ flexShrink: 0, height: GAME_FRAME_EXIT_CLEARANCE_PX }} />
    );

    const content = (
        <Box
            // NOT rotated: this is the container whose SHAPE decides whether the stage
            // rotates, and the only element whose bounding rect is a true rect (see
            // useSidewaysStage.toStageCoords).
            className="speed-reading__frame"
            ref={stage.outerRef}
            sx={{
                position: "relative",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                // Nothing in this game scrolls.
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
            {phase === "loading" && centered(<DelayedCircularProgress className="speed-reading__spinner" />)}

            {phase === "blocked" && centered(
                <>
                    <Typography
                        className="speed-reading__block-msg"
                        sx={{ fontSize: SIZE.subtitle, lineHeight: LEADING.normal }}
                    >
                        {queue.blockMessage
                            || (!user ? "Sign in to play Speed Reading."
                                : "No cards are playable right now. Study more cards and try again.")}
                    </Typography>
                    <Button className="speed-reading__block-back" variant="contained" onClick={onDone}>
                        Back to {doneLabel}
                    </Button>
                </>
            )}

            {(phase === "ready" || phase === "feedback" || phase === "ended") && round && prompt && (
                /* `.play` — in a break the frame drops its panel and draws Leave
                   (FLP_GAME_BREAKS.md § 6). It lives INSIDE the rotated stage, so its
                   chrome turns with the game. */
                <GameFrame className="speed-reading__play">
                    {/* ⚠️ The clearance is a SIBLING of the board box below, not a child
                        of it. The tap zones are `position: absolute; inset: 0` of their
                        container, so anything added inside the board is UNDER them and
                        every tap on it answers the round. */}
                    {exitClearance}

                    {/* The board: the zones and the content they sit behind. Its own box,
                        so the zones' `inset: 0` means "the play area" and nothing else. */}
                    <Box
                        className="speed-reading__board"
                        sx={{
                            position: "relative",
                            flex: 1,
                            minHeight: 0,
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                    {/* ── The controls: the two HALVES of the play area ─────────────
                        The BACKGROUND layer, stretched over the full area; the visible
                        content floats above with pointer events off, so a tap anywhere
                        on a half reaches its zone. The zone also paints the green/red
                        answer feedback (see SpeedReadingTapZone). */}
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
                                // Frozen during feedback so a double-tap can't mark the
                                // next round.
                                disabled={phase !== "ready"}
                                onPick={() => onPick(i)}
                            />
                        ))}
                    </Box>

                    {/* Prompt and options are ONE GROUP, centred in the play area, so the
                        player reads the prompt and compares the options in one motion.

                        ⚠️ This whole layer is `pointer-events: none` so every tap falls
                        through to the zones behind it. Anything added here that must be
                        tappable has to re-enable pointer events for itself — the speaker
                        button already does (see SpeedReadingPrompt). */}
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
                            // `speakingKey` is the TEXT being spoken, which on a finale
                            // round is the sentence, not the headword.
                            speaking={tts.speakingKey === prompt.speechText}
                            compact={round.kind === "sentence"}
                        />

                        {/* Options sit SIDE BY SIDE, each centred on the tap zone behind
                            it (equal shares, no gap). A fixed-size cpcd row that WRAPS
                            rather than shrinking; both options are the same length, so
                            they wrap the same way and neither side hints at the answer. */}
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
                                    // Both halves always get the SAME size — a
                                    // per-option size would leak the answer.
                                    size={round.kind === "sentence"
                                        ? OPTION_SENTENCE_GLYPH_SIZE
                                        : OPTION_GLYPH_SIZE}
                                />
                            ))}
                        </Box>
                    </Box>
                    </Box>

                    {/* The digit turns with the stage; the dim itself is portaled out of it. */}
                    <GameCountdown
                        step={countdownStep}
                        rotateDeg={stage.rotated ? ROTATION_DEG : 0}
                        classPrefix="speed-reading"
                    />
                </GameFrame>
            )}

            {/* Opens a beat after the run ends; it holds the break's results until it is
                answered. Renders nothing unless this run used lent cards. `inPlace`: this
                stage ROTATES and already covers the whole screen, so a frame-hosted
                popup would draw upright over a sideways game. */}
            <ProvisionalSortOffer
                open={sortOffer.open}
                words={queue.provisional}
                language={(user?.selectedLanguage ?? "zh") as Language}
                onDismiss={sortOffer.dismiss}
                onNothingToOffer={sortOffer.dismiss}
                minimized={sortOffer.minimized}
                onMinimize={sortOffer.onMinimize}
                onRestore={sortOffer.onRestore}
                inPlace
            />
        </Box>
        </Box>
    );

    return (
        <>
            <ProvisionalCardsNotice
                open={noticeOpen}
                onDismiss={() => setNoticeOpen(false)}
                surfaceName={TITLE}
                // The lent cards come straight from the served queue — no extra round-trip.
                entries={queue.provisionalTable}
                language={(user?.selectedLanguage ?? "zh") as Language}
            />
            {/* The break's `Frame` supplies the chrome: the bare screen. */}
            <Frame title={TITLE} onExitRequest={leaveBreak}>
                {content}
            </Frame>
        </>
    );
};

export default SpeedReadingStage;
