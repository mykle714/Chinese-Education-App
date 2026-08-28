import { describe, expect, it } from "vitest";
import { pickDrillRung } from "../utils/segmentDrill";
import type { SegmentDrillRung } from "../types";

/**
 * pickDrillRung — the tap-to-drill pick rule (docs/SEGMENT_DRILL_DOWN.md).
 *
 * Shared by the example-sentence / long-definition popups and the Word Search
 * found-word review, so these assertions describe BOTH surfaces' feel: longest
 * wins, ties break leftmost, the rung must cover the tapped character, and the
 * chain always terminates.
 */

/** 中华人民共和国's rungs as the server emits them: longest-first, offset-ascending. */
const rungs: SegmentDrillRung[] = [
  { text: "共和国", offset: 4, definition: "republic" },
  { text: "中华", offset: 0, definition: "China" },
  { text: "人民", offset: 2, definition: "the people" },
  { text: "共和", offset: 4, definition: "republican" },
  { text: "中", offset: 0, definition: "middle" },
  { text: "华", offset: 1, definition: "splendid" },
  { text: "人", offset: 2, definition: "person" },
  { text: "民", offset: 3, definition: "the people" },
  { text: "国", offset: 6, definition: "country" },
];

/** The whole 7-character segment, starting at index 0 of its host. */
const whole = { start: 0, end: 6 };

describe("pickDrillRung", () => {
  it("picks the longest headword covering the tapped character", () => {
    // Tapping 民 (index 3) inside the whole compound → 人民, not the bare 民.
    expect(pickDrillRung(rungs, 0, whole, 3)).toMatchObject({ text: "人民", start: 2, end: 3 });
  });

  it("narrows again from the rung it just produced", () => {
    expect(pickDrillRung(rungs, 0, { start: 2, end: 3 }, 3)).toMatchObject({ text: "民", start: 3, end: 3 });
  });

  it("cancels once the selection is a single character", () => {
    expect(pickDrillRung(rungs, 0, { start: 3, end: 3 }, 3)).toBeNull();
  });

  it("never leaves the current selection", () => {
    // From a 人民共和 selection, tapping 共 (index 4): 共和国 is the longest rung covering
    // it, but it runs past the selection's end — so the pick falls back to 共和.
    expect(pickDrillRung(rungs, 0, { start: 2, end: 5 }, 4)).toMatchObject({ text: "共和", start: 4, end: 5 });
  });

  it("ignores rungs that do not cover the tapped character", () => {
    // Tapping 中 (index 0): 人民 is longer than 中华 but is nowhere near the finger.
    expect(pickDrillRung(rungs, 0, whole, 0)).toMatchObject({ text: "中华" });
  });

  it("offsets every rung by the parent segment's absolute start", () => {
    // The same segment sitting 10 characters into a sentence.
    expect(pickDrillRung(rungs, 10, { start: 10, end: 16 }, 13)).toMatchObject({ start: 12, end: 13 });
  });

  it("breaks a length tie on the leftmost rung, deterministically", () => {
    // 人人 with both halves available: tapping the shared span must not wobble.
    const repeated: SegmentDrillRung[] = [
      { text: "人", offset: 0, definition: "person" },
      { text: "人", offset: 1, definition: "person" },
    ];
    expect(pickDrillRung(repeated, 0, { start: 0, end: 1 }, 0)).toMatchObject({ start: 0 });
    expect(pickDrillRung(repeated, 0, { start: 0, end: 1 }, 1)).toMatchObject({ start: 1 });
  });

  it("cancels when the segment has no rungs at all", () => {
    expect(pickDrillRung(undefined, 0, whole, 3)).toBeNull();
    expect(pickDrillRung([], 0, whole, 3)).toBeNull();
  });

  it("cancels when the tap lands outside the current selection", () => {
    expect(pickDrillRung(rungs, 0, { start: 2, end: 3 }, 6)).toBeNull();
  });

  it("terminates: repeated drilling always reaches null", () => {
    let current: { start: number; end: number } | null = whole;
    const tapped = 3;
    let steps = 0;
    while (current) {
      const next = pickDrillRung(rungs, 0, current, tapped);
      if (!next) break;
      // Each rung must be strictly narrower than the one it replaced.
      expect(next.end - next.start).toBeLessThan(current.end - current.start);
      current = { start: next.start, end: next.end };
      expect(++steps).toBeLessThan(10);
    }
    expect(steps).toBe(2); // 中华人民共和国 → 人民 → 民 → cancel
  });
});
