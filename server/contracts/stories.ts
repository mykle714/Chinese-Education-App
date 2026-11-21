/**
 * stories.ts — Adventures (cyoa) wire contract + pure rules, shared by both halves
 * (docs/CYOA_FEATURE.md).
 *
 * What lives here (pure, no I/O — the client imports this file directly, so there is
 * no hand-kept mirror to drift):
 *   • the wire types of every `/api/stories` response and request body;
 *   • input caps the server enforces and the editor should respect;
 *   • `computeStoryDifficulty` — the 90%-coverage HSK level rule (§ 6.2a);
 *   • `storyPublishWarnings` — the publish checks (§ 6.3), so the editor can show the
 *     same list live that Publish returns.
 *
 * Tables: migration 196 (stories, story_passages, story_choices, story_progress,
 * story_endings_found, users."isAuthor"); migration 197 (story_passages.name).
 *
 * Referenced by: server/dal/interfaces/IStoryDAL.ts, server/dal/implementations/StoryDAL.ts,
 * server/services/StoryService.ts, server/controllers/StoryController.ts,
 * server/__tests__/stories.test.ts.
 * Docs: docs/CYOA_FEATURE.md § 6 (data model) and § 6.3 (backend).
 */

// ── Caps ──────────────────────────────────────────────────────────────────────

/** Most choices a passage may offer (four full-width buttons, § 3.1). */
export const STORY_MAX_CHOICES = 4;
/** Longest passage body. Same ceiling as a Reader document (TextService). */
export const STORY_PASSAGE_MAX_LENGTH = 50_000;
/** Longest story title. */
export const STORY_TITLE_MAX_LENGTH = 200;
/** Longest choice label — a sentence, not a paragraph. */
export const STORY_CHOICE_LABEL_MAX_LENGTH = 300;
/** Longest passage name (the author's organizing label, § 6.2d). */
export const STORY_PASSAGE_NAME_MAX_LENGTH = 200;
/** Longest ending name. */
export const STORY_ENDING_TITLE_MAX_LENGTH = 200;
/** Most passages in one story — a bound on volume, not a product limit. */
export const STORY_MAX_PASSAGES = 500;
/** Share of a story's distinct leveled words its level must cover (§ 6.2a). */
export const STORY_DIFFICULTY_COVERAGE = 0.9;

// ── Learner wire types ────────────────────────────────────────────────────────

/** One card on the learner list (`GET /api/stories`), § 6.2a. */
export interface StoryListItem {
  id: string;
  title: string;
  iconId: string | null;
  /** HSK 1–6, computed on publish. Null for a never-published draft. */
  difficulty: number | null;
  authorName: string | null;
  /** Null = a draft (only ever returned to its own author). */
  publishedAt: string | null;
  /** True when the caller wrote it (an author sees their drafts in the list too). */
  isOwn: boolean;
  /** Endings the caller has reached, out of `endingsTotal` (§ 3.5). */
  endingsFound: number;
  /** Ending passages in the story right now (counted at read time). */
  endingsTotal: number;
  /** A `story_progress` row exists — the learner is mid-story. */
  inProgress: boolean;
}

export interface StoryListResponse {
  /** users."isAuthor" — the client shows the editor entry points when true. */
  isAuthor: boolean;
  stories: StoryListItem[];
}

/** A choice as the learner sees it. */
export interface StoryChoiceView {
  id: string;
  position: number;
  label: string;
  /** False when the choice has no target yet: shown disabled, "coming soon" (§ 6.3). */
  available: boolean;
}

/** The passage the learner is on. */
export interface StoryPassageView {
  id: string;
  content: string;
  /** Ordered by position. Empty = this passage is an ending. */
  choices: StoryChoiceView[];
}

/** Present when the passage just served is an ending (§ 3.6). */
export interface StoryEndingReached {
  /** The ending's author-written name; null if the author left it unnamed. */
  title: string | null;
  /** First time this learner reached it — the end screen's "New!" badge. */
  isNew: boolean;
}

