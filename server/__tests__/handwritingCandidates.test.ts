/**
 * normalizeCandidates — the recognizer adapter's candidate cleanup
 * (server/utils/handwritingRecognizer.ts; docs/HANDWRITING_RECOGNITION.md § "Adapter
 * responsibilities"). Inputs are real Google zh_CN responses for perfectly snapped
 * corpus ink, captured 2026-10-28 — each one graded a correct character ✗ before.
 */
import { describe, expect, it } from 'vitest';
import { normalizeCandidates } from '../utils/handwritingRecognizer.js';

describe('normalizeCandidates', () => {
  it('drops non-Han candidates that outrank the character (十 read as "+")', () => {
    expect(normalizeCandidates(['+', '十', 't', 'f', 'T'])[0]).toBe('十');
    expect(normalizeCandidates(['入', 'λ', '八', '人'])).toEqual(['入', '八', '人']);
  });

  it('folds the Japanese 戸 onto simplified 户 and de-duplicates', () => {
    expect(normalizeCandidates(['戸', '户', '戶', '戸户'])).toEqual(['户', '戶', '户户']);
  });

  it('keeps look-alike Han characters distinct (no leniency between 人/入, 土/士)', () => {
    expect(normalizeCandidates(['人', '人人', '八', '入'])[0]).toBe('人');
    expect(normalizeCandidates(['士', '±', '土'])).toEqual(['士', '土']);
  });

  it('ignores non-string entries', () => {
    expect(normalizeCandidates([null, 3, '口'])).toEqual(['口']);
  });
});
