-- Migration 66: Split `vocabentries` (vet) into per-language tables
--
-- WHY
-- vet was a single table keyed by (userId, entryKey, language). Now that the
-- Spanish det is keyed by (word1, pos) — a word1 can have several discoverable POS
-- rows (e.g. `vivir` as verb AND noun) — a user must be able to save/track each POS
-- separately. Chinese has no POS-in-key concept and must NOT carry a pos column it
-- never uses. So, mirroring the det split (dictionaryentries_zh / _es), vet splits
-- into:
--   - vocabentries_zh : identity (userId, entryKey, language)          — unchanged shape
--   - vocabentries_es : identity (userId, entryKey, language, pos)     — adds `pos`
--
-- ID COLLISION SAFETY
-- Several code paths update/look up a vet row by `id` alone (review-history writes:
-- updateMarkHistory/updateCategory; findById). To keep an `id` globally unique
-- across BOTH tables, the two tables SHARE one sequence (the original
-- vocabentries_id_seq). An id therefore still identifies at most one row across the
-- pair, so id-based writes can target both tables and exactly one matches.
--
-- NON-DESTRUCTIVE
-- The original `vocabentries` table is left in place as a backup until the code
-- cutover is verified; a later migration drops it. Idempotent: safe to re-run.

-- ── vocabentries_zh ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vocabentries_zh (
  id                INTEGER PRIMARY KEY DEFAULT nextval('vocabentries_id_seq'),
  "userId"          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "entryKey"        TEXT NOT NULL,
  language          VARCHAR(10) NOT NULL DEFAULT 'zh',
  "markHistory"     JSONB DEFAULT '[]'::jsonb,
  "totalMarkCount"  INTEGER DEFAULT 0,
  "totalCorrectCount" INTEGER DEFAULT 0,
  "totalSuccessRate"  NUMERIC(5,4),
  "last8SuccessRate"  NUMERIC(5,4),
  "last16SuccessRate" NUMERIC(5,4),
  category          VARCHAR(20) NOT NULL DEFAULT 'Unfamiliar',
  "starterPackBucket" VARCHAR(20) NOT NULL,
  "createdAt"       TIMESTAMP DEFAULT now(),
  CONSTRAINT vocabentries_zh_user_key_language_unique UNIQUE ("userId", "entryKey", language),
  CONSTRAINT chk_zh_starter_pack_bucket CHECK ("starterPackBucket" IN ('library','learn-later','skip'))
);

-- ── vocabentries_es (adds pos to the identity) ───────────────────────────────
CREATE TABLE IF NOT EXISTS vocabentries_es (
  id                INTEGER PRIMARY KEY DEFAULT nextval('vocabentries_id_seq'),
  "userId"          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "entryKey"        TEXT NOT NULL,
  language          VARCHAR(10) NOT NULL DEFAULT 'es',
  pos               VARCHAR(50),
  "markHistory"     JSONB DEFAULT '[]'::jsonb,
  "totalMarkCount"  INTEGER DEFAULT 0,
  "totalCorrectCount" INTEGER DEFAULT 0,
  "totalSuccessRate"  NUMERIC(5,4),
  "last8SuccessRate"  NUMERIC(5,4),
  "last16SuccessRate" NUMERIC(5,4),
  category          VARCHAR(20) NOT NULL DEFAULT 'Unfamiliar',
  "starterPackBucket" VARCHAR(20) NOT NULL,
  "createdAt"       TIMESTAMP DEFAULT now(),
  -- NULLS NOT DISTINCT so a NULL pos can't create duplicate (user,key,lang) rows.
  CONSTRAINT vocabentries_es_user_key_language_pos_unique UNIQUE NULLS NOT DISTINCT ("userId", "entryKey", language, pos),
  CONSTRAINT chk_es_starter_pack_bucket CHECK ("starterPackBucket" IN ('library','learn-later','skip'))
);

