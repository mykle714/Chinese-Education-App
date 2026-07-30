// Thin client for the Sort Cards / Quick Mark / Skipped Cards endpoints
// (docs/SORT_CARDS_REQUIREMENTS.md). All are auth-gated.
//
// Why this module exists: the three discover pages each hand-rolled the same
// `fetch(`${API_BASE_URL}/api/starterPacks/...`)` + `authHeaders` useMemo + `res.ok`
// ladder, so the same endpoint was spelled three different ways and each page kept a
// `token`-keyed memo that churned every ~15 minutes on a silent token refresh. Every
// call now goes through src/api/http.ts, which reads the bearer token fresh at call
// time — so none of these functions takes a `token`, and callers must not list one in
// a dependency array (CLAUDE.md "Never reload/reset a page on a silent token refresh").
// See docs/ARCHITECTURE_REVIEW.md finding 5.
//
// API paths are camelCase and must stay in step with server/routes/starterPacksRoutes.ts.

import { apiGet, apiPost } from "../../api/http";
import type {
    DiscoverCard,
    DiscoverFetchResponse,
    DiscoverNextPackResponse,
    Language,
} from "../../types";

/** A Sort Cards drop bucket. Both persist as `starterPackBucket = 'library'` server-side. */
export type SortBucket = "library" | "already-learned";

/** One card's tri-state mark in Quick Mark. */
export type QuickMarkMark = { cardId: number; state: string };

/** Keyset cursor for Quick Mark paging — the last shown card's frequency score + id. */
export interface QuickMarkCursorParams {
    /** The last shown card's frequency score (may be null — those sort last). */
    score: number | null;
    /** The last shown card's det id — the tiebreaker that makes the cursor total. */
    id: number;
}

/**
 * Initial pack-queue fill for Sort Cards. `level` is the requested difficulty (the
 * client-tracked auto target, or the user's pin); `manual` marks the level as pinned
 * rather than adaptive. Omitting `level` asks the server for a cold-start seed.
 */
export function fetchStarterPacks(
    language: Language,
    level: number | null,
    manual: boolean,
): Promise<DiscoverFetchResponse> {
    return apiGet<DiscoverFetchResponse>(`/api/starterPacks/${language}`, {
        params: { level, ...(manual ? { mode: "manual" } : {}) },
    });
}

/** Replenish the queue with one pack, excluding the packs still queued. */
export function fetchNextPack(input: {
    language: Language;
    excludePackKeys: string[];
    level: number | null;
    manual: boolean;
}): Promise<DiscoverNextPackResponse> {
    return apiPost<DiscoverNextPackResponse>("/api/starterPacks/nextPack", {
        language: input.language,
        excludePackKeys: input.excludePackKeys,
        ...(input.level != null ? { level: input.level } : {}),
        ...(input.manual ? { mode: "manual" } : {}),
    });
}

/**
 * Sort one card into a bucket. `packId: null` is the Skipped-Cards shape (persist the
 * vet row AND clear the `discover_skips` row); `lastInPack` tells the server to mark
 * the pack seen.
 */
export function sortCard(input: {
    cardId: number;
    bucket: SortBucket | string;
    language: Language;
    packId: number | null;
    lastInPack?: boolean;
}): Promise<unknown> {
    return apiPost<unknown>("/api/starterPacks/sort", input);
}

/** Defer every remaining unsorted card in the on-deck pack. */
export function skipPack(input: {
    cardIds: number[];
    language: Language;
    packId: number | null;
}): Promise<unknown> {
    return apiPost<unknown>("/api/starterPacks/skipPack", input);
}

/** Reverse one sort/skip action. */
export function undoSort(input: {
    cardId: number;
    bucket: string;
    language: Language;
    packId: number | null;
}): Promise<unknown> {
    return apiPost<unknown>("/api/starterPacks/undo", input);
}

/** The cards the user has skipped (det-derived, not vet rows). */
export async function fetchSkippedCards(language: Language): Promise<DiscoverCard[]> {
    const data = await apiGet<DiscoverCard[]>(`/api/starterPacks/${language}/skipped`);
    // The endpoint returns a bare array; guard the shape so a changed envelope can't
    // put a non-array into a `.map()`.
    return Array.isArray(data) ? data : [];
}

/** Return every skipped card to the sort supply. */
export function recycleSkips(language: Language): Promise<unknown> {
    return apiPost<unknown>(`/api/starterPacks/${language}/recycleSkips`);
}

/** One keyset page of Quick Mark cards. `level: null` asks the server to seed one. */
export function fetchQuickMarkPage(
    language: Language,
    level: number | null,
    cursor: QuickMarkCursorParams | null,
): Promise<{ cards: DiscoverCard[]; level: number; hasMore: boolean }> {
    return apiGet(`/api/starterPacks/${language}/quickMark`, {
        params: {
            level,
            ...(cursor ? { cursorId: cursor.id, cursorScore: cursor.score } : {}),
        },
    });
}

/** Reconcile every touched Quick Mark card to its on-screen mark in one request. */
export function saveQuickMarks(language: Language, marks: QuickMarkMark[]): Promise<unknown> {
    return apiPost<unknown>("/api/starterPacks/quickMarkBatch", { language, marks });
}
