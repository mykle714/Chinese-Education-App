import type { PoolClient } from 'pg';
import { dbManager } from '../dal/base/DatabaseManager.js';
import type { TransactionRunner } from '../types/dal.js';
import { DALError, ValidationError } from '../types/dal.js';
import { IVocabEntryDAL, MasteredAtWrite } from '../dal/interfaces/IVocabEntryDAL.js';
import { ICategoryPromotionDAL } from '../dal/interfaces/ICategoryPromotionDAL.js';
import {
  ReviewMark,
  FlashcardCategory,
  MarkType,
  MARK_WINDOW_SIZE,
  TypedMarkHistory,
} from '../types/index.js';
import {
  computeCoreCategory,
  computeTypeCategory,
  appendTypedMark,
  bandsClimbed,
  barCategory,
  barForMarkType,
} from '../utils/masteryCompute.js';
import { isTypeOnCooldown } from './cardQueueRanking.js';

/**
 * FlashcardMarkService — the single owner of "a learner reviewed a card".
 *
 * LAYER: service. Owns every rule about what a mark does to a card's history:
 * the cooldown gate, the rolling per-type window, the mastery-crossing stamp and
 * the velocity log. Holds no SQL and no `req`/`res`; the vet reads/writes go through
 * `IVocabEntryDAL` and the transaction runner is injected
 * (docs/BACKEND_LAYERING.md § 3).
 *
 * WHY IT EXISTS. This logic lived inline in `routes/flashcardRoutes.ts` — the last
 * two route handlers in the codebase with embedded SQL. Eight client surfaces write
 * through `POST /api/flashcards/mark` (flp, six games, the Practice Writing button),
 * so this is the app's most consequential write and its only mark-policy chokepoint;
 * having it inside an Express callback meant no non-HTTP caller could ever record a
 * mark and none of the banding rules could be tested without booting a router.
 *
 * DELIBERATELY DOES NOT PICK A REPLACEMENT CARD. `applyMark` records the mark and
 * returns the bands either side of it; choosing the next card the learner sees is
 * `OnDeckVocabService`'s job, and only one of the eight callers wants it. The route
 * composes the two. `categoryBeforeMark` is returned precisely so that composition
 * is possible without the refill having to re-read the row.
 *
 * MASTERY MODEL (migrations 101 + 143, docs/MASTERY_REWORK.md): a mark carries a
 * `type` (recognition/production/reading/writing); a card keeps the 8 most recent
 * marks PER TYPE in `typedMarkHistory`; those four tracks feed THREE bars — core
 * (recognition + production), reading, writing. No band is stored; every band here is
 * derived from `typedMarkHistory` alone.
 *
 * ONE MARK PER CALL, deliberately. A surface exercising two tracks at once calls
 * twice rather than passing a list — Word Search's No-Pinyin board writes reading +
 * production for one find (docs/WORD_SEARCH_GAME.md). Each call is then cooldown-gated,
 * banded and (for the flp) refilled on its own track, which is the behaviour that
 * surface wants; widening the input to N types would push a multi-bar result shape
 * onto every other caller to serve one.
 *
 * Referenced by: docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md,
 * docs/MASTERY_REWORK.md, docs/HYDRA_BUBBLES.md § 8, docs/VELOCITY.md.
 */

/** One review mark, as the caller states it. */
export interface ApplyMarkInput {
  userId: string;
  cardId: number;
  isCorrect: boolean;
  markType: MarkType;
  /**
   * Which surface produced this mark ("bubble-match", "flp", …). PURELY DIAGNOSTIC —
   * nothing branches on it. It exists so the suppressed-mark log can tell apart the
   * two reasons a mark is dropped (docs/HYDRA_BUBBLES.md § 8.1).
   */
  surface?: string;
}

export interface ApplyMarkResult {
  /**
   * The mark was NOT recorded because its track had not finished cooling
   * (docs/HYDRA_BUBBLES.md § 8). A success, not an error — the review genuinely
   * happened, it just changed no history.
   */
  suppressed: boolean;
  /** The card's language. The caller needs it to scope a same-language refill. */
  language: string;
  /** CORE bar band AFTER the mark. Unchanged from before when suppressed. */
  category: FlashcardCategory;
  /**
   * CORE bar band BEFORE the mark — the pool an flp replacement is drawn from. The
   * refill is paced by the band the learner just left, not the one they just reached.
   */
  categoryBeforeMark: FlashcardCategory;
  /** The undo key. Null exactly when suppressed: there is no mark to undo. */
  markTimestamp: string | null;
  markType: MarkType;
  /** The mark pushed out of a full 8-slot window, so undo can restore it. */
  displacedMark: ReviewMark | null;
}

