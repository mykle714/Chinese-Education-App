# Gloss confusability probe / validation harness

The § 8 validation matrix of [docs/GLOSS_CONFUSABILITY.md](../../../docs/GLOSS_CONFUSABILITY.md),
as runnable code. **Phase 2 is not built** — this is the harness that validated (and partly
invalidated) its design, kept because § 7 requires the gold set to run on *every* rebuild, not
once.

| File | Role |
| --- | --- |
| `goldset.py` | Builds the § 8 gold set from the LIVE discoverable corpus + hand-written contrast pairs → `goldset.json` |
| `probe.py` | Scores the gold set with bi-encoder cosine and the NLI cross-encoder → `probe_results.json` |
| `realdist.py` | Harder test: judges the 400 highest-cosine REAL pairs, the distribution the pipeline actually sees → `realdist_results.json` |
| `direction.py` | Splits the grey band by entailment DIRECTION — the analysis that found C13 |
| `*_results.json` | 2026-08-22 baseline. Regress against these. |

## Running it

Needs torch + transformers + sentence-transformers, which **must not** be installed into the
backend container (musl/Alpine will not take torch). Use an isolated dir on the host:

```bash
cd server/scripts/gloss-probe
pip3 install --target=./lib --break-system-packages torch --index-url https://download.pytorch.org/whl/cpu
pip3 install --target=./lib --break-system-packages transformers sentence-transformers
# dd_zh.tsv: word1 \t dd, for every discoverable zh cluster (see goldset.py docstring)
PYTHONPATH=$PWD/lib python3 goldset.py && PYTHONPATH=$PWD/lib python3 probe.py
```

CPU is fine — the gold set is 39 pairs. `lib/` is ~4.7 GB; delete it after. Add `lib/` to
.gitignore if you keep it around.

## Pinned models (§ 5 `modelRevision`, § 10 Q10)

- bi-encoder: `sentence-transformers/all-MiniLM-L6-v2`
- NLI: `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli`
- template: `"The word means {}."` — **templateVersion v1**

Changing any of these invalidates `*_results.json` as a baseline. See § 7 "What forces which
re-run".
