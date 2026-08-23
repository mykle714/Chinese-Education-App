/**
 * arena.ts — the client's typed calls against /api/arena/*.
 *
 * Mirrors server/types/arena.ts; keep the two in step. See docs/ARENA_FEATURE.md.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 none of these take a `token`: they go through
 * src/api/http.ts, which resolves the Authorization header at call time.
 */
import { apiGet, apiPost, apiDelete } from './http';

/** The four states of /arena (§ 2.3). */
export type ArenaState = 'live' | 'results' | 'opt-in' | 'closed';

/**
 * One rendered row of the board.
 *
 * Carries nothing beyond name, avatar, language, score and the competitor's own
 * authored message — settled as Q20 and enforced on the server. An arena puts a learner in front of 24 strangers they
 * did not choose and cannot leave, so a streak or a join date here would be a
 * disclosure they never agreed to. Do not add fields without revisiting that.
 */
export interface ArenaEntry {
    rank: number;
    /** Null for synthetic members — never link or route on this. */
    userId: string | null;
    name: string;
    avatarIconId: string | null;
    language: string;
    score: number;
    /**
     * The competitor's own one-line message, or null when they have not written
     * one (docs/ARENA_FEATURE.md § 2.1a). Rendered in the row's sub-line, where the
     * progress meter used to be.
     */
    message: string | null;
    isViewer: boolean;
    zone: 'promote' | 'hold' | 'relegate';
}

export interface ArenaBoundaries {
    weekStartsAt: string;
    closesAt: string;
    /** The ARENA's zone, which may not be the viewer's. */
    timezone: string;
    /** When true, label every displayed time with `timezone` (§ 3). */
    timezoneDiffersFromViewer: boolean;
}

export interface ArenaBoardResponse {
    state: ArenaState;
    division: number;
    arenaId: string | null;
    entries: ArenaEntry[];
    boundaries: ArenaBoundaries | null;
    divisionChange: number | null;
    optedInNextWeek: boolean;
    /**
     * The VIEWER's own message. Sent separately from their board row because the
     * editor is reachable in every state — including opt-in, where `entries` is empty
     * and there is no row to read it off.
     */
    viewerMessage: string | null;
}

/** The viewer's current IANA zone, as the browser reports it. */
function viewerTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

/** GET /api/arena — the board in whichever state applies. */
export async function fetchArenaBoard(language: string): Promise<ArenaBoardResponse> {
    const params = new URLSearchParams({ language, tz: viewerTimezone() });
    return apiGet<ArenaBoardResponse>(`/api/arena?${params}`);
}

/** POST /api/arena/optIn — join next week. 400 outside the break period. */
export async function optInToArena(language: string): Promise<{ weekKey: string }> {
    return apiPost<{ weekKey: string }>('/api/arena/optIn', {
        language,
        tz: viewerTimezone(),
    });
}

/** DELETE /api/arena/optIn — withdraw before formation. */
export async function withdrawFromArena(language: string): Promise<void> {
    const params = new URLSearchParams({ language, tz: viewerTimezone() });
    await apiDelete(`/api/arena/optIn?${params}`);
}

/**
 * Share a coarse location so clustering can group the user with nearby players.
 *
 * ⚠️ THE COORDINATES NEVER LEAVE THIS FUNCTION. The browser hands back a
 * lat/long; we truncate to a 5-character geohash cell (~5 km) and send only
 * that. This is the whole privacy argument for the feature, so the truncation
 * must stay on this side of the network call.
 *
 * Returns the cell that was stored, or null if the user declined. DENIAL IS A
 * FIRST-CLASS OUTCOME, not an error: the user simply joins the location-less
 * pool, and they must never be re-prompted in the same session — a repeated
 * permission sheet is the fastest route to a permanent browser-level block.
 */
export async function shareArenaLocation(): Promise<string | null> {
    const { toGeoCell } = await import('../utils/geohash');

    if (!('geolocation' in navigator)) return null;

    const position = await new Promise<GeolocationPosition | null>((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve(pos),
            () => resolve(null),
            // The web's reduced-accuracy request. Arena needs a tile, not a
            // street, and asking for high accuracy would both cost battery and
            // request more than we are entitled to.
            { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
        );
    });

    if (!position) return null;

    const cell = toGeoCell(position.coords.latitude, position.coords.longitude);
    await apiPost('/api/arena/location', { geoCell: cell });
    return cell;
}

/** Clear a previously shared location. */
export async function clearArenaLocation(): Promise<void> {
    await apiPost('/api/arena/location', { geoCell: null });
}

/**
 * POST /api/arena/message — set (or clear with `null`) the viewer's board message.
 *
 * Returns what the SERVER stored, not what was typed: it trims, collapses runs of
 * whitespace and strips control characters, so the caller must render the response
 * rather than its own input. Throws on anything longer than 80 characters.
 */
export async function setArenaMessage(message: string | null): Promise<string | null> {
    const res = await apiPost<{ message: string | null }>('/api/arena/message', { message });
    return res.message;
}
