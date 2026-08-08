import { describe, expect, it } from "vitest";
import { resolveCommonality, resolveDisplayDefinition, sortedSenseClusters } from "../utils/definitionUtils";
import type { DefinitionCluster, VocabEntry } from "../types";

/**
 * Guards the Commonality chip's sense-awareness (eip InfoCardTabContent, cdp
 * VocabCardDetailBody).
 *
 * The invariant that matters: `resolveCommonality` and `resolveDisplayDefinition` must
 * pick the SAME cluster. If they diverge, the chip prints a score for one meaning
 * directly beneath the gloss of another — a wrong number with no error anywhere.
 *
 * See docs/DEFINITION_CLUSTERS.md and docs/DATA_VALIDATION_SYSTEM.md.
 */

const cluster = (
  sense: string,
  frequencyScore: number | null,
  glosses: string[] = [sense],
): DefinitionCluster => ({
  sense,
  reading: null,
  pos: ["verb"],
  gender: null,
  frequencyScore,
  glosses,
}) as DefinitionCluster;

// Minimal entry shape — resolveCommonality reads only these fields.
const entry = (over: Partial<VocabEntry>): VocabEntry => ({
  entryKey: "干",
  language: "zh",
  definition: "to do",
  frequencyScore: 3,
  frequencyScoreApproved: false,
  definitionClusters: null,
  selectedSense: null,
  approvedSenseFrequencyLabels: [],
  ...over,
} as unknown as VocabEntry);

describe("resolveCommonality", () => {
  it("falls back to the entry-level score when the word has no sense choice", () => {
    // Unclustered, and single-cluster (sortedSenseClusters returns null under 2).
    for (const clusters of [null, [cluster("to do", 5)]]) {
      const result = resolveCommonality(entry({ definitionClusters: clusters }));
      expect(result).toEqual({ score: 3, senseLabel: null, approved: false });
    }
  });

  it("carries the entry-level approval flag on the fallback path", () => {
    const result = resolveCommonality(entry({ frequencyScoreApproved: true }));
    expect(result.approved).toBe(true);
    expect(result.senseLabel).toBeNull();
  });

  it("shows the SELECTED sense's score, not the entry's", () => {
    const clusters = [cluster("to do", 5), cluster("shield", 1)];
    const e = entry({ definitionClusters: clusters, selectedSense: "shield" });
    expect(resolveCommonality(e)).toMatchObject({ score: 1, senseLabel: "shield" });
  });

  it("defaults to the starred (highest-scoring) sense with no persisted pick", () => {
    // Deliberately supplied lowest-first: sortedSenseClusters reorders.
    const e = entry({ definitionClusters: [cluster("shield", 1), cluster("to do", 5)] });
    expect(resolveCommonality(e)).toMatchObject({ score: 5, senseLabel: "to do" });
  });

  it("honours a session sense-pick override ahead of the persisted label", () => {
    const e = entry({
      definitionClusters: [cluster("to do", 5), cluster("shield", 1)],
      selectedSense: "to do",
    });
    const sorted = sortedSenseClusters(e)!;
    const shieldIndex = sorted.findIndex((c) => c.sense === "shield");
    expect(resolveCommonality(e, shieldIndex)).toMatchObject({ score: 1, senseLabel: "shield" });
  });

  it("picks the same cluster the display definition does", () => {
    const e = entry({
      definitionClusters: [
        cluster("to do", 5, ["to do (informal)"]),
        cluster("shield", 1, ["shield"]),
      ],
      selectedSense: "shield",
    });
    expect(resolveDisplayDefinition(e)).toBe("shield");
    expect(resolveCommonality(e).senseLabel).toBe("shield");
  });

  it("falls back to the entry score when the chosen cluster was never scored", () => {
    // A cluster whose scoring pass failed carries frequencyScore null — rendering an
    // empty 0/5 meter would be worse than the entry-level number.
    const e = entry({
      definitionClusters: [cluster("to do", 5), cluster("shield", null)],
      selectedSense: "shield",
    });
    expect(resolveCommonality(e)).toEqual({ score: 3, senseLabel: null, approved: false });
  });

  it("approves ONLY the sense whose label the server returned", () => {
    const e = entry({
      definitionClusters: [cluster("to do", 5), cluster("shield", 1)],
      approvedSenseFrequencyLabels: ["shield"],
    });
    // Default sense ("to do") is unapproved even though another sense is approved.
    expect(resolveCommonality(e).approved).toBe(false);
    const sorted = sortedSenseClusters(e)!;
    const shieldIndex = sorted.findIndex((c) => c.sense === "shield");
    expect(resolveCommonality(e, shieldIndex).approved).toBe(true);
  });

  it("ignores the entry-level approval when the score is per-sense", () => {
    // Approving the det column must not silently vouch for a cluster nobody reviewed.
    const e = entry({
      definitionClusters: [cluster("to do", 5), cluster("shield", 1)],
      frequencyScoreApproved: true,
    });
    expect(resolveCommonality(e).approved).toBe(false);
  });
});
