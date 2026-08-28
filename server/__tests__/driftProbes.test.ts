import { describe, expect, it } from 'vitest';
// @ts-ignore - the manifest is plain JS outside the server tsconfig `include`
import {
  DRIFT_PROBES,
  driftProbesFor,
  isComplete,
  pendingSteps,
  scriptsForLanguage,
} from '../scripts/backfill/shared/lib/requiredScripts.js';

/**
 * The CROSS-ROW drift axis (docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md § sense drift).
 *
 * `when` and `version` are per-row; drift is not. A row can be applicable, unprotected
 * and stamped at the current version — indistinguishable from "done" on both existing
 * axes — while the data it derived its output FROM has since moved. That is how 1143
 * of 8724 stored breakdown senses (2026-08-28 audit) came to point at cluster labels
 * that no longer exist, with nothing in the pipeline able to notice.
 *
 * These tests pin the behavior that catches it: a drifted step is pending and blocks
 * completeness, EXCEPT when a validator has reviewed the field (approval still wins).
 */

const STEP = 'chinese/backfill-breakdown-senses';
const steps = scriptsForLanguage('zh');

/** A multi-char row stamped current on every step — "done" on the old two axes. */
function fullyStampedRow() {
  return {
    word1: '下手',
    definitions: ['to start', "to put one's hand to"],
    partsOfSpeech: ['verb'],
    enrichmentLog: Object.fromEntries(steps.map((s: any) => [s.id, { version: s.version }])),
  };
}

describe('drift probe registry', () => {
  it('every declared driftProbe resolves, and names a step in its own manifest', () => {
    const probes = driftProbesFor(steps);
    expect(probes.length).toBeGreaterThan(0);
    for (const [name, probe] of probes) {
      expect(DRIFT_PROBES[name]).toBe(probe);
      expect(steps.some((s: any) => s.id === probe.step)).toBe(true);
      expect(typeof probe.describe).toBe('string');
    }
  });

  it('throws on a step naming a probe that does not exist', () => {
    expect(() => driftProbesFor([{ id: 'x', when: 'always', version: 1, driftProbe: 'nope' }]))
      .toThrow(/unknown driftProbe/);
  });

  it('es declares no drift probes (dictionaryentries_es has no breakdown column)', () => {
    expect(driftProbesFor(scriptsForLanguage('es'))).toHaveLength(0);
  });

  it('the probe SQL is set-based, not a correlated NOT EXISTS', () => {
    // The correlated form of this probe takes >120s on the zh corpus; the hash-joined
    // form runs in ~30ms. Pin the shape so a "simplification" cannot quietly undo that.
    const sql = DRIFT_PROBES.breakdownSenseOrphan.sql('dictionaryentries_zh');
    expect(sql).toMatch(/LEFT JOIN/);
    expect(sql).not.toMatch(/NOT EXISTS/);
  });
});

describe('pendingSteps / isComplete — the drift axis', () => {
  it('a fully-stamped row is complete when nothing has drifted', () => {
    const row = fullyStampedRow();
    expect(isComplete(row, new Set(), steps)).toBe(true);
    expect(pendingSteps(row, new Set(), steps)).toHaveLength(0);
  });

  it('the SAME row becomes pending once the drift probe names its step', () => {
    const row = fullyStampedRow();
    const drifted = new Set([STEP]);
    expect(isComplete(row, new Set(), steps, drifted)).toBe(false);
    expect(pendingSteps(row, new Set(), steps, drifted).map((s: any) => s.id)).toEqual([STEP]);
  });

  it('drift on a step the row does not apply to changes nothing', () => {
    // breakdown steps are multiChar; a single character has no breakdown to orphan.
    const row = { ...fullyStampedRow(), word1: '手' };
    expect(isComplete(row, new Set(), steps, new Set([STEP]))).toBe(true);
  });

  it('omitting driftedStepIds preserves the exact two-axis behavior', () => {
    // Every existing caller (run-lazy-enrichment, promote-discoverable) passes three
    // arguments; none of them may change behavior because this axis was added.
    const row = fullyStampedRow();
    expect(pendingSteps(row, new Set(), steps)).toEqual(pendingSteps(row, new Set(), steps, new Set()));
    expect(isComplete(row, new Set(), steps)).toBe(isComplete(row, new Set(), steps, new Set()));
  });
});
