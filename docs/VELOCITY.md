# Velocity — recent rate of mastery progress

Status: **implemented** and deployed (migrations 137 + 143; PPE is current well past both).

**Velocity** = the number of **utcm band-steps** a learner's cards climbed in the
**last 7 days**, per **(user, language)**, **summed across the mastery bars the
account is pursuing**.

One card that moved `Unfamiliar → Comfortable` counts **2**, exactly as two cards
that each moved up one band count 2. That total is also reported **split by which
boundary was crossed** — see §2b, which is what the Velocity card renders on one
line as `9 = 4 U→T + 3 T→C + 2 C→M`. The window **slides** — it is always
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

and the card can show `9 = 4 + 3 + 2` without the arithmetic ever being a coincidence.
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
`CategoryPromotionDAL.getVelocityByLanguage`, `VelocityStatCard` (§4).

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
| contract | `server/contracts/mastery.ts` — `CATEGORY_ORDER`, `CATEGORY_BOUNDARIES`, `categoryRank()`, `bandsClimbed()` | The band-step arithmetic. Shared with the client via `src/utils/masteryCompute.ts`; `VelocityStatCard` imports `CATEGORY_BOUNDARIES` from here directly, so the column order and the SQL column order are one list. |
| DAL | `server/dal/implementations/CategoryPromotionDAL.ts` (behind `ICategoryPromotionDAL`) | The only SQL. Every method takes an optional `PoolClient` so a caller already holding a connection or a transaction can enlist the query (BACKEND_LAYERING §3). `getVelocityByLanguage` returns a `VelocityBreakdown` per language, not a bare number — one scan produces both the headline and its boundary split (§2b). |
| write (mark) | `server/services/FlashcardMarkService.ts` → `applyMark`, after the mark's bar band is computed | `bandsClimbed(barCategoryBefore, barCategoryAfter) > 0` → `recordPromotion({…, bar})`. Note it measures **the mark's own bar**, not the core band. **Best-effort**, and issued AFTER the mark's transaction commits: a failed INSERT inside that transaction would abort the mark itself, and losing a stat must never fail a user's review write. |
| write (undo) | `server/services/FlashcardMarkService.ts` → `undoMark`, inside the undo transaction | `deleteForMark(cardId, markTimestamp, client)`. **Not** best-effort: it rolls back with the rest of the undo. |
| controller | `server/controllers/VelocityController.ts` | `GET /api/users/me/velocity`. No service layer — the only rules are picking the headline language (mirrors `WinsController`) and resolving `activeBars()` from the account's goal flags. It always loads the user now, since the bar filter needs the flags. |
| route | `server/routes/userRoutes.ts` | Registered before `GET /api/users/:id` so the param route can't shadow it. |
| client api | `src/api/velocity.ts` | `fetchVelocity(language?)`. No `token` param (FRONTEND_LAYERING §3.2). |
| client hook | `src/hooks/useVelocity.ts` | Keys on `isAuthenticated` + `selectedLanguage`, **never** `token` (CLAUDE.md silent-refresh rule). |
| UI | `src/components/VelocityStatCard.tsx` | The figure, its ⓘ, and the boundary breakdown (§2b) — **all on one line**, as an equation: `9 = 4 U→T + 3 T→C + 2 C→M`. Built on the shared `StatCard` primitive (`src/components/primitives/StatCard.tsx`): the "VELOCITY" overline + a tappable ⓘ (`src/components/InfoTip.tsx`), and the equation in the single `value` slot — NOT in a second row under it, so the primitive keeps its "one big figure" shape (its own header warns that three stacked figures is a data table wearing a costume) and the card stays one line tall on both hosts. That slot renders inside a `<p>`, which is why every node in the equation is a `span`. The `=` and `+` are load-bearing, not decoration: they are what tells a reader the small figures are terms of the big one. Each term is tinted with its **destination** band's ink (`getBandInk`, `src/utils/categoryColors.ts`), so "cards that reached Mastered" is the same blue here as on every band chip in the app; the terms may **wrap** (centred) rather than clip, which only happens at three-digit velocities inside the profile's already-inset panel. The equation is skipped entirely when `boundaryCounts` is absent or the wrong length — mislabelling a term is worse than omitting it. It runs **without** a `description`: the window ("counted over the last N days") is said inside the ⓘ text instead. **The ⓘ sentence lives here and only here** — velocity is uninterpretable without the definition of a level-up, and a second host writing its own copy of that sentence is a copy that will drift. |
| Hosts | `src/pages/AccountPage.tsx` — `account-page__velocity-card`; `src/features/profile/ProfileStatsCard.tsx` — `profile-stats__velocity` | Both render it centred, **under the library shelf** — the library is the state, velocity is its rate of change, so the reader meets the thing before its derivative. The account page shows the signed-in user's, page-wide; the profile shows one per language, inside a panel that already insets it (so it passes `sx={{ mx: 0 }}` to cancel `SectionCard`'s own page gutter). |
| ⚠️ The window sentence is NOT in the layout | — | It was a permanent caption, then moved into the ⓘ to keep the number unexplained-until-asked. Artboard 5 of the shelf redesign draws it as visible body copy again, but **the shipped card has no `description`** — the window is stated only inside the ⓘ, which also defines a level-up (`Unfamiliar → Target → Comfortable → Mastered`) and now explains the breakdown row. If the caption is ever restored, make sure the two do not say the same thing; the ⓘ is the one carrying the definition. |
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
`bandsClimbed`. That second test is what guarantees the card's `= x + y + z` equals the
total it is written beside. The counting itself is SQL, so the test pins the *rule* the `COUNT(*)
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
