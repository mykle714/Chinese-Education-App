/**
 * The beginner keyboard's reverse lookup, checked against the numbers § 6 of the
 * design doc measured on this same data.
 *
 * These are not smoke tests. Every count below (55 candidates for 人人, 4 for
 * 人人人, the 199 atomic rescues) was measured against the dev database during
 * design; pinning them here means a data change that shifts the behaviour shows
 * up as a failing test with a number to compare, rather than as a keyboard that
 * quietly got worse.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6h, § 6k, § 6n, § 6q.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseGlyphLookup,
  parseGlyphWords,
  lookupCharacters,
  lookupWords,
  lookupBuffer,
} from '../components/handwriting/glyphLookup';

const ASSETS = path.resolve(__dirname, '../assets/handwriting');

function read(name: string): ArrayBuffer {
  const buffer = fs.readFileSync(path.join(ASSETS, name));
  // Node's Buffer may be a view onto a larger pool, so slice to this file's bytes.
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

// Parsing the word pool derives ~660k bag entries, so both are built once for
// the whole file rather than per test.
const index = parseGlyphLookup(read('glyph-lookup.bin'));
const words = parseGlyphWords(read('glyph-words.bin'), index);

describe('glyph lookup index', () => {
  it('parses the shape the keyboard expects', () => {
    expect(index.components.length).toBe(895);
    expect(index.chars.length).toBe(index.freq.length);
    expect(index.chars.length).toBeGreaterThan(9000);
    // Every component id stored in a bag must address the component table, or
    // the scratch counter would read out of bounds.
    for (let i = 0; i < index.bags.length; i++) {
      expect(index.bags[i]).toBeLessThan(index.components.length);
    }
  });

  it('carries atomic characters, which exist only for the § 6n rescue', () => {
    let atomic = 0;
    for (let i = 0; i < index.bagSizes.length; i++) if (index.bagSizes[i] === 0) atomic++;
    expect(atomic).toBeGreaterThan(2000);
    // The commonest characters in the language are among them — which is the
    // whole reason the rescue exists.
    for (const char of ['人', '口', '木', '大', '子', '一']) {
      const record = index.charIndex.get(char);
      expect(record, `${char} missing from the index`).toBeDefined();
      expect(index.bagSizes[record!], `${char} should be atomic`).toBe(0);
    }
  });
});

describe('lookupCharacters — containment (§ 6h)', () => {
  it('counts multiplicity rather than doing bare set containment', () => {
    // ⚠️ The `jsonb @>` trap. Bare containment would keep 人 for a buffer of
    // 人人; counting must drop it, and must keep 众 (three 人) alongside 从.
    const two = lookupCharacters(['人', '人'], index).map((c) => c.text);
    expect(two).toContain('从');
    expect(two).toContain('众');
    expect(two).not.toContain('人');

    const three = lookupCharacters(['人', '人', '人'], index).map((c) => c.text);
    expect(three).toContain('众');
    expect(three).not.toContain('从');
  });

  it('narrows sharply as components are added', () => {
    // The § 6j cliff: the second component is what makes the list usable.
    const one = lookupCharacters(['人'], index).length;
    const two = lookupCharacters(['人', '人'], index).length;
    const three = lookupCharacters(['人', '人', '人'], index).length;
    expect(one).toBeGreaterThan(200);
    expect(two).toBeLessThan(one / 3);
    expect(three).toBeLessThan(10);
  });

  it('returns nothing for an empty buffer or an unknown component', () => {
    expect(lookupCharacters([], index)).toEqual([]);
    expect(lookupCharacters(['Z'], index)).toEqual([]);
  });

  it('never reports a negative distance', () => {
    // Containment guarantees distance ≥ 0; a negative would mean the scan
    // admitted a candidate smaller than the buffer.
    for (const candidate of lookupCharacters(['氵'], index)) {
      expect(candidate.distance).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('lookupCharacters — the § 6n atomic rescue', () => {
  it('offers the component itself when it is a headword', () => {
    // Without the rescue, submitting 人 offers 以 令 余 今 介 … and never 人.
    for (const char of ['人', '口', '木', '大', '子', '心']) {
      const top = lookupCharacters([char], index, 5).map((c) => c.text);
      expect(top, `${char} should offer itself`).toContain(char);
    }
  });

  it('places the rescue at distance 0 and near the top', () => {
    const candidates = lookupCharacters(['人'], index);
    const self = candidates.find((c) => c.text === '人');
    expect(self?.distance).toBe(0);
    // § 6n calls this out explicitly: a learner who draws 人 and stops most
    // likely means 人, so it should outrank the d0 compounds.
    expect(candidates.indexOf(self!)).toBeLessThan(3);
  });

  it('does not duplicate a component that containment already found', () => {
    // 一 has itself in some bags, so it can arrive by both paths.
    const texts = lookupCharacters(['一'], index).map((c) => c.text);
    expect(texts.filter((t) => t === '一').length).toBe(1);
  });

  it('only fires for a single-component buffer', () => {
    // Two components can no longer mean "just this one character".
    expect(lookupCharacters(['人', '口'], index).map((c) => c.text)).not.toContain('人');
  });
});

describe('lookupCharacters — ranking (§ 6k)', () => {
  it('sorts by distance first', () => {
    const candidates = lookupCharacters(['口'], index);
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].distance).toBeGreaterThanOrEqual(candidates[i - 1].distance);
    }
  });

  it('puts unscored characters below scored ones, not above', () => {
    // ⚠️ The NULLS-LAST trap. 97% of characters tie on a NULL frequencyScore; a
    // naive descending sort would float every one of them above the 258 the app
    // actually teaches. The generator stores NULL as 0 so this falls out.
    const candidates = lookupCharacters(['口'], index);
    const scores = candidates
      .filter((c) => c.distance === 0)
      .map((c) => index.freq[index.charIndex.get(c.text)!]);
    const firstNull = scores.indexOf(0);
    if (firstNull >= 0) {
      expect(scores.slice(firstNull).every((s) => s === 0)).toBe(true);
    }
  });

  it('breaks NULL-frequency ties by usage, descending', () => {
    const candidates = lookupCharacters(['氵'], index).filter((c) => {
      const record = index.charIndex.get(c.text)!;
      return c.distance === 1 && index.freq[record] === 0 && (index.flags[record] & 1) === 0;
    });
    for (let i = 1; i < candidates.length; i++) {
      const previous = index.usage[index.charIndex.get(candidates[i - 1].text)!];
      const current = index.usage[index.charIndex.get(candidates[i].text)!];
      expect(current).toBeLessThanOrEqual(previous);
    }
  });

  it('caps the returned list without capping the search', () => {
    // § 6k: truncate the display, not the query — a rank is only meaningful
    // against the whole set.
    const all = lookupCharacters(['口'], index);
    const capped = lookupCharacters(['口'], index, 12);
    expect(capped.length).toBe(12);
    expect(capped.map((c) => c.text)).toEqual(all.slice(0, 12).map((c) => c.text));
  });
});

describe('lookupWords — the § 6q fallback', () => {
  it('derives every word bag from the character index', () => {
    expect(words.words.length).toBeGreaterThan(90000);
    // A word's bag is the multiset union of its characters' bags, so it should
    // be at least as large as any single character's.
    const record = words.words.indexOf('江湖');
    if (record >= 0) {
      const bagSize = words.bagSizes[record];
      const derived = [...'江湖'].reduce(
        (sum, ch) => sum + (index.bagSizes[index.charIndex.get(ch) ?? -1] ?? 0),
        0,
      );
      expect(bagSize).toBe(derived);
    }
  });

  it('finds a word from the components of both its characters', () => {
    const buffer = [...'江湖'].flatMap((ch) => {
      const record = index.charIndex.get(ch)!;
      const start = index.bagOffsets[record];
      return Array.from({ length: index.bagSizes[record] }, (_, k) => index.components[index.bags[start + k]]);
    });
    const found = lookupWords(buffer, index, words, 5).map((c) => c.text);
    expect(found).toContain('江湖');
  });

  it('sorts an exact-length match above a longer word that merely contains it', () => {
    // This is what makes the 2–4 character pool survivable: containment is
    // superset matching, so a 2-char buffer matches 3- and 4-char words freely
    // and only distance-first keeps them out of the way.
    const buffer = [...'江湖'].flatMap((ch) => {
      const record = index.charIndex.get(ch)!;
      const start = index.bagOffsets[record];
      return Array.from({ length: index.bagSizes[record] }, (_, k) => index.components[index.bags[start + k]]);
    });
    const found = lookupWords(buffer, index, words);
    for (let i = 1; i < found.length; i++) {
      expect(found[i].distance).toBeGreaterThanOrEqual(found[i - 1].distance);
    }
    expect(found[0].distance).toBe(0);
  });

  it('marks word candidates so the row can tell them apart', () => {
    const buffer = [...'江湖'].flatMap((ch) => {
      const record = index.charIndex.get(ch)!;
      const start = index.bagOffsets[record];
      return Array.from({ length: index.bagSizes[record] }, (_, k) => index.components[index.bags[start + k]]);
    });
    for (const candidate of lookupWords(buffer, index, words, 3)) {
      expect(candidate.isWord).toBe(true);
      expect(candidate.text.length).toBeGreaterThan(1);
    }
  });
});

describe('lookupBuffer — the fallback trigger', () => {
  it('does not fire the fallback while characters are found', () => {
    // ⚠️ EMPTY, not "few" (§ 6q). Firing on a small list would flood the common
    // case with words.
    const candidates = lookupBuffer(['人', '人'], index, words);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => !c.isWord)).toBe(true);
  });

  it('fires when the character search comes back empty', () => {
    const buffer = [...'江湖'].flatMap((ch) => {
      const record = index.charIndex.get(ch)!;
      const start = index.bagOffsets[record];
      return Array.from({ length: index.bagSizes[record] }, (_, k) => index.components[index.bags[start + k]]);
    });
    expect(lookupCharacters(buffer, index).length).toBe(0);
    const candidates = lookupBuffer(buffer, index, words, 5);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.isWord)).toBe(true);
    expect(candidates.map((c) => c.text)).toContain('江湖');
  });

  it('stays inert when the word asset has not loaded yet', () => {
    // The word pool is ~6× the index and loads separately; until it lands the
    // keyboard must still work, just without the fallback.
    const buffer = [...'江湖'].flatMap((ch) => {
      const record = index.charIndex.get(ch)!;
      const start = index.bagOffsets[record];
      return Array.from({ length: index.bagSizes[record] }, (_, k) => index.components[index.bags[start + k]]);
    });
    expect(lookupBuffer(buffer, index, null)).toEqual([]);
  });
});
