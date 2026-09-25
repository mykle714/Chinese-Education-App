/**
 * The beginner keyboard's composition rules, and one end-to-end walk from real
 * ink to a committed character.
 *
 * These run against the COMMITTED assets and ink built from the ORIGINAL
 * hanzi-writer medians, so they exercise the same path a learner does: draw →
 * candidate row → append → lookup → commit. The hook itself is not rendered
 * (the suite has no DOM); its decisions live in compositionRules.ts precisely so
 * they can be checked here.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6n, § 6r, § 6q, § 6z-4.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseGlyphTemplates } from '../components/handwriting/glyphTemplates';
import { matchGlyphs } from '../components/handwriting/glyphMatcher';
import {
  expandGlyph,
  findHintCharacter,
  lookupBuffer,
  parseGlyphLookup,
  parseGlyphWords,
} from '../components/handwriting/glyphLookup';
import {
  activeMode,
  bufferAfterRemove,
  bufferAfterSelect,
  toGlyphCandidates,
  toResultCandidates,
  withHints,
  hintCommit,
  type Candidate,
} from '../features/beginnerKeyboard/compositionRules';
import { CANDIDATE_DISPLAY_LIMIT } from '../features/beginnerKeyboard/useComposition';
import type { Ink } from '../components/handwriting/types';
import { inkFromMedians } from './support/inkFromMedians';

const ASSETS = path.resolve(__dirname, '../assets/handwriting');

function read(name: string): ArrayBuffer {
  const buffer = fs.readFileSync(path.join(ASSETS, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

const templates = parseGlyphTemplates(read('glyph-templates.bin'));
const index = parseGlyphLookup(read('glyph-lookup.bin'));
const words = parseGlyphWords(read('glyph-words.bin'), index);

/** The expander the keyboard injects (§ 6x). */
const expand = (glyph: string) => expandGlyph(glyph, index);

/** The buffer entries one submission of `glyph` contributes (§ 6x expansion). */
function submit(glyph: string): string[] {
  return expand(glyph);
}

/** The row as the keyboard would build it, for whatever is currently active. */
function rowFor(ink: Ink, buffer: string[]): Candidate[] {
  if (ink.length > 0) {
    return toGlyphCandidates(matchGlyphs(ink, templates, { limit: CANDIDATE_DISPLAY_LIMIT }));
  }
  if (buffer.length === 0) return [];
  return toResultCandidates(lookupBuffer(buffer, index, words, CANDIDATE_DISPLAY_LIMIT));
}

describe('what a tap in the glyph row means (§ 6x)', () => {
  it('appends EVERY glyph, whatever its kind', () => {
    // ⚠️ This replaced the old kind-based rule. 尔 is kind=2 (character only) AND
    // discoverable, so every version of "commit if it is a real character" sent
    // 尔 to the text field — which is the bug § 6x exists to fix. There is no
    // predicate that separates "meant as a part" from "meant as a word", because
    // for 尔, 木 and 你 the honest answer is both.
    const row = toGlyphCandidates(matchGlyphs(inkFromMedians('木'), templates, { limit: 20 }));
    expect(row.length).toBeGreaterThan(0);
    expect(row.every((candidate) => candidate.action === 'append')).toBe(true);
  });

  it('offers a whole character it drew, which then returns from the result row', () => {
    // The cost of the uniform rule: one extra tap. The benefit is that it is
    // always the same two taps.
    const row = rowFor(inkFromMedians('想'), []);
    const chip = row.find((candidate) => candidate.text === '想');
    expect(chip?.action).toBe('append');

    const results = rowFor([], submit('想'));
    expect(results[0].text).toBe('想');
    expect(results[0].action).toBe('commit');
  });
});

describe('expansion into the component alphabet (§ 6x)', () => {
  it('translates a glyph the learner sees as one part into the leaves it stands for', () => {
    // The motivating case: nobody decomposes 你 as 亻 ⺈ 小, they see 亻 + 尔.
    expect(expand('尔')).toEqual(['⺈', '小']);
    expect(expand('亻')).toEqual(['亻']);
  });

  it('passes a registered component through untouched', () => {
    // ⚠️ 丁 is BOTH a component (of 打) and a headword decomposing to [一].
    // Expanding it would destroy 打, which is why expansion is conditional.
    expect(index.componentIds.has('丁')).toBe(true);
    expect(expand('丁')).toEqual(['丁']);
  });

  it('gets 亻 + 尔 to 你 at rank 0, which is the whole point', () => {
    const buffer = [...submit('亻'), ...submit('尔')];
    expect(buffer).toEqual(['亻', '⺈', '小']);

    const results = rowFor([], buffer);
    expect(results[0].text).toBe('你');

    // Before expansion this buffer was [亻, 尔] and matched nothing at all.
    expect(lookupBuffer(['亻', '尔'], index, words, 5)).toEqual([]);
  });

  it('reaches the same place whichever granularity the learner draws at', () => {
    const coarse = [...submit('亻'), ...submit('尔')];
    const fine = [...submit('亻'), ...submit('⺈'), ...submit('小')];
    expect([...coarse].sort()).toEqual([...fine].sort());
  });
});

