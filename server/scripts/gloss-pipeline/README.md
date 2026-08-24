# Gloss confusability pipeline (phase 2)

The offline job behind [docs/GLOSS_CONFUSABILITY.md](../../../docs/GLOSS_CONFUSABILITY.md)
§ 4: decide which English glosses mean the same thing, so no game board shows two cards a
player cannot tell apart. Built 2026-08-24.

**The model is frozen and never trained.** Nothing here learns; what grows is the corpus.

| File | Step | Role |
|---|---|---|
| `export-glosses.ts` | 1 | Distinct dd keys out of det, using the REAL `ddCollisionKey`. Node owns dd resolution → `glosses.tsv` |
| `dev-tables.sql` | — | Creates the two DEV-ONLY build caches. Deliberately **not** a migration |
| `pipeline.py embed` | 2 | Bi-encoder over keys not yet in `gloss_vectors` |
| `pipeline.py judge` | 3–5 | ANN top-k candidates → NLI cross-encoder both directions → WordNet veto → `gloss_pair_verdicts` |
| `cluster.py` | 6–7 | Constrained average-linkage clustering → `gloss_meaning_groups`. **No model inference** |
| `sweep.py` | — | `LINKAGE_TAU` sensitivity analysis. No inference, no writes. Scores each tau against the rule's own verdicts over every judged pair, because goldset.json's 26 pairs cannot separate tau values (§ 8m). Slow at low tau (many merges) — minutes, not seconds. |
| `validate.py` | — | § 7's every-rebuild gold-set check, run against the BUILT table |
| `push-groups.ts` | 7 | Dev → prod push of `gloss_meaning_groups`, the only table prod sees |
| `../gloss-probe/rule.py` | — | The § 8i blocking rule. **`cluster.py` calls it; never re-implement it** |

## Where things live, and why

**Prod never runs a model.** The runtime read is a hash lookup against
`gloss_meaning_groups`; nothing at request time touches an embedding. The build runs on the
dev box (RTX 3050) and its output is pushed up, making that table the one table in the app
**whose source of truth is DEV** — safe only because it is derived data (§ 5a).

| Table | Lives on | Ships to prod? |
|---|---|---|
| `gloss_vectors` | dev only | **never** — build cache |
| `gloss_pair_verdicts` | dev only | **never** — build cache |
| `gloss_meaning_groups` | dev + prod | yes, via `push-groups.ts` (migration 154) |

⚠️ `gloss_meaning_groups` must stay **excluded** from `/data-prod-to-dev`, or a routine dev
refresh overwrites dev's freshly computed groups with prod's copy of what dev just sent up.
The exclusion is written into that skill.

## Two environments

Only `pipeline.py` needs a model. `cluster.py`, `validate.py` and `sweep.py` do pure graph
work over the cached verdicts, so they need **psycopg2 and nothing else** — 50 MB against
5.4 GB, of which 93% is CUDA (nvidia 2.7 G + torch 1.6 G + triton 556 M).

| | File | Size | Covers |
| --- | --- | --- | --- |
| **Light** (default here) | `requirements-graph.txt` | ~50 MB | `cluster.py`, `validate.py`, `sweep.py` — the weekly re-cluster, validation, retuning |
| **Heavy** (install on demand) | `requirements.txt` | ~5.4 GB | `pipeline.py` steps 2–5: embed, retrieve, judge |

**The venv lives outside the repo**, at `~/.venvs/gloss-pipeline`. That is deliberate: even
the light install carries ~1,000 library `.py` files, and inside the working tree they show
up in editors and git GUIs as a wall of untracked Python that buries the ten files that
actually matter here. Nothing in the scripts hardcodes the path — only the commands below.

**It is disposable and holds no state** — vectors and verdicts live in Postgres. Delete it
whenever the disk is wanted; `pipeline.py` exits with the install command if the heavy stack
is missing, so nothing fails obscurely. Installing `requirements.txt` over the light venv
upgrades it in place.

⚠️ Neither environment may go in the backend container — it is musl/Alpine and will not
take torch.

## Running it

```bash
# one-time
python3 -m venv ~/.venvs/gloss-pipeline
~/.venvs/gloss-pipeline/bin/pip install -r requirements-graph.txt   # light: re-cluster / validate / sweep
~/.venvs/gloss-pipeline/bin/pip install -r requirements.txt         # heavy: ONLY when judging new glosses
docker exec -i cow-postgres-local psql -U cow_user -d cow_db < dev-tables.sql

# every build
cd ../..            && npx tsx scripts/gloss-pipeline/export-glosses.ts
cd scripts/gloss-pipeline && ~/.venvs/gloss-pipeline/bin/python pipeline.py all
                             ~/.venvs/gloss-pipeline/bin/python cluster.py
                             ~/.venvs/gloss-pipeline/bin/python validate.py     # § 7: every time, not once
```

Everything is **incremental by set-diff** — "which keys are in `glosses.tsv` but not in
`gloss_vectors`?", "which candidate pairs have no verdict?" — so a rebuild after
`/mark-discoverable` costs seconds. That is why there is no `discoverableAt` column and
none should be added (§ 7).

## Cadence (§ 7)

| Job | When | Cost (measured 2026-08-24) |
|---|---|---|
| Incremental (`pipeline.py all` + `cluster.py`) | after `/mark-discoverable`, or nightly | seconds |
| Re-cluster (`cluster.py` alone) | weekly, or when the size alarm fires | **~15 s** — no inference |
| Full rebuild | only on a deliberate model/template change | **~18 min** (107,591 pairs × 2 directions) |

Today's build: 5,481 discoverable rows → 7,658 dd keys → 107,591 candidate pairs → **5,086
groups**, largest 11, zero cannot-link violations.

The incremental job **must never block `/mark-discoverable`**: a word shipping briefly with
no group id is harmless (§ 6 rule 1), a failed embedding call blocking enrichment is not.

## Pins — changing one invalidates the caches below it

- bi-encoder `sentence-transformers/all-MiniLM-L6-v2` (384-d, int8-quantized in `gloss_vectors`)
- NLI `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli` (§ 10 Q10)
- template `"The word means {}."` — templateVersion **v1**, part of the verdict cache key

| Change | Re-runs | Cost |
|---|---|---|
| `LINKAGE_TAU`, `TAU_SYN`, `TAU_CONTRA` | `cluster.py` | **free** |
| `COSINE_CUT` / `TOP_K` | `judge` + `cluster` (vectors survive) | minutes |
| Template | full re-judge | minutes |
| Either model | everything | minutes |

⚠️ **`--full` after any retrieval change.** The incremental diff is over GLOSSES, so a key
that already has any verdict is treated as fully explored — lowering `COSINE_CUT` without
`--full` silently under-retrieves (measured: 13k new pairs instead of 60k). The pair-level
diff keeps `--full` cheap, so prefer it when in doubt.

**Never cache a boolean verdict.** `gloss_pair_verdicts` stores raw probabilities precisely
so retuning is a re-derivation instead of a re-judge (§ 7 rule 1).

## Rollback

`TRUNCATE gloss_meaning_groups` on prod. With the table empty every gloss has no group id,
and § 6 rule 1 makes that "no constraint" — the app degrades to the phase-1 exact-dd guard
with no code change. Prefer this to debugging a bad push in place.
