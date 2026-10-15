/**
 * Manifest ⇄ SCRIPT_VERSION sync check.
 *
 * LAYER: data-enrichment (backfill) planning utility. Read-only; touches no DB.
 *
 * WHY: each manifest step in shared/lib/requiredScripts.js carries a `version` that is
 * HAND-SYNCED to the corresponding script's `SCRIPT_VERSION`. Nothing enforced that, and
 * drift is silent in the worst direction: when the script is AHEAD of the manifest, every
 * row stamped at the older version reads as CURRENT, so the planner under-reports and the
 * stale rows are never re-run. (Real instance: migration 122 bumped
 * chinese/backfill-cluster-definitions to v5 and left the manifest at v4.)
 *
 * A step may DECLARE an intentional gap with `heldBackScriptVersion` (see requiredScripts.js):
 * exactly that script version is accepted ahead of the manifest and shown as "held back";
 * any other version still fails, and a marker whose gap has closed fails as stale.
 *
 * Also catches a manifest step whose script file no longer exists — the failure mode that
 * broke the oracle skill's Spanish path when backfill-parts-of-speech.js was deleted.
 *
 * USAGE
 *   docker exec cow-backend npx tsx /app/scripts/backfill/check-manifest-sync.js
 *   server/scripts/backfill/run-ppe.sh scripts/backfill/check-manifest-sync.js
 *
 * Exit 0 = in sync. Exit 1 = drift (details printed). Safe to wire into CI.
 *
 * Referenced by: .claude/commands/oracle-backfill.md §3; preflighted every tick by
 * scripts/backfill/oracle-cron.sh (aborts the round on exit 1).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { REQUIRED_SCRIPTS_ZH, REQUIRED_SCRIPTS_ES } from './shared/lib/requiredScripts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Read a script's declared SCRIPT_VERSION, or null when it declares none. */
function scriptVersion(stepId) {
  const file = path.join(__dirname, `${stepId}.js`);
  if (!fs.existsSync(file)) return { missing: true, version: null };
  const m = /SCRIPT_VERSION\s*=\s*(\d+)/.exec(fs.readFileSync(file, 'utf8'));
  return { missing: false, version: m ? Number(m[1]) : null };
}

const problems = [];
const rows = [];

// backfill-icons appears in BOTH manifests (it is language-shared), so dedupe the
// report while still checking each manifest's copy — they must agree with each other too.
for (const [lang, manifest] of [['zh', REQUIRED_SCRIPTS_ZH], ['es', REQUIRED_SCRIPTS_ES]]) {
  for (const step of manifest) {
    const { missing, version } = scriptVersion(step.id);
    let status;
    if (missing) {
      status = '❌ script file missing';
      problems.push(`${lang}: ${step.id} — manifest names a script that does not exist`);
    } else if (version === null) {
      status = '❌ no SCRIPT_VERSION';
      problems.push(`${lang}: ${step.id} — script declares no SCRIPT_VERSION but is in the manifest`);
    } else if (step.heldBackScriptVersion !== undefined && step.heldBackScriptVersion === version
               && version > step.version) {
      // A DECLARED hold-back (requiredScripts.js → heldBackScriptVersion): the gap is
      // intentional and documented on the manifest entry, so it is not drift.
      status = `⏸ held back (script v${version})`;
    } else if (step.heldBackScriptVersion !== undefined && version === step.version) {
      // The gap the marker excused is gone (manifest was bumped, or the script reverted) —
      // a leftover marker would silently excuse the NEXT bump, so it has to go.
      status = '⚠ stale hold-back marker';
      problems.push(`${lang}: ${step.id} — heldBackScriptVersion: ${step.heldBackScriptVersion} is set but `
        + `manifest and script both read v${version}; remove the marker.`);
    } else if (version > step.version) {
      // The dangerous direction: rows stamped at the older version read as current.
      status = `⚠ DRIFT — script is AHEAD (v${version})`;
      problems.push(`${lang}: ${step.id} — manifest v${step.version} < script v${version}; `
        + 'the planner will under-report stale rows. Bump the manifest.');
    } else if (version < step.version) {
      status = `⚠ DRIFT — manifest is AHEAD (script v${version})`;
      problems.push(`${lang}: ${step.id} — manifest v${step.version} > script v${version}; `
        + 'every row will read as stale forever. Fix whichever is wrong.');
    } else {
      status = '✅';
    }
    rows.push([lang, step.id, step.version, version ?? '—', status]);
  }
}

const w = Math.max(...rows.map((r) => r[1].length));
console.log(`\n${'lang'.padEnd(5)}${'step id'.padEnd(w + 2)}${'manifest'.padStart(8)}${'script'.padStart(8)}  status`);
for (const [lang, id, mv, sv, status] of rows) {
  console.log(`${lang.padEnd(5)}${id.padEnd(w + 2)}${String(mv).padStart(8)}${String(sv).padStart(8)}  ${status}`);
}

if (problems.length) {
  console.error(`\n❌ ${problems.length} manifest sync problem(s):\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error('');
  process.exit(1);
}
console.log('\n✅ All manifest versions match their scripts (or are declared held back).\n');
