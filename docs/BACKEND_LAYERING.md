# Backend Layering — the Controller / Service / DAL rule

Status: **normative**. This is the rule new backend code is held to, plus an
honest inventory of where the codebase does not yet follow it.

Referenced from [CLAUDE.md](../CLAUDE.md) and
[docs/ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) (finding 8).

---

## 1. The three layers

| Layer | Directory | Owns | Must not |
|---|---|---|---|
| **Controller** | `server/controllers/` | HTTP: read `req`, validate shape, choose a status code, serialize the response | Contain business rules; touch `dbManager`; write SQL |
| **Service** | `server/services/` | Business rules, orchestration across several DALs, transactions, AI/network calls | Know about `req`/`res`; know table or column names (see the exception in §3) |
| **DAL** | `server/dal/implementations/` (behind `server/dal/interfaces/`) | Every SQL string, every table name, every row→object mapping | Contain business rules; call another DAL; know about HTTP |

Composition root: **`server/dal/setup.ts`**. Every DAL, service and controller is
constructed there once and injected downward. Nothing constructs its own
dependency, and nothing imports a singleton instance from another module.

Wire types crossing the HTTP boundary live in **`server/contracts/wire.ts`** and
are re-exported by both `server/types/index.ts` and `src/types.ts` — see
ARCHITECTURE_REVIEW finding 1.

---

## 2. The rule

> **A service does not write SQL.** Data a table owns is reached only through that
> table's DAL interface.

Concretely, in `server/services/*.ts`:

- No `client.query(...)`, no template-literal SQL, no table names.
- No `import { dbManager }`. If a service needs a connection, the need is really a
  missing DAL method.
- A new query is a new method on the relevant `I*DAL` interface plus its
  implementation — not a query inlined at the call site.

**Why this specific rule, and not a looser one.** The per-language table split
(`dictionaryentries_zh` / `dictionaryentries_es`, `vocabentries_zh` /
`vocabentries_es`) means *choosing a table* is a decision with real correctness
stakes. `server/dal/shared/dictTable.ts` and `vetTable.ts` centralize that choice.
Every SQL string written outside a DAL is a place where the language→table mapping
gets re-derived by hand — and this audit found three live instances of exactly that
bug inside `DictionaryDAL` itself (a Spanish `create()` writing into the Chinese
table), which only surfaced when the inherited `this.tableName` was removed. A
service issuing its own SQL has the same exposure with none of the shared helpers
in reach.

---

## 3. The one legitimate exception: transactions

A transaction spans several writes that must commit or roll back together, so the
**client** has to outlive any single DAL call. That coordination is business logic
and belongs in the service.

Permitted shape:

```ts
await this.dbManager.executeTransaction(async (client) => {
  await this.vocabEntryDAL.markReviewed(id, client);   // DAL method, passed the client
  await this.userDAL.incrementMinutePoints(userId, client);
});
```

Not permitted, even inside a transaction:

```ts
await this.dbManager.executeTransaction(async (client) => {
  await client.query(`UPDATE vocabentries_zh SET ...`);   // ← table name in a service
});
```

The rule inside a transaction is unchanged — only the *connection* moves up a
layer, never the SQL. Where a DAL method does not yet take an optional client,
adding that parameter is the correct fix.

---

## 4. Current conformance

Of 22 services, 15 hold no SQL. The exceptions, largest first:

| Service | Direct-SQL sites | Assessment |
|---|---|---|
| `NightMarketTemplateService.ts` | ~26 | **Non-conforming.** Owns the whole `nightmarkettemplatedefinitions` read/write path with no DAL. The largest single gap; a `NightMarketTemplateDAL` is the intended fix. |
| `ValidationService.ts` | ~14 | **Non-conforming.** Reads/writes the `validations` table and patches det columns directly. Needs a `ValidationDAL`; the det patches belong on `IDictionaryDAL`. |
| `StarterPacksService.ts` | ~14 | **Non-conforming.** Straddles `SortPacksDAL` and raw vet/det queries — the mixed state is worse than either extreme, because a reader cannot tell which path a given query took. |
| `TextService.ts` | ~12 | **Non-conforming.** The `texts` table has no DAL at all. |
| `VocabEntryService.ts` | 2 | **Conforming-by-exception (§3).** Both sites are inside transactions. Still worth migrating to client-accepting DAL methods. |
| `OnDeckVocabService.ts` | 1 | **Conforming-by-exception (§3).** Inside a transaction. |
| `LazyEnrichmentService.ts` | 1 | **Borderline.** A single `executeQuery` existence probe; belongs on `IDictionaryDAL` as `exists(word, language)`. |

