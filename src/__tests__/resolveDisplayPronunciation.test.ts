import { describe, expect, it } from "vitest";
import { resolveDisplayDefinition, resolveDisplayPronunciation } from "../utils/definitionUtils";
import type { DefinitionCluster, VocabEntry } from "../types";

/**
 * Guards the sense-awareness of the DISPLAY PINYIN (cpcd overlay on the flashcard face,
 * cdp hero, eip header, match-speed / bubble-match / speed-reading prompts).
 *
 * The invariant that matters: `resolveDisplayPronunciation` and `resolveDisplayDefinition`
 * must pick the SAME cluster. If they diverge, a heteronym prints one sense's English over
 * another sense's tones — wrong, and silent.
 *
 * See docs/DEFINITION_CLUSTERS.md.
 */

const cluster = (
  sense: string,
  reading: string | null,
  frequencyScore: number | null,
  glosses: string[] = [sense],
): DefinitionCluster => ({
  sense,
  reading,
  pos: ["verb"],
  gender: null,
  frequencyScore,
  glosses,
}) as DefinitionCluster;

// 过去 — "the past" (guò qù) vs the verb-directional suffix (guò qu, neutral second tone).
const PAST = cluster("the past", "guo4 qu4", 5, ["the past"]);
const SUFFIX = cluster("directional suffix", "guo4 qu5", 2, ["to pass over"]);

const entry = (over: Partial<VocabEntry>): VocabEntry => ({
  entryKey: "过去",
  language: "zh",
  definition: "the past",
  pronunciation: "guò qù",
  definitionClusters: null,
  selectedSense: null,
  ...over,
} as unknown as VocabEntry);

describe("resolveDisplayPronunciation", () => {
  it("falls back to the pronunciation column when the word has no sense choice", () => {
    // Unclustered, and single-cluster (sortedSenseClusters returns null under 2).
    for (const clusters of [null, [PAST]]) {
      expect(resolveDisplayPronunciation(entry({ definitionClusters: clusters }))).toBe("guò qù");
    }
  });

  it("reads out the selected sense's own reading, tone-marked", () => {
    const e = entry({ definitionClusters: [PAST, SUFFIX], selectedSense: "directional suffix" });
    expect(resolveDisplayPronunciation(e)).toBe("guò qu");
    // ...and the override wins, for a pick made this session that hasn't persisted yet.
    expect(resolveDisplayPronunciation(e, 0)).toBe("guò qù");
  });

  it("picks the same cluster resolveDisplayDefinition does", () => {
    const clusters = [PAST, SUFFIX];
    for (const index of [0, 1]) {
      const e = entry({ definitionClusters: clusters });
      const gloss = resolveDisplayDefinition(e, index);
      const pinyin = resolveDisplayPronunciation(e, index);
      // Frequency-sorted, so index 0 is "the past" (5) and index 1 the suffix (2).
      expect([gloss, pinyin]).toEqual(index === 0 ? ["the past", "guò qù"] : ["to pass over", "guò qu"]);
    }
  });

  it("keeps the column when the cluster reading has the wrong syllable count", () => {
    // A mis-shaped reading would shift every character's pinyin one cpcd column over.
    const broken = cluster("directional suffix", "qu5", 2, ["to pass over"]);
    const e = entry({ definitionClusters: [PAST, broken], selectedSense: "directional suffix" });
    expect(resolveDisplayPronunciation(e)).toBe("guò qù");
  });

  it("keeps the column for Spanish, whose senses carry no reading", () => {
    const e = entry({
      entryKey: "cura",
      language: "es",
      pronunciation: null,
      definitionClusters: [cluster("cure", null, 4), cluster("priest", null, 3)],
      selectedSense: "priest",
    });
    expect(resolveDisplayPronunciation(e)).toBeNull();
  });
});


/**
 * THE AUDIO MUST SAY WHAT THE SCREEN SHOWS.
 *
 * `useTTS.speak` passes its pronunciation hint to the cloud provider, which sends it to
 * Google TTS as an SSML <phoneme> tag — so the hint decides which reading is actually
 * SPOKEN. It used to send the raw `pronunciation` column while every card face rendered
 * `resolveDisplayPronunciation`. For a polyphone those differ by construction, and the
 * learner hears one syllable while reading another.
 *
 * These pin the property at the resolver, which is the shared seam: `speak` and every
 * card face now call the same function with the same arguments, so a future change that
 * reintroduces the split has to go through here.
 */
describe("display pinyin and narrated pinyin agree", () => {
  // 和 — the real report: hé on "and", huó on "to blend".
  const AND = cluster("and / with", "he2", 3, ["and; with"]);
  const BLEND = cluster("to mix / blend", "huo2", 1, ["to blend"]);
  const he = (over: Partial<VocabEntry> = {}): VocabEntry =>
    ({
      entryKey: "和",
      language: "zh",
      definition: "and; with",
      pronunciation: "hé",
      definitionClusters: [AND, BLEND],
      selectedSense: null,
      ...over,
    }) as unknown as VocabEntry;

  it("resolves the SELECTED sense's reading, not the headword column", () => {
    // The bug, stated directly: the column says hé, the chosen sense says huó, and the
    // card shows huó. Anything narrating the column contradicts the screen.
    const blending = he({ selectedSense: "to mix / blend" });
    expect(resolveDisplayPronunciation(blending)).toBe("huó");
    expect(blending.pronunciation).toBe("hé");
  });

  it("agrees for every sense of a polyphone", () => {
    for (let i = 0; i < 2; i++) {
      const displayed = resolveDisplayPronunciation(he(), i);
      const narrated = resolveDisplayPronunciation(he(), i);
      expect(narrated).toBe(displayed);
    }
  });

  it("honors a live sense override ahead of the persisted one", () => {
    // The flp picker moves `selectedSenseIndex` immediately while `selectedSense` only
    // catches up after the persist round-trips. Narration takes the override so the
    // audio never lags the pinyin printed above it.
    const persistedAsAnd = he({ selectedSense: "and / with" });
    expect(resolveDisplayPronunciation(persistedAsAnd)).toBe("hé");
    expect(resolveDisplayPronunciation(persistedAsAnd, 1)).toBe("huó");
  });

  it("falls back to the column when a cluster has no reading", () => {
    // A partially-enriched entry must narrate SOMETHING rather than nothing.
    const noReading = he({ definitionClusters: [cluster("and / with", null, 3)] });
    expect(resolveDisplayPronunciation(noReading)).toBe("hé");
  });
});
