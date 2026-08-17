# Bound-Form Words — the huìzi class

**Status:** the data cleanup is **DONE on prod (2026-08-17)**. The learner-facing
teaching work is **NOT BUILT** — it is tracked as an open item in
[DEFERRED_WORK.md](./DEFERRED_WORK.md) § 2 and specified in § 4 below.

This doc owns one narrow linguistic class and everything the app does about it.

---

## 1. What the class is

A **phrase-bound word** is a multi-syllable word that cannot stand alone. It only
ever occurs inside a fixed frame headed by `一` or a demonstrative (`这` / `那` /
`好一` / `半`):

| ✅ occurs | ❌ never occurs bare |
|---|---|
| 一会子 / 好一会子 | 会子 |
| 这家子 / 那家子 / 一家子 | 家子 |
| 一辈子 / 半辈子 / 这辈子 | 辈子 |
| 一阵子 / 这阵子 / 那阵子 | 阵子 |

We call it the **huìzi class** after `会子`, the entry that exposed the problem.

### The discriminator: bound noun vs. classifier/unit

This is the distinction that matters, and getting it wrong produces a list full of
false positives. **A unit takes any numeral; a phrase-bound noun takes only `一` and
the demonstratives.**

```
三分钟  ✅   五海里  ✅   十秒  ✅      ← units/classifiers, NOT this class
三会子  ❌   三辈子  ❌   三家子 ❌      ← phrase-bound: the frame is lexical
```

So `分钟`, `海里`, `秒`, `位`, `千`, `百`, `西西`, `市里`, `公合` are **not** in this
class even though they always follow a number. They are ordinary free units.

### Also not in this class

These look similar and are **free** words — do not add them:

| word | why it is free |
|---|---|
| `半天`, `刹那`, `瞬间`, `闪念`, `霎眼` | all stand alone as nouns; they merely *also* have `一X` compounds |
| `时候` | free (`时候不早了`); `那时候` is a compound, not a required frame |
| `门子` | free in the "connections" sense — `到处找门子` has it bare |
| `坎儿` | free (`过不了这个坎儿` has it as a bare object of a classifier phrase) |

---

## 2. Why CC-CEDICT cannot tell us this

CC-CEDICT has two boundness markers, and **both are ~99.8% single-character
devices** — they exist to flag characters that are not free morphemes, and have no
representation for a word that is bound at the *phrase* level:

| marker | entries | single-char | multi-char |
|---|---|---|---|
| `(bound form)` | 480 | 484 | 3 (`氢氧化`, `避雷`, `金砖` — sentence fragments) |
| `used in <hanzi>[pinyin]` cross-ref | 704 | 703 | 1 |
| definition is *only* cross-refs | 594 | 594 | 0 |

The source is also **inconsistent about whether a bound base gets a headword at
all**: `會子` has one, while `會兒`, `下子`, `陣兒` and `些子` have none. So the class
cannot be derived from the source in either direction — presence of a headword does
not imply the word is free, and absence does not imply it is bound.

⚠️ The `(bound form)` tag is **per-sense, not per-word**. All 35 det entries that
carried it while discoverable were free high-frequency characters (`上`, `会`, `用`,
`说`) with one additional bound sense. Do not treat that tag as a promotion blocker.

---

## 3. How the list was derived

A 2026-08-17 audit of prod det (114,774 rows) used two detectors. **Neither is
sufficient alone** — each caught what the other missed:

| detector | method | caught | missed |
|---|---|---|---|
| **A — example-sentence host analysis** | For each discoverable entry, take the character immediately preceding the headword across its generated example sentences. Never sentence-initial, never after punctuation, and only `一`/`这`/`那` hosts with no true numeral ⇒ bound | `会子`, `家子` | `辈子`, `阵子` — not discoverable, so they have no example sentences |
| **B — host-prefix co-existence** | A base X is bound when `一X`/`这X`/`那X`/`好X`/`半X` exists as its own det headword and adds no meaning | `辈子`, `阵子` | `会子` — `一会子` is not in CC-CEDICT at all |

Detector A is reusable and lives in the audit scratch work; it is not a permanent
script because the class is closed (see § 5).

---

## 4. The complete class

The canonical machine-readable copy is
`server/scripts/backfill/shared/lib/boundForms.js` → `ZH_BOUND_FORMS`. **That file is
the authority; this table is the prose mirror.** Keep them in sync.

### 4a. Were in det, removed from prod 2026-08-17

