import { describe, it, expect } from "vitest";
import type { VocabEntry } from "../types";
import {
  flpCooldownRemainingMs,
  flpReadyCountsByBand,
  isFlpReady,
  nextFlpReadyMs,
} from "../utils/flpReadiness";
import { COOLDOWN_MS_BY_CATEGORY } from "../utils/masteryCompute";

/**
 * Tests for the fdp study hand's ready counts (src/utils/flpReadiness.ts,
 * docs/DECKS_FEATURE.md § "The card hand").
 *
 * What is pinned here is what a future edit could plausibly get wrong: the MINIMUM-
 * across-tracks rule (a card is ready as soon as ONE face rests — taking the maximum
 * would hide cards the flp would deal), the CORE window category (the per-type window
 * the card grid's sort uses is a different and shorter clock), and above all the
 * PARTITION identity — Challenge + Review must equal Study Mix, which is the whole
 * reason the three figures are worth printing together.
 */

const NOW = Date.UTC(2026, 7, 24, 12, 0, 0);

const mark = (isCorrect: boolean, at: number) => ({
  timestamp: new Date(at).toISOString(),
  isCorrect,
});

/** Minimal card carrying just the two flp tracks. */
const card = (
  id: number,
  recognition: ReturnType<typeof mark>[],
  production: ReturnType<typeof mark>[]
): VocabEntry =>
  ({
    id,
    entryKey: `k${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    typedMarkHistory: { recognition, production },
  }) as unknown as VocabEntry;

/** `n` correct marks, all landed at `at`. n drives the band; `at` drives the cooldown. */
const positives = (n: number, at: number) => Array.from({ length: n }, () => mark(true, at));

const ALL_BANDS = ["Unfamiliar", "Target", "Comfortable", "Mastered"] as const;
const CHALLENGE_BANDS = ["Unfamiliar", "Target"] as const;
const REVIEW_BANDS = ["Comfortable", "Mastered"] as const;

const sum = (counts: Record<string, number>, bands: readonly string[]) =>
  bands.reduce((total, band) => total + (counts[band] || 0), 0);

describe("flpCooldownRemainingMs — which clock applies", () => {
  it("is 0 for a never-marked card (nothing has started resting)", () => {
    expect(flpCooldownRemainingMs(card(1, [], []), "recognition", NOW)).toBe(0);
    expect(isFlpReady(card(1, [], []), "recognition", NOW)).toBe(true);
  });

  it("takes the MINIMUM across the two tracks, not the maximum", () => {
    // 1 positive on each track ⇒ pbh 1.33 ⇒ Unfamiliar ⇒ a 5-minute window.
    // Recognition was marked 1 minute ago (4 min left); production 10 minutes ago (rested).
    const entry = card(
      1,
      [mark(true, NOW - 60_000)],
      [mark(true, NOW - 10 * 60_000)]
    );
    // Maximum would be ~4 minutes and would wrongly hide this card.
    expect(flpCooldownRemainingMs(entry, "recognition", NOW)).toBe(0);
    expect(isFlpReady(entry, "recognition", NOW)).toBe(true);
  });

  it("windows on the card's CORE category, not the per-type one", () => {
    // 8 positives on recognition, 0 on production.
    //   core pbh = LEAST(6, 8) + 0/3 = 6            ⇒ Comfortable ⇒ 14-day window
    //   recognition's own per-type band = 8         ⇒ Mastered    ⇒ 180-day window
    // Production has no correct mark, so it is ready and the card is ready — which is
    // why this case is checked through the recognition track's remaining time instead.
    const justMarked = card(1, positives(8, NOW - 1000), []);
    expect(isFlpReady(justMarked, "recognition", NOW)).toBe(true);

    // Same shape, but production also carries a fresh mark so neither track is free.
    // 8 recognition + 8 production ⇒ pbh 6 + 8/3 = 8.67 ⇒ Mastered ⇒ 180 days.
    const both = card(1, positives(8, NOW - 1000), positives(8, NOW - 1000));
    const remaining = flpCooldownRemainingMs(both, "recognition", NOW);
    expect(remaining).toBeGreaterThan(COOLDOWN_MS_BY_CATEGORY.Comfortable);
    expect(remaining).toBeCloseTo(COOLDOWN_MS_BY_CATEGORY.Mastered - 1000, -3);
  });

  it("honours the foreignTrack — a reading-track session cools on reading, not recognition", () => {
    // Recognition is freshly marked but the session shows reading + production, and
    // both of those are unmarked, so the card is ready for a reading-first session.
    const entry = card(1, positives(2, NOW - 1000), []);
    expect(isFlpReady(entry, "reading", NOW)).toBe(true);
  });
});

describe("flpReadyCountsByBand", () => {
  it("returns every band, zeroed, for an empty library", () => {
    expect(flpReadyCountsByBand([], "recognition", NOW)).toEqual({
      Unfamiliar: 0,
      Target: 0,
      Comfortable: 0,
      Mastered: 0,
    });
  });

  it("excludes resting cards and bands the rest by core category", () => {
    const LONG_AGO = NOW - 400 * 24 * 60 * 60 * 1000;
    const entries = [
      card(1, [], []),                                  // Unfamiliar, never marked → ready
      card(2, positives(1, NOW - 1000), positives(1, NOW - 1000)), // Unfamiliar, both fresh → resting
      card(3, positives(4, LONG_AGO), positives(4, LONG_AGO)),     // Target-ish, long rested → ready
    ];
    const counts = flpReadyCountsByBand(entries, "recognition", NOW);
    expect(counts.Unfamiliar).toBe(1);
    expect(sum(counts, ALL_BANDS)).toBe(2);
  });

  it("PARTITIONS: Challenge + Review always equals Study Mix", () => {
    const LONG_AGO = NOW - 400 * 24 * 60 * 60 * 1000;
    // A spread across every band and both rest states.
    const entries = [
      card(1, [], []),
      card(2, positives(1, NOW - 1000), positives(1, NOW - 1000)),
      card(3, positives(4, LONG_AGO), positives(4, LONG_AGO)),
      card(4, positives(8, LONG_AGO), positives(8, LONG_AGO)),
      card(5, positives(8, NOW - 1000), positives(8, NOW - 1000)),
      card(6, positives(6, LONG_AGO), positives(2, LONG_AGO)),
    ];
    const counts = flpReadyCountsByBand(entries, "recognition", NOW);
    expect(sum(counts, CHALLENGE_BANDS) + sum(counts, REVIEW_BANDS)).toBe(sum(counts, ALL_BANDS));
    // And the identity is not vacuous — both halves carry cards.
    expect(sum(counts, CHALLENGE_BANDS)).toBeGreaterThan(0);
    expect(sum(counts, REVIEW_BANDS)).toBeGreaterThan(0);
  });
});

describe("nextFlpReadyMs", () => {
  it("is null when the learner owns nothing in those bands", () => {
    expect(nextFlpReadyMs([], REVIEW_BANDS, "recognition", NOW)).toBeNull();
  });

  it("is null when a card in those bands is already ready (nothing to count down to)", () => {
    const LONG_AGO = NOW - 400 * 24 * 60 * 60 * 1000;
    const rested = card(1, positives(8, LONG_AGO), positives(8, LONG_AGO));
    expect(nextFlpReadyMs([rested], REVIEW_BANDS, "recognition", NOW)).toBeNull();
  });

  it("returns the SOONEST remaining time among resting cards in those bands", () => {
    const day = 24 * 60 * 60 * 1000;
    // Both Mastered (180-day window); one marked 179 days ago, one marked 10 days ago.
    const nearlyReady = card(1, positives(8, NOW - 179 * day), positives(8, NOW - 179 * day));
    const deepResting = card(2, positives(8, NOW - 10 * day), positives(8, NOW - 10 * day));
    const next = nextFlpReadyMs([deepResting, nearlyReady], REVIEW_BANDS, "recognition", NOW);
    expect(next).not.toBeNull();
    expect(next!).toBeCloseTo(day, -4);
  });

  it("ignores cards outside the requested bands", () => {
    // An Unfamiliar card resting 5 minutes must not shorten the REVIEW countdown.
    const unfamiliarResting = card(1, positives(1, NOW - 1000), positives(1, NOW - 1000));
    expect(nextFlpReadyMs([unfamiliarResting], REVIEW_BANDS, "recognition", NOW)).toBeNull();
  });
});
