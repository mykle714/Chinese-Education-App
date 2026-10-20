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
  MASTERY_WORLDS,
  learnNowCollectionWorld,
  masteredCollectionWorld,
} from '../contracts/wire.js';

/**
 * Pins the built-in collection vocabulary — the ids the client may link to and the
 * WHERE fragment each one means (docs/DECKS_FEATURE.md § "Which collections exist").
 *
 * The interesting invariant is the PARTITION: a bar's Learning set and its Mastered
 * set must be exact complements, or a Mastery Center could show a card in neither
 * (or in both) and the two tile counts would stop summing to the library.
 */
describe('built-in collections', () => {
  it('offers a Learning and a Mastered id for every bar', () => {
    for (const world of MASTERY_WORLDS) {
      expect(BUILTIN_COLLECTION_IDS).toContain(LEARN_NOW_COLLECTION_IDS[world]);
      expect(BUILTIN_COLLECTION_IDS).toContain(MASTERED_COLLECTION_IDS[world]);
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
    for (const world of MASTERY_WORLDS) {
      expect(learnNowCollectionWorld(LEARN_NOW_COLLECTION_IDS[world])).toBe(world);
      expect(masteredCollectionWorld(MASTERED_COLLECTION_IDS[world])).toBe(world);
      // A Learning id must not read as a Mastered one — the clause builder tries
      // Mastered first, so a collision would silently invert the set.
      expect(masteredCollectionWorld(LEARN_NOW_COLLECTION_IDS[world])).toBeNull();
      expect(learnNowCollectionWorld(MASTERED_COLLECTION_IDS[world])).toBeNull();
    }
    // Null means "unrestricted" at every call site, so an unknown value must not
    // resolve to a bar.
    expect(learnNowCollectionWorld('nonsense')).toBeNull();
    expect(parseBuiltinCollectionId('nonsense')).toBeNull();
  });

  it("makes each bar's Learning set the exact complement of its Mastered set", () => {
    for (const world of MASTERY_WORLDS) {
      expect(builtinCollectionClause(LEARN_NOW_COLLECTION_IDS[world])).toBe(unmasteredBarClause(world));
      expect(builtinCollectionClause(MASTERED_COLLECTION_IDS[world])).toBe(masteredBarClause(world));
      // Same expression, opposite comparison — nothing else differs.
      expect(unmasteredBarClause(world).replace("<> 'Mastered'", "= 'Mastered'"))
        .toBe(masteredBarClause(world));
    }
  });

  it("narrows nothing for `all`", () => {
    // Spliced into an `AND …` position unconditionally, so it must be a valid TRUE.
    expect(builtinCollectionClause('all')).toBe('TRUE');
  });
});
