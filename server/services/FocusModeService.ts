import type { IFocusModeDAL, FocusCardRow, FocusState } from '../dal/interfaces/IFocusModeDAL.js';
import { MASTERY_WORLDS, type MasteryWorldId } from '../contracts/wire.js';
import { barCategory } from '../contracts/mastery.js';
import { lastCorrectOnBar } from '../contracts/cooldown.js';
import { STUDY_MIX_FILL_ORDER } from '../contracts/studyMix.js';
import {
  FOCUS_DAILY_CARDS,
  FOCUS_QUOTAS,
  type FocusStatusResponse,
  type FocusWorldStatus,
} from '../contracts/focusMode.js';
import { rankCardQueue } from './cardQueueRanking.js';
import { streakDateOf, resolveTimezone } from '../shared/streakDay.js';
import { ValidationError } from '../types/dal.js';

/**
 * How focus applies to one world right now.
 *
 *   active: false — focus is off. `ended` is true when THIS call is what switched it off
 *                   (the day's snapshot found too few off-cooldown cards); the caller
 *                   signals that with FOCUS_ENDED_HEADER.
 *   active: true  — serve only `ids`: today's snapshot minus the cards already marked
 *                   correct today, in snapshot order. May be empty (the day is done).
 */
export type FocusResolution =
  | { active: false; ended: boolean }
  | { active: true; ids: number[] };

/**
 * Pick a focused world's daily set (docs/FOCUS_MODE.md § 3): the flp's Study Mix shape
 * scaled to FOCUS_DAILY_CARDS (FOCUS_QUOTAS), each band drawn from its off-cooldown cards
 * in working-loop order (`rankCardQueue`, longest-waiting first), the shortfall borrowed
 * across bands in STUDY_MIX_FILL_ORDER — the same fill the flp working loop does for 10.
 *
 * Returns the chosen ids and how many off-cooldown cards there were in all; the caller
 * switches focus off when that total is below FOCUS_DAILY_CARDS. Pure, so it is tested
 * without a database.
 */
export function selectFocusSet(
  cards: readonly FocusCardRow[],
  now: number,
  world: MasteryWorldId
): { ids: number[]; offCooldownTotal: number } {
  const ranked = rankCardQueue([...cards], now, { world }).map(({ card }) => card);

  // Ranked order is kept inside each band, so "take the first n" is "take the n most
  // overdue".
  const byBand = new Map<string, FocusCardRow[]>();
  for (const card of ranked) {
    const band = barCategory(card.typedMarkHistory, world, card.writingMastery);
    const list = byBand.get(band) ?? [];
    list.push(card);
    byBand.set(band, list);
  }

  const picked: number[] = [];
  const taken = new Set<number>();
  const take = (band: string, limit: number) => {
    for (const card of byBand.get(band) ?? []) {
      if (picked.length >= FOCUS_DAILY_CARDS || limit <= 0) return;
      if (taken.has(card.id)) continue;
      taken.add(card.id);
      picked.push(card.id);
      limit -= 1;
    }
  };

  for (const quota of FOCUS_QUOTAS) take(quota.category, quota.count);
  for (const band of STUDY_MIX_FILL_ORDER) take(band, FOCUS_DAILY_CARDS - picked.length);

  return { ids: picked, offCooldownTotal: ranked.length };
}

/**
 * Focus mode (docs/FOCUS_MODE.md). LAYER: service — owns every rule (when a snapshot is
 * taken, when focus switches itself off, which cards still count today) over
 * IFocusModeDAL's SQL.
 *
 * Callers:
 *   - FocusModeController (`/api/focus`): status, the lever's on/off, notice acks;
 *   - OnDeckVocabController + routes/flashcardRoutes.ts: `resolveWorld` before every
 *     unrestricted flp loop, flp refill, game pool and Word Search grid, and before the
 *     tower's ready counts.
 *
 * The snapshot is taken LAZILY by whichever of those asks first on a new streak day —
 * there is no cron.
 */
