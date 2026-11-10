--
-- PostgreSQL database dump
--

\restrict SHnDewiV65f3izgvX9eJ1UkQGyfDOodFkQKLtzdhg4apZbFQzL51qO1nOI8uU23

-- Dumped from database version 15.17
-- Dumped by pg_dump version 15.17

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: iw_npc_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iw_npc_memories (
    "userId" uuid NOT NULL,
    "npcId" text NOT NULL,
    summary character varying(400) NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: iw_scene_ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iw_scene_ratings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "runId" uuid NOT NULL,
    "npcId" text NOT NULL,
    vocabulary smallint NOT NULL,
    grammar smallint NOT NULL,
    politeness smallint NOT NULL,
    CONSTRAINT iw_scene_ratings_grammar_check CHECK (((grammar >= 1) AND (grammar <= 5))),
    CONSTRAINT iw_scene_ratings_politeness_check CHECK (((politeness >= 1) AND (politeness <= 5))),
    CONSTRAINT iw_scene_ratings_vocabulary_check CHECK (((vocabulary >= 1) AND (vocabulary <= 5)))
);


--
-- Name: iw_scene_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iw_scene_runs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "userId" uuid NOT NULL,
    language character varying(10) NOT NULL,
    "sceneId" uuid NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    "durationSeconds" integer,
    "minutePointsEarned" integer DEFAULT 0 NOT NULL,
    "overviewTagId" text,
    transcript jsonb DEFAULT '[]'::jsonb NOT NULL,
    "startedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "completedAt" timestamp with time zone,
    "complicationIds" text[] DEFAULT '{}'::text[] NOT NULL,
    "eventIds" text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: COLUMN iw_scene_runs."complicationIds"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.iw_scene_runs."complicationIds" IS 'Blob ids of every complication that fired in this run, in the order they fired. Each turn carries a 20% chance of one (§ 14 Q31); a run of ~12 turns averages ~2.4.';


--
-- Name: COLUMN iw_scene_runs."eventIds"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.iw_scene_runs."eventIds" IS 'Ordered ids of the events that fired during this run, in the order they fired. Mirrors "complicationIds".';


--
-- Name: iw_scenes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iw_scenes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    language character varying(10) NOT NULL,
    name character varying(120) NOT NULL,
    published boolean DEFAULT false NOT NULL,
    "completerNpcId" text NOT NULL,
    "completionAction" character varying(40) NOT NULL,
    "playerStartCol" integer NOT NULL,
    "playerStartRow" integer NOT NULL,
    "companionStartCol" integer NOT NULL,
    "companionStartRow" integer NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    layout jsonb DEFAULT '{}'::jsonb NOT NULL,
    "npcCast" jsonb DEFAULT '[]'::jsonb NOT NULL,
    complications jsonb DEFAULT '[]'::jsonb NOT NULL,
    conversations jsonb DEFAULT '[]'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "playerStartFacing" character varying(1) DEFAULT 's'::character varying NOT NULL,
    "companionStartFacing" character varying(1) DEFAULT 's'::character varying NOT NULL,
    "sceneNotes" text DEFAULT ''::text NOT NULL,
    events jsonb DEFAULT '[]'::jsonb NOT NULL,
    interactions jsonb DEFAULT '{}'::jsonb NOT NULL,
    "introText" text DEFAULT ''::text NOT NULL,
    CONSTRAINT chk_iw_scenes_start_facings CHECK (((("playerStartFacing")::text = ANY ((ARRAY['n'::character varying, 'e'::character varying, 's'::character varying, 'w'::character varying])::text[])) AND (("companionStartFacing")::text = ANY ((ARRAY['n'::character varying, 'e'::character varying, 's'::character varying, 'w'::character varying])::text[]))))
);


--
-- Name: COLUMN iw_scenes."completionAction"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.iw_scenes."completionAction" IS 'An IWNpcAction.id on the completer''s cast entry — NOT an engine verb. The author programs the action that ends the scene and nominates it here (§ 14 Q42).';


