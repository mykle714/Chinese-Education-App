/**
 * Router latency probe (docs/IMMERSIVE_WORLD.md § 4.2).
 *
 *   npx tsx scripts/iw-route-probe.js
 *
 * Runs the § 4.2 addressee router against the real cast with the deadlines disabled, so the
 * numbers it prints are what the call ACTUALLY takes rather than what the deadline allows.
 * That distinction cost an evening: `ROUTE_FIRST_GLYPH_DEADLINE_MS` was first set to 600 ms
 * from a guess, which is below Haiku's measured first glyph (792–970 ms, § 5.2), so nearly
 * every route timed out and fell back to the rules — silently, because falling back is a
 * working scene. **Set a deadline from this script, never from a guess.**
 */
import 'dotenv/config';
import { routeAddressee } from '../services/iw/addresseeRouter.js';
import { getIwLadder } from '../services/iw/modelLadder.js';

const cast = [
  { npcId: 'wang_shen', distance: 1, focused: true, facedByLearner: true, facingLearner: true },
  { npcId: 'he_laoshi', distance: 9 },
  { npcId: 'michael', distance: 2 },
];

/**
 * Geometry probes — no name, no role, nothing in the words. The ONLY thing that can decide
 * these is where the avatar is standing and which way it is pointing, so they are the cases
 * that tell you whether the facing hints are doing any work at all. Each carries its own cast.
 */
const GEOMETRY = [
  ['你好', 'he_laoshi', 'faced at 4 beats unfaced at 1', [
    { npcId: 'wang_shen', distance: 1 },
    { npcId: 'he_laoshi', distance: 4, facedByLearner: true, facingLearner: true },
  ]],
  ['你好', 'michael', 'same distance, only one is faced', [
    { npcId: 'wang_shen', distance: 1 },
    { npcId: 'michael', distance: 1, facedByLearner: true },
  ]],
  ['多少钱？', 'wang_shen', 'nobody faced — nearest wins', [
    { npcId: 'wang_shen', distance: 1 },
    { npcId: 'he_laoshi', distance: 7 },
  ]],
  // Distance does NOT override facing, even at eleven tiles: earshot is gone (§ 4), so
  // everybody in the scene hears everything, and turning to face somebody is a choice.
  ['你好', 'he_laoshi', 'faced across the room still beats adjacent', [
    { npcId: 'wang_shen', distance: 1 },
    { npcId: 'he_laoshi', distance: 11, facedByLearner: true },
  ]],
  // ⚠️ THE COMPANION CASE — the one that showed step 1 and step 2 were bleeding into each
  // other. The learner walks to a table, faces the person they came in with, and calls the
  // waitress. Every position hint points at the companion and the only word in the sentence
  // points at somebody else. Before the reply carried a step label, the hints won.
  ['服务员！', 'wang_shen', 'a role, while faced at and sitting beside a companion', [
    { npcId: 'michael', distance: 1, facedByLearner: true, facingLearner: true, focused: true },
    { npcId: 'wang_shen', distance: 5 },
  ]],
  ['你觉得呢？', 'michael', 'no role word — the same cast routes to the companion', [
    { npcId: 'michael', distance: 1, facedByLearner: true, facingLearner: true, focused: true },
    { npcId: 'wang_shen', distance: 5 },
  ]],
  ['何老师，你好', 'he_laoshi', 'a name beats the facing entirely', [
    { npcId: 'wang_shen', distance: 1, facedByLearner: true, facingLearner: true },
    { npcId: 'he_laoshi', distance: 11 },
  ]],
];
const CASES = [
  ['老师，这个字怎么念？', 'he_laoshi', 'title, across the room'],
  ['服务员，买单！', 'wang_shen', 'role'],
  ['老板，来一碗面', 'wang_shen', 'trade'],
  ['你好', 'wang_shen', 'neutral — follows the tap'],
  ['卖面的，多少钱？', 'wang_shen', 'described by what they sell'],
  ['迈克尔，你觉得呢？', 'michael', 'name'],
];

const rungs = getIwLadder(() => {});
const times = [];
let right = 0;
let total = 0;

async function probe(utterance, expected, why, roster) {
  const t = Date.now();
  const out = await routeAddressee({
    rungs, input: { utterance, cast: roster, heard: [] },
    firstGlyphDeadlineMs: 8000, totalDeadlineMs: 9000,
  });
  const ms = Date.now() - t;
  times.push(ms);
  total++;
  const ok = out.npcId === expected;
  if (ok) right++;
  console.log(`${ok ? '✅' : '❌'} ${utterance.padEnd(22)} → ${String(out.npcId).padEnd(12)} ${String(ms).padStart(5)}ms  [${why}]`);
}

console.log('── naming ──');
for (const [utterance, expected, why] of CASES) await probe(utterance, expected, why, cast);
console.log('── geometry ──');
for (const [utterance, expected, why, roster] of GEOMETRY) await probe(utterance, expected, why, roster);

times.sort((a, b) => a - b);
console.log(`\n${right}/${total} routed as expected · min ${times[0]}ms · median ${times[Math.floor(times.length / 2)]}ms · max ${times[times.length - 1]}ms`);
