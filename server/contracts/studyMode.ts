import type { MasteryWorldId } from './wire.js';

/**
 * studyMode.ts — the two independent axes of an flp session, shared by server and client.
 *
 *   MODE (`?mode=`) — WHICH BANDS the loop draws from:
 *     review    — Comfortable + Mastered;
 *     challenge — Unfamiliar + Target;
 *     (absent)  — Study Mix, all four in the 1-2-2-5 shape.
 *
 *   WORLD (`?world=`) — WHICH TRACK the session exercises, and so which bar those bands,
 *   the queue and the cooldown are read off:
 *     core    — the know flp (recognition / production faces). The default.
 *     reading — the READING flp (docs/READING_WRITING_CENTERS.md § Phase 4): hanzi-only
 *               question face, every mark a reading mark. zh only.
 *     writing — the WRITING flp (docs/WRITING_PRACTICE_REWORK.md § 3): the card is drawn
 *               by hand at a level set by its averaged writing mastery; every mark a
 *               per-character writing mark. zh only, 1–4-character words.
 *
 * They are orthogonal on purpose: the Reading Center's study hand offers the same three
 * modes as the fdp's (Challenge / Review / Mix), each on the reading bar. Until
 * 2026-10-03 "reading" was itself a third MODE, which could not express Reading Review
 * or Reading Challenge.
 *
 * ⚠️ DEPRECATED (2026-10-31): the review and challenge MODES are being removed entirely;
 * Study Mix is the only mode that stays (docs/DEFERRED_WORK.md § 31). The WORLD axis is
 * unaffected, and so is the Study Challenge feature, which merely shares the word.
 *
 * Readers: server/services/OnDeckVocabService.ts (MODE_CONFIGS, getDistributedWorkingLoop,
 * getFlpReadyCounts), server/routes/flashcardRoutes.ts + OnDeckVocabController (parsing),
 * server/contracts/flpReadiness.ts, and on the client FlashcardsLearnPage /
 * useWorkingLoop / flpFaceSteering / FlpStudyHand.
 */
/**
 * @deprecated Review and challenge modes are being removed; Study Mix stays
 * (docs/DEFERRED_WORK.md § 31). Not related to the Study Challenge feature (docs/STUDY_CHALLENGE.md), which stays.
 */
export type StudyMode = 'review' | 'challenge';

/**
 * Parse a `?mode=` / body `mode` value. Anything unrecognized is the default Mix.
 * @deprecated With `StudyMode`: once it goes, every session is Mix.
 */
export function parseStudyMode(raw: unknown): StudyMode | undefined {
  return raw === 'review' || raw === 'challenge' ? raw : undefined;
}

/**
 * The worlds an flp session can run on. Writing joined in the 8-level rework
 * (docs/WRITING_PRACTICE_REWORK.md § 3): a writing card is drawn by hand at a level set
 * by its (averaged) writing mastery, and the flp writes per-character marks.
 */
export type FlpWorld = Extract<MasteryWorldId, 'core' | 'reading' | 'writing'>;

/** Parse a `?world=` / body `world` value. Anything unrecognized is the know flp (`core`). */
export function parseFlpWorld(raw: unknown): FlpWorld {
  return raw === 'reading' ? 'reading' : raw === 'writing' ? 'writing' : 'core';
}
