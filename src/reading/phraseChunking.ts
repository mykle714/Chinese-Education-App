/**
 * PHRASE CHUNKING — joins neighbouring gsa words into the phrases the Reader's "Phrase"
 * pill steps through (docs/READER_SEGMENTATION.md § "Phrase stepping").
 *
 * Why rules: the gsa (documentSegmentation.ts) only knows DICTIONARY words of 1–4
 * characters, and most phrases a learner reads as one unit are not headwords (太多的 has no
 * det row — nor does 太多). Something has to decide which neighbouring words belong
 * together; this file does it with a short list of Chinese grammar patterns over each
 * word's role (wordRoles.ts). It is pure and runs on data the reader already holds — no
 * request, no table.
 *
 * The rules (owner-approved draft, 2026-11-23). Each matches a run of ADJACENT words —
 * nothing between them, so punctuation, spaces and line breaks always end a phrase:
 *   1. DEGREE      degree adverb + adjective [+ 的 / 了 / 地]       太多的 · 很漂亮 · 多荒唐
 *   2. MEASURE     [第 | determiner] [number…] + measure word       三本 · 这三个 · 第二次
 *   3. VERB PHRASE [去 / 来 +] verb [+ complement] [+ aspect]       吃了 · 收起 · 吃完了 · 去想
 *                  (complement: directional 起 出来 … or resultative 完 懂 住 …; adjective + 了 too)
 *   4. DE          noun / pronoun / adjective / VERB PHRASE + 的     我的 · 漂亮的 · 说的
 *   5. NEGATION    [scope / time adverb] negator [+ PREDICATE [+ 的]]  不好 · 没去想 · 从没去想 · 都没有
 *   6. DOUBLED     X X · X 一 X · X 了 X  (one-character verb / adjective)  看看 · 看一看
 *   7. ADVERB      time / frequency adverb + VERB PHRASE            再争辩 · 已经吃了 · 马上去看
 *   8. PERSON      [scope adverb] pivot verb / preposition + person  请你 · 就请你 · 任你 · 为你
 *   9. PLACE       noun / pronoun + localizer                        心上 · 家里 · 我这儿
 * NESTING: rules 4, 5 and 7 take a whole VERB PHRASE (rule 3), not one verb, so joins
 * compose: 去想 → 没去想 → 从没去想 (verbPhrase / predicate below).
 * UNPROCESSED WORDS: a word det has no part of speech for yet (no row, or not yet through
 * the backfill — 残忍, 纠缠, 放弃 on dev) counts as the content word a rule wants (adjective,
 * verb or noun). Next to these grammar words a content word is by far the likeliest reading,
 * and without it every unprocessed word would break its phrase. A listed function word is
 * never treated so (FUNCTION_WORDS).
 * At each position the LONGEST matching rule wins; no match → the word is its own phrase.
 * Outside the verb-phrase nesting, rules do not chain (一个 | 很好的 stay two).
 *
 * Layer: pure client util (src/reading). Depended on by useReadingText.ts.
 * Tests: src/__tests__/phraseChunking.test.ts.
 */
import type { DictionaryEntry } from "../types";
import type { SegmentSpan, SpanRange } from "./documentSegmentation";
import { wordRole, type WordRole } from "./wordRoles";

/** One step unit: a run of whole gsa words (a single word is a one-word phrase). */
export interface PhraseSpan extends SpanRange {
    /** The gsa words it is made of, in order. Always ≥ 1. */
    words: SegmentSpan[];
}

// ── The word classes ──────────────────────────────────────────────────────────────────
// Every list is a CLOSED class of Chinese function words that det's part of speech is too
// coarse to name (det tags 太, 都 and 再 all "adverb"). Lists name classes, never sentences
// or content words (docs/READER_SEGMENTATION.md § "Word lists, not special cases"). Each
// was filled out as completely as the class allows (2026-11-23); a word belongs to the
// list of the job it does in the rule that reads it.

