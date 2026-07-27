/**
 * Unit tests for scripts/backfill/shared/lib/commaSplit.js — the guard that lets the
 * Spanish definition-processing backfill's split pass choose WHERE to cut a
 * comma-joined synonym run while making it impossible to invent, reword, drop, or
 * reorder text.
 *
 * Pure functions, no DB and no API calls. Run:
 *   node server/scripts/backfill/shared/lib/commaSplit.test.mjs
 *
 * Several cases below are regressions from real model output observed while building
 * the pass; they are labelled as such. See docs/DEFINITION_MAPPING.md.
 */
import {
  splitTopLevelCommas,
  hasSplittableComma,
  isExactPartition,
  applySplits,
} from './commaSplit.js';

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) console.log(`        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`);
  ok ? pass++ : fail++;
};

console.log('\n── splitTopLevelCommas ──');
check('plain synonym run', splitTopLevelCommas('later, afterwards, post'), ['later', 'afterwards', 'post']);
check('comma inside parens is not top level',
  splitTopLevelCommas('to look up (in a search engine, dictionary, etc.)'),
  ['to look up (in a search engine, dictionary, etc.)']);
check('trailing parenthetical stays with its segment',
  splitTopLevelCommas('bitter, sour (having an acrid taste)'),
  ['bitter', 'sour (having an acrid taste)']);
check('bracketed note is not top level',
  splitTopLevelCommas('to intend, to plan [+infinitive (to do something)]'),
  ['to intend', 'to plan [+infinitive (to do something)]']);
check('thousands separator is not a delimiter', splitTopLevelCommas('a sum of 1,000 pesos'), ['a sum of 1,000 pesos']);
check('no comma', splitTopLevelCommas('wall'), ['wall']);

console.log('\n── hasSplittableComma ──');
check('plain gloss', hasSplittableComma('wall'), false);
check('synonym run', hasSplittableComma('later, afterwards'), true);
check('comma only inside parens', hasSplittableComma('to look up (a, b, c)'), false);
check('leading note then a run', hasSplittableComma('(of food) bad, spoiled'), true);
check('leading note, no run', hasSplittableComma('(of food) spoiled'), false);

console.log('\n── isExactPartition ──');
const P = isExactPartition;
check('full single-segment split', P('later, afterwards, post', ['later', 'afterwards', 'post']), true);
check('partial split (contiguous group)', P('later, afterwards, post', ['later', 'afterwards, post']), true);
check('dropped segment rejected', P('later, afterwards, post', ['later', 'post']), false);
check('reordered pieces rejected', P('later, afterwards, post', ['post', 'later, afterwards']), false);
check('invented piece rejected', P('later, afterwards', ['later', 'subsequently']), false);
check('no-op "split" rejected', P('later, afterwards', ['later, afterwards']), false);
check('infinitive re-attached', P('to eat away, corrode', ['to eat away', 'to corrode']), true);
check('infinitive left off is also legal', P('to eat away, corrode', ['to eat away', 'corrode']), true);
check('"to" NOT invented for a noun run', P('way, route', ['way', 'to route']), false);
check('leading note carried onto every piece',
  P('(of food) bad, spoiled, rotten', ['(of food) bad', '(of food) spoiled', '(of food) rotten']), true);
check('leading note dropped is also legal', P('(of food) bad, spoiled', ['bad', 'spoiled']), true);
check('note + infinitive together',
  P('(with ser) to become, come to be', ['(with ser) to become', '(with ser) to come to be']), true);
check('abrir dangling-note partial split',
  P('to break, break open, (new ground, a game, etc.)',
    ['to break', 'to break open, (new ground, a game, etc.)']), true);
check('gustar: trailing [+de] copied BACKWARDS rejected (seen in a real run)',
  P('to like, to enjoy [+de]', ['to like [+de]', 'to enjoy [+de]']), false);
check('gustar: correct split accepted', P('to like, to enjoy [+de]', ['to like', 'to enjoy [+de]']), true);

console.log('\n── applySplits: accepted ──');
const ok1 = applySplits(['later, afterwards, afterward, post', 'next', 'after'],
  [{ from: 'later, afterwards, afterward, post', into: ['later', 'afterwards', 'afterward', 'post'] }]);
check('pieces replace the run in place', ok1.expanded, ['later', 'afterwards', 'afterward', 'post', 'next', 'after']);
check('applied recorded', ok1.applied, [{ from: 'later, afterwards, afterward, post', into: ['later', 'afterwards', 'afterward', 'post'] }]);
check('nothing rejected', ok1.rejected, []);

const ok2 = applySplits(['to eat away, corrode'], [{ from: 'to eat away, corrode', into: ['to eat away', 'to corrode'] }]);
check('infinitive re-attached is accepted', ok2.expanded, ['to eat away', 'to corrode']);

const ok3 = applySplits(['to break, break open, (new ground, a game, etc.)'],
  [{ from: 'to break, break open, (new ground, a game, etc.)', into: ['to break', 'to break open, (new ground, a game, etc.)'] }]);
check('partial split (contiguous group) accepted', ok3.expanded, ['to break', 'to break open, (new ground, a game, etc.)']);

const ok4 = applySplits(['to open, open up', 'to start, open, open up, set up'],
  [{ from: 'to open, open up', into: ['to open', 'to open up'] },
   { from: 'to start, open, open up, set up', into: ['to start', 'to open', 'to open up', 'to set up'] }]);
check('cross-run duplicate pieces collapse to one', ok4.expanded, ['to open', 'to open up', 'to start', 'to set up']);

console.log('\n── applySplits: rejected (gloss stays whole) ──');
const bad1 = applySplits(['later, afterwards'], [{ from: 'later, afterwards', into: ['later', 'subsequently'] }]);
check('invented piece rejected', bad1.expanded, ['later, afterwards']);
check('  …with a reason', bad1.rejected.length, 1);

const bad2 = applySplits(['later, afterwards, post'], [{ from: 'later, afterwards, post', into: ['later', 'post'] }]);
check('NON-contiguous regroup rejected', bad2.expanded, ['later, afterwards, post']);

const bad3 = applySplits(['later, afterwards, post'], [{ from: 'later, afterwards, post', into: ['post', 'later, afterwards'] }]);
check('REORDERED regroup rejected', bad3.expanded, ['later, afterwards, post']);

const bad4 = applySplits(['wall, especially of a house or room'],
  [{ from: 'a gloss that does not exist', into: ['a', 'b'] }]);
check('unknown source gloss rejected', bad4.expanded, ['wall, especially of a house or room']);

const bad5 = applySplits(['a, b'], [{ from: 'a, b', into: ['a'] }]);
check('single-piece "split" rejected', bad5.expanded, ['a, b']);

console.log('\n── applySplits: no-op ──');
const noop = applySplits(['to break the law, rule, order', 'wall'], []);
check('empty splits leaves everything alone', noop.expanded, ['to break the law, rule, order', 'wall']);
check('  …and records no splits', noop.applied, []);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
