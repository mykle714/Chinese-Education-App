import { describe, expect, it } from "vitest";
import { applyYiBuSandhi, applyYiBuSandhiToReading } from "../utils/toneSandhi";

/**
 * Guards the 一/不 DISPLAY sandhi. Every case below is a real reading as stored in
 * `dictionaryentries_zh.pronunciation` (the citation form) paired with what a speaker
 * actually says — which is also what decides the cpcd tone COLOR, since CPCDRow derives
 * the hue from the pinyin string it renders.
 */

const CASES: Array<[string, string, string]> = [
  // ---- 一 before T1/T2/T3 → yì --------------------------------------------------
  ["一流", "yī liú", "yì liú"],       // the word that started this
  ["一般", "yī bān", "yì bān"],
  ["一起", "yī qǐ", "yì qǐ"],
  ["一直", "yī zhí", "yì zhí"],
  ["一点", "yī diǎn", "yì diǎn"],
  // ---- 一 before T4 → yí ---------------------------------------------------------
  ["一定", "yī dìng", "yí dìng"],
  ["一下", "yī xià", "yí xià"],
  ["一路", "yī lù", "yí lù"],
  // ---- 不 before T4 → bú ---------------------------------------------------------
  ["不是", "bù shì", "bú shì"],
  ["不定", "bù dìng", "bú dìng"],
  ["不会", "bù huì", "bú huì"],
  // ---- 不 before anything else keeps its citation T4 -----------------------------
  ["不好", "bù hǎo", "bù hǎo"],
  ["不明", "bù míng", "bù míng"],
  ["不加", "bù jiā", "bù jiā"],
  // ---- word-final 一/不 never sandhis --------------------------------------------
  ["第一", "dì yī", "dì yī"],
  ["星期一", "xīng qī yī", "xīng qī yī"],
  ["三分之一", "sān fēn zhī yī", "sān fēn zhī yī"],
  ["合一", "hé yī", "hé yī"],
  ["三不", "sān bù", "sān bù"],
  // ---- ordinal 第 blocks the sandhi even mid-word --------------------------------
  ["第一次", "dì yī cì", "dì yī cì"],
  ["第一名", "dì yī míng", "dì yī míng"],
  // ---- enumeration / reduplication readings stay citation ------------------------
  ["一一", "yī yī", "yī yī"],
  ["一二", "yī èr", "yī èr"],
  // ---- a neutral following syllable is read as an underlying T4 ------------------
  ["一个", "yī ge", "yí ge"],
  // ---- mid-word and repeated triggers --------------------------------------------
  ["一心一意", "yī xīn yī yì", "yì xīn yí yì"],
  ["数一数二", "shǔ yī shǔ èr", "shǔ yì shǔ èr"],
  ["一动不动", "yī dòng bù dòng", "yí dòng bú dòng"],
  ["不得不", "bù dé bù", "bù dé bù"],
  ["空无一人", "kōng wú yī rén", "kōng wú yì rén"],
];

describe("applyYiBuSandhiToReading", () => {
  it.each(CASES)("%s: %s → %s", (word, citation, surface) => {
    expect(applyYiBuSandhiToReading(word, citation)).toBe(surface);
  });
});

describe("rule ordering", () => {
  /**
   * The case that forces a right-to-left pass: 一 must resolve against 定 (T4) FIRST,
   * becoming yí (T2); only then does 不 read that T2 and correctly stay bù. Resolving
   * left-to-right against 一's stored T1 happens to give the same answer here, but the
   * dependency genuinely runs rightward.
   */
  it("resolves 不一定 as bù yí dìng", () => {
    expect(applyYiBuSandhiToReading("不一定", "bù yī dìng")).toBe("bù yí dìng");
  });

  it("resolves 不一会 as bù yí huì", () => {
    expect(applyYiBuSandhiToReading("不一会", "bù yī huì")).toBe("bù yí huì");
  });
});

describe("idempotence", () => {
  /**
   * A segmented sentence runs the pass twice — once across the whole sentence, then again
   * per segment inside ForeignText's buildCharItems. The second pass must be a no-op.
   */
  it.each(CASES)("%s is stable under a second pass", (word, citation) => {
    const once = applyYiBuSandhiToReading(word, citation)!;
    expect(applyYiBuSandhiToReading(word, once)).toBe(once);
  });
});

describe("notation is preserved", () => {
  it("keeps numbered readings numbered", () => {
    // Cluster `reading`s are stored numbered; rewriting them into tone marks would break
    // callers that compare or re-parse the string.
    expect(applyYiBuSandhiToReading("一流", "yi1 liu2")).toBe("yi4 liu2");
    expect(applyYiBuSandhiToReading("一定", "yi1 ding4")).toBe("yi2 ding4");
    expect(applyYiBuSandhiToReading("不是", "bu4 shi4")).toBe("bu2 shi4");
  });
});

describe("guards", () => {
  it("returns the input untouched when syllable count disagrees with character count", () => {
    // Same shape guard as readingSyllableCount: a mismatched reading must never be
    // shifted across columns.
    expect(applyYiBuSandhi("一流", ["yī"])).toEqual(["yī"]);
    expect(applyYiBuSandhi("一流", ["yī", "liú", "extra"])).toEqual(["yī", "liú", "extra"]);
  });

  it("leaves a neutral 不 alone (potential complement / A-not-A)", () => {
    // 看不见 kànbujiàn and 好不好 hǎobuhǎo are lexical neutral-tone readings, not sandhi.
    expect(applyYiBuSandhiToReading("看不见", "kàn bu jiàn")).toBe("kàn bu jiàn");
    expect(applyYiBuSandhiToReading("好不好", "hǎo bu hǎo")).toBe("hǎo bu hǎo");
  });

  it("leaves non-alternant readings of 一/不 alone", () => {
    // 一 has a documented yao1 reading for spelling numbers out digit by digit, and two
    // discoverable entries store 不 with an off-citation tone. Neither is sandhi input.
    expect(applyYiBuSandhiToReading("一二", "yāo èr")).toBe("yāo èr");
    expect(applyYiBuSandhiToReading("不儿道", "bū r dào")).toBe("bū r dào");
  });

  it("treats a missing following syllable as phrase-final", () => {
    // Punctuation cells in a sentence carry pinyin "" — the 不 before them must not sandhi
    // against whatever follows the comma.
    expect(applyYiBuSandhi("不,好", ["bù", "", "hǎo"])).toEqual(["bù", "", "hǎo"]);
  });

  it("passes through empty and null readings unchanged", () => {
    // Nullish in, null out; empty string in, empty string out — the wrapper must not
    // change the falsy shape a caller is switching on.
    expect(applyYiBuSandhiToReading("一流", null)).toBeNull();
    expect(applyYiBuSandhiToReading("一流", undefined)).toBeNull();
    expect(applyYiBuSandhiToReading("一流", "")).toBe("");
  });
});

describe("sentence-level application", () => {
  it("sandhis across a segment boundary", () => {
    // 我 / 不 / 去 are three separate segments; only a whole-sentence pass sees that 去 is
    // T4 and turns 不 into bú. This is why SegmentedSentenceDisplay applies it on charData
    // rather than letting each per-segment ForeignText do it.
    expect(applyYiBuSandhi("我不去", ["wǒ", "bù", "qù"])).toEqual(["wǒ", "bú", "qù"]);
  });
});
