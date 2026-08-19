import type { PoolClient } from 'pg';
import type { Arena, ArenaMember, ArenaFormationKind } from '../../types/arena.js';

/** A (user, language) pair eligible to be placed into an arena this week. */
export interface ArenaCandidate {
  userId: string;
  language: string;
  division: number;
  timezone: string;
  /** 5-char geohash cell, or null for the location-less pool (§ 5.2a). */
  geoCell: string | null;
  /**
   * The week key this candidate opted into (`user_languages."arenaOptInWeek"`,
   * YYYY-MM-DD), as written by ArenaService.optIn IN THE USER'S OWN TIMEZONE.
   *
   * Returned rather than filtered on in SQL because the key is only meaningful
   * against the candidate's own zone: two users in different zones can be in
   * different arena weeks at the same instant, so one server-side "current week"
   * cannot filter both correctly. The service compares it per (timezone) bucket.
   */
  optInWeek: string;
}

/** A member to be inserted at formation — either a human or a bot, never both. */
export interface ArenaMemberSeed {
  userId: string | null;
  language: string;
  syntheticName?: string | null;
  syntheticAvatarIconId?: string | null;
  syntheticSeed?: number | null;
  syntheticTarget?: number | null;
}

/** What resolution writes back to one member row. */
export interface ArenaResolutionRow {
  memberId: string;
  finalRank: number;
  divisionChange: number;
}

/**
 * Persists `arenas` + `arena_members` (migration 146).
 *
 * NO POLICY LIVES HERE (docs/BACKEND_LAYERING.md). Clustering, the synthetic
 * score curve, promotion cutoffs and opt-in rules are all ArenaService's.
 * This layer only reads and writes rows.
 */
export interface IArenaDAL {
  // ── Reads ──────────────────────────────────────────────────────────────────

  findArenaById(id: string, client?: PoolClient): Promise<Arena | null>;

  /** The live arena a (user, language) currently belongs to, if any. */
  findLiveArenaForUser(
    userId: string,
    language: string,
    client?: PoolClient,
  ): Promise<Arena | null>;

  /** The most recently closed arena a (user, language) was in — the results view. */
  findLastResolvedArenaForUser(
    userId: string,
    language: string,
    client?: PoolClient,
  ): Promise<Arena | null>;

  listMembers(arenaId: string, client?: PoolClient): Promise<ArenaMember[]>;

  /**
   * Every (user, language) holding an opt-in and NOT currently seated in a live
   * arena, with the clustering inputs and the week they opted into. Ordered by
   * (timezone, division, geoCell) so the service can bucket without a second
   * pass.
   *
   * ── Why "unseated" is part of the query, not a later filter ────────────────
   * This one list serves BOTH halves of formation: the batch run (where nobody
   * in the bucket is seated yet) and the straggler run (where most of the bucket
   * already is). Excluding live members in SQL is also the only cheap defence
   * against the hazard `createArenaWithMembers` cannot survive: a candidate who
   * still holds a live seat makes the multi-row member INSERT violate
   * uq_arena_member_live, which fails the WHOLE arena, not just that row.
   *
   * Stale opt-ins for past weeks are returned too and are discarded by the
   * service's per-bucket week check — the opt-in column is self-expiring by
   * design (§ 8) and has no cleanup job to lean on.
   */
  listUnseatedCandidates(client?: PoolClient): Promise<ArenaCandidate[]>;

  /** Arenas past their close instant that have not been resolved yet. */
  listUnresolvedArenas(asOf: Date, client?: PoolClient): Promise<Arena[]>;

  /** Guards formation against running twice for the same bucket. */
  arenaExistsForBucket(
    timezone: string,
    division: number,
    weekStartsAt: Date,
    client?: PoolClient,
  ): Promise<boolean>;

