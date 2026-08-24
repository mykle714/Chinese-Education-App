import { describe, expect, it } from 'vitest';
import {
  ddCollisionKey,
  ddt,
  generateShortDefinition,
  resolveSelectedCluster,
  resolveSenseGloss,
  resolveShortDefinition,
  stripParentheses,
} from '../utils/definitions.js';

/**
 * Tests for the definition-resolution pipeline — the code that decides which English
 * text a learner actually sees on a card (docs/DEFINITION_MAPPING.md,
 * docs/DEFINITION_CLUSTERS.md). Every flashcard, dictionary lookup and example-sentence
 * popup goes through these functions, and none of them had a test.
 *
 * `resolveSelectedCluster` in particular is "the ONE sense-pick rule" that the client's
 * `sortedSenseClusters` + `resolveSelectedSenseIndex` must mirror; the ordering and
 * fallback asserted here are that contract.
 *
 * See docs/ARCHITECTURE_REVIEW.md finding 7.
 */

describe('stripParentheses', () => {
  it('removes parenthetical asides anywhere in the string', () => {
    expect(stripParentheses('to run (quickly)')).toBe('to run');
    expect(stripParentheses('(informal) hello')).toBe('hello');
  });

  it('leaves text without parentheses untouched', () => {
    expect(stripParentheses('plain gloss')).toBe('plain gloss');
  });

  it('handles NESTED asides — the 的/加 display bug', () => {
    // The old /\s*\([^)]*\)/g stopped at the FIRST ')', so an aside containing an
    // aside leaked its tail onto the card: 的 rendered '" or 新的[xin1 de5] "new one")'.
    expect(stripParentheses('a waiter (literally, one who runs (fast))')).toBe('a waiter');
    expect(stripParentheses('to box (fight against (a person) in a boxing match)')).toBe('to box');
    expect(stripParentheses('(an aside (nested) still an aside)')).toBe('');
  });

  it('drops an unmatched close paren and swallows an unmatched open paren', () => {
    // Both appear in real det data: 门's `definitions` splits ONE parenthetical
    // across two array elements ('(suffix) -gate (i.e. scandal' + 'derived from
    // Watergate)'), so each half is individually unbalanced.
    expect(stripParentheses('(suffix) -gate (i.e. scandal')).toBe('-gate');
    expect(stripParentheses('derived from Watergate)')).toBe('derived from Watergate');
  });

  it('eats the whitespace before an aside, not the punctuation after it', () => {
    expect(stripParentheses('to go (informal); to leave (a place)')).toBe('to go; to leave');
    expect(stripParentheses('to have to [+de (particle)]')).toBe('to have to [+de]');
    expect(stripParentheses('firstly, ...')).toBe('firstly, ...');
  });

  it('can strip a gloss down to nothing', () => {
    // This is the case resolveSelectedCluster filters on — a wholly parenthetical
    // gloss (e.g. 上来 "(verb complement indicating success)") has no displayable text.
    expect(stripParentheses('(verb complement indicating success)')).toBe('');
  });
});

describe('generateShortDefinition', () => {
  it('returns null for empty input', () => {
    expect(generateShortDefinition([])).toBeNull();
    expect(generateShortDefinition(undefined as unknown as string[])).toBeNull();
  });

  it('picks the shortest candidate sense', () => {
    expect(generateShortDefinition(['to go; to depart; to leave'])).toBe('to go');
  });

  it('splits multi-sense definitions on "; "', () => {
    expect(generateShortDefinition(['a very long gloss indeed; cat'])).toBe('cat');
  });

  it('skips grammatical notes that start with "(" or "CL:"', () => {
    expect(generateShortDefinition(['(a note)', 'CL:個|个', 'book'])).toBe('book');
  });

  it('falls back to the filtered-out tokens when EVERYTHING was a note', () => {
    // Better a grammatical note than no definition at all.
    expect(generateShortDefinition(['CL:個|个'])).toBe('CL:個|个');
  });

  it('strips a trailing parenthetical before measuring length', () => {
    expect(generateShortDefinition(['dog (the animal)'])).toBe('dog');
  });
});

describe('resolveShortDefinition', () => {
  it('prefers an explicit override over the computed value', () => {
    expect(resolveShortDefinition(['to go; to depart'], { definition: 'MANUAL' })).toBe('MANUAL');
  });

  it('computes when the override is absent, null, or has no definition', () => {
    expect(resolveShortDefinition(['to go; to depart'])).toBe('to go');
    expect(resolveShortDefinition(['to go; to depart'], null)).toBe('to go');
    expect(resolveShortDefinition(['to go; to depart'], { pronunciation: 'qù' })).toBe('to go');
  });
});

describe('ddt — the per-cluster display transformation', () => {
  it('is the lead gloss with parentheticals stripped', () => {
    expect(ddt({ glosses: ['to meet (someone)', 'to assemble'] })).toBe('to meet');
  });

  it('is the empty string for a cluster with no glosses', () => {
    expect(ddt({ glosses: [] })).toBe('');
  });
});

