# Tile connectivity rubric (word-tile Scrabble pilot)

Used by the AI raters that produce `data/<round>-conn-out-*.jsonl`. Read by `build-samples.py` (bag filter)
and `score.py` (calibration against empirical usage). Docs: docs/BACKLOG.md § 10.

## The game

Each tile is one Chinese word (HSK 1–3). A player lays a line of tiles that must read as a natural,
complete Chinese sentence or utterance (a short reply like 对。 or 我知道。 counts). They draw from a
rack of about 9 random everyday tiles, and can build through one tile already on the board.

## The question

**How easily can this tile take part in some natural sentence, given a random handful of everyday words?**
Count what the tile *needs* from the rest of the line. Fewer and more common partners = higher.

| Score | Meaning | Examples |
|---|---|---|
| 5 | Works with almost anything; a sentence often needs it or accepts it freely | 我 你 他 是 不 好 了 吗 吧 对 有 |
| 4 | Forms a sentence with just a pronoun or one very common word | 知道 去 吃饭 喜欢 累 要 听 |
| 3 | Needs one partner of a broad kind (any verb, any person, any noun) | 医生 作业 电影 很 今天 漂亮 |
| 2 | Needs a narrow partner or a specific frame | 旁边 (X在Y旁边) 给 (A给B…) 今年 印度 低 但是 |
| 1 | Needs two or more specific partners, or is not a standalone word | 一 两 三 个 本 张 (numeral + classifier + noun), 从 和 当, bound morphemes 中 身 市, dates like 出生日期 |

Rules:
- Judge the tile as one indivisible unit (以内 is one tile).
- Bound morphemes or fragments that a learner would not say as a word: score 1.
- Proper nouns and narrow-topic nouns are usually 2.
- Don't reward a tile for being common in corpora; reward it for needing little help in a sentence.
- Use the full scale; don't drift toward 3.
