import type { ComponentType } from "react";
import type { PreloadableComponent } from "../runtime/lazyWithPreload";
import type { Language, MarkType } from "../../types";
import type { GameDef, GameStageFrameProps } from "../types";
import type { FlpWorld } from "../../../server/contracts/studyMode";
import type { PersonalBestGame } from "../../../server/contracts/personalBests";
import type { RunTiers } from "../shared/runTiers";

/**
 * flp game breaks — the engine-side contract (docs/FLP_GAME_BREAKS.md).
 *
 * The flp (features/flashcards) decides WHEN a break happens and owns the full-screen
 * layer; this folder decides WHICH game, and adapts each game's Stage to that host.
 * Direction: features → games only (docs/FRONTEND_LAYERING.md); nothing here imports
 * the flp.
 */

/**
 * Everything about the flp session a break's game needs to deal its board.
 *
 * The flp only ever runs inside the Deck Tower, unrestricted: there is no study mode
 * (every break deals the game's own Mix distribution), no launch collection, and no
 * routed-vs-tower distinction (a game that has a smaller tower board always deals it).
 */
export interface FlpBreakContext {
    language: Language;
    /** The flp bar — picks the track (§ 3) and the pinyin display (§ 5a). */
    world: FlpWorld;
    /** The working loop at the moment the break fell due — the seed (§ 4). */
    seedIds: number[];
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
    /** The card's heading: "Finished!", "Run ended". */
    title: string;
    /**
     * The run's speed and accuracy grades with their figures, shown as two large panels
     * under the heading, speed on top (src/games/shared/RunTierPanels.tsx). When set, the
     * panels are ALL the card shows: `score` and `details` are not rendered, and the
     * personal best moves into the speed panel. Null when the run did not finish.
     */
    tiers: RunTiers | null;
    /** An UNFINISHED run's headline figure: "7 of 30 pairs matched". Hidden when `tiers` is set. */
    score: string;
    /** An UNFINISHED run's secondary lines. Hidden when `tiers` is set. */
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
     * A correct mark the server RECORDED on a card the learner owns, with that card's
     * id: the card has left the Deck Tower, and if it is in the working loop it leaves
     * the loop too (§ 4a). Not a suppressed mark (the card was resting, so it was not on
     * the tower) and not a lent card (never counted on it). Fired off the mark's response.
     * A character game passes the CHARACTER's card id — only a loop card that is that
     * single character leaves the loop.
     */
    onCardCleared?: (cardId: number) => void;
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
     * The game is played LANDSCAPE (Speed Reading, `useSidewaysStage`). The break's card
     * and its results card then turn 90° the same way as the game, so the learner turns
     * the phone before Play and reads the results before turning it back (§ 5, § 5b).
     * Omit for an upright game.
     */
    sideways?: boolean;
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
    /**
     * The break hides the narration audio chip in its header row (GameBreakChrome). The row
     * is drawn from the first frame of the grow, before the Stage mounts, so this is the
     * adapter's call rather than the Stage's. Omit for a game that narrates.
     */
    hidesAudioChip?: (candidate: FlpBreakCandidate) => boolean;
    /**
     * Lazy, so the flp bundle does not carry every game; preloadable, so the host fetches
     * the chunk when the break falls due rather than on the frame the game mounts (§ 1).
     */
    Stage: PreloadableComponent<ComponentType<FlpBreakStageProps<P>>>;
}
