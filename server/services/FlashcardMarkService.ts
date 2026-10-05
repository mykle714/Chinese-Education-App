import type { PoolClient } from 'pg';
import { dbManager } from '../dal/base/DatabaseManager.js';
import type { TransactionRunner } from '../types/dal.js';
import { DALError, ValidationError } from '../types/dal.js';
import { IVocabEntryDAL, MasteredAtWrite, VetMarkState } from '../dal/interfaces/IVocabEntryDAL.js';
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
  appendTypedMark,
  bandsClimbed,
  barCategory,
  barForMarkType,
  categoryForPbh,
  positiveCount,
  writingMasteryFromChars,
} from '../utils/masteryCompute.js';
import { WRITING_LEVEL_COUNT, WRITING_MAX_CHARS, writingMarkCounts } from '../contracts/writingLevels.js';
import { isMarkOnCooldown } from './cardQueueRanking.js';
import { isFlpOnlyMark } from '../contracts/mastery.js';
import { FLP_MARK_SURFACE } from '../contracts/wire.js';

/**
 * FlashcardMarkService — the single owner of "a learner reviewed a card".
 *
 * LAYER: service. Owns every rule about what a mark does to a card's history:
 * the cooldown + flp-only gates, the rolling per-type window, the mastery-crossing stamp and
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
 * production for one find (docs/WORD_SEARCH_GAME.md). Each call is then gated,
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
   * Which surface produced this mark ("bubble-match", "flp", …). ONE rule branches on
   * it: a know mark on a card at core pbh ≥ 6 is recorded only when this is
   * `FLP_MARK_SURFACE` (`isFlpOnlyMark`, docs/MASTERY_REWORK.md § 6). Otherwise it
   * feeds the suppressed-mark log (docs/HYDRA_BUBBLES.md § 8.1).
   *
   * Client-asserted and not verified — acceptable because the only thing a forged
   * 'flp' buys is a mark on the learner's OWN card, which the flp could write anyway.
   */
  surface?: string;
  /**
   * REQUIRED when `markType === 'writing'` (docs/WRITING_PRACTICE_REWORK.md § 3a): the
   * level the word was written at and each character's result, in word order. The
   * writing path ignores `isCorrect` in favour of `perChar`.
   */
  writing?: WritingResultInput;
}

/** A graded writing attempt (`src/components/handwriting/types.ts` → WritingAttempt). */
export interface WritingResultInput {
  /** 1..8 — server/contracts/writingLevels.ts. */
  level: number;
  /** One result per character of the card's word. */
  perChar: boolean[];
}

/** What the writing fan-out did with each distinct character. */
export interface WritingCharacterOutcome {
  char: string;
  isCorrect: boolean;
  /** False when the mark was not written: `farming` (level ≤ mastery) or `no-row`. */
  counted: boolean;
  reason?: 'farming' | 'no-row';
}

export interface ApplyMarkResult {
  /**
   * The mark was NOT recorded — either its bar's clock had not finished cooling
   * (docs/HYDRA_BUBBLES.md § 8), or it is a know mark from a non-flp surface on a card
   * at core pbh ≥ 6 (docs/MASTERY_REWORK.md § 6). A success, not an error — the review
   * genuinely happened, it just changed no history.
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
  /**
   * The band, BEFORE the mark, of the bar THIS mark moves (`barForMarkType`). For a
   * know mark that is the core band again; for a reading mark it is the reading band.
   * The flp's READING mode paces its refill on this rather than on the core band,
   * because its queue is banded by the reading bar (docs/READING_WRITING_CENTERS.md
   * § Phase 4).
   */
  markedBarCategoryBefore: FlashcardCategory;
  /** The undo key. Null exactly when suppressed: there is no mark to undo. */
  markTimestamp: string | null;
  markType: MarkType;
  /** The mark pushed out of a full 8-slot window, so undo can restore it. */
  displacedMark: ReviewMark | null;
  /** Writing marks only: per-character outcome of the fan-out. */
  writing?: { characters: WritingCharacterOutcome[] };
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

