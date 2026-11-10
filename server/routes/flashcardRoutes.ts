import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { onDeckVocabService, flashcardMarkService, focusModeService, cardAudioService } from '../dal/setup.js';
import { FOCUS_ENDED_HEADER } from '../contracts/focusMode.js';
import { parseFlpWorld, type CollectionFilter } from '../services/OnDeckVocabService.js';
import { ReviewMark, MarkType, MARK_TYPES } from '../types/index.js';
import { DALError } from '../types/dal.js';
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
 * concerns riding one URL — most client call sites send `excludeIds: []` and discard
 * `newCard`, and the `world` request field exists solely to steer a refill the games
 * never read. (Three more refill-steering fields — `mode`, `deckId`, `collection` — were
 * removed 2026-11-04 with the Review/Challenge study modes and the Decks feature.)
 * Splitting the
 * refill onto its own endpoint is now a routing change and nothing more, because the
 * service returns `categoryBeforeMark` rather than picking the card itself. It is not
 * done here because it changes the flp's wire contract and needs its call site
 * migrated with it.
 *
 * See docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md, docs/MASTERY_REWORK.md.
 */
const router = Router();

// Coerce an incoming mark `type` to a valid MarkType. Defensive default:
// an absent/unknown type falls back to 'recognition' (the flp's foreign-first face).
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
    surface: rawSurface, writing: rawWriting,
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
      // Writing marks carry { level, perChar }; the service validates the shape.
      writing: rawWriting && typeof rawWriting === 'object'
        ? { level: Number(rawWriting.level), perChar: rawWriting.perChar }
        : undefined,
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
    displacedMarks: markResult.displacedMarks,
    displacedMark: markResult.displacedMark,
    writing: markResult.writing ?? null,
    newCard: null as any,
  };

  // A suppressed mark owes no refill: no history changed, so the loop is where it
  // was. An incorrect mark keeps its card in the loop, so it owes no refill either.
  if (markResult.suppressed || !isCorrect) {
    return res.status(200).json(response);
  }

  // The session's flp bar (studyMode.ts): a reading session's replacement is chosen by
  // the READING bar, the bar its queue is built on. Echoed by the client.
  const refillWorld = parseFlpWorld(req.body?.world);

  // FOCUS MODE (docs/FOCUS_MODE.md § 4): a session in a focused world refills only
  // from today's remaining set — resolved AFTER the mark committed, so a card just
  // marked correct is already out of it. Same rule as
  // OnDeckVocabController.applyFocus, which builds the loop being refilled here.
  let collection: CollectionFilter | undefined;
  const focus = await focusModeService.resolveWorld(userId, markResult.language, refillWorld);
  if (focus.active) collection = { kind: 'focus', ids: focus.ids };
  else if ('ended' in focus && focus.ended) res.setHeader(FOCUS_ENDED_HEADER, refillWorld);

  // excludeIds is the list of card ids currently in the client's working loop, so the
  // replacement picker avoids handing back a duplicate.
  const excludeIds: number[] = Array.isArray(rawExcludeIds)
    ? rawExcludeIds.filter((n: unknown): n is number => typeof n === 'number')
    : [];

  // The replacement comes from the band the learner just LEFT, not the one they
  // reached: the flp presents recognition/production, so its pool is paced by the
  // core bar as it stood before this mark.
  // A reading session paces the refill on the READING band the learner just left, since
  // its pool is banded by the reading bar; every other session uses the core band.
  const preferredCategory = refillWorld === 'core' ? markResult.categoryBeforeMark : markResult.markedBarCategoryBefore;

  // DEGRADES TO NO REFILL, never to an error. The mark is already committed by this
  // point, so a failure in the picker must not surface to the learner as "failed to
  // save progress" — the client's markFlashcard throws on a non-200 and the flp
  // treats that as a retryable mark, which would re-post a mark that already landed.
  // `newCard: null` is a state every caller already handles (see below).
  let newCard = null;
  try {
    newCard = await onDeckVocabService.getNextLibraryCardWithFallback(
      userId, preferredCategory, markResult.language,
      excludeIds, collection, refillWorld
    );
  } catch (refillError) {
    console.error(`Replacement pick failed after a committed mark (card ${cardId}):`, refillError);
    return res.status(200).json(response);
  }

  // "No eligible replacement" is an expected end-of-pool state for EVERY kind of
  // session, not an error, so it is always a 200 with newCard:null and the client
  // winds the loop down. It means one of:
  //   - a focused round whose day's set is exhausted;
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
    await cardAudioService.prewarm([newCard]);
  } catch (prewarmError) {
    console.error(`TTS pre-warm failed for replacement card ${newCard.id}:`, prewarmError);
  }

  return res.status(200).json({ ...response, newCard });
}));

// Undo the most recently saved flashcard mark (protected route)
router.post('/api/flashcards/undoLastMark', authenticateToken, handle(async (req, res) => {
  const userId = (req as any).user?.userId;
  const { cardId, markTimestamp, markType: rawMarkType, displacedMarks, displacedMark } = req.body || {};

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
      // `displacedMarks` (0–2, oldest first) is the current form; a pre-acceleration
      // client still sends the single legacy `displacedMark`.
      displacedMarks: Array.isArray(displacedMarks)
        ? (displacedMarks as ReviewMark[])
        : displacedMark ? [displacedMark as ReviewMark] : [],
    });
    return res.status(200).json({ success: true, category });
  } catch (error: any) {
    return sendServiceError(res, error, 'ERR_UNDO_MARK_FAILED');
  }
}));

export default router;
