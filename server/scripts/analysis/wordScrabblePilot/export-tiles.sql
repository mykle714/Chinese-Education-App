-- Word-tile Scrabble pilot: every HSK 1–3 det entry is one tile. Run with psql \copy (see README.md).
-- Docs: docs/BACKLOG.md § 10 (Word-tile Scrabble).
\copy (select word1, difficulty, coalesce("frequencyScore"::text,''), coalesce("partsOfSpeech"::text,''), coalesce(definitions->>0,'') from dictionaryentries_zh where difficulty<=3 and language='zh' order by difficulty, word1) to stdout with (format csv, delimiter E'\t')
