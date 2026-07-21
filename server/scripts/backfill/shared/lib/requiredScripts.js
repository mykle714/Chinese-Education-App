/**
 * The authoritative "fully enriched" manifest for the Chinese det pipeline.
 *
 * LAYER: data-enrichment (backfill) utility layer.
 *
 * ONE source of truth for the completeness check + the on-first-sort worker
 * (docs/DISCOVER_LAZY_ENRICHMENT.md §5). Mirrors the 12-step zh pipeline in
 * `.claude/commands/mark-discoverable.md` §A. `id` MUST match the `script:` id each
 * backfill passes to initRunLog (that is the key it stamps into `enrichmentLog`).
 *
 * Each step carries:
 *   - when: applicability. 'always' | 'multiChar' | 'multiDef' | 'nounPos'. A step
 *     is only required on rows it applies to (breakdown → multi-char;
 *     process-defs → multi-def; classifier → nouns).
 *   - version: the script's CURRENT `SCRIPT_VERSION`. **Keep in sync by hand when a
 *     script bumps its SCRIPT_VERSION** — this is the manifest's known-good version,
 *     used to detect a row stamped by an out-of-date script (§7 open item).
 *   - validationFields (optional): the `validations.field`(s) this script writes.
 *     If a validator has approved/flagged one, the script self-skips it via
 *     `validatedClause`, so the worker must NOT run the step on that row and must
 *     NOT wait for its stamp — the human-reviewed content is authoritative.
 *       process-defs / parts-of-speech / long-definitions → 'definitions'
 *       example-sentences → 'exampleSentence0..2'
 *     (These mirror the scripts' own validatedClause calls — see each script.)
 *
 * "Not done" is VERSION-aware everywhere (buildIncompletePredicate / isComplete /
 * pendingSteps all agree): an applicable, non-approved step is pending when it is
 * MISSING a stamp OR stamped BELOW its manifest `version`. A version bump therefore
 * re-triggers ONLY that one script (never "stale everything"), and it re-triggers even
 * an already-shipped word — the worker's candidate query drops the `discoverable=FALSE`
 * filter so a stale discoverable row heals in place. This is stuck-free because EVERY
 * pipeline script now honors `--stale` (ORs `staleClause()` into its doneGate) and a
 * `--words` run enriches the named words regardless of `discoverable`.
 *
 * Referenced by: scripts/backfill/run-lazy-enrichment.js, docs/DISCOVER_LAZY_ENRICHMENT.md.
 */

/** Ordered pipeline steps (order encodes mark-discoverable §A3 constraints). */
export const REQUIRED_SCRIPTS_ZH = [
  { id: 'chinese/backfill-tones',                     when: 'always',    version: 1, deterministic: true },
  { id: 'chinese/backfill-numbered-pinyin',           when: 'always',    version: 1, deterministic: true },
  { id: 'chinese/backfill-dictionary-breakdown',      when: 'multiChar', version: 1 },
  { id: 'chinese/backfill-process-definitions-array', when: 'multiDef',  version: 3, validationFields: ['definitions'] },
  { id: 'chinese/backfill-parts-of-speech',           when: 'always',    version: 2, validationFields: ['definitions'] },
  // Icon search keys off definitions[0] (the dd), so it must follow the two steps that
  // can still rewrite/reorder `definitions`. Shared across languages (--lang defaults to
  // zh), hence the un-prefixed id — it lives at scripts/backfill/backfill-icons.js.
  { id: 'backfill-icons',                             when: 'always',    version: 1, deterministic: true },
  { id: 'chinese/backfill-word-forms',                when: 'always',    version: 3 },
  { id: 'chinese/backfill-hsk-level',                 when: 'always',    version: 2 },
  { id: 'chinese/backfill-long-definitions',          when: 'always',    version: 13, validationFields: ['definitions'] },
  { id: 'chinese/backfill-vernacular-score',          when: 'always',    version: 1 },
  { id: 'chinese/backfill-cluster-definitions',       when: 'always',    version: 4 },
  { id: 'chinese/backfill-example-sentences',         when: 'always',    version: 6, validationFields: ['exampleSentence0', 'exampleSentence1', 'exampleSentence2'] },
  { id: 'chinese/backfill-classifier',                when: 'nounPos',   version: 2 },
];

/** The distinct validation fields any manifest step writes (for approval lookups). */
export const VALIDATION_FIELDS = [...new Set(
  REQUIRED_SCRIPTS_ZH.flatMap((s) => s.validationFields || [])
)];

// ── applicability ─────────────────────────────────────────────────────────────

/** SQL boolean: does a step's `when` hold for the det row at `alias`? */
function conditionSql(when, alias) {
  switch (when) {
    case 'always':    return 'TRUE';
    case 'multiChar': return `char_length(${alias}.word1) > 1`;
    case 'multiDef':  return `jsonb_array_length(COALESCE(${alias}.definitions, '[]'::jsonb)) > 1`;
    // partsOfSpeech is a jsonb array of pos strings (e.g. ["noun"]); `?` tests membership.
    case 'nounPos':   return `COALESCE(${alias}."partsOfSpeech", '[]'::jsonb) ? 'noun'`;
    default: throw new Error(`requiredScripts: unknown condition "${when}"`);
  }
}

