import { describe, it, expect } from 'vitest';
import { splitSentences, sentenceRangeAt } from '../reading/readerSentences';

/**
 * The Reader's sentence splitter (src/reading/readerSentences.ts) — what the
 * second-tier long-press / desktop double-click highlights.
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sentence Explain".
 */

const texts = (content: string) => splitSentences(content).map((r) => content.slice(r.start, r.end));

describe('splitSentences', () => {
    it('breaks on full-width end marks and keeps the mark with its sentence', () => {
        expect(texts('我很好。你呢？太好了！')).toEqual(['我很好。', '你呢？', '太好了！']);
    });

    it('does not break on commas, colons, semicolons, the enumeration comma or ellipses', () => {
        expect(texts('苹果、香蕉，还有橘子；他说：好……我们走吧。')).toEqual(['苹果、香蕉，还有橘子；他说：好……我们走吧。']);
    });

    it('keeps closing quotes and stacked end marks with the sentence they end', () => {
        expect(texts('他说：“真的吗？！”然后走了。')).toEqual(['他说：“真的吗？！”', '然后走了。']);
    });

    it('treats a newline as a sentence end and drops blank lines', () => {
        expect(texts('标题\n\n第一句。第二句')).toEqual(['标题', '第一句。', '第二句']);
    });

    it('breaks on an ASCII period only before whitespace, a closer or the end', () => {
        expect(texts('I paid 3.5 yuan. Then I left.')).toEqual(['I paid 3.5 yuan.', 'Then I left.']);
    });

    it('trims surrounding whitespace from each sentence', () => {
        const content = '  你好。  再见。 ';
        const ranges = splitSentences(content);
        expect(ranges.map((r) => content.slice(r.start, r.end))).toEqual(['你好。', '再见。']);
    });
});

describe('sentenceRangeAt', () => {
    const content = '我很好。你呢？';

    it('returns the sentence containing the offset, end mark included', () => {
        expect(sentenceRangeAt(content, 1)).toEqual({ start: 0, end: 4 });
        expect(sentenceRangeAt(content, 3)).toEqual({ start: 0, end: 4 });
        expect(sentenceRangeAt(content, 4)).toEqual({ start: 4, end: 7 });
    });

    it('returns null between sentences and outside the text', () => {
        expect(sentenceRangeAt('你好。 再见。', 3)).toBeNull();
        expect(sentenceRangeAt(content, -1)).toBeNull();
        expect(sentenceRangeAt(content, content.length)).toBeNull();
    });
});
