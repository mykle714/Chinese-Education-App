/**
 * The authoritative "fully enriched" manifests for the det enrichment pipelines.
 *
 * LAYER: data-enrichment (backfill) utility layer.
 *
 * ONE source of truth for the completeness check + the on-first-sort worker
 * (docs/DISCOVER_LAZY_ENRICHMENT.md §5). `REQUIRED_SCRIPTS_ZH` mirrors the 16-step zh
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
 *   - optional (default false): OPT-IN step. Excluded from every manifest read unless
 *     the caller explicitly asks for it (`scriptsForLanguage(lang, {includeOptional:true})`
 *     / the `includeOptional` option on the helpers below). An optional step is
 *     therefore neither planned nor a promotion blocker by default — a row ships
 *     without ever running it. Today this is `backfill-icons` only: its acceptability
 *     JUDGE is an oracle-capturable LLM call (v2+), but the step ALSO makes real,
 *     live icons8 HTTP calls (search + getById, via plain `fetch` in
 *     Icons8FetchService.ts, never through the wrapped Anthropic client) that an
 *     oracle round cannot answer locally — so the step as a whole still cannot be
 *     fully answered offline, and a missing `iconId` degrades gracefully everywhere
 *     it is read. Opt in with `--with-icons` on oracle-plan.js / promote-discoverable.js.
 *   - driftProbe (optional): names a CROSS-ROW staleness check in DRIFT_PROBES. The
 *     other two axes (`when`, `version`) are per-row and compile into
 *     buildIncompletePredicate; a drift probe cannot, because "is this row stale?"
 *     depends on OTHER rows. It is therefore a separate set-returning query the caller
 *     runs ONCE per round, whose ids are then OR-ed into the candidate scope and fed
 *     to pendingSteps/isComplete as `driftedStepIds`. Today: breakdownSenseOrphan.
 *   - validationFields (optional): the `validations.field`(s) this script writes.
 *     If a validator has approved/flagged one, the script self-skips it via
 *     `validatedClause`, so the worker must NOT run the step on that row and must
 *     NOT wait for its stamp — the human-reviewed content is authoritative.
 *       process-defs / long-definitions / longdef-citations → 'definitions'
 *       parts-of-speech   → 'partsOfSpeech'  (split out of the bundle by migration 132)
 *       hsk-level         → 'difficulty'
 *       frequency-score   → 'frequencyScore' (es: also 'difficulty', one script writes both)
 *       example-sentences → 'exampleSentence0..2'
 *     (These mirror the scripts' own validatedClause calls — see each script.)
 *
 * "Not done" is VERSION-aware everywhere (buildIncompletePredicate / isComplete /
 * pendingSteps all agree), and additionally DRIFT-aware wherever the caller supplies
 * `driftedStepIds` (pendingSteps/isComplete's 4th argument — see driftProbesFor).
 * A caller that omits it keeps exactly the old two-axis behavior: an applicable, non-approved step is pending when it is
 * MISSING a stamp OR stamped BELOW its manifest `version`. A version bump therefore
 * re-triggers ONLY that one script (never "stale everything"), and it re-triggers even
 * an already-shipped word — the worker's candidate query drops the `discoverable=FALSE`
 * filter so a stale discoverable row heals in place. This is stuck-free because EVERY
 * pipeline script now honors `--stale` (ORs `staleClause()` into its doneGate) and a
 * `--words` run enriches the named words regardless of `discoverable`.
 *
 * The `steps` parameter on pendingSteps / isComplete / buildIncompletePredicate is what
 * carries the language — pass `scriptsForLanguage(lang)`. The zh default is kept only so
 * the zh-only caller (run-lazy-enrichment) reads unchanged.
 *
 * Referenced by: scripts/backfill/run-lazy-enrichment.js (zh only),
 * scripts/backfill/oracle-plan.js,
 * docs/DISCOVER_LAZY_ENRICHMENT.md, .claude/commands/oracle-backfill.md.
 */

