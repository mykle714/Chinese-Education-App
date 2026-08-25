import { describe, it, expect } from "vitest";
import type { VocabEntry } from "../types";
import { sortVocabEntries, sortBundles, sortLabel, defaultSortKey } from "../utils/vocabSort";
import type { MasteryGoals } from "../utils/masteryCompute";

/**
 * Tests for the collection "Sort by" comparators (src/utils/vocabSort.ts,
 * docs/DECKS_FEATURE.md § "Sort by").
 *
 * What is pinned here is the stuff a future edit could plausibly get wrong:
 * NULL/missing dates sinking to the bottom of a descending sort, tone-insensitive
 * pinyin grouping, the sense-resolved keys (a card's CHOSEN sense decides where it
 * files, not the det column), and tie stability.
 */

const GOALS: MasteryGoals = { reading: false, writing: false };

/** Minimal card. Only the fields a comparator reads need to be real. */
const card = (over: Partial<VocabEntry> & { id: number }): VocabEntry =>
  ({
    entryKey: "x",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }) as VocabEntry;

/** Eight positive marks on one track = pbh 8 = Mastered. */
const positives = (n: number) =>
  Array.from({ length: n }, () => ({ timestamp: "2026-01-01T00:00:00.000Z", isCorrect: true }));

const ids = (entries: VocabEntry[]) => entries.map((e) => e.id);

describe("sortVocabEntries — dates", () => {
  const a = card({ id: 1, createdAt: "2026-01-01T00:00:00.000Z" });
  const b = card({ id: 2, createdAt: "2026-03-01T00:00:00.000Z" });
  const c = card({ id: 3, createdAt: "2026-02-01T00:00:00.000Z" });

  it("orders newest first for 'recent' and oldest first for 'oldest'", () => {
    expect(ids(sortVocabEntries([a, b, c], "recent"))).toEqual([2, 3, 1]);
    expect(ids(sortVocabEntries([a, b, c], "oldest"))).toEqual([1, 3, 2]);
  });

  it("does not mutate the input array", () => {
    const input = [a, b, c];
    sortVocabEntries(input, "recent");
    expect(ids(input)).toEqual([1, 2, 3]);
  });
});

describe("sortVocabEntries — missing timestamps", () => {
  it("sinks cards with no masteredAt to the bottom, not the top", () => {
    // The common case, not an edge case: every card mastered before migration 142
    // has a NULL masteredAt, since the crossing moment was not backfillable.
    const never = card({ id: 1, masteredAt: null });
    const old = card({ id: 2, masteredAt: { core: "2026-02-01T00:00:00.000Z" } });
    const recent = card({ id: 3, masteredAt: { core: "2026-05-01T00:00:00.000Z" } });
    const absent = card({ id: 4 });

    expect(ids(sortVocabEntries([never, old, recent, absent], "masteredRecent")))
      .toEqual([3, 2, 1, 4]);
  });

  it("sinks dateless cards to the bottom in the ASCENDING direction too", () => {
    // The bundled menu made every date readable both ways, which is where this bites:
    // 0 means "no stamp", not "the epoch", so "Oldest" must not open with every card
    // that has never been mastered.
    const never = card({ id: 1, masteredAt: null });
    const old = card({ id: 2, masteredAt: { core: "2026-02-01T00:00:00.000Z" } });
    const recent = card({ id: 3, masteredAt: { core: "2026-05-01T00:00:00.000Z" } });

    expect(ids(sortVocabEntries([never, recent, old], "masteredOldest"))).toEqual([2, 3, 1]);
  });

  it("reads each bar's OWN stamp, not the latest across bars", () => {
    // Three bars are three separate achievements: a reading crossing must not reorder
    // the list a learner is reading as their core progress.
    const writingOnly = card({ id: 1, masteredAt: { writing: "2026-05-01T00:00:00.000Z" } });
    const core = card({ id: 2, masteredAt: { core: "2026-02-01T00:00:00.000Z" } });

    // Core ordering ignores the (newer) writing stamp and sinks the card with none.
    expect(ids(sortVocabEntries([writingOnly, core], "masteredRecent"))).toEqual([2, 1]);
    // The writing ordering is the mirror image.
    expect(ids(sortVocabEntries([core, writingOnly], "masteredRecentWriting"))).toEqual([1, 2]);
  });

  it("sinks cards with no deckAddedAt to the bottom too", () => {
    const inDeck = card({ id: 1, deckAddedAt: "2026-04-01T00:00:00.000Z" });
    const noMembership = card({ id: 2 });
    expect(ids(sortVocabEntries([noMembership, inDeck], "deckAdded"))).toEqual([1, 2]);
    expect(ids(sortVocabEntries([noMembership, inDeck], "deckAddedOldest"))).toEqual([1, 2]);
  });
});

