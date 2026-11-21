-- Migration 196: Adventures (cyoa) — branching stories, their passages and choices,
-- per-learner progress and endings found, and the users."isAuthor" grant.
--
-- Design: docs/CYOA_FEATURE.md § 6 (every table and column approved by the owner
-- 2026-11-20). Code: server/dal/implementations/StoryDAL.ts, server/services/StoryService.ts.
--
-- THE SHAPE. A story is a FREE GRAPH of passages (§ 6.2): a passage has 0–4 choices,
-- each pointing at another passage of the same story; several choices may share a
-- target and a choice may loop back. A passage with no choices is an ENDING.
--
--   stories ──startPassageId──▶ story_passages ◀──targetPassageId── story_choices
--      ▲                              │  ▲                                │
--      └────────── storyId ───────────┘  └────────── passageId ───────────┘
--
-- The stories ⇄ story_passages reference is circular, so `startPassageId`'s FK is
-- added after story_passages exists. "Same story" (a choice's target, a story's start
-- passage) is not expressible as a plain FK; StoryService checks it on every write.
--
-- DELETE BEHAVIOUR (§ 6.2 / § 6.3):
--   • Deleting a story cascades everything: passages, choices, progress, endings found.
--   • Deleting a passage: choices leading INTO it lose their target (SET NULL → shown to
--     learners as a disabled "coming soon" choice); a learner standing on it loses their
--     progress row (CASCADE → restart from the start, endings found kept); endings found
--     ON it go (CASCADE → the count drops, § 3.5). StoryService refuses to delete the
--     start passage, so `startPassageId`'s SET NULL only ever fires mid-cascade.
--   • Unpublishing (publishedAt → NULL) deletes nothing.
--
-- DATA SYNC: stories / story_passages / story_choices are authored on PPE (like
-- sort_packs) and belong on /data-ppe-to-dev's pull list; story_progress and
-- story_endings_found are per-user and do not.
--
-- Expand-only and idempotent (IF NOT EXISTS everywhere, the FK in a guarded DO block).
-- Nothing in the shipped code reads users."isAuthor" outside StoryDAL, which is only
-- mounted behind FEATURE_FLAGS.cyoa, so the standard /deploy order is safe.

-- ── Author grant (§ 6.1) ────────────────────────────────────────────────────────
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS "isAuthor" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users."isAuthor" IS
    'Whether this user may write Adventures (cyoa) stories in the in-app editor. Granted by hand; no UI grants it. The app''s one authoring grant: it succeeds isTemplateAuthor (migration 115, the Night Market / Immersive World grant), which migration 185 dropped. Default false. Migration 196, docs/CYOA_FEATURE.md § 6.1.';

-- ── stories ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stories (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    language         varchar(8)  NOT NULL DEFAULT 'zh',
    title            text        NOT NULL,
    -- Optional icon, same FK shape as texts."iconId" (migration 193).
    "iconId"         text        REFERENCES icons8("icons8Id") ON DELETE SET NULL,
    -- CASCADE: deleting an author account removes their stories rather than orphaning them.
    "authorUserId"   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- FK added below (circular with story_passages).
    "startPassageId" uuid,
    -- NULL = unpublished (a draft only its author sees). Set to now() on every publish,
    -- so the list's "newest first" means newest (re)published.
    "publishedAt"    timestamptz,
    -- HSK 1–6 on det's scale (migrations 76/79/92), computed by StoryService on publish:
    -- the lowest level covering 90% of the story's distinct leveled words. NULL until the
    -- first publish (or when no word in the story has a level).
    difficulty       smallint    CHECK (difficulty BETWEEN 1 AND 6),
    "createdAt"      timestamptz NOT NULL DEFAULT now(),
    "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

-- The learner list: published stories of a language, easiest first then newest.
CREATE INDEX IF NOT EXISTS stories_published_list_idx
    ON stories (language, difficulty, "publishedAt" DESC) WHERE "publishedAt" IS NOT NULL;
-- The author's own stories (drafts included).
CREATE INDEX IF NOT EXISTS stories_author_idx ON stories ("authorUserId");

COMMENT ON TABLE stories IS
    'Adventures (cyoa): one branching story. publishedAt NULL = draft. difficulty is computed on publish. Migration 196, docs/CYOA_FEATURE.md § 6.2.';

-- ── story_passages ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS story_passages (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    "storyId"     uuid        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    content       text        NOT NULL DEFAULT '',
    -- The ending's author-written name, shown on the end screen (§ 6.2b). Meaningful only
    -- while the passage has no choices; kept (not cleared) if choices are added later.
    "endingTitle" text,
    "createdAt"   timestamptz NOT NULL DEFAULT now(),
    "updatedAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS story_passages_story_idx ON story_passages ("storyId");

COMMENT ON TABLE story_passages IS
    'Adventures (cyoa): one passage of a story. A passage with no story_choices rows is an ending. Migration 196, docs/CYOA_FEATURE.md § 6.2.';

-- Circular FK: a story's first passage. SET NULL only fires inside a story-delete
-- cascade — StoryService refuses to delete the start passage on its own.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stories_start_passage') THEN
        ALTER TABLE stories
            ADD CONSTRAINT fk_stories_start_passage
            FOREIGN KEY ("startPassageId") REFERENCES story_passages(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ── story_choices ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS story_choices (
    id                uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
    "passageId"       uuid     NOT NULL REFERENCES story_passages(id) ON DELETE CASCADE,
    -- Button slot, top to bottom.
    position          smallint NOT NULL CHECK (position BETWEEN 1 AND 4),
    label             text     NOT NULL DEFAULT '',
    -- NULL while drafting, or after its target passage was deleted. A published choice
    -- with no target shows to learners disabled, "coming soon" (§ 6.3).
    "targetPassageId" uuid     REFERENCES story_passages(id) ON DELETE SET NULL,
    UNIQUE ("passageId", position)
);

-- The SET NULL sweep on a passage delete, and the editor's "incoming choices".
CREATE INDEX IF NOT EXISTS story_choices_target_idx ON story_choices ("targetPassageId");

COMMENT ON TABLE story_choices IS
    'Adventures (cyoa): up to four choices at the end of a passage (position 1–4). targetPassageId NULL = disabled "coming soon". Migration 196, docs/CYOA_FEATURE.md § 6.2.';

-- ── story_progress ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS story_progress (
    "userId"           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "storyId"          uuid        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    -- The passage to resume on. CASCADE: if the author deletes it, the learner restarts
    -- from the start passage (owner's call 2026-11-20).
    "currentPassageId" uuid        NOT NULL REFERENCES story_passages(id) ON DELETE CASCADE,
    "updatedAt"        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("userId", "storyId")
);

COMMENT ON TABLE story_progress IS
    'Adventures (cyoa): a learner''s resume point in a story. No row = start passage. Deleted when an ending is reached. Migration 196, docs/CYOA_FEATURE.md § 3.3.';

-- ── story_endings_found ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS story_endings_found (
    "userId"    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Denormalised so "endings found in this story" is one indexed COUNT(*).
    "storyId"   uuid        NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    "passageId" uuid        NOT NULL REFERENCES story_passages(id) ON DELETE CASCADE,
    "foundAt"   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("userId", "passageId")
);

CREATE INDEX IF NOT EXISTS story_endings_found_user_story_idx
    ON story_endings_found ("userId", "storyId");

COMMENT ON TABLE story_endings_found IS
    'Adventures (cyoa): one row per ending passage a learner has reached — the numerator of "Endings found x/y". Migration 196, docs/CYOA_FEATURE.md § 3.5.';
