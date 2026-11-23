# Judge rules (word-tile Scrabble pilot, round 3)

Used by the AI judges that write `data/<round>-out-*.jsonl`; scored by `score.py`. Docs: docs/BACKLOG.md § 10.

## The game

Each tile is one Chinese word (HSK 1–3), used as an indivisible unit. A legal play is a line of tiles,
read left to right, that forms a **natural, complete Chinese sentence or utterance** a native speaker
would actually say (a short reply such as 对。/ 我知道。/ 谢谢你。 counts). Punctuation is implied and free.
Grammatical but bizarre ("鞋子喝河") is NOT legal. Each tile may be used at most once per play
(duplicates in the rack are separate tiles).

## Rack files

`<id> TAB <rack tiles> [TAB <board tiles>]`

- **With board tiles (anchored, mid-game):** the play must use **exactly one** of the board tiles plus
  one or more rack tiles. The board tile can sit anywhere in the line.
- **Without board tiles (opening move):** the play uses rack tiles only, at least 2.

## What to output per rack

One JSON object per line, in input order:

```json
{"id": 1, "best_len": 4, "plays": ["我|不|要|鞋子", "我|要|鞋子", "不|要"], "n_plays_est": 9}
```

- `best_len`: tile count of the longest legal play you can find (board tile included). 0 = no legal play.
- `plays`: up to 6 legal plays, tiles joined by `|`, longest first; try to cover different rack tiles.
  Search hard for long plays — check 5, 6, 7+ tile sentences before settling.
- `n_plays_est`: your estimate of how many distinct legal plays exist (rough count is fine).