--
-- Name: COLUMN iw_scenes."sceneNotes"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.iw_scenes."sceneNotes" IS 'Author-written scene brief injected into the model prompt: what the scene is, and what its place tags mean. Reaches NPCs verbatim — no meta-language guard.';


--
-- Name: COLUMN iw_scenes.events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.iw_scenes.events IS 'Authored world events: [{id, description, atStartSeconds?}]. Injected like a complication but SCHEDULED (by a schedule_event step or atStartSeconds), never drawn by the per-turn roll.';


--
-- Name: COLUMN iw_scenes.interactions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.iw_scenes.interactions IS 'Place interactions, keyed by layout.locations tag: {"<tag>": [{kind, ...}]}. Runs when the learner walks up to that place''s cell. Steps: popup | npc_action | start_conversation | schedule_event | wait.';


--
-- Name: COLUMN iw_scenes."introText"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.iw_scenes."introText" IS 'Learner-facing intro shown as a dismissable card on scene load (world held until dismissed). Out-of-world prose — never injected into a model prompt; that is sceneNotes.';


--
-- Name: nightmarkettemplatedefinitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nightmarkettemplatedefinitions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(120) NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    definition jsonb NOT NULL,
    "createdBy" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    description text
);


--
-- Name: TABLE nightmarkettemplatedefinitions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.nightmarkettemplatedefinitions IS 'Validator-authored Night Market template CATALOG (definitions), keyed by unique name. Distinct from the per-user placement table. See docs/NIGHT_MARKET_TEMPLATE_EDITOR.md.';


--
-- Name: COLUMN nightmarkettemplatedefinitions.version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.nightmarkettemplatedefinitions.version IS '0-based template version. Version 0 is the base/default and the single source of truth for the shared placeholder mask; other versions inherit placeholder on read. See docs/NIGHT_MARKET_TEMPLATE_EDITOR.md.';


--
-- Name: COLUMN nightmarkettemplatedefinitions.description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.nightmarkettemplatedefinitions.description IS 'Optional author-written description of the template. Shared per name (authored on version 0; NULL on higher versions, merged from version 0 on read). See docs/NIGHT_MARKET_TEMPLATE_EDITOR.md.';


--
-- Name: nightmarkettemplatelocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nightmarkettemplatelocations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "userId" uuid NOT NULL,
    "templateName" character varying(120) NOT NULL,
    "activeVersion" integer NOT NULL,
    "offsetCol" integer NOT NULL,
    "offsetRow" integer NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    language character varying(10) DEFAULT 'zh'::character varying NOT NULL
);


--
-- Name: TABLE nightmarkettemplatelocations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.nightmarkettemplatelocations IS 'Per-user Night Market template PLACEMENTS: which catalog template (by name) sits where (SW-corner offset) and in which persisted activeVersion. The account-specific layout the runtime renders. See docs/NIGHT_MARKET_TEMPLATES.md.';


--
-- Name: COLUMN nightmarkettemplatelocations.language; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.nightmarkettemplatelocations.language IS 'Which language market this placement belongs to. Each (userId, language) is an independent market with its own origin/starter hub. Backfilled to zh by migration 136.';