/**
 * One passage as served to the learner: the passage, its ending/"to be continued"
 * state and the endings count. `StoryPlayResponse` is this plus the prefetched `next`.
 */
export interface StoryPlayStep {
  /** `language` = the story's text language (§ 6.2c) — what the reading engine reads it as. */
  story: { id: string; title: string; iconId: string | null; language: string; isOwn: boolean };
  passage: StoryPassageView;
  /** Non-null exactly when `passage` is an ending. Progress has been cleared. */
  ending: StoryEndingReached | null;
  /**
   * Every choice on a non-ending passage is disabled: "To be continued" (§ 3.6a).
   * Not an ending; progress stays on this passage.
   */
  toBeContinued: boolean;
  endingsFound: number;
  endingsTotal: number;
  /**
   * Distinct passages this learner has been served in the story, across every play
   * (this one included), out of `passagesTotal` — the end card's "Pages found x/y"
   * (§ 3.6b, migration 198). On a prefetched step it already counts the target.
   */
  passagesSeen: number;
  /** Passages in the story right now (counted at read time). */
  passagesTotal: number;
}

/**
 * `GET /api/stories/:id/play` and `POST /api/stories/:id/choose` — the passage to show,
 * the story's endings count for this learner, and the PREFETCHED outcome of every
 * available choice (§ 3.3: the page never waits on a pick).
 */
export interface StoryPlayResponse extends StoryPlayStep {
  /**
   * choiceId → the step that choice leads to, exactly as `/choose` would serve it right
   * now (an ending's `isNew` and the bumped `endingsFound` included). One level deep:
   * a step's own choices are prefetched by the `/choose` response that confirms it.
   * Unavailable choices have no entry. Empty on an ending.
   */
  next: Record<string, StoryPlayStep>;
}

export interface StoryChooseBody {
  choiceId: string;
}

// ── Author wire types ─────────────────────────────────────────────────────────

/** A choice as the editor sees it. */
export interface StoryChoiceEdit {
  id: string;
  position: number;
  label: string;
  targetPassageId: string | null;
}

/** A passage as the editor sees it. */
export interface StoryPassageEdit {
  id: string;
  /** The author's organizing label (§ 6.2d); null = unnamed → "Passage n". Author-only. */
  name: string | null;
  content: string;
  endingTitle: string | null;
  choices: StoryChoiceEdit[];
  updatedAt: string;
}

/** One publish check that failed (§ 6.3). Publish warns; it never blocks. */
export type StoryPublishWarning =
  | { kind: 'noStartPassage' }
  | { kind: 'noEnding' }
  | { kind: 'choiceWithoutTarget'; passageId: string; position: number }
  | { kind: 'unreachablePassage'; passageId: string }
  | { kind: 'unnamedEnding'; passageId: string };

/** `GET /api/stories/:id/edit` — the whole story graph for the editor. */
export interface StoryEditResponse {
  story: {
    id: string;
    title: string;
    iconId: string | null;
    language: string;
    startPassageId: string | null;
    publishedAt: string | null;
    difficulty: number | null;
    updatedAt: string;
  };
  /** In the author-set order (`story_passages.position`, migration 199; new passages last). */
  passages: StoryPassageEdit[];
  /** The publish checks, live — the same list Publish returns. */
  warnings: StoryPublishWarning[];
}

export interface StoryCreateBody {
  title: string;
  iconId?: string | null;
}

/** `PATCH /api/stories/:id` — any subset. */
export interface StoryUpdateBody {
  title?: string;
  iconId?: string | null;
  startPassageId?: string;
}

/** `PUT /api/stories/:id/passages/:passageId` — the whole passage, choices included. */
/**
 * PUT /api/stories/:id/passages/order — the story's passage ids in their new order. Must
 * be exactly the story's passages (a stale list → 400; the editor reloads). Answers with
 * the whole graph (StoryEditResponse). docs/CYOA_FEATURE.md § 5.3.
 */
export interface StoryPassageOrderBody {
  passageIds: string[];
}

