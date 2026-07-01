/**
 * Shared gloss-ordering core (Chinese).
 *
 * Extracted verbatim from backfill-process-definitions-array.js so the
 * definition-clustering backfill can order glosses WITHIN each sense cluster
 * using the identical Pass-1/Pass-2 pipeline — one source of truth (decision 5
 * of the definition-clusters design; see docs/DEFINITION_CLUSTERS.md).
 *
 * This module owns:
 *   - the ranking prompts (Pass 1 reorder/prune, Pass 2 critic, short-gloss),
 *   - the pure validation + parenthetical helpers,
 *   - a factory (createGlossOrderer) that binds the API primitives to an
 *     Anthropic client + cachedSystem.
 *
 * It deliberately does NOT own orchestration (review logging, spot-check
 * printing, DB writes, the run loop) — that stays in each caller's run().
 *
 * Referenced by:
 *   - scripts/backfill/chinese/backfill-process-definitions-array.js (flat array)
 *   - scripts/backfill/chinese/backfill-cluster-definitions.js (per-cluster)
 */

// The card's headline slot wants a punchy gloss. If a leading definition
// exceeds this many characters, callers synthesize a short replacement gloss to
// prepend (see generateShortGloss).
export const MAX_FIRST_GLOSS_LEN = 20;

// ─── Pass 1 prompt ──────────────────────────────────────────────────────────
// Tuned for the failures we observed: parenthetical confusion (一下), modern
// frequency vs linguistic prototypicality (密码), and cedict's bias of listing
// archaic senses first.

export const PASS1_SYSTEM = `You are a Chinese linguistics expert ranking English definitions of a Chinese word for a modern (2020s) Mandarin learner's vocabulary card.`;

// Static instruction body (identical every call) → cached system block. The
// per-entry word + definitions array stays in the user message (pass1User).
export const PASS1_INSTRUCTIONS = `Reorder the given word's definitions from most to least useful for a modern learner, and remove very low-confidence glosses.

Ranking principles (apply in order):
1. FIRST — The sense a modern Mandarin learner is most likely to encounter today. For everyday loanwords and tech terms, this is the modern usage, not the etymological core. (e.g. for 密码, "password" beats "cipher"; for 电脑, "computer" beats anything literal.)
2. NEXT — The core lexical meaning the word is built around, and metaphorical/extended senses that flow from it.
3. LATER — Contextually RESTRICTED senses: definitions whose parenthetical narrows *when/where* the sense applies. Examples that count as restrictive: "(after a personal pronoun)", "(before a verb)", "(of two people)", "(on restaurant menus)", "(bound form)", "(polite)", "(coll.)".
4. LATER — Grammaticalized or functional uses: verb complements, particles, discourse markers, filler words, classifier uses.
5. LAST — Archaic, literary, dialectal, technical-only, or rare senses: "(archaic)", "(literary)", "(old)", "(dialect)", "(Tw)", "(slang)", "(math.)", etc.

Important distinctions:
- A parenthetical that EXPLAINS a sense (e.g. "a little (indicating brief duration, or softening the tone)") does NOT make it restrictive — it's just clarifying the same primary meaning. Do not demote it.
- A parenthetical that NARROWS the sense to a specific context (e.g. "(of two people) to fall in love") IS restrictive — demote.
- The input order is NOT a signal. Cedict often lists archaic or literary senses first; ignore that.
- When two senses are equally core, prefer whichever a learner hears more often in spoken Mandarin today.

Removal (be conservative — when in doubt, KEEP the gloss and just rank it low):
Remove a definition ONLY if it is genuinely low-value for a modern learner:
- Broken English — the gloss is grammatically broken or reads as unintelligible English on its own (e.g. "doing while").
- Incredibly rare / archaic — a sense so obscure, archaic, or specialized that a modern learner will essentially never meet it, AND its meaning is already covered by another surviving gloss.
Never remove a sense that is the only one of its kind, and never remove every definition — always return at least one.

Parenthetical-only entries:
- An "exclusively parenthetical" gloss is one whose entire text is a parenthetical note (e.g. "(literary)", "(used before a verb)"). KEEP these — they carry usage information — but they must NEVER be placed first. Always rank at least one substantive (non-parenthetical) gloss ahead of any exclusively-parenthetical one.

Worked examples:

Word: 一边
Input:  ["doing while", "one side", "either side", "on the one hand", "on the other hand"]
Output: ["one side", "either side", "on the one hand", "on the other hand"]
Reason: "doing while" is broken English; removed. The remaining glosses cover the noun and paired-contrast senses.

Word: 一下
Input:  ["all at once", "suddenly", "a little (indicating brief duration, or softening the tone, or suggesting giving something a try)", "(after a verb) a bit"]
Output: ["a little (indicating brief duration, or softening the tone, or suggesting giving something a try)", "(after a verb) a bit", "all at once", "suddenly"]
Reason: "a little..." is the prototypical modern sense (看一下); the parenthetical explains, not restricts. "(after a verb) a bit" is contextually restrictive but still common. "all at once / suddenly" are extended senses.

Word: 像
Input:  ["image", "portrait", "appearance", "to resemble", "to be like", "to look as if", "such as", "image under a mapping (math.)"]
Output: ["to resemble", "to be like", "to look as if", "such as", "appearance", "image", "portrait", "image under a mapping (math.)"]
Reason: Verb senses dominate in modern usage. Noun senses follow. Math sense last.

Word: 密码
Input:  ["secret code", "cipher", "password", "PIN"]
Output: ["password", "PIN", "secret code", "cipher"]
Reason: Modern Mandarin 密码 overwhelmingly means "password" (login/banking). "cipher / secret code" are older general senses.

Rules:
- You MAY drop low-value definitions per the Removal guidance above, but you must NEVER add, rephrase, or alter any string. Every definition you return must be copied character-for-character exactly as it appears in the input, including parenthetical notes, punctuation, and formatting.
- Return at least one definition; never return an empty array.
- Do not place an exclusively-parenthetical gloss first.
- Return ONLY a valid JSON array of strings, no explanation.`;

