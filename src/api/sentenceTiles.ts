/**
 * sentenceTiles.ts — the client's typed calls against /api/sentenceTiles/*
 * (docs/SENTENCE_TILES_GAME.md § "Endpoints").
 *
 * Types come straight from server/contracts/sentenceTiles.ts (one shared contract, no mirror).
 * Per docs/FRONTEND_LAYERING.md § 3.2 none of these take a `token`: they go through
 * src/api/http.ts, which resolves the Authorization header at call time.
 *
 * Every call sends the device's IANA timezone (`tz`) so the server counts AI judge calls
 * against the player's own local day.
 */
import { apiGet, apiPost } from "./http";
import type {
    SentenceTilesDirection,
    SentenceTilesGameView,
    SentenceTilesListResponse,
    SentenceTilesMoveResponse,
    SentenceTilesPlacement,
} from "../../server/contracts/sentenceTiles";

const BASE = "/api/sentenceTiles/games";

/** The device's IANA zone, or undefined when the runtime can't say. */
function deviceTz(): string | undefined {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        return undefined;
    }
}

export function fetchSentenceTilesGames(): Promise<SentenceTilesListResponse> {
    return apiGet<SentenceTilesListResponse>(BASE);
}

export function createSentenceTilesGame(opponentId: string): Promise<SentenceTilesGameView> {
    return apiPost<SentenceTilesGameView>(BASE, { opponentId, tz: deviceTz() });
}

export function fetchSentenceTilesGame(gameId: string): Promise<SentenceTilesGameView> {
    return apiGet<SentenceTilesGameView>(`${BASE}/${gameId}`, { params: { tz: deviceTz() } });
}

/**
 * The heartbeat: has the game moved past `version`? Resolves to the new state, or null when
 * the server answers 204 (unchanged) — http.ts parses an empty body as null.
 */
export function pollSentenceTilesGame(gameId: string, version: number): Promise<SentenceTilesGameView | null> {
    return apiGet<SentenceTilesGameView | null>(`${BASE}/${gameId}`, { params: { since: version, tz: deviceTz() } });
}

export function playSentenceTiles(
    gameId: string,
    placements: SentenceTilesPlacement[],
    direction: SentenceTilesDirection,
): Promise<SentenceTilesMoveResponse> {
    return apiPost<SentenceTilesMoveResponse>(`${BASE}/${gameId}/play`, { placements, direction, tz: deviceTz() });
}

export function exchangeSentenceTiles(gameId: string, tileIds: number[]): Promise<SentenceTilesMoveResponse> {
    return apiPost<SentenceTilesMoveResponse>(`${BASE}/${gameId}/exchange`, { tileIds, tz: deviceTz() });
}

/** The four body-less moves. */
export type SentenceTilesSimpleMove = "pass" | "resign" | "decline" | "cancel";

export function sentenceTilesSimpleMove(gameId: string, move: SentenceTilesSimpleMove): Promise<SentenceTilesMoveResponse> {
    return apiPost<SentenceTilesMoveResponse>(`${BASE}/${gameId}/${move}`, { tz: deviceTz() });
}

/** The server's user-facing error message from a failed call, or a generic fallback. */
export function sentenceTilesErrorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
    const data = (err as { response?: { data?: { error?: unknown } } })?.response?.data;
    return typeof data?.error === "string" ? data.error : fallback;
}