export interface StoryPassageSaveBody {
  content: string;
  /** Blank or omitted = unnamed (stored NULL). Whitespace-collapsed, ≤ STORY_PASSAGE_NAME_MAX_LENGTH. */
  name?: string | null;
  endingTitle?: string | null;
  /** 0–4 rows; positions must be distinct, 1–4. Replaces the passage's choices. */
  choices: Array<{ position: number; label: string; targetPassageId: string | null }>;
  /**
   * The passage's `updatedAt` the draft was based on (optimistic concurrency). When sent and
   * the passage has been saved since — another tab or device — the save is refused with
   * 409. Omitted = overwrite whatever is there (the editor's "Save again" after a 409).
   */
  expectedUpdatedAt?: string;
}

/** `POST /api/stories/:id/publish` */
export interface StoryPublishResponse {
  publishedAt: string;
  difficulty: number | null;
  warnings: StoryPublishWarning[];
}

// ── Pure rules ────────────────────────────────────────────────────────────────

/**
 * A story's HSK level (§ 6.2a): the LOWEST level L such that at least 90% of the
 * story's distinct leveled words have a level ≤ L. Words with no level (names,
 * English, punctuation runs, words without a det `difficulty`) are left out, so a
 * story whose words are all unleveled gets null.
 *
 * `levels` holds one entry per DISTINCT word — the caller dedupes, so a word repeated
 * twenty times counts once.
 */
export function computeStoryDifficulty(
  levels: Array<number | null | undefined>,
  coverage: number = STORY_DIFFICULTY_COVERAGE
): number | null {
  const leveled = levels.filter(
    (level): level is number => typeof level === 'number' && level >= 1 && level <= 6
  );
  if (leveled.length === 0) return null;
  const needed = Math.ceil(leveled.length * coverage);
  const counts = [0, 0, 0, 0, 0, 0];
  for (const level of leveled) counts[Math.round(level) - 1]++;
  let covered = 0;
  for (let level = 1; level <= 6; level++) {
    covered += counts[level - 1];
    if (covered >= needed) return level;
  }
  return 6;
}

/** The minimum a graph needs for the publish checks. */
export interface StoryGraphShape {
  startPassageId: string | null;
  passages: Array<{
    id: string;
    endingTitle: string | null;
    choices: Array<{ position: number; targetPassageId: string | null }>;
  }>;
}

/**
 * The publish checks (§ 6.3), in a stable order: start passage set, at least one
 * ending, every choice has a target, every passage reachable from the start, every
 * ending named. Reachability is a BFS over the free graph (loops allowed).
 */
export function storyPublishWarnings(graph: StoryGraphShape): StoryPublishWarning[] {
  const warnings: StoryPublishWarning[] = [];
  const byId = new Map(graph.passages.map((passage) => [passage.id, passage]));
  const start = graph.startPassageId && byId.has(graph.startPassageId) ? graph.startPassageId : null;

  if (!start) warnings.push({ kind: 'noStartPassage' });

  const endings = graph.passages.filter((passage) => passage.choices.length === 0);
  if (endings.length === 0) warnings.push({ kind: 'noEnding' });

  for (const passage of graph.passages) {
    for (const choice of passage.choices) {
      if (!choice.targetPassageId || !byId.has(choice.targetPassageId)) {
        warnings.push({ kind: 'choiceWithoutTarget', passageId: passage.id, position: choice.position });
      }
    }
  }

  if (start) {
    const reached = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const passage = byId.get(queue.shift()!);
      for (const choice of passage?.choices ?? []) {
        const target = choice.targetPassageId;
        if (target && byId.has(target) && !reached.has(target)) {
          reached.add(target);
          queue.push(target);
        }
      }
    }
    for (const passage of graph.passages) {
      if (!reached.has(passage.id)) warnings.push({ kind: 'unreachablePassage', passageId: passage.id });
    }
  }

  for (const ending of endings) {
    if (!ending.endingTitle || !ending.endingTitle.trim()) {
      warnings.push({ kind: 'unnamedEnding', passageId: ending.id });
    }
  }

  return warnings;
}
