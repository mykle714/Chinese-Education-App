/**
 * TEMP diagnostic — drive StarterPacksService exactly like the client FIFO queue and
 * record, in order, every card offered: entryKey, difficulty level, English gloss, the
 * bucket we sorted it into, and the server-estimated level before/after the sort.
 *
 * Faithful client emulation: queue size 2 (head + buffer). Each step we act on the head
 * and pass the buffer's id as excludeIds, then append the returned nextCard to the tail.
 * Uses a throwaway user per scenario; cleanup is ON DELETE CASCADE when the user is dropped.
 *
 * Run from server/:  npx tsx scripts/test-sort-profiles.ts
 */
import db from '../db.js';
import { starterPacksService } from '../dal/setup.js';
import { DiscoverCard } from '../types/index.js';

type Bucket = 'already-learned' | 'library' | 'skip';

// A scenario decides which bucket to use for the Nth card seen (0-based).
interface Scenario {
  name: string;
  blurb: string;
  pick: (stepIndex: number, card: DiscoverCard) => Bucket;
  steps: number;
}

const LANG = process.argv[2] || 'zh';
const QUEUE_SIZE = 2;

async function makeUser(tag: string): Promise<string> {
  const client = await db.getClient();
  try {
    const email = `sortprofile_${tag}_${Date.now()}@test.local`;
    const r = await client.query<{ id: string }>(
      `INSERT INTO users (email, name, password) VALUES ($1, $2, $3) RETURNING id`,
      [email, `sort-profile ${tag}`, 'x']
    );
    return r.rows[0].id;
  } finally {
    client.release();
  }
}

async function dropUser(userId: string): Promise<void> {
  const client = await db.getClient();
  try {
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  } finally {
    client.release();
  }
}

function fmtCard(c: DiscoverCard): string {
  const lvl = c.difficulty ?? '?';
  const en = (c.definition || '').replace(/\s+/g, ' ').slice(0, 48);
  const key = c.entryKey + (c.pronunciation ? ` (${c.pronunciation})` : '');
  return `L${lvl}  ${key.padEnd(22)} — ${en}`;
}

async function runScenario(s: Scenario): Promise<void> {
  const userId = await makeUser(s.name.replace(/\W+/g, '').slice(0, 12));
  console.log('\n' + '='.repeat(78));
  console.log(`SCENARIO: ${s.name}`);
  console.log(s.blurb);
  console.log('='.repeat(78));

  // Initial queue fill (client calls GET /:language once).
  const init = await starterPacksService.getStarterPackCards(LANG, userId, QUEUE_SIZE);
  let queue: DiscoverCard[] = [...init.cards];
  console.log(`start: estimated level = ${init.level}   (initial queue: ${queue.map(c => c.entryKey).join(', ') || '∅'})`);
  console.log('-'.repeat(78));
  console.log(`step  bucket           card seen                                   level`);
  console.log('-'.repeat(78));

  for (let i = 0; i < s.steps; i++) {
    const head = queue.shift();
    if (!head) {
      console.log(`(queue empty — exhausted at step ${i + 1})`);
      break;
    }
    const bucket = s.pick(i, head);
    const excludeIds = queue.map(c => c.id); // buffer card(s) the client still holds
    const resp = await starterPacksService.sortCard(userId, head.id, bucket, LANG, excludeIds);

    const line = `${String(i + 1).padStart(3)}.  ${bucket.padEnd(15)}  ${fmtCard(head)}`;
    console.log(`${line}    → lvl ${resp.level}${resp.exhausted ? '  [EXHAUSTED]' : ''}`);

    if (resp.nextCard) queue.push(resp.nextCard);
  }

  await dropUser(userId);
}

async function main() {
  console.log(`Language under test: ${LANG}  (queue size ${QUEUE_SIZE}, MIN_MASTERED_TO_ADVANCE=3, LEARN_LATER_TOLERANCE=1)`);

  const scenarios: Scenario[] = [
    {
      name: 'A · master everything',
      blurb: 'Every card → "Already Learned" (8/8 → Mastered). Expect the level to climb 1→2→3… after 3 masters clear each level.',
      pick: () => 'already-learned',
      steps: 16,
    },
    {
      name: 'B · learn-now everything',
      blurb: 'Every card → "Add to Learn Now" (Unfamiliar). learning[L] grows; after the 2nd unmastered card the level should STALL (tolerance=1).',
      pick: () => 'library',
      steps: 10,
    },
    {
      name: 'C · skip everything',
      blurb: 'Every card → "Skip" (signal-free). Level stays put; fresh L-near cards keep coming, then skips recycle (oldest first) once supply is drained.',
      pick: () => 'skip',
      steps: 10,
    },
    {
      name: 'D · mixed studious',
      blurb: 'Repeating [learned, learned, learned, learn-now, skip]: masters 3/level (advances) while sprinkling one learn-now + one skip per cycle.',
      pick: (i) => (['already-learned', 'already-learned', 'already-learned', 'library', 'skip'] as Bucket[])[i % 5],
      steps: 20,
    },
  ];

  for (const s of scenarios) {
    await runScenario(s);
  }

  await db.pool?.end?.();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
