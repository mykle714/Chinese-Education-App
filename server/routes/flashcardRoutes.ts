import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import db from '../db.js';
import { VET_PHYSICAL_TABLES, vetTableForLanguage, parseBuiltinCollectionId } from '../dal/shared/vetTable.js';
import { onDeckVocabService, categoryPromotionDAL } from '../dal/setup.js';
import { MODE_CONFIGS, type StudyMode, type CollectionFilter } from '../services/OnDeckVocabService.js';
import {
  ReviewMark,
  FlashcardCategory,
  MarkType,
  MARK_TYPES,
  MARK_WINDOW_SIZE,
  TypedMarkHistory,
} from '../types/index.js';
import {
  computeCoreCategory,
  appendTypedMark,
  bandsClimbed,
  barCategory,
  barForMarkType,
} from '../utils/masteryCompute.js';
import { type MasteredAtByBar } from '../contracts/wire.js';
import { handle } from './asyncHandler.js';

/**
 * Flashcard mark/undo routes — /api/flashcards/*
 *
 * LAYER: HTTP route layer, but these two handlers still carry the mark/undo
 * business logic inline (moved verbatim from server.ts). They are the last
 * route handlers with embedded SQL — a future pass should push this into
 * VocabEntryService. See docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md.
 *
 * MASTERY MODEL (migrations 101 + 143, docs/MASTERY_REWORK.md): each mark carries a
 * `type` (recognition/production/reading/writing). A card keeps the 8 most recent
 * marks PER TYPE in `typedMarkHistory`, and those four tracks feed THREE independent
 * bars — core (recognition + production), reading, writing. No band is stored; they
 * are derived here in app code from `typedMarkHistory` alone.
 *
 * A mark belongs to exactly ONE bar (`barForMarkType`), so each of these handlers
 * only ever has one bar's before/after band to reason about — which is what keeps
 * the mastery-crossing stamp and the velocity row to a single write each.
 *
 * The `category` returned to the client is the CORE bar's: it feeds the flp progress
 * chip and the replacement-card picker, both of which are recognition/production
 * surfaces.
 */
const router = Router();

// Coerce an incoming mark `type` to a valid MarkType. Defensive default:
// an absent/unknown type falls back to 'recognition' (the historical default
// flp foreign-first face). See docs/MASTERY_REWORK.md.
function resolveMarkType(raw: unknown): MarkType {
  return MARK_TYPES.includes(raw as MarkType) ? (raw as MarkType) : 'recognition';
}

// NOTE: neither handler reads the account's goal flags any more. Before migration
// 143 every mark had to fetch them because the band was goal-weighted; the three bars
// are goal-independent, so a mark is now one users-table query cheaper and — more to
// the point — a mark's outcome no longer depends on account state that can change
// under it. The goals decide only which bars are DISPLAYED and which promotions
// velocity sums, both of which are read-side questions.

