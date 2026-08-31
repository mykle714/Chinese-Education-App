import { describe, it, expect } from "vitest";
import type { VocabEntry } from "../types";
import type { MarkType } from "../features/flashcards/types";
import {
  FACE_BIAS_MAX,
  FACE_BIAS_PER_MARK,
  englishFirstProbability,
  markTypeForSideOne,
  sideOneForCard,
} from "../utils/flpFaceSteering";

/**
 * Tests for flp face steering (src/utils/flpFaceSteering.ts,
 * docs/MASTERY_REWORK.md § Per-type cooldown).
 *
 * What is pinned here is the PRECEDENCE — cooldown is a hard gate and the
 * weaker-track bias may only break a genuine tie, because dealing a cooling face
 * produces a mark the server silently drops — plus the direction of the bias (toward
 * the track with LESS progress, which is the only one that can still move a capped
 * core bar) and the fact that it stays a bias rather than becoming deterministic.
 */

const mark = (isCorrect: boolean) => ({ timestamp: "2026-08-01T00:00:00.000Z", isCorrect });

/** A card with the given per-track (positives, attempts) and ready set. */
const card = (
  tracks: Partial<Record<MarkType, { pos: number; wrong?: number }>>,
  readyMarkTypes?: MarkType[]
): VocabEntry => {
  const history: Record<string, ReturnType<typeof mark>[]> = {};
  for (const [type, t] of Object.entries(tracks)) {
    history[type] = [
      ...Array.from({ length: t!.pos }, () => mark(true)),
      ...Array.from({ length: t!.wrong ?? 0 }, () => mark(false)),
    ];
  }
  return { id: 1, entryKey: "k1", typedMarkHistory: history, readyMarkTypes } as unknown as VocabEntry;
};

describe("markTypeForSideOne — the face ↔ track mapping", () => {
  it("maps English-first to production and foreign-first to the session track", () => {
    expect(markTypeForSideOne("en", "recognition")).toBe("production");
    expect(markTypeForSideOne("zh", "recognition")).toBe("recognition");
    expect(markTypeForSideOne("zh", "reading")).toBe("reading");
    // English-first never depends on the session's foreign track.
    expect(markTypeForSideOne("en", "reading")).toBe("production");
  });
});

describe("sideOneForCard — cooldown is a hard gate", () => {
  it("deals the only ready face even when it is the STRONGER track", () => {
    // production 8/8 vs recognition 0 — the bias wants foreign-first, but recognition
    // is cooling, so a foreign face here would be a mark the server drops.
    const c = card({ production: { pos: 8 }, recognition: { pos: 0 } }, ["production"]);
    expect(sideOneForCard(c, "recognition", false, () => 0.99)).toBe("en");

    const d = card({ production: { pos: 8 }, recognition: { pos: 0 } }, ["recognition"]);
    expect(sideOneForCard(d, "recognition", false, () => 0.0)).toBe("zh");
  });

  it("falls back to the weighted flip when readyMarkTypes is absent (older payload)", () => {
    const c = card({ production: { pos: 0 }, recognition: { pos: 4 } });
    expect(sideOneForCard(c, "recognition", false, () => 0.0)).toBe("en");
  });

  it("preferEnglishFirst (session opener) outranks the bias but not the cooldown", () => {
    const strongProduction = card({ production: { pos: 8 } }, ["production", "recognition"]);
    expect(sideOneForCard(strongProduction, "recognition", true, () => 0.99)).toBe("en");
    // …but a cooling production track still forces the foreign face.
    const cooling = card({ production: { pos: 8 } }, ["recognition"]);
    expect(sideOneForCard(cooling, "recognition", true, () => 0.0)).toBe("zh");
  });
});

describe("englishFirstProbability — the weaker-track bias", () => {
  const bothReady = (pro: number, rec: number, proWrong = 0, recWrong = 0) =>
    card(
      { production: { pos: pro, wrong: proWrong }, recognition: { pos: rec, wrong: recWrong } },
      ["production", "recognition"]
    );

  it("is an even flip for a never-marked card and for equal tracks", () => {
    expect(englishFirstProbability(card({}), "recognition")).toBe(0.5);
    expect(englishFirstProbability(bothReady(4, 4), "recognition")).toBe(0.5);
    // A missing card (loop tail shorter than 2) must not throw.
    expect(englishFirstProbability(undefined, "recognition")).toBe(0.5);
  });

  it("leans toward the track with fewer positives, by FACE_BIAS_PER_MARK a point", () => {
    expect(englishFirstProbability(bothReady(3, 4), "recognition")).toBeCloseTo(0.5 + FACE_BIAS_PER_MARK);
    expect(englishFirstProbability(bothReady(4, 3), "recognition")).toBeCloseTo(0.5 - FACE_BIAS_PER_MARK);
    // The widest real gap (8 vs 0) lands exactly on the cap.
    expect(englishFirstProbability(bothReady(0, 8), "recognition")).toBeCloseTo(FACE_BIAS_MAX);
    expect(englishFirstProbability(bothReady(8, 0), "recognition")).toBeCloseTo(1 - FACE_BIAS_MAX);
  });

  it("breaks a positives tie on attempts — equal progress, less practice wins", () => {
    // production 3/3, recognition 3/8: same progress, but production is the track the
    // learner has worked less, so it should be favored.
    expect(englishFirstProbability(bothReady(3, 3, 0, 5), "recognition"))
      .toBeCloseTo(0.5 + FACE_BIAS_PER_MARK * 5);
  });

  it("compares against the session's foreign track, not always recognition", () => {
    const c = card(
      { production: { pos: 6 }, recognition: { pos: 0 }, reading: { pos: 6 } },
      ["production", "reading"]
    );
    // A reading session must ignore the empty recognition track.
    expect(englishFirstProbability(c, "reading")).toBe(0.5);
  });

  it("stays a bias — the disfavored face is still reachable", () => {
    const c = card({ production: { pos: 8 }, recognition: { pos: 0 } }, ["production", "recognition"]);
    // p(en) = 0.1, so a draw below it still deals English-first.
    expect(sideOneForCard(c, "recognition", false, () => 0.05)).toBe("en");
    expect(sideOneForCard(c, "recognition", false, () => 0.5)).toBe("zh");
  });
});
