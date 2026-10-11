# Velocity — recent rate of mastery progress

Status: **implemented** and deployed (migrations 137 + 143; PPE is current well past both).

**Velocity** = the number of **utcm band-steps** a learner's cards climbed in the
**last 7 days**, per **(user, language)**, **summed across the mastery bars the
account is pursuing**.

One card that moved `Unfamiliar → Comfortable` counts **2**, exactly as two cards
that each moved up one band count 2. That total is also reported **split by which
boundary was crossed** — see §2b, which the Velocity card draws as one U-arrow per
boundary hanging under the library shelf, each carrying `+N`. The window **slides** — it is always
`now() - 7 days`, never a calendar week or the Sunday-04:00 boundary that
[wins and community votes](./GAMES_FEATURE.md) use. A rolling rate must not
collapse to near-zero every Sunday morning.

Since migration 143 a card carries up to **three** independently-banded bars
(`core` / `reading` / `writing` — [MASTERY_REWORK.md § Three bars](./MASTERY_REWORK.md)),
so a step is a step **on some bar**: pushing one card's reading bar up a band counts
the same as pushing another card's core bar up a band. See §2a for which bars count.

Related: [MASTERY_REWORK.md](./MASTERY_REWORK.md) (the utcm bands velocity is
measured in), [FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md](./FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md)
(`FlashcardMarkService.applyMark` / `undoMark`, which write the log).

---

## 1. Why an event log, and why it can't be backfilled

A bar's utcm band is **not stored**. It is computed on read from
`typedMarkHistory` — `barCategory()` in `server/contracts/mastery.ts`, mirrored by
the SQL `compute_core_category()` / `compute_type_category()`. Nothing in the schema
records that a bar *moved* between bands, and the 8-slot per-type mark window
discards the marks that would let us reconstruct the movement.

So a promotion is observable at exactly **one instant**: inside
`POST /api/flashcards/mark`, which computes the band on both sides of the mark, for
the one bar that mark belongs to (`barForMarkType`). The `category_promotions` table
is that observation, appended.

**Consequence:** velocity is **not backfillable**. Every account starts at 0 on
deploy and the number becomes meaningful after ~7 days of use.

---

## 2. Counting rules

| Event | Logged? | Why |
|---|---|---|
| A mark pushes a card up one band | ✅ `bandsClimbed = 1` | The core case. |
| A mark pushes a card up two bands at once | ✅ `bandsClimbed = 2` | pbh is continuous — one mark can cross two boundaries (see the test in `server/__tests__/velocity.test.ts`). This is why the step count is stored, not assumed to be 1. |
| A mark demotes a card | ❌ | Velocity measures upward movement only; demotions are not subtracted. |
| Toggling the reading/writing **goal** | ❌ | Since migration 143 a toggle re-bands *nothing* — it only changes which bars are counted at read time (§2a). No mark, no row. |
| Seeding a card as "already learned" (`updateTypedMarkHistory`) | ❌ | Goes through `VocabEntryDAL`, not `FlashcardMarkService` — a declaration, not a review. |
| Undoing a mark | 🔁 rows deleted | `undoMark` deletes by `(vocabEntryId, markTimestamp)`, so an undone mark gives back the band-steps it earned. |

**One mark writes at most one row.** `BAR_MARK_TYPES` partitions the four mark types
across the three bars, so a review can promote exactly one bar — there is no fan-out
and no chance of double-counting a single mark.

## 2a. Which bars count — goal bars only, filtered at READ

Every promotion is **logged**, on whichever bar it moved. The goal filter is applied
in the **query**, not at write time:

```
getVelocityByLanguage(userId, windowDays, bars = ['core'])
  → … AND bar = ANY($3::text[])
```

`VelocityController` loads the account and passes
`activeBars({ reading: user.readingGoal, writing: user.writingGoal })`.

**Why filter at read.** Writing only the goal bars' rows would freeze history against
the settings at the time of the review: a learner who turns on the writing goal today
would start from zero, with a week of real writing work invisible. Filtering at read
means the toggle retroactively enriches the number — which matches the rest of the
143 model, where a goal reveals work already done rather than starting it.

The cost is the mirror-image quirk: turning a goal **off** hides steps already
counted, so the number can drop on a settings change. Accepted — it is the same
number the learner would have seen had they never enabled the goal, which is the
consistent story.

## 2b. The boundary breakdown — one count per band boundary

The same query returns velocity **split three ways**: how many cards crossed each
**adjacent-band boundary** inside the window.

