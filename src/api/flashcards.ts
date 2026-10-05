/**
 * flashcards.ts — the client's typed calls against `/api/flashcards/*`.
 *
 * WHY THIS MODULE EXISTS
 *
 * `POST /api/flashcards/mark` is the app's most consequential write: it appends to
 * a card's `typedMarkHistory`, which is the input to the whole utcm mastery
 * computation (docs/MASTERY_REWORK.md). It was hand-rolled at FIVE independent call
 * sites — the flp working loop, Bubble Match, Match Speed, Word Search, and the
 * Practice Writing button — each rebuilding the base URL, the Authorization header,
 * the credentials flag, and the request body from scratch.
 *
 * Five copies meant five chances to drift, and they HAD drifted: three sent an
 * `x-user-timezone` header and two did not. (That particular divergence turned out
 * to be harmless — no server code reads that header; see the note on
 * `markFlashcard` below.) The next divergence would not necessarily be harmless,
 * because a wrong `type` writes a mark into the wrong mastery track and there is no
 * validation that would catch it.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 these functions take NO `token`: they go
 * through src/api/http.ts, which reads the Authorization header at call time via
 * authHeader(). That keeps a caller's function identity stable across the ~15-minute
 * silent token refresh — the rule in CLAUDE.md.
 *
 * See docs/CORRECTNESS_AND_PERFORMANCE_REVIEW.md finding 3.
 */
import { apiPost } from './http';
import type { MarkType, ReviewMark, VocabEntry } from '../types';
import type { FLP_MARK_SURFACE } from '../../server/contracts/wire';
import type { FlpBar } from '../../server/contracts/studyMode';

/**
 * Every surface that may record a mark. Add a case here when a new game starts
 * writing marks — the compiler then forces the call site to use a value the
 * `[MarkSuppressed]` log analysis already groups on.
 */
export type MarkSurface =
    | typeof FLP_MARK_SURFACE
    | "bubble-match"
    | "hydra-bubbles"
    | "match-speed"
    | "memory-map"
    | "speed-reading"
    | "word-search"
    | "practice-writing"
    // The Reading Center's word swipe grid (docs/READING_WRITING_CENTERS.md).
    | "reading-center"
    // The Writing Center's Writing Grid game (docs/WRITING_PRACTICE_REWORK.md § 2).
    | "writing-grid";

/** A single review mark. `mode` is flp-only — it caps the replacement card's category. */
export interface MarkFlashcardRequest {
    cardId: number;
    isCorrect: boolean;
    /** Which mastery track this mark lands in. See docs/MASTERY_REWORK.md. */
    type: MarkType;
    /**
     * Cards the caller already holds, so the server's replacement pick can avoid
     * them. The games pass `[]` — they don't use the returned replacement at all.
     */
    excludeIds?: number[];
    /**
     * flp working-loop only: caps the replacement card to the mode's allowed
     * categories, and yields `newCard: null` when the mode is exhausted.
     */
    mode?: string;
    /**
     * flp working-loop only: the session's flp bar (server/contracts/studyMode.ts). A
     * reading session sends `reading` so its replacement card is chosen by the reading
     * bar, the bar its queue is built on. Omitted = core.
     */
    bar?: FlpBar;
    /**
     * flp working-loop only, and only for a session launched from a collection
     * (docs/DECKS_FEATURE.md): keeps the REPLACEMENT card inside that collection.
     * Exactly one of these is ever set — `deckId` for a user-authored deck,
     * `collection: 'mastered'` for the Mastered set. Learn Now sets neither,
     * because it is the default pool.
     */
    deckId?: number;
    collection?: string;
    /**
     * Which surface produced this mark.
     *
     * ONE server rule branches on it: once a card's core pbh reaches 6, know
     * (recognition/production) marks are recorded only from `"flp"`
     * (`FLP_MARK_SURFACE`, docs/MASTERY_REWORK.md § 6) — so a know-writing surface
     * that omits it has its marks dropped above the line. Otherwise diagnostic: the
     * suppressed-mark log (docs/HYDRA_BUBBLES.md § 8.1) uses it to tell apart the
     * reasons a mark gets dropped: a card served by fill tier 4 (cooled cards on an
     * ordinary run — the collision we do NOT want and are measuring), versus a
     * deck/collection round that deliberately ignores cooldown (§ 6.3 — intended).
     * Without it the log is one undifferentiated count and answers nothing.
     *
     * A UNION, not a free string: a typo in a
     * free-text field silently opens a new bucket in the log and the analysis quietly
     * under-counts the surface it was meant to measure. Nothing would ever fail.
     */
    surface?: MarkSurface;
    /**
     * REQUIRED for `type: "writing"` (docs/WRITING_PRACTICE_REWORK.md § 3a): the level
     * the word was written at and each character's result. The server fans the result
     * out onto the characters' own cards behind the anti-farming gate; `isCorrect`
     * should be every(perChar).
     */
    writing?: { level: number; perChar: boolean[] };
}

