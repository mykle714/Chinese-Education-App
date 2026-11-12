/**
 * Unit tests for the sense-label repair helpers:
 *   - ./sentenceSenseOrphans.js → deterministicRemap, findOrphanedSenseTags, replaceSenseLabel
 *   - ./senseCarryForward.js    → buildSenseRenameMap
 *
 * Pure functions, no DB and no API calls. Run:
 *   node server/scripts/backfill/chinese/lib/senseLabels.test.mjs
 *
 * Cases marked "regression" come from the 2026-11-11 PPE audit of orphaned labels.
 * See docs/EXAMPLE_SENTENCES.md § "Stale sense labels".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicRemap, findOrphanedSenseTags, replaceSenseLabel } from './sentenceSenseOrphans.js';
import { buildSenseRenameMap } from './senseCarryForward.js';

const di = [
  { sense: 'the ground, soil', glosses: ['ground', 'earth'], reading: 'di4' },
  { sense: 'adverbial particle (-ly)', glosses: ['-ly', 'structural particle'], reading: 'de' },
  { sense: 'land, place', glosses: ['land', 'place', 'field'], reading: 'di4' },
];

test('deterministicRemap: same sense after dropping parentheticals (regression: 地)', () => {
  assert.equal(deterministicRemap('adverbial particle', di), 'adverbial particle (-ly)');
});

test('deterministicRemap: broadened cluster ("this" → "this / these")', () => {
  const zhe = [{ sense: 'this / these' }, { sense: 'these (before a classifier)' }];
  assert.equal(deterministicRemap('this', zhe), 'this / these');
});

test('deterministicRemap: a stale label spanning a SPLIT is left for the model (regression: 了)', () => {
  const le = [{ sense: 'completed-action particle' }, { sense: 'change-of-state particle' }, { sense: 'to understand' }];
  assert.equal(deterministicRemap('completed-action / change-of-state particle', le), null);
});

test('deterministicRemap: no substring matching on short labels (regression: 多 "more")', () => {
  // 多's clusters had no plain "more" sense; the old substring rule matched "and MORE".
  const duo = [{ sense: 'many / much' }, { sense: 'and more / -plus (after a number)' }];
  assert.equal(deterministicRemap('more', duo), null);
});

test('deterministicRemap: two equal candidates → ambiguous', () => {
  assert.equal(deterministicRemap('kind', [{ sense: 'kind (type)' }, { sense: 'kind (classifier)' }]), null);
});

test('findOrphanedSenseTags: dict + occurrence sources; unclustered segments are not orphans', () => {
  const clusters = { 地: di, 我: [{ sense: 'I, me' }] };
  const s = {
    segments: ['我', '慢慢', '地', '走', '地'],
    senseDict: { 我: 'I, me', 地: 'adverbial particle', 走: 'to walk (old)' },
    segmentOccurrenceTags: { 4: { sense: 'ground' } },
  };
  const out = findOrphanedSenseTags(s, (seg) => clusters[seg]);
  assert.deepEqual(out, [
    { seg: '地', label: 'adverbial particle', source: 'senseDict' },
    { seg: '地', label: 'ground', source: 'occurrence', index: 4 },
  ]);
});

test('replaceSenseLabel: skips a tag a concurrent writer already changed; null deletes', () => {
  const s = { segments: ['地'], senseDict: { 地: 'something newer' }, segmentOccurrenceTags: { 0: { sense: 'old' } } };
  assert.equal(replaceSenseLabel(s, { seg: '地', label: 'old', source: 'senseDict' }, 'x', null), 0);
  assert.equal(replaceSenseLabel(s, { seg: '地', label: 'old', source: 'occurrence', index: 0 }, null, null), 1);
  assert.equal('sense' in s.segmentOccurrenceTags[0], false);
});

test('replaceSenseLabel: keeps the headword generation sense in step', () => {
  const s = { sense: 'old', senseDict: { 地: 'old' } };
  replaceSenseLabel(s, { seg: '地', label: 'old', source: 'senseDict' }, 'new', '地');
  assert.equal(s.sense, 'new');
});

test('buildSenseRenameMap: glosses moved wholesale → rename; scattered → split', () => {
  const oldC = [
    { sense: 'adverbial particle', glosses: ['-ly', 'structural particle'] },
    { sense: 'ground, land, earth', glosses: ['ground', 'earth', 'land'] }, // now spread over two
    { sense: 'the ground, soil', glosses: ['ground', 'earth'] },              // unchanged label
  ];
  const { renames, splits } = buildSenseRenameMap(oldC, di);
  assert.deepEqual([...renames], [['adverbial particle', 'adverbial particle (-ly)']]);
  assert.deepEqual(splits, ['ground, land, earth']);
});

test('buildSenseRenameMap: glosses all rewritten → falls back to the label-text rule', () => {
  const { renames } = buildSenseRenameMap([{ sense: 'adverbial particle', glosses: ['zzz'] }], di);
  assert.equal(renames.get('adverbial particle'), 'adverbial particle (-ly)');
});

test('buildSenseRenameMap: merge of two old senses into one new', () => {
  const oldC = [{ sense: 'to live', glosses: ['to live'] }, { sense: 'to reside', glosses: ['to reside'] }];
  const newC = [{ sense: 'to live / reside', glosses: ['to live', 'to reside'] }];
  const { renames, splits } = buildSenseRenameMap(oldC, newC);
  assert.equal(renames.get('to live'), 'to live / reside');
  assert.equal(renames.get('to reside'), 'to live / reside');
  assert.deepEqual(splits, []);
});

test('buildSenseRenameMap: first-time clustering (no old clusters) is a no-op', () => {
  assert.equal(buildSenseRenameMap(null, di).renames.size, 0);
});
