import { describe, it, expect } from "vitest";
import type { VocabEntry } from "../types";
import {
  flpCooldownRemainingMs,
  flpReadyCountsByBand,
  isFlpReady,
} from "../utils/flpReadiness";
import { flpUpcomingReady } from "../../server/contracts/flpReadiness";
import { COOLDOWN_MS_BY_CATEGORY } from "../utils/masteryCompute";

/**
 * Tests for the flp's ready counts (src/utils/flpReadiness.ts) — the figures the Deck
 * Tower's Learning deck is built from (docs/DECK_TOWER.md).
 *
 * What is pinned here is what a future edit could plausibly get wrong: the ONE know
 * clock shared by recognition and production (docs/MASTERY_REWORK.md § 6), its CORE
 * window category, and above all the
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
const LOWER_BANDS = ["Unfamiliar", "Target"] as const;
const UPPER_BANDS = ["Comfortable", "Mastered"] as const;

const sum = (counts: Record<string, number>, bands: readonly string[]) =>
  bands.reduce((total, band) => total + (counts[band] || 0), 0);

describe("flpCooldownRemainingMs — the know clock", () => {
  it("is 0 for a never-marked card (nothing has started resting)", () => {
    expect(flpCooldownRemainingMs(card(1, [], []), NOW)).toBe(0);
    expect(isFlpReady(card(1, [], []), NOW)).toBe(true);
  });

  it("runs from the NEWER correct mark across both tracks — one clock, not two", () => {
    // 1 positive on each track ⇒ pbh 1.33 ⇒ Unfamiliar ⇒ a 5-minute window.
    // Recognition was marked 1 minute ago; production 10 minutes ago. Before the know
    // merge the rested production track made this card ready; now the recognition
    // mark holds the whole card for its remaining ~4 minutes.
    const entry = card(1, [mark(true, NOW - 60_000)], [mark(true, NOW - 10 * 60_000)]);
    expect(flpCooldownRemainingMs(entry, NOW)).toBe(COOLDOWN_MS_BY_CATEGORY.Unfamiliar - 60_000);
    expect(isFlpReady(entry, NOW)).toBe(false);
  });

  it("a mark on ONE track rests the card — an unmarked track no longer frees it", () => {
    const justMarked = card(1, positives(2, NOW - 1000), []);
    expect(isFlpReady(justMarked, NOW)).toBe(false);
  });

  it("windows on the card's CORE category, not the per-type one", () => {
    // 8 positives on recognition, 0 on production.
    //   core pbh = LEAST(6, 8) + 0/3 = 6            ⇒ Comfortable ⇒ 14-day window
    //   recognition's own per-type band = 8         ⇒ Mastered    ⇒ 180-day window
    const entry = card(1, positives(8, NOW - 1000), []);
    expect(flpCooldownRemainingMs(entry, NOW)).toBe(COOLDOWN_MS_BY_CATEGORY.Comfortable - 1000);
  });
});

describe("flpReadyCountsByBand", () => {
  it("returns every band, zeroed, for an empty library", () => {
    expect(flpReadyCountsByBand([], NOW)).toEqual({
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
    const counts = flpReadyCountsByBand(entries, NOW);
    expect(counts.Unfamiliar).toBe(1);
    expect(sum(counts, ALL_BANDS)).toBe(2);
  });

  it("PARTITIONS: the lower and upper bands always sum to every ready card", () => {
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
    const counts = flpReadyCountsByBand(entries, NOW);
    expect(sum(counts, LOWER_BANDS) + sum(counts, UPPER_BANDS)).toBe(sum(counts, ALL_BANDS));
    // And the identity is not vacuous — both halves carry cards.
    expect(sum(counts, LOWER_BANDS)).toBeGreaterThan(0);
    expect(sum(counts, UPPER_BANDS)).toBeGreaterThan(0);
  });
});

// The Deck Tower's release schedule (docs/DECK_TOWER.md § "Cooldown releases"). Pinned:
// a cooling card is listed at exactly the instant `flpCooldownRemainingMs` reaches 0, in
// the band it will be counted under, soonest first; ready, never-marked and beyond-horizon
// cards are not listed.
describe("flpUpcomingReady — the release schedule", () => {
  const MIN = 60 * 1000;
  it("lists cooling cards at the instant their cooldown ends, soonest first, in their band", () => {
    const later = card(1, [mark(true, NOW - 1 * MIN)], []);
    const sooner = card(2, [mark(true, NOW - 3 * MIN)], []);
    const upcoming = flpUpcomingReady([later, sooner], NOW);
    expect(upcoming.map((u) => u.readyAt)).toEqual([
      NOW + flpCooldownRemainingMs(sooner, NOW),
      NOW + flpCooldownRemainingMs(later, NOW),
    ]);
    expect(upcoming[0].readyAt).toBeLessThan(upcoming[1].readyAt);
    const counted = flpReadyCountsByBand([sooner], upcoming[0].readyAt);
    expect(counted[upcoming[0].band]).toBe(1);
  });

  it("leaves out ready, never-marked and beyond-horizon cards", () => {
    const ready = card(1, [mark(true, NOW - 10 * MIN)], []);
    const fresh = card(2, [], []);
    const cooling = card(3, [mark(true, NOW - 1 * MIN)], []);
    expect(flpUpcomingReady([ready, fresh], NOW)).toEqual([]);
    expect(flpUpcomingReady([cooling], NOW, "core", 1 * MIN)).toEqual([]);
    expect(flpUpcomingReady([cooling], NOW, "core", 10 * MIN)).toHaveLength(1);
  });
});