describe('the row is modal (§ 6r)', () => {
  it('shows ink guesses while there is ink, results when there is none', () => {
    expect(activeMode(true)).toBe('glyph');
    expect(activeMode(false)).toBe('result');
  });

  it('never renders empty while there is ink', () => {
    // With no clear button, an empty row strands the learner with ink they
    // cannot remove — submission is the only exit and it needs a target.
    const scribble: Ink = [{ xs: [0, 40, 12, 90], ys: [0, 88, 30, 10], ts: [0, 16, 32, 48] }];
    expect(rowFor(scribble, []).length).toBeGreaterThan(0);
  });

  it('shows nothing only when both the canvas and the buffer are empty', () => {
    expect(rowFor([], [])).toEqual([]);
  });

  it('truncates the display to the row limit', () => {
    expect(rowFor(inkFromMedians('木'), []).length).toBeLessThanOrEqual(CANDIDATE_DISPLAY_LIMIT);
    expect(rowFor([], submit('口')).length).toBe(CANDIDATE_DISPLAY_LIMIT);
  });
});

describe('buffer transitions', () => {
  it('appends on an append tap and empties on a commit tap', () => {
    const append: Candidate = { text: '氵', action: 'append', isWord: false };
    const commit: Candidate = { text: '江', action: 'commit', isWord: false };
    expect(bufferAfterSelect(['工'], append, expand)).toEqual(['工', '氵']);
    // ⚠️ A commit ALWAYS empties the buffer. A leftover component would poison
    // the next character's search invisibly.
    expect(bufferAfterSelect(['工', '氵'], commit, expand)).toEqual([]);
  });

  it('appends a multi-leaf glyph as SEPARATE entries (2026-09-09)', () => {
    // Drawing 尔 used to add one chip standing for two components. It now adds
    // both components, so the buffer and the search list are the same thing.
    const append: Candidate = { text: '尔', action: 'append', isWord: false };
    expect(bufferAfterSelect(['亻'], append, expand)).toEqual(['亻', '⺈', '小']);
  });

  it('removes ONE component, even one the learner never drew directly', () => {
    // The accepted cost of the flat buffer: 尔 contributed ⺈ and 小 as two
    // chips, so a tap takes back half of what was drawn. Recoverable — the row
    // repopulates from whatever is left — rather than a dead end.
    const buffer = [...submit('亻'), ...submit('尔')];
    expect(bufferAfterRemove(buffer, 1)).toEqual(['亻', '小']);
  });

  it('removes by position, so a repeated component drops the right one', () => {
    // 人人 is a real buffer (从, 众), so removal cannot be keyed on the glyph.
    const buffer = ['人', '人', '口'];
    expect(bufferAfterRemove(buffer, 0)).toEqual(['人', '口']);
    expect(bufferAfterRemove(buffer, 2)).toEqual(['人', '人']);
  });
});

describe('end to end — draw, append, commit', () => {
  it('gets from two drawn components to 江', () => {
    let buffer: string[] = [];

    for (const part of ['氵', '工']) {
      const row = rowFor(inkFromMedians(part), buffer);
      const chip = row.find((candidate) => candidate.text === part);
      expect(chip, `${part} should be offered for its own ink`).toBeDefined();
      expect(chip!.action).toBe('append');
      buffer = bufferAfterSelect(buffer, chip!, expand);
    }

    expect(buffer).toEqual(['氵', '工']);

    // Canvas cleared by the submit, so the row is now the result list.
    const results = rowFor([], buffer);
    expect(results[0].text).toBe('江');
    expect(results[0].action).toBe('commit');
    expect(bufferAfterSelect(buffer, results[0], expand)).toEqual([]);
  });

  it('reaches an atomic character via the § 6n rescue', () => {
    // 人 has no components, so containment can never produce it. Drawing it
    // appends 人 to the buffer, and the rescue then offers 人 itself.
    const drawn = rowFor(inkFromMedians('人'), []);
    const chip = drawn.find((candidate) => candidate.text === '人');
    expect(chip?.action).toBe('append');

    const buffer = bufferAfterSelect([], chip!, expand);
    const results = rowFor([], buffer);
    expect(results[0].text).toBe('人');
    expect(results[0].action).toBe('commit');
  });

  it('falls through to a word when no character contains the buffer', () => {
    // A buffer spanning two characters — the learner has no way to say "this one
    // is finished", so this is the reasonable thing that used to look broken.
    // Two whole characters submitted in a row — which expansion now makes the
    // natural way to build this, rather than the hand-rolled bag it used to be.
    const buffer = [...submit('江'), ...submit('湖')];
    const results = rowFor([], buffer);
    expect(results[0].text).toBe('江湖');
    expect(results[0].isWord).toBe(true);
    expect(results[0].action).toBe('commit');
  });
});

describe('§ 6z-4 hint bubbles', () => {
  const findHint = (buffer: readonly string[], glyph: string) => findHintCharacter(buffer, glyph, index);

  it('attaches no hints while the buffer is empty', () => {
    const row = toGlyphCandidates(matchGlyphs(inkFromMedians('疋'), templates, { limit: CANDIDATE_DISPLAY_LIMIT }));
    expect(withHints(row, [], findHint).some((candidate) => candidate.hint)).toBe(false);
  });

  it('walks 日 → draw 疋 → tap the bubble → commit 是, clearing the buffer', () => {
    const buffer = submit('日');
    const row = withHints(
      toGlyphCandidates(matchGlyphs(inkFromMedians('疋'), templates, { limit: CANDIDATE_DISPLAY_LIMIT })),
      buffer,
      findHint,
    );
    const chip = row.find((candidate) => candidate.text === '疋');
    expect(chip, '疋 should be among the glyph guesses for its own ink').toBeDefined();
    expect(chip!.hint?.text).toBe('是');

    // The bubble commits through the same rule as a result chip (§ 6r).
    const commit = hintCommit(chip!.hint!);
    expect(commit).toEqual({ text: '是', action: 'commit', isWord: false });
    expect(bufferAfterSelect(buffer, commit, expand)).toEqual([]);
  });
});
