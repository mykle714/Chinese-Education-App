-- Migration 57: Rename dictionaryentries -> dictionaryentries_zh (Chinese det)
--
-- The table is now Chinese-only. Spanish lives in `dictionaryentries_es` and
-- affixes in `affixes`. The shared multi-language model (zh/ja/ke/vi in one
-- table) has been abandoned: each language family gets its own table because
-- their identity/keying differs (see CLAUDE.md "Dictionary Tables").
--
-- NOTE: ja/ko/vi import flows that used to write to this table are intentionally
-- left BROKEN (commented in their scripts) until per-language tables exist.
-- Those languages are not user-selectable for now.
--
-- The id sequence (dictionaryentries_id_seq) and existing indexes keep their
-- names; they continue to function. Only the table is renamed here.

ALTER TABLE dictionaryentries RENAME TO dictionaryentries_zh;
