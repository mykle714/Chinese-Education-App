-- Migration 96: Derived `entryWords` column on `sort_packs`
--
-- `sort_packs.entryIds` (migration 93) stores det surrogate ids, which are the real
-- identity — kept as-is (see docs/SORT_PACKS_IMPLEMENTATION.md; word1 is NOT a safe
-- substitute because es det identity is (word1, pos, gender), so word1 alone can
-- collide across Spanish gender/POS homographs, e.g. 'cura' n/f "cure" vs n/m "priest").
--
-- This adds a denormalized `entryWords` TEXT[] purely for human readability when
-- browsing/authoring sort_packs rows (no app code should treat it as a join key).
-- It is kept in sync with `entryIds`/`language` by a BEFORE INSERT OR UPDATE trigger,
-- since the source-of-truth det table differs by language (dictionaryentries_zh vs
-- dictionaryentries_es — see dal/shared/dictTable.ts) and a plain GENERATED column
-- can't cross tables.
--
-- Idempotent: guarded with IF NOT EXISTS / OR REPLACE / DROP+CREATE so re-running is a no-op.

ALTER TABLE sort_packs
    ADD COLUMN IF NOT EXISTS "entryWords" TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN sort_packs."entryWords"
  IS 'Denormalized word1 values for entryIds, in the same order, for human readability only. Auto-maintained by trg_sort_packs_sync_entry_words; entryIds (det.id) remains the real key.';

CREATE OR REPLACE FUNCTION sort_packs_sync_entry_words() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.language = 'es' THEN
        SELECT COALESCE(array_agg(word1 ORDER BY array_position(NEW."entryIds", id)), '{}')
          INTO NEW."entryWords"
          FROM dictionaryentries_es
          WHERE id = ANY(NEW."entryIds");
    ELSE
        SELECT COALESCE(array_agg(word1 ORDER BY array_position(NEW."entryIds", id)), '{}')
          INTO NEW."entryWords"
          FROM dictionaryentries_zh
          WHERE id = ANY(NEW."entryIds");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sort_packs_sync_entry_words ON sort_packs;
CREATE TRIGGER trg_sort_packs_sync_entry_words
    BEFORE INSERT OR UPDATE OF "entryIds", language ON sort_packs
    FOR EACH ROW
    EXECUTE FUNCTION sort_packs_sync_entry_words();

-- Backfill existing rows (fires the trigger via a no-op UPDATE).
UPDATE sort_packs SET "entryIds" = "entryIds";
