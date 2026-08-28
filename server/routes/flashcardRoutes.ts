import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { parseBuiltinCollectionId } from '../dal/shared/vetTable.js';
import { onDeckVocabService, flashcardMarkService } from '../dal/setup.js';
import { MODE_CONFIGS, type StudyMode, type CollectionFilter } from '../services/OnDeckVocabService.js';
import { ReviewMark, MarkType, MARK_TYPES } from '../types/index.js';
import { DALError } from '../types/dal.js';
import { parseFlpForeignTrack } from '../contracts/wire.js';
import { handle } from './asyncHandler.js';

/**
 * Flashcard mark/undo routes — /api/flashcards/*
 *
 * LAYER: HTTP route layer, and nothing more. These handlers parse the request,
 * delegate to `FlashcardMarkService` (the mark policy) and `OnDeckVocabService` (the
 * replacement pick), and map the result to a status code. They hold no SQL and no
 * banding logic — that all moved into `services/FlashcardMarkService.ts`, which is
 * where the model, cooldown and velocity rules are now documented.
 *
 * THE ONE PIECE OF ORCHESTRATION LEFT HERE is the composition below: `mark` records
 * the mark and, for the flp only, hands back a replacement card. Those are two
 * concerns riding one URL — seven of the eight client call sites send `excludeIds: []`
 * and discard `newCard`, and four request fields (`mode`, `deckId`, `collection`,
 * `foreignTrack`) exist solely to steer a refill the games never read. Splitting the
 * refill onto its own endpoint is now a routing change and nothing more, because the
 * service returns `categoryBeforeMark` rather than picking the card itself. It is not
 * done here because it changes the flp's wire contract and needs its call site
 * migrated with it.
 *
 * See docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md, docs/MASTERY_REWORK.md.
 */
const router = Router();

// Coerce an incoming mark `type` to a valid MarkType. Defensive default:
// an absent/unknown type falls back to 'recognition' (the historical default
// flp foreign-first face — a pinyin-off zh session now sends 'reading' explicitly).
function resolveMarkType(raw: unknown): MarkType {
  return MARK_TYPES.includes(raw as MarkType) ? (raw as MarkType) : 'recognition';
}

/**
 * Map a service error to its HTTP response. `DALError` carries the status code and
 * the wire `code` the client already switches on (ERR_ENTRY_NOT_FOUND,
 * ERR_UNDO_TARGET_MISMATCH, …); anything else is an unexpected 500.
 */
function sendServiceError(res: any, error: any, fallbackCode: string) {
  if (error instanceof DALError) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }
  console.error(`${fallbackCode}:`, error);
  return res.status(500).json({ error: error?.message || 'Request failed', code: fallbackCode });
}

