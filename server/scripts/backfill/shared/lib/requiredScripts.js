/**
 * The authoritative "fully enriched" manifests for the det enrichment pipelines.
 *
 * LAYER: data-enrichment (backfill) utility layer.
 *
 * ONE source of truth for the completeness check + the on-first-sort worker
 * (docs/DISCOVER_LAZY_ENRICHMENT.md §5). `REQUIRED_SCRIPTS_ZH` mirrors the 14-step zh
 * pipeline in `.claude/commands/mark-discoverable.md` §A; `REQUIRED_SCRIPTS_ES` mirrors
 * the 8-step es pipeline in §B3. `id` MUST match the `script:` id each backfill passes
 * to initRunLog (that is the key it stamps into `enrichmentLog`).
 *
 * Each step carries:
 *   - when: applicability. 'always' | 'multiChar' | 'multiDef' | 'nounPos' |
 *     'esSemicolonDef' | 'esAbbrevDef'. A step is only required on rows it applies to
 *     (breakdown → multi-char; process-defs → multi-def; classifier → nouns; the two
 *     deterministic es cleanups → rows whose text actually contains their trigger).
 *   - version: the script's CURRENT `SCRIPT_VERSION`. **Keep in sync by hand when a
 *     script bumps its SCRIPT_VERSION** — this is the manifest's known-good version,
 *     used to detect a row stamped by an out-of-date script (§7 open item).
 *   - validationFields (optional): the `validations.field`(s) this script writes.
 *     If a validator has approved/flagged one, the script self-skips it via
 *     `validatedClause`, so the worker must NOT run the step on that row and must
 *     NOT wait for its stamp — the human-reviewed content is authoritative.
 *       process-defs / parts-of-speech / long-definitions / longdef-citations → 'definitions'
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
 * The `steps` parameter on pendingSteps / isComplete / buildIncompletePredicate is what
 * carries the language — pass `scriptsForLanguage(lang)`. The zh default is kept only so
 * the zh-only callers (run-lazy-enrichment, promote-sortable) read unchanged.
 *
 * Referenced by: scripts/backfill/run-lazy-enrichment.js (zh only),
 * scripts/backfill/oracle-plan.js, scripts/backfill/promote-sortable.js (zh only),
 * docs/DISCOVER_LAZY_ENRICHMENT.md, .claude/commands/oracle-backfill.md.
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
  { id: 'chinese/backfill-frequency-score',           when: 'always',    version: 2 },
  { id: 'chinese/backfill-cluster-definitions',       when: 'always',    version: 5 },
  // Long-definitions writes ONE definition per (SENSE, POS) PAIR, taking its senses (and the
  // `sense` labels it keys on) plus each sense's POS list from `definitionClusters` — so it
  // MUST follow clustering, and skips any row that isn't clustered yet. docs/DEFINITION_CLUSTERS.md.
  { id: 'chinese/backfill-long-definitions',          when: 'always',    version: 15, validationFields: ['definitions'] },
  // Translates the Chinese runs QUOTED INSIDE the long definition (migration 126), so it reads
  // that step's output and must follow it. Re-running long-definitions for a word invalidates
  // this column for that word. docs/DEFINITION_MAPPING.md #5b.
  { id: 'chinese/backfill-longdef-citations',         when: 'always',    version: 2, validationFields: ['definitions'] },
  { id: 'chinese/backfill-example-sentences',         when: 'always',    version: 6, validationFields: ['exampleSentence0', 'exampleSentence1', 'exampleSentence2'] },
  { id: 'chinese/backfill-classifier',                when: 'nounPos',   version: 2 },
];

/**
 * Ordered pipeline steps for SPANISH (order encodes mark-discoverable §B3 constraints).
 *
 * Spanish has no pinyin / tone / HSK / breakdown / classifier, and — unlike zh — no
 * `parts-of-speech` step at all: `partsOfSpeech` is a by-product of clustering since
 * migration 123 retired `spanish/backfill-parts-of-speech.js` (which used to
 * materialize one det row per POS). There is also no `sortable` column on
 * `dictionaryentries_es`, so there is no es pre-pass subset — see PRE_PASS_SCRIPTS_ZH.
 *
 * DEPENDENCY ORDER (why this sequence, not §B3's original one):
 *   1-2. The deterministic cleanups rewrite `definitions` in place, so they come first.
 *        Both stamp ONLY when they actually change a row, so they carry a `when` that
 *        tests for their trigger text — otherwise every es row would read as
 *        permanently pending for a step that has nothing to do on it.
 *   3.   process-definitions-array re-orders and PRUNES `definitions`.
 *   4.   icons keys its icons8 search off the dd (`definitions[0]`), so it must follow
 *        every step that can still rewrite that array (mirrors the zh manifest).
 *   5.   frequency-score writes the word-level `frequencyScore` column.
 *   6.   cluster-definitions partitions `definitions` into senses, and its `checkShape`
 *        validator requires the clusters to be an EXACT partition of that array — so it
 *        MUST run after process-definitions-array, or a later prune silently invalidates
 *        the stored partition. (This is the one place §B3 was wrong: it had clustering
 *        at step 3, ahead of process-defs.)
 *        NOTE a deliberate zh/es divergence: the zh clusterer's single-gloss fast path
 *        COPIES the word-level partsOfSpeech/frequencyScore onto the lone cluster, so zh
 *        hard-requires those steps first. The es fast path instead writes
 *        `frequencyScore: null` and lets the word-level column own it, so es has no such
 *        hard dependency — frequency-score sits ahead of clustering purely to keep the
 *        two language pipelines in the same shape.
 *   7-8. long-definitions and example-sentences both read the cluster `sense` labels to
 *        tag what they generate, so they must follow clustering.
 */
