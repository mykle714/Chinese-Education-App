import type { IArenaDAL, ArenaCandidate, ArenaMemberSeed } from '../dal/interfaces/IArenaDAL.js';
import type {
  Arena,
  ArenaMember,
  ArenaBoardResponse,
  ArenaEntry,
  ArenaState,
} from '../types/arena.js';
import { ValidationError } from '../types/dal.js';
import {
  ARENA_SIZE,
  ARENA_DIVISION_COUNT,
  ARENA_PROMOTE_COUNT,
  ARENA_RELEGATE_COUNT,
} from '../contracts/wire.js';
import {
  arenaWeekStart,
  arenaCloseFor,
  isBreakPeriod,
  arenaWeekKey,
  nextArenaWeekKey,
  resolveTimezone,
} from '../shared/arenaWeek.js';
import { bucketCandidates, clusterBucket, commonGeoPrefix } from './arenaClustering.js';
import {
  pickSyntheticTarget,
  pickSyntheticName,
  syntheticScoreAt,
  elapsedFraction,
} from './arenaSynthetic.js';

/** Minimal user lookup this service needs; satisfied by UserDAL. */
export interface ArenaUserLookup {
  findById(id: string): Promise<{ id: string; name?: string; timezone?: string; avatarIconId?: string | null } | null>;
}

/**
 * Exactly five geohash characters. The alphabet excludes a, i, l and o, and the
 * length is the privacy contract — see ArenaService.setLocation.
 */
const GEOCELL_PATTERN = /^[0-9bcdefghjkmnpqrstuvwxyz]{5}$/;

/**
 * Arena — the weekly global division leaderboard (docs/ARENA_FEATURE.md).
 *
 * ALL POLICY LIVES HERE: clustering orchestration, opt-in rules, promotion and
 * relegation cutoffs, synthetic scoring, and the state machine behind /arena.
 * ArenaDAL only reads and writes rows.
 *
 * ── The three moving parts ───────────────────────────────────────────────────
 *  formArenas()   runs ~03:00 local, one timezone at a time. Freezes the
 *                 candidate set, clusters it, writes arenas. MUST complete
 *                 before 04:00, because 04:00 is when credited minutes start
 *                 looking for a membership to land on.
 *  creditMinutes() called from UserMinutePointsService on every credited minute.
 *  resolveDue()   runs after Sunday 16:00 local. Ranks, promotes, relegates,
 *                 and — critically — releases every member's live seat.
 */
