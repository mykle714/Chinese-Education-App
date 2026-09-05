import { numberedToTonedSyllable, syllableToNumberedPinyin } from "./textUtils";

/**
 * 一 / 不 tone sandhi — the display-time correction between the dictionary's CITATION
 * form and what a speaker actually says.
 *
 * The det tables store the citation reading (`一流` = `yi1 liu2`), which is correct for a
 * dictionary but wrong on screen: 一 is pronounced `yì` there, and the cpcd paints its
 * tone color from that same string, so an uncorrected reading is wrong twice over — the
 * diacritic AND the hue. TTS meanwhile applies the sandhi itself, so display and audio
 * silently disagree on ~180 discoverable zh entries.
 *
 * ⚠️ DISPLAY ONLY. Never feed the output back into search, matching, or the TTS
 * pronunciation hint — `vocabSearch`, `PinyinKeypad` and `word-search/pinyinUnits` all
 * compare against the stored citation form and must keep doing so.
 *
 * ## The rule
 *
 * Both characters share ONE formula, which is why they're handled together:
 *
 *   surface tone = (tone of the following syllable === 4) ? 2 : 4
 *
 * For 不 the "else" branch is a no-op (its citation tone already IS 4), so the single
 * expression covers both. Spelled out:
 *
 *   一 + T1/T2/T3 → yì    一流 yì liú,  一般 yì bān,  一起 yì qǐ
 *   一 + T4       → yí    一定 yí dìng, 一样 yí yàng
 *   不 + T4       → bú    不是 bú shì,  不对 bú duì
 *   不 + other    → bù    不好 bù hǎo
 *
 * ## Why right-to-left
 *
 * 一 and 不 read the SURFACE tone of what follows, so when they stack the inner one must
 * resolve first. 不一定 is the case that proves it:
 *
 *   bu4 yi1 ding4  →  一 sees 定 (T4) → yí (T2)  →  不 sees yí (T2) → bù
 *   surface: bù yí dìng   ✅
 *
 * A left-to-right pass would let 不 read 一's stored T1 and get the right answer here by
 * luck, but the dependency genuinely runs rightward and the loop should honor it.
 *
 * ## Not handled (deliberately)
 *
 * - **T3+T3 sandhi** (你好 → ní hǎo). Deterministic only inside a 2-syllable word; at 3+
 *   syllables the prosodic grouping decides and is not recoverable from the tone string
 *   (海马体 → hái mǎ tǐ but 打手语 → dǎ shóu yǔ, both stored `333`). Left for a follow-up
 *   that can opt in per-length.
 * - **七/八 sandhi** — optional and largely obsolete in modern standard Mandarin.
 * - **Half-third tone** — allophonic; changes the sound, not the notation.
 *
 * Referenced by docs/CPCD_PINYIN_SHIFT.md and docs/DEFINITION_MAPPING.md.
 */

const YI = "一";
const BU = "不";

/** Prefix that marks 一 as an ordinal (第一次 dì yī cì), which blocks the sandhi. */
const ORDINAL_PREFIX = "第";

/**
 * Notation of an incoming syllable, preserved on the way out. `pronunciation` columns are
 * tone-marked ("yī liú") while cluster `reading`s are numbered ("yi1 liu2"), and both
 * reach display surfaces — rewriting one into the other would break callers that then
 * measure or compare the string.
 */
type Notation = "toned" | "numbered";

interface ParsedSyllable {
    /** Letters only, no tone digit or diacritic. */
    base: string;
    /** 1–4, or 0 for neutral. */
    tone: number;
    notation: Notation;
}

/**
 * Split one syllable into base + tone, accepting either notation. Returns null for
 * anything that isn't a toneable pinyin syllable (punctuation cells, empty strings, the
 * "" a segment gets when its pronunciation failed the syllable-count guard) — callers
 * treat null as "no following tone", which correctly suppresses the sandhi.
 */
function parseSyllable(syllable: string): ParsedSyllable | null {
    const trimmed = syllable.trim();
    if (!trimmed) return null;

    // Numbered form first: syllableToNumberedPinyin passes these through untouched, so
    // matching here avoids a pointless round-trip and preserves the notation flag.
    const numbered = trimmed.match(/^([a-zA-ZüÜ:]+)([0-5])$/);
    if (numbered) {
        // 5 is the neutral-tone digit in CC-CEDICT's convention; normalize it to 0 so the
        // rest of the module has one representation of "no tone".
        return { base: numbered[1], tone: parseInt(numbered[2], 10) % 5, notation: "numbered" };
    }

    // Tone-marked form (or a bare neutral syllable, which carries no diacritic at all).
    const converted = syllableToNumberedPinyin(trimmed);
    const match = converted.match(/^([a-zA-ZüÜ:]+)([1-4])?$/);
    if (!match) return null;
    return { base: match[1], tone: match[2] ? parseInt(match[2], 10) : 0, notation: "toned" };
}