// Rule 1 — DEGREE adverbs: modify an adjective's intensity (太残忍 · 多荒唐 · 稍微大).
// 多 is the exclamative "how". Colloquial 超 / 巨 / 贼 / 老 / 怪 / 特 included.
const DEGREE_ADVERBS = new Set([
    "太", "很", "好", "真", "最", "更", "挺", "超", "蛮", "极", "多", "颇", "稍", "略", "较",
    "怪", "老", "特", "巨", "贼", "够", "忒",
    "非常", "特别", "比较", "有点", "有点儿", "有些", "十分", "相当", "越来越", "多么", "这么",
    "那么", "这样", "那样", "如此", "更加", "越发", "愈发", "极其", "极为", "格外", "分外",
    "尤其", "稍微", "稍稍", "略微", "过于", "太过", "实在", "异常", "无比", "最为", "更为",
    "较为", "很是", "挺是", "特为", "蛮是", "尤为", "颇为", "甚为", "倍儿", "超级",
]);
// Rule 1's optional tail.
const DEGREE_TAILS = new Set(["的", "了", "地"]);
// Rule 2 — DETERMINERS that take a measure word as a number does (这个 · 每次 · 上个 · 好几本).
const MEASURE_DETERMINERS = new Set([
    "这", "那", "哪", "每", "几", "某", "各", "上", "下", "头", "整", "多少", "好几",
]);
// Rule 2 — MEASURE WORDS: the particles-and-classifiers table's classifiers (pct, 2026-11-23)
// plus time and measurement units. Only consulted right after a number / determiner, where
// the measure reading is the only one. Backed up by det: a word whose partsOfSpeech lists
// "classifier" ANYWHERE counts too (isMeasure).
const MEASURE_WORDS = new Set([
    // pct classifiers
    "丈", "丛", "丝", "个", "串", "丸", "亩", "代", "件", "份", "伙", "位", "克", "具", "册",
    "出", "函", "刀", "分", "列", "则", "剂", "副", "勺", "包", "匣", "匹", "升", "卷", "双",
    "叠", "口", "句", "只", "台", "号", "名", "吨", "员", "味", "回", "团", "圈", "场", "块",
    "坛", "垄", "堂", "堆", "声", "壶", "处", "头", "套", "孔", "季", "宗", "家", "寸", "对",
    "封", "尊", "尺", "尾", "局", "层", "届", "峰", "帧", "席", "幅", "幕", "幢", "年", "度",
    "座", "张", "截", "户", "所", "扇", "手", "扎", "批", "把", "抱", "担", "拨", "挂", "捆",
    "捧", "排", "握", "摊", "摞", "撮", "支", "斛", "斤", "方", "日", "曲", "月", "服", "期",
    "本", "朵", "束", "条", "杯", "枚", "枝", "架", "栋", "株", "样", "根", "案", "桩", "桶",
    "棵", "樽", "次", "步", "段", "毫", "沓", "泓", "泡", "滴", "炷", "爿", "片", "瓣", "瓮",
    "瓶", "番", "盅", "盆", "盏", "盒", "盘", "石", "碗", "碟", "种", "秒", "窝", "章", "笔",
    "筐", "箱", "篇", "篓", "篮", "类", "粒", "级", "组", "绺", "缕", "缸", "罐", "群", "股",
    "艘", "节", "茬", "营", "蓬", "行", "袋", "袭", "起", "趟", "身", "轮", "辆", "辈", "通",
    "遍", "道", "遭", "部", "针", "钱", "钵", "锭", "门", "间", "阵", "面", "页", "顶", "项",
    "顿", "颗", "首",
    // beyond pct: common measures, time and measurement units
    "些", "点", "点儿", "下", "天", "岁", "周", "倍", "元", "角", "毛", "米", "里", "楼", "站",
    "餐", "拳", "脚", "眼", "刻", "成", "片儿", "会儿", "阵子", "星期", "礼拜",
    "小时", "钟头", "分钟", "公里", "公斤", "厘米", "毫米", "千米", "平方米", "块钱", "辈子",
]);
// Rule 3 — ASPECT markers.
const ASPECT_MARKERS = new Set(["了", "过", "着"]);
// Rule 5 — NEGATORS, incl. the fused forms the gsa keeps whole (从没, 不要, 绝不).
const NEGATORS = new Set([
    "不", "没", "别", "甭", "未", "勿", "莫", "无",
    "没有", "不要", "不用", "不必", "不曾", "未曾", "未必", "并非", "毫不", "绝不", "决不",
    "永不", "再不", "从没", "从不", "从未", "从来不", "从来没", "从来没有", "千万别", "不再",
]);
// Rules 5 and 8 — SCOPE adverbs: lead a whole predicate rather than one verb (都没有 · 也不 ·
// 根本没 · 千万别 · 就请你). They do not join a bare verb (rule 7): they lead modals, nouns
// and whole clauses as often as a verb.
const LEAD_ADVERBS = new Set([
    "都", "也", "还", "就", "才", "并", "却", "只", "全", "倒", "竟", "可", "便", "亦",
    "根本", "再也", "全都", "只是", "也许", "大概", "一定", "千万", "绝对", "竟然",
    "居然", "果然", "其实", "确实", "当然", "到底", "究竟", "难道", "肯定", "反正", "依旧",
    "原来", "本来", "恐怕", "好像", "似乎", "必须", "务必", "必定", "简直", "几乎", "差点",
    "差点儿", "真的",
]);
// Rule 7 — TIME / FREQUENCY / MANNER adverbs that sit right before their verb (再争辩 ·
// 已经吃了 · 一起去). They also lead a negator (rule 5: 已经不 · 一直没).
const VERB_ADVERBS = new Set([
    "再", "又", "常", "正", "刚", "先", "已", "曾", "将", "快", "仍", "总", "早", "另",
    "已经", "正在", "刚刚", "曾经", "马上", "立刻", "立即", "一起", "经常", "常常", "总是",
    "一直", "终于", "突然", "忽然", "渐渐", "逐渐", "慢慢", "将要", "快要", "就要", "赶紧",
    "赶快", "连忙", "急忙", "往往", "时常", "不断", "仍然", "依然", "偶尔", "始终", "早就",
    "早已", "随时", "亲自", "互相", "相互", "一同", "一块儿", "共同", "一齐", "重新", "再次",
    "又一次", "从来", "向来", "一向", "照样", "随便", "尽量", "特意", "故意", "顺便", "暂时",
    "临时", "及时", "按时", "准时", "统统", "一概", "白", "瞎", "乱", "多", "少",
]);
// Rule 8 — PIVOT verbs: ask / make / help / let a person do something (请你 · 让我 · 帮我 ·
// 任你).
// 要 is left out: as "want" it takes a possessive (要我的书), which rule 4 must keep.
const PIVOT_VERBS = new Set([
    "请", "让", "叫", "使", "令", "求", "劝", "逼", "催", "派", "托", "帮", "教", "陪", "替",
    "拜托", "麻烦", "允许", "要求", "命令", "鼓励", "强迫", "帮助", "邀请", "吩咐", "提醒",
    // the "let / leave it to" verbs: 任你 · 由你 · 随你 · 任凭你
    "任", "由", "随", "凭", "任凭", "任由", "听凭", "听任", "随便",
]);
// Rule 8 — PREPOSITIONS that take a person (为你 · 给我 · 对你 · 跟他 · 被他 · 把你).
const PERSON_PREPOSITIONS = new Set([
    "为", "给", "对", "跟", "和", "同", "与", "向", "朝", "冲", "往", "替", "被", "把", "比",
    "从", "离", "在", "为了", "对于", "关于", "除了", "跟着", "随着", "按照", "根据",
]);
// Rule 8 — the PERSON a pivot verb or preposition takes.
const PERSON_PRONOUNS = new Set([
    "你", "您", "我", "他", "她", "它", "咱", "俺",
    "你们", "我们", "他们", "她们", "它们", "咱们", "大家", "自己", "人家", "别人", "大伙",
    "大伙儿", "各位", "诸位",
]);
// Rule 3 — DIRECTIONAL complements: the motion a verb ends in (收起 · 拿出来 · 走过去).
const DIRECTIONAL_COMPLEMENTS = new Set([
    "起", "来", "去", "上", "下", "出", "进", "回", "过", "开", "到",
    "起来", "下来", "下去", "上来", "上去", "出来", "出去", "进来", "进去", "回来", "回去",
    "过来", "过去", "开来", "起去", "到来",
]);
// Rule 3 — RESULTATIVE complements: the result a verb ends in (吃完 · 看懂 · 记住 · 说错).
const RESULT_COMPLEMENTS = new Set([
    "完", "好", "见", "懂", "住", "掉", "走", "成", "错", "光", "透", "坏", "惯", "够", "饱",
    // (对 is left out: 说对 would swallow the preposition of 他说对我很好.)
    "满", "死", "倒", "破", "醒", "通", "清", "晚", "早", "遍",
    "清楚", "明白", "干净",
]);
// Rule 9 — LOCALIZERS (方位词): the place relative to a noun (心上 · 家里 · 门外 · 桌子上面).
// Also the demonstrative places a pronoun takes (我这儿 · 你那里).
const LOCALIZERS = new Set([
    "上", "下", "里", "中", "内", "外", "前", "后", "旁", "边", "间", "底", "头",
    "上面", "下面", "里面", "外面", "前面", "后面", "旁边", "中间", "上边", "下边", "里边",
    "外边", "前边", "后边", "左边", "右边", "左面", "右面", "底下", "对面", "当中", "之中",
    "之上", "之下", "之内", "之外", "之前", "之后", "之间", "以上", "以下", "以内", "以外",
    "以前", "以后", "里头", "外头", "上头", "下头", "前头", "后头",
    "这儿", "那儿", "这里", "那里", "这边", "那边",
]);
// Every listed word is a KNOWN function word: it never stands in for an unprocessed
// content word (isUnprocessed), even while its own det row has no part of speech yet.
const FUNCTION_WORDS = new Set([
    DEGREE_ADVERBS, DEGREE_TAILS, MEASURE_DETERMINERS, ASPECT_MARKERS, NEGATORS, LEAD_ADVERBS,
    VERB_ADVERBS, PERSON_PRONOUNS, LOCALIZERS, PERSON_PREPOSITIONS,
].flatMap((set) => [...set]));
const DIGITS = /^[0-9０-９]+$/;