export const REQUIRED_SCRIPTS_ES = [
  { id: 'spanish/backfill-split-semicolon-definitions', when: 'esSemicolonDef', version: 1, deterministic: true, validationFields: ['definitions'] },
  { id: 'spanish/backfill-expand-abbreviations',        when: 'esAbbrevDef',    version: 1, deterministic: true, validationFields: ['definitions'] },
  { id: 'spanish/backfill-process-definitions-array',   when: 'multiDef',       version: 3, validationFields: ['definitions'] },
  // Language-shared script at scripts/backfill/backfill-icons.js — pass --lang=es.
  // Un-prefixed id because it stamps the same key for every language.
  { id: 'backfill-icons',                               when: 'always',         version: 1, deterministic: true },
  { id: 'spanish/backfill-frequency-score',             when: 'always',         version: 4 },
  { id: 'spanish/backfill-cluster-definitions',         when: 'always',         version: 1 },
  { id: 'spanish/backfill-long-definitions',            when: 'always',         version: 2, validationFields: ['definitions'] },
  { id: 'spanish/backfill-example-sentences',           when: 'always',         version: 1, validationFields: ['exampleSentence0', 'exampleSentence1', 'exampleSentence2'] },
];

/** Manifest for a language code. Throws on a language with no pipeline. */
export function scriptsForLanguage(language) {
  switch (language) {
    case 'zh': return REQUIRED_SCRIPTS_ZH;
    case 'es': return REQUIRED_SCRIPTS_ES;
    default: throw new Error(`requiredScripts: no manifest for language "${language}"`);
  }
}

/** The det table holding a language's entries (the two are intentionally NOT unified). */
export function detTableForLanguage(language) {
  switch (language) {
    case 'zh': return 'dictionaryentries_zh';
    case 'es': return 'dictionaryentries_es';
    default: throw new Error(`requiredScripts: no det table for language "${language}"`);
  }
}

/**
 * The PRE-PASS subset — the minimum work that makes an entry legally `sortable`
 * ("level-assigned + lead gloss cleaned", migration 110 / docs/DISCOVER_LAZY_ENRICHMENT.md §2-§4).
 *
 * These are a strict subset of the full manifest above, in manifest order, and are
 * re-run by the same scripts — a pre-passed row is simply a row that has completed
 * these two steps and none of the other eleven. Everything else is Tier-3 enrichment
 * that only gates `discoverable`.
 *
 * Ordering matters: hsk-level reads `definitions` to judge the level, so process-defs
 * (which rewrites/reorders `definitions`) must NOT run after it on the same row.
 * The array order below is the run order; it matches REQUIRED_SCRIPTS_ZH's order.
 */
export const PRE_PASS_STEP_IDS = [
  'chinese/backfill-process-definitions-array',
  'chinese/backfill-hsk-level',
];

/** The pre-pass steps as full manifest entries (single source of truth for versions). */
export const PRE_PASS_SCRIPTS_ZH = PRE_PASS_STEP_IDS
  .map((id) => REQUIRED_SCRIPTS_ZH.find((s) => s.id === id))
  .filter(Boolean);

if (PRE_PASS_SCRIPTS_ZH.length !== PRE_PASS_STEP_IDS.length) {
  // A rename in REQUIRED_SCRIPTS_ZH that forgets this list would silently shrink the
  // pre-pass and let under-enriched rows be promoted to sortable. Fail loudly instead.
  throw new Error('requiredScripts: PRE_PASS_STEP_IDS references an id missing from REQUIRED_SCRIPTS_ZH');
}

