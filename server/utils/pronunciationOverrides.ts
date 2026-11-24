import { PRONUNCIATION_OVERRIDES_MAX, type PronunciationOverride } from '../contracts/wire.js';

/**
 * READING CHOICES — server-side validation of texts."pronunciationOverrides"
 * (migration 207; docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Reading choices").
 *
 * Pure: no DB, no throwing. TextService turns a `shapeError` into a 400 and stores
 * `overrides`.
 *
 * Two kinds of bad entry, handled differently:
 *   - a MALFORMED entry (not an object, non-integer offsets, a reading that is not numbered
 *     pinyin) → `shapeError`: the client sent something it never builds;
 *   - a STALE entry (its `text` no longer sits at [start, end) of the content) → silently
 *     dropped and counted in `dropped`. This is expected: the server sanitizes content
 *     (CRLF → LF, control chars) after the client shifted its offsets, and an older client
 *     may save content without sending the list at all.
 * Overlapping entries keep the LATER one in the input (the client never sends overlaps).
 *
 * Layer: server utility. Depended on by server/services/TextService.ts → updateText.
 */

// One syllable: letters (ü / v / u: for ü), an optional tone digit 1–5. Space-separated.
const NUMBERED_PINYIN = /^[a-zü:]+[1-5]?( [a-zü:]+[1-5]?)*$/i;
const READING_MAX_LENGTH = 200;

export interface NormalizedOverrides {
  overrides: PronunciationOverride[];
  /** Stale entries removed (text no longer at its offsets). */
  dropped: number;
  /** Set when the input is malformed; `overrides` is then empty and must not be stored. */
  shapeError?: string;
}

export function normalizePronunciationOverrides(input: unknown, content: string): NormalizedOverrides {
  if (!Array.isArray(input)) return { overrides: [], dropped: 0, shapeError: 'pronunciationOverrides must be an array' };
  if (input.length > PRONUNCIATION_OVERRIDES_MAX) {
    return { overrides: [], dropped: 0, shapeError: `Too many reading choices (maximum ${PRONUNCIATION_OVERRIDES_MAX})` };
  }

  const valid: PronunciationOverride[] = [];
  let dropped = 0;
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { overrides: [], dropped: 0, shapeError: 'Invalid reading choice' };
    const { start, end, text, reading } = raw as Record<string, unknown>;
    if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 0 || (end as number) <= (start as number)) {
      return { overrides: [], dropped: 0, shapeError: 'Invalid reading choice offsets' };
    }
    if (typeof text !== 'string' || text.length !== (end as number) - (start as number)) {
      return { overrides: [], dropped: 0, shapeError: 'Invalid reading choice text' };
    }
    if (typeof reading !== 'string' || reading.length > READING_MAX_LENGTH || !NUMBERED_PINYIN.test(reading)) {
      return { overrides: [], dropped: 0, shapeError: 'Invalid reading choice pinyin' };
    }
    // Stale: the word is no longer at these offsets.
    if (content.slice(start as number, end as number) !== text) {
      dropped++;
      continue;
    }
    valid.push({ start: start as number, end: end as number, text, reading: reading.toLowerCase() });
  }

  // Overlaps: walk from the END of the input so the later entry claims its range first.
  const kept: PronunciationOverride[] = [];
  for (let i = valid.length - 1; i >= 0; i--) {
    const candidate = valid[i];
    if (kept.some((k) => k.start < candidate.end && candidate.start < k.end)) {
      dropped++;
      continue;
    }
    kept.push(candidate);
  }
  kept.sort((a, b) => a.start - b.start);
  return { overrides: kept, dropped };
}
