import {
  ALL_COLLECTION_ID,
  LEARN_NOW_COLLECTION_IDS,
  MASTERED_COLLECTION_IDS,
  learnNowCollectionBar,
  masteredCollectionBar,
  type MasteryBarId,
} from '../../contracts/wire.js';

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
 * The user's sorted deck PLUS any provisional cards outstanding.
 *
 * ⚠️ NOT A CARD-SELECTION CLAUSE (2026-08-20). It used to be the one every game and
 * flp pool used, on the theory that a lent card is fine for one round. It is not: a
 * lent row is never on cooldown and always bands Unfamiliar, so once a few had
 * accumulated they out-competed the learner's own cards in every round, forever (a
 * dev account reached 184 lent rows against 185 real ones and was playing mostly
 * borrowed words). Selection now reads `vetSortedClause()`, and a lent row reaches a
 * round only through the last-resort lend tier, which addresses it BY ID.
 *
 * What remains is supply that is not card selection: Speed Reading's distractor
 * CHARACTERS, which decorate a round rather than being studied in it, and which a
 * near-empty deck must still be able to produce. See docs/PROVISIONAL_CARDS.md § 4b.
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

// In-query utcm category (migration 143, docs/MASTERY_REWORK.md). The `category`
// column is not stored — it is derived from the card's typedMarkHistory. A query
// that needs a card's category splices CORE_CATEGORY_EXPR into its SELECT (aliased
// `category`) and/or WHERE; it references `ve` (the vet alias) only.
//
// This is the CORE bar — recognition + production. It is what every whole-card
// question means: deck counts, the Review gate, level estimation, the mini-card
// chip, the community Learning feed. Reading and writing have their own bars, which
// no query bands in SQL because nothing selects or counts by them (the per-bar
// Mastered collections filter on `compute_type_category`, below, since a
// single-track bar IS that track's band).
//
// Until migration 143 this was `compute_utcm_category(history, readingGoal,
// writingGoal)` and every such query had to JOIN users for the flags — the
// `UTCM_USERS_JOIN` that used to live here. The core bar is goal-independent, so
// that join is gone and a card's band no longer moves when an account toggles a goal.
// Alias-parameterized form, for the queries that don't call their vet alias `ve`
// (`lib` in CommunityLayoutDAL). The alias is a caller-supplied literal, never input.
export function coreCategoryExpr(alias = 've'): string {
  return `compute_core_category(${alias}."typedMarkHistory")`;
}
export const CORE_CATEGORY_EXPR = coreCategoryExpr();
// Ready-made SELECT-list fragment: the computed category under its column name.
export const CORE_CATEGORY_SELECT = `${CORE_CATEGORY_EXPR} AS category`;

/**
 * In-query utcm category for ONE mark type (migration 128, docs/MASTERY_REWORK.md
 * § "Games select by their own mark type"). Banded off that single track's 0..8
 * positive count instead of the goal-blended pbh, so a game buckets cards by the
 * history of the track it actually exercises.
 *
 * Also serves the reading/writing BARS (migration 143): a single-track bar's height
 * is that track's raw positive count, so its band is exactly this. Only the core bar
 * needs its own function, because only the core bar blends two tracks.
 *
 * The mark type is passed as a BIND PARAMETER, never interpolated: callers hand in
 * the placeholder (e.g. `'$5'`) and bind the MarkType value alongside it.
 *
 * @param alias The caller's vet alias — `ve` by default, `lib` in CommunityLayoutDAL.
 */
export function typeCategoryExpr(markTypeParam: string, alias = 've'): string {
  return `compute_type_category(${alias}."typedMarkHistory", ${markTypeParam})`;
}

/**
 * In-query band expression for ONE mastery bar (migration 143). Core blends its two
 * tracks; reading/writing ARE their track, so they reuse compute_type_category.
 *
 * Nothing user-controlled reaches the SQL: `bar` is a validated union value and the
 * switch maps it to one of three fixed strings — an unrecognized value cannot fall
 * through to an interpolation.
 */