// The card-headline length budget, owned by the gloss-ordering core and imported
// (not re-declared) so the manifest's `multiDefOrLongLead` condition and the
// short-gloss synthesis that condition exists to reach can never disagree on the
// number. orderGlosses.js has no imports of its own, so this stays cheap for the
// server, which loads this manifest at request time via LazyEnrichmentService.
import { MAX_FIRST_GLOSS_LEN } from '../../chinese/lib/orderGlosses.js';

/** Ordered pipeline steps (order encodes mark-discoverable §A3 constraints). */
export const REQUIRED_SCRIPTS_ZH = [
  { id: 'chinese/backfill-tones',                     when: 'always',    version: 1, deterministic: true },
  { id: 'chinese/backfill-numbered-pinyin',           when: 'always',    version: 1, deterministic: true },
  { id: 'chinese/backfill-dictionary-breakdown',      when: 'multiChar', version: 1 },
  // NOT 'multiDef': this script also owns the ≤20-char lead-gloss synthesis, whose
  // trigger is the LENGTH of definitions[0], not the gloss count. Under 'multiDef' a
  // single-gloss row with a 142-char cedict headline was permanently non-applicable —
  // it could never be planned, and the script's own filter would have dropped it
  // anyway. Mirrors HAS_WORK_CLAUSE in the script; keep the two in lockstep.
  { id: 'chinese/backfill-process-definitions-array', when: 'multiDefOrLongLead', version: 3, validationFields: ['definitions'] },
  { id: 'chinese/backfill-parts-of-speech',           when: 'always',    version: 2, validationFields: ['partsOfSpeech'] },
  // Icon search keys off definitions[0] (the dd), so it must follow the two steps that
  // can still rewrite/reorder `definitions`. Shared across languages (--lang defaults to
  // zh), hence the un-prefixed id — it lives at scripts/backfill/backfill-icons.js.
  // OPTIONAL (opt-in): needs the external icons8 API, so it is skipped by default and
  // never blocks promotion — see the `optional` bullet in the header. NOT
  // deterministic (v2+): the search→judge→reformulate loop makes an LLM acceptability
  // call per candidate icon.
  { id: 'backfill-icons',                             when: 'always',    version: 2, optional: true },
  { id: 'chinese/backfill-word-forms',                when: 'always',    version: 3 },
  { id: 'chinese/backfill-hsk-level',                 when: 'always',    version: 2, validationFields: ['difficulty'] },
  { id: 'chinese/backfill-frequency-score',           when: 'always',    version: 4, validationFields: ['frequencyScore'] },
  // Writes `definitionClusters`, whose per-cluster frequencyScore is reviewable as
  // 'senseFrequencyScore' (migration 139) — mirrors the script's own validatedClause.
  { id: 'chinese/backfill-cluster-definitions',       when: 'always',    version: 9, validationFields: ['senseFrequencyScore'] },
  // Long-definitions writes ONE definition per (SENSE, POS) PAIR, taking its senses (and the
  // `sense` labels it keys on) plus each sense's POS list from `definitionClusters` — so it
  // MUST follow clustering, and skips any row that isn't clustered yet. docs/DEFINITION_CLUSTERS.md.
  { id: 'chinese/backfill-long-definitions',          when: 'always',    version: 15, validationFields: ['definitions'] },
  // Translates the Chinese runs QUOTED INSIDE the long definition (migration 126), so it reads
  // that step's output and must follow it. Re-running long-definitions for a word invalidates
  // this column for that word. docs/DEFINITION_MAPPING.md #5b.
  { id: 'chinese/backfill-longdef-citations',         when: 'always',    version: 2, validationFields: ['definitions'] },
  { id: 'chinese/backfill-example-sentences',         when: 'always',    version: 7, validationFields: ['exampleSentence0', 'exampleSentence1', 'exampleSentence2'] },
  { id: 'chinese/backfill-classifier',                when: 'nounPos',   version: 2 },
  // ── the breakdown chain (multi-char rows only) ──────────────────────────────
  // Placed LAST, after everything that can still rewrite `definitions`: the sense-tagger
  // reads the component characters' `definitionClusters` and the elaboration judge is
  // shown this row's finalized `definitions`, so an earlier slot would judge text that a
  // later step then changes. They also have no consumer downstream in the pipeline, so
  // nothing else waits on them.
  //
  // ⚠️ CROSS-ROW DEPENDENCY: backfill-breakdown-senses reads `definitionClusters` off
  // the COMPONENT CHARACTERS' OWN det rows, not off this row. Manifest ORDERING only
  // sequences steps WITHIN one row, so a late slot does not guarantee the components
  // are clustered. An un-clustered component is carried through unchanged (no `sense`)
  // and healed on a later re-run — see the script header.
  //
  // The other half of that dependency is DRIFT, which no per-row signal can see: the
  // step stores a cluster's `sense` LABEL as a stable pointer, and a later re-clustering
  // of the COMPONENT can rename or drop that label, orphaning the pointer. The row's own
  // stamp still reads current, and the script's default gate ("breakdown text contains
  // 'sense' ⇒ done") excludes it forever short of a full --force re-tag. A 2026-08-28
  // audit found 1143 of 8724 stored senses (13%) orphaned this way, concentrated on the
  // COMMONEST characters (大, 水, 有, 手 …) — i.e. a bulk relabel, not a long tail.
  // `driftProbe` is the third staleness axis that catches it; see DRIFT_PROBES below.
  { id: 'chinese/backfill-breakdown-senses',          when: 'multiChar', version: 1,
    driftProbe: 'breakdownSenseOrphan' },
  // Judges the sense-tagged glosses, so it MUST follow the tagger. Writes NULL for the
  // majority ("breakdown is straightforward") and stamps every row it decides, so its
  // done-state lives in this stamp — never in `breakdownElaboration IS NULL`.
  { id: 'chinese/backfill-breakdown-elaboration',     when: 'multiChar', version: 1 },
];