      // Writing has its own model (per-character mastery, a clock-only word track and
      // the anti-farming gate) — see applyWritingResult.
      if (markType === 'writing') {
        return this.applyWritingResult(client, userId, cardId, state, input.writing, input.surface);
      }

      // ── TWO GATES, ONE OUTCOME: THE MARK IS NOT RECORDED ─────────────────────
      // Enforced here, at the single chokepoint every surface writes through, so no
      // game and no future surface has to know the rules exist — which is the design.
      //
      //   cooldown — cooldown is a hard "next markable at" (docs/HYDRA_BUBBLES.md § 8).
      //              Timed per BAR: recognition and production share the know clock,
      //              so a correct mark on either rests both (docs/MASTERY_REWORK.md § 6).
      //   flp-only — once core pbh ≥ 6 a recognition/production mark counts only from
      //              the flp (`isFlpOnlyMark`). Judged on the history AS IT STANDS, so an
      //              incorrect flp mark that drops pbh under 6 reopens the card to games
      //              on the next mark with no state to clear. Incorrect game marks are
      //              dropped too: above the line a game can neither build nor erode it.
      //
      // Reported as a success: the caller genuinely did the review and the games
      // score the clear regardless. Failing the call would turn an invisible policy
      // into a visible one and force every caller to learn about it.
      const surface = typeof input.surface === 'string' ? input.surface.slice(0, 40) : 'unknown';
      const suppressedBy: 'cooldown' | 'flp-only' | null =
        isMarkOnCooldown(existingHistory, markType, Date.now())
          ? 'cooldown'
          : surface !== FLP_MARK_SURFACE && isFlpOnlyMark(existingHistory, markType)
            ? 'flp-only'
            : null;
      if (suppressedBy) {
        // ⚠️ INSTRUMENTED, NOT SILENT (docs/HYDRA_BUBBLES.md § 8.1,
        // docs/DEFERRED_WORK.md). `getGameVocabPool` fill tier 4 hands out COOLED
        // cards whenever the fresh tiers cannot fill a board, so this guard drops
        // marks that are recorded today. The frequency is unknown, which is why it
        // ships logged: the log is what a follow-up reads to decide whether tier 4
        // should be deleted in favour of lending. `surface` distinguishes tier-4
        // suppression from the deck/collection suppression that is INTENDED (§ 6.3);
        // `reason` separates the two gates.
        console.log(
          `[MarkSuppressed] user=${String(userId).substring(0, 8)}… card=${cardId} ` +
            `language=${language} type=${markType} reason=${suppressedBy} ` +
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
            markedBarCategoryBefore: barCategory(existingHistory, barForMarkType(markType)),
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
          markedBarCategoryBefore: barCategoryBefore,
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
   * The WRITING mark path (docs/WRITING_PRACTICE_REWORK.md § 3a). Runs inside
   * `applyMark`'s transaction with the card's row already locked.
   *
   * SINGLE CHARACTER — the card IS the character: the usual cooldown gate, then the
   * anti-farming gate (`writingMarkCounts`: level > its mastery), then one ordinary mark.
   *
   * MULTI-CHARACTER WORD —
   *   1. lock (creating hidden provisional rows as needed) every character's own
   *      single-character row, in a fixed order;
   *   2. the word's mastery is the AVERAGE of those rows' writing counts; the cooldown
   *      gate reads the WORD's clock (its own track) with that averaged band's window —
   *      a word on cooldown writes nothing at all;
   *   3. a clock-only dummy mark goes on the word (correct iff every character was);
   *   4. each distinct character gets a `viaWord` mark — which counts as mastery but
   *      never restarts the character's own clock — only if the level is above THAT
   *      character's mastery. A repeated character (谢谢) is one mark, correct only if
   *      every occurrence was.
   * The word's `masteredAt.writing` and velocity row follow its averaged band. A
   * character row's own crossing stamp is written; its velocity is not logged (the
   * learner's progress is reported on the word they practised).
   */
  private async applyWritingResult(
    client: PoolClient,
    userId: string,
    cardId: number,
    state: VetMarkState,
    writing: WritingResultInput | undefined,
    rawSurface: string | undefined
  ): Promise<{ result: ApplyMarkResult; promotion: Parameters<ICategoryPromotionDAL['recordPromotion']>[0] | null }> {
    const chars = [...(state.entryKey ?? '')];
    // No writing surface holds more than WRITING_MAX_CHARS characters (the 2×2 grid), so
    // a longer word can only arrive here from a bypassed client gate — refuse it rather
    // than spread viaWord marks across its characters.
    if (chars.length < 1 || chars.length > WRITING_MAX_CHARS) {
      throw new ValidationError(`Writing marks are only accepted for words of 1–${WRITING_MAX_CHARS} characters`);
    }
    if (
      !writing ||
      !Number.isInteger(writing.level) ||
      writing.level < 1 ||
      writing.level > WRITING_LEVEL_COUNT ||
      !Array.isArray(writing.perChar) ||
      writing.perChar.length !== chars.length ||
      !writing.perChar.every((v) => typeof v === 'boolean')
    ) {
      throw new ValidationError('A writing mark needs { level: 1..8, perChar: boolean[] } with one result per character');
    }
    const { level, perChar } = writing;
    const surface = typeof rawSurface === 'string' ? rawSurface.slice(0, 40) : 'unknown';
    const language = state.language;
    const history = state.typedMarkHistory;
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const coreCategory = computeCoreCategory(history);
    const allCorrect = perChar.every(Boolean);

    const suppressed = (
      reason: string,
      bandBefore: FlashcardCategory,
      characters: WritingCharacterOutcome[]
    ) => {
      console.log(
        `[MarkSuppressed] user=${String(userId).substring(0, 8)}… card=${cardId} ` +
          `language=${language} type=writing reason=${reason} surface=${surface} level=${level}`
      );
      return {
        promotion: null,
        result: {
          suppressed: true,
          language,
          category: coreCategory,
          categoryBeforeMark: coreCategory,
          markedBarCategoryBefore: bandBefore,
          markTimestamp: null,
          markType: 'writing' as MarkType,
          displacedMark: null,
          writing: { characters },
        } satisfies ApplyMarkResult,
      };
    };

    // ── Single character: the card is the character ────────────────────────────
    if (chars.length === 1) {
      const mastery = positiveCount(history.writing);
      const bandBefore = categoryForPbh(mastery);
      const outcome: WritingCharacterOutcome = { char: chars[0], isCorrect: perChar[0], counted: false };
      if (isMarkOnCooldown(history, 'writing', now)) return suppressed('cooldown', bandBefore, [outcome]);
      if (!writingMarkCounts(level, mastery)) {
        return suppressed('farming', bandBefore, [{ ...outcome, reason: 'farming' }]);
      }
      const track = Array.isArray(history.writing) ? history.writing : [];
      const displacedMark = track.length >= MARK_WINDOW_SIZE ? track[0] : null;
      const updated = appendTypedMark(history, 'writing', { timestamp, isCorrect: perChar[0] });
      const bandAfter = categoryForPbh(positiveCount(updated.writing));
      await this.vocabEntryDAL.updateMarkHistory(
        userId, cardId, language, updated,
        bandBefore !== 'Mastered' && bandAfter === 'Mastered' ? { bar: 'writing', stamp: timestamp } : null,
        client
      );
      const climbed = bandsClimbed(bandBefore, bandAfter);
      return {
        promotion: climbed > 0
          ? { userId, language, vocabEntryId: cardId, bar: 'writing', fromCategory: bandBefore,
              toCategory: bandAfter, bandsClimbed: climbed, markType: 'writing', markTimestamp: timestamp }
          : null,
        result: {
          suppressed: false, language, category: coreCategory, categoryBeforeMark: coreCategory,
          markedBarCategoryBefore: bandBefore, markTimestamp: timestamp, markType: 'writing',
          displacedMark, writing: { characters: [{ ...outcome, counted: true }] },
        },
      };
    }

    // ── Multi-character word: fan out onto the characters ──────────────────────
    const charStates = await this.vocabEntryDAL.ensureCharacterMarkStates(userId, chars, client);
    const byChar = new Map(charStates.map((c) => [c.entryKey, c]));
    const historiesFor = () => chars.map((c) => byChar.get(c)?.typedMarkHistory);

    const masteryBefore = writingMasteryFromChars(historiesFor());
    const bandBefore = categoryForPbh(masteryBefore);

    // Distinct characters with their combined result (every occurrence must be right).
    const distinct: { char: string; isCorrect: boolean }[] = [];
    chars.forEach((c, i) => {
      const seen = distinct.find((d) => d.char === c);
      if (seen) seen.isCorrect = seen.isCorrect && perChar[i];
      else distinct.push({ char: c, isCorrect: perChar[i] });
    });

    if (isMarkOnCooldown(history, 'writing', now, masteryBefore)) {
      return suppressed('cooldown', bandBefore, distinct.map((d) => ({ ...d, counted: false })));
    }

    const outcomes: WritingCharacterOutcome[] = [];
    for (const d of distinct) {
      const row = byChar.get(d.char);
      if (!row) {
        outcomes.push({ ...d, counted: false, reason: 'no-row' });
        continue;
      }
      const charMastery = positiveCount(row.typedMarkHistory.writing);
      if (!writingMarkCounts(level, charMastery)) {
        outcomes.push({ ...d, counted: false, reason: 'farming' });
        continue;
      }
      const updated = appendTypedMark(row.typedMarkHistory, 'writing', {
        timestamp, isCorrect: d.isCorrect, viaWord: true,
      });
      const charBefore = categoryForPbh(charMastery);
      const charAfter = categoryForPbh(positiveCount(updated.writing));
      await this.vocabEntryDAL.updateMarkHistory(
        userId, row.id, 'zh', updated,
        charBefore !== 'Mastered' && charAfter === 'Mastered' ? { bar: 'writing', stamp: timestamp } : null,
        client
      );
      byChar.set(d.char, { ...row, typedMarkHistory: updated });
      outcomes.push({ ...d, counted: true });
    }

    // The word's clock: a dummy mark, never mastery (positiveCount skips clockOnly).
    const wordTrack = Array.isArray(history.writing) ? history.writing : [];
    const displacedMark = wordTrack.length >= MARK_WINDOW_SIZE ? wordTrack[0] : null;
    const wordHistory = appendTypedMark(history, 'writing', { timestamp, isCorrect: allCorrect, clockOnly: true });
    const bandAfter = categoryForPbh(writingMasteryFromChars(historiesFor()));
    await this.vocabEntryDAL.updateMarkHistory(
      userId, cardId, language, wordHistory,
      bandBefore !== 'Mastered' && bandAfter === 'Mastered' ? { bar: 'writing', stamp: timestamp } : null,
      client
    );

    const climbed = bandsClimbed(bandBefore, bandAfter);
    return {
      promotion: climbed > 0
        ? { userId, language, vocabEntryId: cardId, bar: 'writing', fromCategory: bandBefore,
            toCategory: bandAfter, bandsClimbed: climbed, markType: 'writing', markTimestamp: timestamp }
        : null,
      result: {
        suppressed: false, language, category: coreCategory, categoryBeforeMark: coreCategory,
        markedBarCategoryBefore: bandBefore, markTimestamp: timestamp, markType: 'writing',
        displacedMark, writing: { characters: outcomes },
      },
    };
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
    // A writing result is one word mark plus a fan-out onto several character rows;
    // there is no single "newest mark" to revert, and no surface offers it.
    if (markType === 'writing') {
      throw new DALError('Writing marks cannot be undone', 'ERR_UNDO_NOT_AVAILABLE', 409);
    }

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