// Mark a flashcard as correct or incorrect (protected route)
router.post('/api/flashcards/mark', authenticateToken, handle(async (req, res) => {
  const client = await db.getClient();

  try {
    const userId = (req as any).user?.userId;
    const { cardId, isCorrect, type: rawType, excludeIds: rawExcludeIds, mode: rawMode, deckId: rawDeckId, collection: rawCollection } = req.body;

    // Optional difficulty mode (Review/Challenge). When set, the replacement card must
    // stay within the mode's allowed categories so a banned category never leaks
    // back into the loop via a correct-mark refill.
    const mode: StudyMode | undefined =
      rawMode === 'review' || rawMode === 'challenge' ? rawMode : undefined;

    // Optional collection restriction (docs/DECKS_FEATURE.md). The client echoes
    // back the collection the session was launched from, because THIS endpoint is
    // what refills the working loop — without it, the first correct answer in a deck
    // session would pull a replacement from the user's whole library.
    //
    // No ownership check is needed here (unlike the launch endpoints, which 404 on a
    // foreign deck id): the replacement query is already filtered by `ve."userId"`,
    // so a deck the caller does not own selects nothing and the picker falls through
    // to its normal never-stall behaviour. Coerced defensively — a malformed value
    // must mean "no restriction", never a crash mid-review.
    const markedBuiltin = parseBuiltinCollectionId(rawCollection);
    const collection: CollectionFilter | undefined =
      Number.isInteger(rawDeckId) && rawDeckId > 0
        ? { kind: 'deck', deckId: rawDeckId }
        : markedBuiltin
          ? { kind: 'builtin', id: markedBuiltin }
          : undefined;

    if (!userId) {
      client.release();
      return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    }

    if (typeof cardId !== 'number' || typeof isCorrect !== 'boolean') {
      client.release();
      return res.status(400).json({
        error: 'Invalid request body. Expected { cardId: number, isCorrect: boolean, type?: MarkType }',
        code: 'ERR_INVALID_REQUEST'
      });
    }

    const markType: MarkType = resolveMarkType(rawType);

    // excludeIds is the list of card ids currently in the client's working loop,
    // so the replacement picker avoids handing back a duplicate.
    const excludeIds: number[] = Array.isArray(rawExcludeIds)
      ? rawExcludeIds.filter((n): n is number => typeof n === 'number')
      : [];

    // Fetch the current vocab entry's typed history + counts + language. vet is
    // split per language; the client sends only a cardId, so probe each physical
    // table (ids are globally unique) — exactly one holds the row.
    let entryResult: any = { rows: [] };
    for (const t of VET_PHYSICAL_TABLES) {
      const r = await client.query(
        `SELECT "typedMarkHistory", "totalMarkCount", "totalCorrectCount", "language", "masteredAt" FROM ${t} WHERE id = $1 AND "userId" = $2`,
        [cardId, userId]
      );
      if (r.rows.length > 0) { entryResult = r; break; }
    }

    if (entryResult.rows.length === 0) {
      client.release();
      return res.status(404).json({
        error: 'Vocab entry not found',
        code: 'ERR_ENTRY_NOT_FOUND'
      });
    }

    const existingHistory: TypedMarkHistory = entryResult.rows[0].typedMarkHistory || {};
    const currentTotalMarkCount: number = entryResult.rows[0].totalMarkCount || 0;
    const currentTotalCorrectCount: number = entryResult.rows[0].totalCorrectCount || 0;
    // The replacement card must be in the same language as the card just marked.
    const cardLanguage: string = entryResult.rows[0].language || 'zh';

    // The bar this mark moves. Every mark lands in exactly one, so the crossing stamp
    // and the velocity row below are each single-bar decisions.
    const bar = barForMarkType(markType);

    // CORE category BEFORE the mark drives the replacement-card category: the flp
    // presents recognition/production, so its pool is paced by the core bar.
    const categoryBeforeMark: string = computeCoreCategory(existingHistory);
    // ...and the marked BAR's band either side, for the crossing + velocity writes.
    // For a recognition/production mark these two are the same value.
    const barCategoryBefore = barCategory(existingHistory, bar);

    // Preserve the mark displaced from THIS TYPE's window when it's already full,
    // so undo can restore it precisely (per-type window of MARK_WINDOW_SIZE).
    const existingTrack: ReviewMark[] = Array.isArray(existingHistory[markType]) ? existingHistory[markType]! : [];
    const displacedMark: ReviewMark | null =
      existingTrack.length >= MARK_WINDOW_SIZE ? existingTrack[0] : null;

    const newMark: ReviewMark = {
      timestamp: new Date().toISOString(),
      isCorrect
    };

    const updatedHistory: TypedMarkHistory = appendTypedMark(existingHistory, markType, newMark);

    const newTotalMarkCount: number = currentTotalMarkCount + 1;
    const newTotalCorrectCount: number = currentTotalCorrectCount + (isCorrect ? 1 : 0);

    // Core category AFTER the mark, for the client's progress chip. Computed BEFORE
    // the UPDATE (it is a pure function of the new history) so the mastery crossing
    // below can be folded into that same write instead of costing a second round trip.
    const category: FlashcardCategory = computeCoreCategory(updatedHistory);
    const barCategoryAfter = barCategory(updatedHistory, bar);

    // MASTERY CROSSING (migrations 142 + 143): this is the ONLY moment "this bar
    // became mastered" is observable — the same reason band promotions are logged
    // below. `typedMarkHistory` is a rolling 8-mark window, so the marks that carried
    // the bar over the line are evicted long before anyone asks when it happened.
    //
    // Stamped on the un-mastered → mastered transition only, and never cleared on
    // regression: a bar's `masteredAt` entry means "last time this bar crossed into
    // mastered", so one bad mark must not erase the date. Re-crossing overwrites it.
    //
    // Stamped even when the bar's goal is OFF. The reading/writing tracks accrue for
    // everyone (that is the "keep accruing, hide the bar" rule), so a learner who
    // turns the reading goal on later finds their real crossing dates already there
    // rather than an empty column that back-dates their work to zero.
    const crossedIntoMastered = barCategoryBefore !== 'Mastered' && barCategoryAfter === 'Mastered';

    // Bands are derived, not stored — write only the history + lifetime counts (plus
    // this bar's masteredAt key on the crossing). jsonb_set with create_if_missing
    // merges into whatever the other two bars already hold instead of replacing them,
    // and COALESCE seeds the object for a card that has never crossed anything.
    const updateQuery = `
      UPDATE ${vetTableForLanguage(cardLanguage)}
      SET "typedMarkHistory" = $1,
          "totalMarkCount" = $2,
          "totalCorrectCount" = $3
          ${crossedIntoMastered
            ? `, "masteredAt" = jsonb_set(COALESCE("masteredAt", '{}'::jsonb), $6::text[], to_jsonb($7::text), true)`
            : ''}
      WHERE id = $4 AND "userId" = $5
    `;
    await client.query(updateQuery, [
      JSON.stringify(updatedHistory),
      newTotalMarkCount,
      newTotalCorrectCount,
      cardId,
      userId,
      // jsonb_set's path is an array; `bar` is a union value, never client input.
      // Stamped with the MARK's timestamp, not now(): it is the mark that mastered
      // the bar, and undo below matches on this exact value to decide whether it is
      // the stamp it must retract.
      ...(crossedIntoMastered ? [`{${bar}}`, newMark.timestamp] : []),
    ]);

    // VELOCITY (docs/VELOCITY.md): this is the ONLY moment a band promotion is
    // observable — bands are derived, so nothing else in the schema would ever know
    // the card moved up. Log the step count when it did.
    //
    // Logged for the MARKED BAR, not the core bar (migration 143): velocity sums
    // band-steps across all three bars, so a reading mark that carries the reading bar
    // from Target to Comfortable is a real step forward and is counted as one. The
    // row records which bar it moved so the velocity read can restrict itself to the
    // bars the account is pursuing.
    //
    // A single mark can cross two bands (the core pbh is continuous), so the size of
    // the move is recorded rather than assumed to be 1. Demotions are not logged.
    //
    // Best-effort by design: a failure here is swallowed after logging, because
    // losing a stat is strictly better than failing the user's review write. The
    // insert reuses this handler's client — it is not in a transaction, so it
    // commits independently of the vet UPDATE above.
    const climbed = bandsClimbed(barCategoryBefore, barCategoryAfter);
    if (climbed > 0) {
      try {
        await categoryPromotionDAL.recordPromotion({
          userId,
          language: cardLanguage,
          vocabEntryId: cardId,
          bar,
          fromCategory: barCategoryBefore,
          toCategory: barCategoryAfter,
          bandsClimbed: climbed,
          markType,
          markTimestamp: newMark.timestamp,
        }, client);
      } catch (promotionError) {
        console.error('Failed to log category promotion (velocity):', promotionError);
      }
    }

    // If correct, return a card from the same category as BEFORE the mark (with fallback priority).
    // In a mode session the replacement pool is capped to the mode's allowed categories.
    if (isCorrect) {
      const allowedCategories = mode ? MODE_CONFIGS[mode].allowed : undefined;
      const newCard = await onDeckVocabService.getNextLibraryCardWithFallback(userId, categoryBeforeMark, cardLanguage, excludeIds, allowedCategories, collection);

      if (!newCard) {
        // "No eligible replacement" is an expected end-of-pool state for EVERY kind of
        // session, not an error, so it is always a 200 with newCard:null and the client
        // winds the loop down. It means one of:
        //   - a mode / deck / Mastered round whose allowed pool is exhausted;
        //   - an unrestricted round where every card is cooling AND the dictionary has
        //     no more words to lend (the service already tried — see
        //     getNextLibraryCardWithFallback).
        // Study used to 404 here on the assumption it could always find a card. It
        // can't any more: honoring the cooldown means an unrestricted session can also
        // legitimately run dry, and a 404 would surface as "failed to save progress"
        // even though the mark above committed fine.
        client.release();
        return res.status(200).json({
          success: true,
          category,
          markTimestamp: newMark.timestamp,
          markType,
          displacedMark,
          newCard: null,
        });
      }

      // Pre-warm the TTS disk cache for the replacement card so its audio is a
      // guaranteed cache hit on the client's follow-up /api/tts/synthesize call.
      // Same graceful-degrade semantics as the working-loop endpoint.
      await onDeckVocabService.prewarmAudio([newCard]);

      client.release();
      return res.status(200).json({
        success: true,
        category,
        markTimestamp: newMark.timestamp,
        markType,
        displacedMark,
        newCard
      });
    } else {
      // If incorrect, just return success with category
      client.release();
      return res.status(200).json({
        success: true,
        category,
        markTimestamp: newMark.timestamp,
        markType,
        displacedMark
      });
    }
  } catch (error: any) {
    console.error('Error marking flashcard:', error);
    client.release();
    res.status(500).json({
      error: error.message || 'Failed to mark flashcard',
      code: error.code || 'ERR_MARK_FAILED'
    });
  }
}));

