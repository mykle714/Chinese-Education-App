// Resolve the per-language `vocabentries` table (vet) name from a language code.
// User vocab is split per language family (mirroring the det split, see CLAUDE.md):
// Chinese saved cards live in `vocabentries_zh`, Spanish in `vocabentries_es`. Both
// now share ONE identity — (userId, entryKey, language); es dropped `pos` from its key
// in migration 123, when a Spanish word stopped spanning multiple det rows. The two
// tables share one id sequence, so ids are globally unique across the pair.
//
// WHITELIST: only ever returns one of two fixed, hard-coded table names and never
// interpolates caller-controlled text, so the result is safe to splice into SQL.
// Anything that isn't explicitly Spanish falls back to the Chinese table.
export function vetTableForLanguage(language: string | null | undefined): string {
  return language === 'es' ? 'vocabentries_es' : 'vocabentries_zh';
}

// FROM source (aliased `ve`) for a language-scoped vet read that feeds DICT_JOIN.
//
// This used to wrap the zh table in a subquery that synthesized a NULL `pos` column,
// because DICT_JOIN's Spanish branch referenced `ve.pos` to pick between a word's
// several det rows. Migration 121 removed that need (one det row per word1, sense
// chosen via `selectedSense`), so both languages are now a plain aliased table and the
// zh read no longer pays for a wrapping subquery.
//
// Kept as its own function rather than inlined at the ~19 call sites: it marks which
// queries are DICT_JOIN reads, and gives any future per-language FROM divergence one
// place to live.
export function vetReadFrom(language: string | null | undefined): string {
  return `${vetTableForLanguage(language)} ve`;
}

