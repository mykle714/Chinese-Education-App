import type { MasteryWorldId } from './wire.js';

/**
 * studyMode.ts — the WORLD axis of an flp session, shared by server and client.
 *
 *   WORLD (`?world=`) — WHICH TRACK the session exercises, and so which bar the Study Mix
 *   bands, the queue and the cooldown are read off:
 *     core    — the know flp (recognition / production faces). The default.
 *     reading — the READING flp (docs/READING_WRITING_CENTERS.md § Phase 4): hanzi-only
 *               question face, every mark a reading mark. zh only.
 *     writing — the WRITING flp (docs/WRITING_PRACTICE_REWORK.md § 3): the card is drawn
 *               by hand at a level set by its averaged writing mastery; every mark a
 *               per-character writing mark. zh only, 1–4-character words.
 *
 * Every flp session is Study Mix (the 1-2-2-5 shape, server/contracts/studyMix.ts). The
 * second axis this file used to carry — the Review / Challenge study MODES (`?mode=`) —
 * was removed 2026-11-04 (docs/DEFERRED_WORK.md § 31). The Study Challenge feature
 * (docs/STUDY_CHALLENGE.md) only ever shared the word and is unaffected.
 *
 * The file keeps its name so client imports stay put; a rename to `flpWorld.ts` is a
 * pure-churn follow-up.
 *
 * Readers: server/services/OnDeckVocabService.ts (getDistributedWorkingLoop,
 * getFlpReadyCounts), server/routes/flashcardRoutes.ts + OnDeckVocabController (parsing),
 * and the client's flp (useWorkingLoop / flpFaceSteering).
 */

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