/** Render base + tone back into the notation the syllable arrived in. */
function formatSyllable({ base, notation }: ParsedSyllable, tone: number): string {
    const asNumbered = `${base}${tone === 0 ? 5 : tone}`;
    return notation === "numbered" ? asNumbered : numberedToTonedSyllable(asNumbered);
}

/**
 * Whether the 一 at `index` should keep its citation tone.
 *
 * Both guards are positional rather than whole-word lookups, so they work identically for
 * a dictionary headword and for a 一 sitting mid-sentence.
 */
function yiKeepsCitationTone(chars: string[], index: number): boolean {
    // Ordinals: 第一次 is dì yī cì, not dì yí cì. (第一 on its own is already exempt by the
    // word-final rule below, but 第一次 / 第一名 are not.)
    if (chars[index - 1] === ORDINAL_PREFIX) return true;
    // Enumeration and reduplication: 一一 is yīyī and 一二 is yī'èr — both are counting
    // readings, where 一 never sandhis.
    if (chars[index + 1] === YI || chars[index + 1] === "二") return true;
    return false;
}

/**
 * Apply 一/不 sandhi to a per-character reading.
 *
 * `characters` and `syllables` must be positionally aligned (one syllable per character);
 * a length mismatch returns the input untouched rather than shifting readings across
 * columns — the same shape guard `readingSyllableCount` exists for.
 *
 * Idempotent by construction: the surface tone is recomputed from the FOLLOWING syllable
 * every time rather than mutated relative to the current one, so running the pass twice
 * (as a segmented sentence does — once over the whole sentence, once per segment inside
 * ForeignText) yields the same result as running it once.
 */
export function applyYiBuSandhi(characters: string, syllables: string[]): string[] {
    const chars = [...characters];
    if (chars.length !== syllables.length) return syllables;

    const parsed = syllables.map(parseSyllable);
    const out = [...syllables];

    // Right to left, and never the last character: a word- or phrase-final 一/不 keeps its
    // citation tone (统一 tǒngyī, 第一 dì yī, 要不 yào bù) because there is nothing after it
    // to trigger the change.
    for (let i = chars.length - 2; i >= 0; i--) {
        const char = chars[i];
        if (char !== YI && char !== BU) continue;

        const self = parsed[i];
        if (!self) continue;

        // Guard against data oddities rather than trusting the character alone. Two
        // discoverable entries store 不 as `bū`/`bú` (不儿道, 不儿) and 一 has a documented
        // `yao1` reading for digit-by-digit spelling; rewriting those would be a
        // regression, not a fix. Only a syllable that is ALREADY one of the sandhi
        // alternants is eligible.
        const base = self.base.toLowerCase();
        if (char === YI) {
            if (base !== "yi" || ![1, 2, 4].includes(self.tone)) continue;
            if (yiKeepsCitationTone(chars, i)) continue;
        } else {
            // A neutral 不 is a potential complement or A-not-A infix (看不见 kànbujiàn,
            // 好不好 hǎobuhǎo). That reading is lexical, not sandhi — leave it alone.
            if (base !== "bu" || ![2, 4].includes(self.tone)) continue;
        }

        const next = parsed[i + 1];
        if (!next) continue; // punctuation or a missing reading: treat as phrase-final

        // A neutral following syllable is treated as an underlying T4, which is what makes
        // 一个 come out as yí ge — by far the most common 一+neutral word. The assumption is
        // harmless for 不, whose non-T4 branch returns its citation tone unchanged.
        const nextTone = next.tone === 0 ? 4 : next.tone;

        // The shared formula. See the module comment.
        const surfaceTone = nextTone === 4 ? 2 : 4;
        if (surfaceTone === self.tone) continue;

        out[i] = formatSyllable(self, surfaceTone);
        // Write back so a 一/不 further LEFT reads the surface tone we just produced
        // (不一定 → 不 must see 一's new T2, not its stored T1).
        parsed[i] = { ...self, tone: surfaceTone };
    }

    return out;
}

/**
 * Whole-string convenience wrapper: takes a space-separated reading and returns one.
 * Used by surfaces that hold the reading as a single string rather than per-character
 * syllables.
 */
export function applyYiBuSandhiToReading(characters: string, reading: string | null | undefined): string | null {
    if (!reading) return reading ?? null;
    const syllables = reading.trim().split(/\s+/).filter(Boolean);
    return applyYiBuSandhi(characters, syllables).join(" ");
}
