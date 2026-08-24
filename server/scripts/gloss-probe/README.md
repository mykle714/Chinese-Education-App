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
| `rule.py` | **The § 8i / Q11 blocking rule itself** — the one implementation of `decide()`, containment, the WordNet veto and the numeral guard. Step 6 of the real pipeline must call this, not re-implement it |
| `evaluate.py` | Applies `rule.py` to both result sets and reports the § 7 must-block / must-not-block rates → `rule_eval_results.json`. **No model inference** |
| `*_results.json` | 2026-08-22 baseline (`rule_eval_results.json`: 2026-08-24). Regress against these. |

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

**Re-deriving the rule needs none of that.** `evaluate.py` reads the cached raw
probabilities and needs only `nltk` (for the WordNet antonym veto; it degrades gracefully if
absent), so retuning `TAU_SYN` / `TAU_CONTRA` or changing the must-link is a seconds-long
loop, not a re-judge — the whole point of § 7 rule 1:

```bash
pip3 install nltk --break-system-packages
python3 evaluate.py
```

Re-run `probe.py` / `realdist.py` **only** when `modelRevision` or `templateVersion` moves.

CPU is fine — the gold set is 39 pairs. `lib/` is ~4.7 GB; delete it after. Add `lib/` to
.gitignore if you keep it around.

## Pinned models (§ 5 `modelRevision`, § 10 Q10)

- bi-encoder: `sentence-transformers/all-MiniLM-L6-v2`
- NLI: `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli`
- template: `"The word means {}."` — **templateVersion v1**

Changing any of these invalidates `*_results.json` as a baseline. See § 7 "What forces which
re-run".
