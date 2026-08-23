-- Migration 152: the arena message — one line a competitor writes next to their name.
--
-- See docs/ARENA_FEATURE.md § 2.1a. Replaces the per-row progress meter, which was
-- drawn against the leader's score and told a reader nothing the rank column had not
-- already said.
--
-- ── Why `users` and not `user_languages` or `arena_members` ───────────────────
-- The message is a property of the PERSON, not of a language track and not of a
-- week. Putting it on user_languages would mean an editor that silently only edits
-- the message for whichever language happens to be selected; putting it on
-- arena_members would freeze it per week and make editing an UPDATE against a live
-- membership. `users` gives one blurb, one editor, and no duplication — the same
-- reasoning that keeps `timezone` and `avatarIconId` here while minute points and
-- streaks live per-language.
--
-- ── Synthetic members deliberately get NO column ──────────────────────────────
-- A bot's message is drawn from a fixed pool by a pure function of its existing
-- `syntheticSeed` (server/services/arenaSynthetic.ts → pickSyntheticMessage), exactly
-- as its score is (§ 6.2). Computed on read, never stored: no column, no backfill,
-- no drift, and every viewer sees the same line at the same instant.
--
-- ⚠️ THIS COLUMN IS USER-AUTHORED TEXT SHOWN TO 24 STRANGERS. It is length-capped
-- here and sanitised in ArenaService.setMessage, but neither of those is MODERATION.
-- The moderation system is tracked in docs/DEFERRED_WORK.md and must land before this
-- ships to an audience that is not the author's friends.
--
-- Idempotent: safe to re-run.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "arenaMessage" varchar(80);

-- Belt and braces against a code path that skips the service-layer trim: the column
-- is either absent or a non-empty line. An empty string would render as a blank
-- sub-line that looks like a rendering bug rather than "no message".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_arena_message'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT chk_users_arena_message
      CHECK ("arenaMessage" IS NULL OR length(btrim("arenaMessage")) > 0);
  END IF;
END $$;
