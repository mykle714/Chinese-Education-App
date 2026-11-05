/**
 * Short lead gloss for ONE SENSE CLUSTER — the cluster-level counterpart of the
 * word-level short-gloss synthesis in step 4 (process-definitions-array).
 *
 * LAYER: data-enrichment (backfill) shared lib, language-parameterised (zh + es).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Step 4 (`chinese/lib/orderGlosses.js` → `generateShortGloss`, and its hand-copied
 * Spanish twin in `spanish/backfill-process-definitions-array.js`) guarantees that
 * `definitions[0]` is ≤ MAX_FIRST_GLOSS_LEN characters by PREPENDING a synthesized
 * gloss. That guarantee stopped reaching the card when the dd moved onto clusters:
 * a word with ≥2 displayable clusters shows `ddt(cluster)` = the cluster's
 * `glosses[0]`, and the clusterer (step 6) copies source glosses verbatim and
 * re-sorts them with no length rule. So the step-4 short gloss was either sorted
 * behind the long source gloss (一下 "a little (indicating brief duration…)" over
 * "a bit") or landed in another sense entirely, and non-default senses were never
 * length-checked at all. A 2026-11-03 dev audit: 1,621 zh / 449 es cluster lead
 * glosses over 20 displayed characters.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 * `needsShortGloss(cluster)` — the DISPLAYED lead (`stripParentheses(glosses[0])`,
 * i.e. exactly what `ddt` renders) is longer than MAX_FIRST_GLOSS_LEN.
 * `generateSenseShortGloss(word, cluster)` — asks for ONE ≤20-char gloss for THIS
 * sense (Sonnet, Opus on retry). The prompt is the step-4 prompt re-scoped from "the
 * word's most common meaning" to "this sense": the word-level wording, run per
 * cluster, would give every sense of a word the same headline (the same failure
 * mode as the frequency scorer's § THE BUG in chinese/lib/frequencyScore.js).
 * `withShortGlossFirst(glosses, gloss)` — the new gloss goes to the FRONT; if the
 * model returned a gloss the cluster already has, that gloss is MOVED rather than
 * duplicated.
 *
 * ── INVARIANTS ──────────────────────────────────────────────────────────────
 * - Only `glosses` changes. `sense` labels are addresses (vet.selectedSense,
 *   longDefinition[].sense, est senseDict, breakdown[char].sense) and are untouched.
 * - The long source gloss is KEPT, right behind the new one — same as step 4.
 * - This is a NON-SOURCE string, so a cluster carrying one is no longer a strict
 *   partition of `definitions`. That was already true after Stage B pruning (see
 *   docs/DEFINITION_CLUSTERS.md § Ownership); the partition checks
 *   (zh `validatePartition`, es `checkShape`) validate MODEL OUTPUT inside a
 *   clustering call and run before this step, so they are unaffected.
 * - Every generated gloss is printed with a greppable marker for human review
 *   (stdout convention, not a file log).
 * - An oracle-mode export capture (`e.oracleExport`, run-log.js § ORACLE MODE)
 *   propagates; it is control flow, not a failure.
 *
 * Callers:
 *   - scripts/backfill/chinese/backfill-cluster-definitions.js  (after Stage C)
 *   - scripts/backfill/spanish/backfill-cluster-definitions.js  (before writeClusters)
 *   - scripts/backfill/shared/patch-long-cluster-glosses.js     (one-off repair of
 *     rows clustered before this step existed; no SCRIPT_VERSION bump)
 *   - scripts/backfill/chinese/lib/orderGlosses.js → generateShortGloss (step 4's
 *     word-level short gloss, via `askShortGloss`)
 * Classifier senses: see CLASSIFIER_PREFIX below and docs/DEFINITION_CLUSTERS.md
 * § "Classifier senses".
 * Documented in: docs/DEFINITION_CLUSTERS.md § "Short lead gloss per sense",
 *   docs/DEFINITION_MAPPING.md § 3 (dd).
 */

import { stripParentheses } from './stripParentheses.js';