-- Indexes mirroring the original table (per table).
CREATE INDEX IF NOT EXISTS idx_vocabentries_zh_userid   ON vocabentries_zh ("userId");
CREATE INDEX IF NOT EXISTS idx_vocabentries_zh_key      ON vocabentries_zh ("entryKey");
CREATE INDEX IF NOT EXISTS idx_vocabentries_zh_language ON vocabentries_zh (language);
CREATE INDEX IF NOT EXISTS idx_vocabentries_es_userid   ON vocabentries_es ("userId");
CREATE INDEX IF NOT EXISTS idx_vocabentries_es_key      ON vocabentries_es ("entryKey");
CREATE INDEX IF NOT EXISTS idx_vocabentries_es_language ON vocabentries_es (language);

-- ── Data copy (preserves ids; idempotent via NOT EXISTS) ─────────────────────
INSERT INTO vocabentries_zh (id, "userId", "entryKey", language, "markHistory",
  "totalMarkCount", "totalCorrectCount", "totalSuccessRate", "last8SuccessRate",
  "last16SuccessRate", category, "starterPackBucket", "createdAt")
SELECT id, "userId", "entryKey", language, "markHistory", "totalMarkCount",
  "totalCorrectCount", "totalSuccessRate", "last8SuccessRate", "last16SuccessRate",
  category, "starterPackBucket", "createdAt"
FROM vocabentries v
WHERE v.language = 'zh'
  AND NOT EXISTS (SELECT 1 FROM vocabentries_zh z WHERE z.id = v.id);

-- Spanish rows: derive pos from the discoverable det row for that word1. The
-- original sort predates the split (one discoverable row per word1), so pick a
-- deterministic discoverable pos; ambiguity only affects pre-existing test rows.
INSERT INTO vocabentries_es (id, "userId", "entryKey", language, pos, "markHistory",
  "totalMarkCount", "totalCorrectCount", "totalSuccessRate", "last8SuccessRate",
  "last16SuccessRate", category, "starterPackBucket", "createdAt")
SELECT v.id, v."userId", v."entryKey", v.language,
  (SELECT d.pos FROM dictionaryentries_es d
     WHERE d.word1 = v."entryKey" AND d.language = 'es' AND d.discoverable
     ORDER BY d.id LIMIT 1) AS pos,
  v."markHistory", v."totalMarkCount", v."totalCorrectCount", v."totalSuccessRate",
  v."last8SuccessRate", v."last16SuccessRate", v.category, v."starterPackBucket", v."createdAt"
FROM vocabentries v
WHERE v.language = 'es'
  AND NOT EXISTS (SELECT 1 FROM vocabentries_es e WHERE e.id = v.id);

-- Keep the shared sequence ahead of every copied id so future nextval() never
-- collides with a migrated row.
SELECT setval('vocabentries_id_seq',
  GREATEST(
    (SELECT COALESCE(MAX(id),0) FROM vocabentries_zh),
    (SELECT COALESCE(MAX(id),0) FROM vocabentries_es),
    (SELECT last_value FROM vocabentries_id_seq)
  ));

-- All access is per-language: language-scoped reads/writes route to one physical
-- table (server/dal/shared/vetTable.ts → vetTableForLanguage / vetReadFrom), and
-- the few id-only operations (SRS mark/undo, updateCategory/updateMarkHistory)
-- target BOTH tables since ids are globally unique. There is intentionally no
-- union view — cross-language reads were removed.

COMMENT ON TABLE vocabentries_zh IS 'Per-user saved Chinese vocab (vet). Identity (userId, entryKey, language). Shares vocabentries_id_seq with vocabentries_es so ids are globally unique. Split from vocabentries in migration 66.';
COMMENT ON TABLE vocabentries_es IS 'Per-user saved Spanish vocab (vet). Identity (userId, entryKey, language, pos) — a word1 can be saved once per part of speech. Shares vocabentries_id_seq with vocabentries_zh. Split from vocabentries in migration 66.';
COMMENT ON COLUMN vocabentries_es.pos IS 'Part of speech of the saved sense (matches dictionaryentries_es.pos), part of the identity so verb vs noun of the same spelling are distinct saved cards.';
