// Tests for the classifier-label split behind GlossText's italics.
// Code: src/utils/definitionUtils.ts → splitClassifierLabel, CLASSIFIER_LABEL.
// Docs: docs/DEFINITION_CLUSTERS.md § "Classifier senses".
import { describe, expect, it } from 'vitest';
import { splitClassifierLabel } from '../utils/definitionUtils';

describe('splitClassifierLabel', () => {
  it('splits the fixed label off a classifier gloss', () => {
    expect(splitClassifierLabel('classifier for books')).toEqual({ label: 'classifier for', rest: ' books' });
  });

  it('keeps the label as written (case) and is case-insensitive in the test', () => {
    expect(splitClassifierLabel('Classifier for books').label).toBe('Classifier for');
  });

  it('leaves a non-classifier gloss whole', () => {
    expect(splitClassifierLabel('to open up')).toEqual({ label: null, rest: 'to open up' });
    // The WORD "classifier" (量词's own sense) is not the label.
    expect(splitClassifierLabel('classifier')).toEqual({ label: null, rest: 'classifier' });
    expect(splitClassifierLabel('classifiers for nouns').label).toBeNull();
  });

  it('with pos, only a sense tagged classifier is split', () => {
    expect(splitClassifierLabel('classifier for books', ['classifier']).label).toBe('classifier for');
    expect(splitClassifierLabel('classifier for books', ['noun']).label).toBeNull();
    // A unit noun Chinese counts directly keeps its plain gloss either way.
    expect(splitClassifierLabel('meter', ['classifier', 'noun']).label).toBeNull();
  });
});
