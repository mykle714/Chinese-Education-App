import type { MasteryBarId } from './wire.js';

/**
 * studyMode.ts — the two independent axes of an flp session, shared by server and client.
 *
 *   MODE (`?mode=`) — WHICH BANDS the loop draws from:
 *     review    — Comfortable + Mastered;
 *     challenge — Unfamiliar + Target;
 *     (absent)  — Study Mix, all four in the 1-2-2-5 shape.
 *
 *   BAR (`?bar=`) — WHICH TRACK the session exercises, and so which bar those bands,
 *   the queue and the cooldown are read off:
 *     core    — the know flp (recognition / production faces). The default.
 *     reading — the READING flp (docs/READING_WRITING_CENTERS.md § Phase 4): hanzi-only
 *               question face, every mark a reading mark. zh only.
 *
 * They are orthogonal on purpose: the Reading Center's study hand offers the same three
 * modes as the fdp's (Challenge / Review / Mix), each on the reading bar. Until
 * 2026-10-03 "reading" was itself a third MODE, which could not express Reading Review
 * or Reading Challenge.
 *
 * Readers: server/services/OnDeckVocabService.ts (MODE_CONFIGS, getDistributedWorkingLoop,
 * getFlpReadyCounts), server/routes/flashcardRoutes.ts + OnDeckVocabController (parsing),
 * server/contracts/flpReadiness.ts, and on the client FlashcardsLearnPage /
 * useWorkingLoop / flpFaceSteering / FlpStudyHand.
 */
export type StudyMode = 'review' | 'challenge';

/** Parse a `?mode=` / body `mode` value. Anything unrecognized is the default Mix. */
export function parseStudyMode(raw: unknown): StudyMode | undefined {
  return raw === 'review' || raw === 'challenge' ? raw : undefined;
}

/** The bars an flp session can run on. Writing has no flp — it is practised by hand. */
export type FlpBar = Extract<MasteryBarId, 'core' | 'reading'>;

/** Parse a `?bar=` / body `bar` value. Anything unrecognized is the know flp (`core`). */
export function parseFlpBar(raw: unknown): FlpBar {
  return raw === 'reading' ? 'reading' : 'core';
}
