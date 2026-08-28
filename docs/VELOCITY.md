# Velocity — recent rate of mastery progress

Status: **implemented** (migration 137). Not yet deployed to prod.

**Velocity** = the number of **utcm band-steps** a learner's cards climbed in the
**last 7 days**, per **(user, language)**, **summed across the mastery bars the
account is pursuing**.

One card that moved `Unfamiliar → Comfortable` counts **2**, exactly as two cards
that each moved up one band count 2. The window **slides** — it is always
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
| contract | `server/contracts/mastery.ts` — `CATEGORY_ORDER`, `categoryRank()`, `bandsClimbed()` | The band-step arithmetic. Shared with the client via `src/utils/masteryCompute.ts`. |
| DAL | `server/dal/implementations/CategoryPromotionDAL.ts` (behind `ICategoryPromotionDAL`) | The only SQL. Every method takes an optional `PoolClient` so a caller already holding a connection or a transaction can enlist the query (BACKEND_LAYERING §3). |
| write (mark) | `server/services/FlashcardMarkService.ts` → `applyMark`, after the mark's bar band is computed | `bandsClimbed(barCategoryBefore, barCategoryAfter) > 0` → `recordPromotion({…, bar})`. Note it measures **the mark's own bar**, not the core band. **Best-effort**, and issued AFTER the mark's transaction commits: a failed INSERT inside that transaction would abort the mark itself, and losing a stat must never fail a user's review write. |
| write (undo) | `server/services/FlashcardMarkService.ts` → `undoMark`, inside the undo transaction | `deleteForMark(cardId, markTimestamp, client)`. **Not** best-effort: it rolls back with the rest of the undo. |
| controller | `server/controllers/VelocityController.ts` | `GET /api/users/me/velocity`. No service layer — the only rules are picking the headline language (mirrors `WinsController`) and resolving `activeBars()` from the account's goal flags. It always loads the user now, since the bar filter needs the flags. |
| route | `server/routes/userRoutes.ts` | Registered before `GET /api/users/:id` so the param route can't shadow it. |
| client api | `src/api/velocity.ts` | `fetchVelocity(language?)`. No `token` param (FRONTEND_LAYERING §3.2). |
| client hook | `src/hooks/useVelocity.ts` | Keys on `isAuthenticated` + `selectedLanguage`, **never** `token` (CLAUDE.md silent-refresh rule). |
| UI | `src/pages/AccountPage.tsx` — `account-page__velocity-card` | The shared `StatCard` primitive (`src/components/primitives/StatCard.tsx`), centred, under the library shelf: the "VELOCITY" overline + a tappable ⓘ (`src/components/InfoTip.tsx`), the big number, then `"Mastery level-ups in the last N days"` as the card's `description`. |
| ⚠️ The window sentence is BACK in the layout | — | It was a permanent caption, then moved into the ⓘ to keep the number unexplained-until-asked, and artboard 5 of the shelf redesign draws it as visible body copy under the figure again — so it is printed. The ⓘ was NOT deleted along with it: it now answers the question the caption raises rather than repeating it, defining what a level-up is (`Unfamiliar → Target → Comfortable → Mastered`). If the two ever say the same thing again, delete the ⓘ, not the caption. |
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
→ { velocity, language, byLanguage, total, windowDays }
```

`velocity` is the number for `language` — the explicit query param if supplied,
otherwise the account's `selectedLanguage`. `byLanguage` omits languages with zero
promotions; clients default those to 0.

---

## 5. Tests

`server/__tests__/velocity.test.ts` pins `categoryRank` / `bandsClimbed`, the
demotion-returns-0 rule, the single-mark-crosses-two-bands case, and the post-143
rules: a mark scores on **its own** bar (a reading mark moves the reading bar, never
the core one) and `activeBars()` decides which bars the query sums.

---

## 6. Known gaps

- **Not backfillable** (§1) — the number is meaningless for the first 7 days after deploy.
- **Turning a goal off shrinks the number** (§2a). The read-side filter is the
  deliberate choice; this is its accepted cost. (The pre-143 version of this gap —
  bulk demotion on enabling a goal — is **gone**: goal toggles re-band nothing.)
- **No leaderboard integration.** Velocity is per-account display only; if it ever
  becomes competitive, `getVelocityByLanguage` needs an all-users grouped variant
  like `WinsDAL.getWeeklyCountsByUser()` to avoid an N+1.