describe("sortVocabEntries — mastery", () => {
  it("orders by pbh in both directions", () => {
    const low = card({ id: 1, typedMarkHistory: { recognition: positives(1) } });
    const high = card({ id: 2, typedMarkHistory: { recognition: positives(8), production: positives(8) } });
    const mid = card({ id: 3, typedMarkHistory: { recognition: positives(4) } });

    expect(ids(sortVocabEntries([low, high, mid], "masteryDesc"))).toEqual([2, 3, 1]);
    expect(ids(sortVocabEntries([low, high, mid], "masteryAsc"))).toEqual([1, 3, 2]);
  });

  it("keeps equal-pbh cards in their incoming order (stable tie-break)", () => {
    const first = card({ id: 7 });
    const second = card({ id: 3 });
    const third = card({ id: 5 });
    expect(ids(sortVocabEntries([first, second, third], "masteryDesc"))).toEqual([7, 3, 5]);
  });
});

describe("sortVocabEntries — alphabetical", () => {
  it("sorts pinyin tone-insensitively so homophones cluster", () => {
    const bing4 = card({ id: 1, entryKey: "病", pronunciation: "bìng" });
    const an1 = card({ id: 2, entryKey: "安", pronunciation: "ān" });
    const bing1 = card({ id: 3, entryKey: "冰", pronunciation: "bīng" });

    // ān first; the two bing readings land adjacent instead of being split apart by
    // their diacritics' code points.
    expect(ids(sortVocabEntries([bing4, an1, bing1], "alphaPronunciation")))
      .toEqual([2, 1, 3]);
  });

  it("falls back to entryKey when there is no pronunciation (every Spanish card)", () => {
    const perro = card({ id: 1, entryKey: "perro", pronunciation: null });
    const casa = card({ id: 2, entryKey: "casa", pronunciation: null });
    expect(ids(sortVocabEntries([perro, casa], "alphaPronunciation"))).toEqual([2, 1]);
  });

  it("reverses cleanly for the Z–A half of each alphabetical bundle", () => {
    const casa = card({ id: 1, entryKey: "casa", pronunciation: null });
    const perro = card({ id: 2, entryKey: "perro", pronunciation: null });
    expect(ids(sortVocabEntries([casa, perro], "alphaPronunciationDesc"))).toEqual([2, 1]);

    const apple = card({ id: 3, definition: "apple" });
    const zebra = card({ id: 4, definition: "zebra" });
    expect(ids(sortVocabEntries([apple, zebra], "alphaDefinitionDesc"))).toEqual([4, 3]);
  });

  it("sorts on the dd, and on the card's CHOSEN sense rather than the det column", () => {
    // 会 with the accounting sense picked shows "to reckon accounts", so it must file
    // under 'r' — not under 'c' for the entry-level definitions[0].
    const chosenSense = card({
      id: 1,
      definition: "can; to be able to",
      definitionClusters: [
        { sense: "ability", glosses: ["can; to be able to"] },
        { sense: "accounting", glosses: ["to reckon accounts"] },
      ],
      selectedSense: "accounting",
    } as Partial<VocabEntry> & { id: number });
    const apple = card({ id: 2, definition: "apple" });
    const zebra = card({ id: 3, definition: "zebra" });

    expect(ids(sortVocabEntries([zebra, chosenSense, apple], "alphaDefinition")))
      .toEqual([2, 1, 3]);
  });
});