export function pass1User(word, definitions) {
  return `Word: ${word}

Definitions:
${JSON.stringify(definitions, null, 2)}`;
}

// ─── Pass 2 critic prompt ───────────────────────────────────────────────────

export const PASS2_SYSTEM = `You are a Chinese linguistics expert reviewing a junior annotator's ranking of English definitions for a modern Mandarin learner's vocabulary card.`;

// Static instruction body → cached system block; per-entry word + the two orderings
// go in the user message (pass2User). All instructions lead so the cached prefix is
// byte-identical across calls.
export const PASS2_INSTRUCTIONS = `Review the proposed ordering for the given word and decide whether to confirm, refine, or flag it.

Ranking principles (the junior was given these — apply the same ones):
1. FIRST — sense a modern (2020s) Mandarin learner is most likely to encounter; for loanwords/tech terms, modern usage beats etymological core.
2. NEXT — core lexical meaning + metaphorical extensions.
3. LATER — senses with restrictive parentheticals "(after a verb)", "(of two people)", "(bound form)", "(coll.)", "(polite)", etc.
4. LATER — grammaticalized/functional uses (particles, complements, classifiers).
5. LAST — archaic/literary/dialectal/technical-only/rare senses.

The junior was also told to PRUNE very low-confidence glosses:
- Broken English (e.g. "doing while").
- Incredibly rare/archaic senses already covered by another surviving gloss.
Exclusively parenthetical glosses (e.g. "(literary)") are kept but must never rank first.

Common mistakes to catch:
- Demoting a sense because of an EXPLANATORY parenthetical (e.g. "(indicating brief duration)") — these are not restrictive.
- Promoting an etymological "core" over a more frequent modern sense (e.g. ranking "cipher" above "password" for 密码).
- Trusting the input order. Cedict often lists archaic senses first.
- Burying a high-frequency colloquial sense just because it has "(coll.)".
- Keeping a broken-English or never-used archaic gloss the junior should have pruned — drop it.
- Wrongly dropping a valid, useful sense — restore it (copy it verbatim from the original input).
- Placing an exclusively-parenthetical gloss first.

Decide:
- "confirmed" — the junior's order is fine as-is.
- "refined" — you have a clearly better order. Provide it.
- "low_confidence" — multiple defensible orderings; flag for human review. Still provide your best guess for finalOrder.

Return ONLY a JSON object, no explanation outside the JSON:
{
  "action": "confirmed" | "refined" | "low_confidence",
  "finalOrder": [<kept definitions, reordered and pruned>],
  "reason": "<one short sentence — required for refined and low_confidence; empty string for confirmed>"
}

Rules:
- finalOrder may DROP low-value definitions (broken English, incredibly rare/archaic), but every string it contains must come from the original input, character-for-character. Never add or rephrase.
- You may restore a definition the junior wrongly dropped — it must still come verbatim from the original input.
- Keep at least one definition, and do not place an exclusively-parenthetical gloss first.
- Return ONLY the JSON object.`;

