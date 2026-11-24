import { describe, it, expect } from 'vitest';
import { chunkPhrases, wordsCoveringRange } from '../reading/phraseChunking';
import { pickPhraseWords } from '../reading/phrasePick';
import { drillAt } from '../reading/readerDrill';
import type { SegmentSpan } from '../reading/documentSegmentation';
import type { DictionaryEntry } from '../types';

// Covers the Reader's phrase stepping (docs/READER_SEGMENTATION.md § "Phrase stepping"):
// the grammar rules (phraseChunking.ts), the split keycap's pick-2 ranking (phrasePick.ts)
// and the tap-inside-the-selection drill (readerDrill.ts).

/** Spans for words written with "|" between them; " " and "，" are gaps (no span). */
function spansOf(segmented: string): { content: string; spans: SegmentSpan[] } {
    const content = segmented.replace(/\|/g, '');
    const spans: SegmentSpan[] = [];
    let offset = 0;
    for (const piece of segmented.split(/(\||[ ，])/)) {
        if (piece === '|' || piece === '') continue;
        if (piece === ' ' || piece === '，') { offset += 1; continue; }
        spans.push({ start: offset, end: offset + piece.length, text: piece });
        offset += piece.length;
    }
    return { content, spans };
}

const entry = (word1: string, pos: string[], difficulty?: number, frequencyScore?: number): DictionaryEntry =>
    ({ word1, partsOfSpeech: pos, difficulty, frequencyScore } as unknown as DictionaryEntry);

const DICT = new Map<string, DictionaryEntry>([
    ['太', entry('太', ['adverb'], 1)],
    ['多', entry('多', ['adjective', 'adverb', 'numeral'], 1)],
    ['的', entry('的', ['particle'], 1)],
    ['很', entry('很', ['adverb'], 1)],
    ['漂亮', entry('漂亮', ['adjective'], 2)],
    ['三', entry('三', ['numeral'], 1)],
    ['本', entry('本', ['classifier', 'adverb'], 1)],
    ['只', entry('只', ['adverb'], 1)],
    ['书', entry('书', ['noun'], 1)],
    ['吃', entry('吃', ['verb'], 1)],
    ['看', entry('看', ['verb'], 1)],
    ['去', entry('去', ['verb'], 1)],
    ['我', entry('我', ['pronoun'], 1)],
    ['这', entry('这', ['pronoun'], 1)],
    ['个', entry('个', ['classifier'], 1)],
    ['猫', entry('猫', ['noun'], 1)],
    ['不', entry('不', ['adverb'], 1)],
    ['好', entry('好', ['adjective'], 1)],
    ['一', entry('一', ['numeral'], 1)],
    ['说', entry('说', ['verb'], 1)],
    ['想', entry('想', ['verb'], 1)],
    ['收', entry('收', ['verb'], 1)],
    ['起', entry('起', ['verb', 'classifier'], 1)],
    ['都', entry('都', ['adverb'], 1)],
    ['没', entry('没', ['adverb', 'verb'], 1)],
    ['没有', entry('没有', ['verb', 'adverb'], 1)],
    ['绝对', entry('绝对', ['adverb', 'adjective'], 1)],
    ['吧', entry('吧', ['particle'], 1)],
    ['从没', entry('从没', ['adverb'], 1)],
    ['再', entry('再', ['adverb'], 1)],
    ['就', entry('就', ['adverb'], 1)],
    ['请', entry('请', ['verb'], 1)],
    ['十', entry('十', ['numeral'], 1)],
    ['五', entry('五', ['numeral'], 1)],
    ['已经', entry('已经', ['adverb'], 1)],
    ['帮', entry('帮', ['verb'], 1)],
    ['完', entry('完', ['verb'], 1)],
    ['几', entry('几', [], 1)],
    ['头', entry('头', ['noun', 'classifier'], 1)],
    ['牛', entry('牛', ['noun'], 1)],
    ['心', entry('心', ['noun'], 1)],
    ['上', entry('上', ['verb', 'noun'], 1)],
    ['划', entry('划', ['verb'], 1)],
]);

const phrases = (segmented: string) => {
    const { content, spans } = spansOf(segmented);
    return chunkPhrases(content, spans, DICT).map((p) => p.text);
};

