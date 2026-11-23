# Word-tile Scrabble viability pilot

Analysis scripts for the backlog idea in `docs/BACKLOG.md` § 10. Nothing here is app code.
Each HSK 1–3 det entry is one tile. An AI agent judges whether a line of tiles is a natural sentence.

| File | Role |
|---|---|
| `connectivity-rubric.md` | Rubric for the 1–5 AI connectivity rating of every candidate tile (round 3+ bag filter) |
| `judge-rules.md` | Rules the AI judges follow when listing legal plays per rack |
| `tile-points.py <round>` | Point value (1–10) for every qualifying tile from its estimated rack-11 play rate → `data/<round>-points-all.json` |
| `export-tile-set.py` | Writes the game's tile set (`data/r3-points-all.json` + `data/tiles.tsv`) to `server/services/sentenceTiles/tileSet.zh.ts`, the module Sentence Tiles deals from (docs/SENTENCE_TILES_GAME.md § 2). Re-run after changing points or the bag recipe |
| `export-tiles.sql` | Dumps difficulty ≤ 3 zh det rows to `data/tiles.tsv` |
| `build-samples.py <round> [min-connectivity]` | Builds the 100-tile bag (POS quota + duplicated function words) and the judge sample files |
| `score.py <round>` | Soft 0–1 quality score per metric, geometric mean, empirical tile points |
| `data/<round>-out-*.jsonl` | AI judge verdicts (one JSON per rack / hook case) |

Export: `docker exec -i cow-postgres psql -U cow_user -d cow_db -At < export-tiles.sql > data/tiles.tsv`

Round 1 (2026-11-21, scratch files lost) used strict crossing legality; its results live in the review
doc. Round 2 rules: only the placed line is judged; every non-opening play runs through one board tile.

Round 3 rules: as round 2, plus every bag tile needs connectivity rating ≥ 3
(`data/r3-conn-out-*.jsonl`, 8 rater batches). Racks 9/11/13 anchored + 11 opening, each judged twice
(`data/r3-out-<cfg>-j1/-j2.jsonl`). The hook test was not re-run.