  /**
   * The bucket's most recent unresolved arena that still holds a synthetic seat,
   * or null when every arena in the bucket is full of humans (§ 5.3 step 1).
   *
   * Most recent first because chunking fills each arena to 25 before opening the
   * next (§ 5.4), so the newest arena of a bucket is the partly-empty remainder —
   * the one a straggler should land in.
   */
  findArenaWithFreeSeat(
    timezone: string,
    division: number,
    weekStartsAt: Date,
    client?: PoolClient,
  ): Promise<Arena | null>;

  // ── Writes ─────────────────────────────────────────────────────────────────

  /**
   * Create one arena and all 25 of its members in a SINGLE transaction.
   *
   * Atomic because a half-populated arena is worse than no arena: it would be
   * live, readable and wrong, and the live-membership index would have already
   * consumed seats for the members that did land.
   */
  createArenaWithMembers(
    arena: {
      division: number;
      timezone: string;
      geoCellPrefix: string | null;
      formationKind: ArenaFormationKind;
      weekStartsAt: Date;
      closesAt: Date;
    },
    members: ArenaMemberSeed[],
    client?: PoolClient,
  ): Promise<Arena>;

  /** Add one straggler to an arena that still has a synthetic seat free (§ 5.3). */
  replaceSyntheticWithHuman(
    arenaId: string,
    userId: string,
    language: string,
    client?: PoolClient,
  ): Promise<boolean>;

  /** Increment a live membership's stored counter (§ 4.1). No-op if not live. */
  addMinutes(
    userId: string,
    language: string,
    minutes: number,
    client?: PoolClient,
  ): Promise<void>;

  /**
   * Close an arena: stamp `resolvedAt`, write every member's final rank and
   * division change, and clear `isLive` on ALL of its members — in ONE
   * transaction.
   *
   * ⚠️ THE isLive FLIP IS NOT OPTIONAL AND MUST NOT MOVE OUT OF THIS METHOD.
   * `arena_members."isLive"` is denormalised from `arenas."resolvedAt" IS NULL`
   * purely so the one-live-membership rule is indexable (§ 9, Q21). If an arena
   * is stamped resolved but its members stay live, every one of those users is
   * permanently unable to join another arena — silently, and spreading by one
   * cohort per week. That is why resolution is a single DAL call rather than a
   * service-orchestrated sequence.
   */
  resolveArena(
    arenaId: string,
    rows: ArenaResolutionRow[],
    client?: PoolClient,
  ): Promise<void>;

  // ── Arena-owned columns on `user_languages` ────────────────────────────────
  //
  // ⚠️ LAYERING NOTE. `user_languages` belongs to UserLanguagesDAL, but
  // `division` and `arenaOptInWeek` (migration 146) are Arena's columns living
  // on someone else's table. They are read and written here rather than there
  // because every rule governing them — the ladder, the self-expiring opt-in —
  // is Arena's, and splitting the writes across two DALs would mean resolution
  // touches two objects to do one thing.
  //
  // The cost is that two DALs now write to one table. That is acceptable while
  // the column sets are disjoint, which they are. If a third feature ever adds
  // columns here the right move is to reconsider, not to keep accreting.

  /** The ladder rung for a (user, language). */
  getDivision(userId: string, language: string, client?: PoolClient): Promise<number>;

  /** Move a (user, language) up or down the ladder, clamped to 1..12. */
  setDivision(
    userId: string,
    language: string,
    division: number,
    client?: PoolClient,
  ): Promise<void>;

  /** Record an opt-in for `weekKey`; self-expiring, so no cleanup job exists. */
  setOptInWeek(
    userId: string,
    language: string,
    weekKey: string | null,
    client?: PoolClient,
  ): Promise<void>;

  /**
   * Store (or clear) a user's coarse location cell.
   *
   * On `users` rather than `user_languages`: a person has one location
   * regardless of what they study. Clearing it is a first-class operation —
   * a permission the app remembers must be revocable inside the app, not only
   * in OS settings.
   */
  setGeoCell(userId: string, geoCell: string | null, client?: PoolClient): Promise<void>;

  /** The week a (user, language) has opted into, or null. */
  getOptInWeek(
    userId: string,
    language: string,
    client?: PoolClient,
  ): Promise<string | null>;
}
