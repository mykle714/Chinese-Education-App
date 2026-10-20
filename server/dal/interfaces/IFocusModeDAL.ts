import type { MasteryWorldId, TypedMarkHistory } from '../../contracts/wire.js';

/**
 * Focus mode's persisted state for one (user, language) — docs/FOCUS_MODE.md § 2.
 *
 * `timezone` rides along (from `users.timezone`) because every focus decision is keyed
 * on the learner's 04:00-local streak day, and fetching it separately would be a second
 * round trip on every pool/loop request.
 */
export interface FocusState {
  timezone: string;
  focusWorlds: MasteryWorldId[];
  focusEndedNotices: MasteryWorldId[];
}

/** One world's pinned daily set. */
export interface FocusSnapshot {
  /** YYYY-MM-DD, the 04:00-local streak day the set was taken on. */
  streakDate: string;
  vetIds: number[];
}

/**
 * The fields focus mode reads off a vet row: enough to band it, cool it and queue it
 * (`barCategory`, `barCooldownRemainingMs`, `rankCardQueue`), and nothing that needs
 * DICT_JOIN.
 */
export interface FocusCardRow {
  id: number;
  typedMarkHistory: TypedMarkHistory | undefined;
  writingMastery: number | null;
}

/**
 * Data access for focus mode. LAYER: DAL — all of the feature's SQL, none of its rules
 * (those are in services/FocusModeService.ts).
 */
export interface IFocusModeDAL {
  /** The (user, language)'s focus state. A missing user_languages row reads as all-off. */
  getState(userId: string, language: string): Promise<FocusState>;

  /** Add or remove one world from "focusWorlds" (upserting the user_languages row). */
  setWorldOn(userId: string, language: string, world: MasteryWorldId, on: boolean): Promise<void>;

  /**
   * The server's own switch-off: removes `world` from "focusWorlds" AND queues its popup
   * in "focusEndedNotices", in one statement.
   */
  endWithNotice(userId: string, language: string, world: MasteryWorldId): Promise<void>;

  /** Drop the given worlds from "focusEndedNotices" (the client showed their popups). */
  clearNotices(userId: string, language: string, worlds: MasteryWorldId[]): Promise<void>;

  /** The world's stored snapshot, whatever day it was taken on; null if none. */
  getSnapshot(userId: string, language: string, world: MasteryWorldId): Promise<FocusSnapshot | null>;

  /**
   * Store `vetIds` as the world's set for `streakDate` — UNLESS a set for that same day is
   * already stored, in which case the stored one wins and is returned. That makes two
   * concurrent first-of-the-day requests agree on one set instead of the later one
   * silently replacing the set the earlier one already served.
   */
  claimSnapshot(
    userId: string,
    language: string,
    world: MasteryWorldId,
    streakDate: string,
    vetIds: number[]
  ): Promise<FocusSnapshot>;

  /**
   * Every SORTED card the world could deal (the writing world: 1–4-character Han words
   * only, the writing flp's own rule), with what banding and cooling need.
   */
  listWorldCards(userId: string, language: string, world: MasteryWorldId): Promise<FocusCardRow[]>;

  /** The same fields for exactly these ids (still SORTED — a card removed since is gone). */
  listCardsByIds(userId: string, language: string, ids: number[]): Promise<FocusCardRow[]>;
}