describe('resolveSenseGloss', () => {
  const clusters = [
    { sense: 'meeting', glosses: ['a meeting (formal)'] },
    { sense: 'able to', glosses: ['can', 'to be able to'] },
  ];

  it('finds the cluster by LABEL and returns its ddt', () => {
    expect(resolveSenseGloss(clusters, 'able to')).toBe('can');
    expect(resolveSenseGloss(clusters, 'meeting')).toBe('a meeting');
  });

  it('returns null when there is nothing to resolve', () => {
    expect(resolveSenseGloss(clusters, 'no such sense')).toBeNull();
    expect(resolveSenseGloss(clusters, null)).toBeNull();
    expect(resolveSenseGloss(null, 'meeting')).toBeNull();
    expect(resolveSenseGloss(undefined, 'meeting')).toBeNull();
  });
});

describe('resolveSelectedCluster — the ONE sense-pick rule', () => {
  const high = { sense: 'high', glosses: ['common gloss'], frequencyScore: 5 };
  const low = { sense: 'low', glosses: ['rare gloss'], frequencyScore: 1 };

  it('returns null when there is no real choice to make', () => {
    // The same `< 2` gate the client applies — callers use their flat fallback.
    expect(resolveSelectedCluster({ definitionClusters: null })).toBeNull();
    expect(resolveSelectedCluster({ definitionClusters: [high] })).toBeNull();
    expect(resolveSelectedCluster({})).toBeNull();
  });

  it('defaults to the highest-frequency cluster', () => {
    expect(resolveSelectedCluster({ definitionClusters: [low, high] })!.sense).toBe('high');
  });

  it('honours selectedSense when the LABEL matches', () => {
    const picked = resolveSelectedCluster({
      definitionClusters: [low, high],
      selectedSense: 'low',
    });
    expect(picked!.sense).toBe('low');
  });

  it('falls back to the default when the saved label no longer exists', () => {
    // Labels are stable across re-clustering, but a sense CAN disappear.
    const picked = resolveSelectedCluster({
      definitionClusters: [low, high],
      selectedSense: 'a sense that was removed',
    });
    expect(picked!.sense).toBe('high');
  });

  it('sorts nulls last', () => {
    const noScore = { sense: 'unscored', glosses: ['g'], frequencyScore: null };
    expect(resolveSelectedCluster({ definitionClusters: [noScore, low] })!.sense).toBe('low');
  });

  it('drops clusters whose lead gloss is entirely parenthetical', () => {
    // Not offered in the client's picker, so the server must not resolve onto one.
    const hidden = { sense: 'hidden', glosses: ['(verb complement)'], frequencyScore: 9 };
    // With only one displayable cluster left, the `< 2` gate returns null.
    expect(resolveSelectedCluster({ definitionClusters: [hidden, high] })).toBeNull();
    // And it can never be selected explicitly either.
    expect(
      resolveSelectedCluster({ definitionClusters: [hidden, high, low], selectedSense: 'hidden' })!
        .sense
    ).toBe('high');
  });

  it('does not mutate the caller\'s cluster array', () => {
    const clusters = [low, high];
    resolveSelectedCluster({ definitionClusters: clusters });
    expect(clusters[0].sense).toBe('low');
  });
});

/**
 * The games-wide "no two cards may read the same in one round" guard
 * (docs/GAMES_FEATURE.md). What matters is that the key is loose enough to catch what a
 * player would SEE as a duplicate, and strict enough not to merge two glosses they could
 * genuinely tell apart.
 */
describe('ddCollisionKey', () => {
  it('collides two entries whose dd differs only in case or spacing', () => {
    expect(ddCollisionKey({ definition: 'Happy' })).toBe(ddCollisionKey({ definition: 'happy' }));
    expect(ddCollisionKey({ definition: '  measure   word ' })).toBe(
      ddCollisionKey({ definition: 'measure word' })
    );
    expect(ddCollisionKey({ definition: 'happy.' })).toBe(ddCollisionKey({ definition: 'happy' }));
  });

  it('does NOT collide near-synonyms — they are answers a player can tell apart', () => {
    expect(ddCollisionKey({ definition: 'happy' })).not.toBe(ddCollisionKey({ definition: 'glad' }));
  });

  it('resolves through the sense pick, so the key tracks what the card actually shows', () => {
    const entry = {
      definition: 'to pass by',
      definitionClusters: [
        { sense: 'past', glosses: ['the past'], frequencyScore: 5 },
        { sense: 'suffix', glosses: ['to pass by'], frequencyScore: 3 },
      ],
    };
    expect(ddCollisionKey({ ...entry, selectedSense: 'past' })).toBe('the past');
    expect(ddCollisionKey({ ...entry, selectedSense: 'suffix' })).toBe('to pass by');
  });

  it('returns an empty key for a gloss-less entry (callers must treat it as no collision)', () => {
    expect(ddCollisionKey({ definition: null })).toBe('');
    expect(ddCollisionKey({ definition: '   ' })).toBe('');
  });
});
