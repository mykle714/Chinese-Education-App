import type { Text } from '../../types/index.js';

/** The columns `TextDAL.updateFields` may change. Language is immutable after creation. */
export interface TextFieldUpdate {
  title?: string;
  content?: string;
  characterCount?: number;
}

/**
 * Data access for `texts` — the Reader's documents (user-created and system).
 *
 * LAYER: DAL. One statement per method, rows returned as stored. Ownership checks,
 * the per-account document ceiling, sanitizing and title derivation all stay in
 * `TextService`; nothing here filters by "may this user see it".
 *
 * Referenced by: docs/USER_DOCUMENT_FEATURE_SUMMARY.md, docs/BACKEND_LAYERING.md § 4.
 */
export interface ITextDAL {
  /** Insert a user-created document; id and createdAt come from Postgres defaults. */
  insertUserText(data: {
    userId: string; title: string; content: string; language: string; characterCount: number;
  }): Promise<Text>;

  /** Update the given columns; null when no row has `id`. Must name at least one column. */
  updateFields(id: string, fields: TextFieldUpdate): Promise<Text | null>;

  /** Delete one document. True when a row was removed. */
  deleteById(id: string): Promise<boolean>;

  findById(id: string): Promise<Text | null>;

  /** The user's documents in one language, newest first. */
  findByUserAndLanguage(userId: string, language: string): Promise<Text[]>;

  /** The user's authored (`isUserCreated`) documents in every language, newest first. */
  findUserCreated(userId: string): Promise<Text[]>;

  /** How many documents the user has authored (system documents excluded). */
  countUserCreated(userId: string): Promise<number>;
}
