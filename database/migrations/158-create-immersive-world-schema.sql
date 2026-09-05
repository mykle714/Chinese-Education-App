-- Migration 158: Immersive World (iw) — the whole feature's schema in one pass.
--
-- See docs/IMMERSIVE_WORLD.md § 12 phase 1a and § 14 Q2/Q3/Q19/Q21/Q25/Q27/Q30/Q31.
--
-- NUMBERED 158, NOT 157. 157 is the Chinese-typeface column, which is committed with an
-- open runbook and must reach prod before this. Nothing here depends on it.
--
-- ── Four tables, not nine ────────────────────────────────────────────────────
-- Q2 originally called for a fully normalized set (a table per cast row, per
-- complication, per scene word, per authored conversation). That was reversed on
-- 2026-09-04 by applying migration 107's own reasoning: BLOB WHAT IS AUTHORED AND READ
-- WHOLE; keep as columns only what is looked up individually or pointed at by a foreign
-- key. A scene is loaded in its entirety exactly once, at scene start, and nothing ever
-- queries "all scenes containing this complication". Five jsonb columns replace five
-- tables, five join paths and five editor write paths.
--
-- ── NPCs are NOT a table ─────────────────────────────────────────────────────
-- There is deliberately no `iw_npcs`. An NPC IS a prompt, so it lives in code
-- (server/config/iwNpcs.ts) where a change is reviewable in a diff and revertable
-- alongside the prompt it was tuned against; § 5.6's regression sweep only means
-- anything if the cast is versioned in git. Every npc id below is therefore TEXT with
-- NO foreign key — the referent is a code constant. `npcById` is the only resolver, and
-- startup should assert that every stored id still resolves (§ 14 Q2's caveat, in the
-- spirit of docs/NIGHT_MARKET_GRAPH_ASSUMPTIONS.md).
--
-- ── Why "npcCast" and not "cast" ─────────────────────────────────────────────
-- CAST is a reserved word in SQL. Every column in this database is already quoted
-- camelCase so `"cast"` would technically work, but it would be the one column name in
-- the schema that breaks the moment somebody writes an unquoted ad-hoc query.
--
-- ── No createdBy ─────────────────────────────────────────────────────────────
-- Scene authors are staff, not users (§ 14 Q2). Migration 107 tracks a template's author
-- because template authorship is a user-facing permission; scene authorship is not, and
-- nothing in the feature reads it. Decided 2026-09-04.
--
-- ── Complications are ENVIRONMENTAL ──────────────────────────────────────────
-- A complication belongs to the SCENE, not to an NPC (§ 14 Q31, corrected 2026-09-04).
-- It is a change to the world that every NPC present reacts to out of their own
-- character — the rain starts, the power cuts, a queue forms. It is not injected into
-- one NPC's turn context, and it has no owner column.

