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
import { CATEGORY_BOUNDARIES } from '../contracts/mastery.js';

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

/**
 * Velocity for one language, split by which band boundary was crossed.
 *
 * `boundaryCounts[i]` is how many cards crossed `CATEGORY_BOUNDARIES[i]`
 * (contracts/mastery.ts) inside the window — ascending, so [0] is Unfamiliar→Target
 * and the last entry is Comfortable→Mastered. A card that climbed TWO bands in one
 * mark counts in BOTH boundaries it crossed, which is what makes the entries sum
 * exactly to `total`: `bandsClimbed` IS the number of boundaries crossed.
 *
 * `total` is therefore derived from the counts rather than read from
 * SUM("bandsClimbed"), so the card's `x + y + z = total` arithmetic can never
 * disagree with its own parts.
 */
export interface VelocityBreakdown {
  /** Band-steps climbed — the headline figure. Always equals `boundaryCounts` summed. */
  total: number;
  /** Cards crossing each adjacent-band boundary, aligned with `CATEGORY_BOUNDARIES`. */
  boundaryCounts: number[];
}

/** An all-zero breakdown of the right length — what a language with no promotions reads as. */
export function emptyVelocityBreakdown(): VelocityBreakdown {
  return { total: 0, boundaryCounts: CATEGORY_BOUNDARIES.map(() => 0) };
}

/** The length of the velocity window, in days. Single source of truth. */
export const VELOCITY_WINDOW_DAYS = 7;

/**
 * Response for GET /api/users/me/velocity.
 * - `byLanguage`: band-steps climbed in the window, keyed by language. Languages
 *   with zero promotions are ABSENT (clients default to 0).
 * - `velocity`: the caller's currently-selected language's number — what the
 *   Account page renders.
 * - `boundaryCounts`: that same number split three ways (see `VelocityBreakdown`).
 *   Always present and always the right length, even at zero, so the card never has
 *   to guess how many columns to draw.
 * - `total`: all languages summed.
 */
export interface VelocityResponse {
  velocity: number;
  language: string;
  byLanguage: Record<string, number>;
  /** `velocity` broken out per band boundary, aligned with `CATEGORY_BOUNDARIES`. */
  boundaryCounts: number[];
  total: number;
  windowDays: number;
}
