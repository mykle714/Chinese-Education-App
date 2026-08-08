# Velocity — recent rate of mastery progress

Status: **implemented** (migration 137). Not yet deployed to prod.

**Velocity** = the number of **utcm band-steps** a learner's cards climbed in the
**last 7 days**, per **(user, language)**.

One card that moved `Unfamiliar → Comfortable` counts **2**, exactly as two cards
that each moved up one band count 2. The window **slides** — it is always
`now() - 7 days`, never a calendar week or the Sunday-04:00 boundary that
[wins and community votes](./GAMES_FEATURE.md) use. A rolling rate must not
collapse to near-zero every Sunday morning.

Related: [MASTERY_REWORK.md](./MASTERY_REWORK.md) (the utcm bands velocity is
measured in), [FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md](./FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md)
(the mark/undo handlers that write the log).

---

## 1. Why an event log, and why it can't be backfilled

A card's utcm `category` is **not stored**. It is computed on read from
`typedMarkHistory` + the account's goal flags — `computeUtcm()` in
`server/contracts/mastery.ts:170`, mirrored by the SQL `compute_utcm_category()`
(migration 101). Nothing in the schema records that a card *moved* between bands,
and the 8-slot per-type mark window discards the marks that would let us
reconstruct the movement.

So a promotion is observable at exactly **one instant**: inside
`POST /api/flashcards/mark`, which already computes the category on both sides of
the mark (`server/routes/flashcardRoutes.ts:121` and `:155`). The
`category_promotions` table is that observation, appended.

**Consequence:** velocity is **not backfillable**. Every account starts at 0 on
deploy and the number becomes meaningful after ~7 days of use.

---

## 2. Counting rules

| Event | Logged? | Why |
|---|---|---|
| A mark pushes a card up one band | ✅ `bandsClimbed = 1` | The core case. |
| A mark pushes a card up two bands at once | ✅ `bandsClimbed = 2` | pbh is continuous — one mark can cross two boundaries (see the test in `server/__tests__/velocity.test.ts`). This is why the step count is stored, not assumed to be 1. |
| A mark demotes a card | ❌ | Velocity measures upward movement only; demotions are not subtracted. |
| Toggling the reading/writing **goal** re-bands every card | ❌ | That re-scores *past* work, it is not work done this week. No mark, no row. |
| Seeding a card as "already learned" (`updateTypedMarkHistory`) | ❌ | Goes through `VocabEntryDAL`, not the mark handler — a declaration, not a review. |
| Undoing a mark | 🔁 rows deleted | `undoLastMark` deletes by `(vocabEntryId, markTimestamp)`, so an undone mark gives back the band-steps it earned. |

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
  "markTimestamp" timestamptz     -- the causing ReviewMark's ts; the undo key
  "promotedAt"   timestamptz DEFAULT now()
```

Indexes: `("userId", language, "promotedAt")` for the velocity query,
`("vocabEntryId", "markTimestamp")` for the undo delete.

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
| write (mark) | `server/routes/flashcardRoutes.ts` — after `category` is computed | `bandsClimbed(before, after) > 0` → `recordPromotion(...)`. **Best-effort**: wrapped in try/catch and logged, because losing a stat must never fail a user's review write. |
| write (undo) | `server/routes/flashcardRoutes.ts` — inside the undo transaction | `deleteForMark(cardId, markTimestamp, client)`. **Not** best-effort: it rolls back with the rest of the undo. |
| controller | `server/controllers/VelocityController.ts` | `GET /api/users/me/velocity`. No service layer — the only rule is picking the headline language (mirrors `WinsController`). |
| route | `server/routes/userRoutes.ts` | Registered before `GET /api/users/:id` so the param route can't shadow it. |
| client api | `src/api/velocity.ts` | `fetchVelocity(language?)`. No `token` param (FRONTEND_LAYERING §3.2). |
| client hook | `src/hooks/useVelocity.ts` | Keys on `isAuthenticated` + `selectedLanguage`, **never** `token` (CLAUDE.md silent-refresh rule). |
| UI | `src/pages/AccountPage.tsx` — `account-page__velocity-card` | One stat card under the deck buckets: label, big number, `"level-ups in the last N days"`. |

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
demotion-returns-0 rule, and the single-mark-crosses-two-bands case.

---

## 6. Known gaps

- **Not backfillable** (§1) — the number is meaningless for the first 7 days after deploy.
- **Goal toggles desync the story, not the data.** After enabling the writing goal,
  cards demote in bulk; a learner re-promoting them earns velocity for work that
  partly predates the toggle. Accepted: the alternative (logging the toggle's
  re-band as promotions/demotions) would make velocity spike or crater on a
  settings change.
- **No leaderboard integration.** Velocity is per-account display only; if it ever
  becomes competitive, `getVelocityByLanguage` needs an all-users grouped variant
  like `WinsDAL.getWeeklyCountsByUser()` to avoid an N+1.
