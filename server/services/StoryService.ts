import type { PoolClient } from 'pg';
import { dbManager } from '../dal/base/DatabaseManager.js';
import type { TransactionRunner } from '../types/dal.js';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../types/dal.js';
import type { IStoryDAL, StoryRow, StoryPassageRow } from '../dal/interfaces/IStoryDAL.js';
import type { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';
import { sanitizeDocumentContent } from '../utils/sanitizeContent.js';
import {
  buildDictMap,
  buildExcludeSet,
  getAllSubstrings,
  segmentWithDict,
  splitHanRuns,
  SEGMENTATION_MAX_TOKEN_CHARS,
} from '../dal/shared/segmentString.js';
import {
  STORY_MAX_CHOICES,
  STORY_MAX_PASSAGES,
  STORY_PASSAGE_MAX_LENGTH,
  STORY_TITLE_MAX_LENGTH,
  STORY_CHOICE_LABEL_MAX_LENGTH,
  STORY_ENDING_TITLE_MAX_LENGTH,
  STORY_PASSAGE_NAME_MAX_LENGTH,
  computeStoryCommonality,
  storyPublishWarnings,
  type StoryListResponse,
  type StoryPlayResponse,
  type StoryPlayStep,
  type StoryPassageView,
  type StoryEditResponse,
  type StoryCreateBody,
  type StoryUpdateBody,
  type StoryPassageSaveBody,
  type StoryPublishResponse,
  type StoryPassageEdit,
} from '../contracts/stories.js';

/**
 * Adventures are Chinese-only for now (docs/CYOA_FEATURE.md status line; Spanish is
 * paused). One constant so turning another language on is a one-line change plus a
 * `language` parameter on the list read.
 */
const STORY_LANGUAGE = 'zh';

/** Shown for a story that does not exist, or that the caller may not see (unpublished). */
const UNAVAILABLE = 'This story is no longer available';

/**
 * Every story / passage / choice id is a uuid (migration 196). Checked before any query,
 * because Postgres rejects a malformed uuid with a 500-level syntax error rather than
 * "no row" — a hand-typed /adventures/abc should 404, not 500.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

/**
 * Adventures (cyoa) policy — docs/CYOA_FEATURE.md § 3 (learner) and § 5–6 (author).
 *
 * LAYER: service. Owns every rule; writes no SQL and touches no Express types
 * (docs/BACKEND_LAYERING.md § 2). The rules, in one place:
 *
 *   • VISIBILITY. A learner sees published stories; an author also sees their own
 *     drafts. Anything else reads as "no longer available" (404) — the same answer a
 *     learner gets mid-story when the author unpublishes (§ 6.3).
 *   • WRITES are checked twice: users."isAuthor", AND the story's author is the caller.
 *     Authors cannot touch each other's stories.
 *   • PROGRESSION (§ 3.3). A choice must sit on the passage the learner is on (their
 *     progress row, or the start passage) — no skipping ahead, no stepping back.
 *     Choices are final. Reaching an ENDING (a passage with no choices) records it in
 *     story_endings_found and deletes the progress row (§ 3.6); reaching a passage
 *     whose every choice is targetless is "To be continued" (§ 3.6a) and keeps progress
 *     there. Author play counts exactly like anyone's (§ 5).
 *   • PUBLISH WARNS, never blocks (§ 6.3). The warnings come from the shared
 *     `storyPublishWarnings`, which the editor read also returns live.
 *   • GRAPH INTEGRITY. A choice's target and a story's start passage must be passages
 *     of the SAME story (not expressible as an FK). The start passage cannot be
 *     deleted — pick another start first — so a story never silently loses its entry.
 *   • COMMONALITY is computed on publish (§ 6.2a): see computeCommonality. (It replaced
 *     an HSK difficulty level on 2026-11-21, when word difficulty stopped being shown.)
 *
 * Referenced by: server/controllers/StoryController.ts, server/dal/setup.ts,
 * server/__tests__/stories.test.ts.
 */
export class StoryService {
  constructor(
    private storyDAL: IStoryDAL,
    private dictionaryDAL: IDictionaryDAL,
    private txRunner: TransactionRunner = dbManager
  ) {}

  // ── Learner ─────────────────────────────────────────────────────────────────

  /** The list (§ 6.2a), plus whether the caller may author. */
  async list(userId: string): Promise<StoryListResponse> {
    const [isAuthor, stories] = await Promise.all([
      this.storyDAL.isAuthor(userId),
      this.storyDAL.listForViewer(userId, STORY_LANGUAGE),
    ]);
    return { isAuthor, stories };
  }

  /** Open (or resume) a story: the learner's current passage, or the start passage. */
  async play(userId: string, storyId: string): Promise<StoryPlayResponse> {
    const story = await this.requireVisible(userId, storyId);
    const passage = await this.currentPassage(userId, story);
    return this.arrive(userId, story, passage, { saveProgress: false });
  }

  /** Pick a choice on the current passage and move to its target. */
  async choose(userId: string, storyId: string, choiceId: unknown): Promise<StoryPlayResponse> {
    if (typeof choiceId !== 'string' || !choiceId) throw new ValidationError('choiceId is required');
    const story = await this.requireVisible(userId, storyId);
    if (!isUuid(choiceId)) throw new NotFoundError('Choice not found');

    const choice = await this.storyDAL.findChoice(choiceId);
    if (!choice || choice.storyId !== story.id) throw new NotFoundError('Choice not found');

    // The choice must be on the passage the learner is actually on. A stale tab (the
    // learner advanced in another tab, or the author edited the passage) gets a 400 and
    // the client re-reads /play.
    const current = await this.currentPassage(userId, story);
    if (choice.passageId !== current.id) {
      throw new ValidationError('That choice is not on your current passage');
    }
    if (!choice.targetPassageId) throw new ValidationError('That choice is coming soon');

    const target = await this.storyDAL.findPassage(choice.targetPassageId);
    if (!target || target.storyId !== story.id) throw new NotFoundError('Passage not found');

    return this.arrive(userId, story, target, { saveProgress: true });
  }

  // ── Author ──────────────────────────────────────────────────────────────────

  /** The whole graph for the editor, with the publish warnings computed live. */
  async getForEdit(userId: string, storyId: string): Promise<StoryEditResponse> {
    const story = await this.requireOwnStory(userId, storyId);
    const passages = await this.storyDAL.listPassages(story.id);
    return this.editResponse(story, passages);
  }

  /** New story with one empty start passage, in one transaction. */
  async create(userId: string, body: StoryCreateBody): Promise<StoryEditResponse> {
    await this.requireAuthor(userId);
    const title = this.normalizeTitle(body?.title);
    const iconId = this.normalizeIconId(body?.iconId);

    const { story, passage } = await this.txRunner.executeInTransaction(async (tx) => {
      const client: PoolClient = tx.getClient();
      const created = await this.storyDAL.createStory(
        { authorUserId: userId, language: STORY_LANGUAGE, title, iconId: iconId ?? null },
        client
      );
      const start = await this.storyDAL.createPassage(created.id, '', client);
      const updated = await this.storyDAL.updateStory(created.id, { startPassageId: start.id }, client);
      return { story: updated ?? created, passage: start };
    });
    return this.editResponse(story, [passage]);
  }

  /** Rename, change icon, or move the start passage. */
  async update(userId: string, storyId: string, body: StoryUpdateBody): Promise<StoryEditResponse> {
    const story = await this.requireOwnStory(userId, storyId);
    const fields: StoryUpdateBody = {};
    if (body?.title !== undefined) fields.title = this.normalizeTitle(body.title);
    if (body?.iconId !== undefined) fields.iconId = this.normalizeIconId(body.iconId);
    if (body?.startPassageId !== undefined) {
      await this.requirePassageOf(story.id, body.startPassageId);
      fields.startPassageId = body.startPassageId;
    }
    const updated = (await this.storyDAL.updateStory(story.id, fields)) ?? story;
    return this.editResponse(updated, await this.storyDAL.listPassages(story.id));
  }

  /** Delete the story; every passage, choice, progress row and ending found goes with it. */
  async remove(userId: string, storyId: string): Promise<void> {
    const story = await this.requireOwnStory(userId, storyId);
    await this.storyDAL.deleteStory(story.id);
  }

  /** Add an empty passage (the editor's "→ new passage" or a bare "Add passage"). */
  async createPassage(userId: string, storyId: string): Promise<StoryPassageEdit> {
    const story = await this.requireOwnStory(userId, storyId);
    if ((await this.storyDAL.countPassages(story.id)) >= STORY_MAX_PASSAGES) {
      throw new ValidationError(`A story can have at most ${STORY_MAX_PASSAGES} passages`);
    }
    return this.toPassageEdit(await this.storyDAL.createPassage(story.id, ''));
  }

  /**
   * Duplicate a passage (the editor row's copy button, § 5.4): body, ending name and
   * choices (same targets) copied into a new passage right after it. A named passage's
   * copy is "<name> (copy)"; an unnamed one's stays unnamed (it gets its own "Passage n").
   * Never the start. Answers with the whole graph (positions shifted).
   */
  async duplicatePassage(userId: string, storyId: string, passageId: string): Promise<StoryEditResponse> {
    const story = await this.requireOwnStory(userId, storyId);
    const source = await this.requirePassageOf(story.id, passageId);
    if ((await this.storyDAL.countPassages(story.id)) >= STORY_MAX_PASSAGES) {
      throw new ValidationError(`A story can have at most ${STORY_MAX_PASSAGES} passages`);
    }
    const name = source.name ? this.copyName(source.name) : null;
    await this.txRunner.executeInTransaction(async (tx) => {
      await this.storyDAL.duplicatePassage(story.id, source.id, name, tx.getClient());
    });
    return this.editResponse(story, await this.storyDAL.listPassages(story.id));
  }

  /**
   * Reorder the story's passages (the editor's drag handle, § 5.3). `passageIds` must be
   * a permutation of the story's passages: a list from before another tab added or
   * deleted one is refused, so nothing is silently dropped or misplaced.
   */
  async reorderPassages(userId: string, storyId: string, passageIds: unknown): Promise<StoryEditResponse> {
    const story = await this.requireOwnStory(userId, storyId);
    const passages = await this.storyDAL.listPassages(story.id);
    const ids = Array.isArray(passageIds) ? passageIds : null;
    const current = new Set(passages.map((passage) => passage.id));
    const isPermutation =
      !!ids &&
      ids.length === current.size &&
      new Set(ids).size === ids.length &&
      ids.every((id) => typeof id === 'string' && current.has(id));
    if (!isPermutation) {
      throw new ValidationError('The passage list changed somewhere else. Reload and try again.');
    }
    await this.storyDAL.reorderPassages(story.id, ids as string[]);
    return this.editResponse(story, await this.storyDAL.listPassages(story.id));
  }

  /**
   * Save one passage: its text, ending name, and its whole choice list (replaced). Goes
   * live immediately on a published story (§ 5 — no draft copy).
   */
  async savePassage(
    userId: string,
    storyId: string,
    passageId: string,
    body: StoryPassageSaveBody
  ): Promise<StoryPassageEdit> {
    const story = await this.requireOwnStory(userId, storyId);
    const passages = await this.storyDAL.listPassages(story.id);
    const storyPassageIds = new Set(passages.map((passage) => passage.id));
    const current = passages.find((passage) => passage.id === passageId);
    if (!current) throw new NotFoundError('Passage not found');
    // Two tabs (or devices) editing one passage: refuse a save based on an older version
    // rather than silently replace the other tab's text. Compared as instants, not strings,
    // so the wire's ISO form and the row's Date agree.
    if (typeof body?.expectedUpdatedAt === 'string' && !this.sameInstant(body.expectedUpdatedAt, current.updatedAt)) {
      throw new ConflictError('This passage was changed somewhere else since you opened it. Save again to replace that version with yours.');
    }

    const content = sanitizeDocumentContent(body?.content);
    if (content.length > STORY_PASSAGE_MAX_LENGTH) {
      throw new ValidationError(`Passage is too long (maximum ${STORY_PASSAGE_MAX_LENGTH} characters)`);
    }
    const name = this.normalizePassageName(body?.name);
    const endingTitle = this.normalizeEndingTitle(body?.endingTitle);
    const choices = this.normalizeChoices(body?.choices, storyPassageIds);

    await this.txRunner.executeInTransaction(async (tx) => {
      await this.storyDAL.savePassage(passageId, { name, content, endingTitle, choices }, tx.getClient());
    });
    const saved = await this.storyDAL.findPassage(passageId);
    if (!saved) throw new NotFoundError('Passage not found');
    return this.toPassageEdit(saved);
  }

  /**
   * Delete a passage. Choices leading into it become targetless ("coming soon"); learners
   * standing on it restart from the start; endings found on it drop from their counts
   * (all by the schema's FK actions, migration 196). The start passage is refused.
   */
  async deletePassage(userId: string, storyId: string, passageId: string): Promise<void> {
    const story = await this.requireOwnStory(userId, storyId);
    await this.requirePassageOf(story.id, passageId);
    if (story.startPassageId === passageId) {
      throw new ValidationError('This is the start passage — choose another start passage before deleting it');
    }
    await this.storyDAL.deletePassage(passageId);
  }

  /** Publish (or re-publish): stamp publishedAt, recompute commonality, return the warnings. */
  async publish(userId: string, storyId: string): Promise<StoryPublishResponse> {
    const story = await this.requireOwnStory(userId, storyId);
    const passages = await this.storyDAL.listPassages(story.id);
    const warnings = storyPublishWarnings({ startPassageId: story.startPassageId, passages });
    const commonality = await this.computeCommonality(passages, story.language);
    const publishedAt = await this.storyDAL.publish(story.id, commonality);
    return { publishedAt, commonality, warnings };
  }

  /**
   * Recompute one story's commonality in place, without re-publishing (publishedAt is
   * untouched). No author check: called only by the backfill script
   * (server/scripts/backfill/cyoa/backfill-story-commonality.ts), never by a route.
   * Returns the stored value; null when the story does not exist or has no scored word.
   */
  async recomputeCommonality(storyId: string): Promise<number | null> {
    const story = await this.storyDAL.findStory(storyId);
    if (!story) return null;
    const passages = await this.storyDAL.listPassages(story.id);
    const commonality = await this.computeCommonality(passages, story.language);
    await this.storyDAL.setCommonality(story.id, commonality);
    return commonality;
  }

  /** Hide from learners. Their progress and endings found are kept (§ 6.3). */
  async unpublish(userId: string, storyId: string): Promise<void> {
    const story = await this.requireOwnStory(userId, storyId);
    await this.storyDAL.unpublish(story.id);
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  /**
   * Serve `passage` to the learner, applying the arrival rules: an ending is recorded
   * and clears progress; any other passage becomes the resume point (when arriving by
   * a choice — `play` re-serving the current passage has nothing new to save).
   *
   * ── PREFETCH (`next`) ──
   * The response also carries what every available choice leads to, built by the SAME
   * `buildStep` from the state the arrival just left behind, so the client can show the
   * next passage the moment it is tapped and confirm with `/choose` in the background
   * (§ 3.3). A prefetched ending predicts its own "New!" badge (not in the found set)
   * and the count it would tick to. A choice's prediction can only go stale if the
   * author edits the graph mid-read — then `/choose` answers with the truth (or a 400)
   * and the client swaps to it.
   */
  private async arrive(
    userId: string,
    story: StoryRow,
    passage: StoryPassageRow,
    { saveProgress }: { saveProgress: boolean }
  ): Promise<StoryPlayResponse> {
    const isEnding = passage.choices.length === 0;
    let ending: StoryPlayStep['ending'] = null;

    // Every serve counts toward "Pages found" (§ 3.6b) — re-serving the resume passage
    // included (idempotent: a revisit is a no-op).
    await this.storyDAL.recordPassageSeen(userId, story.id, passage.id);

    if (isEnding) {
      const isNew = await this.storyDAL.recordEndingFound(userId, story.id, passage.id);
      await this.storyDAL.clearProgress(userId, story.id);
      ending = { title: passage.endingTitle, isNew };
    } else if (saveProgress) {
      await this.storyDAL.setProgress(userId, story.id, passage.id);
    }

    // Read AFTER recording, so a new ending's tick (1/7 → 2/7) is already in it. The
    // targets are read alongside: at most STORY_MAX_CHOICES single-row reads.
    const targetIds = [...new Set(passage.choices.map((c) => c.targetPassageId).filter((id): id is string => !!id))];
    const [foundIds, endingsTotal, seenIds, passagesTotal, targets] = await Promise.all([
      this.storyDAL.listEndingsFound(userId, story.id),
      this.storyDAL.countEndings(story.id),
      this.storyDAL.listPassagesSeen(userId, story.id),
      this.storyDAL.countPassages(story.id),
      Promise.all(targetIds.map((id) => this.storyDAL.findPassage(id))),
    ]);
    const found = new Set(foundIds);
    const seen = new Set(seenIds);
    const storyView = { id: story.id, title: story.title, iconId: story.iconId, language: story.language, isOwn: story.authorUserId === userId };

    const next: Record<string, StoryPlayStep> = {};
    const targetById = new Map(
      targets.filter((t): t is StoryPassageRow => !!t && t.storyId === story.id).map((t) => [t.id, t])
    );
    for (const choice of passage.choices) {
      const target = choice.targetPassageId ? targetById.get(choice.targetPassageId) : undefined;
      if (!target) continue;
      const targetIsEnding = target.choices.length === 0;
      const isNew = targetIsEnding && !found.has(target.id);
      next[choice.id] = this.buildStep(
        storyView,
        target,
        targetIsEnding ? { title: target.endingTitle, isNew } : null,
        { found: found.size + (isNew ? 1 : 0), total: endingsTotal },
        { seen: seen.size + (seen.has(target.id) ? 0 : 1), total: passagesTotal }
      );
    }

    return {
      ...this.buildStep(storyView, passage, ending, { found: found.size, total: endingsTotal }, { seen: seen.size, total: passagesTotal }),
      next,
    };
  }

  /** The learner view of one passage (pure — no reads, no writes). */
  private buildStep(
    story: StoryPlayStep['story'],
    passage: StoryPassageRow,
    ending: StoryPlayStep['ending'],
    endings: { found: number; total: number },
    pages: { seen: number; total: number }
  ): StoryPlayStep {
    const view: StoryPassageView = {
      id: passage.id,
      content: passage.content,
      choices: passage.choices.map((choice) => ({
        id: choice.id,
        position: choice.position,
        label: choice.label,
        available: !!choice.targetPassageId,
      })),
    };
    return {
      story,
      passage: view,
      ending,
      toBeContinued: ending === null && view.choices.every((choice) => !choice.available),
      endingsFound: endings.found,
      endingsTotal: endings.total,
      passagesSeen: pages.seen,
      passagesTotal: pages.total,
    };
  }

  /** The learner's resume passage, falling back to the start passage. */
  private async currentPassage(userId: string, story: StoryRow): Promise<StoryPassageRow> {
    const progressId = await this.storyDAL.getProgress(userId, story.id);
    if (progressId) {
      const passage = await this.storyDAL.findPassage(progressId);
      // The FK cascades a deleted passage's progress away, so this only misses on a
      // race with that delete — fall through to the start like a fresh read would.
      if (passage && passage.storyId === story.id) return passage;
    }
    if (!story.startPassageId) throw new NotFoundError('This story has no start passage yet');
    const start = await this.storyDAL.findPassage(story.startPassageId);
    if (!start) throw new NotFoundError('This story has no start passage yet');
    return start;
  }

  /**
   * The story's commonality on publish (§ 6.2a). Every passage and choice label is split
   * into Han runs and segmented with the server gsa (the same `segmentWithDict` the
   * Reader title and Sentence Explain use); each DISTINCT word takes the HIGHEST
   * `frequencyScore` among its det rows (a word with several readings is as common as its
   * most common one); unscored words drop out; computeStoryCommonality applies the 90% rule.
   */
  private async computeCommonality(passages: StoryPassageRow[], language: string): Promise<number | null> {
    const texts = passages.flatMap((passage) => [passage.content, ...passage.choices.map((choice) => choice.label)]);
    const hanRuns = texts.flatMap((text) =>
      splitHanRuns(text).filter((run) => run.type === 'han').map((run) => run.value)
    );
    if (hanRuns.length === 0) return null;

    const candidates = [...new Set(hanRuns.flatMap((run) => getAllSubstrings(run)))];
    const entries = (await this.dictionaryDAL.findMultipleByWord1(candidates, language))
      .filter((entry) => [...entry.word1].length <= SEGMENTATION_MAX_TOKEN_CHARS);
    const dictMap = buildDictMap(entries);
    const excludeSet = buildExcludeSet(entries);

    const scoreByWord = new Map<string, number | null>();
    for (const entry of entries) {
      const score = typeof entry.frequencyScore === 'number' ? entry.frequencyScore : null;
      const prior = scoreByWord.get(entry.word1);
      if (prior === undefined || (score !== null && (prior === null || score > prior))) {
        scoreByWord.set(entry.word1, score);
      }
    }

    const distinctWords = new Set(hanRuns.flatMap((run) => segmentWithDict(run, dictMap, excludeSet)));
    return computeStoryCommonality([...distinctWords].map((word) => scoreByWord.get(word) ?? null));
  }

  /** Published, or the caller's own draft — otherwise "no longer available". */
  private async requireVisible(userId: string, storyId: string): Promise<StoryRow> {
    const story = isUuid(storyId) ? await this.storyDAL.findStory(storyId) : null;
    if (!story || (story.publishedAt === null && story.authorUserId !== userId)) {
      throw new NotFoundError(UNAVAILABLE);
    }
    return story;
  }

  private async requireAuthor(userId: string): Promise<void> {
    if (!(await this.storyDAL.isAuthor(userId))) {
      throw new ForbiddenError('Only author accounts can write stories');
    }
  }

  /** Both write checks: an author account, and the author of THIS story. */
  private async requireOwnStory(userId: string, storyId: string): Promise<StoryRow> {
    await this.requireAuthor(userId);
    const story = isUuid(storyId) ? await this.storyDAL.findStory(storyId) : null;
    if (!story) throw new NotFoundError('Story not found');
    if (story.authorUserId !== userId) throw new ForbiddenError('You can only edit your own stories');
    return story;
  }

  private async requirePassageOf(storyId: string, passageId: unknown): Promise<StoryPassageRow> {
    if (typeof passageId !== 'string' || !passageId) throw new ValidationError('passageId is required');
    const passage = isUuid(passageId) ? await this.storyDAL.findPassage(passageId) : null;
    if (!passage || passage.storyId !== storyId) throw new NotFoundError('Passage not found');
    return passage;
  }

  private editResponse(story: StoryRow, passages: StoryPassageRow[]): StoryEditResponse {
    return {
      story: {
        id: story.id,
        title: story.title,
        iconId: story.iconId,
        language: story.language,
        startPassageId: story.startPassageId,
        publishedAt: story.publishedAt,
        commonality: story.commonality,
        updatedAt: story.updatedAt,
      },
      passages: passages.map((passage) => this.toPassageEdit(passage)),
      warnings: storyPublishWarnings({ startPassageId: story.startPassageId, passages }),
    };
  }

  private toPassageEdit(passage: StoryPassageRow): StoryPassageEdit {
    return {
      id: passage.id,
      name: passage.name,
      content: passage.content,
      endingTitle: passage.endingTitle,
      choices: passage.choices,
      updatedAt: passage.updatedAt,
    };
  }

  /** Whether two timestamps (ISO strings or Dates) name the same instant. */
  private sameInstant(a: string | Date, b: string | Date): boolean {
    return new Date(a).getTime() === new Date(b).getTime();
  }

  /** One line, trimmed, non-empty, capped. */
  /**
   * The one-line form every author-written label takes (story title, passage name, ending
   * name, choice label): control characters stripped, whitespace runs (newlines included)
   * collapsed to one space, trimmed.
   */
  private flattenLabel(input: unknown): string {
    return sanitizeDocumentContent(input).replace(/\s+/g, ' ').trim();
  }

  private normalizeTitle(input: unknown): string {
    if (typeof input !== 'string') throw new ValidationError('Title is required');
    const title = this.flattenLabel(input);
    if (!title) throw new ValidationError('Title is required');
    if ([...title].length > STORY_TITLE_MAX_LENGTH) {
      throw new ValidationError(`Title is too long (maximum ${STORY_TITLE_MAX_LENGTH} characters)`);
    }
    return title;
  }

  /** Same rule as a Reader document's icon (TextService.validateIconId). */
  private normalizeIconId(input: unknown): string | null | undefined {
    if (input === undefined) return undefined;
    if (input === null) return null;
    if (typeof input !== 'string' || input.trim().length === 0 || input.length > 64) {
      throw new ValidationError('Invalid icon id');
    }
    return input;
  }

  /** Blank → null; one line; capped. */
  /**
   * A passage's organizing name (migration 197, docs/CYOA_FEATURE.md § 6.2d): same
   * normalization as a story title (control chars stripped, whitespace runs → one space,
   * trimmed), but OPTIONAL — omitted, null or blank = unnamed (NULL). The PUT replaces the
   * whole passage, so an omitted name clears it; the editor always sends its draft's.
   */
  /** "<name> (copy)", the name trimmed so the whole fits STORY_PASSAGE_NAME_MAX_LENGTH. */
  private copyName(name: string): string {
    const suffix = ' (copy)';
    return `${name.slice(0, STORY_PASSAGE_NAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
  }

  private normalizePassageName(input: unknown): string | null {
    if (input === undefined || input === null) return null;
    if (typeof input !== 'string') throw new ValidationError('Invalid passage name');
    const name = this.flattenLabel(input);
    if (!name) return null;
    if ([...name].length > STORY_PASSAGE_NAME_MAX_LENGTH) {
      throw new ValidationError(`Passage name is too long (maximum ${STORY_PASSAGE_NAME_MAX_LENGTH} characters)`);
    }
    return name;
  }

  private normalizeEndingTitle(input: unknown): string | null {
    if (input === undefined || input === null) return null;
    if (typeof input !== 'string') throw new ValidationError('Invalid ending name');
    const title = this.flattenLabel(input);
    if (!title) return null;
    if ([...title].length > STORY_ENDING_TITLE_MAX_LENGTH) {
      throw new ValidationError(`Ending name is too long (maximum ${STORY_ENDING_TITLE_MAX_LENGTH} characters)`);
    }
    return title;
  }

  /**
   * 0–4 choices with distinct positions 1–4, capped labels, and targets that are
   * passages of THIS story (or null while drafting). Returned sorted by position.
   */
  private normalizeChoices(
    input: unknown,
    storyPassageIds: Set<string>
  ): Array<{ position: number; label: string; targetPassageId: string | null }> {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) throw new ValidationError('choices must be an array');
    if (input.length > STORY_MAX_CHOICES) {
      throw new ValidationError(`A passage can have at most ${STORY_MAX_CHOICES} choices`);
    }
    const seen = new Set<number>();
    return input
      .map((raw) => {
        const position = Number(raw?.position);
        if (!Number.isInteger(position) || position < 1 || position > STORY_MAX_CHOICES || seen.has(position)) {
          throw new ValidationError('Choice positions must be distinct, 1–4');
        }
        seen.add(position);
        const label = this.flattenLabel(raw?.label);
        if ([...label].length > STORY_CHOICE_LABEL_MAX_LENGTH) {
          throw new ValidationError(`Choice text is too long (maximum ${STORY_CHOICE_LABEL_MAX_LENGTH} characters)`);
        }
        const target = raw?.targetPassageId ?? null;
        if (target !== null && (typeof target !== 'string' || !storyPassageIds.has(target))) {
          throw new ValidationError('A choice can only lead to a passage of the same story');
        }
        return { position, label, targetPassageId: target as string | null };
      })
      .sort((a, b) => a.position - b.position);
  }
}
