# API Abuse Hardening

How the HTTP surface holds up against a client that ignores the UI and talks to the
API directly. **Scope: illegal state.** Not every abusive-looking action is a bug —
inflating your own mastery, for instance, is explicitly acceptable (the honour system
is the design, see [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 8). What is *not*
acceptable is a request sequence that leaves an account or the server in a state the
app's own rules say cannot exist: unearned night-market unlocks, a streak that cannot
break, progress rows for languages that do not exist, two live challenges for one
pair, unbounded rows.

Referenced by: [BACKEND_LAYERING.md](./BACKEND_LAYERING.md).

---

## 1. The three failure shapes

Almost every hole found in the 2026-08-24 audit was one of three shapes. Recognising
them is more useful than memorising the individual fixes.

### 1a. Check-then-write across a round trip

A guard that READS state, decides in JS, and WRITES later is not a guard — it is a
suggestion, and concurrent requests walk straight through it. It only matters where
the invariant is real, but where it is real it is usually the most valuable thing on
the endpoint.

The rule: **if the invariant matters, enforce it in one statement or inside one
transaction that holds a lock.**

| Invariant | Enforced by |
|---|---|
| One minute point per 59s | `UPDATE … WHERE lastMinutePointIncrement <= now − 59s` — `IUserDAL.claimMinutePointIncrement` |
| One challenge per pair per week | `study_challenges_pair_week_uniq` (a real index) |
| One unfinished challenge per pair | advisory lock — `IStudyChallengeDAL.lockUsersForChallenge` |
| ≤ 6 active challenges per (user, language) | same advisory lock, count inside the transaction |
| One occupant per market slot | `UNIQUE (placedTemplateId, placeholderAreaId)` |

Advisory locks (`pg_advisory_xact_lock`) are the tool when the invariant is a COUNT or
a derived predicate — neither is expressible as a constraint. They are taken on user
ids **in sorted order**, which is what makes concurrent A→B and B→A requests
deadlock-free, and they release on commit or rollback so there is no unlock path to
forget.

### 1b. Trusting a client-supplied value that decides server state

A value the client sends for a good reason is still attacker-controlled. The test is
not "why would the client lie" but "what does this value decide".

* **`timestamp`** on the minute-point increment decides which 04:00-bounded local day
  a minute lands on — and, through `advanceStreakForDate`, writes
  `user_languages."lastStreakDate"`. Unbounded, it let a crafted request stamp a
  future date, after which the hourly penalty cron reads the account as permanently
  current and **the streak can never break**. Now clamped to ±30 min of server time
  (clamped, not rejected, so a skewed device clock still works).
* **`language`** on any write. `user_languages.language` and several other columns
  have **no CHECK constraint**, so an unvalidated string writes a progress row for a
  language the app does not support, which then appears in the leaderboard's per-user
  sum, in arena formation and in the penalty cron's partitioning. Every write path
  now goes through `resolveLanguage` / `resolveWriteLanguage`
  (`server/utils/languageParam.ts`). ⚠️ Note `vetTableForLanguage` *silently defaults
  to zh* for anything unrecognised — it will not fail loudly for you.
* **`cardId`** on `POST /api/starterPacks/sort`. The supply queries that feed discover
  filter on `discoverable`, so a well-behaved client can only send ids that pass — but
  the sort endpoint used to look up the id with no such filter, letting any dictionary
  row (including rows whose enrichment columns are still null) be added to a library.
  That is exactly the state CLAUDE.md's mark-discoverable rule exists to prevent.
* **`gameId`** on `/api/games/:gameId/progress`. A raw path segment keying a
  `(userId, gameId)` upsert. Now whitelisted against `KNOWN_GAME_IDS`.
* **`entryKey`** on votes and writing-practice completions — unbounded `VARCHAR` with
  no foreign key. Now length-capped, and a vote additionally requires the design to
  exist.

### 1c. Unbounded growth

Individually harmless rows, without a ceiling, are a disk problem. Field sizes were
mostly capped already; **counts** were not.

| Table | Bound |
|---|---|
| `texts` | 500 user-created documents per user (`MAX_DOCUMENTS_PER_USER`); fields already capped at 200 / 500 / 50 000 |
| `decks` | 100 per (user, language) — predates this work |
| `gameprogress` | one row per known game — `KNOWN_GAME_IDS` |
| `writing_practice_completions` | `entryKey` ≤ 8 chars, language validated |
| `community_layout_votes` | `entryKey` ≤ 64 chars, design must exist |
| `wins` | `varchar(64)` columns; count bounded only by the write limiter |

---

## 2. The write limiter

`writeLimiter` (`server/middleware/rateLimits.ts`) is mounted globally in
`server.ts`, ahead of every router: **600 writes per 5 minutes per user**, GET/HEAD/
OPTIONS skipped.

Keyed on **userId, not IP** — an IP key would let one abusive client throttle a whole
office or CGNAT range, and is trivially sidestepped anyway. Because the limiter runs
before the routers (each route applies `authenticateToken` itself), `req.user` does
not exist yet, so `rateLimitIdentity` verifies the same JWT separately. That
verification never throws and never responds: which status code a bad token produces
stays the auth middleware's business.

**It is a backstop, not a correctness mechanism.** It bounds how hard anything can be
leaned on; it does not make a TOCTOU safe. Do not use "the limiter covers it" as a
reason to leave a read-then-write guard in place.

---

## 3. Role gates (all verified 2026-08-24)

Gates live in the **service** layer, not the controller, so they cannot be bypassed by
a second caller. The one exception is `/api/arena/admin/tick`, gated in
`ArenaController` because the service method is also the cron's entry point.

| Role | Covers |
|---|---|
| `users.isTemplateAuthor` | all 9 template mutations, all 7 sandbox mutations, `POST /api/nightMarket/dev/adjustMinutes` (a real prod route despite the `/dev/` path) |
| `users.isValidator` | all 5 validation endpoints, `/api/arena/admin/tick`, the study-challenge `anytime` escape hatch, AI enrichment spend |

---

## 4. Open items

* **`community_layout_votes."entryKey"` is still an unconstrained `VARCHAR`** at the
  database level. The service caps new writes at 64 characters; a `VARCHAR(64)`
  migration would make that durable and cover existing rows. Not applied — schema
  changes are confirmed with the repo owner first.
* **`user_languages.language` has no CHECK constraint.** Every write path now
  validates, but the column would accept anything a future path forgets to coerce.
* **Duplicated `_supplyGate`.** `StarterPacksService._supplyGate` and
  `ProvisionalCardDAL._supplyGate` are byte-identical implementations of the same
  rule. They agree today; a change to one silently desynchronises discover from
  provisional lending. Worth extracting to `server/dal/shared/`.
