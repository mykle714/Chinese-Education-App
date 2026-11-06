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

  it('falls back to the plain dd for a single-sense word', () => {
    const view = resolveSearchRowView({
      pronunciation: 'piàoliang',
      definitions: ['beautiful (lit.)', 'pretty'],
      definitionClusters: [cluster('beautiful', 5, ['beautiful', 'pretty'])],
    });
    expect(view.definitions).toEqual(['beautiful']);
  });

  it('falls back to the plain dd for an unclustered word', () => {
    expect(resolveSearchRowView({ pronunciation: null, definitions: ['to go'], definitionClusters: null }).definitions)
      .toEqual(['to go']);
  });

  it('joins into the row line', () => {
    expect(joinDefinitionList(resolveSearchRowView(xing).definitions)).toBe(`to walk${DEFINITION_LIST_SEPARATOR}row`);
  });
});