/** JS twin of conditionSql for a fetched row. */
export function appliesTo(step, row) {
  const word1 = row.word1 ?? '';
  const defs = Array.isArray(row.definitions) ? row.definitions : [];
  const pos = Array.isArray(row.partsOfSpeech) ? row.partsOfSpeech : [];
  switch (step.when) {
    case 'always':    return true;
    case 'multiChar': return [...word1].length > 1;
    case 'multiDef':  return defs.length > 1;
    case 'nounPos':   return pos.includes('noun');
    default: return false;
  }
}

// ── approval (validator approve/flag protects a field from regeneration) ────────

/** JS: is any of this step's validation fields present in the approved-set? */
function isProtected(step, approvedFields) {
  return (step.validationFields || []).some((f) => approvedFields.has(f));
}

/**
 * SQL boolean: NONE of `fields` is validator-approved/flagged for the row at
 * `alias`. Mirrors run-log `validatedClause` (approve OR flag both protect). Empty
 * `fields` → TRUE (nothing to protect).
 */
function notApprovedSql(fields, alias) {
  if (!fields || fields.length === 0) return 'TRUE';
  const list = fields.map((f) => `'${String(f).replace(/'/g, "''")}'`).join(', ');
  return `NOT EXISTS (SELECT 1 FROM validations val`
    + ` WHERE val."entryId" = ${alias}.id AND val.language = ${alias}.language`
    + ` AND val.field IN (${list}) AND val.action IN ('approve','flag'))`;
}

// ── stamp inspection ────────────────────────────────────────────────────────────

/** {present, version} for a step's stamp on a fetched row (version null → treated 0). */
function stampInfo(row, id) {
  const log = row.enrichmentLog || {};
  if (!(id in log)) return { present: false, version: 0 };
  const v = log[id]?.version;
  return { present: true, version: typeof v === 'number' ? v : 0 };
}

// ── worker-facing helpers (fetched rows) ────────────────────────────────────────

/**
 * Steps to (re)run for a row: applicable, NOT approval-protected, and either
 * MISSING a stamp or stamped BELOW the manifest version. Version-aware, but targets
 * ONLY the out-of-date/missing steps — never "stale everything".
 * @param {Set<string>} approvedFields - validator-approved/flagged fields for this row
 */
export function pendingSteps(row, approvedFields = new Set()) {
  return REQUIRED_SCRIPTS_ZH.filter((step) => {
    if (!appliesTo(step, row)) return false;
    if (isProtected(step, approvedFields)) return false;
    const { present, version } = stampInfo(row, step.id);
    return !present || version < step.version;
  });
}

/**
 * VERSION-aware completeness (promotion gate): every applicable step is either
 * approval-protected or stamped at its CURRENT manifest version. Matches
 * `pendingSteps` (a word promotes exactly when nothing is pending). Every pipeline
 * script now honors `--stale`, so a version-stale step can always be brought current
 * — there is no stuck state.
 */
export function isComplete(row, approvedFields = new Set()) {
  return REQUIRED_SCRIPTS_ZH.every((step) => {
    if (!appliesTo(step, row)) return true;
    if (isProtected(step, approvedFields)) return true;
    const { present, version } = stampInfo(row, step.id);
    return present && version >= step.version;
  });
}

// ── candidate-query predicate (VERSION + approval, matches isComplete) ───────────

/**
 * SQL predicate (det row aliased `alias`) TRUE when the row is NOT fully enriched:
 * some applicable, non-approved required step is MISSING or stamped BELOW its manifest
 * version. Version-aware (matches `isComplete`/`pendingSteps`), so a version bump makes
 * an already-shipped word a candidate again — the worker's candidate query drops the
 * `discoverable = FALSE` filter for exactly this reason (a stale discoverable row heals
 * in place on next sort). Stuck-free because every script now honors `--stale`.
 */
export function buildIncompletePredicate(alias = 'de') {
  const log = `COALESCE(${alias}."enrichmentLog", '{}'::jsonb)`;
  const terms = REQUIRED_SCRIPTS_ZH.map((step) => {
    const parts = [];
    if (step.when !== 'always') parts.push(conditionSql(step.when, alias));
    // missing OR stamped below the manifest version (null version → treated as 0)
    parts.push(
      `(NOT (${log} ? '${step.id}')`
      + ` OR COALESCE((${log} #>> ARRAY['${step.id}','version'])::int, 0) < ${step.version})`
    );
    if (step.validationFields) parts.push(notApprovedSql(step.validationFields, alias));
    return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`;
  });
  return `(${terms.join(' OR ')})`;
}

/** Convenience: the COMPLETE predicate (row is fully enriched). */
export function buildCompletePredicate(alias = 'de') {
  return `NOT ${buildIncompletePredicate(alias)}`;
}

export default REQUIRED_SCRIPTS_ZH;