export function barCategoryExpr(bar: MasteryBarId, alias = 've'): string {
  switch (bar) {
    case 'reading':
      return typeCategoryExpr(`'reading'`, alias);
    case 'writing':
      return typeCategoryExpr(`'writing'`, alias);
    default:
      return coreCategoryExpr(alias);
  }
}

/**
 * WHERE fragment for "this card is Mastered in the given bar" — the membership test
 * behind each of the three built-in Mastered collections.
 */
export function masteredBarClause(bar: MasteryBarId, alias = 've'): string {
  return `${barCategoryExpr(bar, alias)} = 'Mastered'`;
}

/**
 * WHERE fragment for "this card is NOT yet Mastered in the given bar" — the
 * membership test behind each of the three built-in Learn Now collections.
 *
 * The exact complement of `masteredBarClause` in the same bar, so the two sets a
 * Center shows ("still to do" / "finished") always partition that bar's library and
 * cannot both miss a card.
 */
export function unmasteredBarClause(bar: MasteryBarId, alias = 've'): string {
  return `${barCategoryExpr(bar, alias)} <> 'Mastered'`;
}

/**
 * Every built-in (non-deck) collection id, in fdp display order.
 *
 * Three ideas wide, and deliberately no wider: the whole library (`all`), the part of
 * it still being learned in a given bar (`learn-now*`) and the part finished in that
 * bar (`mastered*`). The last two are one id PER BAR — `learn-now`/`mastered` name
 * the core bar and keep their original unqualified spelling. The per-band collections
 * (`unfamiliar` / `target` / `comfortable`) were removed — see the note in
 * contracts/wire.ts for why a utcm band is a card property rather than a card SET.
 */
export const BUILTIN_COLLECTION_IDS = [
  ALL_COLLECTION_ID,
  LEARN_NOW_COLLECTION_IDS.core,
  LEARN_NOW_COLLECTION_IDS.reading,
  LEARN_NOW_COLLECTION_IDS.writing,
  MASTERED_COLLECTION_IDS.core,
  MASTERED_COLLECTION_IDS.reading,
  MASTERED_COLLECTION_IDS.writing,
] as const;

export type BuiltinCollectionId = (typeof BUILTIN_COLLECTION_IDS)[number];

/** Narrow an untrusted `?collection=` value to a built-in id, or null if it isn't one. */
export function parseBuiltinCollectionId(
  raw: string | null | undefined
): BuiltinCollectionId | null {
  return BUILTIN_COLLECTION_IDS.includes(raw as BuiltinCollectionId)
    ? (raw as BuiltinCollectionId)
    : null;
}

/**
 * The WHERE fragment that defines each built-in collection's membership — the ONE
 * place a built-in collection is given its meaning.
 *
 * Nothing user-controlled reaches the SQL. `collection` is a validated union value
 * and every branch returns a fixed string built from the band expressions above;
 * nothing is interpolated from the request.
 *
 * `all` returns TRUE rather than an empty string so callers can always splice it into
 * an `AND …` position without a conditional.
 */
export function builtinCollectionClause(collection: BuiltinCollectionId, alias = 've'): string {
  const masteredBar = masteredCollectionBar(collection);
  if (masteredBar) return masteredBarClause(masteredBar, alias);

  // 'learn-now*' — every sorted card whose named bar is unfinished. One id per bar
  // since the Mastery Centers shipped: the core set is "what is left to know", the
  // reading set "what is left to read", and a card is routinely in one and not the
  // other. `learn-now` (unqualified) is still the core bar.
  const learnNowBar = learnNowCollectionBar(collection);
  if (learnNowBar) return unmasteredBarClause(learnNowBar, alias);

  // 'all' — no further narrowing beyond the caller's own SORTED/user/language clauses.
  return 'TRUE';
}