// Same budget as step 4's MAX_FIRST_GLOSS_LEN (chinese/lib/orderGlosses.js and the
// Spanish process-definitions-array). Kept as its own constant rather than imported
// from chinese/lib so the es clusterer does not depend on a zh module; the three must
// agree — change them together.
export const MAX_SENSE_GLOSS_LEN = 20;

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_RETRY_MODEL = 'claude-opus-4-8';

// Greppable stdout marker for every synthesized gloss (human review channel).
export const SHORT_GLOSS_MARKER = '⚠ SHORT GLOSS REVIEW';

/** The string `ddt` renders for this cluster (first gloss, parentheticals stripped). */
export function displayedLead(cluster) {
  const g = Array.isArray(cluster?.glosses) ? cluster.glosses[0] : null;
  return stripParentheses(typeof g === 'string' ? g : '');
}

// ── Classifier senses ─────────────────────────────────────────────────────────
// House style (agreed 2026-11-03): a classifier (measure-word) sense reads
// "classifier for <what it counts>" — "classifier for books". The client renders the
// fixed label in italics (src/utils/definitionUtils.ts → splitClassifierLabel), and the
// label does NOT count toward MAX_SENSE_GLOSS_LEN: it is a fixed tag, like a
// part-of-speech chip, so only "books" is budgeted. Keep the prefix in lockstep with
// CLASSIFIER_LABEL in src/utils/definitionUtils.ts.
export const CLASSIFIER_PREFIX = 'classifier for ';

/**
 * A PURE classifier sense: every pos entry is "classifier". A mixed sense such as
 * 米 ["classifier","noun"] "meter" is a unit noun Chinese happens to count directly —
 * it keeps its noun gloss and is NOT reformatted (see docs/DEFINITION_CLUSTERS.md
 * § "Classifier senses").
 */
export function isClassifierSense(cluster) {
  const pos = Array.isArray(cluster?.pos) ? cluster.pos.filter(Boolean) : [];
  return pos.length > 0 && pos.every((p) => p === 'classifier');
}

/** Characters that count toward the budget: the text after a leading classifier label. */
export function budgetedLength(text) {
  const t = String(text ?? '');
  return t.toLowerCase().startsWith(CLASSIFIER_PREFIX) ? t.length - CLASSIFIER_PREFIX.length : t.length;
}

/**
 * True when the card would show more than MAX_SENSE_GLOSS_LEN budgeted characters for
 * this sense. An EMPTY display (entirely parenthetical lead) is not "long" — that is
 * the non-displayable case owned by chinese/rewrite-parenthetical-glosses.js.
 */
export function needsShortGloss(cluster) {
  return budgetedLength(displayedLead(cluster)) > MAX_SENSE_GLOSS_LEN;
}

/** A pure classifier sense whose lead is not yet in "classifier for …" form. */
export function needsClassifierFormat(cluster) {
  if (!isClassifierSense(cluster)) return false;
  const lead = displayedLead(cluster);
  return lead !== '' && !lead.toLowerCase().startsWith(CLASSIFIER_PREFIX);
}

/** Either reason to write this sense a new headline. */
export function needsNewHeadline(cluster) {
  return needsShortGloss(cluster) || needsClassifierFormat(cluster);
}

/**
 * New gloss list with `gloss` first. If the cluster already holds that exact string
 * (trim-equal), it is moved instead of duplicated. Pure.
 */
export function withShortGlossFirst(glosses, gloss) {
  const list = Array.isArray(glosses) ? glosses : [];
  const existingIdx = list.findIndex((g) => typeof g === 'string' && g.trim() === gloss);
  if (existingIdx >= 0) {
    return { glosses: [list[existingIdx], ...list.filter((_, i) => i !== existingIdx)], action: 'promoted' };
  }
  return { glosses: [gloss, ...list], action: 'prepended' };
}

function systemText(language) {
  return `You are a ${language} linguistics expert writing an ultra-concise English gloss for ONE SENSE of a word on a modern ${language} learner's vocabulary card.`;
}

