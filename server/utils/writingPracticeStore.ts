/**
 * Writing-practice completion store (DAL-ish helper).
 *
 * Reads/writes `writing_practice_completions` (migration 81). A completion is the
 * first successful Verify of a (userId, language, entryKey, level); repeats are
 * idempotent via the unique index. Stars for a character = number of completed
 * levels. See docs/HANDWRITING_RECOGNITION.md.
 *
 * Referenced by: server/server.ts (the /api/handwriting/completions routes).
 */
import db from '../db.js';

/** The four assistance levels; also the allow-list for incoming `level` values. */
export const WRITING_PRACTICE_LEVELS = ['trace', 'peek', 'flash', 'solo'] as const;
export type WritingPracticeLevel = (typeof WRITING_PRACTICE_LEVELS)[number];

export function isWritingPracticeLevel(value: unknown): value is WritingPracticeLevel {
  return typeof value === 'string' && (WRITING_PRACTICE_LEVELS as readonly string[]).includes(value);
}

/**
 * Records a first-time completion (idempotent). Returns the character's full set of
 * completed levels afterward, so the caller can update the stars UI in one round-trip.
 */
export async function recordCompletion(
  userId: string,
  language: string,
  entryKey: string,
  level: WritingPracticeLevel,
): Promise<string[]> {
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
    return rows.map((r) => r.level as string);
  } finally {
    client.release();
  }
}

/** Returns the completed levels for one character (drives stars / superscript). */
export async function getCompletedLevels(
  userId: string,
  language: string,
  entryKey: string,
): Promise<string[]> {
  const client = await db.getClient();
  try {
    const { rows } = await client.query(
      `SELECT level FROM writing_practice_completions
       WHERE "userId" = $1 AND language = $2 AND "entryKey" = $3`,
      [userId, language, entryKey],
    );
    return rows.map((r) => r.level as string);
  } finally {
    client.release();
  }
}