/** What a rule sees for each word. */
interface ChunkWord {
    text: string;
    role: WordRole | null;
    /** Whether det lists "classifier" anywhere in its parts of speech (rule 2 only). */
    canMeasure: boolean;
}

// No role: no det row, or a row the backfill has not given a part of speech yet. Counts as
// whichever content word a rule wants (header § UNPROCESSED WORDS) — unless it is a listed
// function word (FUNCTION_WORDS), which is never a content word.
const isUnprocessed = (w: ChunkWord | undefined) => !!w && w.role === null && !FUNCTION_WORDS.has(w.text);
const isAdjective = (w: ChunkWord | undefined) => w?.role === "adjective" || isUnprocessed(w);
const isVerb = (w: ChunkWord | undefined) => w?.role === "verb" || isUnprocessed(w);
const isNumber = (w: ChunkWord | undefined) => !!w && (w.role === "numeral" || DIGITS.test(w.text));
const isMeasure = (w: ChunkWord | undefined) => !!w && (w.canMeasure || MEASURE_WORDS.has(w.text));
const is = (w: ChunkWord | undefined, set: Set<string>) => !!w && set.has(w.text);

// Each rule: how many words starting at `i` it joins (0 = no match). `run` holds only the
// ADJACENT words from `i` on, so a rule never reaches across a gap.
type Rule = (run: ChunkWord[]) => number;

