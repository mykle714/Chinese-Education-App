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
    /** Lazy-loaded page component for the game. Page components take no props,
        so the default `ComponentType` ({}-props) is what `React.lazy` of a plain
        `React.FC` resolves to. */
    Component: LazyExoticComponent<ComponentType>;
    /** When true, hide the game from public/demo accounts. Defaults to false. */
    requiresAuth?: boolean;
    /** Optional gating rules evaluated at hub render time. */
    unlock?: {
        minVocabEntries?: number;
    };
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