/**
 * The distinct validation fields any manifest step writes (for approval lookups).
 * Union across languages: it is only ever used to bound a `validations` lookup, and
 * both pipelines write the same field names, so a union costs nothing and cannot
 * under-fetch when a caller plans a language this list was not derived from.
 */
export const VALIDATION_FIELDS = [...new Set(
  [...REQUIRED_SCRIPTS_ZH, ...REQUIRED_SCRIPTS_ES].flatMap((s) => s.validationFields || [])
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
    // The two deterministic es cleanups scan the whole table but stamp ONLY when they
    // rewrite a row, so "has no stamp" is the normal state for a row they no-op on.
    // Their applicability is therefore the presence of their trigger text in the
    // definitions blob — keep these in lockstep with the scripts' own transforms.
    case 'esSemicolonDef': return `COALESCE(${alias}.definitions, '[]'::jsonb)::text LIKE '%;%'`;
    // Mirrors expandAbbreviations()'s /\bsth\b/ and /\bsb\b/ — \y is Postgres's word boundary.
    case 'esAbbrevDef':    return `COALESCE(${alias}.definitions, '[]'::jsonb)::text ~ '\\ysth\\y|\\ysb\\y'`;
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
    // JS twins of the es conditions above — same triggers as the scripts' transforms.
    case 'esSemicolonDef': return defs.some((d) => String(d).includes(';'));
    case 'esAbbrevDef':    return defs.some((d) => /\bsth\b|\bsb\b/.test(String(d)));
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
 * @param {Array} steps - which manifest steps to consider (default: all; pass
 *   PRE_PASS_SCRIPTS_ZH to ask only "what stands between this row and sortable?")
 */
export function pendingSteps(row, approvedFields = new Set(), steps = REQUIRED_SCRIPTS_ZH) {
  return steps.filter((step) => {
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
export function isComplete(row, approvedFields = new Set(), steps = REQUIRED_SCRIPTS_ZH) {
  return steps.every((step) => {
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
export function buildIncompletePredicate(alias = 'de', steps = REQUIRED_SCRIPTS_ZH) {
  const log = `COALESCE(${alias}."enrichmentLog", '{}'::jsonb)`;
  const terms = steps.map((step) => {
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

// ── the `sortable` bar (pre-pass promotion gate) ────────────────────────────────

/**
 * SQL predicate TRUE when the row at `alias` MAY be promoted to `sortable = TRUE`.
 *
 * ZH ONLY. `dictionaryentries_es` has no `sortable` column (and no HSK level feeding
 * `difficulty`), so Spanish has no pre-pass and no sortable bar — every es row is either
 * discoverable or not. Do not generalize this without adding that column first.
 *
 * `sortable` means "level-assigned + lead gloss cleaned; safe to show as a discover
 * sort card" (migration 110). Two independent conditions, deliberately checked
 * BOTH ways — column state AND stamp state:
 *
 *   1. `difficulty BETWEEN 1 AND 6` — the Tier-1 hard filter the discover supply
 *      queries apply (`StarterPacksService._levelConfig().validPredicate`). A row
 *      without it is invisible even when flagged, so promoting it would be a lie.
 *   2. Every applicable pre-pass step is stamped at its current manifest version
 *      (or validator-protected). The column check alone is not enough: `difficulty`
 *      could predate the current prompt, and process-defs writes no column of its
 *      own that a query can distinguish from raw cedict.
 *
 * This is the ONLY definition of the bar; `promote-sortable.js` and `oracle-plan.js`
 * both import it so the planner can never disagree with the promoter.
 * Referenced by: scripts/backfill/promote-sortable.js, scripts/backfill/oracle-plan.js,
 * .claude/commands/oracle-backfill.md §3b, docs/DISCOVER_LAZY_ENRICHMENT.md §4b.
 */
export function buildSortableReadyPredicate(alias = 'de') {
  return `(${alias}."difficulty" BETWEEN 1 AND 6`
    + ` AND NOT ${buildIncompletePredicate(alias, PRE_PASS_SCRIPTS_ZH)})`;
}

/**
 * JS twin of buildSortableReadyPredicate for a fetched row (needs `difficulty`,
 * `definitions`, `enrichmentLog`). Used by the promoter's per-row re-check.
 */
export function isSortableReady(row, approvedFields = new Set()) {
  const level = Number(row.difficulty);
  if (!Number.isInteger(level) || level < 1 || level > 6) return false;
  return isComplete(row, approvedFields, PRE_PASS_SCRIPTS_ZH);
}

export default REQUIRED_SCRIPTS_ZH;
