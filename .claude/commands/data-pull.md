# Data Pull (prod data tables → local dev)

Pull the authoritative **data tables** from production down to a local dev machine.
This is the **reverse-direction** sibling of the now-deprecated
[`/data-deploy`](./data-deploy.md): there the source was local and the target was
prod; here the source is **prod** and the target is **local**.

**Prod is the source of truth** for these tables. `/data-deploy` (local → prod) is
deprecated — do not push these tables up anymore; refresh dev *down* with this skill.

Structurally this mirrors [`/template-pull`](./template-pull.md) (Prod half = SOURCE,
Local half = TARGET, transport = Git LFS because you have no cross-machine SSH).

## Tables (restored in this order)

| # | Table | Dump file | Restore mode into local |
|---|---|---|---|
| 1 | `icons8` | `database/icons8-data.dump` | **Merge only** (never truncate) — must go first |
| 2 | `dictionaryentries_zh` | `database/dictionaryentries_zh-data.dump` | TRUNCATE + restore (full overwrite) |
| 3 | `dictionaryentries_es` | `database/dictionaryentries_es-data.dump` | TRUNCATE + restore (full overwrite) |
| 4 | `validations` | `database/validations-data.dump` | TRUNCATE + restore (full overwrite) |

> ⚠️ **This overwrites your local det.** `dictionaryentries_zh`/`_es` and
> `validations` are TRUNCATE+restored wholesale — any un-pushed local edits to those
> tables on the dev box are **lost**. Prod is authoritative; that is the point.

### Why `icons8` merges and everything else overwrites

- **`icons8` — merge only, restored FIRST.** A dev box accumulates its OWN icon rows
  organically (users picking custom card icons, `ensureIcon` download-on-select — see
  `docs/CARD_ICON_LAYOUT.md`). Local `vocabentries.iconId` and `users.avatarIconId`
  FK-reference those local-only rows, so a TRUNCATE would orphan them. Merge instead:
  add prod's rows, keep every local row.
- **`iconId` FK ordering.** `dictionaryentries_zh/_es.iconId` FK-references
  `icons8("icons8Id")` (`ON DELETE SET NULL`, not deferrable). If a det dump carries
  an `iconId` local's `icons8` doesn't have yet, the det restore's `COPY` aborts
  **atomically and leaves the det table empty**. So `icons8` MUST be merged before any
  det restore (this is the icons8 incident from `/data-deploy`, same cause, same fix).
- **`validations` — plain overwrite, no user pre-check.** As of migration 120,
  `validations.validatorUserId` is NOT a FK, so prod's rows restore onto any dev box
  even when the referencing validator accounts don't exist locally. `entryId` is also
  unconstrained, so no ordering dependency on the det restores — but pull det +
  validations together anyway so their ids line up (`entryId` = det surrogate id).

---

## ⚠️ FIRST: Which machine are you on?

Read [amIOnTheProdMachine.md](../../amIOnTheProdMachine.md) (gitignored, present on
every machine) to determine dev vs prod. A full pull has **two halves that run on two
different machines**, and you can only run the half for the machine you are on — you
have no SSH access to the other one:

- **On PROD** → you are the **SOURCE**. Run the [Prod half](#prod-half--source)
  yourself (dump → commit → push), then hand the user the
  [Local half](#local-half--target) block to run on their dev box.
- **On DEV/local** → you are the **TARGET**. Hand the user the
  [Prod half](#prod-half--source) block to run on the server first; once they confirm
  the push landed, run the [Local half](#local-half--target) yourself.

Always present the "other machine" commands as a single copy-pasteable block.

### Prerequisite on the LOCAL box: migration 120

The local DB must have **migration 120** applied (drops the `validations` →`users` FK)
before the `validations` restore, or a row referencing a missing validator aborts the
restore. Check on local before restoring:

```bash
docker exec cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT version FROM schema_migrations WHERE version = 120;"
```

If absent, apply pending migrations on the dev box first (normal migrate flow), then
run the Local half.

---

## Prod half — SOURCE (run against `cow-postgres-prod`)

Dumps all four tables in binary custom format and commits them via Git LFS.

```bash
cd ~/vocabulary-app
git pull origin main          # start from a clean main

for T in icons8 dictionaryentries_zh dictionaryentries_es validations; do
  docker exec cow-postgres-prod pg_dump -U cow_user -d cow_db \
    -t "$T" --data-only -F c -f "/tmp/${T}_dump.dump"
  docker cp "cow-postgres-prod:/tmp/${T}_dump.dump" "database/${T}-data.dump"
  echo "== $T =="
  ls -lh "database/${T}-data.dump"
  docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT COUNT(*) FROM \"$T\";"
done

git add database/icons8-data.dump \
        database/dictionaryentries_zh-data.dump \
        database/dictionaryentries_es-data.dump \
        database/validations-data.dump
git commit -m "data: refresh prod snapshots (icons8, det_zh, det_es, validations)"
git push origin main
```

Confirm the LFS upload completes. **Report the four row counts** — the local half
verifies against them.

---

## Local half — TARGET (run against `cow-postgres-local`)

```bash
cd <local repo>              # e.g. ~/vocabulary-app on the dev box
git pull origin main

# 0. Migration 120 must be present (see Prerequisite above). Verify, then:

# 1. icons8 — MERGE FIRST (never truncate). Swap the live table aside, restore the
#    dump into a fresh scratch table (FK-checking tables keep referencing by name
#    across the rename), copy new rows in with ON CONFLICT DO NOTHING, drop scratch.
docker cp database/icons8-data.dump cow-postgres-local:/tmp/icons8_dump.dump
docker exec cow-postgres-local psql -U cow_user -d cow_db -c 'ALTER TABLE icons8 RENAME TO icons8_live;'
docker exec cow-postgres-local psql -U cow_user -d cow_db -c 'CREATE TABLE icons8 (LIKE icons8_live INCLUDING ALL);'
docker exec cow-postgres-local pg_restore -U cow_user -d cow_db -t icons8 --data-only /tmp/icons8_dump.dump
docker exec cow-postgres-local psql -U cow_user -d cow_db -c 'INSERT INTO icons8_live SELECT * FROM icons8 ON CONFLICT ("icons8Id") DO NOTHING;'
docker exec cow-postgres-local psql -U cow_user -d cow_db -c 'DROP TABLE icons8;'
docker exec cow-postgres-local psql -U cow_user -d cow_db -c 'ALTER TABLE icons8_live RENAME TO icons8;'
docker exec cow-postgres-local psql -U cow_user -d cow_db -c 'SELECT COUNT(*) FROM icons8;'   # >= prod count

# 2. det + validations — TRUNCATE + restore (icons8 rows now all present, so iconId FKs resolve)
for T in dictionaryentries_zh dictionaryentries_es validations; do
  docker cp "database/${T}-data.dump" "cow-postgres-local:/tmp/${T}_dump.dump"
  docker exec cow-postgres-local psql -U cow_user -d cow_db -c "TRUNCATE TABLE \"$T\";"
  docker exec cow-postgres-local pg_restore -U cow_user -d cow_db -t "$T" --data-only "/tmp/${T}_dump.dump"
  docker exec cow-postgres-local psql -U cow_user -d cow_db -c "SELECT COUNT(*) FROM \"$T\";"   # == prod count
done
```

Each det + validations count should **equal** the prod count from the prod half;
`icons8` should be **>=** prod's (local keeps its own extra rows).

---

## Important Notes

- **These four tables ONLY.** The `-t <table>` flag must be present on every
  `pg_dump`/`pg_restore`. Never dump or restore any other table with this skill —
  everything else is live user data.
- **Direction is prod → local only.** Never restore these dumps into
  `cow-postgres-prod` — that would clobber the authoritative data. `/data-deploy`
  (the old local → prod push) is **deprecated**; prod is the source of truth now.
- **`icons8` is NEVER truncated on local** — merge only. Do not reorder it after the
  det restores; it must be merged first so every `iconId` the det dumps carry exists.
- **Binary format (`-F c`) + `pg_restore`.** Plain SQL causes psql meta-command
  errors from pg_dump version skew; always dump `-F c` and restore with `pg_restore`.
- **Migration 120 on the target** is what lets `validations` restore without a
  validator-user pre-check. On a box that lacks it, restore the FK-safe way (apply
  120 first) rather than dropping the guard.
- Full context: `docs/DATA_DEPLOYMENT_GUIDE.md`, `docs/DATA_VALIDATION_SYSTEM.md`,
  `docs/CARD_ICON_LAYOUT.md`.