export interface MarkFlashcardResponse {
    /** The replacement card, or null when the caller sent no `mode`/none is available. */
    newCard: VocabEntry | null;
    /**
     * The server DECLINED to record this mark because the card's track had not
     * finished cooling down (docs/HYDRA_BUBBLES.md § 8 — cooldown is a hard
     * "next markable at"). Not an error: the review happened, it just did not
     * change any history, so `markTimestamp` is null and there is nothing to undo.
     *
     * Callers that only fire-and-forget (every game) can ignore this. Callers that
     * offer UNDO must check it — an undo keyed on a mark that was never written
     * would be rejected by the server and read to the user as a failure.
     */
    suppressed: boolean;
    /**
     * Server-assigned timestamp of the mark just written — the undo key. NULL when
     * `suppressed`, which is the only case where no mark exists to undo.
     */
    markTimestamp: string | null;
    /** Echoed back so undo reverts the same typed stream. */
    markType: MarkType;
    /** The mark pushed out of a full 8-slot window, so undo can restore it. */
    displacedMark: ReviewMark | null;
}

/**
 * Record one review mark.
 *
 * Note on `x-user-timezone`: three of the five original call sites sent this header
 * and two did not. It is NOT sent here, because no server code reads it — a grep for
 * the name across `server/` returns zero hits outside these client files. It was
 * dropped rather than standardized so the header does not read as load-bearing. If a
 * future streak/day-attribution change needs the caller's tz, add it here once, where
 * every caller picks it up.
 */
export async function markFlashcard(
    request: MarkFlashcardRequest
): Promise<MarkFlashcardResponse> {
    const data = await apiPost<Partial<MarkFlashcardResponse>>('/api/flashcards/mark', {
        cardId: request.cardId,
        isCorrect: request.isCorrect,
        type: request.type,
        excludeIds: request.excludeIds ?? [],
        mode: request.mode,
        bar: request.bar,
        deckId: request.deckId,
        collection: request.collection,
        surface: request.surface,
        writing: request.writing,
    });

    // A SUPPRESSED mark is a legitimate success with no timestamp (see the field's
    // docs), so it is checked before the durability guard below — otherwise the
    // cooldown rule would surface to the user as "failed to save progress".
    const suppressed = data?.suppressed === true;

    // The mark is only durable if the server assigned it a timestamp; without one
    // there is nothing to undo against. The working loop treats this as a retryable
    // failure, so it must throw rather than return a half-formed result.
    if (!suppressed && !data?.markTimestamp) {
        throw new Error('Mark response missing mark timestamp');
    }

    return {
        newCard: data.newCard ?? null,
        suppressed,
        markTimestamp: data.markTimestamp ?? null,
        // Prefer the server's echo; fall back to what we asked for.
        markType: data.markType ?? request.type,
        displacedMark: data.displacedMark ?? null,
    };
}

/** Payload for reverting the most recent mark on a card. */
export interface UndoMarkRequest {
    cardId: number;
    markTimestamp: string;
    markType: MarkType;
    /** The mark that was displaced when this one was written, if any. */
    displacedMark?: ReviewMark | null;
}

/**
 * Revert the most recent mark on a card. The server rejects the call unless
 * `markTimestamp` matches the latest mark on that typed track, so this is safe to
 * retry but not to replay out of order.
 */
export async function undoFlashcardMark(request: UndoMarkRequest): Promise<void> {
    await apiPost('/api/flashcards/undoLastMark', {
        cardId: request.cardId,
        markTimestamp: request.markTimestamp,
        markType: request.markType,
        displacedMark: request.displacedMark ?? null,
    });
}
