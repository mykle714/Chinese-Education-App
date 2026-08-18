import type { VocabEntry } from "../types";
import { resolveDisplayDefinition, resolveDisplayPronunciation } from "./definitionUtils";
import { tonedToNumberedPinyin } from "./textUtils";
import {
  activeBars,
  barProgressBarHeight,
  masteredAtForBar,
  cooldownRemainingMs,
  computeTypeCategory,
  BAR_LABELS,
  type MasteryBarId,
  type MasteryGoals,
} from "./masteryCompute";
import { MARK_TYPES } from "../../server/contracts/wire";

/**
 * Client-side "Sort by" for an already-loaded collection of cards
 * (docs/DECKS_FEATURE.md § "Sort by").
 *
 * ── Why the client and not the server ─────────────────────────────────────────
 * The three collection reads (Learn Now / Mastered / one deck) each return the WHOLE
 * collection in a single response — there is no pagination to respect — and every
 * key below is computable from fields already on the returned rows. Pushing an
 * `orderBy` parameter into three endpoints would buy a network round trip per sort
 * change and force the pinyin/dd keys (both of which depend on the card's
 * `selectedSense`) to be reimplemented in SQL, where the sense resolvers do not
 * exist. So the sort lives beside `filterVocabEntries`, next to the search it shares
 * a toolbar with.
 *
 * ── Sense-aware keys ──────────────────────────────────────────────────────────
 * "Alphabetical" sorts on what the card actually SHOWS, so both alphabetical keys go
 * through the dd / display-pinyin resolvers rather than the raw `definition` and
 * `pronunciation` columns. A learner who picked the 会 = "to reckon accounts" sense
 * sees `kuài jì` on the card, and that is where it sorts.
 *
 * Every comparator is TOTAL and DETERMINISTIC — ties break on `id` — so the grid's
 * reveal cascade cannot re-shuffle equal rows between renders.
 */

/**
 * Every offered ordering. The union IS the menu; `sortBundles` below groups these
 * into rows and gives them labels and visibility.
 *
 * Keys come in **direction pairs** — every dimension can be read both ways, so there
 * is no ordering a learner can see one end of but not the other. The pairs are bundled
 * into one menu row each (see `SortBundle`) so doubling the orderings did not double
 * the menu.
 *
 * The mastery and date-mastered orderings are additionally PER BAR (migration 143): a
 * card has up to three independent bars, so "highest mastery" and "most recently
 * mastered" are each a different list per bar. The core keys keep their original
 * unqualified spelling so a selection made before the bundling still resolves.
 */
export type VocabSortKey =
  // date the card entered the library
  | "recent"
  | "oldest"
  // date the card entered THIS deck
  | "deckAdded"
  | "deckAddedOldest"
  // alphabetical
  | "alphaPronunciation"
  | "alphaPronunciationDesc"
  | "alphaDefinition"
  | "alphaDefinitionDesc"
  // mastery height, per bar
  | "masteryAsc"
  | "masteryDesc"
  | "masteryReadingAsc"
  | "masteryReadingDesc"
  | "masteryWritingAsc"
  | "masteryWritingDesc"
  // time left before the card can next be marked
  | "cooldownReady"
  | "cooldownLongest"
  // date that bar crossed into Mastered, per bar
  | "masteredRecent"
  | "masteredOldest"
  | "masteredRecentReading"
  | "masteredOldestReading"
  | "masteredRecentWriting"
  | "masteredOldestWriting";

/**
 * The bar each mastery-HEIGHT key sorts on. Absent from the map = not a height key.
 * Drives both the comparator and the goal-gating, so the two cannot disagree about
 * which ordering belongs to which goal.
 */
const MASTERY_KEY_BAR: Partial<Record<VocabSortKey, MasteryBarId>> = {
  masteryAsc: "core",
  masteryDesc: "core",
  masteryReadingAsc: "reading",
  masteryReadingDesc: "reading",
  masteryWritingAsc: "writing",
  masteryWritingDesc: "writing",
};