--
-- Name: nightmarkettemplatesandbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nightmarkettemplatesandbox (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "userId" uuid NOT NULL,
    "templateName" character varying(120) NOT NULL,
    "activeVersion" integer NOT NULL,
    "offsetCol" integer NOT NULL,
    "offsetRow" integer NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: TABLE nightmarkettemplatesandbox; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.nightmarkettemplatesandbox IS 'Per-author Night Market template SANDBOX: freeform scratch layout where a template author tiles catalog templates (by name) at SW-corner offsets, each in its own switchable activeVersion. Overlaps allowed (no unique-corner index). Scratch state only — no unlock economy. See docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md.';


--
-- Name: COLUMN nightmarkettemplatesandbox.locked; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.nightmarkettemplatesandbox.locked IS 'When true, this sandbox placement cannot be dragged/moved (a move-guard only; selecting, version-switching, and deleting still work). See docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md.';


--
-- Name: COLUMN nightmarkettemplatesandbox.settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.nightmarkettemplatesandbox.settings IS 'Per-placement RENDER/VIEW preference bag (jsonb). Keys are validated by NightMarketSandboxService.cleanSettings; unknown keys are rejected. Current: showHouses (boolean, absent = true). See docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md.';


--
-- Name: nightmarketunlocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nightmarketunlocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "userId" uuid NOT NULL,
    "assetId" character varying(100) NOT NULL,
    "unlockType" character varying(20) DEFAULT 'stall'::character varying NOT NULL,
    "unlockOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "placedTemplateId" uuid NOT NULL,
    "placeholderAreaId" character varying(40) NOT NULL,
    language character varying(10) DEFAULT 'zh'::character varying NOT NULL
);


--
-- Name: TABLE nightmarketunlocks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.nightmarketunlocks IS 'Persists each user''s unlocked night market items. Base-set items have unlockOrder=0; earned items have unlockOrder=1,2,3,...';


--
-- Name: COLUMN nightmarketunlocks."placedTemplateId"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.nightmarketunlocks."placedTemplateId" IS 'The nightmarkettemplatelocations placement this unlock occupies (NOT NULL — no unplaced unlocks). See docs/NIGHT_MARKET_TEMPLATES.md.';


--
-- Name: COLUMN nightmarketunlocks."placeholderAreaId"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.nightmarketunlocks."placeholderAreaId" IS 'The placeholder area (slot) within the placement, as its SW-corner anchor id "col_row".';


--
-- Name: COLUMN nightmarketunlocks.language; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.nightmarketunlocks.language IS 'Which language market this occupant belongs to. Denormalized from its placement (like userId) so the per-market unique index and count/delete queries need no join. Backfilled to zh by migration 136.';


--
-- Name: iw_npc_memories iw_npc_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iw_npc_memories
    ADD CONSTRAINT iw_npc_memories_pkey PRIMARY KEY ("userId", "npcId");


--
-- Name: iw_scene_ratings iw_scene_ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iw_scene_ratings
    ADD CONSTRAINT iw_scene_ratings_pkey PRIMARY KEY (id);


--
-- Name: iw_scene_runs iw_scene_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iw_scene_runs
    ADD CONSTRAINT iw_scene_runs_pkey PRIMARY KEY (id);


--
-- Name: iw_scenes iw_scenes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iw_scenes
    ADD CONSTRAINT iw_scenes_pkey PRIMARY KEY (id);


--
-- Name: nightmarkettemplatedefinitions nightmarkettemplatedefinitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nightmarkettemplatedefinitions
    ADD CONSTRAINT nightmarkettemplatedefinitions_pkey PRIMARY KEY (id);


--
-- Name: nightmarkettemplatelocations nightmarkettemplatelocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nightmarkettemplatelocations
    ADD CONSTRAINT nightmarkettemplatelocations_pkey PRIMARY KEY (id);


--
-- Name: nightmarkettemplatesandbox nightmarkettemplatesandbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nightmarkettemplatesandbox
    ADD CONSTRAINT nightmarkettemplatesandbox_pkey PRIMARY KEY (id);


--
-- Name: nightmarketunlocks nightmarketunlocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nightmarketunlocks
    ADD CONSTRAINT nightmarketunlocks_pkey PRIMARY KEY (id);


--
-- Name: iw_scene_ratings uq_iw_rating_per_run_npc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iw_scene_ratings
    ADD CONSTRAINT uq_iw_rating_per_run_npc UNIQUE ("runId", "npcId");


--
-- Name: idx_iw_scene_runs_user_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iw_scene_runs_user_started ON public.iw_scene_runs USING btree ("userId", "startedAt" DESC);