// Static body → cached system block; the per-cluster data goes in the user message.
function instructions() {
  return `You are writing the card headline for one sense of a word.

Write ONE short English gloss — at most ${MAX_SENSE_GLOSS_LEN} characters, including spaces — that captures THIS SENSE of the word. The word may have other senses; do NOT describe them — only the sense named by the label and shown by its glosses. It will be shown first, ahead of the fuller definitions.

Requirements:
- ${MAX_SENSE_GLOSS_LEN} characters or fewer total.
- Reads like a clean dictionary headword gloss, NOT a sentence. No trailing period.
- No parentheticals, no square brackets, no usage notes, no examples, no Chinese characters.
- Never abbreviate or clip a word: no "sb", "sth", "etc", "govt", "dept", "Univ", "tech", "intel", "psych", "med", "clf", "cl.", "abbr.", and no "...". Write every word in full.
- If your idea does not fit, choose a DIFFERENT, simpler phrase that fits naturally — do not squeeze the same phrase by dropping articles or cutting words into a telegram.
- Keep the part of speech: a verb sense normally reads "to …" (but a modal such as "must", "can", "should" never takes "to"); a noun sense is a noun.
- CLASSIFIER senses (marked "CLASSIFIER" below) MUST read "classifier for <what it counts, plural>" — e.g. "classifier for books", "classifier for flat objects". The words "classifier for " do NOT count toward the ${MAX_SENSE_GLOSS_LEN}-character limit. Only a sense marked CLASSIFIER may start with "classifier".
- It must read differently from the word's OTHER senses' headlines, which are listed when present — a learner choosing between senses must be able to tell them apart.
- If one of the sense's existing glosses already meets every requirement and captures the sense well, you may return it verbatim.
- Base it on the most prototypical modern (2020s) use of THIS sense; the sense label and its glosses (ordered most- to least-useful) are your guide.

Return ONLY a JSON object, no explanation:
{ "gloss": "<short gloss>" }`;
}

// `otherHeadlines` = the displayed leads of the word's OTHER senses (already-short
// ones and ones synthesized earlier in this entry), so the model can keep them apart.
function userText(word, cluster, otherHeadlines = []) {
  const pos = Array.isArray(cluster.pos) ? cluster.pos.filter(Boolean).join(', ') : (cluster.pos || '');
  return `Word: ${word}
Sense label: ${cluster.sense}${pos ? `\nPart of speech: ${pos}` : ''}${cluster.gender ? `\nGender: ${cluster.gender}` : ''}${isClassifierSense(cluster) ? '\nCLASSIFIER: yes — the gloss must read "classifier for …"' : ''}

This sense's glosses:
${JSON.stringify(cluster.glosses ?? [], null, 2)}${otherHeadlines.length ? `

Other senses' headlines (do not reuse):
${JSON.stringify(otherHeadlines)}` : ''}`;
}

/** Case/whitespace-insensitive key for "do two headlines read the same?". */
const headlineKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '').trim();

// Clipped or abbreviated words the model reached for when squeezing to the limit (the
// 2026-11-03 audit of 1,636 generated glosses: "psych warfare", "Northeastern Univ",
// "govt and education", "clf for expanses"). Whole-word, case-insensitive.
const BANNED_ABBREVIATIONS = /\b(sb|sth|etc|govt|gov|dept|univ|tech|intel|psych|interp|med|clf|cl|abbr|abbrev|approx|esp|info|admin)\b\.?/i;

/**
 * Shape/length validation of one model answer. Returns { gloss } or { error }.
 * @param {string} raw
 * @param {{ classifier?: boolean|null }} [opts]  true = a pure classifier sense (must
 *   read "classifier for …"); false = not one (may not start with "classifier");
 *   null = unknown, enforce neither — step 4 works on the flat `definitions` before any
 *   sense has a pos.
 */