describe('chunkPhrases — the grammar rules', () => {
    it('rule 1: degree adverb + adjective + tail', () => {
        expect(phrases('太|多|的|书')).toEqual(['太多的', '书']);
        expect(phrases('很|漂亮')).toEqual(['很漂亮']);
        expect(phrases('多|荒唐')).toEqual(['多荒唐']); // 荒唐 unprocessed; 多 = "how"
        expect(phrases('多|书')).toEqual(['多', '书']); // a noun after 多 stays apart
    });
    it('an unprocessed word (not in DICT) counts as the content word a rule wants', () => {
        expect(phrases('太|多|的|太|残忍|的')).toEqual(['太多的', '太残忍的']);
        expect(phrases('没|纠缠')).toEqual(['没纠缠']);
        expect(phrases('放弃|的')).toEqual(['放弃的']);
    });
    it('rule 2: number / determiner + measure word (incl. listed measure words)', () => {
        expect(phrases('三|本|书')).toEqual(['三本', '书']);
        expect(phrases('这|个|猫')).toEqual(['这个', '猫']);
        expect(phrases('三|只|猫')).toEqual(['三只', '猫']);
        expect(phrases('3|个')).toEqual(['3个']);
    });
    it('rule 2: determiner + number, multi-word numbers, any det classifier', () => {
        expect(phrases('这|三|个|猫')).toEqual(['这三个', '猫']);
        expect(phrases('三|十|五|个')).toEqual(['三十五个']);
        expect(phrases('三|头|牛')).toEqual(['三头', '牛']); // 头 lists "classifier" second
    });
    it('rule 3: verb phrase — verb + aspect marker', () => {
        expect(phrases('我|吃|了')).toEqual(['我', '吃了']);
    });
    it('rule 4: pronoun / noun / adjective / verb + 的', () => {
        expect(phrases('我|的|书')).toEqual(['我的', '书']);
        expect(phrases('说|的|天花乱坠')).toEqual(['说的', '天花乱坠']);
    });
    it('rule 5: negation + verb [+ aspect]', () => {
        expect(phrases('不|好')).toEqual(['不好']);
        expect(phrases('不|去|过')).toEqual(['不去过']);
    });
    it('rule 5: negation + verb + 的; a leading adverb; the "never" negators', () => {
        expect(phrases('没|想|的|没|说|的')).toEqual(['没想的', '没说的']);
        expect(phrases('都|没有|绝对')).toEqual(['都没有', '绝对']);
        expect(phrases('都|没|说|的')).toEqual(['都没说的']);
        expect(phrases('从没|去')).toEqual(['从没去']);
        // Nesting: 去想 (serial verb) → 没去想 → 从没去想.
        expect(phrases('去|想')).toEqual(['去想']);
        expect(phrases('没|去|想')).toEqual(['没去想']);
        expect(phrases('从没|去|想')).toEqual(['从没去想']);
        expect(phrases('已经|不|去')).toEqual(['已经不去']); // a time adverb leads too
    });
    it('rule 3: verb phrase — verb + complement [+ aspect]', () => {
        expect(phrases('收|起|吧')).toEqual(['收起', '吧']);
        expect(phrases('吃|完|了')).toEqual(['吃完了']); // resultative, then aspect
    });
    it('rule 9: noun / pronoun + localizer', () => {
        expect(phrases('划|心|上')).toEqual(['划', '心上']);
        expect(phrases('我|这儿')).toEqual(['我这儿']);
    });
    it('a listed function word never stands in for an unprocessed content word', () => {
        // 几 has no part of speech here, but it is a determiner, not a verb: no 几了.
        expect(phrases('几|了')).toEqual(['几', '了']);
    });
    it('rule 7: time / frequency adverb + verb phrase', () => {
        expect(phrases('再|争辩|是非')).toEqual(['再争辩', '是非']); // 争辩 unprocessed
        expect(phrases('再|吃|了')).toEqual(['再吃了']);
        expect(phrases('就|请')).toEqual(['就', '请']); // 就 is not a VERB_ADVERB
    });
    it('rule 8: [scope adverb] pivot verb / preposition + person', () => {
        expect(phrases('请|你')).toEqual(['请你']);
        expect(phrases('帮|我')).toEqual(['帮我']);
        expect(phrases('任|你|肆意')).toEqual(['任你', '肆意']);
        expect(phrases('为|你|跳动')).toEqual(['为你', '跳动']); // preposition + person
        expect(phrases('就|请|你|烧|的')).toEqual(['就请你', '烧的']);
        expect(phrases('都|请|收|起')).toEqual(['都', '请', '收起']); // no pronoun → apart
    });
    it('rule 6: doubled verbs', () => {
        expect(phrases('看|看')).toEqual(['看看']);
        expect(phrases('看|一|看')).toEqual(['看一看']);
    });
    it('never joins across a gap (space / punctuation)', () => {
        expect(phrases('太 多')).toEqual(['太', '多']);
        expect(phrases('我，的')).toEqual(['我', '的']);
    });
    it('covers every word exactly once', () => {
        const { content, spans } = spansOf('我|吃|了|太|多|的|书');
        const out = chunkPhrases(content, spans, DICT);
        expect(out.flatMap((p) => p.words)).toEqual(spans);
    });
});

