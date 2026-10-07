/**
 * gamePool.ts — the client's one typed call against GET /api/onDeck/gamePool.
 *
 * Every game that draws a board from the learner's cards (Bubble Match, Match Speed,
 * Speed Reading, Bucket Drop, Hydra Bubbles) and Immersive World's known-words list
 * goes through `fetchGamePool`. It used to be six hand-built querystrings — five on
 * raw `fetch` + `authHeader()` — each with its own copy of the response type.
 *
 * Server: `OnDeckVocabController.getGamePool` → `OnDeckVocabService.getGameVocabPool`
 * (or `getChallengeGamePool` when the challenge params name an open round).
 *
 * LENDING IS DECIDED BY THE SERVER, not by a flag here (docs/PROVISIONAL_CARDS.md):
 *   - a FULL board (no `need`) tops the learner up to `CARD_BASELINES[surface]`
 *     (or to the distribution's sum when `surface` is absent) before selecting;
 *   - a REFILL (`need` set) never lends — unless `surface` is a rolling-supply surface
 *     (`ROLLING_SUPPLY_SURFACES`, server/contracts/wire.ts; today only Hydra);
 *   - a collection filter or a challenge round never lends.
 * So a caller controls lending only through `surface` and `need`, and should always
 * send its real `surface`.
 *
 * Referenced by: docs/GAMES_FEATURE.md (§ Game pool request), docs/PROVISIONAL_CARDS.md.
 */
import { apiGet, type QueryParams } from './http';
import { collectionLaunchParams, type CollectionRef } from '../features/flashcards/collectionRef';
import type { MarkType, VocabEntry } from '../types';

/**
 * Per-band card quotas, keyed by mastery band (`Unfamiliar`/`Target`/`Comfortable`/
 * `Mastered`). Keyed by string to match the games' `GAME_DISTRIBUTION` constants; the
 * server reads only those four names (`GAME_POOL_CATEGORIES`) and drops anything else,
 * as well as any band whose quota is not a positive integer.
 */
export type GamePoolDistribution = Readonly<Partial<Record<string, number>>>;

/** Shape returned by GET /api/onDeck/gamePool. */
export interface GamePoolResponse {
    cards: VocabEntry[];
    requested: Record<string, number>;
    /** Sorted-card count per band — Match Speed's "you have none of these" check. */
    available: Record<string, number>;
    /** Cards a full board needs (sum of the requested distribution). */
    total: number;
    /** Cards this particular call had to return (< total for a partial refill). */
    needed: number;
    sufficient: boolean;
}

export interface GamePoolRequest {
    /** The mastery track the game emits marks on — buckets + cooldown follow it. */
    markType: MarkType;
    /** `?surface=` — names the baseline to lend up to (see the header comment). */
    surface?: string;
    /** Band quotas. Omit for a challenge-only request (Hydra's contested set). */
    distribution?: GamePoolDistribution;
    /** Partial refill size. Present = refill semantics (no baseline top-up). */
    need?: number;
    /** HARD exclude — cards on screen / already buffered. */
    exclude?: number[];
    /** SOFT demote — cards already cleared this session. */
    avoid?: number[];
    /** "These bands or nothing" — no top-up from outside `distribution` (Hydra). */
    strictBuckets?: boolean;
    /** Lend at the learner's level plus this offset (Hydra's payout tiers). */
    lendLevelOffset?: number;
    /** Challenge refill that must not re-serve the contested words (Match Speed § 5.3). */
    excludeContested?: boolean;
    /** Launch collection — must ride EVERY request, refills included. */
    collection?: CollectionRef | null;
    /**
     * `useChallengeRound().poolParams` — the `&`-prefixed `challengeId`/`gameId`/`mode`/
     * `anytime` suffix. Passed through verbatim so the tester `anytime` hatch can never be
     * dropped by a caller rebuilding the pair by hand (docs/STUDY_CHALLENGE.md § 2a).
     */
    challengeParams?: string;
}

/** Pure: the request → its querystring params. Exported for tests. */
export function gamePoolParams(req: GamePoolRequest): QueryParams {
    const params: QueryParams = { markType: req.markType, surface: req.surface };
    for (const [cat, n] of Object.entries(req.distribution ?? {})) params[cat] = n;
    if (req.need !== undefined) params.need = req.need;
    if (req.exclude?.length) params.exclude = req.exclude.join(',');
    if (req.avoid?.length) params.avoid = req.avoid.join(',');
    if (req.strictBuckets) params.strictBuckets = 1;
    if (req.lendLevelOffset !== undefined) params.lendLevelOffset = req.lendLevelOffset;
    if (req.collection) Object.assign(params, collectionLaunchParams(req.collection));
    if (req.challengeParams) {
        for (const [key, value] of new URLSearchParams(req.challengeParams.replace(/^&/, ''))) {
            params[key] = value;
        }
        // Only meaningful inside a challenge round; the server ignores it otherwise.
        if (req.excludeContested) params.contested = 'exclude';
    }
    return params;
}

/** GET /api/onDeck/gamePool. Throws `ApiError` on non-2xx (see api/http.ts). */
export async function fetchGamePool(req: GamePoolRequest): Promise<GamePoolResponse> {
    const data = await apiGet<GamePoolResponse>('/api/onDeck/gamePool', { params: gamePoolParams(req) });
    // Defensive: every caller indexes `cards`, so never hand back a missing array.
    return { ...data, cards: Array.isArray(data?.cards) ? data.cards : [] };
}
