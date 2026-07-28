-- Migration 131: Seed the authored Chinese sort packs into `sort_packs`
--
-- WHY THIS EXISTS
-- `sort_packs` (migration 93) is hand-authored reference data for the discover sort
-- flow, but it had no delivery path to any environment other than the box it was
-- authored on: it is NOT in the data-deploy table list
-- (docs/DATA_DEPLOYMENT_GUIDE.md), there is no seed file, and no import script.
-- Result: on every environment except the authoring box, `sort_packs` is empty,
-- `SortPacksDAL.fetchPacksAtLevel` returns nothing at every level, and
-- `StarterPacksService.getNextPacks` silently serves 100% system fallback
-- packs-of-1 — i.e. the sort flow degrades to single cards and NO authored pack is
-- ever offered. This migration makes the packs part of the versioned schema so they
-- travel with the code. See docs/SORT_PACKS_IMPLEMENTATION.md.
--
-- KEYED BY WORD, NOT BY det id
-- `sort_packs."entryIds"` holds `dictionaryentries_zh.id` surrogate keys, which are
-- NOT portable across environments — prod is the source of truth for that table
-- (docs/DATA_DEPLOYMENT_GUIDE.md header) and its ids need not match any dev box.
-- So the seed below lists each pack by WORD and resolves the ids against whatever
-- `dictionaryentries_zh` this database has. `word1` is a safe lookup key here
-- because (a) it is unique per language in the zh det table and (b) every pack seeded
-- here is Chinese. This is deliberately NOT generalized to `es`: migration 96 warns
-- that word1 was historically ambiguous for Spanish gender/POS homographs.
--
-- PACK IDS ARE EXPLICIT AND PRESERVED
-- `users."seenPacks"` stores raw `sort_packs.id` values and is un-scoped across
-- languages (migration 93), so a pack's id is user-visible state. Seeding with the
-- authored ids keeps every environment agreed on which id means which pack; letting
-- the sequence assign fresh ones would make seenPacks mean different things per box.
-- The sequence is fast-forwarded past the seeded block at the end.
--
-- IDEMPOTENT: `ON CONFLICT (id) DO NOTHING`, so re-running is a no-op and any pack a
-- given environment has already authored/edited under the same id is left untouched.
--
-- PARTIAL-DATA SAFE: a pack is inserted only if EVERY one of its words resolves to a
-- det row. An unresolvable pack is skipped with a WARNING rather than aborting the
-- migration, so a dictionary that is missing a word cannot block a deploy. The final
-- NOTICE reports inserted / already-present / skipped counts — read it after running.
--
-- `entryWords` is intentionally not written here: trg_sort_packs_sync_entry_words
-- (migration 96) derives it from "entryIds" on INSERT.

DO $$
DECLARE
    seed        RECORD;
    resolved    INTEGER[];
    missing     TEXT[];
    n_inserted  INTEGER := 0;
    n_existing  INTEGER := 0;
    n_skipped   INTEGER := 0;
    n_rows      INTEGER;