/** The bar each mastery-DATE key reads its crossing stamp from. */
const MASTERED_AT_KEY_BAR: Partial<Record<VocabSortKey, MasteryBarId>> = {
  masteredRecent: "core",
  masteredOldest: "core",
  masteredRecentReading: "reading",
  masteredOldestReading: "reading",
  masteredRecentWriting: "writing",
  masteredOldestWriting: "writing",
};

/** The two alphabetical keys that read Z–A. The other two read A–Z. */
const REVERSED_ALPHA_KEYS: readonly VocabSortKey[] = [
  "alphaPronunciationDesc",
  "alphaDefinitionDesc",
];

/** NUMERIC keys that order smallest-first. Everything else is biggest-first. */
const ASCENDING_KEYS: readonly VocabSortKey[] = [
  "oldest",
  "cooldownReady",
  "deckAddedOldest",
  "masteryAsc",
  "masteryReadingAsc",
  "masteryWritingAsc",
  "masteredOldest",
  "masteredOldestReading",
  "masteredOldestWriting",
];

/**
 * Keys whose number is a DATE, where 0 means "no date" rather than "the epoch".
 * Those cards sink to the bottom in **both** directions — see `sortVocabEntries`.
 */
const DATE_KEYS: readonly VocabSortKey[] = [
  "recent",
  "oldest",
  "deckAdded",
  "deckAddedOldest",
  ...(Object.keys(MASTERED_AT_KEY_BAR) as VocabSortKey[]),
];

/** Per-bar key lookups, so a bar's four keys are named in exactly one place. */
const MASTERY_KEYS: Record<MasteryBarId, { asc: VocabSortKey; desc: VocabSortKey }> = {
  core: { asc: "masteryAsc", desc: "masteryDesc" },
  reading: { asc: "masteryReadingAsc", desc: "masteryReadingDesc" },
  writing: { asc: "masteryWritingAsc", desc: "masteryWritingDesc" },
};

const MASTERED_AT_KEYS: Record<MasteryBarId, { asc: VocabSortKey; desc: VocabSortKey }> = {
  core: { asc: "masteredOldest", desc: "masteredRecent" },
  reading: { asc: "masteredOldestReading", desc: "masteredRecentReading" },
  writing: { asc: "masteredOldestWriting", desc: "masteredRecentWriting" },
};

/** The default for a collection: a deck orders by when you put cards IN it, everything else by card age. */
export const defaultSortKey = (isDeck: boolean): VocabSortKey => (isDeck ? "deckAdded" : "recent");

/** One end of a bundle: the ordering itself, captioned by its direction alone. */
interface SortDirection {
  key: VocabSortKey;
  /** Direction caption shown on the row's toggle ("A–Z", "Highest", "Newest"). */
  label: string;
}

/**
 * One menu ROW: a dimension to sort on, plus both directions you can read it in.
 *
 * Bundling exists because every dimension is genuinely bidirectional, and listing
 * both ends as separate rows made a menu long enough that the mastery orderings — the
 * ones a learner actually reaches for — were below the fold once a second bar was in
 * play. A row names the dimension; its two toggles name the ends.
 */
export interface SortBundle {
  id: string;
  /** The dimension, direction-neutral ("Pinyin", "Mastery", "Date mastered"). */
  label: string;
  directions: SortDirection[];
  /** Deck-only rows are hidden on Learn Now / Mastered, where the key is absent. */
  deckOnly?: boolean;
  /**
   * The mastery bar this row reads, when it reads one. Lets a surface drop the
   * PER-SKILL rows (reading / writing) without matching on `id` strings — the /decks
   * sheet's Cards section does exactly that, keeping its menu to the orderings that
   * apply to every card. Absent = the row is bar-independent.
   */
  bar?: MasteryBarId;
}