export class FocusModeService {
  constructor(
    private readonly focusModeDAL: IFocusModeDAL,
    /** Injectable clock for tests. */
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Resolve focus for one world, taking today's snapshot if none exists yet.
   *
   * `state` may be passed by a caller resolving several worlds, to read it once.
   */
  async resolveWorld(
    userId: string,
    language: string,
    world: MasteryWorldId,
    state?: FocusState
  ): Promise<FocusResolution> {
    const current = state ?? await this.focusModeDAL.getState(userId, language);
    if (!current.focusWorlds.includes(world)) return { active: false, ended: false };

    const now = this.now();
    const tz = resolveTimezone(current.timezone);
    const today = streakDateOf(new Date(now), tz);

    let snapshot = await this.focusModeDAL.getSnapshot(userId, language, world);
    if (!snapshot || snapshot.streakDate !== today) {
      const cards = await this.focusModeDAL.listWorldCards(userId, language, world);
      const { ids, offCooldownTotal } = selectFocusSet(cards, now, world);
      // The learner has worked their way back to a manageable pile: switch focus off and
      // queue the popup rather than serve a set smaller than the cap.
      if (offCooldownTotal < FOCUS_DAILY_CARDS) {
        await this.focusModeDAL.endWithNotice(userId, language, world);
        return { active: false, ended: true };
      }
      snapshot = await this.focusModeDAL.claimSnapshot(userId, language, world, today, ids);
    }

    // Re-read the set's rows on every call: a card's "marked correct today" state changes
    // with every mark, so it is never cached.
    const rows = await this.focusModeDAL.listCardsByIds(userId, language, snapshot.vetIds);
    const doneToday = new Set(
      rows.filter((row) => markedCorrectToday(row, world, today, tz)).map((row) => row.id)
    );
    const live = new Set(rows.map((row) => row.id));
    return {
      active: true,
      ids: snapshot.vetIds.filter((id) => live.has(id) && !doneToday.has(id)),
    };
  }

  /** `GET /api/focus`: every world's state, resolving (and snapshotting) the focused ones. */
  async getStatus(userId: string, language: string): Promise<FocusStatusResponse> {
    const state = await this.focusModeDAL.getState(userId, language);
    const worlds = {} as Record<MasteryWorldId, FocusWorldStatus>;
    const endedNotices = new Set<MasteryWorldId>(state.focusEndedNotices);
    for (const world of MASTERY_WORLDS) {
      const resolution = await this.resolveWorld(userId, language, world, state);
      if (resolution.active) {
        worlds[world] = { on: true, remaining: resolution.ids.length };
      } else {
        worlds[world] = { on: false, remaining: null };
        if ('ended' in resolution && resolution.ended) endedNotices.add(world);
      }
    }
    return { worlds, endedNotices: [...endedNotices] };
  }

  /** The lever: switch one world's focus on or off, and return the new status. */
  async setFocus(userId: string, language: string, world: MasteryWorldId, on: boolean): Promise<FocusStatusResponse> {
    if (!MASTERY_WORLDS.includes(world)) throw new ValidationError('Unknown world');
    await this.focusModeDAL.setWorldOn(userId, language, world, on);
    // A world switched back on owes no "focus ended" popup any more.
    if (on) await this.focusModeDAL.clearNotices(userId, language, [world]);
    return this.getStatus(userId, language);
  }

  /** The client showed these worlds' "focus ended" popups. */
  async acknowledgeNotices(userId: string, language: string, worlds: MasteryWorldId[]): Promise<void> {
    const valid = worlds.filter((world) => MASTERY_WORLDS.includes(world));
    await this.focusModeDAL.clearNotices(userId, language, valid);
  }
}

/**
 * Whether the card's bar in `world` took a correct mark on streak day `today`. Focus mode
 * allows one correct mark per card per day; a wrong mark leaves the card in play.
 */
function markedCorrectToday(card: FocusCardRow, world: MasteryWorldId, today: string, tz: string): boolean {
  const last = lastCorrectOnBar(card.typedMarkHistory, world);
  return last !== null && streakDateOf(new Date(last), tz) === today;
}
