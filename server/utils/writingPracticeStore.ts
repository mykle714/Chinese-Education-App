/**
 * Writing-practice completion store (DAL-ish helper).
 *
 * Reads/writes `writing_practice_completions` (migration 81). A completion is the
 * first successful Verify of a (userId, language, entryKey, level); repeats are
 * idempotent via the unique index. Stars for a character = number of completed
 * levels. `level` is the level NUMBER 1..8 (migration 172), not the mode name.
 * See docs/HANDWRITING_RECOGNITION.md, docs/WRITING_PRACTICE_REWORK.md § 1.
 *
 * Referenced by: server/server.ts (the /api/handwriting/completions routes).
 */
import db from '../db.js';
import { isWritingLevelNumber } from '../contracts/writingLevels.js';

/**
 * The eight assistance level NUMBERS (server/contracts/writingLevels.ts →
 * WRITING_LEVELS) are the allow-list for incoming `level` values. Re-exported under
 * the store's name.
 */
export const isWritingPracticeLevel = isWritingLevelNumber;

/**
 * Records a first-time completion (idempotent). Returns the character's full set of
 * completed levels afterward, so the caller can update the stars UI in one round-trip.
 */
export async function recordCompletion(
  userId: string,
  language: string,
  entryKey: string,
  level: number,
): Promise<number[]> {
  const client = await db.getClient();
  try {
    await client.query(
      `INSERT INTO writing_practice_completions ("userId", language, "entryKey", level)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("userId", language, "entryKey", level) DO NOTHING`,
      [userId, language, entryKey, level],
    );
    const { rows } = await client.query(
      `SELECT level FROM writing_practice_completions
       WHERE "userId" = $1 AND language = $2 AND "entryKey" = $3`,
      [userId, language, entryKey],
    );
    return rows.map((r) => Number(r.level));
  } finally {
    client.release();
  }
}

/** Returns the completed levels for one character (drives stars / superscript). */
export async function getCompletedLevels(
  userId: string,
  language: string,
  entryKey: string,
): Promise<number[]> {
  const client = await db.getClient();
  try {
    const { rows } = await client.query(
      `SELECT level FROM writing_practice_completions
       WHERE "userId" = $1 AND language = $2 AND "entryKey" = $3`,
      [userId, language, entryKey],
    );
    return rows.map((r) => Number(r.level));
  } finally {
    client.release();
  }
}