/**
 * Ordered pipeline steps for SPANISH (order encodes mark-discoverable §B3 constraints).
 *
 * Spanish has no pinyin / tone / HSK / breakdown / classifier, and — unlike zh — no
 * `parts-of-speech` step at all: `partsOfSpeech` is a by-product of clustering since
 * migration 123 retired `spanish/backfill-parts-of-speech.js` (which used to
 * materialize one det row per POS).
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
  { id: 'spanish/backfill-process-definitions-array',   when: 'multiDef',       version: 4, validationFields: ['definitions'] },
  // Language-shared script at scripts/backfill/backfill-icons.js — pass --lang=es.
  // Un-prefixed id because it stamps the same key for every language.
  // OPTIONAL (opt-in) for the same reason as in the zh manifest — external icons8 API.
  // NOT deterministic (v2+) — see the zh entry's comment above.
  { id: 'backfill-icons',                               when: 'always',         version: 2, optional: true },
  // Writes BOTH `frequencyScore` and `difficulty` in one pass, so a review of either
  // chip protects the row — mirrors the script's own validatedClause.
  { id: 'spanish/backfill-frequency-score',             when: 'always',         version: 5, validationFields: ['frequencyScore', 'difficulty'] },
  // Guards on 'definitions' too (re-clustering re-presents them) — mirrors the script.
  { id: 'spanish/backfill-cluster-definitions',         when: 'always',         version: 3, validationFields: ['definitions', 'senseFrequencyScore'] },
  { id: 'spanish/backfill-long-definitions',            when: 'always',         version: 2, validationFields: ['definitions'] },
  { id: 'spanish/backfill-example-sentences',           when: 'always',         version: 1, validationFields: ['exampleSentence0', 'exampleSentence1', 'exampleSentence2'] },
];

/**
 * Drop the opt-in (`optional`) steps from a manifest. This is the ONE place the
 * default-off rule lives: every helper below and every caller that does not pass an
 * explicit step list goes through it, so an optional step is invisible unless someone
 * asked for it by name.
 */
export function requiredOnly(steps) {
  return steps.filter((s) => !s.optional);
}

