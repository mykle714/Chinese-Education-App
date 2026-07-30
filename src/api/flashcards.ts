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
}

export interface MarkFlashcardResponse {
    /** The replacement card, or null when the caller sent no `mode`/none is available. */
    newCard: VocabEntry | null;
    /** Server-assigned timestamp of the mark just written — the undo key. */
    markTimestamp: string;
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
    });

    // The mark is only durable if the server assigned it a timestamp; without one
    // there is nothing to undo against. The working loop treats this as a retryable
    // failure, so it must throw rather than return a half-formed result.
    if (!data?.markTimestamp) {
        throw new Error('Mark response missing mark timestamp');
    }

    return {
        newCard: data.newCard ?? null,
        markTimestamp: data.markTimestamp,
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
