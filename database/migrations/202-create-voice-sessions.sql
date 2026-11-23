-- Migration 202: Voice Assistant — saved voice sessions and their transcript turns.
--
-- Design: docs/VOICE_ASSISTANT.md § 11 (both tables approved by the owner 2026-11-18, Q1).
-- Code: server/dal/implementations/VoiceSessionDAL.ts, server/services/voice/VoiceSessionService.ts,
-- server/services/voice/LiveVoiceSession.ts, server/contracts/voice.ts.
--
-- voice_sessions — one row per voice conversation. Opened when the socket's `start` is
--   accepted, finalized (endedAt + the second counters + turnCount) when it ends. The daily
--   voice-minute cap is SUM(userSeconds + assistantSeconds) over the learner's sessions that
--   started in the current 04:00-local day, plus the open session's running total held in
--   memory — there is deliberately no separate usage table (§ 11, Q1).
--
-- voice_turns — the saved transcript: one row per learner utterance or tutor reply. TEXT
--   ONLY: the learner's audio is never stored (owner's decision 2026-11-18). `recast` is the
--   tutor's silent `note_recast` tool call for that reply (§ 7); `lowConfidenceWords` the
--   words the STT was unsure of (§ 5.1). No word-match columns: known/learning tinting is
--   recomputed against the learner's CURRENT cards when a transcript is opened (§ 11).
--
-- Retention: kept forever for now (§ 11). A TTL, if added, is a nightly delete on
-- voice_sessions."endedAt" — the turns cascade and nothing else references these rows.
--
-- Per-user data: NOT on /data-ppe-to-dev's pull list.
-- Additive: safe to auto-run by migrate.sh ahead of the new code (old code never reads it).

CREATE TABLE IF NOT EXISTS voice_sessions (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    language           varchar(10) NOT NULL,
    "startedAt"        timestamptz NOT NULL DEFAULT now(),
    -- NULL while the session is live (or if the server died before finalizing it).
    "endedAt"          timestamptz,
    -- Seconds of learner speech (endpointed utterances) and of tutor audio sent.
    "userSeconds"      real        NOT NULL DEFAULT 0,
    "assistantSeconds" real        NOT NULL DEFAULT 0,
    "turnCount"        integer     NOT NULL DEFAULT 0
);

-- The session list (newest first) and the daily cap's per-day sum both scan this.
CREATE INDEX IF NOT EXISTS voice_sessions_user_started_idx
    ON voice_sessions ("userId", "startedAt" DESC);

CREATE TABLE IF NOT EXISTS voice_turns (
    id                   bigserial   PRIMARY KEY,
    "sessionId"          uuid        NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
    "turnIndex"          integer     NOT NULL,
    role                 varchar(10) NOT NULL CHECK (role IN ('user', 'assistant')),
    text                 text        NOT NULL,
    -- STT words below the confidence threshold (user turns only); NULL when none / not reported.
    "lowConfidenceWords" jsonb,
    -- note_recast { learnerSaid, better, newWords[] } (assistant turns only); NULL when no recast.
    recast               jsonb,
    -- TRUE when the learner barged in before this reply finished playing.
    interrupted          boolean     NOT NULL DEFAULT false,
    "createdAt"          timestamptz NOT NULL DEFAULT now(),
    UNIQUE ("sessionId", "turnIndex")
);

COMMENT ON TABLE voice_sessions IS
    'Voice Assistant: one row per spoken tutor conversation; also the source of the daily voice-minute cap. Migration 202, docs/VOICE_ASSISTANT.md § 11.';
COMMENT ON TABLE voice_turns IS
    'Voice Assistant: the saved transcript (text only — learner audio is never stored). Migration 202, docs/VOICE_ASSISTANT.md § 11.';