--
-- Name: idx_iw_scenes_language_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iw_scenes_language_published ON public.iw_scenes USING btree (language, published);


--
-- Name: idx_nightmarkettemplatedefinitions_name_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_nightmarkettemplatedefinitions_name_version ON public.nightmarkettemplatedefinitions USING btree (name, version);


--
-- Name: idx_nightmarkettemplatesandbox_template_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nightmarkettemplatesandbox_template_name ON public.nightmarkettemplatesandbox USING btree ("templateName");


--
-- Name: idx_nightmarkettemplatesandbox_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nightmarkettemplatesandbox_user_created ON public.nightmarkettemplatesandbox USING btree ("userId", "createdAt");


--
-- Name: idx_nightmarketunlocks_placed_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nightmarketunlocks_placed_template ON public.nightmarketunlocks USING btree ("placedTemplateId");


--
-- Name: idx_nightmarketunlocks_placement_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_nightmarketunlocks_placement_slot ON public.nightmarketunlocks USING btree ("placedTemplateId", "placeholderAreaId");


--
-- Name: idx_nightmarketunlocks_user_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nightmarketunlocks_user_language ON public.nightmarketunlocks USING btree ("userId", language);


--
-- Name: idx_nightmarketunlocks_user_language_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nightmarketunlocks_user_language_order ON public.nightmarketunlocks USING btree ("userId", language, "unlockOrder");


--
-- Name: idx_nmtl_user_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nmtl_user_language ON public.nightmarkettemplatelocations USING btree ("userId", language);


--
-- Name: idx_nmtl_user_language_corner; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_nmtl_user_language_corner ON public.nightmarkettemplatelocations USING btree ("userId", language, "offsetCol", "offsetRow");


--
-- Name: idx_nmtl_user_language_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nmtl_user_language_created ON public.nightmarkettemplatelocations USING btree ("userId", language, "createdAt");


--
-- Name: uq_iw_open_run_per_user_language; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_iw_open_run_per_user_language ON public.iw_scene_runs USING btree ("userId", language) WHERE ("completedAt" IS NULL);


--
-- Name: iw_npc_memories iw_npc_memories_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iw_npc_memories
    ADD CONSTRAINT "iw_npc_memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: iw_scene_ratings iw_scene_ratings_runId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iw_scene_ratings
    ADD CONSTRAINT "iw_scene_ratings_runId_fkey" FOREIGN KEY ("runId") REFERENCES public.iw_scene_runs(id) ON DELETE CASCADE;


--
-- Name: iw_scene_runs iw_scene_runs_sceneId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iw_scene_runs
    ADD CONSTRAINT "iw_scene_runs_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES public.iw_scenes(id) ON DELETE RESTRICT;


--
-- Name: iw_scene_runs iw_scene_runs_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iw_scene_runs
    ADD CONSTRAINT "iw_scene_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: nightmarkettemplatedefinitions nightmarkettemplatedefinitions_createdBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nightmarkettemplatedefinitions
    ADD CONSTRAINT "nightmarkettemplatedefinitions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: nightmarkettemplatelocations nightmarkettemplatelocations_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nightmarkettemplatelocations
    ADD CONSTRAINT "nightmarkettemplatelocations_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: nightmarkettemplatesandbox nightmarkettemplatesandbox_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nightmarkettemplatesandbox
    ADD CONSTRAINT "nightmarkettemplatesandbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: nightmarketunlocks nightmarketunlocks_placedTemplateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nightmarketunlocks
    ADD CONSTRAINT "nightmarketunlocks_placedTemplateId_fkey" FOREIGN KEY ("placedTemplateId") REFERENCES public.nightmarkettemplatelocations(id) ON DELETE CASCADE;


--
-- Name: nightmarketunlocks nightmarketunlocks_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nightmarketunlocks
    ADD CONSTRAINT "nightmarketunlocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict SHnDewiV65f3izgvX9eJ1UkQGyfDOodFkQKLtzdhg4apZbFQzL51qO1nOI8uU23

