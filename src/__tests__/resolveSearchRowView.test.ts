import { describe, expect, it } from 'vitest';
import type { DefinitionCluster } from '../types';
import { joinDefinitionList, resolveSearchRowView, DEFINITION_LIST_SEPARATOR } from '../utils/definitionUtils';

// The dictionary row's list must stay the eip's sense list (EipSenseList → buildSenseSegments).
// Docs: docs/SHELF_REDESIGN.md § 7b.
const cluster = (sense: string, frequencyScore: number, glosses: string[], reading: string | null = null) =>
  ({ sense, reading, pos: null, frequencyScore, glosses }) as DefinitionCluster;

const xing = {
  pronunciation: 'xíng',
  definitions: ['to walk', 'to go', 'row', 'line'],
  definitionClusters: [
    cluster('row / line', 2, ['row', 'line'], 'hang2'),
    cluster('to walk / go', 5, ['to walk', 'to go'], 'xing2'),
  ],
};

describe('resolveSearchRowView', () => {
  it('lists each sense first gloss in sorted order, not the flat definitions', () => {
    expect(resolveSearchRowView(xing).definitions).toEqual(['to walk', 'row']);
  });

  it('moves the matched sense to the front', () => {
    expect(resolveSearchRowView({ ...xing, matchedSense: 'row / line' }).definitions).toEqual(['row', 'to walk']);
  });

  it('lists every gloss of the one sense for a single-sense word, dd first', () => {
    const view = resolveSearchRowView({
      pronunciation: 'wǒ',
      definitions: ['I', 'me', 'my'],
      definitionClusters: [cluster('I, me', 5, ['I', 'me', 'my'])],
    });
    expect(view.definitions).toEqual(['I', 'me', 'my']);
  });

  it('reads the lone cluster, not the flat definitions, and collapses stripped duplicates', () => {
    const view = resolveSearchRowView({
      pronunciation: 'piàoliang',
      definitions: ['stale flat list'],
      definitionClusters: [cluster('beautiful', 5, ['beautiful (lit.)', 'beautiful', 'pretty'])],
    });
    expect(view.definitions).toEqual(['beautiful', 'pretty']);
  });

  it('lists every flat gloss for an unclustered word', () => {
    expect(resolveSearchRowView({ pronunciation: null, definitions: ['to go', 'to leave (sth)'], definitionClusters: null }).definitions)
      .toEqual(['to go', 'to leave']);
  });

  it('a matched lone sense keeps its full list', () => {
    const view = resolveSearchRowView({
      pronunciation: 'wǒ',
      definitions: ['I', 'me'],
      definitionClusters: [cluster('I, me', 5, ['I', 'me'])],
      matchedSense: 'I, me',
    });
    expect(view.definitions).toEqual(['I', 'me']);
  });

  it('joins into the row line', () => {
    expect(joinDefinitionList(resolveSearchRowView(xing).definitions)).toBe(`to walk${DEFINITION_LIST_SEPARATOR}row`);
  });
});
