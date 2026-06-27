/**
 * Strip all parenthetical substrings from a definition string for display.
 * Does not mutate the underlying database value.
 * e.g. "to go (informal); to leave (a place)" → "to go; to leave"
 */
export function stripParentheses(text: string): string {
  return text.replace(/\s*\([^)]*\)/g, '').trim();
}

// Ordered leading-phrase strips applied (after stripParentheses) to turn a card's
// English definition into an icons8 *search* term. Verb infinitives / copulas search
// far better without their leading particle: "to understand" -> "understand",
// "to be hungry" -> "hungry". Add new strip rules to this list so every caller stays
// in sync — DO NOT inline a strip regex at a call site.
const ICON_SEARCH_LEADING_STRIPS: RegExp[] = [
  /^to\s+be\s+/i,   // copular infinitive ("to be hungry")
  /^to\s+/i,        // plain infinitive ("to understand")
];

/**
 * Build the default icons8 search term for an entry from its English definition.
 *
 * The input is the entry's display definition (det `definitions[0]`); we apply the
 * same `stripParentheses` the card's EnglishBlock uses so the search matches what the
 * learner actually sees, then the leading-phrase strips above. Returns "" for a
 * missing/empty definition.
 *
 * Single source of truth for the picker pre-fill AND the prefetch/cache warm
 * (docs/CARD_ICON_LAYOUT.md). Pure string transform — no DB, no locale dependence.
 */
export function iconSearchTerm(definition: string | null | undefined): string {
  let term = stripParentheses(definition ?? '');
  for (const re of ICON_SEARCH_LEADING_STRIPS) term = term.replace(re, '');
  return term.trim();
}