BEGIN
    FOR seed IN
        SELECT * FROM (VALUES
    (24, 1, 90, ARRAY['上', '下']),
    (25, 1, 100, ARRAY['上午', '中午', '下午']),
    (26, 1, 110, ARRAY['昨天', '今天', '明天']),
    (27, 1, 120, ARRAY['可以']),
    (28, 1, 130, ARRAY['我', '喜欢', '春天']),
    (29, 1, 140, ARRAY['夏天', '秋天', '冬天']),
    (30, 1, 150, ARRAY['好', '看', '好看']),
    (31, 1, 160, ARRAY['你', '很', '早']),
    (32, 1, 170, ARRAY['多', '少', '多少']),
    (33, 1, 180, ARRAY['妈妈', '是', '医生']),
    (34, 1, 190, ARRAY['一', '二', '三']),
    (35, 1, 200, ARRAY['四', '五', '六']),
    (36, 1, 210, ARRAY['七', '八', '九']),
    (37, 1, 220, ARRAY['十', '零']),
    (38, 1, 230, ARRAY['前', '后']),
    (39, 1, 240, ARRAY['他', '她', '它']),
    (40, 1, 250, ARRAY['左', '右']),
    (41, 1, 260, ARRAY['上课', '下课']),
    (42, 1, 270, ARRAY['什么', '时候', '什么时候']),
    (43, 2, 40, ARRAY['大', '小', '大小']),
    (44, 2, 50, ARRAY['爸爸', '去', '买菜']),
    (45, 5, 10, ARRAY['自言', '自语', '自言自语']),
    (46, 5, 20, ARRAY['一心', '一意', '一心一意']),
    (47, 5, 30, ARRAY['不知', '不觉', '不知不觉']),
    (48, 5, 40, ARRAY['自由', '自在', '自由自在']),
    (49, 5, 50, ARRAY['不由', '自主', '不由自主']),
    (50, 5, 60, ARRAY['脚踏', '实地', '脚踏实地']),
    (51, 5, 70, ARRAY['循序', '渐进', '循序渐进']),
    (52, 5, 80, ARRAY['齐心', '协力', '齐心协力']),
    (53, 5, 90, ARRAY['实事', '求是', '实事求是']),
    (54, 5, 100, ARRAY['心甘', '情愿', '心甘情愿']),
    (55, 5, 110, ARRAY['深思', '熟虑', '深思熟虑']),
    (56, 5, 120, ARRAY['成千', '上万', '成千上万']),
    (57, 5, 130, ARRAY['无缘', '无故', '无缘无故']),
    (58, 5, 140, ARRAY['心里', '有数', '心里有数']),
    (59, 5, 150, ARRAY['忐忑', '不安', '忐忑不安']),
    (60, 5, 160, ARRAY['津津', '有味', '津津有味']),
    (61, 5, 170, ARRAY['是非', '分明', '是非分明']),
    (62, 5, 180, ARRAY['心服', '口服', '心服口服']),
    (63, 5, 190, ARRAY['惊慌', '失措', '惊慌失措']),
    (64, 5, 200, ARRAY['深入', '人心', '深入人心']),
    (65, 5, 210, ARRAY['独立', '自主', '独立自主']),
    (66, 5, 220, ARRAY['泰然', '自若', '泰然自若']),
    (67, 5, 230, ARRAY['举世', '闻名', '举世闻名']),
    (68, 6, 10, ARRAY['明察', '秋毫', '明察秋毫']),
    (69, 6, 20, ARRAY['毛遂', '自荐', '毛遂自荐']),
    (70, 6, 30, ARRAY['温文', '尔雅', '温文尔雅']),
    (71, 6, 40, ARRAY['未卜', '先知', '未卜先知']),
    (72, 6, 50, ARRAY['淋漓', '尽致', '淋漓尽致']),
    (73, 6, 60, ARRAY['深谋', '远虑', '深谋远虑']),
    (74, 6, 70, ARRAY['束手', '就擒', '束手就擒']),
    (75, 6, 80, ARRAY['滥竽', '充数', '滥竽充数']),
    (76, 6, 90, ARRAY['锦囊', '妙计', '锦囊妙计']),
    (77, 6, 100, ARRAY['光明', '磊落', '光明磊落']),
    (78, 6, 110, ARRAY['依依', '不舍', '依依不舍'])
        ) AS t(id, level, pack_order, words)
        ORDER BY level, pack_order, id
    LOOP
        -- Authored words with no det row in THIS database. Checked before the insert so
        -- a partially-resolvable pack is skipped whole rather than silently shortened.
        SELECT array_agg(w)
          INTO missing
          FROM unnest(seed.words) AS w
         WHERE NOT EXISTS (
             SELECT 1 FROM dictionaryentries_zh de
              WHERE de.word1::text = w AND de.language = 'zh'
         );

        IF missing IS NOT NULL THEN
            RAISE WARNING 'sort_packs seed: skipped pack id=% (level %) — no dictionaryentries_zh row for %',
                seed.id, seed.level, missing;
            n_skipped := n_skipped + 1;
            CONTINUE;
        END IF;

        -- Resolve to det ids, preserving the AUTHORED word order: the order of
        -- "entryIds" is the order the cards are shown in inside the pack
        -- (StarterPacksService._hydrateCards orders by array_position over it).
        SELECT array_agg(de.id ORDER BY array_position(seed.words, de.word1::text))
          INTO resolved
          FROM dictionaryentries_zh de
         WHERE de.word1::text = ANY(seed.words) AND de.language = 'zh';

        INSERT INTO sort_packs (id, language, level, "packOrder", "entryIds")
        VALUES (seed.id, 'zh', seed.level::smallint, seed.pack_order, resolved)
        ON CONFLICT (id) DO NOTHING;

        GET DIAGNOSTICS n_rows = ROW_COUNT;
        IF n_rows > 0 THEN
            n_inserted := n_inserted + 1;
        ELSE
            n_existing := n_existing + 1;
        END IF;
    END LOOP;

    RAISE NOTICE 'sort_packs seed complete: % inserted, % already present, % skipped (unresolved words)',
        n_inserted, n_existing, n_skipped;
END $$;

-- Fast-forward the id sequence past the seeded block so future authored packs
-- (which rely on the DEFAULT) cannot collide with a seeded id.
SELECT setval(
    'sort_packs_id_seq',
    GREATEST((SELECT COALESCE(MAX(id), 0) FROM sort_packs), 1),
    true
);
