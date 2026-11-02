import type { ComponentType, LazyExoticComponent } from "react";
import type { Language, MarkType } from "../../types";
import type { GameDef, GameStageFrameProps } from "../types";
import type { CollectionRef } from "../../features/flashcards/collectionRef";
import type { FlpWorld, StudyMode } from "../../../server/contracts/studyMode";
import type { PersonalBestGame } from "../../../server/contracts/personalBests";

/**
 * flp game breaks — the engine-side contract (docs/FLP_GAME_BREAKS.md).
 *
 * The flp (features/flashcards) decides WHEN a break happens and owns the full-screen
 * layer; this folder decides WHICH game, and adapts each game's Stage to that host.
 * Direction: features → games only (docs/FRONTEND_LAYERING.md); nothing here imports
 * the flp.
 */

/** Everything about the flp session a break's game needs to deal its board. */
export interface FlpBreakContext {
    language: Language;
    /** The flp bar — picks the track (§ 3) and the pinyin display (§ 5a). */
    world: FlpWorld;
    /** The flp's `?mode=`; the top-up honours its distribution (§ 4). Null = Mix. */
    studyMode: StudyMode | null;
    /** The deck/collection the flp was launched with; rides every pool request (§ 4). */
    collection: CollectionRef | null;
    /** The working loop at the moment the break fell due — the seed (§ 4). */
    seedIds: number[];
    /** The flp is running inside a Deck Tower session. A game may deal a smaller board. */
    towerSession: boolean;
}

/** One playable break option: a game, the mode it runs in, and the track it marks. */
export interface FlpBreakCandidate {
    game: GameDef;
    /** A moded game's mode slug (Word Search, Bucket Drop); null otherwise. */
    mode: string | null;
    /** The track this run marks — always on the flp's bar. */
    markType: MarkType;
    /** Pinyin on the board — follows the bar (core shown, reading hidden; § 5a). */
    showPinyin: boolean;
    /** `${gameId}:${mode}` — the never-twice-in-a-row key (§ 3). */
    key: string;
}

/** A run's personal best, as the results card shows it (`PersonalBestLine`). */
export interface FlpBreakPersonalBest {
    game: PersonalBestGame;
    best: number;
    isNewBest: boolean;
}

/**
 * What a finished run hands the flp for the break's results card
 * (docs/FLP_GAME_BREAKS.md § 5b). Display strings, so the card stays one component
 * however a game scores.
 */
export interface FlpBreakResults {
    /** The card's heading: "🥇 Gold!", "Time!". */
    title: string;
    /** The run's headline figure: "7 pairs matched". */
    score: string;
    /** Secondary figures, one line each: "Accuracy 7/8 (88%)". */
    details: string[];
    /**
     * Settles once the server has judged the run. A promise because that answer can land
     * after the Stage has unmounted; null when there is no best to show. Must not reject.
     */
    personalBest: Promise<FlpBreakPersonalBest | null>;
}

/** What the flp host hands a break's Stage. */
export interface FlpBreakStageProps<P> {
    candidate: FlpBreakCandidate;
    context: FlpBreakContext;
    /** The adapter's `prefetch` result, or null when it failed / hasn't landed —
        the Stage then fetches its own opening board. */
    prefetched: P | null;
    /** The host's chrome: the full-screen ground, and Leave (GameBreakFrame). */
    Frame: ComponentType<GameStageFrameProps>;
    /** The break closes with no run to report (a load that failed, Leave before a deal). */
    onDone: () => void;
    /**
     * The run is over: the host shrinks the game back onto the break's card, which now
     * shows `results` (§ 2). A Stage calls it once, instead of showing an end card.
     */
    onRunEnded: (results: FlpBreakResults) => void;
    /**
     * A correct mark the server RECORDED on a card the learner owns: that card has left
     * the Deck Tower. Not a suppressed mark (the card was resting, so it was not on the
     * tower) and not a lent card (never counted on it). Fired off the mark's response.
     */
    onCardCleared?: () => void;
}

/**
 * A game that can run as an flp break. A game with no adapter is simply never picked,
 * so games join the rotation one at a time as their Stage is extracted (§ 6).
 */
export interface FlpBreakGame<P = unknown> {
    gameId: string;
    /** The break card's one-line rule (§ 5). */
    rulesLine: string;
    /**
     * Fetch the opening board while the last card before the break is still on screen,
     * so Play has no spinner (§ 1). Must not throw into the flp: the host catches and
     * falls back to `prefetched: null`.
     */
    prefetch: (candidate: FlpBreakCandidate, context: FlpBreakContext) => Promise<P>;
    /**
     * False when a prefetched board cannot be played, so the flp picks another game instead
     * of opening a dead end (§ 4). Omit for a game that can always deal what it was sent.
     */
    isPlayable?: (prefetched: P) => boolean;
    /**
     * The fewest focus cards this break needs, when its board is smaller than the game's
     * own (FOCUS_MODE.md § 5). Omit to use `focusGameMinimum(gameId)`.
     */
    focusMinimum?: (context: FlpBreakContext) => number;
    /** Lazy, so the flp bundle does not carry every game. */
    Stage: LazyExoticComponent<ComponentType<FlpBreakStageProps<P>>>;
}
