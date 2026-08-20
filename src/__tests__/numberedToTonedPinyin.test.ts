import { describe, expect, it } from "vitest";
import { numberedToTonedPinyin, numberedToTonedSyllable } from "../utils/textUtils";
import { numberedToTonedSyllable as serverSyllable } from "../../server/utils/pinyinTones";

/**
 * Guards the TONE-MARK PLACEMENT rule, which decides which vowel of a syllable carries the
 * diacritic. Cluster `reading`s are stored in numbered form (`zhong4 dian3`), so every
 * sense-resolved pinyin on screen passes through this conversion — it is the last step
 * before the learner reads the tones.
 *
 * The rule: a, e, or o takes the mark (they never co-occur in one syllable); otherwise the
 * LAST of i/u/ü, which is what puts the mark on the u of "iu" and the i of "ui".
 *
 * Regression: `o` was missing from the first group, so "tou2" fell through to the
 * last-vowel fallback and rendered "toú" instead of "tóu" (likewise shoǔ, koǔ). It stayed
 * hidden while the resolver only fired for multi-cluster entries and every other surface
 * read the already-tone-marked `pronunciation` column.
 */

const CASES: Array<[string, string]> = [
  // The regression: -ou must mark the o, not the u.
  ["tou2", "tóu"],
  ["shou3", "shǒu"],
  ["kou3", "kǒu"],
  ["ou3", "ǒu"],
  // -uo / bare o also mark the o.
  ["duo1", "duō"],
  ["guo4", "guò"],
  // a and e outrank o when they co-occur ("ao", "iao").
  ["hao3", "hǎo"],
  ["xiao3", "xiǎo"],
  ["bao4", "bào"],
  // The last-of-i/u/ü fallback: "ui" marks the i, "iu" marks the u.
  ["hui4", "huì"],
  ["gui4", "guì"],
  ["liu4", "liù"],
  ["jiu3", "jiǔ"],
  // ü spellings CC-CEDICT writes as "u:" / "v".
  ["lu:3", "lǚ"],
  ["lv3", "lǚ"],
  // Neutral tone carries no diacritic.
  ["zhe5", "zhe"],
];

describe("numberedToTonedSyllable", () => {
  it.each(CASES)("%s → %s", (numbered, toned) => {
    expect(numberedToTonedSyllable(numbered)).toBe(toned);
  });

  it("agrees with its server twin on every case", () => {
    // The two implementations are hand-mirrored; a fix applied to one and not the other
    // would make the same word render differently depending on which layer resolved it.
    for (const [numbered] of CASES) {
      expect(serverSyllable(numbered)).toBe(numberedToTonedSyllable(numbered));
    }
  });
});

describe("numberedToTonedPinyin", () => {
  it("converts a multi-syllable reading", () => {
    // The word that started this: its clusters say zhong4 dian3 while the det
    // pronunciation column still holds the unreviewed chong2 dian3 seed.
    expect(numberedToTonedPinyin("zhong4 dian3")).toBe("zhòng diǎn");
    expect(numberedToTonedPinyin("kong1 shou3")).toBe("kōng shǒu");
  });
});