// Mark a flashcard as correct or incorrect (protected route)
router.post('/api/flashcards/mark', authenticateToken, handle(async (req, res) => {
  const userId = (req as any).user?.userId;
  const {
    cardId, isCorrect, type: rawType, excludeIds: rawExcludeIds,
    mode: rawMode, deckId: rawDeckId, collection: rawCollection,
    foreignTrack: rawForeignTrack, surface: rawSurface,
  } = req.body || {};

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
  }
  if (typeof cardId !== 'number' || typeof isCorrect !== 'boolean') {
    return res.status(400).json({
      error: 'Invalid request body. Expected { cardId: number, isCorrect: boolean, type?: MarkType }',
      code: 'ERR_INVALID_REQUEST'
    });
  }

  const markType: MarkType = resolveMarkType(rawType);

  let markResult;
  try {
    markResult = await flashcardMarkService.applyMark({
      userId,
      cardId,
      isCorrect,
      markType,
      surface: typeof rawSurface === 'string' ? rawSurface : undefined,
    });
  } catch (error: any) {
    return sendServiceError(res, error, 'ERR_MARK_FAILED');
  }

  // Everything below is REFILL, which only the flp working loop consumes.
  const response = {
    success: true,
    suppressed: markResult.suppressed,
    category: markResult.category,
    markTimestamp: markResult.markTimestamp,
    markType: markResult.markType,
    displacedMark: markResult.displacedMark,
    newCard: null as any,
  };

  // A suppressed mark owes no refill: no history changed, so the loop is where it
  // was. An incorrect mark keeps its card in the loop, so it owes no refill either.
  if (markResult.suppressed || !isCorrect) {
    return res.status(200).json(response);
  }

  // Optional difficulty mode (Review/Challenge). When set, the replacement card must
  // stay within the mode's allowed categories so a banned category never leaks back
  // into the loop via a correct-mark refill.
  const mode: StudyMode | undefined =
    rawMode === 'review' || rawMode === 'challenge' ? rawMode : undefined;

  // Optional collection restriction (docs/DECKS_FEATURE.md). The client echoes back
  // the collection the session was launched from, because THIS endpoint refills the
  // working loop — without it, the first correct answer in a deck session would pull
  // a replacement from the user's whole library.
  //
  // No ownership check is needed here (unlike the launch endpoints, which 404 on a
  // foreign deck id): the replacement query is already filtered by `ve."userId"`, so
  // a deck the caller does not own selects nothing and the picker falls through to
  // its normal never-stall behaviour. Coerced defensively — a malformed value must
  // mean "no restriction", never a crash mid-review.
  const markedBuiltin = parseBuiltinCollectionId(rawCollection);
  const collection: CollectionFilter | undefined =
    Number.isInteger(rawDeckId) && rawDeckId > 0
      ? { kind: 'deck', deckId: rawDeckId }
      : markedBuiltin
        ? { kind: 'builtin', id: markedBuiltin }
        : undefined;

  // The flp session's foreign-first track (docs/MASTERY_REWORK.md). Steers only the
  // REPLACEMENT card — the mark itself was typed by `type` above. The client echoes
  // back whatever it launched the loop with so the refill is steered on the same two
  // tracks the loop is; other surfaces omit it and get the historical
  // recognition/production pair.
  const foreignTrack = parseFlpForeignTrack(rawForeignTrack);

  // excludeIds is the list of card ids currently in the client's working loop, so the
  // replacement picker avoids handing back a duplicate.
  const excludeIds: number[] = Array.isArray(rawExcludeIds)
    ? rawExcludeIds.filter((n: unknown): n is number => typeof n === 'number')
    : [];

  // The replacement comes from the band the learner just LEFT, not the one they
  // reached: the flp presents recognition/production, so its pool is paced by the
  // core bar as it stood before this mark.
  const allowedCategories = mode ? MODE_CONFIGS[mode].allowed : undefined;

  // DEGRADES TO NO REFILL, never to an error. The mark is already committed by this
  // point, so a failure in the picker must not surface to the learner as "failed to
  // save progress" — the client's markFlashcard throws on a non-200 and the flp
  // treats that as a retryable mark, which would re-post a mark that already landed.
  // `newCard: null` is a state every caller already handles (see below).
  let newCard = null;
  try {
    newCard = await onDeckVocabService.getNextLibraryCardWithFallback(
      userId, markResult.categoryBeforeMark, markResult.language,
      excludeIds, allowedCategories, collection, foreignTrack
    );
  } catch (refillError) {
    console.error(`Replacement pick failed after a committed mark (card ${cardId}):`, refillError);
    return res.status(200).json(response);
  }

  // "No eligible replacement" is an expected end-of-pool state for EVERY kind of
  // session, not an error, so it is always a 200 with newCard:null and the client
  // winds the loop down. It means one of:
  //   - a mode / deck / Mastered round whose allowed pool is exhausted;
  //   - an unrestricted round where every card is cooling AND the dictionary has no
  //     more words to lend (the service already tried — getNextLibraryCardWithFallback).
  // Study used to 404 here on the assumption it could always find a card. It can't any
  // more: honoring the cooldown means an unrestricted session can legitimately run dry,
  // and a 404 would surface as "failed to save progress" even though the mark committed.
  if (!newCard) {
    return res.status(200).json(response);
  }

  // Pre-warm the TTS disk cache for the replacement card so its audio is a guaranteed
  // cache hit on the client's follow-up /api/tts/synthesize call. Same graceful-degrade
  // semantics as the working-loop endpoint: a cold cache costs latency, not the card.
  try {
    await onDeckVocabService.prewarmAudio([newCard]);
  } catch (prewarmError) {
    console.error(`TTS pre-warm failed for replacement card ${newCard.id}:`, prewarmError);
  }

  return res.status(200).json({ ...response, newCard });
}));

// Undo the most recently saved flashcard mark (protected route)
router.post('/api/flashcards/undoLastMark', authenticateToken, handle(async (req, res) => {
  const userId = (req as any).user?.userId;
  const { cardId, markTimestamp, markType: rawMarkType, displacedMark } = req.body || {};

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
  }
  if (typeof cardId !== 'number' || typeof markTimestamp !== 'string') {
    return res.status(400).json({
      error: 'Invalid request body. Expected { cardId: number, markTimestamp: string, markType?: MarkType }',
      code: 'ERR_INVALID_REQUEST'
    });
  }

  try {
    // Undo must revert the SAME typed stream the mark was appended to.
    const { category } = await flashcardMarkService.undoMark({
      userId,
      cardId,
      markTimestamp,
      markType: resolveMarkType(rawMarkType),
      displacedMark: (displacedMark ?? null) as ReviewMark | null,
    });
    return res.status(200).json({ success: true, category });
  } catch (error: any) {
    return sendServiceError(res, error, 'ERR_UNDO_MARK_FAILED');
  }
}));

export default router;