const degreeRule: Rule = (run) => {
    if (!is(run[0], DEGREE_ADVERBS) || !isAdjective(run[1])) return 0;
    return is(run[2], DEGREE_TAILS) ? 3 : 2;
};

const measureRule: Rule = (run) => {
    // [第 | determiner] [number…] measure — at least one of the determiner / number.
    // 三本 · 第二次 · 这个 · 这三个 · 三|十|五个 (a number the gsa split into several words).
    let n = 0;
    if (run[0]?.text === "第" || is(run[0], MEASURE_DETERMINERS)) n = 1;
    const hasDeterminer = n === 1 && run[0]?.text !== "第";
    const numberStart = n;
    while (isNumber(run[n])) n++;
    if (!hasDeterminer && n === numberStart) return 0;
    return isMeasure(run[n]) ? n + 1 : 0;
};

// ── Verb phrases ─────────────────────────────────────────────────────────────────────
// Phrases NEST: a verb phrase is itself built of phrases, and the rules that take a verb
// (negation, time adverbs, 的) take the WHOLE verb phrase, so the joins compose:
//   去想 (serial verb) → 没去想 (negation over it) → 从没去想 (the fused negator over it).
// verbPhrase(run) is the length of the longest verb phrase starting at run[0] (0 = none):
//   去 / 来 + verb phrase          去想 · 来看看 · 去收起来   (SERIAL: go / come to do)
//   verb [+ complement] [+ aspect]  吃 · 吃完 · 收起 · 吃完了 · 看过
const SERIAL_LEADS = new Set(["去", "来"]);