export interface UndoMarkInput {
  userId: string;
  cardId: number;
  /** Must match the newest mark on `markType`'s track, or the undo is refused. */
  markTimestamp: string;
  markType: MarkType;
  /** The mark this one displaced, as handed back by `applyMark`. */
  displacedMark?: ReviewMark | null;
}

export interface UndoMarkResult {
  /** CORE bar band after the revert. */
  category: FlashcardCategory;
}

export class FlashcardMarkService {
  constructor(
    private vocabEntryDAL: IVocabEntryDAL,
    private categoryPromotionDAL: ICategoryPromotionDAL,
    /**
     * Optional — see TransactionRunner. Defaults to the process-wide manager so the
     * composition root is unchanged; a test passes a fake and never opens a connection.
     */
    private txRunner: TransactionRunner = dbManager
  ) {}

  /**
   * Record one review mark.
   *
   * TRANSACTIONAL, WITH A ROW LOCK. Appending to `typedMarkHistory` is a
   * read-modify-write over a whole jsonb column, so two concurrent marks on the same
   * card would both read the same history and the second UPDATE would erase the
   * first. That is not hypothetical: Word Search fires its reading and production
   * marks in the same tick without awaiting either, so a No-Pinyin find raced with
   * itself and could lose a track. `findMarkState(..., forUpdate)` serializes them.
   *
   * THROWS `ERR_ENTRY_NOT_FOUND` (404) when the id is not a card this user owns.
   */
  async applyMark(input: ApplyMarkInput): Promise<ApplyMarkResult> {
    const { userId, cardId, isCorrect, markType } = input;
    if (!userId) throw new ValidationError('userId is required');
    if (typeof cardId !== 'number') throw new ValidationError('cardId must be a number');
    if (typeof isCorrect !== 'boolean') throw new ValidationError('isCorrect must be a boolean');

    // The velocity row is written AFTER the commit (see below), so the transaction
    // hands back what that write needs alongside the caller's result.
    const { result, promotion } = await this.txRunner.executeInTransaction(async (tx) => {
      const client: PoolClient = tx.getClient();

      const state = await this.vocabEntryDAL.findMarkState(userId, cardId, { client, forUpdate: true });
      if (!state) {
        throw new DALError('Vocab entry not found', 'ERR_ENTRY_NOT_FOUND', 404);
      }

      const existingHistory: TypedMarkHistory = state.typedMarkHistory;
      const language = state.language;

      // ── COOLDOWN IS A HARD "NEXT MARKABLE AT" (docs/HYDRA_BUBBLES.md § 8) ────
      // A mark on a track that has not finished cooling is NOT RECORDED. Enforced
      // here, at the single chokepoint every surface writes through, so no game and
      // no future surface has to know the rule exists — which is the whole design.
      //
      // Reported as a success: the caller genuinely did the review and the games
      // score the clear regardless. Failing the call would turn an invisible policy
      // into a visible one and force every caller to learn about cooldowns.
      const cooldownWindow = computeTypeCategory(existingHistory, markType);
      if (isTypeOnCooldown(existingHistory, markType, Date.now(), cooldownWindow)) {
        // ⚠️ INSTRUMENTED, NOT SILENT (docs/HYDRA_BUBBLES.md § 8.1,
        // docs/DEFERRED_WORK.md). `getGameVocabPool` fill tier 4 hands out COOLED
        // cards whenever the fresh tiers cannot fill a board, so this guard drops
        // marks that are recorded today. The frequency is unknown, which is why it
        // ships logged: the log is what a follow-up reads to decide whether tier 4
        // should be deleted in favour of lending. `surface` distinguishes tier-4
        // suppression from the deck/collection suppression that is INTENDED (§ 6.3).
        const surface = typeof input.surface === 'string' ? input.surface.slice(0, 40) : 'unknown';
        console.log(
          `[MarkSuppressed] user=${String(userId).substring(0, 8)}… card=${cardId} ` +
            `language=${language} type=${markType} window=${cooldownWindow} ` +
            `surface=${surface} isCorrect=${isCorrect}`
        );
        const unchanged = computeCoreCategory(existingHistory);
        return {
          promotion: null,
          result: {
            suppressed: true,
            language,
            category: unchanged,
            categoryBeforeMark: unchanged,
            markTimestamp: null,
            markType,
            displacedMark: null,
          } satisfies ApplyMarkResult,
        };
      }

      // The bar this mark moves. Every mark lands in exactly one, so the crossing
      // stamp and the velocity row below are each single-bar decisions.
      const bar = barForMarkType(markType);
      const categoryBeforeMark: FlashcardCategory = computeCoreCategory(existingHistory);
      const barCategoryBefore = barCategory(existingHistory, bar);

      // Preserve the mark displaced from THIS TYPE's window when it is already full,
      // so undo can restore it precisely (per-type window of MARK_WINDOW_SIZE).
      const existingTrack: ReviewMark[] = Array.isArray(existingHistory[markType])
        ? existingHistory[markType]!
        : [];
      const displacedMark: ReviewMark | null =
        existingTrack.length >= MARK_WINDOW_SIZE ? existingTrack[0] : null;

      const newMark: ReviewMark = { timestamp: new Date().toISOString(), isCorrect };
      const updatedHistory: TypedMarkHistory = appendTypedMark(existingHistory, markType, newMark);

      const category: FlashcardCategory = computeCoreCategory(updatedHistory);
      const barCategoryAfter = barCategory(updatedHistory, bar);

      // MASTERY CROSSING (migrations 142 + 143): this is the ONLY moment "this bar
      // became mastered" is observable — `typedMarkHistory` is a rolling 8-mark
      // window, so the marks that carried the bar over the line are evicted long
      // before anyone asks when it happened.
      //
      // Stamped on the un-mastered → mastered transition only, and never cleared on
      // regression: the entry means "last time this bar crossed into mastered", so
      // one bad mark must not erase the date. Re-crossing overwrites it.
      //
      // Stamped even when the bar's goal is OFF. The reading/writing tracks accrue
      // for everyone ("keep accruing, hide the bar"), so a learner who turns the
      // reading goal on later finds their real crossing dates already there rather
      // than an empty column that back-dates their work to zero.
      //
      // Stamped with the MARK's timestamp, not now(): it is the mark that mastered
      // the bar, and undo matches on this exact value to decide whether the stamp is
      // one it must retract.
      const crossedIntoMastered = barCategoryBefore !== 'Mastered' && barCategoryAfter === 'Mastered';
      const masteredAt: MasteredAtWrite | null = crossedIntoMastered
        ? { bar, stamp: newMark.timestamp }
        : null;

      await this.vocabEntryDAL.updateMarkHistory(
        userId, cardId, language, updatedHistory, masteredAt, client
      );

      // VELOCITY (docs/VELOCITY.md): a band promotion is observable only here, since
      // bands are derived and nothing else in the schema would know the card moved up.
      //
      // Logged for the MARKED BAR, not the core bar (migration 143): a reading mark
      // that carries the reading bar from Target to Comfortable is a real step
      // forward. A single mark can cross two bands, so the size of the move is
      // recorded rather than assumed to be 1. Demotions are not logged.
      const climbed = bandsClimbed(barCategoryBefore, barCategoryAfter);

      return {
        promotion: climbed > 0
          ? {
              userId,
              language,
              vocabEntryId: cardId,
              bar,
              fromCategory: barCategoryBefore,
              toCategory: barCategoryAfter,
              bandsClimbed: climbed,
              markType,
              markTimestamp: newMark.timestamp,
            }
          : null,
        result: {
          suppressed: false,
          language,
          category,
          categoryBeforeMark,
          markTimestamp: newMark.timestamp,
          markType,
          displacedMark,
        } satisfies ApplyMarkResult,
      };
    });

    // BEST-EFFORT BY DESIGN, and deliberately OUTSIDE the transaction above: losing a
    // stat is strictly better than failing the learner's review write. It cannot go
    // inside — a failed INSERT aborts the whole Postgres transaction, so catching the
    // error there would still roll the mark back (a SAVEPOINT would work, but that is
    // transaction-control SQL a service should not be issuing). The cost of moving it
    // out is that a crash in this window loses one velocity row, which is the same
    // exposure the previous non-transactional insert already had.
    if (promotion) {
      try {
        await this.categoryPromotionDAL.recordPromotion(promotion);
      } catch (promotionError) {
        console.error('Failed to log category promotion (velocity):', promotionError);
      }
    }

    return result;
  }

