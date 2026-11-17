import { describe, it, expect } from 'vitest';
import { buildReadAloudClauses, MAX_CLAUSE_CHARS } from '../features/reader/readAloudClauses';
import type { SegmentSpan } from '../features/reader/documentSegmentation';

/**
 * The Reader read-aloud's clause splitter (src/features/reader/readAloudClauses.ts).
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Read aloud".
 */

/** One span per Han character / per Latin word — enough segmentation for these tests. */
function naiveSpans(content: string): SegmentSpan[] {
    const spans: SegmentSpan[] = [];
    for (const m of content.matchAll(/\p{Script=Han}|[A-Za-z0-9.,:]+(?<![.,:])/gu)) {
        spans.push({ start: m.index!, end: m.index! + m[0].length, text: m[0] });
    }
    return spans;
}

function clauseTexts(content: string, from = 0, spans = naiveSpans(content)) {
    return buildReadAloudClauses(content, spans, from, null).map((c) => c.text);
}

describe('buildReadAloudClauses', () => {
    it('splits on CJK commas, sentence ends, colons and semicolons', () => {
        expect(clauseTexts('今天，我们去：公园；好吗？好。')).toEqual(['今天，', '我们去：', '公园；', '好吗？', '好。']);
    });

    it('does not split on 、 —— or …', () => {
        expect(clauseTexts('苹果、香蕉——橘子…好。')).toEqual(['苹果、香蕉——橘子…好。']);
    });

    it('splits on newlines; a run of breaks stays with the clause before it', () => {
        expect(clauseTexts('第一行\n第二行\n\n。。\n第三行')).toEqual(['第一行', '第二行 。。', '第三行']);
    });

    it('skips a clause with no words', () => {
        expect(clauseTexts('“”\n第一行')).toEqual(['第一行']);
    });

    it('keeps closing quotes with the clause they close', () => {
        expect(clauseTexts('他说：“好。”我走了。')).toEqual(['他说：', '“好。”', '我走了。']);
    });

    it('splits ASCII . , : only before whitespace, so numbers stay whole', () => {
        expect(clauseTexts('It is 3.5 or 1,000 at 10:30. Next, go')).toEqual([
            'It is 3.5 or 1,000 at 10:30.', 'Next,', 'go',
        ]);
    });

    it('starts at the caret word, not the start of its clause', () => {
        const content = '今天天气很好，我们去公园。';
        // Caret inside 气 (offset 3).
        expect(clauseTexts(content, 3)).toEqual(['气很好，', '我们去公园。']);
    });

    it('caps clause length at a word boundary', () => {
        const content = '字'.repeat(MAX_CLAUSE_CHARS * 2 + 5);
        const clauses = buildReadAloudClauses(content, naiveSpans(content), 0, null);
        expect(clauses.length).toBe(3);
        for (const c of clauses) expect(c.end - c.start).toBeLessThanOrEqual(MAX_CLAUSE_CHARS);
        expect(clauses.map((c) => c.text).join('')).toBe(content);
    });

    it('spaces word start fractions by syllable weight', () => {
        const content = '我们去公园';
        const spans: SegmentSpan[] = [
            { start: 0, end: 2, text: '我们' },
            { start: 2, end: 3, text: '去' },
            { start: 3, end: 5, text: '公园' },
        ];
        const [clause] = buildReadAloudClauses(content, spans, 0, null);
        expect(clause.spanStartFractions).toEqual([0, 2 / 5, 3 / 5]);
        expect(clause.totalWeight).toBe(5);
    });

    it('builds the pinyin hint only when every Han word has one', () => {
        const content = '我们去。';
        const spans: SegmentSpan[] = [
            { start: 0, end: 2, text: '我们' },
            { start: 2, end: 3, text: '去' },
        ];
        const full = new Map([['我们', 'wǒ men'], ['去', 'qù']]);
        expect(buildReadAloudClauses(content, spans, 0, full)[0].pronunciation).toBe('wǒ men qù');
        const partial = new Map([['我们', 'wǒ men']]);
        expect(buildReadAloudClauses(content, spans, 0, partial)[0].pronunciation).toBeUndefined();
    });

    describe('English voice runs (zh documents)', () => {
        /** Han split per character, Latin/digit stretches as words — like computeSegmentSpans. */
        function zhSpans(content: string): SegmentSpan[] {
            const spans: SegmentSpan[] = [];
            for (const m of content.matchAll(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu)) {
                spans.push({ start: m.index!, end: m.index! + m[0].length, text: m[0] });
            }
            return spans;
        }
        function runs(content: string) {
            return buildReadAloudClauses(content, zhSpans(content), 0, null, true).map((c) => [c.voice, c.text]);
        }

        it('cuts English words into their own run; punctuation stays with the run before', () => {
            expect(runs('我昨天买了 iPhone 15，很好用。')).toEqual([
                ['document', '我昨天买了'], ['english', 'iPhone 15，'], ['document', '很好用。'],
            ]);
        });

        it('keeps numbers after Chinese in the Chinese voice', () => {
            expect(runs('我有3个苹果。')).toEqual([['document', '我有3个苹果。']]);
        });

        it('keeps short letters glued to Han in the Chinese voice', () => {
            expect(runs('他买了T恤，去唱卡拉OK。')).toEqual([['document', '他买了T恤，'], ['document', '去唱卡拉OK。']]);
        });

        it('reads a longer glued English word in English', () => {
            expect(runs('我用iPhone拍照')).toEqual([
                ['document', '我用'], ['english', 'iPhone'], ['document', '拍照'],
            ]);
        });

        it('is off unless asked for, so Latin-script documents are untouched', () => {
            const content = 'Hola amigo, ¿qué tal?';
            const clauses = buildReadAloudClauses(content, zhSpans(content), 0, null);
            expect(clauses.every((c) => c.voice === 'document')).toBe(true);
        });

        it('marks a seam only where two runs meet without punctuation', () => {
            const content = '我昨天买了 iPhone 15，很好用。';
            const clauses = buildReadAloudClauses(content, zhSpans(content), 0, null, true);
            expect(clauses.map((c) => [c.text, c.joinsPrevious, c.joinsNext])).toEqual([
                ['我昨天买了', false, true],
                ['iPhone 15，', true, false],
                ['很好用。', false, false],
            ]);
        });

        it('gives an English run no pinyin hint', () => {
            const content = '我们 email';
            const pron = new Map([['我', 'wǒ'], ['们', 'men']]);
            const clauses = buildReadAloudClauses(content, zhSpans(content), 0, pron, true);
            expect(clauses.map((c) => c.pronunciation)).toEqual(['wǒ men', undefined]);
        });
    });
});
