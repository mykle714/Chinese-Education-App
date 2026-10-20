import type { ComponentType, LazyExoticComponent } from "react";
import type { Language, MarkType } from "../../types";
import type { GameDef, GameStageFrameProps } from "../types";
import type { CollectionRef } from "../../features/flashcards/collectionRef";
import type { FlpWorld, StudyMode } from "../../../server/contracts/studyMode";
import type { PersonalBestGame } from "../../../server/contracts/personalBests";

/**
 * flp game breaks — the engine-side contract (docs/FLP_GAME_BREAKS.md).
 *
 * The flp (features/flashcards) decides WHEN a break happens and owns the slide-up
 * area; this folder decides WHICH game, and adapts each game's Stage to that host.
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

/** What the flp host hands a break's Stage. */
export interface FlpBreakStageProps<P> {
    candidate: FlpBreakCandidate;
    context: FlpBreakContext;
    /** The adapter's `prefetch` result, or null when it failed / hasn't landed —
        the Stage then fetches its own opening board. */
    prefetched: P | null;
    /** The host's chrome: the game area's header with Leave (GameBreakFrame). */
    Frame: ComponentType<GameStageFrameProps>;
    /** "Back to cards" — the break is over. */
    onDone: () => void;
}

/** The title card's personal-best row (`usePersonalBest` + `PersonalBestLine`). */
export interface FlpBreakPersonalBest {
    game: PersonalBestGame;
    mode: string | number | null;
    /** Count games: the unit after the number ("pairs"). */
    unitLabel?: string;
}

/**
 * A game that can run as an flp break. A game with no adapter is simply never picked,
 * so games join the rotation one at a time as their Stage is extracted (§ 6).
 */
export interface FlpBreakGame<P = unknown> {
    gameId: string;
    /** The title card's one-line rule (§ 5). */
    rulesLine: string;
    /** The title card's medal targets, e.g. "🥇 9 · 🥈 6 · 🥉 3 pairs". Null = none. */
    medalLine: (candidate: FlpBreakCandidate, context: FlpBreakContext) => string | null;
    /** The title card's personal best, or null for a game that keeps none. */
    personalBest: (candidate: FlpBreakCandidate, context: FlpBreakContext) => FlpBreakPersonalBest | null;
    /**
     * Fetch the opening board while the last card before the break is still on screen,
     * so Play has no spinner (§ 1). Must not throw into the flp: the host catches and
     * falls back to `prefetched: null`.
     */
    prefetch: (candidate: FlpBreakCandidate, context: FlpBreakContext) => Promise<P>;
    /** Lazy, so the flp bundle does not carry every game. */
    Stage: LazyExoticComponent<ComponentType<FlpBreakStageProps<P>>>;
}