| base | pinyin | gloss | frames | det id (deleted) |
|---|---|---|---|---|
| `会子` | huì zi | a while | 一会子, 好一会子 | 54227 |
| `家子` | jiā zi | household | 一家子, 这家子, 那家子 | 32597 |
| `辈子` | bèi zi | lifetime | 一辈子, 半辈子, 这辈子 | 105277 |
| `阵子` | zhèn zi | period of time | 一阵子, 这阵子, 那阵子 | 113859 |
| `程子` | chéng zi | a while (Beijing dialect) | 一程子, 这程子 | 80838 |
| `当儿` | dāng r | the very moment | 这当儿, 那当儿 | 74741 |

### 4b. Never in CC-CEDICT, so never in det

Listed so that a future dictionary source cannot introduce them silently.

| base | pinyin | gloss | frames |
|---|---|---|---|
| `会儿` | huì r | a moment | 一会儿, 这会儿, 那会儿, 待会儿 |
| `下子` | xià zi | all at once | 一下子 |
| `阵儿` | zhèn r | a spell | 一阵儿, 这阵儿 |
| `些子` | xiē zi | a little | 一些子 |
| `溜儿` | liū r | a row of | 一溜儿 |
| `忽儿` | hū r | a moment | 一忽儿 |
| `霎儿` | shà r | an instant | 一霎儿 |
| `半会儿` | bàn huì r | a short while | 一半会儿 |

**14 items total, 6 of which reached det.**

---

## 5. Why a denylist and not a detector

The class is **closed and tiny** — roughly 15–25 items in the whole language — because
the construction is not productive. Modern Mandarin builds new duration expressions
from free nouns (`时间`, `期间`), not from new bound `子`-bases. A hardcoded list is
the right weight of tool; a general boundness detector would be heavy machinery for a
set that fits on one screen and does not grow.

### Code that enforces it

| file | symbol | behavior |
|---|---|---|
| `server/scripts/backfill/shared/lib/boundForms.js` | `ZH_BOUND_FORMS`, `isZhBoundForm`, `zhBoundFormHosts` | the canonical list + membership test |
| `server/scripts/import-cedict-pg.ts` | `parseCEDICTLine` | returns `null` for a bound base, so a re-import cannot recreate the rows. Verified: 123,996 imported / 6 skipped |
| `server/scripts/backfill/promote-discoverable.js` | `main` | refuses to promote, checked **before** the discoverable/readiness branches so an already-promoted bound form is reported loudly (`⛔ … ⚠️ ALREADY DISCOVERABLE`) rather than counted as a benign "already discoverable" |

The hosted forms are unaffected and still import and promote normally: `一会儿`,
`一下子`, `一下儿`, `一家子` are discoverable on prod today.

### What the 2026-08-17 cleanup did

* Deleted **6 det rows** (§ 4a) and **1 vet row** (`vocabentries_zh` id 2145, `会子`,
  `library` bucket, 6 marks, owner `michaelren1928@gmail.com`).
* No FK anywhere references `dictionaryentries_zh`, and no `validations`,
  `ai_dictionary_cache`, or `word_comparison_cache` rows referenced the class, so
  nothing cascaded and nothing was orphaned.
* Backups: `server/backups/det-20260817T101859Z-bound-form-removal.sql.gz` (full det)
  and `server/backups/bound-form-rows-20260817.jsonl` (the exact 7 rows, row-level, and
  the only backup that covers the vet row).

---

## 6. Open work — teach the learner about bound forms

**Not built.** Tracked as [DEFERRED_WORK.md](./DEFERRED_WORK.md) § 2.

### The problem the removal does not solve

Deleting the bases stops the app from *teaching a bad card*, but it leaves the learner
with no explanation. A learner who meets `一会儿` and `一辈子` has no way to know that
`会儿` and `辈子` are not words — and the natural inference from every other multi-char
card ("the parts are words too") is exactly wrong here. Worse, the bt (breakdown tab)
actively invites that inference: it decomposes a word into its characters, so `一会儿`
breaks into `一` + `会` + `儿`, implying a compositional reading that does not hold.
`一会儿` must be learned as a single lexical unit.

### What to build

A short learner-facing note on the **hosted** form's cdp/eip explaining that the word
is a fixed unit and its tail is not a standalone word. Roughly:

> **Learn this as one unit.** 一会儿 is fixed — 会儿 is not a word on its own, so it
> never appears without 一, 这, or 那 in front of it.

