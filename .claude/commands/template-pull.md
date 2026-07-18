# Template Pull (prod templates → local)

Pull the Night Market **template catalog** from production down to a local dev
machine, completely overwriting local's copy. This is the **reverse-direction**
sibling of [`/data-deploy`](./data-deploy.md): there the source is local and the
target is prod; here the source is **prod** and the target is **local**.

Only one table moves:

| Table | Dump file | Restore mode (into local) |
|---|---|---|
| `nightmarkettemplatedefinitions` | `database/nightmarkettemplatedefinitions-data.dump` | **TRUNCATE + restore** (full overwrite — prod is source of truth) |

The template catalog is authored by validators in the desktop template editor
(see [NIGHT_MARKET_TEMPLATES.md](../../docs/NIGHT_MARKET_TEMPLATES.md),
[NIGHT_MARKET_TEMPLATE_EDITOR.md](../../docs/NIGHT_MARKET_TEMPLATE_EDITOR.md);
migrations 107–109). Prod is where the authoritative templates live; this skill
brings them onto a dev box for development/testing.

---

## ⚠️ FIRST: Which machine are you on?

Read [amIOnTheProdMachine.md](../../amIOnTheProdMachine.md) (gitignored, present on
every machine) to determine dev vs prod. A full sync has **two halves that run on
two different machines**, and you can only run the half for the machine you are on
— you have no SSH access to the other one. Your job is:

- **On PROD** → you are the **SOURCE**. Run the [Prod half](#prod-half--source)
  yourself (dump → commit → push), then hand the user the
  [Local half](#local-half--target) commands to run on their dev box.
- **On DEV/local** → you are the **TARGET**. Hand the user the
  [Prod half](#prod-half--source) commands to run on the server first; once they
  confirm the push landed, run the [Local half](#local-half--target) yourself.

Always present the "other machine" commands as a single copy-pasteable block.

---

## Prod half — SOURCE (run against `cow-postgres-prod`)

Dumps the catalog in binary custom format, writes a plain-text **author manifest**
next to it (so the local half can verify FK authors *before* it truncates
anything), then commits both via Git LFS and pushes.

```bash
cd ~/vocabulary-app
git pull origin main          # start from a clean main

# 1. Binary dump of the catalog
docker exec cow-postgres-prod pg_dump -U cow_user -d cow_db \
  -t nightmarkettemplatedefinitions --data-only -F c -f /tmp/nmt_dump.dump
docker cp cow-postgres-prod:/tmp/nmt_dump.dump \
  database/nightmarkettemplatedefinitions-data.dump

# 2. Author manifest — every distinct createdBy + its email.
#    The local half checks these exist locally BEFORE truncating (see below).
docker exec cow-postgres-prod psql -U cow_user -d cow_db -At -F',' -c \
  'SELECT DISTINCT t."createdBy", u.email
     FROM nightmarkettemplatedefinitions t
     JOIN users u ON u.id = t."createdBy"
     ORDER BY 2;' \
  > database/nightmarkettemplatedefinitions-authors.txt

# 3. Report what is being shipped
ls -lh database/nightmarkettemplatedefinitions-data.dump
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c \
  'SELECT COUNT(*) FROM nightmarkettemplatedefinitions;'
cat database/nightmarkettemplatedefinitions-authors.txt

# 4. Commit (dump via LFS, manifest as plain text) and push
git add database/nightmarkettemplatedefinitions-data.dump \
        database/nightmarkettemplatedefinitions-authors.txt
git commit -m "data: refresh nightmarkettemplatedefinitions dump (prod snapshot)"
git push origin main
```

Confirm the LFS upload completes. **Report the author manifest and row count** —
the local half needs them.

---

## Local half — TARGET (run against `cow-postgres-local`)

> ⚠️ **FK safety (the icons8 incident, in reverse).** `nightmarkettemplatedefinitions.createdBy`
> is `NOT NULL` and FK-references `users(id)`. If the dump carries a `createdBy`
> UUID that does **not** exist in local's `users` table, a `TRUNCATE`-then-restore
> would abort mid-`COPY` and leave the local table **empty**. So the author check
> below runs **before** the truncate — if any author is missing we stop and leave
> the local table untouched.

```bash
cd <local repo>              # e.g. ~/vocabulary-app on the dev box
git pull origin main

# 1. AUTHOR PRE-CHECK — read required authors from the manifest, check each
#    against local users. DO NOT truncate yet.
cat database/nightmarkettemplatedefinitions-authors.txt   # id,email per line

#    For each id in that file:
docker exec cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT id, email FROM users WHERE id = '<author-id-from-manifest>';"
```

**Decision point — NOTIFY the user of the author check result:**

- **Any author missing locally** → **STOP. Do not truncate.** Report exactly which
  UUIDs + emails from the manifest are absent from local `users`. The user must
  seed those accounts locally (or you may, with their OK, remap `createdBy` — but
  the chosen default here is *notify only*), then re-run the local half. Leaving
  the truncate un-run keeps the existing local catalog intact.
- **All authors present** → proceed to the restore:

```bash
# 2. Full overwrite: truncate local, restore prod's dump
docker cp database/nightmarkettemplatedefinitions-data.dump \
  cow-postgres-local:/tmp/nmt_dump.dump
docker exec cow-postgres-local psql -U cow_user -d cow_db -c \
  'TRUNCATE TABLE nightmarkettemplatedefinitions;'
docker exec cow-postgres-local pg_restore -U cow_user -d cow_db \
  -t nightmarkettemplatedefinitions --data-only /tmp/nmt_dump.dump

# 3. Verify — should match the prod row count from the prod half
docker exec cow-postgres-local psql -U cow_user -d cow_db -c \
  'SELECT COUNT(*) FROM nightmarkettemplatedefinitions;'
```

---

## Important Notes

- **This table ONLY.** The `-t nightmarkettemplatedefinitions` flag must be present
  on every `pg_dump`/`pg_restore`. Never dump or restore any other table with this
  skill — everything else is live user data.
- **Direction is prod → local only.** To push *reference* tables the other way
  (local → prod), use [`/data-deploy`](./data-deploy.md). Never restore this dump
  into `cow-postgres-prod` — it would clobber the authoritative catalog.
- **Binary format (`-F c`) + `pg_restore`.** Plain SQL causes psql meta-command
  errors from pg_dump version skew; always dump with `-F c` and restore with
  `pg_restore` (not `psql -f`).
- **Author manifest is committed plain text**, not LFS — it must stay greppable so
  the local half can read it before restoring.
- **FK author check runs before truncate**, always. Do not reorder — that ordering
  is the whole guard against the empty-table failure mode.
- Full context on the template catalog: [NIGHT_MARKET_TEMPLATES.md](../../docs/NIGHT_MARKET_TEMPLATES.md).
