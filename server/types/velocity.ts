/**
 * Velocity types — the learner's recent rate of mastery progress.
 *
 * VELOCITY = how many utcm band-steps the learner climbed in the last 7 days
 * (a sliding window, not a calendar week), per (user, language). One card that
 * climbed two bands counts the same as two cards that climbed one each.
 *
 * Steps are summed ACROSS THE THREE MASTERY BARS (migration 143) — mastering a card's
 * reading is progress just as much as mastering its recognition — but only across the
 * bars the account is PURSUING. A promotion in a bar whose goal is off is still
 * logged (the tracks accrue for everyone) and simply not counted, so switching a goal
 * on retroactively enriches the number rather than starting it from zero.
 *
 * Backed by the append-only `category_promotions` table (migration 137); nothing
 * here is a stored counter. See docs/VELOCITY.md.
 */
import type { FlashcardCategory, MarkType, MasteryBarId } from '../contracts/wire.js';

/** One logged promotion: a card moving up one or more utcm bands. */
export interface CategoryPromotion {
  id: string;
  userId: string;
  language: string;
  /** vet id (globally unique across vocabentries_zh / vocabentries_es). */
  vocabEntryId: number;
  /** Which bar moved — derived from the causing mark's type (`barForMarkType`). */
  bar: MasteryBarId;
  fromCategory: FlashcardCategory;
  toCategory: FlashcardCategory;
  /** rank(to) - rank(from); always >= 1. */
  bandsClimbed: number;
  markType: MarkType;
  /** Timestamp of the ReviewMark that caused it — the undo key. */
  markTimestamp: string;
  promotedAt: Date;
}

/** The insert payload for one promotion (everything but the generated id/promotedAt). */
export interface CategoryPromotionInput {
  userId: string;
  language: string;
  vocabEntryId: number;
  bar: MasteryBarId;
  fromCategory: FlashcardCategory;
  toCategory: FlashcardCategory;
  bandsClimbed: number;
  markType: MarkType;
  markTimestamp: string;
}

/** The length of the velocity window, in days. Single source of truth. */
export const VELOCITY_WINDOW_DAYS = 7;

/**
 * Response for GET /api/users/me/velocity.
 * - `byLanguage`: band-steps climbed in the window, keyed by language. Languages
 *   with zero promotions are ABSENT (clients default to 0).
 * - `velocity`: the caller's currently-selected language's number — what the
 *   Account page renders.
 * - `total`: all languages summed.
 */
export interface VelocityResponse {
  velocity: number;
  language: string;
  byLanguage: Record<string, number>;
  total: number;
  windowDays: number;
}