// Both physical vet tables, for id-only operations that must hit whichever holds
// the row (exactly one matches, since ids are globally unique across the pair).
export const VET_PHYSICAL_TABLES = ['vocabentries_zh', 'vocabentries_es'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Bucket visibility (migration 140, docs/PROVISIONAL_CARDS.md)
// ─────────────────────────────────────────────────────────────────────────────
//
// A vet row is in one of two meaningful buckets, and EVERY vet read has to pick
// which of them it means. Getting this wrong is silent: a sorted-only read that
// forgets the filter starts leaking auto-granted cards into the user's deck, and a
// playable read that uses the strict filter refuses to hand a game the very cards
// that were just provisioned for it.
//
//   'library'     — the user deliberately sorted this card into Learn Now. Theirs.
//   'provisional' — the server auto-granted it so a game/flp could reach its
//                   baseline. A real row that accepts marks, but not the user's
//                   card until they sort it.
//
// Rule of thumb: if the query answers "what is in MY deck?" (search, library lists,
// counts shown as deck size, the community feed, reading-highlight ownership,
// level estimation) it is SORTED. If it answers "what can I put in front of the
// player right now?" (game pools, the flp working loop) it is PLAYABLE.
//
// Both take the table alias so they can be spliced into queries that alias vet as
// something other than `ve` (`v` in SpeedReadingDAL, `lib` in CommunityLayoutDAL).
// The alias is a caller-supplied literal, never user input.

/**
 * Cards the user deliberately sorted into Learn Now. Excludes provisional cards.
 * This is the DEFAULT for any read that represents the user's own vocabulary.
 */
export function vetSortedClause(alias = 've'): string {
  return `${alias}."starterPackBucket" = 'library'`;
}

/**
 * Cards a game or flp may serve: the user's sorted deck PLUS any provisional cards
 * granted to top them up to the surface's baseline. Only selection paths that feed
 * an actual round should use this.
 */
export function vetPlayableClause(alias = 've'): string {
  return `${alias}."starterPackBucket" IN ('library', 'provisional')`;
}

/** Matches only the auto-granted temporary cards. */
export function vetProvisionalClause(alias = 've'): string {
  return `${alias}."starterPackBucket" = 'provisional'`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deck membership (migration 141, docs/DECKS_FEATURE.md)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Restricts a vet read to the cards in one user-authored deck.
 *
 * COMPOSES WITH, NEVER REPLACES, the bucket clauses above. A deck-filtered game
 * pool is still `vetPlayableClause() AND vetDeckClause(...)`: the deck says WHICH
 * cards the learner picked, the bucket clause says which of them the surface is
 * allowed to serve. Dropping the bucket clause because a deck filter is present
 * would let a game serve a card the user has since removed from Learn Now.
 *
 * EXISTS rather than a JOIN: `deck_cards` has at most one row per (deck, card), so
 * a join could not duplicate rows today — but a semi-join states the intent, keeps
 * the clause spliceable into any WHERE without touching the caller's FROM, and
 * cannot start duplicating results if the membership table ever grows a second
 * dimension.
 *
 * @param deckIdParam  A BIND PLACEHOLDER (e.g. `'$3'`), never a literal id. Callers
 *                     bind the deck id alongside; nothing user-controlled is
 *                     interpolated into SQL here.
 * @param alias        The caller's vet alias (`ve` by default, `v` in
 *                     SpeedReadingDAL, `lib` in CommunityLayoutDAL).
 *
 * NOTE ON PROVISIONAL CARDS: a card lent to top a small deck up to a surface's
 * baseline is deliberately NOT written into `deck_cards`, so it does NOT satisfy
 * this clause. Deck-filtered selection therefore ORs the two — "in the deck, or
 * lent for this session" — at the call site rather than here, so that every read
 * that means strictly "the deck" keeps meaning that. See
 * `vetDeckOrProvisionalClause` below.
 */
export function vetDeckClause(deckIdParam: string, alias = 've'): string {
  return `EXISTS (
    SELECT 1 FROM deck_cards dc
    WHERE dc."deckId" = ${deckIdParam} AND dc."vocabEntryId" = ${alias}.id
  )`;
}

/**
 * What a deck-filtered GAME or flp round may draw from: the deck's cards, plus any
 * provisional card lent to reach the surface's baseline.
 *
 * The lent cards are the answer to "the user launched a game from a four-card
 * deck". They are real vet rows that accept marks, they are itemized to the player
 * by the existing provisional notice, and they stay out of the deck itself — so
 * playing an under-sized deck never silently grows it.
 *
 * Pair with `vetPlayableClause()`, not instead of it: this decides membership,
 * that decides servability.
 */
export function vetDeckOrProvisionalClause(deckIdParam: string, alias = 've'): string {
  return `(${vetDeckClause(deckIdParam, alias)} OR ${vetProvisionalClause(alias)})`;
}

// In-query utcm category (migration 101, docs/MASTERY_REWORK.md). The `category`
// column is no longer stored — it is derived from the card's typedMarkHistory AND
// the account's goal flags, which live on the users row. So any query that needs a
// card's category must JOIN users (UTCM_USERS_JOIN) and splice UTCM_CATEGORY_EXPR
// into its SELECT (aliased `category`) and/or WHERE. Both reference `ve` (the vet
// alias) and `u` (the joined users alias).
export const UTCM_USERS_JOIN = `JOIN users u ON u.id = ve."userId"`;
export const UTCM_CATEGORY_EXPR = `compute_utcm_category(ve."typedMarkHistory", u."readingGoal", u."writingGoal")`;
// Ready-made SELECT-list fragment: the computed category under its column name.
export const UTCM_CATEGORY_SELECT = `${UTCM_CATEGORY_EXPR} AS category`;

/**
 * In-query utcm category for ONE mark type (migration 128, docs/MASTERY_REWORK.md
 * § "Games select by their own mark type"). Banded off that single track's 0..8
 * positive count instead of the goal-blended pbh, so a game buckets cards by the
 * history of the track it actually exercises.
 *
 * Unlike UTCM_CATEGORY_EXPR this needs NO users join — a per-type band is
 * goal-independent. References `ve` (the vet alias) only.
 *
 * The mark type is passed as a BIND PARAMETER, never interpolated: callers hand in
 * the placeholder (e.g. `'$5'`) and bind the MarkType value alongside it.
 */
export function typeCategoryExpr(markTypeParam: string): string {
  return `compute_type_category(ve."typedMarkHistory", ${markTypeParam})`;
}