export function pass2User(word, original, pass1) {
  return `Word: ${word}

Original input order:
${JSON.stringify(original, null, 2)}

Junior's proposed order:
${JSON.stringify(pass1, null, 2)}`;
}

// ─── Short leading-gloss synthesis ────────────────────────────────────────
// When a leading definition is too long for the card's headline slot
// (> MAX_FIRST_GLOSS_LEN chars), ask the model for ONE short gloss capturing the
// word's most common modern sense and prepend it. Unlike pass 1/2, this is
// intentionally a NEW string (not copied from the source), so it is validated
// only for length/shape and always surfaced for human review by the caller.

export const SHORT_GLOSS_SYSTEM = `You are a Chinese linguistics expert writing an ultra-concise English headword gloss for a modern Mandarin learner's vocabulary card.`;

// Static instruction body → cached system block; word + definitions → user message.
export const SHORT_GLOSS_INSTRUCTIONS = `The given word's card leads with a definition longer than ${MAX_FIRST_GLOSS_LEN} characters, which is too long for the card's headline slot.

Write ONE short English gloss — at most ${MAX_FIRST_GLOSS_LEN} characters, including spaces — that captures the word's most common modern (2020s) meaning. It will be shown first, ahead of the fuller definitions.

Requirements:
- ${MAX_FIRST_GLOSS_LEN} characters or fewer total.
- Reads like a clean dictionary headword gloss, NOT a sentence. No trailing period.
- No parentheticals, no usage notes, no examples.
- Base it on the most prototypical modern sense; the provided definitions (already ordered most- to least-useful) are your guide.

Return ONLY a JSON object, no explanation:
{ "gloss": "<short gloss>" }`;