describe("sortVocabEntries — cooldown", () => {
  const NOW = Date.parse("2026-06-01T12:00:00.000Z");
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;

  /** A card whose only correct mark on `type` landed `agoMs` before NOW. */
  const marked = (id: number, type: string, agoMs: number, count = 1): VocabEntry =>
    card({
      id,
      typedMarkHistory: {
        [type]: Array.from({ length: count }, () => ({
          timestamp: new Date(NOW - agoMs).toISOString(),
          isCorrect: true,
        })),
      },
    } as Partial<VocabEntry> & { id: number });

  it("orders by the LONGEST-resting track, both ways", () => {
    // One correct mark ⇒ per-type category Unfamiliar ⇒ a 5-minute window.
    const rested = marked(1, "recognition", 10 * MINUTE);   // window elapsed ⇒ 0
    const resting = marked(2, "recognition", 1 * MINUTE);   // ~4 minutes left
    const fresh = marked(3, "recognition", 0);              // ~5 minutes left

    expect(ids(sortVocabEntries([fresh, resting, rested], "cooldownReady", NOW)))
      .toEqual([1, 2, 3]);
    expect(ids(sortVocabEntries([rested, resting, fresh], "cooldownLongest", NOW)))
      .toEqual([3, 2, 1]);
  });

  it("ignores UNTOUCHED tracks instead of collapsing every card to ready", () => {
    // This is why the key is the maximum and not the minimum: outside the
    // reading/writing goals most cards have tracks that were never marked, and those
    // report 0. Under a minimum they would drag every card to 0 and the whole
    // ordering would be one tie.
    const hotRecognition = marked(1, "recognition", 1 * MINUTE);  // ~4 min left
    const untouched = card({ id: 2 });                            // 0

    expect(ids(sortVocabEntries([hotRecognition, untouched], "cooldownReady", NOW)))
      .toEqual([2, 1]);
  });

  it("takes the longest window when two tracks are cooling at once", () => {
    // recognition: 8 correct ⇒ Mastered ⇒ 180 days, marked an hour ago.
    // production:  1 correct ⇒ Unfamiliar ⇒ 5 minutes, marked a minute ago.
    // The card is not fully rested until the 180-day window closes.
    const twoTracks = card({
      id: 1,
      typedMarkHistory: {
        recognition: positives(8).map(() => ({
          timestamp: new Date(NOW - HOUR).toISOString(),
          isCorrect: true,
        })),
        production: [{ timestamp: new Date(NOW - MINUTE).toISOString(), isCorrect: true }],
      },
    } as Partial<VocabEntry> & { id: number });
    const shortWait = marked(2, "recognition", 1 * MINUTE);

    expect(ids(sortVocabEntries([shortWait, twoTracks], "cooldownLongest", NOW)))
      .toEqual([1, 2]);
  });

  it("puts a never-studied card at the TOP of 'Ready first', not the bottom", () => {
    // 0 here means "ready", not "no date" — so cooldown must NOT get the
    // missing-timestamp sinking that the date keys have.
    const untouched = card({ id: 1 });
    const resting = marked(2, "recognition", 1 * MINUTE);
    expect(ids(sortVocabEntries([resting, untouched], "cooldownReady", NOW))).toEqual([1, 2]);
  });

  it("breaks ties on the incoming order, so equal-cooldown cards do not reshuffle", () => {
    const a = card({ id: 7 });
    const b = card({ id: 3 });
    const c = card({ id: 5 });
    expect(ids(sortVocabEntries([a, b, c], "cooldownReady", NOW))).toEqual([7, 3, 5]);
  });
});