export function validateShortGloss(raw, { classifier = null } = {}) {
  const gloss = typeof raw === 'string' ? raw.trim().replace(/\.$/, '') : '';
  if (!gloss) return { error: 'empty gloss' };
  const startsWithLabel = gloss.toLowerCase().startsWith(CLASSIFIER_PREFIX);
  if (classifier === true && !startsWithLabel) return { error: 'a classifier sense must read "classifier for …"' };
  if (classifier === false && /^classifier\b/i.test(gloss)) return { error: 'only a classifier sense may start with "classifier"' };
  if (startsWithLabel && !gloss.slice(CLASSIFIER_PREFIX.length).trim()) return { error: 'nothing after "classifier for"' };
  const len = budgetedLength(gloss);
  if (len > MAX_SENSE_GLOSS_LEN) {
    return { error: `gloss too long (${len} chars${startsWithLabel ? ' after "classifier for"' : ''})` };
  }
  // `ddt` strips parentheticals, so a "(…)" would make the stored and displayed
  // strings differ; brackets are Spanish usage notes, which `ddt` does NOT strip.
  if (/[()[\]]/.test(gloss)) return { error: 'gloss contains a parenthetical or bracket' };
  if (/\.\.\.|…/.test(gloss)) return { error: 'gloss contains an ellipsis' };
  if (/[\u3400-\u9fff]/.test(gloss)) return { error: 'gloss contains Chinese characters' };
  const abbr = gloss.match(BANNED_ABBREVIATIONS);
  if (abbr) return { error: `gloss uses the abbreviation "${abbr[0]}" — write the word in full or rephrase` };
  return { gloss };
}

/** Text of the FIRST `{…}` in a reply. Non-greedy: a model that adds a second object
 *  or a note containing braces after its answer must not break the parse (a greedy
 *  match spanned both and failed with "Unexpected non-whitespace character"). The
 *  answer shape is a flat { "gloss": "…" }, so the first `}` closes it. */
function firstObject(raw) {
  const m = String(raw ?? '').match(/\{[\s\S]*?\}/);
  return m ? m[0] : null;
}

/** Feedback line for the next attempt. For a length failure it states the exact
 *  overrun: models miscount characters, and "too long" alone gets the same
 *  21-character answer back (see the 2026-11-03 patch run: 57 such failures). */
function feedbackFor(rejected) {
  if (!rejected?.gloss) return '';
  const len = budgetedLength(rejected.gloss);
  const over = len - MAX_SENSE_GLOSS_LEN;
  const lengthHint = over > 0
    ? ` It is ${len} characters${len !== rejected.gloss.length ? ' after "classifier for"' : ''}; it must be at least ${over} shorter.`
    : '';
  return `\n\nYour previous answer "${rejected.gloss}" was rejected: ${rejected.error}.${lengthHint} Give a different answer.`;
}

/**
 * The shared short-gloss attempt loop, used by BOTH the per-sense step (below) and
 * step 4's word-level `generateShortGloss` (chinese/lib/orderGlosses.js), so their
 * parsing, validation and retry feedback cannot drift apart.
 *
 * Each attempt after the first carries the previous answer and why it was rejected.
 * No `temperature` is sent: Opus 4.8 rejects it.
 *
 * @param {{ anthropic, system: object[], userContent: string, models: string[],
 *           otherHeadlines?: string[], classifier?: boolean }} args  `system` is an
 *           already-cached block; `classifier` applies the classifier-format rule.
 * @returns {Promise<{gloss: string, model: string, retried?: true} | {error: string}>}
 */
