import { describe, expect, it } from 'vitest';
import {
  BUILTIN_COLLECTION_IDS,
  builtinCollectionClause,
  masteredBarClause,
  parseBuiltinCollectionId,
  unmasteredBarClause,
} from '../dal/shared/vetTable.js';
import {
  LEARN_NOW_COLLECTION_IDS,
  MASTERED_COLLECTION_IDS,
  MASTERY_BARS,
  learnNowCollectionBar,
  masteredCollectionBar,
} from '../contracts/wire.js';

/**
 * Pins the built-in collection vocabulary — the ids the client may link to and the
 * WHERE fragment each one means (docs/DECKS_FEATURE.md § "Which collections exist").
 *
 * The interesting invariant is the PARTITION: a bar's Learn Now set and its Mastered
 * set must be exact complements, or a Mastery Center could show a card in neither
 * (or in both) and the two tile counts would stop summing to the library.
 */
describe('built-in collections', () => {
  it('offers a Learn Now and a Mastered id for every bar', () => {
    for (const bar of MASTERY_BARS) {
      expect(BUILTIN_COLLECTION_IDS).toContain(LEARN_NOW_COLLECTION_IDS[bar]);
      expect(BUILTIN_COLLECTION_IDS).toContain(MASTERED_COLLECTION_IDS[bar]);
    }
    // Plus `all`, which is bar-independent: 3 + 3 + 1.
    expect(BUILTIN_COLLECTION_IDS).toHaveLength(7);
    expect(new Set(BUILTIN_COLLECTION_IDS).size).toBe(BUILTIN_COLLECTION_IDS.length);
  });

  it('keeps the core bar on its original unqualified ids', () => {
    // Existing links, bookmarks and in-flight clients still resolve to the same sets.
    expect(LEARN_NOW_COLLECTION_IDS.core).toBe('learn-now');
    expect(MASTERED_COLLECTION_IDS.core).toBe('mastered');
  });

  it('maps each id back to exactly one bar, and never to the other family', () => {
    for (const bar of MASTERY_BARS) {
      expect(learnNowCollectionBar(LEARN_NOW_COLLECTION_IDS[bar])).toBe(bar);
      expect(masteredCollectionBar(MASTERED_COLLECTION_IDS[bar])).toBe(bar);
      // A Learn Now id must not read as a Mastered one — the clause builder tries
      // Mastered first, so a collision would silently invert the set.
      expect(masteredCollectionBar(LEARN_NOW_COLLECTION_IDS[bar])).toBeNull();
      expect(learnNowCollectionBar(MASTERED_COLLECTION_IDS[bar])).toBeNull();
    }
    // Null means "unrestricted" at every call site, so an unknown value must not
    // resolve to a bar.
    expect(learnNowCollectionBar('nonsense')).toBeNull();
    expect(parseBuiltinCollectionId('nonsense')).toBeNull();
  });

  it('makes each bar Learn Now the exact complement of its Mastered set', () => {
    for (const bar of MASTERY_BARS) {
      expect(builtinCollectionClause(LEARN_NOW_COLLECTION_IDS[bar])).toBe(unmasteredBarClause(bar));
      expect(builtinCollectionClause(MASTERED_COLLECTION_IDS[bar])).toBe(masteredBarClause(bar));
      // Same expression, opposite comparison — nothing else differs.
      expect(unmasteredBarClause(bar).replace("<> 'Mastered'", "= 'Mastered'"))
        .toBe(masteredBarClause(bar));
    }
  });

  it("narrows nothing for `all`", () => {
    // Spliced into an `AND …` position unconditionally, so it must be a valid TRUE.
    expect(builtinCollectionClause('all')).toBe('TRUE');
  });
});
