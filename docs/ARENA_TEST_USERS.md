# Arena Load-Test Users (55 synthetic accounts, **on PROD**)

> ⚠️ **TEMPORARY DATA LIVING IN PRODUCTION.** These 55 accounts exist in the prod
> `users` table. Delete them once Arena testing is finished:
> `database/testdata/arena-test-users-teardown.sql`.

Distinct from [TEST_USERS.md](./TEST_USERS.md), which documents the *dev* accounts that
`database/init/` creates automatically on container start. Those are loginable and local.
These are neither.

| | Dev test users ([TEST_USERS.md](./TEST_USERS.md)) | Arena load-test users (this doc) |
|---|---|---|
| Environment | dev containers | **prod** |
| Created by | `database/init/` on startup | manual, `database/testdata/arena-test-users-seed.sql` |
| Loginable | yes (`testing123`) | **no** — password is not a bcrypt hash |
| Lifetime | permanent | delete after Arena testing |

## What exists

Seeded **2026-08-16**. Prod had 15 real users and 16 `user_languages` rows before this.

| Field | Value |
|---|---|
| Count | **55** |
| Email | `arena-test-01@arena-test.local` … `arena-test-55@arena-test.local` |
| Name | `Arena Test 01` … `Arena Test 55` |
| Password | `NOLOGIN-arena-test-account` — a literal, **not** a hash |
| Timezone | `America/Los_Angeles` (all 55) |
| `selectedLanguage` | `zh` |
| `geoCell` | `NULL` — the location-less pool |
| `user_languages` | one `zh` row each, `division = 1` |
| `arenaOptInWeek` | `2026-08-18` (the week opening Tue 04:00 local) |

### Why these particular choices

**The `@arena-test.local` email suffix is the only handle.** Both scripts scope every
statement by `email LIKE '%@arena-test.local'`, so neither can reach a real account. If
you write further queries against these users, key off the suffix too — not off name,
`createdAt`, or an id range.

**The password is deliberately not a valid bcrypt hash.** `bcrypt.compare()` can never
succeed against it, so 55 accounts with guessable emails sitting in prod cannot be logged
into. Do not "fix" this into a real hash.

**All 55 share one timezone on purpose.** Clustering partitions hard by
`(timezone, division)` before it sorts by geohash, so spreading them across timezones
would have produced several undersized partitions instead of one large one. With 55 in a
single partition and 25 seats per board, formation should yield **two full boards plus a
third padded by `arenaSynthetic`** — which is the multi-board behaviour worth testing.

**Real users were not opted in.** The 15 real users' `user_languages` rows still have
`arenaOptInWeek IS NULL`. This is the entire reason the seed script exists rather than
`arena-tick.ts --seed-opt-ins`, which opts in **every row in the database** — on prod
that would enrol real people in an arena they never asked to join.

## ⚠️ Do not force formation early

Formation is gated to a 60-minute lead before the week opens — **Tue 2026-08-18 03:00
local**. Running `arena-tick.js --at` with a time inside that window would form the
boards immediately, and it is idempotent, so it *looks* harmless.

It is not, while real users can still opt in. Formation checks `arenaExistsForBucket`
before building a board. Once an arena exists for `(America/Los_Angeles, division 1,
2026-08-18)`, a real user who opts in on Monday finds the bucket already taken and gets
**no arena at all that week**. Let the cron form the boards at Tue 03:00 so late opt-ins
are included.

## Verifying

```sql
-- Seeded correctly, real users untouched. Expect: 55 | 15
SELECT count(*) FILTER (WHERE email LIKE '%@arena-test.local')     AS test_users,
       count(*) FILTER (WHERE email NOT LIKE '%@arena-test.local') AS real_users
FROM users;

-- Only the test users are opted in. Expect: NULL|1|16 and 2026-08-18|1|55
SELECT "arenaOptInWeek", division, count(*)
FROM user_languages GROUP BY 1,2 ORDER BY 1 NULLS FIRST;

-- After Tue 03:00 — the boards. Expect ~3 arenas, 25 seats each.
SELECT a.id, a."weekKey", count(m.*) AS members,
       count(*) FILTER (WHERE m."userId" IS NULL) AS synthetic
FROM arenas a LEFT JOIN arena_members m ON m."arenaId" = a.id
GROUP BY a.id, a."weekKey" ORDER BY a.id;
```

```bash
tail -n 20 logs/arena-cron.log     # expect "done — resolved 0, formed 3" at Tue 03:06
```

The standing invariant from [ARENA_FEATURE.md](./ARENA_FEATURE.md) § 9 Q21 applies to
these users as much as real ones — a resolved arena must have no live members, or those
accounts are locked out of every future arena:

```sql
SELECT a.id, count(*) AS stuck_live
FROM arenas a JOIN arena_members m ON m."arenaId" = a.id
WHERE a."resolvedAt" IS NOT NULL AND m."isLive"
GROUP BY a.id;
```

## Teardown

```bash
docker cp database/testdata/arena-test-users-teardown.sql cow-postgres-prod:/tmp/teardown.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 -f /tmp/teardown.sql
```

Removes their `arena_members` rows first (so the count is visible rather than silently
cascading), then the accounts; `user_languages` cascades via the FK. It ends by printing
the remaining membership of every arena and the final user counts — expect `0 | 15`.

Arenas left empty or undersized by the teardown are **not** deleted; inspect and drop
them by hand if you care. An empty arena is harmless.

## Files

| Path | Purpose |
|---|---|
| `database/testdata/arena-test-users-seed.sql` | creates the 55 accounts + opt-ins (idempotent) |
| `database/testdata/arena-test-users-teardown.sql` | deletes them, scoped by email suffix |

Related: [ARENA_FEATURE.md](./ARENA_FEATURE.md) (design, clustering, the week cycle),
[TEST_USERS.md](./TEST_USERS.md) (the dev accounts).