```
CATEGORY_BOUNDARIES          (server/contracts/mastery.ts)
  [0] Unfamiliar → Target
  [1] Target     → Comfortable
  [2] Comfortable→ Mastered

VelocityBreakdown            (server/types/velocity.ts)
  { total, boundaryCounts: number[] }   -- aligned with CATEGORY_BOUNDARIES
```

**A multi-band promotion is counted at every boundary it passed through.** A card that
went `Unfamiliar → Comfortable` in one mark adds 1 to `[0]` *and* 1 to `[1]`. That is
the whole reason the split works as a decomposition: `bandsClimbed` **is** the number
of boundaries crossed, so

```
boundaryCounts.reduce(+) === SUM("bandsClimbed") === velocity
```

and the card's three arrows (`+4`, `+3`, `+2`) always add up to the headline `9`.
The alternative — bucketing rows by their literal `(fromCategory, toCategory)` pair —
was rejected: it yields up to **six** buckets rather than three, and they do not sum to
the headline figure, so the card would print parts that contradict their own total.

`total` is computed as the counts summed rather than read from a parallel
`SUM("bandsClimbed")`, so the two halves of that identity cannot drift apart even if a
row carries a category the contract no longer knows (such a row is dropped: the SQL
ranks with `array_position`, which yields NULL for an unknown band, and a NULL rank
fails every `FILTER`).

**Derived, not stored.** `CATEGORY_BOUNDARIES` is `CATEGORY_ORDER` zipped with itself
offset by one, and the DAL *generates* its `COUNT(*) FILTER` list from that array's
length. Adding a fifth band changes one array and the wire grows a fourth count; there
is no hand-written list of boundaries anywhere in the stack.

**Code:** `CATEGORY_BOUNDARIES` (`server/contracts/mastery.ts`),
`VelocityBreakdown` / `emptyVelocityBreakdown` (`server/types/velocity.ts`),
`CategoryPromotionDAL.getVelocityByLanguage`, `VelocityArrows` (§4).

---

## 3. The table (migration 137)

`database/migrations/137-create-category-promotions.sql`

```
category_promotions
  id             uuid PK
  "userId"       uuid NOT NULL → users(id) ON DELETE CASCADE
  language       varchar(10)
  "vocabEntryId" integer          -- vet id; NO foreign key (see below)
  "fromCategory" varchar(16)
  "toCategory"   varchar(16)
  "bandsClimbed" smallint  CHECK > 0
  "markType"     varchar(16)
  bar            varchar(16) NOT NULL DEFAULT 'core'   -- migration 143; CHECK core|reading|writing
  "markTimestamp" timestamptz     -- the causing ReviewMark's ts; the undo key
  "promotedAt"   timestamptz DEFAULT now()
```

Indexes: `("userId", language, "promotedAt")` for the velocity query,
`("vocabEntryId", "markTimestamp")` for the undo delete. **No index on `bar`** —
that predicate discards a handful of rows from an already-tiny 7-day window.

`bar` is derived from `markType` via `barForMarkType()`, so it is redundant in the
strict sense — but it is the column the velocity query filters on, and deriving it in
SQL would mean a `CASE` in the `WHERE` clause on every read. Pre-143 rows are all
`core` by construction (there was only one bar). The `DEFAULT` is deliberately kept
rather than dropped after backfill, so pre-143 code inserting without the column
during the deploy window still writes correct rows.

**No FK on `vocabEntryId`**: vet is split per language
(`vocabentries_zh` / `vocabentries_es` share one id sequence), so the referent
lives in one of two tables and Postgres cannot express that. Rows are cleaned up
by the `userId` cascade; an orphan from a deleted card is harmless — it ages out
of the window within 7 days.

---

## 4. Layering

