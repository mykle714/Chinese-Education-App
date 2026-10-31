import type { ComponentType, LazyExoticComponent } from "react";
import type { Language, MarkType } from "../../types";
import type { GameDef, GameStageFrameProps } from "../types";
import type { CollectionRef } from "../../features/flashcards/collectionRef";
import type { FlpWorld, StudyMode } from "../../../server/contracts/studyMode";

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
     * The game's play panel fill: what the card's grow plate turns into (§ 2). Null for a
     * game drawn straight on the ground (Match Speed): nothing grows, the card fades where
     * it is, and a tower session fades its platform and deck for the game's length.
     */
    panelFill: string | null;
    /**
     * Fetch the opening board while the last card before the break is still on screen,
     * so Play has no spinner (§ 1). Must not throw into the flp: the host catches and
     * falls back to `prefetched: null`.
     */
    prefetch: (candidate: FlpBreakCandidate, context: FlpBreakContext) => Promise<P>;
    /** Lazy, so the flp bundle does not carry every game. */
    Stage: LazyExoticComponent<ComponentType<FlpBreakStageProps<P>>>;
}
