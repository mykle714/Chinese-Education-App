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
  arenaFormationAt,
  isBreakPeriod,
  arenaWeekKey,
  nextArenaWeekKey,
  resolveTimezone,
} from '../shared/arenaWeek.js';
import { bucketCandidates, clusterBucket, commonGeoPrefix } from './arenaClustering.js';
import {
  pickSyntheticTarget,
  pickSyntheticName,
  pickSyntheticMessage,
  syntheticScoreAt,
  elapsedFraction,
} from './arenaSynthetic.js';

/** Minimal user lookup this service needs; satisfied by UserDAL. */
export interface ArenaUserLookup {
  findById(id: string): Promise<{
    id: string;
    name?: string;
    timezone?: string;
    avatarIconId?: string | null;
    arenaMessage?: string | null;
  } | null>;
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
 *  formArenas()   gated to 03:00 local (weekStart - the formation lead), one
 *                 timezone bucket at a time. Freezes the candidate set, clusters
 *                 it, writes arenas — and on later ticks seats stragglers into
 *                 the synthetic seats of a bucket it already formed. MUST
 *                 complete before 04:00, because 04:00 is when credited minutes
 *                 start looking for a membership to land on. It must equally NOT
 *                 run long before 03:00: forming a bucket closes it to every
 *                 later opt-in of that break.
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
    // Read here rather than off the viewer's board row: the editor is reachable in
    // every state, and in `opt-in`/`closed` there is no row to read it off.
    const viewerMessage = (await this.userLookup.findById(userId).catch(() => null))?.arenaMessage ?? null;
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
        viewerMessage,
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
        viewerMessage,
      };
    }

    // 3. Not racing. Both states offer the same Join button since § 8 — they
    // differ only in whether last week's break is still open.
    return {
      state: isBreakPeriod(now, tz) ? 'opt-in' : 'closed',
      division,
      arenaId: null,
      entries: [],
      boundaries: null,
      divisionChange: null,
      optedInNextWeek,
      viewerMessage,
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
            // Pure function of the stored seed, like the score — never persisted.
            message: pickSyntheticMessage(m.syntheticSeed ?? 0),
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
          message: user?.arenaMessage ?? null,
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
        message: row.message,
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
   * THE GATE IS A SEAT, NOT THE CLOCK (§ 8). Someone who is not in this week's
   * arena may enrol in next week's at any time, including while the current
   * arena is running — being told "come back on Sunday" is the worst possible
   * answer to a learner who has just decided they want to compete.
   *
   * Someone already racing is still refused, and loudly rather than silently:
   * they hold a seat this week, a second one cannot exist
   * (uq_arena_member_live), and they can enrol again the moment it closes.
   */
  async optIn(userId: string, language: string, tz: string, now = new Date()): Promise<string> {
    const zone = resolveTimezone(tz);
    const live = await this.arenaDAL.findLiveArenaForUser(userId, language);
    if (live) {
      throw new ValidationError(
        "You're already in this week's arena; you can join the next one once it closes.",
      );
    }
    const weekKey = nextArenaWeekKey(now, zone);
    await this.arenaDAL.setOptInWeek(userId, language, weekKey);
    return weekKey;
  }

  /**
   * Withdraw a pending enrolment.
   *
   * Legal exactly as long as opting in is, and gated on the same thing: once
   * formation has seated you, the live seat is the refusal — membership is
   * frozen for the week (§ 3) and there is nothing left to withdraw from.
   */
  async withdraw(userId: string, language: string): Promise<void> {
    const live = await this.arenaDAL.findLiveArenaForUser(userId, language);
    if (live) {
      throw new ValidationError('Your arena has already formed; you are in it for the week.');
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

  /**
   * The longest an arena message may be. Sized to ONE LINE in the board row's
   * sub-slot at 9.5px — past this the text either wraps (breaking the 40px row
   * rhythm the whole board is built on) or ellipsises, and a message the reader
   * only sees half of is worse than none. The column caps at the same 80.
   */
  private static readonly MESSAGE_MAX = 80;

  /**
   * Set (or clear) the caller's arena message.
   *
   * ⚠️ THIS IS THE ONLY WRITE PATH FOR `users."arenaMessage"`, and everything it
   * does is a MINIMUM, not moderation:
   *   • control characters and newlines are stripped — a board row is one line, and
   *     a newline smuggled through would let one member push every row below them
   *     down the board;
   *   • runs of whitespace collapse, so a message cannot pad itself wider than its
   *     neighbours;
   *   • the result is trimmed and length-capped;
   *   • an empty result CLEARS the message rather than storing '' (the column's
   *     CHECK refuses '' anyway, and a blank sub-line reads as a rendering bug).
   *
   * None of that says anything about what the text MEANS. This is user-authored
   * content shown to 24 strangers the author did not choose, with no report button,
   * no review queue and no block list. The moderation system that has to exist
   * before this is safe at scale is tracked in docs/DEFERRED_WORK.md.
   */
  async setMessage(userId: string, message: unknown): Promise<string | null> {
    if (!userId) throw new ValidationError('userId is required');
    if (message === null || message === undefined) {
      await this.arenaDAL.setArenaMessage(userId, null);
      return null;
    }
    if (typeof message !== 'string') {
      throw new ValidationError('message must be a string');
    }
    // eslint-disable-next-line no-control-regex
    const cleaned = message.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length > ArenaService.MESSAGE_MAX) {
      throw new ValidationError(`message must be ${ArenaService.MESSAGE_MAX} characters or fewer`);
    }
    const stored = cleaned.length > 0 ? cleaned : null;
    await this.arenaDAL.setArenaMessage(userId, stored);
    return stored;
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
   * Form and fill every arena whose formation window has arrived.
   *
   * ── The window is the whole point (§ 5.3) ────────────────────────────────────
   * A bucket is formed at `weekStart - ARENA_FORMATION_LEAD_MINUTES` (Tuesday
   * 03:00 local), NOT at the first hourly tick that happens to see a candidate.
   * Before that gate existed, the first opt-in of the break froze its whole
   * (timezone, division) bucket up to 36 hours early: everyone who joined
   * afterwards hit `arenaExistsForBucket` and was skipped, silently, for the rest
   * of the break. That is a lockout with no error line anywhere — the run just
   * reports "formed 0" — so the gate is load-bearing, not a tidiness.
   *
   * ── One pass, two behaviours per bucket ─────────────────────────────────────
   * Whether a bucket is a BATCH or a STRAGGLER pass is decided per bucket, from
   * whether its arenas already exist, rather than by the caller. There is no
   * caller that could know: a single tick can be the batch run for Los Angeles
   * and the straggler run for New York in the same second.
   *
   * Idempotent in both modes — a batch bucket is guarded by arenaExistsForBucket,
   * and a straggler bucket only ever sees candidates who hold no live seat — so
   * an hourly cron, a retry, or a systemd catch-up run is free.
   */
  async formArenas(now = new Date()): Promise<Arena[]> {
    const created: Arena[] = [];

    const candidates = await this.arenaDAL.listUnseatedCandidates();
    if (candidates.length === 0) return created;

    for (const bucket of bucketCandidates(candidates)) {
      // Each bucket's boundaries are computed in ITS OWN timezone. This is why
      // timezone is a hard partition: one arena, one unambiguous close instant.
      const weekStart = this.nextWeekStartFor(now, bucket.timezone);

      const closesAt = arenaCloseFor(weekStart, bucket.timezone);

      // THE GATE. Too early is not "harmless, it will be re-run" — forming a
      // bucket closes it to every later opt-in.
      if (now.getTime() < arenaFormationAt(weekStart).getTime()) continue;

      // Only seat candidates who opted into the week this bucket is forming.
      //
      // An opt-in names a week in the OPTER'S zone, so it can only be compared
      // against a week start computed in that same zone — which is exactly what
      // a bucket is. Two things fall out of this one filter:
      //   * a stale key (last week's, from the self-expiring opt-in column) does
      //     not match and is dropped;
      //   * since opt-in stopped being confined to the break (§ 8), a mid-week
      //     enrolment carries NEXT Tuesday's key while `weekStart` is the week
      //     already running (nextWeekStartFor only rolls past the close) — so it
      //     does not match either, and is not seated into a two-day-old arena
      //     alone with 24 bots.
      const weekKey = arenaWeekKey(weekStart, bucket.timezone);
      const forThisWeek = bucket.candidates.filter((c) => c.optInWeek === weekKey);
      if (forThisWeek.length === 0) continue;

      const alreadyFormed = await this.arenaDAL.arenaExistsForBucket(
        bucket.timezone, bucket.division, weekStart,
      );

      // Stragglers first: a real player always beats a synthetic one, and taking
      // a bot's seat costs nothing and keeps the arena at exactly 25 (§ 5.3).
      const unplaced = alreadyFormed
        ? await this.seatStragglers(bucket, weekStart, forThisWeek)
        : forThisWeek;
      if (unplaced.length === 0) continue;

      // Whatever is left is chunked among itself. For a fresh bucket that is the
      // batch run; for a formed one it is a straggler remainder, which is
      // geographically worse BY CONSTRUCTION — hence the distinct formationKind,
      // so no cluster-quality metric ever averages the two together.
      const kind: 'batch' | 'straggler' = alreadyFormed ? 'straggler' : 'batch';

      for (const chunkMembers of clusterBucket({ ...bucket, candidates: unplaced })) {
        // One arena's failure must not abort the whole formation run.
        //
        // The realistic cause is uq_arena_member_live: a candidate still holds a
        // live membership in an arena that was never resolved (a cron outage).
        // listUnseatedCandidates filters those out, so this is now a genuine
        // last resort rather than the expected path — but the guard stays,
        // because without it one bad row denies the whole population its week.
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
            kind,
            members: chunkMembers.length,
            error: (err as Error).message,
          });
        }
      }
    }

    return created;
  }

  /**
   * Seat late opt-ins into the free synthetic seats of a bucket that has already
   * formed (§ 5.3 step 1). Returns the candidates that found no seat.
   *
   * Naive on purpose: re-clustering an entire bucket for one late arrival is not
   * worth it, and a straggler taking a bot's chair costs the board nothing.
   *
   * At most two seat attempts per straggler. The first uses the arena we already
   * hold; if that arena filled up underneath us, we re-ask once and stop. An
   * unbounded retry loop here would be a spin against a bucket whose last seat
   * was just taken by a concurrent pass.
   */
  private async seatStragglers(
    bucket: { timezone: string; division: number },
    weekStart: Date,
    candidates: ArenaCandidate[],
  ): Promise<ArenaCandidate[]> {
    const unplaced: ArenaCandidate[] = [];
    let target = await this.arenaDAL.findArenaWithFreeSeat(
      bucket.timezone, bucket.division, weekStart,
    );

    for (const candidate of candidates) {
      let seated = false;
      try {
        for (let attempt = 0; target && attempt < 2 && !seated; attempt++) {
          seated = await this.arenaDAL.replaceSyntheticWithHuman(
            target.id, candidate.userId, candidate.language,
          );
          if (!seated) {
            // That arena is full now; the bucket may still hold another.
            target = await this.arenaDAL.findArenaWithFreeSeat(
              bucket.timezone, bucket.division, weekStart,
            );
          }
        }
      } catch (err) {
        // One straggler's seating must not cost the others theirs. They fall
        // through to the straggler chunk, which is a worse board but still a
        // board.
        console.error('[ARENA-SERVICE] failed to seat one straggler; continuing', {
          userId: candidate.userId.substring(0, 8),
          language: candidate.language,
          error: (err as Error).message,
        });
      }
      if (!seated) unplaced.push(candidate);
    }

    return unplaced;
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
  async tick(now = new Date()): Promise<{ resolved: number; formed: number; stranded: number }> {
    const resolved = await this.resolveDue(now);
    const formed = await this.formArenas(now);
    const stranded = await this.countStranded(now);
    return { resolved, formed: formed.length, stranded };
  }

  /**
   * How many opted-in (user, language) pairs are STILL not in a live arena even
   * though their week has already opened.
   *
   * This is the alarm the feature was missing. Both bugs this check exists for —
   * a bucket frozen 36 hours early, and a straggler path that was never wired to
   * a caller — produced a completely quiet failure: `formed 0` every hour, no
   * error line, and the only visible symptom was a user asking why they were not
   * on a board. A non-zero count here after 04:00 local means someone opted in
   * and got nothing, which is never correct.
   *
   * Counted, not repaired. A repair would be a write on a path nobody is
   * watching; the point is to make the next hour's log say so out loud.
   */
  private async countStranded(now: Date): Promise<number> {
    const candidates = await this.arenaDAL.listUnseatedCandidates();
    let stranded = 0;

    for (const c of candidates) {
      const weekStart = this.nextWeekStartFor(now, c.timezone);
      // Not yet their formation window, or an expired opt-in for a past week —
      // neither is a fault.
      if (now.getTime() < weekStart.getTime()) continue;
      if (c.optInWeek !== arenaWeekKey(weekStart, c.timezone)) continue;
      stranded++;
    }

    if (stranded > 0) {
      console.error('[ARENA-SERVICE] opted-in members are not in any live arena', {
        stranded,
        hint: 'their arena week has already opened; formation or straggler seating dropped them',
      });
    }
    return stranded;
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