describe("sort menu", () => {
  const keysOf = (goals: MasteryGoals, language = "zh") =>
    sortBundles(language, goals).flatMap((b) => b.directions.map((d) => d.key));

  it("labels the pronunciation row per language, direction-neutrally", () => {
    // The row names the DIMENSION; its toggles carry the direction, so the label must
    // not say "A–Z" itself.
    const zh = sortBundles("zh", GOALS).find((b) => b.id === "pronunciation");
    const es = sortBundles("es", GOALS).find((b) => b.id === "pronunciation");
    expect(zh?.label).toBe("Pinyin");
    expect(es?.label).toBe("Word");
    expect(zh?.directions.map((d) => d.label)).toEqual(["A–Z", "Z–A"]);
  });

  it("offers BOTH directions on every row", () => {
    for (const bundle of sortBundles("zh", { reading: true, writing: true })) {
      expect(bundle.directions).toHaveLength(2);
    }
  });

  it("marks the deck-membership row deck-only", () => {
    const deckAdded = sortBundles("zh", GOALS).find((b) => b.id === "deckAdded");
    expect(deckAdded?.deckOnly).toBe(true);
    // ...and every other row is available everywhere.
    expect(sortBundles("zh", GOALS).filter((b) => b.deckOnly)).toHaveLength(1);
  });

  it("offers a mastery AND a date-mastered row per ACTIVE bar only", () => {
    const noGoals = keysOf(GOALS);
    expect(noGoals).toContain("masteryDesc");
    expect(noGoals).toContain("masteredRecent");
    expect(noGoals).not.toContain("masteryReadingDesc");
    expect(noGoals).not.toContain("masteredRecentWriting");

    // Turning on reading adds its rows — and only its rows.
    const reading = keysOf({ reading: true, writing: false });
    expect(reading).toContain("masteryReadingDesc");
    expect(reading).toContain("masteredRecentReading");
    expect(reading).not.toContain("masteryWritingDesc");

    const both = keysOf({ reading: true, writing: true });
    expect(both).toContain("masteryWritingAsc");
    expect(both).toContain("masteredOldestWriting");
  });

  it("names only the PER-SKILL bars in a row label; the core row stays unqualified", () => {
    // The core bar is the default reading of "Mastery", so it is never suffixed —
    // no learner should ever read "Mastery (Know)", with or without other goals set.
    const single = sortBundles("zh", GOALS).map((b) => b.label);
    expect(single).toContain("Mastery");
    expect(single).toContain("Date mastered");

    const multi = sortBundles("zh", { reading: true, writing: false }).map((b) => b.label);
    expect(multi).toContain("Mastery");
    expect(multi).not.toContain("Mastery (Know)");
    expect(multi).toContain("Mastery (Read)");
  });

  it("offers a Cooldown row PER BAR, each tagged to its bar", () => {
    // Cooldown used to be one bar-less row spanning all four mark types. It is per-bar
    // since the Mastery Centers shipped: a Center must be able to ask "what reading have
    // I been neglecting" without a long-rested recognition track answering for it.
    const cooldown = sortBundles("zh", GOALS).find((b) => b.id === "cooldown:core");
    expect(cooldown?.bar).toBe("core");
    expect(cooldown?.directions.map((d) => d.key)).toEqual(["cooldownReady", "cooldownLongest"]);
    expect(keysOf({ reading: true, writing: true })).toContain("cooldownReadyReading");
    // …and a goal-less account still gets exactly one, the core one.
    expect(keysOf(GOALS)).toContain("cooldownReady");
    expect(keysOf(GOALS)).not.toContain("cooldownReadyWriting");
  });

  it("tags every per-bar row with the bar it reads", () => {
    // What `allowPerSkillBars` filters on — an `id` match would have missed a new bar.
    const bundles = sortBundles("zh", { reading: true, writing: true });
    expect(bundles.find((b) => b.id === "mastery:core")?.bar).toBe("core");
    expect(bundles.find((b) => b.id === "mastery:reading")?.bar).toBe("reading");
    expect(bundles.find((b) => b.id === "masteredAt:writing")?.bar).toBe("writing");
    // Three dimensions (mastery / cooldown / date-mastered) x two skill bars.
    expect(bundles.filter((b) => b.bar && b.bar !== "core")).toHaveLength(6);
  });

  it("shows ONE bar's rows under a skill lens, whatever the goals say", () => {
    // A Mastery Center is already about one skill, so its menu drops the other bars —
    // including core. The goals argument is inert under a lens: the page is reached only
    // with that goal set, and the bar is computed for every account regardless.
    const bundles = sortBundles("zh", GOALS, "reading");
    const bars = bundles.filter((b) => b.bar).map((b) => b.bar);
    expect(new Set(bars)).toEqual(new Set(["reading"]));
    // Single bar ⇒ unqualified labels; the page title carries the skill.
    expect(bundles.map((b) => b.label)).toContain("Mastery");
    expect(bundles.map((b) => b.label)).not.toContain("Mastery (Read)");
  });

  it("opens a Center on that bar's mastery, lowest first", () => {
    // The core lens keeps its old defaults; a skill lens overrides even the deck rule,
    // because a deck inside the Reading Center is being read through the same question.
    expect(defaultSortKey(false)).toBe("recent");
    expect(defaultSortKey(true)).toBe("deckAdded");
    expect(defaultSortKey(false, "reading")).toBe("masteryReadingAsc");
    expect(defaultSortKey(true, "writing")).toBe("masteryWritingAsc");
  });

  it("captions the toolbar button as dimension + direction", () => {
    expect(sortLabel("masteryDesc", "zh", GOALS)).toBe("Mastery · Highest");
    expect(sortLabel("alphaDefinitionDesc", "zh", GOALS)).toBe("Definition · Z–A");
    // A key the current goals do not offer loses its caption rather than lying.
    expect(sortLabel("masteryWritingAsc", "zh", GOALS)).toBe("Sort");
  });

  it("opens a deck on deck-membership order and a built-in collection on card age", () => {
    expect(defaultSortKey(true)).toBe("deckAdded");
    expect(defaultSortKey(false)).toBe("recent");
  });
});
