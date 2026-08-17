import type { ChallengeScoringSpec, Language, MarkType } from "../types";
import type { LazyExoticComponent, ComponentType } from "react";

/**
 * A single registered game. The hub menu renders one row per GameDef, and
 * `src/App.tsx` mounts each game at its `route` via `Component`.
 */
export interface GameDef {
    /** Stable slug shared with the backend `gameassets.gameId` column. */
    gameId: string;
    /** Hub menu row label. */
    title: string;
    /** Short blurb shown under the title in the hub row. */
    subtitle?: string;
    /** Vite-imported icon URL for the hub row's leading slot. */
    iconAsset?: string;
    /** Frontend route, e.g. "/games/memory-match". */
    route: string;
    /** Persistent hub card background color, e.g. `COLORS.blueAccent`. Assigned
        once per game here — not randomized at render time. */
    bgColor: string;
    /** Lazy-loaded page component for the game. Page components take no props,
        so the default `ComponentType` ({}-props) is what `React.lazy` of a plain
        `React.FC` resolves to. */
    Component: LazyExoticComponent<ComponentType>;
    /** When true, hide the game from public/demo accounts. Defaults to false. */
    requiresAuth?: boolean;
    /**
     * The single mastery track this game feeds (docs/MASTERY_REWORK.md). The hub
     * renders it as a MarkTypeChip on the game's card(s) so a player can see which
     * track a game trains before opening it.
     *
     * Always set it from the game's own `MARK_TYPE` constant rather than repeating
     * the literal here — that constant is what the game's pool query and mark call
     * use, so sourcing the chip from it makes the label unfalsifiable.
     *
     * OMIT for a game whose mark type varies by mode; that game's hub strip labels
     * each sub-card from its own mode config instead. Word Search is the only such
     * game today (Pinyin → production, No Pinyin → reading; see
     * WordSearchModeConfig.markType).
     */
    markType?: MarkType;
    /**
     * Languages this game can be played in. Omit for language-agnostic games
     * (the default — the first three games all work in any language).
     *
     * Speed Reading is structurally zh-only: a round is built by substituting ONE
     * character of the headword, and "a different character" has no Spanish
     * analogue that isn't just "a different word" — which is a different game.
     * The hub HIDES a game whose languages exclude the learner's selection rather
     * than showing it and blocking on entry, because a visible-but-dead row reads
     * as a bug.
     */
    languages?: Language[];
    /** Optional gating rules evaluated at hub render time. */
    unlock?: {
        minVocabEntries?: number;
    };
    /**
     * How this game scores a Study Challenge round (docs/STUDY_CHALLENGE.md § 5.4,
     * docs/GAMES_FEATURE.md § Challenge-eligible games).
     *
     * MANDATORY for a game whose `markType` is `recognition` or `production`, not
     * opt-in: the challenge-eligible pool is DERIVED from this registry (never
     * hand-listed), so a new recognition/production game joins the rotation the day
     * it ships and must arrive knowing how to be scored.
     *
     * A game is challenge-eligible iff its mark type is recognition/production AND
     * this field is present — see `challengeEligibleGames()` in registry.ts.
     *
     * For a MODED game, eligibility is per mode and so is the spec: omit this field
     * and put a spec on each eligible mode's config instead. Word Search is the only
     * such game today — eligible as Pinyin (production), not as No Pinyin (reading) —
     * which is why a challenge's stored game sequence is a `(gameId, mode)` pair.
     */
    challengeScoring?: ChallengeScoringSpec;
}

/** A single asset row fetched from `/api/games/:gameId/assets`. */
export interface GameAsset {
    id: string;
    gameId: string;
    assetId: string;
    displayName: string | null;
    imagePath: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
}

/** A save-state row fetched from `/api/games/:gameId/progress`. */
export interface GameProgress {
    id: string;
    userId: string;
    gameId: string;
    state: Record<string, unknown>;
    updatedAt: string;
}