| Layer | File | Role |
|---|---|---|
| contract | `server/contracts/mastery.ts` — `CATEGORY_ORDER`, `CATEGORY_BOUNDARIES`, `categoryRank()`, `bandsClimbed()` | The band-step arithmetic. Shared with the client via `src/utils/masteryCompute.ts`; `VelocityStatCard` / `VelocityArrows` import `CATEGORY_BOUNDARIES` from here directly, so the column order and the SQL column order are one list. |
| DAL | `server/dal/implementations/CategoryPromotionDAL.ts` (behind `ICategoryPromotionDAL`) | The only SQL. Every method takes an optional `PoolClient` so a caller already holding a connection or a transaction can enlist the query (BACKEND_LAYERING §3). `getVelocityByLanguage` returns a `VelocityBreakdown` per language, not a bare number — one scan produces both the headline and its boundary split (§2b). |
| write (mark) | `server/services/FlashcardMarkService.ts` → `applyMark`, after the mark's bar band is computed | `bandsClimbed(barCategoryBefore, barCategoryAfter) > 0` → `recordPromotion({…, bar})`. Note it measures **the mark's own bar**, not the core band. **Best-effort**, and issued AFTER the mark's transaction commits: a failed INSERT inside that transaction would abort the mark itself, and losing a stat must never fail a user's review write. |
| write (undo) | `server/services/FlashcardMarkService.ts` → `undoMark`, inside the undo transaction | `deleteForMark(cardId, markTimestamp, client)`. **Not** best-effort: it rolls back with the rest of the undo. |
| controller | `server/controllers/VelocityController.ts` | `GET /api/users/me/velocity`. No service layer — the only rules are picking the headline language (mirrors `WinsController`) and resolving `activeBars()` from the account's goal flags. It always loads the user now, since the bar filter needs the flags. |
| route | `server/routes/userRoutes.ts` | Registered before `GET /api/users/:id` so the param route can't shadow it. |
| client api | `src/api/velocity.ts` | `fetchVelocity(language?)`. No `token` param (FRONTEND_LAYERING §3.2). |
| client hook | `src/hooks/useVelocity.ts` | Keys on `isAuthenticated` + `selectedLanguage`, **never** `token` (CLAUDE.md silent-refresh rule). |
| UI | `src/components/velocity/` — `LibraryShelfWithVelocity`, `VelocityStatCard`, `VelocityArrows` | Shelf System v2, artboard 5. **`LibraryShelfWithVelocity`** is the only exported piece: it renders the four utcm band spines (`DeckBuckets`) and the Velocity card under them as ONE component, because the card's arrows must line up with the spines. The band row is drawn **without its wooden board** (`board={false}`, and `ShelfRow` drops the 12px board gap with it). Instead, two plain **section dividers** (`SectionDivider`: a 1px `COLORS.rowBorder` hairline, the rule `SectionRule` draws) frame the Velocity block, one 12px under the spines and one 12px under the figure, inset by the shelf's gutter. The velocity card is drawn **frameless** (`FRAMELESS_CARD_SX`: no fill, hairline or padding), so the arrows hang straight off the top divider (`marginTop: -6`). It owns the ref between the two halves, holds each half back until it loads (`null` props) and reserves each half's height. **`VelocityStatCard`** is a `StatCard` with three parts: the arrows in the `lead` slot (above the overline), then the "Velocity ⓘ" heading (`src/components/InfoTip.tsx`), then the total. The heading is set in the app's heading voice (`FONTS.sans`, semibold, sentence case, `SIZE.subtitle`), not as `StatCard`'s 10px overline; the span overrides the `Label` recipe it is wrapped in. There is **no equation and no caption**: the old `9 = 4 U→T + 3 T→C + 2 C→M` line was replaced by the arrows. The artboard's "Mastery level-ups in the last 7 days" body copy was deliberately not rendered, because the window and the definition of a level-up live in the ⓘ. **The ⓘ sentence lives here and only here.** **`VelocityArrows`** draws one hand-marked U-arrow per `CATEGORY_BOUNDARIES` entry. Each leaves one spine, dips, and climbs into the next with an arrowhead, carrying `+N` in its cup; a zero still draws as `+0`. The arrow strokes are ink (`COLORS.onSurface`). Each `+N` is an ink figure on a highlighter pill in its **destination** band's Mid tier (`getBandMid`). The pills are HTML spans over the SVG, because in v2 hue never carries text. In the overline, the word VELOCITY is centred over the figure and the ⓘ hangs off its right edge, out of flow. They are placed from **measured** spine centres (`useSpineCenters` finds the spines by `DeckBuckets`' exported `BAND_SPINE_CLASS` and watches them with a `ResizeObserver`), not from the artboard's fixed x positions, because the band row is `distribute`d and the profile panel narrows its spines. Each arrow is ONE continuous **140°** circular arc (`arrowBetween`, `ARROW.sweepDegrees`). 160° still read as a semicircle. Its radius comes from the chord, R = chord / (2·sin 70°): at the design's 84px spacing that is R ≈ 33.5, with the lowest point ~22px down. The arrowhead keeps the artboard's 12px wings at ±34° off the tip tangent, which now leans 20° outward. Wider spacing draws a wider, deeper U, and the SVG grows to fit. The `+N` pill sits on the arc's lowest point and hides the stroke behind it. The felt-tip look is an `feTurbulence` → `feDisplacementMap` filter with a per-instance id (`useId`); the `+N` pills sit outside it so they stay crisp. The arrows **always** draw, reading `+0` in a week with no level-ups. The server sends `[0,0,0]` for an empty window, and if `boundaryCounts` is missing while the total is 0 (e.g. a failed fetch) the card substitutes three zeros, the only split of 0. The arrows are dropped only when `boundaryCounts` is missing or the wrong length while the total is non-zero, because mislabelling a boundary is worse than omitting it. |
| Hosts | `src/pages/AccountSheet.tsx` — `account-sheet__library`; `src/features/profile/ProfileStatsCard.tsx` — `profile-stats__library` | Both render `LibraryShelfWithVelocity`: the library is the state and velocity is its rate of change, so the reader meets the thing before its derivative. The section header stays with the host. The profile renders one per language inside a panel that already pads itself, so it passes `gutter={false}` and `cardSx={{ mx: 0 }}`. |
| second consumer | `server/services/FriendsService.getLeaderboard` → `src/features/friends/FriendsPage.tsx` | The friends leaderboard **ranks** on velocity (§ 4a). |