/**
 * Menu contents, in display order.
 *
 * The pronunciation row is labelled per language because "Pinyin" is meaningless for
 * Spanish, where the same row is a plain alphabetical sort of the word itself (Spanish
 * cards carry no `pronunciation`, so the comparator falls back to entryKey).
 */
export const sortBundles = (
  language: string | null | undefined,
  goals: MasteryGoals
): SortBundle[] => {
  // Reading/writing rows appear ONLY when that goal is set — the same gate that decides
  // whether the bar is drawn at all (`activeBars`). Offering "Mastery (Write)" to a
  // learner with no writing bar would sort by a number they cannot see anywhere.
  const bars = activeBars(goals);
  // A bar is named in a row label only when there is more than one bar to tell apart.
  // A learner with no goals reads "Mastery", not "Mastery (Know)".
  const qualify = (base: string, bar: MasteryBarId): string =>
    bars.length > 1 ? `${base} (${BAR_LABELS[bar]})` : base;

  const masteryRow = (bar: MasteryBarId): SortBundle => ({
    id: `mastery:${bar}`,
    label: qualify("Mastery", bar),
    bar,
    directions: [
      { key: MASTERY_KEYS[bar].desc, label: "Highest" },
      { key: MASTERY_KEYS[bar].asc, label: "Lowest" },
    ],
  });

  const masteredAtRow = (bar: MasteryBarId): SortBundle => ({
    id: `masteredAt:${bar}`,
    label: qualify("Date mastered", bar),
    bar,
    directions: [
      { key: MASTERED_AT_KEYS[bar].desc, label: "Newest" },
      { key: MASTERED_AT_KEYS[bar].asc, label: "Oldest" },
    ],
  });

  return [
    {
      id: "added",
      label: "Date added",
      directions: [
        { key: "recent", label: "Newest" },
        { key: "oldest", label: "Oldest" },
      ],
    },
    {
      id: "deckAdded",
      label: "Added to this deck",
      deckOnly: true,
      directions: [
        { key: "deckAdded", label: "Newest" },
        { key: "deckAddedOldest", label: "Oldest" },
      ],
    },
    {
      id: "pronunciation",
      label: language === "es" ? "Word" : "Pinyin",
      directions: [
        { key: "alphaPronunciation", label: "A–Z" },
        { key: "alphaPronunciationDesc", label: "Z–A" },
      ],
    },
    {
      id: "definition",
      label: "Definition",
      directions: [
        { key: "alphaDefinition", label: "A–Z" },
        { key: "alphaDefinitionDesc", label: "Z–A" },
      ],
    },
    {
      // Bar-independent by design: the key is the card's longest-resting TRACK, not a
      // bar's (see `cooldownKey`), so this row is offered whatever the goals are.
      id: "cooldown",
      label: "Cooldown",
      directions: [
        { key: "cooldownReady", label: "Ready first" },
        { key: "cooldownLongest", label: "Longest" },
      ],
    },
    ...bars.map(masteryRow),
    ...bars.map(masteredAtRow),
  ];
};

/**
 * Caption for the currently-applied key, for the toolbar button: "<dimension> ·
 * <direction>", e.g. "Mastery · Highest" or "Pinyin · A–Z".
 *
 * Falls back to "Sort" for a key the current goals do not offer — which is exactly
 * what a learner sees for a moment if they switch a goal off while a reading sort is
 * applied. The list still renders (the comparator is goal-independent); only the
 * button loses its caption until they pick again.
 */
export const sortLabel = (
  key: VocabSortKey,
  language: string | null | undefined,
  goals: MasteryGoals
): string => {
  for (const bundle of sortBundles(language, goals)) {
    const direction = bundle.directions.find((d) => d.key === key);
    if (direction) return `${bundle.label} · ${direction.label}`;
  }
  return "Sort";
};

// ─── Key extraction ─────────────────────────────────────────────────────────────

