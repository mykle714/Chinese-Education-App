import type { PoolClient } from 'pg';
import type { StoryListItem, StoryChoiceEdit } from '../../contracts/stories.js';

/**
 * Data-access contract for Adventures (cyoa) — migration 196: `stories`,
 * `story_passages`, `story_choices`, `story_progress`, `story_endings_found`, plus the
 * one read of users."isAuthor".
 *
 * NO POLICY HERE (docs/BACKEND_LAYERING.md § 2). Who may read a draft, who may write,
 * "same story" checks, publish warnings and the difficulty rule all live in
 * StoryService. The DAL refuses only input that would corrupt a row (missing ids).
 *
 * Every write takes an optional PoolClient so StoryService can enlist it in a
 * transaction (create story + start passage; save passage + replace its choices).
 *
 * See docs/CYOA_FEATURE.md § 6.
 */

/** A raw `stories` row. */
export interface StoryRow {
  id: string;
  language: string;
  title: string;
  iconId: string | null;
  authorUserId: string;
  startPassageId: string | null;
  publishedAt: string | null;
  difficulty: number | null;
  createdAt: string;
  updatedAt: string;
}

/** A passage with its choices (ordered by position) — the one-query read. */
export interface StoryPassageRow {
  id: string;
  storyId: string;
  /** Migration 197 — the author's organizing label; null = unnamed. */
  name: string | null;
  content: string;
  endingTitle: string | null;
  choices: StoryChoiceEdit[];
  createdAt: string;
  updatedAt: string;
}

/** A choice joined to the story that owns its passage. */
export interface StoryChoiceLookup {
  id: string;
  passageId: string;
  targetPassageId: string | null;
  storyId: string;
}

export interface StoryUpdateFields {
  title?: string;
  iconId?: string | null;
  startPassageId?: string;
}

export interface IStoryDAL {
  /** users."isAuthor" for one account; false when the account does not exist. */
  isAuthor(userId: string): Promise<boolean>;

  /**
   * The learner list (§ 6.2a): every PUBLISHED story of `language`, plus the viewer's
   * OWN drafts, each with the viewer's endings found / total / in-progress and the
   * author's name. Easiest first, newest published first within a level; never-
   * published drafts (no difficulty) last, newest created first.
   */
  listForViewer(viewerId: string, language: string): Promise<StoryListItem[]>;

  findStory(storyId: string, client?: PoolClient): Promise<StoryRow | null>;

  /** One passage with its choices, or null. */
  findPassage(passageId: string, client?: PoolClient): Promise<StoryPassageRow | null>;

  /** Every passage of a story with its choices, oldest first. */
  listPassages(storyId: string, client?: PoolClient): Promise<StoryPassageRow[]>;

  countPassages(storyId: string): Promise<number>;

  /** Ending passages (no choices) in the story right now — the denominator of § 3.5. */
  countEndings(storyId: string): Promise<number>;

  /**
   * The ending passages this viewer has reached in the story. Its length is the
   * numerator of § 3.5; the ids let the service predict a prefetched ending's "New!"
   * badge (StoryService.arrive → `next`).
   */
  listEndingsFound(userId: string, storyId: string): Promise<string[]>;

  /** A choice and the story its passage belongs to, or null. */
  findChoice(choiceId: string): Promise<StoryChoiceLookup | null>;

  // ── Progress (§ 3.3) ──

  /** The passage the viewer is on, or null (no row = the start passage). */
  getProgress(userId: string, storyId: string): Promise<string | null>;

  /** Upsert the resume point. */
  setProgress(userId: string, storyId: string, passageId: string): Promise<void>;

  /** Delete the resume point (an ending was reached). */
  clearProgress(userId: string, storyId: string): Promise<void>;

  /**
   * Set the passages' order to `passageIds` (1…n). The caller guarantees it is exactly
   * the story's passages (migration 199).
   */
  reorderPassages(storyId: string, passageIds: string[]): Promise<void>;

  /** Record an ending reached. Returns true the first time (the "New!" badge). */
  recordEndingFound(userId: string, storyId: string, passageId: string): Promise<boolean>;

  // ── Pages found (§ 3.6b, migration 198) ──

  /** Record a passage served to the viewer (a revisit is a no-op). */
  recordPassageSeen(userId: string, storyId: string, passageId: string): Promise<void>;

  /**
   * The passages this viewer has been served in the story. Its length is the "Pages
   * found" numerator; the ids let the service predict a prefetched step's count.
   */
  listPassagesSeen(userId: string, storyId: string): Promise<string[]>;

  // ── Author writes ──

  /** Insert a story with no start passage yet (set it with updateStory). */
  createStory(
    data: { authorUserId: string; language: string; title: string; iconId: string | null },
    client?: PoolClient
  ): Promise<StoryRow>;

  /** Update any subset; bumps `updatedAt`. Returns the row, or null if gone. */
  updateStory(storyId: string, fields: StoryUpdateFields, client?: PoolClient): Promise<StoryRow | null>;

  /** Delete the story; the schema cascades everything under it. */
  deleteStory(storyId: string): Promise<boolean>;

  /** Insert an empty passage. Bumps the story's `updatedAt`. */
  createPassage(storyId: string, content: string, client?: PoolClient): Promise<StoryPassageRow>;

  /**
   * Copy a passage — name (`name`, already decided by the service), body, ending name and
   * choices — into a new passage placed RIGHT AFTER it (later passages shift down one).
   * A choice back into the source becomes a choice back into the copy. Run inside the
   * caller's transaction. Returns the new passage's id.
   */
  duplicatePassage(storyId: string, sourcePassageId: string, name: string | null, client: PoolClient): Promise<string>;

  /**
   * Overwrite a passage's name, content + ending name and REPLACE its choices (delete then
   * insert). Must run inside a transaction — the caller passes the client. Bumps the
   * passage's and the story's `updatedAt`.
   */
  savePassage(
    passageId: string,
    data: {
      name: string | null;
      content: string;
      endingTitle: string | null;
      choices: Array<{ position: number; label: string; targetPassageId: string | null }>;
    },
    client: PoolClient
  ): Promise<void>;

  /** Delete one passage; choices into it go targetless, progress on it cascades. */
  deletePassage(passageId: string): Promise<boolean>;

  /** Set publishedAt = now() and the computed difficulty. Returns the new publishedAt. */
  publish(storyId: string, difficulty: number | null): Promise<string>;

  /** Set publishedAt = NULL. Progress and endings found are kept (§ 6.3). */
  unpublish(storyId: string): Promise<boolean>;
}
