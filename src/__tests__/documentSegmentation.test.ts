import { describe, it, expect } from 'vitest';
import { computeSegmentSpans, segmentWithDict } from '../reading/documentSegmentation';

// Covers the Reader gsa's tiebreak alternatives + forced spans
// (docs/READER_SEGMENTATION.md § "Tiebreak alternatives").

type Scores = Record<string, number | null>;
const dict = (scores: Scores) =>
    new Map(Object.entries(scores).map(([word, frequencyScore]) => [word, { frequencyScore }]));

const words = (spans: { text: string }[]) => spans.map((s) => s.text);

describe('gsa tiebreak alternatives', () => {
    // The motivating case: 没治 (score 3) beats the unscored 治愈 (null → 0).
    const map = dict({ 都: 5, 怪: 4, 我: 5, 没: 5, 治: 4, 愈: null, 的: 5, 伤: 4, 没治: 3, 治愈: null, 我的: 2 });
    const content = '都怪我没治愈我的伤';

    it('keeps the scoring unchanged', () => {
        expect(segmentWithDict(content, map)).toEqual(['都', '怪', '我', '没治', '愈', '我的', '伤']);
    });

    it('records the overlapping same-length loser on the winner', () => {
        const spans = computeSegmentSpans(content, map);
        const meizhi = spans.find((s) => s.text === '没治')!;
        expect(meizhi.alternatives).toEqual([{ start: 4, end: 6, text: '治愈' }]);
        // Non-overlapping same-tier words are not losers.
        expect(spans.find((s) => s.text === '我的')!.alternatives).toBeUndefined();
    });

    it('re-segments around a forced span and offers the switch back', () => {
        const spans = computeSegmentSpans(content, map, undefined, [{ start: 4, end: 6, text: '治愈' }]);
        expect(words(spans)).toEqual(['都', '怪', '我', '没', '治愈', '我的', '伤']);
        expect(spans.find((s) => s.text === '治愈')!.alternatives).toEqual([{ start: 3, end: 5, text: '没治' }]);
    });

    it('ignores a stale forced span', () => {
        const spans = computeSegmentSpans(content, map, undefined, [{ start: 4, end: 6, text: '别的' }]);
        expect(words(spans)).toEqual(['都', '怪', '我', '没治', '愈', '我的', '伤']);
    });

    it('records one loser per side in a chain', () => {
        // AB | BC | CD with BC the winner → AB and CD both lose.
        const chain = dict({ 甲乙: 1, 乙丙: 3, 丙丁: 2 });
        const spans = computeSegmentSpans('甲乙丙丁', chain);
        expect(words(spans)).toEqual(['甲', '乙丙', '丁']);
        expect(spans[1].alternatives).toEqual([
            { start: 0, end: 2, text: '甲乙' },
            { start: 2, end: 4, text: '丙丁' },
        ]);
    });
});