Scope: the ~10 hosted forms in det that correspond to a § 4 base (`一会儿`, `一下子`,
`一下儿`, `一家子`, `一辈子`, `半辈子`, `一阵子`, `这阵子`, `那阵子`, `这会儿`,
`待会儿`), not all of det.

### Open questions — need a decision before building

1. **Where does the note live?** Three candidates, in rough order of my preference:
   - a new **eip tab** — consistent with how sct/st/bt/est already attach explanations
     to a card, but a whole tab is heavy for one sentence;
   - inline copy on the **bt**, where the misleading decomposition actually appears —
     most likely to be read at the moment of confusion;
   - a badge/chip on the **cdp** next to the Commonality chip.
2. ⚠️ **Does this need a new column?** The note could be derived at read time from
   `ZH_BOUND_FORMS` (no schema change — the server maps a hosted form to its base and
   synthesizes the copy), or stored per-entry as a new det column. **Deriving it needs
   no migration and cannot drift from the denylist, so it is the recommended route.**
   Per CLAUDE.md, a new column must be confirmed in question form before being added —
   this has **not** been asked yet, so do not add one on your own authority.
3. **Should the bt suppress compositional breakdown for these words**, or show it with
   the caveat attached? Suppressing is more truthful; showing it is more consistent
   with every other card and still teaches the characters.
4. **Does the class need a Spanish analogue?** Spanish has bound-ish fixed frames
   (`a duras penas`, `de repente`) but they are multi-word expressions, not bound
   morphemes, so `boundForms.js` is deliberately zh-only. Revisit if sdet ever imports
   sub-word units beyond `affixes`.

### The adjacent cohort this audit surfaced but did not touch

Filtering discoverable + difficulty 5–6 + `frequencyScore` ≤ 2 + `(coll.)`/`dialect`
gives **25 rows**, of which only `会子` was bound. Most of the rest are questionable
cards for a *different* reason — regional items presented as standard Mandarin:
`不儿道` (dialect contraction of 不知道), `眼时`, `白相人`, `电马儿`, `阿拉` (Wu "I/me"),
`小黄` (Tw "taxi"), `老小老小`, `头家`. That is a register problem, not a boundness
problem, and it is **unexamined**.

⚠️ Note for whoever picks that up: "difficulty 5–6 + `frequencyScore` ≤ 2" is **not**
by itself a useful signal — 1,753 rows match it, half the entire discoverable pool. It
only becomes selective in combination with the `(coll.)`/`dialect` markers.

---

## 7. Related known-wrong data (not fixed)

The `会子` audit also found the enrichment that had been written for it was wrong in
ways that likely affect other entries. Not investigated further:

* **`difficulty` conflates rarity with learning difficulty.** The column is
  1..6 = HSK level for zh, which has no slot for "easy to understand but regional or
  non-standard", so every colloquial-not-in-HSK word gets pushed to 5–6 next to
  genuinely technical vocabulary. `backfill-hsk-level.js` explicitly warns *"Do NOT
  default to HSK6 simply because the word is absent from standard HSK word lists"* —
  the warning exists because the failure is easy, and `会子` at 6 (vs `一会儿` at 2)
  shows it still happens.
* **`frequencyScore` splits the difference on colloquial-but-rare words.** `会子`
  scored 2, a *written-register* profile per the rubric in
  `chinese/lib/frequencyScore.js` → `SCALE_AND_GUIDELINES`, for a word that is purely
  spoken. The rubric warns against exactly this ("Score frequency of occurrence …
  NOT register").
* **`wordForms` generates junk plurals for non-count concepts** — `会子` had
  `{"noun": "while", "noun_plural": "whiles"}`, and `resolveWordForm` would have
  injected "whiles" into an inflected gloss. See [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md)
  § form modification.

---

## 8. References

**Code:** `server/scripts/backfill/shared/lib/boundForms.js`,
`server/scripts/import-cedict-pg.ts` → `parseCEDICTLine`,
`server/scripts/backfill/promote-discoverable.js` → `main`.

**Docs:** [DEFERRED_WORK.md](./DEFERRED_WORK.md) § 2 (the work item),
[DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) (definition forms),
[DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md) (`frequencyScore` rubric and the
Commonality chip), [CONSTRUCTS.md](./CONSTRUCTS.md) (`difficulty` = HSK 1..6),
[EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) (`wordForms` / `resolveWordForm`),
`.claude/commands/mark-discoverable.md` (the only legal path to `discoverable = TRUE`).