### 4a. Second consumer — the friends leaderboard

`/friends` ranks the viewer and their friends by velocity
([FRIENDS_FEATURE.md § 1a](./FRIENDS_FEATURE.md)). It does **not** go through
`VelocityController`, because that controller answers for one caller:

* `ICategoryPromotionDAL.getVelocityBuckets(userIds, windowDays)` reads **many
  users at once**, grouped by `(userId, language, bar)` — one query for the whole
  board, no N+1.
* It is deliberately **not** bar-filtered in SQL, unlike `getVelocityByLanguage`:
  which bars count depends on each row's own goal flags, and the result spans many
  users. `FriendsService` folds the buckets against each person's `activeBars`.
* Each person is scored in **their own** `selectedLanguage`, not the viewer's.

If the window ever changes, `VELOCITY_WINDOW_DAYS` remains the single source —
both paths import it, and the friends response ships it as `windowDays` so the
client's unit line cannot drift.

### API

```
GET /api/users/me/velocity[?language=zh]
→ { velocity, language, byLanguage, boundaryCounts, total, windowDays }
```

`velocity` is the number for `language` — the explicit query param if supplied,
otherwise the account's `selectedLanguage`. `byLanguage` omits languages with zero
promotions; clients default those to 0.

`boundaryCounts` breaks **the headline language only** down by boundary (§2b) and is
always present at full length, `[0,0,0]` for a learner with no promotions —
`byLanguage` deliberately stays flat numbers, because it answers "which languages is
this account moving in", not "where in the ladder".

The profile response carries the same split per language as
`ProfileLanguageStats.velocityBoundaryCounts` (`server/types/userProfile.ts`), so each
language panel renders its own breakdown.

---

## 5. Tests

`server/__tests__/velocity.test.ts` pins `categoryRank` / `bandsClimbed`, the
demotion-returns-0 rule, the single-mark-crosses-two-bands case, and the post-143
rules: a mark scores on **its own** bar (a reading mark moves the reading bar, never
the core one) and `activeBars()` decides which bars the query sums.

It also pins the boundary split (§2b): that `CATEGORY_BOUNDARIES` really is
`CATEGORY_ORDER`'s adjacent pairs, and — for **every** ordered pair of bands, not just
the adjacent ones — that the number of boundaries a promotion crosses equals
`bandsClimbed`. That second test is what guarantees the card's three arrows (`+x`, `+y`, `+z`) add up
to the total printed under them. The counting itself is SQL, so the test pins the *rule* the `COUNT(*)
FILTER` list implements rather than the query; the identity was also checked against
dev data (111 + 35 + 1 = 147 = `SUM("bandsClimbed")`).

---

## 6. Known gaps

- **Not backfillable** (§1) — the number is meaningless for the first 7 days after deploy.
- **Turning a goal off shrinks the number** (§2a). The read-side filter is the
  deliberate choice; this is its accepted cost. (The pre-143 version of this gap —
  bulk demotion on enabling a goal — is **gone**: goal toggles re-band nothing.)
- ~~**No leaderboard integration.**~~ Resolved: the friends leaderboard ranks on
  velocity through the grouped `getVelocityBuckets` (§4a), which is the all-users
  variant this gap asked for.
- **Demotions are invisible in the breakdown too.** `boundaryCounts` counts upward
  crossings only, so it is a climb log, not a net flow between bands — a card that
  fell back out of Comfortable still shows in the count that put it there.