`services/wordSearchGrid.ts` matches a naive `pool.` grep but issues no SQL — its
`pool` is a candidate-letter array.

**These are recorded, not endorsed.** New code does not get to add to this table;
the four non-conforming services are pre-existing debt with a named remedy each.

---

## 5. Route wiring

Every route is registered with the async wrapper in
`server/routes/asyncHandler.ts`:

```ts
router.post('/api/starterPacks/sort',
  authenticateToken,
  handle(starterPacksController.sortCard, starterPacksController));
```

`handle()` exists because **Express 4 does not catch rejected promises** — an async
handler that throws would hang the request until the client timed out, with nothing
in the logs. `handle` forwards rejections to `next(err)` so they reach the error
middleware. It also throws at wiring time if passed a non-function, which turns a
typo'd controller method into a boot failure instead of a 404.

The `thisArg` second parameter preserves the controller's `this` binding; omitting
it on a method that uses `this` is the most common mistake here.

Route modules: `server/routes/*.ts`, mounted in `server/server.ts`. API paths are
**camelCase** (`/api/starterPacks/...`, `/api/nightMarket/...`); user-facing SPA
URLs stay kebab-case (`/discover/quick-mark/:language`) and are unrelated.

---

## 6. Migrations

`database/deploy/migrate.sh` selects work by **set difference** against
`schema_migrations`, not by a high-water mark: any file whose version is absent is
applied, in ascending order, each inside its own `BEGIN … COMMIT` together with its
`schema_migrations` insert. A migration and its bookkeeping therefore cannot
diverge.

Flags: `--dry-run` (list only), `--baseline N` (record 1..N as applied without
running them — for adopting an already-migrated database), `--allow-out-of-order`
(apply a file whose version is below the current maximum; refused by default,
because that usually means two branches picked the same number).

The old high-water-mark logic silently skipped any file numbered below the highest
recorded version, which left the dev database with **74 of 127 migrations unrecorded**.
That backlog has been cleared (2026-07-28): the live schema was probed for each missing
migration's artifact, 73 proved already applied and were recorded as a baseline, and the
single genuinely-absent one (**74, `weeklies`** — an orphan table superseded by 78's
`wins`; no server code queries it) was applied normally. `schema_migrations` now holds all
127.

**Do not clear such a backlog by replaying it.** An audit of those 74 files found **30
that are not safely re-runnable** — `RENAME` (5, 16, 24, 31, 43, 76), `INSERT` without
`ON CONFLICT` (6, 45, 78, 132), `ADD CONSTRAINT` (20, 42, 77 — Postgres has no
`IF NOT EXISTS` for it), a drop-and-rebuild via temp table (30), and bare `UPDATE` data
rewrites (9, 19, 29, 40, 44, 79, 96, 110). Probe the schema, then `--baseline`.

---

## 7. Code references

| Section | Files |
|---|---|
| §1 layers | `server/dal/setup.ts`, `server/contracts/wire.ts`, `server/types/index.ts` |
| §1 DAL base | `server/dal/base/BaseDAL.ts`, `server/dal/interfaces/IBaseDAL.ts` |
| §2 table selection | `server/dal/shared/dictTable.ts`, `server/dal/shared/vetTable.ts`, `server/dal/shared/dictJoin.ts` |
| §3 transactions | `server/dal/base/DatabaseManager.ts` (`executeQuery`, `beginTransaction`) |
| §4 exceptions | the seven services named in the table |
| §5 routes | `server/routes/asyncHandler.ts`, `server/routes/*.ts`, `server/server.ts`, `server/authMiddleware.ts` |
| §6 migrations | `database/deploy/migrate.sh`, `database/deploy/migrations/` |