function verbPhrase(run: ChunkWord[]): number {
    if (is(run[0], SERIAL_LEADS)) {
        const rest = verbPhrase(run.slice(1));
        if (rest > 0) return 1 + rest;
    }
    if (!isVerb(run[0])) return 0;
    let n = 1;
    if (is(run[n], DIRECTIONAL_COMPLEMENTS) || is(run[n], RESULT_COMPLEMENTS)) n++;
    if (is(run[n], ASPECT_MARKERS)) n++;
    return n;
}

// A predicate: a verb phrase, or an adjective [+ 了] (累了).
function predicate(run: ChunkWord[]): number {
    const verb = verbPhrase(run);
    const adjective = isAdjective(run[0]) ? (run[1]?.text === "了" ? 2 : 1) : 0;
    return Math.max(verb, adjective);
}

// Rules 3 + 7 as one: a verb phrase of more than one word (吃了 · 收起 · 去想 · 吃完了),
// or an adjective + 了 (累了).
const verbPhraseRule: Rule = (run) => {
    const n = predicate(run);
    return n >= 2 ? n : 0;
};

const deRule: Rule = (run) => {
    // 我的 · 漂亮的 · 说的 · 收起的: a noun / pronoun / adjective / verb phrase + 的
    // (incl. 的 written for 得, as in 说的天花乱坠).
    const role = run[0]?.role;
    const head = role === "pronoun" || role === "noun" ? 1 : predicate(run);
    return head > 0 && run[head]?.text === "的" ? head + 1 : 0;
};

const negationRule: Rule = (run) => {
    // 都没有 · 也不 · 已经不: a leading scope / time adverb rides along with the negator.
    const lead = (is(run[0], LEAD_ADVERBS) || is(run[0], VERB_ADVERBS)) && is(run[1], NEGATORS) ? 1 : 0;
    if (!is(run[lead], NEGATORS)) return 0;
    const rest = run.slice(lead + 1);
    const body = predicate(rest);
    // No verb / adjective after it (都没有 | 绝对): the lead + negator alone, when there is a lead.
    if (body === 0) return lead ? 2 : 0;
    // 没去 · 没去过 · 没去想 · 从没去想 · 没想的 (the whole verb phrase, then an optional 的).
    const de = rest[body]?.text === "的" ? 1 : 0;
    return lead + 1 + body + de;
};

