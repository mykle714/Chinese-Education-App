#!/usr/bin/env node

/**
 * iw-transcript.js — read back what was said in an Immersive World scene run.
 *
 * LAYER: operational read tool. It is the answer to "can I see my last iw conversation?",
 * which before the transcript shipped (2026-09-08) had no answer at all: nothing stored a
 * line, and `iwDebugLog`'s `[iw:dialogue]` trace is off by default, per-process and gone
 * with the container's stdout buffer.
 *
 * Usage (from server/):
 *   node scripts/iw-transcript.js                      # the 10 most recent runs, listed
 *   node scripts/iw-transcript.js --last               # print the most recent run in full
 *   node scripts/iw-transcript.js <runId>              # print one run in full
 *   node scripts/iw-transcript.js --user <userId>      # scope the list to one learner
 *   node scripts/iw-transcript.js --language zh        # scope the list to one language
 *   node scripts/iw-transcript.js --limit 30
 *   node scripts/iw-transcript.js --self-test          # verify the append/trim SQL
 *
 * READ-ONLY, with one exception that names itself: `--self-test` writes and then deletes a
 * throwaway run. It refuses to do so unless a scene and a user already exist to hang it on,
 * and it rolls back rather than committing.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 12 phase 3; server/__tests__/iwSceneTranscript.test.ts
 * (which points here for the trim, because a fake cannot test SQL).
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'cow_db',
  user: process.env.DB_USER || 'cow_user',
  password: process.env.DB_PASSWORD || 'cow_password_local',
});

/** `--flag value` → value, or undefined. Positional args are left alone. */
function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(`--${name}`);

/** Flags that stand alone; everything else named with `--` consumes the next argument. */
const BARE_FLAGS = new Set(['--last', '--self-test']);

/** The bare arguments, which is how a run id is given. */
const positional = (() => {
  const out = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { out.push(argv[i]); continue; }
    if (!BARE_FLAGS.has(argv[i])) i++; // skip the value this flag consumes
  }
  return out;
})();

const RUN_COLUMNS = `r.id, r."userId", r.language, r."sceneId", r.completed,
  r."durationSeconds", r.transcript, r."startedAt", r."completedAt",
  s.name AS "sceneName", u.name`;

const FROM = `FROM iw_scene_runs r
  JOIN iw_scenes s ON s.id = r."sceneId"
  LEFT JOIN users u ON u.id = r."userId"`;

function stamp(value) {
  return value ? new Date(value).toISOString().replace('T', ' ').slice(0, 19) : '—';
}

/** One run's header line, in the same shape for the list and the full print. */
function header(run) {
  const lines = Array.isArray(run.transcript) ? run.transcript.length : 0;
  const state = run.completedAt ? (run.completed ? 'completed' : 'ended') : 'OPEN';
  return `${stamp(run.startedAt)}  ${run.language}  ${String(lines).padStart(3)} lines  `
    + `${String(run.durationSeconds ?? '—').padStart(5)}s  ${state.padEnd(9)}  `
    + `${run.sceneName}  (${run.name ?? run.userId})\n  ${run.id}`;
}

async function list() {
  const limit = Math.max(1, Math.min(200, parseInt(flag('limit') ?? '10', 10) || 10));
  const { rows } = await pool.query(
    `SELECT ${RUN_COLUMNS} ${FROM}
      WHERE ($1::uuid IS NULL OR r."userId" = $1)
        AND ($2::varchar IS NULL OR r.language = $2)
      ORDER BY r."startedAt" DESC
      LIMIT $3`,
    [flag('user') ?? null, flag('language') ?? null, limit]
  );
  if (rows.length === 0) {
    console.log('No runs recorded yet.');
    console.log('A run is opened by the first model call of a scene — walking into a scene');
    console.log('and leaving without speaking deliberately stores nothing.');
    return;
  }
  console.log(`${rows.length} run(s), newest first:\n`);
  rows.forEach((r) => console.log(header(r) + '\n'));
  console.log('Print one in full:  node scripts/iw-transcript.js <runId>');
}