export async function askShortGloss({ anthropic, system, userContent, models, otherHeadlines = [], classifier = null }) {
  const failures = [];
  let rejected = null;
  for (let i = 0; i < models.length; i++) {
    let r;
    try {
      const response = await anthropic.messages.create({
        model: models[i],
        max_tokens: 256,
        system,
        messages: [{ role: 'user', content: userContent + feedbackFor(rejected) }],
      });
      const obj = firstObject(response.content?.[0]?.text);
      if (!obj) r = { error: 'no object in response' };
      else {
        let parsed = null;
        try { parsed = JSON.parse(obj); } catch (e) { r = { error: `JSON parse: ${e.message}` }; }
        if (parsed) {
          const v = validateShortGloss(parsed.gloss, { classifier });
          const answered = typeof parsed.gloss === 'string' ? parsed.gloss.trim() : null;
          if (v.error) r = { ...v, gloss: answered };
          // Two senses with the same headline are indistinguishable in the sense picker.
          else if (otherHeadlines.some((h) => headlineKey(h) === headlineKey(v.gloss))) {
            r = { error: 'it is identical to another sense\'s headline', gloss: v.gloss };
          } else r = v;
        }
      }
    } catch (e) {
      if (e?.oracleExport) throw e; // oracle capture is control flow, not a failure
      r = { error: e.message };
    }
    if (!r.error) return { gloss: r.gloss, model: models[i], ...(i > 0 ? { retried: true } : {}) };
    failures.push(`${models[i]}: ${r.gloss ? `"${r.gloss}" ` : ''}${r.error}`);
    if (r.gloss) rejected = r;
  }
  return { error: `short gloss failed ${models.length} attempts (${failures.join('; ')})` };
}

/**
 * @param {{ anthropic, cachedSystem, language: 'Chinese'|'Spanish', model?, retryModel? }} deps
 */
export function createSenseShortGlosser({ anthropic, cachedSystem, language, model = DEFAULT_MODEL, retryModel = DEFAULT_RETRY_MODEL }) {
  const system = cachedSystem(`${systemText(language)}\n\n${instructions()}`);

  /**
   * Returns { gloss, model, retried? } or { error }. Oracle captures propagate.
   * @param {string[]} [otherHeadlines] the word's other senses' displayed leads
   */
  function generateSenseShortGloss(word, cluster, otherHeadlines = []) {
    return askShortGloss({
      anthropic, system, models: [model, model, model, retryModel],
      userContent: userText(word, cluster, otherHeadlines), otherHeadlines,
      classifier: isClassifierSense(cluster),
    });
  }

  /**
   * Apply to every long-lead cluster of ONE entry. Only multi-cluster entries are
   * touched: with <2 displayable clusters the dd reads `definitions[0]`, which step 4
   * already owns. Returns { clusters, changes: [{ sense, from, to, action, model }], errors }.
   * Pure with respect to its input (returns new cluster objects).
   */
  async function shortenLongLeads(word, clusters) {
    const changes = [];
    const errors = [];
    // Same `< 2 displayable` gate as sortedSenseClusters (src/utils/definitionUtils.ts).
    const displayable = Array.isArray(clusters) ? clusters.filter((c) => displayedLead(c) !== '').length : 0;
    if (displayable < 2) return { clusters, changes, errors };
    // Headlines of the other senses: the already-short ones, plus each one synthesized
    // so far in this entry (sequential on purpose, so sibling senses can't collide).
    const headline = clusters.map((c) => (needsNewHeadline(c) ? null : displayedLead(c)));
    const out = [];
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      if (!needsNewHeadline(c)) { out.push(c); continue; }
      const others = headline.filter((h, j) => j !== i && h);
      const r = await generateSenseShortGloss(word, c, others);
      if (!r.error) headline[i] = r.gloss;
      if (r.error) { errors.push({ sense: c.sense, error: r.error }); out.push(c); continue; }
      const { glosses, action } = withShortGlossFirst(c.glosses, r.gloss);
      changes.push({ sense: c.sense, from: displayedLead(c), to: r.gloss, action, model: r.model });
      out.push({ ...c, glosses });
    }
    return { clusters: out, changes, errors };
  }

  return { generateSenseShortGloss, shortenLongLeads };
}

/** One review line per change/error, in the stdout review-channel format. */
export function printShortGlossReview(word, id, { changes = [], errors = [] }) {
  for (const ch of changes) {
    console.log(`${SHORT_GLOSS_MARKER} ${word} (id=${id}) [${ch.sense}]: "${ch.from}" → "${ch.to}" (${ch.action}, ${ch.model})`);
  }
  for (const er of errors) {
    console.log(`${SHORT_GLOSS_MARKER} ${word} (id=${id}) [${er.sense}]: FAILED — ${er.error}`);
  }
}