// Undo the most recently saved flashcard mark (protected route)
router.post('/api/flashcards/undoLastMark', authenticateToken, handle(async (req, res) => {
  const client = await db.getClient();
  try {
    const userId = (req as any).user?.userId;
    const { cardId, markTimestamp, markType: rawMarkType, displacedMark } = req.body || {};

    if (!userId) {
      client.release();
      return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    }

    if (typeof cardId !== 'number' || typeof markTimestamp !== 'string') {
      client.release();
      return res.status(400).json({
        error: 'Invalid request body. Expected { cardId: number, markTimestamp: string, markType?: MarkType }',
        code: 'ERR_INVALID_REQUEST'
      });
    }

    // Undo must revert the SAME typed stream the mark was appended to.
    const markType: MarkType = resolveMarkType(rawMarkType);

    await client.query('BEGIN');

    // FOR UPDATE can't run against the union view, and we don't yet know the row's
    // language, so probe each per-language vet table; the one holding this id
    // returns (and locks) the row. ids are globally unique across the pair.
    let entryResult: any = { rows: [] };
    let lockedVetTable: string | null = null;
    for (const t of VET_PHYSICAL_TABLES) {
      const r = await client.query(
        `SELECT "typedMarkHistory", "totalMarkCount", "totalCorrectCount", "masteredAt" FROM ${t} WHERE id = $1 AND "userId" = $2 FOR UPDATE`,
        [cardId, userId]
      );
      if (r.rows.length > 0) { entryResult = r; lockedVetTable = t; break; }
    }

    if (entryResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({
        error: 'Vocab entry not found',
        code: 'ERR_ENTRY_NOT_FOUND'
      });
    }

    const existingHistory: TypedMarkHistory = entryResult.rows[0].typedMarkHistory || {};
    const existingTrack: ReviewMark[] = Array.isArray(existingHistory[markType]) ? existingHistory[markType]! : [];
    if (existingTrack.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        error: 'No mark history available to undo',
        code: 'ERR_UNDO_NOT_AVAILABLE'
      });
    }

    const lastMark: ReviewMark = existingTrack[existingTrack.length - 1];
    if (lastMark.timestamp !== markTimestamp) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        error: 'Undo target does not match the latest mark',
        code: 'ERR_UNDO_TARGET_MISMATCH'
      });
    }

    let revertedTrack: ReviewMark[] = existingTrack.slice(0, -1);
    const shouldRestoreDisplacedMark =
      displacedMark &&
      typeof displacedMark.timestamp === 'string' &&
      typeof displacedMark.isCorrect === 'boolean';

    if (shouldRestoreDisplacedMark) {
      revertedTrack = [displacedMark as ReviewMark, ...revertedTrack].slice(0, MARK_WINDOW_SIZE);
    }

    const revertedHistory: TypedMarkHistory = { ...existingHistory, [markType]: revertedTrack };

    const currentTotalMarkCount: number = entryResult.rows[0].totalMarkCount || 0;
    const currentTotalCorrectCount: number = entryResult.rows[0].totalCorrectCount || 0;
    const newTotalMarkCount: number = Math.max(0, currentTotalMarkCount - 1);
    const newTotalCorrectCount: number = Math.max(0, currentTotalCorrectCount - (lastMark.isCorrect ? 1 : 0));

    // MASTERY CROSSING, retracted (migrations 142 + 143). If the MARKED BAR's
    // `masteredAt` entry holds THIS mark's timestamp then this is the mark that
    // mastered that bar, and undoing it must take the stamp with it — the same rule as
    // the promotion-row delete below. Only that bar's key is touched; the other two
    // bars' crossings are unrelated events.
    //
    // Set to null rather than restored to the previous crossing: the earlier date is
    // unrecoverable (the rolling mark window has long since evicted the marks it was
    // derived from), and null is exactly the "never observed crossing" value the sort
    // reader already handles. A stamp from any OTHER mark is left alone, which is also
    // what makes this safe when the bar was already mastered before this mark — no
    // transition fired then, so its entry cannot be pointing at it.
    const bar = barForMarkType(markType);
    const storedMasteredAt: MasteredAtByBar | null = entryResult.rows[0].masteredAt ?? null;
    const storedBarStamp = storedMasteredAt?.[bar] ?? null;
    const clearMasteredAt =
      storedBarStamp !== null &&
      new Date(storedBarStamp).getTime() === new Date(markTimestamp).getTime();

    const updateQuery = `
      UPDATE ${lockedVetTable}
      SET "typedMarkHistory" = $1,
          "totalMarkCount" = $2,
          "totalCorrectCount" = $3
          ${clearMasteredAt ? `, "masteredAt" = "masteredAt" - $6::text` : ''}
      WHERE id = $4 AND "userId" = $5
    `;

    await client.query(updateQuery, [
      JSON.stringify(revertedHistory),
      newTotalMarkCount,
      newTotalCorrectCount,
      cardId,
      userId,
      ...(clearMasteredAt ? [bar] : []),
    ]);

    const category: FlashcardCategory = computeCoreCategory(revertedHistory);

    // VELOCITY: an undone mark must give back the band-steps it earned, so delete
    // any promotion rows keyed to this exact (card, mark). Enlisted in the undo
    // transaction — unlike the write path this is NOT best-effort, because leaving
    // the row behind would credit a review the user retracted, and the whole undo
    // rolls back together anyway. No-op when the mark promoted nothing.
    await categoryPromotionDAL.deleteForMark(cardId, markTimestamp, client);

    await client.query('COMMIT');
    client.release();
    return res.status(200).json({
      success: true,
      category
    });
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Undo rollback failed:', rollbackError);
    }
    console.error('Error undoing flashcard mark:', error);
    client.release();
    return res.status(500).json({
      error: error.message || 'Failed to undo flashcard mark',
      code: error.code || 'ERR_UNDO_MARK_FAILED'
    });
  }
}));

export default router;