async function show(runId) {
  const { rows } = await pool.query(
    runId
      ? `SELECT ${RUN_COLUMNS} ${FROM} WHERE r.id = $1`
      : `SELECT ${RUN_COLUMNS} ${FROM}
          WHERE ($1::uuid IS NULL OR r."userId" = $1)
          ORDER BY r."startedAt" DESC LIMIT 1`,
    [runId ?? flag('user') ?? null]
  );
  const run = rows[0];
  if (!run) {
    console.log(runId ? `No run ${runId}.` : 'No runs recorded yet.');
    return;
  }
  console.log(header(run));
  console.log('─'.repeat(78));
  const entries = Array.isArray(run.transcript) ? run.transcript : [];
  if (entries.length === 0) {
    console.log('(the run opened but nothing was recorded — every turn froze, or the');
    console.log(' transcript writes failed; check the backend log for [iw:transcript] FAULT)');
  }
  // ⚠️ The order here is the order the lines were GENERATED, which is not exactly the order
  // they were spoken — the client queues speech, and an authored beat is rendered ahead of
  // its turn to speak. See the note in services/iw/sceneTranscript.ts.
  entries.forEach((e) => {
    const at = e.at ? new Date(e.at).toISOString().slice(11, 19) : '--:--:--';
    console.log(`${at}  ${String(e.speaker).padEnd(12)}  ${e.text}`);
  });
  console.log('─'.repeat(78));
}

/**
 * Exercise the append/trim SQL against the real database, then roll it back.
 *
 * This is the half of the transcript the unit tests cannot reach: `appendTranscript` is one
 * `UPDATE` whose whole behaviour is `jsonb_array_elements ... WITH ORDINALITY`, and a fake
 * that reimplemented it in JavaScript would be testing the fake.
 */
async function selfTest() {
  const MAX = 200;
  const client = await pool.connect();
  try {
    const { rows: scenes } = await client.query('SELECT id, language FROM iw_scenes LIMIT 1');
    const { rows: users } = await client.query('SELECT id FROM users LIMIT 1');
    if (!scenes[0] || !users[0]) {
      console.log('Skipped: the self-test needs one existing scene and one existing user.');
      return;
    }
    await client.query('BEGIN');
    const { rows: [run] } = await client.query(
      `INSERT INTO iw_scene_runs ("userId", language, "sceneId", "completedAt")
       VALUES ($1, $2, $3, NOW()) RETURNING id`,
      // Inserted already-closed, so the partial unique index cannot collide with a real
      // open run belonging to this user.
      [users[0].id, scenes[0].language, scenes[0].id]
    );

    const append = (entries) => client.query(
      `UPDATE iw_scene_runs
          SET transcript = (
            SELECT COALESCE(jsonb_agg(entry ORDER BY ord), '[]'::jsonb)
              FROM (
                SELECT entry, ord
                  FROM jsonb_array_elements(transcript || $2::jsonb)
                       WITH ORDINALITY AS t(entry, ord)
                 ORDER BY ord DESC
                 LIMIT $3
              ) kept
          )
        WHERE id = $1`,
      [run.id, JSON.stringify(entries), MAX]
    );

    const entry = (n) => ({ speaker: 'player', text: `line ${n}`, at: new Date().toISOString() });
    await append([entry(1), entry(2)]);
    let { rows: [state] } = await client.query('SELECT transcript FROM iw_scene_runs WHERE id = $1', [run.id]);
    check('appends in order', state.transcript.map(e => e.text), ['line 1', 'line 2']);

    await append([entry(3)]);
    ({ rows: [state] } = await client.query('SELECT transcript FROM iw_scene_runs WHERE id = $1', [run.id]));
    check('appends to an existing transcript', state.transcript.map(e => e.text), ['line 1', 'line 2', 'line 3']);

    // Push it past the cap in one go and confirm the OLDEST go, not the newest.
    await append(Array.from({ length: MAX }, (_, i) => entry(100 + i)));
    ({ rows: [state] } = await client.query('SELECT transcript FROM iw_scene_runs WHERE id = $1', [run.id]));
    check('caps at IW_TRANSCRIPT_MAX_ENTRIES', state.transcript.length, MAX);
    // 3 + 200 = 203 entries went in; the three oldest ("line 1".."line 3") are the ones
    // that must be gone, leaving "line 100".."line 299".
    check('drops the OLDEST first', state.transcript[0].text, 'line 100');
    check('keeps the newest', state.transcript[MAX - 1].text, `line ${100 + MAX - 1}`);

    await client.query('ROLLBACK');
    console.log('\nSelf-test passed. Nothing was committed.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

let failures = 0;
function check(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${what}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
}

async function main() {
  if (has('self-test')) await selfTest();
  else if (has('last') || positional[0]) await show(positional[0]);
  else await list();
}

main()
  .then(() => pool.end())
  .then(() => process.exit(failures > 0 ? 1 : 0))
  .catch((error) => {
    console.error('❌', error.message);
    pool.end().finally(() => process.exit(1));
  });
