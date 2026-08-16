# ⚠️ TEMPORARY — Combined deploy runbook (the 2026-08-16 backlog drop)

**Delete this file once verified on prod.**
**Deployed to prod yet? NO.**

Three runbooks' worth of work has accumulated unshipped and now goes out together. Deployed
individually each was fine; deployed **together** they interact in two ways that neither
file mentions, and both will stop the deploy dead if discovered live. Read this file first;
the three per-feature runbooks remain the authority on *verification*, this one on *order*.

| Runbook | Ships | Migrations |
|---|---|---|
| [PER_LANGUAGE_MINUTES_DEPLOY_RUNBOOK.md](./PER_LANGUAGE_MINUTES_DEPLOY_RUNBOOK.md) | per-language minute points + night markets | 130, 134, **145** |
| [PROVISIONAL_CARDS_DEPLOY_RUNBOOK.md](./PROVISIONAL_CARDS_DEPLOY_RUNBOOK.md) | provisional cards | 140 |
| [UNIT_SLOT_UNLOCKS_DEPLOY_RUNBOOK.md](./UNIT_SLOT_UNLOCKS_DEPLOY_RUNBOOK.md) | unit-slot unlocks + generated unlock schedule | none (cron SQL only) |

Plus unrelated additive migrations swept along: 132, 133.

---

## ⚠️ Problem 1 — `migrate.sh` will HALT before applying anything

**This is not a warning you can skip past. The script exits 1 and applies nothing.**

`migrate.sh` no longer selects work with a high-water mark; it uses a **set difference**,
and it **stops** when a pending migration's version is *below* the highest recorded
version. Prod's highest recorded version is **144** (the mastery-bars drop, verified
2026-08-11). Every migration in this batch except 145 is below it:

```
pending on prod:  130  132  133  134  140      ← all < 144, triggers the guard
                  145                          ← above, fine
```

So the per-language runbook's instruction — *"Run the normal `/deploy` skill, unmodified.
`migrate.sh` applies 130, 132, 133, 134, 145 in order"* — **is wrong as written.** It was
authored before the runner was rewritten. The run will stop with
`STOPPING: 5 pending migration(s) are BELOW the highest recorded version`.

### The fix, and why it is the *correct* one and not just the one that proceeds

The script stops because it cannot distinguish two cases. **Decide deliberately:**

| Case | Meaning | Flag |
|---|---|---|
| **(a)** They genuinely never ran — the old high-water-mark runner skipped them | ✅ **This is us.** 130/132/133/134/140 landed on `main` *after* 141–144 were cut, so prod's runner never saw them | `--allow-out-of-order` |
| (b) They *did* run but were never recorded — DB bootstrapped from `database/init/01-init-schema.sql` | ❌ Not us. Prod has a real replayed migration history | `--baseline 144` |

**Confirm case (a) before running it** — this is a thirty-second check and choosing wrong
is unrecoverable:

```sql
-- If these return rows/columns, the migration ALREADY ran and this is case (b) — STOP.
-- Expected on prod TODAY (case a): all three come back empty/false.
SELECT to_regclass('user_languages')       AS ul_should_be_null,
       to_regclass('user_language_points') AS ulp_should_be_null;

SELECT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='users' AND column_name='totalMinutePoints')
       AS users_still_has_global_columns_should_be_TRUE;

SELECT pg_get_constraintdef(oid) AS bucket_check_should_lack_provisional
FROM pg_constraint WHERE conname='chk_zh_starter_pack_bucket';
```

If `user_languages` is null, `users."totalMinutePoints"` still exists, and the CHECK still
reads `('library','skip')` — it is case (a), the migrations truly never ran, and
`--allow-out-of-order` is right.

