/**
 * stripParentheses — the ONE display-gloss paren transform for the backfill scripts.
 *
 * LAYER: data-enrichment (backfill) utility layer.
 *
 * WHY THIS FILE EXISTS
 *   Three backfill scripts each carried their own `\s*\([^)]*\)` copy of this
 *   transform (senseClusters.js `clusterLeadGloss`/`isDisplayable`,
 *   chinese/backfill-breakdown-senses.js's local `clusterLeadGloss`, and
 *   backfill-icons.js's local `stripParentheses`). They had already DRIFTED from the
 *   app: `src/utils/definitionUtils.ts` and `server/utils/definitions.ts` replaced
 *   that regex with a depth-tracking scanner so nested asides strip correctly, and
 *   the backfill copies never followed — a regex stops at the FIRST ')', so
 *   "to box (fight against (a person) in a match)" left ") in a match" behind in
 *   whatever the backfill wrote to the database.
 *
 *   So the copies were not just duplication, they were a silent behavior fork on the
 *   WRITE path. This module is the single JS implementation; the two TypeScript
 *   twins stay hand-synced (client and server builds are separate, and this file sits
 *   outside the server tsconfig `include`) — see the parity note in each.
 *
 * Referenced by: shared/lib/senseClusters.js, chinese/backfill-breakdown-senses.js,
 * backfill-icons.js, docs/DEFINITION_MAPPING.md.
 * Twins (keep in sync by hand): src/utils/definitionUtils.ts,
 * server/utils/definitions.ts — server/__tests__/definitions.test.ts asserts parity.
 */

/**
 * Unwrap INLINE MORPHEMES before the aside scanner runs.
 *
 * A parenthetical GLUED to a word (no space on at least one side) whose content is a
 * short run of lowercase letters is part of the word, not an aside about it:
 *   "personal(ly)" · "child(ren)" · "circle(s)" · "remain(s)" · "(hand)bag"
 * Deleting it turns an adverb into an adjective — 手's cluster gloss "personal(ly)"
 * used to reach the flashcard as the bare adjective "personal", which is how 下手's
 * breakdown came to read that way.
 *
 * The `^[a-z]{1,4}$` content test is what separates these from a real aside that
 * merely lost its space — "skimming(of milk)", "prescription(same as 丹方)",
 * "(idiom)fig." — which are shaped IDENTICALLY at the parenthesis and must still be
 * stripped. Adjacency alone cannot tell the two apart; only the content can.
 * Measured against the whole det corpus (2026-08-28): fires on 50 of the 118 glued
 * strings, declines all 12 missing-space asides and all 35 chemical/math formulas
 * ("Ca(OH)2", "(CH2O)6" — uppercase or digit-bearing content).
 *
 * Two accepted errors at that threshold, both on non-discoverable rows:
 *   • misses the longer optional prefixes — "(house)wife", "(roller)blading",
 *     "(tender)loin" render as "wife" / "blading" / "loin";
 *   • fires wrongly on "manganese(iv) oxide" → "manganeseiv oxide".
 * Widening the cap past 4 starts eating "(idiom)", so 4 is the balance point.
 */
const INLINE_MORPHEME = /(?<=[A-Za-z0-9])\(([a-z]{1,4})\)|\(([a-z]{1,4})\)(?=[A-Za-z0-9])/g;

function unwrapInlineMorphemes(text) {
  return text.replace(INLINE_MORPHEME, (_match, glued, prefix) => glued ?? prefix);
}

/**
 * Strip all parenthetical substrings from a definition string for display.
 * Does not mutate the underlying database value.
 * e.g. "to go (informal); to leave (a place)" → "to go; to leave"
 * Nesting-aware: "a waiter (literally, one who runs (fast))" → "a waiter".
 * EXCEPTION — a short lowercase parenthetical glued to a word is an inline morpheme,
 * not an aside, and is rejoined rather than dropped: "personal(ly)" → "personally",
 * "(hand)bag" → "handbag". See unwrapInlineMorphemes for the exact rule.
 */
export function stripParentheses(text) {
  // Inline morphemes are rejoined FIRST; everything the scanner then sees is a
  // genuine aside. See unwrapInlineMorphemes above for why the split is by content.
  let src = unwrapInlineMorphemes(text ?? '');
  let out = '';
  let depth = 0;
  for (const ch of src) {
    // A '(' at any depth opens/deepens an aside; a ')' closes one. Tracking depth
    // (rather than the old /\s*\([^)]*\)/g) is what makes NESTED asides work: the
    // regex stopped at the FIRST ')', so 的's gloss — which nests a parenthetical
    // inside a quoted example — leaked its tail onto the flashcard.
    // Eat any whitespace already emitted before the aside, reproducing the old
    // regex's leading `\s*` — without this, "to go (informal); to leave" would
    // render "to go ; to leave" and "[+de (particle)]" would render "[+de ]".
    if (ch === '(') { if (depth === 0) out = out.replace(/\s+$/, ''); depth++; continue; }
    // An unmatched ')' (depth already 0) is dropped rather than kept: a lone close
    // paren is never displayable text, and it is exactly what 加 used to render.
    if (ch === ')') { if (depth > 0) depth--; continue; }
    if (depth === 0) out += ch;
  }
  return out.trim();
}