/**
 * A timestamp as a sortable number, with missing/unparseable values pushed to the
 * BOTTOM of a descending sort rather than the top.
 *
 * Used by the two date orderings. "Recently mastered" has its own reader
 * (`latestMasteredAt`), which applies the same rule per bar: a bar's stamp is missing
 * for every card mastered before migration 142 (the crossing moment is not
 * recoverable from the rolling mark window, so it was deliberately not backfilled),
 * which makes "no date" a common, expected case rather than an error — those cards
 * sit at the end of "Recently mastered" until they cross again.
 */
const timeOrZero = (value: string | null | undefined): number => {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * Alphabetical key for the pronunciation column: tone-insensitive pinyin.
 *
 * Tones are stripped (via the numbered form, whose digits are trivially removable)
 * so 冰/兵/病 cluster under "bing" the way a learner scanning the list expects,
 * instead of being split three ways by their diacritics' code points. Spaces go too,
 * so "jiàn shēn" sorts as one word.
 *
 * Falls back to `entryKey` when there is no pronunciation at all — which is every
 * Spanish card, and is exactly the plain A–Z sort that option promises there.
 */
const pronunciationKey = (entry: VocabEntry): string => {
  const shown = resolveDisplayPronunciation(entry) ?? "";
  const toneless = tonedToNumberedPinyin(shown.toLowerCase()).replace(/[0-5]/g, "").replace(/\s+/g, "");
  return toneless || (entry.entryKey ?? "").toLowerCase();
};

/**
 * Milliseconds until the card is FULLY off cooldown — the maximum remaining window
 * across its four mark types (`server/contracts/cooldown.ts`).
 *
 * ── Why the maximum, and not the soonest-ready track ──────────────────────────
 * "When can I drill this at all?" is the more natural question, but its key (the
 * MINIMUM) is degenerate here: a track with no correct mark reports 0, and outside
 * the reading/writing goals most cards have two such tracks — so nearly every card
 * would score 0 and the ordering would collapse into one enormous tie. The maximum
 * has no such problem: an untouched track contributes 0 and simply loses, so the key
 * is the longest-resting track, and it moves whenever ANY track is marked.
 *
 * What it means to a learner:
 *   Ready first — the cards nothing is holding back: never studied, or fully rested.
 *                 This is the "what have I been neglecting" ordering.
 *   Longest     — the cards deepest into their rest, which is roughly the ones most
 *                 recently and most strongly marked (a Mastered track rests 6 months,
 *                 an Unfamiliar one 5 minutes).
 *
 * All four types rather than the account's active bars, because every key in this
 * module is deliberately GOAL-INDEPENDENT (see `sortVocabEntries`): an ordering must
 * not change under a settings toggle. Costless here — a track the learner never marks
 * simply never wins the maximum.
 *
 * ⚠️ **0 is a real value, not a missing one**, so cooldown is NOT a DATE_KEY: a
 * never-studied card is genuinely ready and belongs at the TOP of "Ready first", not
 * sunk to the bottom with the dateless cards.
 *
 * WINDOW CATEGORY: the card's PER-TYPE category, which is what the games enforce and
 * what the cdp prints under each bar (MasteryProgressBar → `cooldownRows`). The flp
 * widens the window to the card's core category because one flp card shows two types
 * at once, so a flp refill can hold a track back slightly longer than this number —
 * the same caveat the cdp display carries, and for the same reason: a sort can only
 * name one window, and the per-type one is the track's own.
 */
const cooldownKey = (entry: VocabEntry, now: number): number => {
  let longest = 0;
  for (const type of MARK_TYPES) {
    const remaining = cooldownRemainingMs(
      entry.typedMarkHistory,
      type,
      now,
      computeTypeCategory(entry.typedMarkHistory, type)
    );
    if (remaining > longest) longest = remaining;
  }
  return longest;
};

/** Alphabetical key for the dd — the definition the card face actually renders. */
const definitionKey = (entry: VocabEntry): string =>
  resolveDisplayDefinition(entry).trim().toLowerCase();

// ─── Comparators ────────────────────────────────────────────────────────────────

/**
 * Sort a loaded collection. Returns a NEW array; the input is never mutated (the
 * caller memoizes on it, and mutating it would desync that memo).
 *
 * Takes **no goal flags**: every key names the bar it reads, so the ordering a key
 * produces cannot change under a settings toggle. Goals decide only which keys the
 * MENU offers (`sortBundles`) — which is the same separation the bars themselves have
 * since migration 143, where a goal reveals a bar rather than changing one.
 */
export function sortVocabEntries(
  entries: VocabEntry[],
  key: VocabSortKey,
  // Read ONCE per sort and passed down, rather than each comparator reading a clock:
  // a key that drifted mid-sort would make the comparator inconsistent (and the result
  // engine-dependent). Injectable so the cooldown orderings are testable.
  now: number = Date.now()
): VocabEntry[] {
  // pbh is the expensive key (it walks the bar's mark tracks), and a comparator is called
  // O(n log n) times — so compute each card's key ONCE up front rather than inside
  // the comparator. Same for the string keys, which run the sense resolvers.
  const isAlpha = key === "alphaPronunciation" || key === "alphaPronunciationDesc"
    || key === "alphaDefinition" || key === "alphaDefinitionDesc";
  const isPronunciation = key === "alphaPronunciation" || key === "alphaPronunciationDesc";
  const isCooldown = key === "cooldownReady" || key === "cooldownLongest";
  const heightBar = MASTERY_KEY_BAR[key];
  const stampBar = MASTERED_AT_KEY_BAR[key];
  const ascending = ASCENDING_KEYS.includes(key);
  const reversedAlpha = REVERSED_ALPHA_KEYS.includes(key);
  const isDate = DATE_KEYS.includes(key);

  const decorated = entries.map((entry, index) => ({
    entry,
    index,
    text: !isAlpha ? "" : isPronunciation ? pronunciationKey(entry) : definitionKey(entry),
    num:
      heightBar ? barProgressBarHeight(entry.typedMarkHistory, heightBar)
        : stampBar ? masteredAtForBar(entry.masteredAt, stampBar)
          : isCooldown ? cooldownKey(entry, now)
            : key === "deckAdded" || key === "deckAddedOldest" ? timeOrZero(entry.deckAddedAt)
              : timeOrZero(entry.createdAt),
  }));

  // Ties break on the ORIGINAL position, which is the server's ordering — so equal
  // keys keep a stable, meaningful order instead of an arbitrary engine-dependent one.
  const stable = (a: { index: number }, b: { index: number }) => a.index - b.index;

  decorated.sort((a, b) => {
    if (isAlpha) {
      // localeCompare so accented Spanish headwords file next to their base letter
      // ("árbol" beside "arbol") rather than after Z.
      const cmp = a.text.localeCompare(b.text) * (reversedAlpha ? -1 : 1);
      return cmp !== 0 ? cmp : stable(a, b);
    }

    // A DATE key's 0 means "no date", not "the epoch" — so a dateless card sinks to the
    // bottom in BOTH directions rather than leading the ascending half of the bundle.
    // This is the common case, not an edge one: no bar's masteredAt was backfillable
    // (migration 142), so every card mastered before it has no stamp at all. A mastery
    // HEIGHT of 0 is a real value and gets no such treatment — "Lowest" starts there.
    if (isDate) {
      const aMissing = a.num === 0;
      const bMissing = b.num === 0;
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      if (aMissing) return stable(a, b);
    }

    const cmp = ascending ? a.num - b.num : b.num - a.num;
    return cmp !== 0 ? cmp : stable(a, b);
  });

  return decorated.map((d) => d.entry);
}