  /**
   * Revert the newest mark on one typed track, restoring the mark it displaced.
   *
   * Fully transactional and stricter than `applyMark`: an undo that targets anything
   * other than the newest mark is refused rather than guessed at, because the client
   * that asked for it is working from stale state.
   *
   * THROWS `ERR_ENTRY_NOT_FOUND` (404), `ERR_UNDO_NOT_AVAILABLE` (409, nothing on the
   * track) or `ERR_UNDO_TARGET_MISMATCH` (409, not the newest mark).
   */
  async undoMark(input: UndoMarkInput): Promise<UndoMarkResult> {
    const { userId, cardId, markTimestamp, markType, displacedMark } = input;
    if (!userId) throw new ValidationError('userId is required');
    if (typeof cardId !== 'number') throw new ValidationError('cardId must be a number');
    if (!markTimestamp) throw new ValidationError('markTimestamp is required');

    return this.txRunner.executeInTransaction(async (tx) => {
      const client: PoolClient = tx.getClient();

      const state = await this.vocabEntryDAL.findMarkState(userId, cardId, { client, forUpdate: true });
      if (!state) {
        throw new DALError('Vocab entry not found', 'ERR_ENTRY_NOT_FOUND', 404);
      }

      const existingHistory: TypedMarkHistory = state.typedMarkHistory;
      const existingTrack: ReviewMark[] = Array.isArray(existingHistory[markType])
        ? existingHistory[markType]!
        : [];
      if (existingTrack.length === 0) {
        throw new DALError('No mark history available to undo', 'ERR_UNDO_NOT_AVAILABLE', 409);
      }

      const lastMark: ReviewMark = existingTrack[existingTrack.length - 1];
      if (lastMark.timestamp !== markTimestamp) {
        throw new DALError('Undo target does not match the latest mark', 'ERR_UNDO_TARGET_MISMATCH', 409);
      }

      let revertedTrack: ReviewMark[] = existingTrack.slice(0, -1);
      const shouldRestoreDisplacedMark =
        !!displacedMark &&
        typeof displacedMark.timestamp === 'string' &&
        typeof displacedMark.isCorrect === 'boolean';
      if (shouldRestoreDisplacedMark) {
        revertedTrack = [displacedMark as ReviewMark, ...revertedTrack].slice(0, MARK_WINDOW_SIZE);
      }

      const revertedHistory: TypedMarkHistory = { ...existingHistory, [markType]: revertedTrack };

      // MASTERY CROSSING, retracted (migrations 142 + 143). If the MARKED BAR's
      // `masteredAt` entry holds THIS mark's timestamp then this is the mark that
      // mastered that bar, and undoing it must take the stamp with it. Only that bar's
      // key is touched; the other two bars' crossings are unrelated events.
      //
      // Dropped rather than restored to the previous crossing: the earlier date is
      // unrecoverable (the rolling window evicted the marks it was derived from), and
      // absent is exactly the "never observed crossing" value the sort reader already
      // handles. A stamp from any OTHER mark is left alone, which is what makes this
      // safe when the bar was already mastered before this mark — no transition fired
      // then, so its entry cannot be pointing at it.
      const bar = barForMarkType(markType);
      const storedBarStamp = state.masteredAt?.[bar] ?? null;
      const clearMasteredAt =
        storedBarStamp !== null &&
        new Date(storedBarStamp).getTime() === new Date(markTimestamp).getTime();

      await this.vocabEntryDAL.updateMarkHistory(
        userId, cardId, state.language, revertedHistory,
        clearMasteredAt ? { bar, stamp: null } : null,
        client
      );

      // VELOCITY: an undone mark must give back the band-steps it earned, so delete
      // any promotion rows keyed to this exact (card, mark). Enlisted in the undo
      // transaction — unlike the write path this is NOT best-effort, because leaving
      // the row behind would credit a review the user retracted, and the whole undo
      // rolls back together anyway. No-op when the mark promoted nothing.
      await this.categoryPromotionDAL.deleteForMark(cardId, markTimestamp, client);

      return { category: computeCoreCategory(revertedHistory) };
    });
  }
}