describe('wordsCoveringRange', () => {
    const { spans } = spansOf('太|多|的|书');
    it('is the words when the range is exactly a run of whole words', () => {
        expect(wordsCoveringRange(spans, 0, 3)?.map((w) => w.text)).toEqual(['太', '多', '的']);
    });
    it('is null for a range that cuts a word or is empty', () => {
        expect(wordsCoveringRange(spans, 1, 1)).toBeNull();
        const { spans: two } = spansOf('漂亮|书');
        expect(wordsCoveringRange(two, 1, 3)).toBeNull();
    });
});

describe('pickPhraseWords — the pick-2 ladder', () => {
    const words = (segmented: string) => spansOf(segmented).spans.map((span) => ({ span, entry: DICT.get(span.text) ?? null }));
    const pick = (segmented: string) => pickPhraseWords(words(segmented)).map((w) => w.span.text);

    it('shows both words of a two-word phrase, particle or not', () => {
        expect(pick('漂亮|的')).toEqual(['漂亮', '的']);
    });
    it('drops the particle first, keeping text order', () => {
        expect(pick('太|多|的')).toEqual(['太', '多']);
    });
    it('particle < numeral < classifier < content word', () => {
        expect(pick('三|本|书')).toEqual(['本', '书']);
    });
    it('a word with no entry ranks below everything', () => {
        expect(pick('三|本|啊')).toEqual(['三', '本']);
    });
    it('ties go to the harder word', () => {
        const hard = [
            { span: { start: 0, end: 1, text: 'A' }, entry: entry('A', ['noun'], 2) },
            { span: { start: 1, end: 2, text: 'B' }, entry: entry('B', ['noun'], 6) },
            { span: { start: 2, end: 3, text: 'C' }, entry: entry('C', ['noun'], 4) },
        ];
        expect(pickPhraseWords(hard).map((w) => w.span.text)).toEqual(['B', 'C']);
    });
});

describe('drillAt — tap inside the selection', () => {
    const { content, spans } = spansOf('太|多|的|中华人民共和国');
    const phraseSpans = [{ start: 0, end: 3, text: '太多的' }, spans[3]];
    const headwords = new Set(['中华人民共和国', '中华', '人民', '共和国', '共和']);
    const drill = (start: number, end: number, offset: number) =>
        drillAt({ content, selection: { start, end }, offset, stepSpans: phraseSpans, wordSpans: spans, isHeadword: (t) => headwords.has(t) });

    it('outside the selection → let the zone step run', () => {
        expect(drill(0, 3, 5)).toEqual({ kind: 'outside' });
    });
    it('phrase → the word under the finger', () => {
        expect(drill(0, 3, 1)).toEqual({ kind: 'narrow', start: 1, end: 2 });
    });
    it('long word → the longest headword covering the tap, then the character', () => {
        // 民 sits at offset 6 (中=3 华=4 人=5 民=6).
        expect(drill(3, 10, 6)).toEqual({ kind: 'narrow', start: 5, end: 7 });
        expect(drill(5, 7, 6)).toEqual({ kind: 'narrow', start: 6, end: 7 });
    });
    it('a single character is the floor: the tap is swallowed, nothing changes', () => {
        expect(drill(6, 7, 6)).toEqual({ kind: 'floor' });
    });
});
