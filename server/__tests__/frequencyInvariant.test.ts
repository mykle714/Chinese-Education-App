/**
 * Unit tests for the word/cluster FREQUENCY INVARIANT:
 *   det."frequencyScore" == MAX(definitionClusters[*].frequencyScore)
 *
 * Covers scripts/backfill/shared/lib/senseClusters.js → reconcileFrequencyScore,
 * the single implementation shared by the repair pass
 * (scripts/backfill/shared/repair-frequency-score-drift.js) and by the two cluster
 * backfills that enforce the invariant at write time.
 * Documented in docs/DEFINITION_CLUSTERS.md.
 */
import { describe, it, expect } from 'vitest';
// Imported WITHOUT the `.js` extension on purpose: vitest.config.ts aliases every
// relative `*.js` specifier onto `*.ts` (for the server's NodeNext imports), which
// would misdirect this one — senseClusters really is a `.js` file on disk.
// @ts-expect-error — plain-JS backfill lib, no type declarations
import { reconcileFrequencyScore, defaultClusterIndex } from '../scripts/backfill/shared/lib/senseClusters';

const c = (sense: string, frequencyScore: number | null, glosses = [sense]) => ({
  sense, frequencyScore, glosses,
});

describe('reconcileFrequencyScore', () => {
  it('leaves an already-consistent entry untouched', () => {
    const clusters = [c('a', 3), c('b', 2)];
    const r = reconcileFrequencyScore(3, clusters);
    expect(r.wordChanged).toBe(false);
    expect(r.clustersChanged).toBe(false);
    expect(r.clusters).toBe(clusters); // same reference — no needless write
  });

  it('raises the word score to the best sense (讨论: word 3, only sense 5)', () => {
    const r = reconcileFrequencyScore(3, [c('to discuss', 5)]);
    expect(r.wordScore).toBe(5);
    expect(r.wordChanged).toBe(true);
    expect(r.clustersChanged).toBe(false);
  });

  it('raises the DEFAULT sense when the word score is higher (老公: word 5, senses 3/1)', () => {
    const r = reconcileFrequencyScore(5, [c('husband', 3), c('eunuch', 1)]);
    expect(r.wordScore).toBe(5);
    expect(r.clusters.map((x: any) => x.frequencyScore)).toEqual([5, 1]);
    expect(r.raisedSense).toBe('husband');
  });

  it('never reorders the cluster array (array order is the default-sense tie-break)', () => {
    const r = reconcileFrequencyScore(4, [c('low', 1), c('high', 3)]);
    expect(r.clusters.map((x: any) => x.sense)).toEqual(['low', 'high']);
    expect(r.clusters.map((x: any) => x.frequencyScore)).toEqual([1, 4]);
  });

  it('lifts a displayable sense, never a parenthetical-only one', () => {
    const clusters = [c('marker', 2, ['(marks a change of state)']), c('and', 2)];
    const r = reconcileFrequencyScore(4, clusters);
    expect(r.raisedSense).toBe('and');
    expect(r.clusters.map((x: any) => x.frequencyScore)).toEqual([2, 4]);
  });

  it('only ever raises — a low sense is never pushed down to match the word', () => {
    const r = reconcileFrequencyScore(2, [c('common', 5), c('rare', 1)]);
    expect(r.wordScore).toBe(5);
    expect(r.clusters.map((x: any) => x.frequencyScore)).toEqual([5, 1]);
  });

  it('leaves one-sided nulls alone for the owning backfill to fill', () => {
    expect(reconcileFrequencyScore(null, [c('a', 3)]).wordChanged).toBe(false);
    expect(reconcileFrequencyScore(3, [c('a', null)]).wordChanged).toBe(false);
  });

  it('is a no-op on an unclustered entry', () => {
    expect(reconcileFrequencyScore(3, null).wordChanged).toBe(false);
    expect(reconcileFrequencyScore(3, []).wordChanged).toBe(false);
  });

  it('does not mutate its input', () => {
    const clusters = [c('a', 2)];
    reconcileFrequencyScore(5, clusters);
    expect(clusters[0].frequencyScore).toBe(2);
  });
});

describe('defaultClusterIndex', () => {
  it('picks the highest score, ties keeping array order (自: 3 / 3 / 2)', () => {
    expect(defaultClusterIndex([c('oneself; self', 3), c('from; since', 3), c('naturally', 2)])).toBe(0);
  });

  it('prefers a displayable cluster over a higher-scoring parenthetical-only one', () => {
    expect(defaultClusterIndex([c('marker', 5, ['(grammatical particle)']), c('and', 2)])).toBe(1);
  });

  it('returns -1 for an empty list', () => {
    expect(defaultClusterIndex([])).toBe(-1);
  });
});