/** The default (opt-in steps excluded) view of each manifest — computed once. */
const DEFAULT_SCRIPTS_ZH = requiredOnly(REQUIRED_SCRIPTS_ZH);
const DEFAULT_SCRIPTS_ES = requiredOnly(REQUIRED_SCRIPTS_ES);

/**
 * Manifest for a language code. Throws on a language with no pipeline.
 * @param {{includeOptional?: boolean}} [opts] - includeOptional:true adds the opt-in
 *   steps (today: `backfill-icons`). Default false — see the `optional` header bullet.
 */
export function scriptsForLanguage(language, { includeOptional = false } = {}) {
  switch (language) {
    case 'zh': return includeOptional ? REQUIRED_SCRIPTS_ZH : DEFAULT_SCRIPTS_ZH;
    case 'es': return includeOptional ? REQUIRED_SCRIPTS_ES : DEFAULT_SCRIPTS_ES;
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
 * The distinct validation fields any manifest step writes (for approval lookups).
 * Union across languages: it is only ever used to bound a `validations` lookup, and
 * both pipelines write the same field names, so a union costs nothing and cannot
 * under-fetch when a caller plans a language this list was not derived from.
 */
export const VALIDATION_FIELDS = [...new Set(
  [...REQUIRED_SCRIPTS_ZH, ...REQUIRED_SCRIPTS_ES].flatMap((s) => s.validationFields || [])
)];

// ── cross-row drift probes (the THIRD staleness axis) ──────────────────────────
//
// `when` and `version` are per-row and compile into buildIncompletePredicate. A drift
// probe cannot: whether a row is stale depends on OTHER rows' data, so it is a
// set-returning query the caller runs ONCE per round and OR-s into its candidate scope.
//
// Each probe is `{ step, describe, sql(detTable) }`, where `sql` returns
// `(id int, word1 text)` — every det row whose stored output for `step` has been
// invalidated by a change elsewhere. Keep them SET-BASED: the obvious correlated
// `NOT EXISTS` form of breakdownSenseOrphan takes >120s on the zh corpus, while the
// hash-joined form below runs in ~30ms over the same 114k rows.

/** @type {Record<string, {step: string, describe: string, sql: (detTable: string) => string}>} */
export const DRIFT_PROBES = {
  /**
   * Orphaned breakdown sense pointers.
   *
   * backfill-breakdown-senses stores, per component character, the LABEL of the
   * `definitionClusters` entry that character carries inside this word — a label
   * rather than an index precisely so it survives re-clustering (the same stability
   * contract as vet.selectedSense, migration 99). But a re-clustering run may RENAME
   * or DROP the label, and then the pointer resolves to nothing: the stored
   * `definition` freezes at whatever the cluster said when it was tagged, the choice
   * can no longer be audited or refreshed, and nothing in the per-row signals notices.
   *
   * Example (2026-08-28): 下手's 手 stores sense "personally / by hand", which matches
   * no current 手 cluster — the nearest is "personally / first-hand" — and the gloss it
   * froze ("personal") is the wrong sense for 下手 in the first place.
   *
   * zh-only: es breakdowns do not exist (no `breakdown` column on dictionaryentries_es).
   */
  breakdownSenseOrphan: {
    step: 'chinese/backfill-breakdown-senses',
    describe: 'breakdown sense label no longer matches any cluster on the component character',
    sql: (detTable) => `
      WITH valid AS (
        SELECT c.word1 AS ch, cl->>'sense' AS sense
          FROM ${detTable} c,
               jsonb_array_elements(COALESCE(c."definitionClusters", '[]'::jsonb)) cl
         WHERE char_length(c.word1) = 1
      ), tagged AS (
        SELECT d.id, d.word1, kv.key AS ch, kv.value->>'sense' AS sense
          FROM ${detTable} d,
               jsonb_each(d.breakdown) kv
         WHERE d.breakdown IS NOT NULL
           AND jsonb_typeof(d.breakdown) = 'object'
           AND kv.value->>'sense' IS NOT NULL
      )
      SELECT DISTINCT t.id, t.word1
        FROM tagged t
        LEFT JOIN valid v ON v.ch = t.ch AND v.sense = t.sense
       WHERE v.ch IS NULL`,
  },
};

/**
 * The drift probes declared by `steps`, as `[probeName, probe]` pairs. Empty for a
 * manifest whose steps declare none (today: all of es).
 */
export function driftProbesFor(steps = DEFAULT_SCRIPTS_ZH) {
  return steps
    .filter((step) => step.driftProbe)
    .map((step) => [step.driftProbe, DRIFT_PROBES[step.driftProbe]])
    .filter(([name, probe]) => {
      if (!probe) throw new Error(`requiredScripts: unknown driftProbe "${name}"`);
      return true;
    });
}

// ── applicability ─────────────────────────────────────────────────────────────

/** SQL boolean: does a step's `when` hold for the det row at `alias`? */
function conditionSql(when, alias) {
  switch (when) {
    case 'always':    return 'TRUE';
    case 'multiChar': return `char_length(${alias}.word1) > 1`;
    case 'multiDef':  return `jsonb_array_length(COALESCE(${alias}.definitions, '[]'::jsonb)) > 1`;
    // zh process-definitions-array: something to reorder OR a headline too long for the
    // card. MUST match HAS_WORK_CLAUSE in that script — the planner's copy of its gate.
    case 'multiDefOrLongLead':
      return `(jsonb_array_length(COALESCE(${alias}.definitions, '[]'::jsonb)) > 1`
        + ` OR char_length(COALESCE(${alias}.definitions->>0, '')) > ${MAX_FIRST_GLOSS_LEN})`;
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
    case 'multiDefOrLongLead':
      return defs.length > 1 || String(defs[0] ?? '').length > MAX_FIRST_GLOSS_LEN;
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
 * @param {Array} steps - which manifest steps to consider (default: the zh manifest
 *   MINUS its opt-in `optional` steps; pass `scriptsForLanguage(lang, opts)`, or any
 *   subset, to narrow — or to widen, via `{includeOptional: true}`)
 */
export function pendingSteps(row, approvedFields = new Set(), steps = DEFAULT_SCRIPTS_ZH,
                             driftedStepIds = new Set()) {
  return steps.filter((step) => {
    if (!appliesTo(step, row)) return false;
    // Approval still wins over drift: a validator-reviewed field is authoritative even
    // when the data it was derived from moved (mirrors validatedClause in the scripts).
    if (isProtected(step, approvedFields)) return false;
    const { present, version } = stampInfo(row, step.id);
    if (!present || version < step.version) return true;
    // Third axis: stamped and current, but a DRIFT PROBE says another row invalidated
    // this step's output. See DRIFT_PROBES.
    return driftedStepIds.has(step.id);
  });
}

/**
 * VERSION-aware completeness (promotion gate): every applicable step is either
 * approval-protected or stamped at its CURRENT manifest version. Matches
 * `pendingSteps` (a word promotes exactly when nothing is pending). Every pipeline
 * script now honors `--stale`, so a version-stale step can always be brought current
 * — there is no stuck state. `steps` defaults to the zh manifest without its opt-in
 * steps, so an `optional` step never keeps a row from promoting.
 */
export function isComplete(row, approvedFields = new Set(), steps = DEFAULT_SCRIPTS_ZH,
                           driftedStepIds = new Set()) {
  return steps.every((step) => {
    if (!appliesTo(step, row)) return true;
    if (isProtected(step, approvedFields)) return true;
    const { present, version } = stampInfo(row, step.id);
    if (!(present && version >= step.version)) return false;
    // A drifted step is NOT complete — otherwise a row whose breakdown pointers have
    // been orphaned would promote (or stay promoted) carrying an unauditable sense.
    return !driftedStepIds.has(step.id);
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
export function buildIncompletePredicate(alias = 'de', steps = DEFAULT_SCRIPTS_ZH) {
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
export function buildCompletePredicate(alias = 'de', steps = DEFAULT_SCRIPTS_ZH) {
  return `NOT ${buildIncompletePredicate(alias, steps)}`;
}

export default REQUIRED_SCRIPTS_ZH;
