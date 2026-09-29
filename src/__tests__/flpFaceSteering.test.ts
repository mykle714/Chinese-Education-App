import { describe, it, expect } from "vitest";
import type { VocabEntry } from "../types";
import type { MarkType } from "../features/flashcards/types";
import { markTypeForSideOne, sideOneForCard } from "../utils/flpFaceSteering";

/**
 * Tests for flp face steering (src/utils/flpFaceSteering.ts,
 * docs/MASTERY_REWORK.md § 6).
 *
 * Since the know merge (2026-09-25) the face is a fixed rule over the card's own
 * history: the know track with FEWER positive marks, recognition on a tie. No
 * cooldown steering (both faces share the know clock) and no randomness.
 */

const mark = (isCorrect: boolean) => ({ timestamp: "2026-08-01T00:00:00.000Z", isCorrect });

/** A card with the given per-track positives (and optional wrong marks). */
const card = (tracks: Partial<Record<MarkType, { pos: number; wrong?: number }>>): VocabEntry => {
  const history: Record<string, ReturnType<typeof mark>[]> = {};
  for (const [type, t] of Object.entries(tracks)) {
    history[type] = [
      ...Array.from({ length: t!.pos }, () => mark(true)),
      ...Array.from({ length: t!.wrong ?? 0 }, () => mark(false)),
    ];
  }
  return { id: 1, entryKey: "k1", typedMarkHistory: history } as unknown as VocabEntry;
};

describe("markTypeForSideOne — the face ↔ track mapping", () => {
  it("maps English-first to production and foreign-first to recognition", () => {
    expect(markTypeForSideOne("en")).toBe("production");
    expect(markTypeForSideOne("zh")).toBe("recognition");
  });
});

describe("sideOneForCard — the weaker know track, recognition on a tie", () => {
  it("deals the English (production) face when production has fewer positives", () => {
    expect(sideOneForCard(card({ recognition: { pos: 4 }, production: { pos: 3 } }))).toBe("en");
    expect(sideOneForCard(card({ recognition: { pos: 1 } }))).toBe("en");
  });

  it("deals the foreign (recognition) face when recognition has fewer positives", () => {
    expect(sideOneForCard(card({ recognition: { pos: 2 }, production: { pos: 5 } }))).toBe("zh");
  });

  it("defaults to recognition on a tie — including a card with no history", () => {
    expect(sideOneForCard(card({ recognition: { pos: 3 }, production: { pos: 3 } }))).toBe("zh");
    expect(sideOneForCard(card({}))).toBe("zh");
    expect(sideOneForCard(undefined)).toBe("zh");
  });

  it("counts positives only — wrong marks and attempt counts do not break a tie", () => {
    expect(
      sideOneForCard(card({ recognition: { pos: 3, wrong: 5 }, production: { pos: 3 } }))
    ).toBe("zh");
  });

  it("ignores reading and writing, which are not know tracks", () => {
    expect(sideOneForCard(card({ reading: { pos: 8 }, production: { pos: 1 }, recognition: { pos: 1 } }))).toBe("zh");
  });

  it("is deterministic — the same card always opens on the same face", () => {
    const c = card({ recognition: { pos: 5 }, production: { pos: 2 } });
    const faces = new Set(Array.from({ length: 20 }, () => sideOneForCard(c)));
    expect([...faces]).toEqual(["en"]);
  });
});