CREATE TABLE IF NOT EXISTS iw_scenes (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- The cast is authored per language; a Spanish scene is new content, not a
    -- translation of a Chinese one (§ 14 Q8).
    language           VARCHAR(10)  NOT NULL,
    name               VARCHAR(120) NOT NULL,
    -- ENGINE-FACING AND ENGLISH. This is what the scene is for, read by the completion
    -- check and the post-scene report — never rendered to an NPC. § 14 Q27: an NPC is
    -- told who it is, never what it is for.
    objective          TEXT         NOT NULL,
    published          BOOLEAN      NOT NULL DEFAULT FALSE,

    -- ── Completion: exactly one NPC doing exactly one action (§ 14 Q19) ──────
    -- A scene can never be FAILED, only completed or left. The pair is stored as two
    -- scalars rather than inside `npcCast` because it is the one thing the runtime
    -- checks on every turn, and because an author mis-wiring it is the single most
    -- damaging authoring error — a lifted column can be validated by a scene test.
    "completerNpcId"   TEXT         NOT NULL,
    "completionAction" VARCHAR(40)  NOT NULL,

    -- ── Board geometry, in TEMPLATE CELLS (migration 112's convention) ───────
    -- col/row, NOT isoX/isoY: a scene is a standalone board and its cells are authored
    -- in the editor's own grid. Cell (0,0) is the SW / minimum-iso corner.
    --
    -- Both actors have an AUTHORED start (§ 14, 2026-09-04): the companion does not spawn
    -- next to the player. On scene load the engine issues an automatic walk that takes
    -- the player to the companion with input locked, so the scene opens as a short
    -- animation rather than as a menu.
    "playerStartCol"    INTEGER     NOT NULL,
    "playerStartRow"    INTEGER     NOT NULL,
    "companionStartCol" INTEGER     NOT NULL,
    "companionStartRow" INTEGER     NOT NULL,
    width               INTEGER     NOT NULL,
    height              INTEGER     NOT NULL,

    -- ── The authored blobs ──────────────────────────────────────────────────
    -- `layout` starts as the night-market template editor's shape minus the two
    -- night-market-only lists (placeholder, condition), because that editor is the only
    -- layout authoring tool that exists today. It is EXPECTED TO CHANGE — iw is not a
    -- night market and this is a starting point, not a contract:
    --   { terrain1: ["col,row"], terrain2: [...], street: [...], communal: [...],
    --     decor: { "col,row": "assetStem" } }
    layout             JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Which NPCs stand where: [{ npcId, col, row, facing }]. NO role field — an NPC's
    -- part in the scene is baked into who they are, and they act accordingly (2026-09-04).
    -- The companion needs a row here only if the scene wants to place him deliberately.
    "npcCast"          JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- [{ id, description }]. One is chosen at random per run (§ 14 Q31) and resolved by
    -- negotiation with the NPCs present, not by a scripted branch.
    complications      JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Scene vocabulary: GUIDANCE to the model, never a gate (§ 14 Q39). Words the learner
    -- meets here are offered to their library afterwards (§ 14 Q40).
    words              JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Authored NPC-to-NPC exchanges the learner can overhear (§ 14 Q6).
    conversations      JSONB NOT NULL DEFAULT '[]'::jsonb,

    "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The only scene query the runtime makes: publishable scenes for one language.
CREATE INDEX IF NOT EXISTS idx_iw_scenes_language_published
    ON iw_scenes (language, published);

-- ─────────────────────────────────────────────────────────────────────────────
-- One playthrough. iw is once-per-day and RESUMABLE within that day (§ 14 Q30), so a
-- run is a durable object with an open period, not an event logged at the end.
CREATE TABLE IF NOT EXISTS iw_scene_runs (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "userId"             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    language             VARCHAR(10) NOT NULL,
    -- RESTRICT, not CASCADE: a learner's history must not disappear because staff
    -- retired a scene. Unpublish it instead — that is what `published` is for.
    "sceneId"            UUID        NOT NULL REFERENCES iw_scenes(id) ON DELETE RESTRICT,
    -- Which of the scene's complications this run drew. Text, matching a blob entry's id.
    "complicationId"     TEXT,
    completed            BOOLEAN     NOT NULL DEFAULT FALSE,
    "durationSeconds"    INTEGER,
    "minutePointsEarned" INTEGER     NOT NULL DEFAULT 0,
    -- One curated tag summarizing the run, from a set held in code (§ 14 Q32).
    "overviewTagId"      TEXT,

    -- ── The transcript ──────────────────────────────────────────────────────
    -- EVERY utterance by anybody, as FREE TEXT: [{ speaker, text, at }]. Neither NPC nor
    -- player speech is segmented at write time — the gsa parses it later, both for the
    -- post-scene review and when the learner taps a line in-scene (2026-09-04).
    --
    -- Capped at 200 utterances / 256 KB, OLDEST TRUNCATED FIRST, enforced in the service
    -- layer. A run is a single day's conversation, so the cap should never be reached;
    -- it exists so a runaway loop cannot write an unbounded row.
    transcript           JSONB       NOT NULL DEFAULT '[]'::jsonb,

    "startedAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "completedAt"        TIMESTAMPTZ
);

-- At most one OPEN run per learner per language — the resumable-within-the-day rule
-- (§ 14 Q30) expressed as a constraint rather than as a service-layer convention.
-- Partial, so finished runs accumulate freely.
CREATE UNIQUE INDEX IF NOT EXISTS uq_iw_open_run_per_user_language
    ON iw_scene_runs ("userId", language)
    WHERE "completedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_iw_scene_runs_user_started
    ON iw_scene_runs ("userId", "startedAt" DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Per-NPC rating for one run (§ 14 Q21). Three axes, 1–5, from the grader: how far the
-- learner reached for words, whether the grammar held, and whether they addressed this
-- person the way this person should be addressed.
--
-- Its own table rather than a blob on the run, because a rating is looked up per NPC
-- (a learner's history WITH 王婶) and is the natural input to any later per-NPC progress
-- view — the one place normalization actually pays here.
CREATE TABLE IF NOT EXISTS iw_scene_ratings (
    id           UUID     PRIMARY KEY DEFAULT uuid_generate_v4(),
    "runId"      UUID     NOT NULL REFERENCES iw_scene_runs(id) ON DELETE CASCADE,
    "npcId"      TEXT     NOT NULL,
    vocabulary   SMALLINT NOT NULL CHECK (vocabulary  BETWEEN 1 AND 5),
    grammar      SMALLINT NOT NULL CHECK (grammar     BETWEEN 1 AND 5),
    politeness   SMALLINT NOT NULL CHECK (politeness  BETWEEN 1 AND 5),
    CONSTRAINT uq_iw_rating_per_run_npc UNIQUE ("runId", "npcId")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- What one NPC remembers about one learner (§ 14 Q3). A single rolling summary, not an
-- episode log: it is rendered into § 5.5 layer 3 on every turn, so its cost is paid on
-- every call and it must stay short. Rewritten after each run; truncated to 400
-- characters on write.
--
-- NO `language` COLUMN — an npc id already determines its language (an NPC belongs to
-- exactly one cast), so storing it would be a second, desynchronizable source of truth.
--
-- ⚠️ THE ABSENT ROW IS A REAL STATE AND MUST RENDER. Day 1 has no row, and the renderer
-- must produce the cold-start text ("you have only just found each other again") rather
-- than an empty section. See docs/IMMERSIVE_WORLD.md § 5.5.
--
-- Keyed (userId, npcId) with no scene and no run: memory belongs to the RELATIONSHIP.
-- This is also what makes learner-chosen companions cheap later — the key already
-- supports any NPC being anybody's companion, so no migration is needed for it.
CREATE TABLE IF NOT EXISTS iw_npc_memories (
    "userId"    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "npcId"     TEXT         NOT NULL,
    summary     VARCHAR(400) NOT NULL,
    "updatedAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("userId", "npcId")
);