export class ArenaService {
  constructor(
    private readonly arenaDAL: IArenaDAL,
    private readonly userLookup: ArenaUserLookup,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────────

  /**
   * The board for one (user, language), in whichever of the four states applies
   * (§ 2.3).
   *
   * `viewerTz` is the requester's CURRENT timezone and is used only to decide
   * whether to label times with the arena's zone (§ 3). It never changes which
   * arena they are in — a member who travels mid-week keeps racing on the clock
   * they started on.
   */
  async getBoard(userId: string, language: string, viewerTz: string, now = new Date()): Promise<ArenaBoardResponse> {
    if (!userId) throw new ValidationError('userId is required');
    if (!language) throw new ValidationError('language is required');

    const tz = resolveTimezone(viewerTz);
    const division = await this.arenaDAL.getDivision(userId, language);
    const optInWeek = await this.arenaDAL.getOptInWeek(userId, language);
    const nextWeek = nextArenaWeekKey(now, tz);
    const optedInNextWeek = optInWeek === nextWeek;

    // 1. Racing right now?
    const live = await this.arenaDAL.findLiveArenaForUser(userId, language);
    if (live) {
      const members = await this.arenaDAL.listMembers(live.id);
      return {
        state: 'live',
        division: live.division,
        arenaId: live.id,
        entries: await this.renderEntries(live, members, userId, now),
        boundaries: this.boundariesOf(live, tz),
        divisionChange: null,
        optedInNextWeek,
      };
    }

    // 2. Results of the week just finished, readable through the break.
    const last = await this.arenaDAL.findLastResolvedArenaForUser(userId, language);
    if (last && isBreakPeriod(now, tz) && this.closedThisCycle(last, now, tz)) {
      const members = await this.arenaDAL.listMembers(last.id);
      const mine = members.find((m) => m.userId === userId && m.language === language);
      return {
        state: 'results',
        division,
        arenaId: last.id,
        entries: await this.renderEntries(last, members, userId, now),
        boundaries: this.boundariesOf(last, tz),
        divisionChange: mine?.divisionChange ?? null,
        optedInNextWeek,
      };
    }

    // 3. Not racing. Either the door is open or it is not.
    return {
      state: isBreakPeriod(now, tz) ? 'opt-in' : 'closed',
      division,
      arenaId: null,
      entries: [],
      boundaries: null,
      divisionChange: null,
      optedInNextWeek,
    };
  }

  /** Did `arena` close during the break we are currently inside? */
  private closedThisCycle(arena: Arena, now: Date, tz: string): boolean {
    const weekStart = arenaWeekStart(now, tz);
    const close = arenaCloseFor(weekStart, tz);
    return arena.closesAt.getTime() >= close.getTime();
  }

  private boundariesOf(arena: Arena, viewerTz: string) {
    return {
      weekStartsAt: arena.weekStartsAt.toISOString(),
      closesAt: arena.closesAt.toISOString(),
      timezone: arena.timezone,
      timezoneDiffersFromViewer: arena.timezone !== viewerTz,
    };
  }

  /**
   * Turn member rows into ranked board entries.
   *
   * Synthetic scores are computed HERE, on read, from the stored seed and target
   * (§ 6.2) — they are never persisted, so they cannot drift and need no cron.
   */
  private async renderEntries(
    arena: Arena,
    members: ArenaMember[],
    viewerId: string,
    now: Date,
  ): Promise<ArenaEntry[]> {
    const fraction = elapsedFraction(arena.weekStartsAt, arena.closesAt, now);

    // One lookup per human. Small by construction: at most 25 per board.
    const named = await Promise.all(
      members.map(async (m) => {
        if (!m.userId) {
          return {
            member: m,
            name: m.syntheticName ?? 'Player',
            avatarIconId: m.syntheticAvatarIconId ?? null,
            score: syntheticScoreAt(m.syntheticSeed ?? 0, m.syntheticTarget ?? 0, fraction),
          };
        }
        const user = await this.userLookup.findById(m.userId).catch(() => null);
        return {
          member: m,
          // A deleted account leaves the row with a null user (ON DELETE SET
          // NULL); the board keeps its shape rather than losing a rank.
          name: user?.name ?? 'Former member',
          avatarIconId: user?.avatarIconId ?? null,
          score: m.minutesEarned,
        };
      }),
    );

    // Rank: score descending, then whoever reached it FIRST (§ 4.2). The stored
    // finalRank wins once written, so a closed board never re-sorts.
    named.sort((a, b) => {
      if (a.member.finalRank != null && b.member.finalRank != null) {
        return a.member.finalRank - b.member.finalRank;
      }
      if (b.score !== a.score) return b.score - a.score;
      return a.member.updatedAt.getTime() - b.member.updatedAt.getTime();
    });

    return named.map((row, i) => {
      const rank = row.member.finalRank ?? i + 1;
      return {
        rank,
        userId: row.member.userId,
        name: row.name,
        avatarIconId: row.avatarIconId,
        language: row.member.language,
        score: row.score,
        isViewer: row.member.userId === viewerId,
        zone: this.zoneForRank(rank, arena.division),
      };
    });
  }

  /**
   * Which side of the promotion/relegation line a rank sits on.
   *
   * Computed server-side so the client never re-derives the cutoffs and drifts
   * out of agreement with what resolution actually does.
   */
  private zoneForRank(rank: number, division: number): ArenaEntry['zone'] {
    if (division < ARENA_DIVISION_COUNT && rank <= ARENA_PROMOTE_COUNT) return 'promote';
    if (division > 1 && rank > ARENA_SIZE - ARENA_RELEGATE_COUNT) return 'relegate';
    return 'hold';
  }

  // ── Opt-in ─────────────────────────────────────────────────────────────────

  /**
   * Opt a (user, language) into next week's arena.
   *
   * Only legal during the break (§ 8). Outside it the answer is a 400, not a
   * silent no-op: a user tapping "join" during a live week has misunderstood
   * something and deserves to be told.
   */
  async optIn(userId: string, language: string, tz: string, now = new Date()): Promise<string> {
    const zone = resolveTimezone(tz);
    if (!isBreakPeriod(now, zone)) {
      throw new ValidationError('The arena is currently running; you can join during the break.');
    }
    const weekKey = nextArenaWeekKey(now, zone);
    await this.arenaDAL.setOptInWeek(userId, language, weekKey);
    return weekKey;
  }

  /** Withdraw before formation. After formation the seat is already taken. */
  async withdraw(userId: string, language: string, tz: string, now = new Date()): Promise<void> {
    const zone = resolveTimezone(tz);
    if (!isBreakPeriod(now, zone)) {
      throw new ValidationError('The arena has already formed for this week.');
    }
    await this.arenaDAL.setOptInWeek(userId, language, null);
  }

  /**
   * Store the coarse location cell the client computed, or clear it.
   *
   * VALIDATED, NOT TRUSTED. The client is supposed to truncate to 5 characters
   * before sending, but "the client promised" is not a privacy guarantee — a
   * modified or buggy client could post a full-precision geohash, and the whole
   * argument for this column is that it CANNOT hold one. Anything that is not
   * exactly a 5-character geohash is rejected outright rather than truncated
   * server-side, because silently accepting a longer value would mean the server
   * had briefly held a precise location.
   */
  async setLocation(userId: string, geoCell: unknown): Promise<void> {
    if (geoCell === null || geoCell === undefined) {
      await this.arenaDAL.setGeoCell(userId, null);
      return;
    }
    if (typeof geoCell !== 'string' || !GEOCELL_PATTERN.test(geoCell)) {
      throw new ValidationError('geoCell must be a 5-character geohash cell');
    }
    await this.arenaDAL.setGeoCell(userId, geoCell);
  }

  // ── Scoring ────────────────────────────────────────────────────────────────

  /**
   * Credit minutes to whatever live arena this (user, language) is in.
   *
   * Deliberately tolerant: a user who is not in an arena is the normal case, and
   * the caller (UserMinutePointsService) must never have to know. Failures are
   * swallowed with a log rather than propagated — a broken arena must not be
   * able to stop a minute from being banked, because the ledger is the thing
   * that actually matters.
   */
  async creditMinutes(userId: string, language: string, minutes: number): Promise<void> {
    try {
      await this.arenaDAL.addMinutes(userId, language, minutes);
    } catch (err) {
      console.error('[ARENA-SERVICE] failed to credit arena minutes', {
        userId: userId.substring(0, 8),
        language,
        error: (err as Error).message,
      });
    }
  }

  // ── Formation ──────────────────────────────────────────────────────────────

  /**
   * Form every arena for the week opening at the next Tuesday 04:00, for the
   * timezones whose formation window has arrived.
   *
   * Idempotent per (timezone, division, week) via arenaExistsForBucket, so an
   * hourly cron can call it repeatedly and a retry is free.
   *
   * `formationKind` records whether an arena came from this batch run or from
   * the straggler path, because straggler arenas are geographically worse BY
   * CONSTRUCTION and averaging the two makes any cluster-quality metric a lie.
   */
  async formArenas(now = new Date(), kind: 'batch' | 'straggler' = 'batch'): Promise<Arena[]> {
    const created: Arena[] = [];

    // Candidates are keyed by the week they opted into, which is the NEXT week
    // during the break — the same key the opt-in wrote.
    const anyTz = 'UTC';
    const weekKey = nextArenaWeekKey(now, anyTz);
    const candidates = await this.arenaDAL.listCandidates(weekKey);
    if (candidates.length === 0) return created;

    for (const bucket of bucketCandidates(candidates)) {
      // Each bucket's boundaries are computed in ITS OWN timezone. This is why
      // timezone is a hard partition: one arena, one unambiguous close instant.
      const weekStart = this.nextWeekStartFor(now, bucket.timezone);
      const closesAt = arenaCloseFor(weekStart, bucket.timezone);

      if (kind === 'batch') {
        const exists = await this.arenaDAL.arenaExistsForBucket(
          bucket.timezone, bucket.division, weekStart,
        );
        if (exists) continue; // already formed this week
      }

      for (const chunkMembers of clusterBucket(bucket)) {
        // One arena's failure must not abort the whole formation run.
        //
        // The realistic cause is uq_arena_member_live: a candidate still holds a
        // live membership in an arena that was never resolved (a cron outage).
        // Without this guard the first such candidate throws and NOBODY in any
        // remaining bucket gets an arena that week — one stale row denying the
        // whole population. Losing one arena is bad; losing the week is worse.
        try {
          const arena = await this.arenaDAL.createArenaWithMembers(
            {
              division: bucket.division,
              timezone: bucket.timezone,
              geoCellPrefix: commonGeoPrefix(chunkMembers),
              formationKind: kind,
              weekStartsAt: weekStart,
              closesAt,
            },
            this.seatsFor(chunkMembers, bucket.division),
          );
          created.push(arena);
        } catch (err) {
          console.error('[ARENA-SERVICE] failed to form one arena; continuing', {
            timezone: bucket.timezone,
            division: bucket.division,
            members: chunkMembers.length,
            error: (err as Error).message,
          });
        }
      }
    }

    return created;
  }

  /**
   * The Tuesday 04:00 that the arenas being formed will open at.
   *
   * Formation runs BEFORE the boundary (§ 5.3), so "the week to form" is the one
   * about to start, not the one containing `now`.
   */
  private nextWeekStartFor(now: Date, tz: string): Date {
    const current = arenaWeekStart(now, tz);
    const close = arenaCloseFor(current, tz);
    // During the break the next week is one week on from the current start.
    if (now.getTime() >= close.getTime()) {
      const next = new Date(current.getTime() + 7 * 24 * 3600 * 1000);
      return arenaWeekStart(next, tz);
    }
    return current;
  }

  /**
   * Build the 25 seats: every human, then synthetic padding to ARENA_SIZE.
   *
   * Bots concentrate in the LAST arena of a bucket because chunking fills each
   * arena to 25 with humans before opening the next (§ 5.4) — the alternative
   * (splitting evenly) doubles the number of bot-heavy boards.
   */
  private seatsFor(humans: ArenaCandidate[], division: number): ArenaMemberSeed[] {
    const seats: ArenaMemberSeed[] = humans.map((h) => ({
      userId: h.userId,
      language: h.language,
    }));

    const takenNames = new Set<string>();
    for (let i = seats.length; i < ARENA_SIZE; i++) {
      // Seed is deterministic per (division, slot) so a re-run of formation on
      // the same inputs produces the same bots.
      const seed = division * 1_000_003 + i * 7919;
      const name = pickSyntheticName(seed, takenNames);
      takenNames.add(name);
      seats.push({
        userId: null,
        // Bots carry the language of the arena's most common human track so the
        // badges on the board look like the population it is padding.
        language: humans[0]?.language ?? 'zh',
        syntheticName: name,
        syntheticAvatarIconId: null,
        syntheticSeed: seed,
        syntheticTarget: pickSyntheticTarget(division, seed),
      });
    }
    return seats;
  }

  /**
   * Place a late opt-in without re-running the algorithm (§ 5.3).
   *
   * A straggler is legal and gets a live arena at 04:00 like everyone else; what
   * they do not get is a re-clustering of the whole bucket for one arrival.
   * Preference order: take a bot's seat in an existing arena, else fall through
   * to a straggler batch.
   */
  async placeStraggler(
    userId: string,
    language: string,
    now = new Date(),
  ): Promise<boolean> {
    const division = await this.arenaDAL.getDivision(userId, language);
    const user = await this.userLookup.findById(userId);
    const tz = resolveTimezone(user?.timezone);
    const weekStart = this.nextWeekStartFor(now, tz);

    // A real player always beats a synthetic one, and it costs nothing.
    const existing = await this.arenaDAL.arenaExistsForBucket(tz, division, weekStart);
    if (!existing) return false;

    const live = await this.arenaDAL.findLiveArenaForUser(userId, language);
    if (live) return true; // already seated

    return false; // caller falls through to a straggler formation run
  }

  // ── Resolution ─────────────────────────────────────────────────────────────

  /**
   * One full cron pass: RESOLVE FIRST, THEN FORM.
   *
   * ⚠️ THE ORDER IS LOAD-BEARING, and getting it backwards is not a subtle bug.
   * Resolution RELEASES each member's live seat (isLive -> false); formation
   * CONSUMES a seat by inserting a live membership. Forming first means any
   * arena that has closed but not yet resolved still holds its members' seats,
   * so uq_arena_member_live rejects their new membership — and before the
   * per-arena guard above, that took the entire run down with it.
   *
   * This is exactly what happens after a cron outage: last week's arenas are
   * past their close instant and unresolved, and the new week tries to form on
   * top of them. Resolving first makes that self-healing rather than escalating.
   */
  async tick(now = new Date()): Promise<{ resolved: number; formed: number }> {
    const resolved = await this.resolveDue(now);
    const formed = await this.formArenas(now);
    return { resolved, formed: formed.length };
  }

  /**
   * Close every arena past its close instant: rank, promote, relegate, and
   * release each member's live seat.
   *
   * Idempotent — resolveArena's `resolvedAt IS NULL` guard means a second run
   * does nothing. Safe for an hourly cron.
   */
  async resolveDue(now = new Date()): Promise<number> {
    const due = await this.arenaDAL.listUnresolvedArenas(now);
    let resolved = 0;

    for (const arena of due) {
      const members = await this.arenaDAL.listMembers(arena.id);
      const fraction = 1; // a closing arena is by definition at the end of its week

      // Rank exactly as the board does, so the finish a member watched is the
      // finish they get.
      const ranked = [...members]
        .map((m) => ({
          m,
          score: m.userId
            ? m.minutesEarned
            : syntheticScoreAt(m.syntheticSeed ?? 0, m.syntheticTarget ?? 0, fraction),
        }))
        .sort((a, b) =>
          b.score !== a.score
            ? b.score - a.score
            : a.m.updatedAt.getTime() - b.m.updatedAt.getTime(),
        );

      const rows = ranked.map((row, i) => ({
        memberId: row.m.id,
        finalRank: i + 1,
        divisionChange: this.divisionChangeFor(i + 1, arena.division),
      }));

      // Ladder moves first: if resolveArena succeeds and this failed, the board
      // would be closed with nobody moved and no way to tell. Doing it first
      // means a failure leaves the arena unresolved and the next tick retries
      // the whole thing — at worst a division is written twice, which is
      // idempotent because it is an absolute value, not an increment.
      for (const row of ranked) {
        if (!row.m.userId) continue; // bots never promote or demote
        const change = this.divisionChangeFor(
          rows.find((r) => r.memberId === row.m.id)!.finalRank,
          arena.division,
        );
        if (change === 0) continue;
        await this.arenaDAL.setDivision(
          row.m.userId,
          row.m.language,
          arena.division + change,
        );
      }

      await this.arenaDAL.resolveArena(arena.id, rows);
      resolved++;
    }

    return resolved;
  }

  /**
   * -1 / 0 / +1 for a final rank (§ 7).
   *
   * Synthetic members OCCUPY REAL RANKS, so a bot in the top 5 consumes a
   * promotion slot (§ 6.3, Q5). Promoting "the top 5 humans" instead was
   * rejected: it makes the displayed rank a lie, and it turns a bot-heavy board
   * into a free ride — which is exactly the board a struggling player is most
   * likely to be in.
   */
  private divisionChangeFor(rank: number, division: number): number {
    if (rank <= ARENA_PROMOTE_COUNT && division < ARENA_DIVISION_COUNT) return 1;
    if (rank > ARENA_SIZE - ARENA_RELEGATE_COUNT && division > 1) return -1;
    return 0;
  }
}