> ⚠️ **Never run `--baseline` here.** It records migrations as applied *without running
> them*. Baselining past 130 would mean `user_languages` is never created, and the app
> would come up pointing at a table that does not exist. 145 would then also fail (it
> self-verifies the old table's presence) — so it fails loudly rather than silently, but
> only after you have already burned the version numbers.

### Version numbers 135 and 136 are burned

Dev records 135/136 with no matching files (superseded during the reconciliation described
in the per-language runbook's History note). **Do not author a new migration as 135 or
136** — `is_applied` would report it as already applied and silently skip it. `migrate.sh`
prints these as `recorded but no longer present as files`. Harmless here; prod never
recorded them, so it will not print the note.

---

## ⚠️ Problem 2 — the two runbooks disagree on step order

They were written independently and give **opposite** instructions:

| Runbook | Says | Because |
|---|---|---|
| Provisional cards (140) | **DB first**, explicitly: *"do this before starting the new code"* | New code writes `starterPackBucket = 'provisional'`, which the current prod CHECK **rejects**. Code-first ⇒ every game/flp top-up throws a constraint violation |
| Per-language minutes (130) | **Code first** — the standard `/deploy` order | Migration 130 drops the `users` columns the old code reads, so DB-first opens a 5xx window on minute-points/night-market endpoints |

Only one order can be used. **Resolution: DB FIRST.** The two constraints are not
symmetrical:

* 140's is a **correctness** constraint — wrong order produces constraint violations on
  real writes.
* 130's is an **availability** constraint — wrong order produces a few seconds of 5xx on
  two endpoint families.

Availability yields to correctness, and the availability cost is **zero here**: prod has no
real customers yet. The per-language runbook's "keep the standard order" recommendation was
written for a solo deploy where 140 did not exist; it is **superseded by this file.**

---

## Step order (authoritative)

1. **Pre-deploy dump.** Standard `/deploy` step, and non-negotiable in this batch — 130
   drops four `users` columns and its rollback path is manual (per-language runbook
   § Rollback).

2. **Stop the app containers** (not the DB). This makes the DB-first window explicit and
   short instead of leaving old code live against a half-migrated schema.

3. **Dry-run the migrations** and read the list before applying:
   ```bash
   ./database/deploy/migrate.sh --dry-run --allow-out-of-order <host> <port> cow_db cow_user
   ```
   **Expect exactly:** 130, 132, 133, 134, 140, 145 — six files, in that order. More or
   fewer than six means prod's state is not what this runbook assumes: **stop and
   re-derive**, do not proceed.

4. **Apply:**
   ```bash
   ./database/deploy/migrate.sh --allow-out-of-order <host> <port> cow_db cow_user
   ```
   Each file runs in its own transaction with its `schema_migrations` row, so a failure
   leaves that migration neither applied nor recorded. Migration 130 additionally
   self-verifies (wallet conservation + every ledger language has a progress row) and
   `RAISE EXCEPTION`s on bad data, aborting cleanly.

5. **Verify the DB before starting any code** — run § Verification below. Specifically
   confirm 140's CHECK widened and 145's rename landed. Starting the backend against a
   half-migrated schema is the one thing this order exists to prevent.

6. **Rebuild and start the containers** (`docker-compose -f docker-compose.prod.yml up
   --build -d`). ⚠️ Never with `-v`.

7. **Redeploy the cron SQL** — `database/cron/expire-stale-streaks.sql`. **MANDATORY, not
   cleanup.** The prod copy reads the four `users` columns migration 130 just dropped, so
   from step 4 onward *every tick aborts* — no inactivity penalty, no occupant decay,
   silent apart from the cron log. This file is also the entire install of
   `nightmarket_unlocks_for_minutes(int)`. Order is free relative to steps 5–6 (the app
   never calls the function; the cron never calls the app), but do not end the session
   without it.

8. **Post-deploy verification** — the three per-feature runbooks' own sections.

---

## Verification

Run each runbook's SQL; they do not overlap. In dependency order:

| After step | Check | File |
|---|---|---|
| 4 | rename landed, no stale index names, wallet conserved, global columns gone, night-market `language` NOT NULL | per-language § Verification SQL (queries 0–5, **all of 1–4 must return 0**) |
| 4 | `chk_zh/es_starter_pack_bucket` includes `'provisional'`; two partial indexes exist | provisional § After step 2 |
| 7 | `nightmarket_unlocks_for_minutes` exists; one clean `inactivity-cron` NOTICE on the next tick | unit-slot § Verification SQL |
| 8 | per-language summary returns **different** values for `zh` vs `es`; night market differs per language | per-language § smoke test |

## Rollback

Per-runbook, and **fix forward wherever possible** — 130's rollback is a manual column
restore (per-language § Rollback) and collapses two streaks into their max, losing the
split. The reason a clean-aborting migration matters more than a rehearsed rollback here is
that 130 either fully applies or leaves the DB untouched.

## Expected user-visible changes

Each feature runbook lists its own. The headline: **wallets and streaks become
per-language**, so a user who studied both languages sees their whole balance on their
primary language and 0 on the other. That is the intended backfill, not data loss — the
`userminutepoints` ledger is untouched and remains the source of truth.

---

## After prod is verified

Delete **all four** files — this one and the three it references — and drop the
"Current open runbooks" entries from [CLAUDE.md](../CLAUDE.md).
