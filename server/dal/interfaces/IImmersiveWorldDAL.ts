import type { PoolClient } from 'pg';
import type { IWScene, IWSceneSummary, IWSceneRun, IWTranscriptEntry } from '../../contracts/iw.js';

/**
 * Data-access contract for the Immersive World scene catalog (`iw_scenes`,
 * migration 158).
 *
 * SCOPE: scenes and RUNS. `iw_scene_ratings` and `iw_npc_memories` are still phase 3b
 * (docs/IMMERSIVE_WORLD.md § 12) and get their methods when there is a grader to call
 * them — with one exception: `listNpcReferences` reads all three, because the startup
 * validation pass has to cover every table that stores an NPC id, not just the authored one.
 *
 * The run methods arrived with the transcript (2026-09-08) and cover only what a transcript
 * needs: open, append, close, read back. A run's `complicationId` draw, its minute points
 * and its `overviewTagId` are written by nothing yet.
 *
 * NO POLICY HERE. Whether a scene is well-formed (`validateScene`) and who may write one
 * (`users.isTemplateAuthor`) are ImmersiveWorldSceneService's business. This layer refuses
 * only input that would corrupt a row.
 *
 * Every method takes an optional PoolClient so a caller inside a transaction can enlist
 * the query — the shape docs/BACKEND_LAYERING.md §3 prescribes.
 *
 * See docs/IMMERSIVE_WORLD.md § 8 (layering table) and § 12 phase 1d.
 */

/**
 * One stored NPC id and where it was found. NPC ids are TEXT with no foreign key — the
 * referent is a code constant in `server/config/iwNpcs.ts` — so this is the raw material
 * for the startup pass that asserts every one of them still resolves.
 */
export interface IWNpcReference {
  /** Which table and column the id came from, e.g. `scene:cast`. */
  source: 'scene:completer' | 'scene:cast' | 'scene:conversation' | 'rating' | 'memory';
  /** The owning row's id, as text — a scene id, a rating id, or a user id for a memory. */
  refId: string;
  /** Something human-readable to print in the failure: a scene name, a run id. */
  label: string;
  npcId: string;
}

export interface IImmersiveWorldDAL {
  /** Scene summaries for the editor's load list, newest-updated first. */
  listScenes(language?: string, client?: PoolClient): Promise<IWSceneSummary[]>;

  /** One whole scene (blobs inline), or null. This is the read the runtime makes at scene start. */
  findSceneById(id: string, client?: PoolClient): Promise<IWScene | null>;

  /** Insert a scene. The caller has already validated it. */
  createScene(scene: IWScene, client?: PoolClient): Promise<IWScene>;

  /**
   * Overwrite a scene wholesale by id, returning the stored row, or null when the id is
   * gone. A whole-row write rather than a patch: the editor loads a scene entire and saves
   * it entire, so a partial update would only ever be a way to lose a blob.
   */
  updateScene(id: string, scene: IWScene, client?: PoolClient): Promise<IWScene | null>;

  /** Delete a scene. Returns true if a row went away. */
  deleteScene(id: string, client?: PoolClient): Promise<boolean>;

  /** Is this scene name free within its language? Backs the editor's rename gate. */
  isNameAvailable(language: string, name: string, exceptId?: string, client?: PoolClient): Promise<boolean>;

  /**
   * Every NPC id stored anywhere, with its origin. Read once at startup; never on a
   * request path.
   */
  listNpcReferences(client?: PoolClient): Promise<IWNpcReference[]>;

  // ── Runs and their transcripts ─────────────────────────────────────────────

  /**
   * Start a run, closing whatever open run this learner had in this language first.
   *
   * ⚠️ **THE CLOSE IS NOT HOUSEKEEPING — IT IS WHAT MAKES THE INSERT LEGAL.**
   * `uq_iw_open_run_per_user_language` permits exactly one run with a NULL `completedAt`
   * per (user, language), so a learner whose last tab was closed without a `/session/end`
   * would otherwise be unable to start another scene ever again. Both statements run in
   * ONE transaction, because between them the constraint is satisfied by nothing.
   *
   * ⚠️ It does NOT resume. § 14 Q30's within-the-day resume is phase 3 proper and needs the
   * learner's 04:00 local boundary, which this layer has no business knowing; today a
   * second visit to a scene is a second run, and the first one is closed where it stood.
   */
  openRun(userId: string, language: string, sceneId: string, client?: PoolClient): Promise<IWSceneRun>;

  /**
   * Append utterances to a run's transcript, dropping the oldest beyond
   * {@link IW_TRANSCRIPT_MAX_ENTRIES}. Returns false when the run id is gone.
   *
   * ⚠️ **THE TRIM IS IN SQL, AND IT HAS TO BE.** Appending is a read-modify-write on one
   * jsonb column from a path that runs several times a second in one scene; doing it in the
   * service would mean fetching the column, splicing it and writing it back, and two turns
   * landing together would silently lose one. One `UPDATE` is atomic against itself.
   */
  appendTranscript(runId: string, entries: readonly IWTranscriptEntry[], client?: PoolClient): Promise<boolean>;

  /** Close a run, stamping `completedAt` and the elapsed `durationSeconds`. */
  completeRun(runId: string, completed: boolean, client?: PoolClient): Promise<IWSceneRun | null>;

  /** One run, whole. */
  findRunById(runId: string, client?: PoolClient): Promise<IWSceneRun | null>;

  /** A learner's runs, newest first — the read behind any history view or CLI dump. */
  listRuns(userId: string, limit: number, language?: string, client?: PoolClient): Promise<IWSceneRun[]>;
}
