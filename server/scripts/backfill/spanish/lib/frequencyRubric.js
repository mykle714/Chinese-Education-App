/**
 * The Spanish CONVERSATIONAL-COMMONALITY rubric — one source of truth for the 1-5
 * `frequencyScore` scale, shared by the word-level scorer and the per-cluster scorer.
 *
 * LAYER: data-enrichment (backfill) shared lib, Spanish side. Mirrors the Chinese
 * arrangement in chinese/lib/frequencyScore.js: the SCALE is language-specific
 * (its anchor words are), the BAND NAMES are not (shared/lib/frequencyLabels.js).
 *
 * WHY IT WAS EXTRACTED (2026-08-28): the rubric lived inside
 * spanish/backfill-frequency-score.js, so the Spanish CLUSTERER could not reach it —
 * it built its scoring instruction from the five band NAMES alone, with no anchor
 * words and no guidelines. Per-cluster es scores were therefore made on a much
 * thinner brief than word-level ones, on the same column. Both now share this text.
 *
 * ⚠ THE AXIS CHANGED ON 2026-08-28 (no migration — still a 1-5 smallint). It used to
 * ask "how OFTEN does this occur in speech"; it now asks "how much would this word
 * STAND OUT if a friend said it in casual conversation". Bands 4 and 5 merged, and the
 * freed slot went to the bottom (old band 1 split into 1 and 2). Every es score
 * written before this date is on the old axis — the SCRIPT_VERSION bumps on both
 * callers mark those rows stale.
 *
 * TODO(es-linguistics): the anchor words per band are still first-pass and want a
 * Spanish speaker's review, and a target-dialect baseline, before a real run.
 *
 * Referenced by: spanish/backfill-frequency-score.js,
 *   spanish/backfill-cluster-definitions.js
 * Documented in: docs/DEFINITION_MAPPING.md, docs/DEFINITION_CLUSTERS.md
 */

export const SCALE_AND_GUIDELINES = `Scale — if a friend said this word to you in a CASUAL conversation, how much would it stand out?
  5 = Everyday — you will hear or say it this week without trying; the basic vocabulary of food, family, time, feelings, work, getting around (e.g. comer, casa, tiempo, bueno, mañana, trabajo, ayudar)
  4 = Common when the topic comes up — not daily, but completely normal in ordinary talk; nobody would think twice (e.g. libertad, medio ambiente, gobierno, cirugía)
  3 = Unremarkable — you would NOT be surprised to hear it in casual conversation, even if you would not reach for it yourself (e.g. actualmente, por lo tanto, acuerdo)
  2 = Odd but forgivable — you would notice it. Stiff, bookish or specialist for casual talk, but the conversation carries on (e.g. exponer, índole, no obstante)
  1 = Would stop the conversation — genuinely strange to say to a friend: literary, archaic, or hyper-technical (e.g. otrora, asaz, henchir, mas meaning "but")

Guidelines:
  - THE AXIS IS HOW MUCH THE WORD STANDS OUT, not how many times a day it occurs. 5 and 4 are separated by frequency; 3, 2 and 1 are separated by how strange the word would sound in casual speech. Ask "would a friend saying this make me blink?" before you ask "how often is it said?".
  - RECOGNITION COUNTS. A word everyone knows but rarely reaches for is a 3 — unremarkable — NOT a 2. Only drop to 2 when hearing it casually would actually make a listener notice.
  - Formal flavour alone is not a penalty. gobierno is formal and still a 4. Formality costs points only at the point where it becomes conspicuous in casual talk.
  - Do not raise a score because a word is vivid slang. Slang confined to one region or subculture is a 2: most listeners WOULD notice it.
  - Judge the word as a SPOKEN item; ignore how often it appears in written corpora, textbooks, or news.
  - Calibration: these words were chosen to be taught to learners, so most of them belong in 3-5. Reserve 2 and 1 for words that would genuinely make a listener pause — do not spend them on words that are merely not daily.`;

/**
 * The ONE line that differs between the two callers — the same split the Chinese
 * scorer makes, and for the same reason: WORD mode resolves polysemy by taking the
 * word's most ordinary meaning, while SENSE mode must do the opposite and let a
 * common word's rare sense score low, or clustering buys nothing.
 */
export const POLYSEMY_GUIDELINE = {
  word: `  - If a word has multiple meanings, score the one that would stand out LEAST — its most everyday meaning.`,
  sense: `  - Score ONLY the sense stated above. IGNORE how ordinary the word is in its other meanings — a very common word's rare sense must score LOW. Score the sense in front of you, not the headword.`,
};
