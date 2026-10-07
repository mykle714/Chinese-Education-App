import type { ChallengeScoringSpec, Language, MarkType } from "../types";
import type { RampHue } from "../theme/colors";
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
    /**
     * Material Symbols ligature name for the hub tile's ghost glyph (see
     * components/Icon). Drawn oversized, clipped, and at 15% of the tile's own ink —
     * decoration that gives the hub a family of shapes, NOT a way to tell two games
     * apart. The title does that.
     *
     * This replaced `iconAsset`, an optional Vite-imported image URL that no game
     * ever set: every game fell through to a generic controller glyph, so the hub had
     * six identical icons and one dead code path.
     */
    glyph: string;
    /** Frontend route, e.g. "/games/memory-match". */
    route: string;
    /**
     * Persistent ramp hue for this game's hub tile — a KEY into `RAMP`, not a colour,
     * so the tile's pastel body and the matching ink of its ghost glyph can never
     * drift apart (see `RAMP` in theme/colors). Assigned once per game here; never
     * randomized at render time.
     *
     * Bubble Match is the exception: its three levels each take their own hue from a
     * difficulty ramp on the hub, so its value here is only a fallback.
     */
    hue: RampHue;
    /** Lazy-loaded page component for the game. Page components take no props,
        so the default `ComponentType` ({}-props) is what `React.lazy` of a plain
        `React.FC` resolves to. */
    Component: LazyExoticComponent<ComponentType>;
    /** When true, hide the game from public/demo accounts. Defaults to false. */
    requiresAuth?: boolean;
    /**
     * The single mastery track this game feeds (docs/MASTERY_REWORK.md). It is NOT
     * shown on the hub (name-only tiles since 2026-10-03); it drives the game's mark
     * calls and challenge eligibility.
     *
     * Always set it from the game's own `MARK_TYPE` constant rather than repeating
     * the literal here — that constant is what the game's pool query and mark call
     * use, so sourcing it from there keeps the two from drifting.
     *
     * OMIT for a game whose mark type varies by mode, and declare `modes` instead.
     * Two such games today: Word Search (Pinyin → production, No Pinyin → reading;
     * WordSearchModeConfig.markType) and Bucket Drop (Pinyin → recognition, No Pinyin →
     * reading; BucketDropModeConfig.markType).
     */
    markType?: MarkType;
    /**
     * A MODED game's per-mode PRIMARY tracks, set exactly when `markType` is omitted.
     * Word Search (Pinyin → production, No Pinyin → reading) and Bucket Drop (Pinyin →
     * recognition, No Pinyin → reading) are the two today. Read off each game's own
     * mode-config table, never restated.
     *
     * Exists so the challenge-pool sync test (src/games/__tests__/challengePool.test.ts)
     * can check every moded game's eligible modes generically — it used to special-case
     * `gameId === "word-search"`, which a second moded game would have silently slipped
     * past. PRIMARY track only: a mode's secondary marks (Word Search No Pinyin also
     * writes production) never make it challenge-eligible.
     */
    modes?: { mode: string; markType: MarkType }[];
    /**
     * Keep the game OUT of the Games hub. Its route, page and registry metadata are
     * unchanged — it is just launched from somewhere else. Speed Reading is the one
     * such game: a reading drill, launched only from the Reading Center's games
     * carousel (ReadingGamesCarousel), which reads the registry directly and ignores
     * this flag. Read by GamesPage's `visibleGames`.
     */
    hiddenFromHub?: boolean;
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
     * it has a `CHALLENGE_GAMES` entry (server/contracts/wire.ts) — this field is that
     * entry, looked up by `challengeScoringFor` in registry.ts, and
     * src/games/__tests__/challengePool.test.ts fails if one is missing.
     *
     * For a MODED game (`modes`), eligibility is per mode and so is the spec: omit this
     * field; each eligible mode has its own `CHALLENGE_GAMES` entry keyed by
     * (gameId, mode). Word Search and Bucket Drop are both eligible as Pinyin only —
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
