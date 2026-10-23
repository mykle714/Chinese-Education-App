/**
 * focusMode.ts — focus mode's numbers and wire shapes, shared by server and client.
 *
 * Focus mode (docs/FOCUS_MODE.md) caps one world at a pinned daily set of up to
 * FOCUS_DAILY_CARDS cards, and drops a card from that set for the rest of the streak day
 * once it is marked correct. It is offered by a lever on the world's Deck Tower platform
 * once the world holds FOCUS_LEVER_THRESHOLD off-cooldown cards.
 *
 * Contract rules (same as wire.ts): no enums, no Node or DOM globals, and only sibling
 * contract modules as relative VALUE imports.
 *
 * Readers: server/services/FocusModeService.ts, server/controllers/FocusModeController.ts,
 * server/controllers/OnDeckVocabController.ts; src/api/focusMode.ts,
 * src/features/focusMode/*, src/features/deckTower/DeckTowerPage.tsx.
 */
import type { FlashcardCategory, MasteryWorldId, CardBaselineSurface } from './wire.js';
import { CARD_BASELINES } from './wire.js';
import { STUDY_MIX_QUOTAS, STUDY_MIX_FILL_ORDER, type BandQuota } from './studyMix.js';

/** The most cards a focused world serves in one streak day. */
export const FOCUS_DAILY_CARDS = 25;

/**
 * Off-cooldown cards (all four utcm bands) a world must hold before its lever appears.
 * Counted over ALL four bands because that is what the learner sees as "assigned to
 * them" — the figure the feature exists to keep from feeling overwhelming.
 */
export const FOCUS_LEVER_THRESHOLD = 100;

/**
 * The daily set's band quotas: Study Mix's 1-2-2-5 (per 10) scaled to the 25, i.e.
 * 2 Mastered / 5 Comfortable / 5 Unfamiliar / 13 Target. 25 is not a multiple of 10, so
 * each band's scaled share is floored and the slots that leaves over go one each to the
 * bands in STUDY_MIX_FILL_ORDER (Target first) — the same order a short band's shortfall
 * is borrowed in. Derived, never restated, so the snapshot keeps the flp's proportions if
 * the Mix shape or the cap ever changes; the quotas always sum to FOCUS_DAILY_CARDS.
 */
export const FOCUS_QUOTAS: readonly BandQuota[] = (() => {
  const mixSize = STUDY_MIX_QUOTAS.reduce((sum, quota) => sum + quota.count, 0);
  const quotas = STUDY_MIX_QUOTAS.map((quota) => ({
    category: quota.category as FlashcardCategory,
    count: Math.floor((quota.count * FOCUS_DAILY_CARDS) / mixSize),
  }));
  let leftover = FOCUS_DAILY_CARDS - quotas.reduce((sum, quota) => sum + quota.count, 0);
  for (let i = 0; leftover > 0; i = (i + 1) % STUDY_MIX_FILL_ORDER.length, leftover -= 1) {
    const quota = quotas.find((q) => q.category === STUDY_MIX_FILL_ORDER[i]);
    if (quota) quota.count += 1;
  }
  return quotas;
})();

/**
 * Response header the server sets on any request during which it turned a world's focus
 * mode OFF by itself (the day's snapshot found fewer than FOCUS_DAILY_CARDS off-cooldown
 * cards). Value: the comma-joined world ids. It is only a SIGNAL — the client reacts by
 * reading `GET /api/focus`, whose `endedNotices` is the durable source (a background
 * request may have missed the header entirely).
 */
export const FOCUS_ENDED_HEADER = 'X-Focus-Ended';

/** One world's focus state, as `GET /api/focus` reports it. */
export interface FocusWorldStatus {
  /** Focus mode is on in this world. */
  on: boolean;
  /**
   * Cards still playable today: the snapshot minus those already marked correct today.
   * null when `on` is false.
   */
  remaining: number | null;
}

/** `GET /api/focus` → the learner's focus state in their selected language. */
export interface FocusStatusResponse {
  worlds: Record<MasteryWorldId, FocusWorldStatus>;
  /** Worlds whose focus mode ended by itself and whose popup is still owed. */
  endedNotices: MasteryWorldId[];
}

/**
 * The fewest focus cards a game needs to be offered in a focused world. A game with a
 * card baseline needs its baseline; one without (Hydra Bubbles, Memory Map, Writing Grid)
 * needs a single card. Below this, the games menu refuses the game with a popup and an flp
 * break skips it (docs/FOCUS_MODE.md § 5).
 */
export function focusGameMinimum(surface: string | null | undefined): number {
  return surface && surface in CARD_BASELINES ? CARD_BASELINES[surface as CardBaselineSurface] : 1;
}