const doubledRule: Rule = (run) => {
    const head = run[0];
    if (!head || [...head.text].length !== 1 || !(isVerb(head) || isAdjective(head))) return 0;
    if (run[1]?.text === head.text) return 2;
    if ((run[1]?.text === "一" || run[1]?.text === "了") && run[2]?.text === head.text) return 3;
    return 0;
};

const adverbRule: Rule = (run) => {
    // 再争辩 · 已经吃了 · 马上去看: a time adverb + the whole verb phrase.
    if (!is(run[0], VERB_ADVERBS)) return 0;
    const body = verbPhrase(run.slice(1));
    return body > 0 ? 1 + body : 0;
};

const personRule: Rule = (run) => {
    // 请你 · 就请你 · 任你 · 为你 · 给我: a pivot verb or preposition + the person it takes.
    const lead = is(run[0], LEAD_ADVERBS) ? 1 : 0;
    const taker = is(run[lead], PIVOT_VERBS) || is(run[lead], PERSON_PREPOSITIONS);
    // The person is required: 就请 | 收起 and 请 | 收起 stay apart.
    return taker && is(run[lead + 1], PERSON_PRONOUNS) ? lead + 2 : 0;
};

// 心上 · 家里: a noun (or an unprocessed word, header § UNPROCESSED WORDS) + localizer;
// 我这儿: a pronoun + a demonstrative place. A verb + 上 / 下 / 里… is a complement instead.
const placeRule: Rule = (run) => {
    const head = run[0];
    if (!head || !is(run[1], LOCALIZERS)) return 0;
    return head.role === "noun" || head.role === "pronoun" || isUnprocessed(head) ? 2 : 0;
};

const RULES: Rule[] = [
    degreeRule, measureRule, verbPhraseRule, deRule, negationRule, doubledRule, adverbRule,
    personRule, placeRule,
];

/** The adjacent run of words starting at `index` (stops at the first gap). */
function adjacentRun(spans: SegmentSpan[], words: ChunkWord[], index: number): ChunkWord[] {
    const run = [words[index]];
    for (let j = index + 1; j < spans.length && spans[j].start === spans[j - 1].end; j++) run.push(words[j]);
    return run;
}

/**
 * Join `spans` (the gsa words, sorted, non-overlapping) into phrases. Every word lands in
 * exactly one phrase, in order, so the result covers the same text as `spans` and can be
 * stepped through with the same helpers (documentSegmentation.ts → spanAfter / spanBefore).
 * `entryByWord` resolves each word's det row (wordRoles.ts → buildEntryByWord).
 */
export function chunkPhrases(
    content: string,
    spans: SegmentSpan[],
    entryByWord: ReadonlyMap<string, DictionaryEntry>,
): PhraseSpan[] {
    const words: ChunkWord[] = spans.map((span) => {
        const entry = entryByWord.get(span.text);
        return {
            text: span.text,
            role: wordRole(span.text, entry),
            canMeasure: Array.isArray(entry?.partsOfSpeech) && entry.partsOfSpeech.includes("classifier"),
        };
    });
    const phrases: PhraseSpan[] = [];
    let i = 0;
    while (i < spans.length) {
        const run = adjacentRun(spans, words, i);
        const length = Math.max(1, ...RULES.map((rule) => Math.min(rule(run), run.length)));
        const members = spans.slice(i, i + length);
        const start = members[0].start;
        const end = members[members.length - 1].end;
        phrases.push({ start, end, text: content.slice(start, end), words: members });
        i += length;
    }
    return phrases;
}

/** The word spans lying wholly inside [start, end), when that range starts on the first and
 *  ends on the last — i.e. the range is exactly a run of whole words. Otherwise null. */
export function wordsCoveringRange(spans: SegmentSpan[], start: number, end: number): SegmentSpan[] | null {
    if (end <= start) return null;
    const inside = spans.filter((span) => span.start >= start && span.end <= end);
    if (inside.length === 0 || inside[0].start !== start || inside[inside.length - 1].end !== end) return null;
    return inside;
}