export function shortGlossUser(word, definitions) {
  return `Word: ${word}

Existing definitions:
${JSON.stringify(definitions, null, 2)}`;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

export function parseJsonFromResponse(raw) {
  let cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

// An "exclusively parenthetical" gloss is one that, after trimming whitespace,
// both opens with "(" and closes with ")" (e.g. "(literary)", "(used before a
// verb)"). These are kept but must never rank first.
export function isExclusivelyParenthetical(def) {
  return typeof def === 'string' && /^\(.*\)$/.test(def.trim());
}

// If a parenthetical-only gloss leads while a substantive gloss survives, promote
// the second entry to first (a simple swap — per spec we do NOT retry the model
// for this). Returns the order unchanged when no fix is needed.
export function demoteLeadingParenthetical(order) {
  if (
    order.length > 1 &&
    isExclusivelyParenthetical(order[0]) &&
    order.some(d => !isExclusivelyParenthetical(d))
  ) {
    return [order[1], order[0], ...order.slice(2)];
  }
  return order;
}

// Validates a processed ordering that MAY prune entries. Invariants:
//   - it is a non-empty array
//   - every element exists verbatim in the original (no additions/rephrasing)
//   - no duplicates
// (The parenthetical-first rule is fixed up post-validation by
// demoteLeadingParenthetical, not enforced here.)
// `dropped` (entries present in original but not the candidate) is returned for
// logging so a human can review every removal.
export function validateProcessed(original, candidate) {
  if (!Array.isArray(candidate)) return { ok: false, error: 'not an array' };
  if (candidate.length === 0) return { ok: false, error: 'empty result' };
  const originalSet = new Set(original);
  const added = candidate.filter(d => !originalSet.has(d));
  if (added.length) return { ok: false, error: 'added/rephrased element', added };
  const candidateSet = new Set(candidate);
  if (candidateSet.size !== candidate.length) return { ok: false, error: 'duplicate element' };
  const dropped = original.filter(d => !candidateSet.has(d));
  return { ok: true, dropped };
}

// ─── API primitives factory ───────────────────────────────────────────────
// Binds the prompt + parse/retry logic to a specific Anthropic client and
// cachedSystem helper. Returns the same primitives the original flat-array
// script defined at module scope, so callers can drive their own orchestration.

const DEFAULT_PASS1_MODEL = 'claude-sonnet-4-6';
const DEFAULT_PASS2_MODEL = 'claude-sonnet-4-6';
const DEFAULT_RETRY_MODEL = 'claude-opus-4-8'; // used when a Sonnet response fails validation

export function createGlossOrderer({
  anthropic,
  cachedSystem,
  pass1Model = DEFAULT_PASS1_MODEL,
  pass2Model = DEFAULT_PASS2_MODEL,
  retryModel = DEFAULT_RETRY_MODEL,
}) {
  async function callPass1(word, definitions, model) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: cachedSystem(`${PASS1_SYSTEM}\n\n${PASS1_INSTRUCTIONS}`),
      messages: [{ role: 'user', content: pass1User(word, definitions) }],
    });
    const raw = response.content[0].text;
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrMatch) return { error: 'no array in response', raw };
    let parsed;
    try { parsed = JSON.parse(arrMatch[0]); }
    catch (e) { return { error: `JSON parse: ${e.message}`, raw }; }
    const v = validateProcessed(definitions, parsed);
    if (!v.ok) return { error: v.error, dropped: v.dropped, added: v.added, parsed };
    return { order: demoteLeadingParenthetical(parsed), dropped: v.dropped };
  }

  async function pass1Sort(word, definitions) {
    const first = await callPass1(word, definitions, pass1Model);
    if (!first.error) return { ...first, model: pass1Model };
    // Validation failed on Sonnet — retry with Opus
    const retry = await callPass1(word, definitions, retryModel);
    if (!retry.error) return { ...retry, model: retryModel, retried: true, firstError: first.error };
    return { error: `pass1 failed both models (sonnet: ${first.error}, opus: ${retry.error})` };
  }

  async function callPass2(word, original, pass1, model) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: cachedSystem(`${PASS2_SYSTEM}\n\n${PASS2_INSTRUCTIONS}`),
      messages: [{ role: 'user', content: pass2User(word, original, pass1) }],
    });
    const raw = response.content[0].text;
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (!objMatch) return { error: 'no object in response', raw };
    let parsed;
    try { parsed = JSON.parse(objMatch[0]); }
    catch (e) { return { error: `JSON parse: ${e.message}`, raw }; }
    if (!parsed.action || !Array.isArray(parsed.finalOrder)) {
      return { error: 'malformed critic response', parsed };
    }
    const v = validateProcessed(original, parsed.finalOrder);
    if (!v.ok) return { error: v.error, dropped: v.dropped, added: v.added, parsed };
    return {
      action: parsed.action,
      order: demoteLeadingParenthetical(parsed.finalOrder),
      reason: parsed.reason || '',
      dropped: v.dropped,
    };
  }

  async function pass2Critique(word, original, pass1) {
    const first = await callPass2(word, original, pass1, pass2Model);
    if (!first.error) return { ...first, model: pass2Model };
    const retry = await callPass2(word, original, pass1, retryModel);
    if (!retry.error) return { ...retry, model: retryModel, retried: true, firstError: first.error };
    return { error: `pass2 failed both models (sonnet: ${first.error}, opus: ${retry.error})` };
  }

  async function callShortGloss(word, definitions, model) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 256,
      system: cachedSystem(`${SHORT_GLOSS_SYSTEM}\n\n${SHORT_GLOSS_INSTRUCTIONS}`),
      messages: [{ role: 'user', content: shortGlossUser(word, definitions) }],
    });
    const raw = response.content[0].text;
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (!objMatch) return { error: 'no object in response', raw };
    let parsed;
    try { parsed = JSON.parse(objMatch[0]); }
    catch (e) { return { error: `JSON parse: ${e.message}`, raw }; }
    const gloss = typeof parsed.gloss === 'string' ? parsed.gloss.trim() : '';
    if (!gloss) return { error: 'empty gloss' };
    if (gloss.length > MAX_FIRST_GLOSS_LEN) return { error: `gloss too long (${gloss.length} chars)` };
    if (isExclusivelyParenthetical(gloss)) return { error: 'gloss is parenthetical-only' };
    return { gloss };
  }

  async function generateShortGloss(word, definitions) {
    const first = await callShortGloss(word, definitions, pass1Model);
    if (!first.error) return { ...first, model: pass1Model };
    // Validation failed on Sonnet — retry with Opus.
    const retry = await callShortGloss(word, definitions, retryModel);
    if (!retry.error) return { ...retry, model: retryModel, retried: true, firstError: first.error };
    return { error: `short-gloss failed both models (sonnet: ${first.error}, opus: ${retry.error})` };
  }

  return { callPass1, pass1Sort, callPass2, pass2Critique, callShortGloss, generateShortGloss };
}
