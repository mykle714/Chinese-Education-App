/**
 * § 6z-14: tracing a § 6z-13 display outline into stroke medians
 * (server/scripts/backfill/chinese/lib/outlineMedians.js).
 *
 * Pure: the outline is the committed ⺈ path and the guide is hanzi-writer's 尔 hat,
 * both inlined so the test needs neither the font nor the makemeahanzi cache.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-14.
 */
import { describe, it, expect } from 'vitest';
import { parseOutline, contourCentreline, outlineMedians } from '../scripts/backfill/chinese/lib/outlineMedians.js';

/** COMPONENT_DISPLAY_PATHS['⺈'] as generated 2026-11-15: 尔's hat in Noto Sans SC, font units, y-up. */
const HAT_OUTLINE =
  'M295,841L375,819Q342,738 299,661Q255,583 207,516Q158,448 107,397Q100,404 87,414Q73,423 60,432Q46,441 35,446Q89,493 137,556Q185,619 225,692Q266,765 295,841Z' +
  'M231,666L890,666L890,592L231,592L231,666Z' +
  'M867,666L881,666L894,670L951,649Q926,587 892,523Q858,458 824,415L758,440Q778,467 798,503Q819,538 837,577Q855,616 867,651L867,666Z';

/** hanzi-writer-data 尔, strokes 0–1 (the ⺈ cut): 丿, then 横钩. y-up. */
const HAT_GUIDE: Array<Array<[number, number]>> = [
  [[379, 815], [398, 802], [418, 771], [389, 700], [296, 535], [228, 446], [206, 426]],
  [[329, 535], [377, 540], [452, 563], [671, 608], [709, 610], [742, 595], [755, 566], [646, 474]],
];

describe('parseOutline', () => {
  it('splits a path into one closed polygon per contour, flattening curves', () => {
    const contours = parseOutline(HAT_OUTLINE);
    expect(contours).toHaveLength(3);
    // The rectangle has no curves: its 5 points (closing L included) survive as-is.
    expect(contours[1]).toEqual([[231, 666], [890, 666], [890, 592], [231, 592], [231, 666]]);
  });

  it('rejects relative commands rather than misreading them', () => {
    expect(() => parseOutline('M0,0l10,10Z')).toThrow(/unsupported/);
  });
});

describe('contourCentreline', () => {
  it('runs a bar along its middle, end to end', () => {
    const line = contourCentreline([[0, 0], [400, 0], [400, 60], [0, 60]]);
    const ys = line.map(([, y]) => y);
    const xs = line.map(([x]) => x);
    // Thinning leaves short corner spurs; the longest path may ride one, but only
    // within the bar's half-thickness.
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(60);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(300);
  });
});

describe('outlineMedians', () => {
  it('turns 尔\'s three hat contours into ⺈\'s two strokes, in hanzi-writer order and direction', () => {
    const [pie, barHook] = outlineMedians(HAT_OUTLINE, HAT_GUIDE);
    // 丿 runs from upper right to lower left.
    const [pieStart, pieEnd] = [pie[0], pie[pie.length - 1]];
    expect(pieStart[0]).toBeGreaterThan(pieEnd[0]);
    expect(pieStart[1]).toBeGreaterThan(pieEnd[1]);
    // 横钩 = the bar contour THEN the hook contour: starts at the bar's left end,
    // reaches the bar's right end, and finishes at the hook's foot, below the bar.
    const [hookStart, hookEnd] = [barHook[0], barHook[barHook.length - 1]];
    expect(hookStart[0]).toBeLessThan(300);
    expect(Math.abs(hookStart[1] - 629)).toBeLessThan(40);
    expect(Math.max(...barHook.map(([x]) => x))).toBeGreaterThan(850);
    expect(hookEnd[1]).toBeLessThan(470);
    // The display form's defining proportion: the hook drops BELOW the 丿's foot,
    // where hanzi-writer's 尔 keeps it well above (474 vs 426).
    expect(hookEnd[1]).toBeLessThan(pieEnd[1]);
  });

  it('gives every guide stroke a piece even when two pieces sit nearest the same one (§ 6z-15)', () => {
    // A bar on top and two dots. In the GUIDE the dots are tucked up close under the
    // bar's left end; in the OUTLINE both dots sit low and to the right, so each dot
    // on its own is nearest guide dot 2 and guide dot 1 would get nothing.
    const guide: Array<Array<[number, number]>> = [
      [[0, 1000], [1000, 1000]], // bar
      [[100, 800], [160, 760]], // dot 1, upper left
      [[300, 500], [360, 460]], // dot 2, lower
    ];
    const box = (x: number, y: number, w: number, h: number) =>
      `M${x},${y + h}L${x + w},${y + h}L${x + w},${y}L${x},${y}L${x},${y + h}Z`;
    const outline = box(0, 960, 1000, 80) + box(380, 420, 90, 90) + box(520, 120, 90, 90);
    const [bar, dot1, dot2] = outlineMedians(outline, guide);
    expect(Math.max(...bar.map(([x]) => x)) - Math.min(...bar.map(([x]) => x))).toBeGreaterThan(800);
    // The higher outline dot takes guide dot 1, the lower one guide dot 2.
    expect(Math.min(...dot1.map(([, y]) => y))).toBeGreaterThan(400);
    expect(Math.max(...dot2.map(([, y]) => y))).toBeLessThan(230);
  });

  it('refuses an outline whose contours cannot explain every guide stroke', () => {
    // One contour for a two-stroke guide: some stroke would get no centreline.
    const onlyBar = 'M231,666L890,666L890,592L231,592L231,666Z';
    expect(() => outlineMedians(onlyBar, HAT_GUIDE)).toThrow(/spans several strokes/);
  });
});
