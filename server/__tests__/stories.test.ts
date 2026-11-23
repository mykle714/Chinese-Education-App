import { describe, expect, it, beforeEach } from 'vitest';
import { StoryService } from '../services/StoryService.js';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../types/dal.js';
import type { IStoryDAL, StoryRow, StoryPassageRow } from '../dal/interfaces/IStoryDAL.js';
import type { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';
import { computeStoryCommonality, storyPublishWarnings } from '../contracts/stories.js';

/**
 * Tests for Adventures (cyoa) — docs/CYOA_FEATURE.md.
 *
 *   • the pure rules in server/contracts/stories.ts (90%-coverage commonality, publish
 *     warnings incl. reachability over a free graph with loops);
 *   • StoryService policy against an IN-MEMORY IStoryDAL that mimics migration 196's
 *     semantics (ending = no choices, ON CONFLICT DO NOTHING for endings found,
 *     progress upsert/delete). No DB: the rules live entirely in the service.
 */

const AUTHOR = '11111111-1111-4111-8111-111111111111';
const LEARNER = '22222222-2222-4222-8222-222222222222';
const OTHER_AUTHOR = '33333333-3333-4333-8333-333333333333';

let seq = 0;
/** A fresh valid uuid (the service refuses non-uuids before querying). */
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

/** In-memory stand-in for StoryDAL. */
function makeMemoryDAL() {
  const authors = new Set([AUTHOR, OTHER_AUTHOR]);
  const stories = new Map<string, StoryRow>();
  const passages = new Map<string, StoryPassageRow>();
  const progress = new Map<string, string>(); // `${user}|${story}` → passageId
  const found = new Map<string, string>(); // `${user}|${passage}` → storyId
  const seen = new Map<string, string>(); // `${user}|${passage}` → storyId
  const positions = new Map<string, number>(); // passageId → position (migration 199)
  const ofStory = (storyId: string) =>
    [...passages.values()].filter((p) => p.storyId === storyId).sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
  const now = () => new Date().toISOString();

  const dal: IStoryDAL = {
    isAuthor: async (userId) => authors.has(userId),
    listForViewer: async () => [],
    findStory: async (id) => stories.get(id) ?? null,
    findPassage: async (id) => passages.get(id) ?? null,
    listPassages: async (storyId) => ofStory(storyId),
    reorderPassages: async (_storyId, ids) => ids.forEach((id, i) => positions.set(id, i + 1)),
    duplicatePassage: async (storyId, sourceId, name) => {
      const source = passages.get(sourceId)!;
      const at = positions.get(sourceId)!;
      for (const p of ofStory(storyId)) if (positions.get(p.id)! > at) positions.set(p.id, positions.get(p.id)! + 1);
      const copyId = uuid();
      passages.set(copyId, {
        ...source, id: copyId, name, createdAt: now(), updatedAt: now(),
        choices: source.choices.map((c) => ({ ...c, id: uuid(), targetPassageId: c.targetPassageId === sourceId ? copyId : c.targetPassageId })),
      });
      positions.set(copyId, at + 1);
      return copyId;
    },
    countPassages: async (storyId) => [...passages.values()].filter((p) => p.storyId === storyId).length,
    countEndings: async (storyId) =>
      [...passages.values()].filter((p) => p.storyId === storyId && p.choices.length === 0).length,
    listEndingsFound: async (userId, storyId) =>
      [...found.entries()]
        .filter(([key, s]) => key.startsWith(`${userId}|`) && s === storyId)
        .map(([key]) => key.slice(userId.length + 1)),
    findChoice: async (choiceId) => {
      for (const passage of passages.values()) {
        const choice = passage.choices.find((c) => c.id === choiceId);
        if (choice) {
          return { id: choice.id, passageId: passage.id, targetPassageId: choice.targetPassageId, storyId: passage.storyId };
        }
      }
      return null;
    },
    getProgress: async (userId, storyId) => progress.get(`${userId}|${storyId}`) ?? null,
    setProgress: async (userId, storyId, passageId) => void progress.set(`${userId}|${storyId}`, passageId),
    clearProgress: async (userId, storyId) => void progress.delete(`${userId}|${storyId}`),
    recordEndingFound: async (userId, storyId, passageId) => {
      const key = `${userId}|${passageId}`;
      if (found.has(key)) return false;
      found.set(key, storyId);
      return true;
    },
    recordPassageSeen: async (userId, storyId, passageId) => void seen.set(`${userId}|${passageId}`, storyId),
    listPassagesSeen: async (userId, storyId) =>
      [...seen.entries()]
        .filter(([key, s]) => key.startsWith(`${userId}|`) && s === storyId)
        .map(([key]) => key.slice(userId.length + 1)),
    createStory: async ({ authorUserId, language, title, iconId }) => {
      const row: StoryRow = {
        id: uuid(), language, title, iconId, authorUserId, startPassageId: null,
        publishedAt: null, commonality: null, createdAt: now(), updatedAt: now(),
      };
      stories.set(row.id, row);
      return row;
    },
    updateStory: async (id, fields) => {
      const row = stories.get(id);
      if (!row) return null;
      Object.assign(row, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
      return row;
    },
    deleteStory: async (id) => stories.delete(id),
    createPassage: async (storyId, content) => {
      const row: StoryPassageRow = {
        id: uuid(), storyId, name: null, content, endingTitle: null, choices: [], createdAt: now(), updatedAt: now(),
      };
      positions.set(row.id, Math.max(0, ...ofStory(storyId).map((p) => positions.get(p.id)!)) + 1);
      passages.set(row.id, row);
      return row;
    },
    savePassage: async (passageId, data) => {
      const row = passages.get(passageId)!;
      row.name = data.name;
      row.content = data.content;
      row.endingTitle = data.endingTitle;
      row.choices = data.choices.map((c) => ({ id: uuid(), ...c }));
      // Strictly later than before, as the real DAL's now() would be.
      row.updatedAt = new Date(new Date(row.updatedAt).getTime() + 1000).toISOString();
    },
    deletePassage: async (passageId) => {
      // Mimic the FK actions: incoming choices SET NULL, progress on it CASCADE.
      for (const passage of passages.values()) {
        for (const choice of passage.choices) if (choice.targetPassageId === passageId) choice.targetPassageId = null;
      }
      for (const [key, value] of progress) if (value === passageId) progress.delete(key);
      return passages.delete(passageId);
    },
    publish: async (id, commonality) => {
      const row = stories.get(id)!;
      row.publishedAt = now();
      row.commonality = commonality;
      return row.publishedAt;
    },
    setCommonality: async (id, commonality) => {
      stories.get(id)!.commonality = commonality;
    },
    listPublishedStoryIds: async () =>
      [...stories.values()].filter((row) => row.publishedAt !== null).map((row) => row.id),
    unpublish: async (id) => {
      stories.get(id)!.publishedAt = null;
      return true;
    },
  };
  return { dal, stories, passages, progress };
}

/** A transaction runner that just hands the operation a dummy client. */
const fakeTx = { executeInTransaction: async (op: any) => op({ getClient: () => ({}) }) } as any;

/** Dictionary stub: maps word → frequencyScore (commonality, 5 = everyday). */
function makeDictionaryDAL(scores: Record<string, number | null>): IDictionaryDAL {
  return {
    findMultipleByWord1: async (words: string[]) =>
      words.filter((w) => w in scores).map((w) => ({ word1: w, difficulty: 3, frequencyScore: scores[w] })),
  } as unknown as IDictionaryDAL;
}

// ── Pure rules ──────────────────────────────────────────────────────────────

describe('computeStoryCommonality', () => {
  it('returns the highest commonality that 90% of distinct scored words reach', () => {
    // 9 everyday (5) words + 1 rare (1): 90% are at least 5.
    expect(computeStoryCommonality([5, 5, 5, 5, 5, 5, 5, 5, 5, 1])).toBe(5);
    // 8 everyday + 2 rare: only 80% reach 5, so it drops to 1.
    expect(computeStoryCommonality([5, 5, 5, 5, 5, 5, 5, 5, 1, 1])).toBe(1);
    expect(computeStoryCommonality([4, 4, 3, 3, 3, 3, 3, 3, 3, 2])).toBe(3);
  });

  it('ignores unscored words and returns null when none are scored', () => {
    expect(computeStoryCommonality([null, undefined, 4])).toBe(4);
    expect(computeStoryCommonality([null, null])).toBeNull();
    expect(computeStoryCommonality([])).toBeNull();
  });
});

describe('storyPublishWarnings', () => {
  it('passes a well-formed graph with a loop', () => {
    const graph = {
      startPassageId: 'a',
      passages: [
        { id: 'a', endingTitle: null, choices: [{ position: 1, targetPassageId: 'b' }, { position: 2, targetPassageId: 'c' }] },
        { id: 'b', endingTitle: null, choices: [{ position: 1, targetPassageId: 'a' }] }, // loops back
        { id: 'c', endingTitle: 'The end', choices: [] },
      ],
    };
    expect(storyPublishWarnings(graph)).toEqual([]);
  });

  it('reports every failed check', () => {
    const graph = {
      startPassageId: 'a',
      passages: [
        { id: 'a', endingTitle: null, choices: [{ position: 1, targetPassageId: null }] },
        { id: 'orphan', endingTitle: '  ', choices: [] },
      ],
    };
    expect(storyPublishWarnings(graph)).toEqual([
      { kind: 'choiceWithoutTarget', passageId: 'a', position: 1 },
      { kind: 'unreachablePassage', passageId: 'orphan' },
      { kind: 'unnamedEnding', passageId: 'orphan' },
    ]);
    expect(storyPublishWarnings({ startPassageId: null, passages: [] })).toEqual([
      { kind: 'noStartPassage' },
      { kind: 'noEnding' },
    ]);
  });
});

// ── StoryService ────────────────────────────────────────────────────────────

describe('StoryService', () => {
  let mem: ReturnType<typeof makeMemoryDAL>;
  let service: StoryService;

  beforeEach(() => {
    mem = makeMemoryDAL();
    service = new StoryService(mem.dal, makeDictionaryDAL({ 我: 5, 你: 5, 好: 5, 去: 5, 森林: 2 }), fakeTx);
  });

  /** Start → (choice 1) forest ending, (choice 2) unwritten. Returns ids. */
  async function buildStory() {
    const created = await service.create(AUTHOR, { title: '  The   Forest ' });
    const storyId = created.story.id;
    const startId = created.story.startPassageId!;
    const forest = await service.createPassage(AUTHOR, storyId);
    await service.savePassage(AUTHOR, storyId, forest.id, { content: '森林', endingTitle: 'Lost', choices: [] });
    const start = await service.savePassage(AUTHOR, storyId, startId, {
      content: '你好',
      choices: [
        { position: 1, label: '去', targetPassageId: forest.id },
        { position: 2, label: '我', targetPassageId: null },
      ],
    });
    return { storyId, startId, forestId: forest.id, start };
  }

  it('creates a story with a normalized title and an empty start passage', async () => {
    const created = await service.create(AUTHOR, { title: '  The   Forest ' });
    expect(created.story.title).toBe('The Forest');
    expect(created.passages).toHaveLength(1);
    expect(created.story.startPassageId).toBe(created.passages[0].id);
  });

  it('saves a passage name normalized, stores blank as unnamed, and never serves it to learners', async () => {
    const { storyId, forestId } = await buildStory();
    const named = await service.savePassage(AUTHOR, storyId, forestId, {
      name: '  Lost \n in the   woods ', content: '森林', endingTitle: 'Lost', choices: [],
    });
    expect(named.name).toBe('Lost in the woods');

    // The PUT replaces the whole passage: a blank (or omitted) name clears it.
    const cleared = await service.savePassage(AUTHOR, storyId, forestId, { name: '   ', content: '森林', choices: [] });
    expect(cleared.name).toBeNull();

    await expect(service.savePassage(AUTHOR, storyId, forestId, {
      name: 'x'.repeat(201), content: '森林', choices: [],
    })).rejects.toBeInstanceOf(ValidationError);

    // Author-only: the learner wire carries no name.
    await service.savePassage(AUTHOR, storyId, forestId, { name: 'Woods', content: '森林', endingTitle: 'Lost', choices: [] });
    await service.publish(AUTHOR, storyId);
    const opening = await service.play(LEARNER, storyId);
    for (const step of Object.values(opening.next)) expect(step.passage).not.toHaveProperty('name');
  });

  it('refuses writes from non-authors and from other authors', async () => {
    await expect(service.create(LEARNER, { title: 'x' })).rejects.toBeInstanceOf(ForbiddenError);
    const { storyId } = await buildStory();
    await expect(service.publish(OTHER_AUTHOR, storyId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.getForEdit(LEARNER, storyId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('hides drafts from learners as "no longer available", but not from their author', async () => {
    const { storyId } = await buildStory();
    await expect(service.play(LEARNER, storyId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.play(LEARNER, 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundError);
    const own = await service.play(AUTHOR, storyId);
    expect(own.story.isOwn).toBe(true);
  });

  it('plays to an ending: records it once, clears progress, ticks the count', async () => {
    const { storyId, start } = await buildStory();
    await service.publish(AUTHOR, storyId);

    const opening = await service.play(LEARNER, storyId);
    expect(opening.passage.choices.map((c) => c.available)).toEqual([true, false]);
    expect(opening.toBeContinued).toBe(false);
    expect([opening.endingsFound, opening.endingsTotal]).toEqual([0, 1]);
    expect([opening.passagesSeen, opening.passagesTotal]).toEqual([1, 2]); // the start, served

    const end = await service.choose(LEARNER, storyId, start.choices[0].id);
    expect(end.ending).toEqual({ title: 'Lost', isNew: true });
    expect([end.endingsFound, end.endingsTotal]).toEqual([1, 1]);
    expect([end.passagesSeen, end.passagesTotal]).toEqual([2, 2]);
    expect(await mem.dal.getProgress(LEARNER, storyId)).toBeNull();

    // Back at the start (progress cleared); the repeat ending is not new and does not tick.
    const again = await service.choose(LEARNER, storyId, start.choices[0].id);
    expect(again.ending).toEqual({ title: 'Lost', isNew: false });
    expect(again.endingsFound).toBe(1);
    expect(again.passagesSeen).toBe(2); // pages found persist across plays; revisits don't count
  });

  it('prefetches every available choice exactly as /choose would serve it', async () => {
    const { storyId, start, forestId } = await buildStory();
    await service.publish(AUTHOR, storyId);

    const opening = await service.play(LEARNER, storyId);
    // Only the available choice is prefetched; the targetless one has no entry.
    expect(Object.keys(opening.next)).toEqual([start.choices[0].id]);
    const predicted = opening.next[start.choices[0].id];
    expect(predicted.passage.id).toBe(forestId);
    expect(predicted.ending).toEqual({ title: 'Lost', isNew: true });
    expect([predicted.endingsFound, predicted.endingsTotal]).toEqual([1, 1]);
    expect(predicted.passagesSeen).toBe(2); // predicts the not-yet-seen target

    // The confirmed step matches the prediction (minus its own `next`, empty on an ending).
    const { next, ...confirmed } = await service.choose(LEARNER, storyId, start.choices[0].id);
    expect(confirmed).toEqual(predicted);
    expect(next).toEqual({});

    // Second time round, the prefetched ending is predicted as a repeat: no badge, no tick.
    const reopened = await service.play(LEARNER, storyId);
    expect(reopened.next[start.choices[0].id].ending).toEqual({ title: 'Lost', isNew: false });
    expect(reopened.next[start.choices[0].id].endingsFound).toBe(1);
  });

  it('refuses a targetless choice and a choice off the current passage', async () => {
    const { storyId, start, forestId } = await buildStory();
    await service.publish(AUTHOR, storyId);
    await expect(service.choose(LEARNER, storyId, start.choices[1].id)).rejects.toBeInstanceOf(ValidationError);

    // Put the learner on a middle passage, then try a start-passage choice.
    const middle = await service.createPassage(AUTHOR, storyId);
    await service.savePassage(AUTHOR, storyId, middle.id, {
      content: '我', choices: [{ position: 1, label: '去', targetPassageId: forestId }],
    });
    await mem.dal.setProgress(LEARNER, storyId, middle.id);
    await expect(service.choose(LEARNER, storyId, start.choices[0].id)).rejects.toBeInstanceOf(ValidationError);
  });

  it('flags "To be continued" when every choice is targetless, and keeps progress there', async () => {
    const { storyId, startId } = await buildStory();
    const cliff = await service.createPassage(AUTHOR, storyId);
    await service.savePassage(AUTHOR, storyId, cliff.id, {
      content: '我', choices: [{ position: 1, label: '?', targetPassageId: null }],
    });
    const start = await service.savePassage(AUTHOR, storyId, startId, {
      content: '你好', choices: [{ position: 1, label: '去', targetPassageId: cliff.id }],
    });
    await service.publish(AUTHOR, storyId);
    const result = await service.choose(LEARNER, storyId, start.choices[0].id);
    expect(result.toBeContinued).toBe(true);
    expect(result.ending).toBeNull();
    expect(await mem.dal.getProgress(LEARNER, storyId)).toBe(cliff.id);
  });

  it('validates choices: max four, distinct positions, same-story targets', async () => {
    const { storyId, startId } = await buildStory();
    const other = await service.create(AUTHOR, { title: 'Other' });
    const foreign = other.story.startPassageId;
    const five = [1, 2, 3, 4, 5].map((position) => ({ position, label: 'x', targetPassageId: null }));
    await expect(service.savePassage(AUTHOR, storyId, startId, { content: '', choices: five }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(service.savePassage(AUTHOR, storyId, startId, {
      content: '', choices: [{ position: 1, label: 'a', targetPassageId: null }, { position: 1, label: 'b', targetPassageId: null }],
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.savePassage(AUTHOR, storyId, startId, {
      content: '', choices: [{ position: 1, label: 'a', targetPassageId: foreign }],
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a save based on an older version (two tabs), and overwrites when none is sent', async () => {
    const { storyId, startId, start } = await buildStory();
    // Tab A saves on top of the version it opened.
    const tabA = await service.savePassage(AUTHOR, storyId, startId, {
      content: 'A', choices: [], expectedUpdatedAt: start.updatedAt,
    });
    // Tab B still holds that same (now old) version.
    await expect(service.savePassage(AUTHOR, storyId, startId, {
      content: 'B', choices: [], expectedUpdatedAt: start.updatedAt,
    })).rejects.toBeInstanceOf(ConflictError);
    expect((await service.getForEdit(AUTHOR, storyId)).passages.find((p) => p.id === startId)?.content).toBe('A');
    // "Save again" omits the version: B wins.
    const forced = await service.savePassage(AUTHOR, storyId, startId, { content: 'B', choices: [] });
    expect(forced.content).toBe('B');
    expect(forced.updatedAt).not.toBe(tabA.updatedAt);
  });

  it('reorders passages, refusing a list that is not exactly the story\'s passages', async () => {
    const { storyId, start, forestId } = await buildStory();
    const third = await service.createPassage(AUTHOR, storyId);
    const reordered = await service.reorderPassages(AUTHOR, storyId, [third.id, start.id, forestId]);
    expect(reordered.passages.map((p) => p.id)).toEqual([third.id, start.id, forestId]);
    // A stale list (missing one), a duplicate, a foreign id, a non-array: all refused.
    for (const bad of [[third.id, start.id], [third.id, third.id, start.id], [third.id, start.id, uuid()], 'x']) {
      await expect(service.reorderPassages(AUTHOR, storyId, bad)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(service.reorderPassages(OTHER_AUTHOR, storyId, [start.id, forestId, third.id])).rejects.toBeInstanceOf(ForbiddenError);
    // A new passage still goes to the end.
    const fourth = await service.createPassage(AUTHOR, storyId);
    expect((await service.getForEdit(AUTHOR, storyId)).passages.at(-1)?.id).toBe(fourth.id);
  });

  it('duplicates a passage right after it: copy name, same body and targets, loops onto the copy', async () => {
    const { storyId, startId, forestId } = await buildStory();
    await service.savePassage(AUTHOR, storyId, startId, {
      name: 'Gate', content: '你好',
      choices: [{ position: 1, label: '去', targetPassageId: forestId }, { position: 2, label: '我', targetPassageId: startId }],
    });
    const edit = await service.duplicatePassage(AUTHOR, storyId, startId);
    expect(edit.passages).toHaveLength(3);
    const [original, copy, forest] = edit.passages;
    expect([original.id, forest.id]).toEqual([startId, forestId]);
    expect(copy).toMatchObject({ name: 'Gate (copy)', content: '你好' });
    expect(copy.choices.map((c) => c.targetPassageId)).toEqual([forestId, copy.id]);
    expect(edit.story.startPassageId).toBe(startId);
    // An unnamed passage's copy stays unnamed; a long name is trimmed to fit.
    expect((await service.duplicatePassage(AUTHOR, storyId, forestId)).passages[3].name).toBeNull();
    await service.savePassage(AUTHOR, storyId, forestId, { name: 'x'.repeat(200), content: '森林', endingTitle: 'Lost', choices: [] });
    const long = await service.duplicatePassage(AUTHOR, storyId, forestId);
    expect(long.passages[3].name).toBe(`${'x'.repeat(193)} (copy)`);
    await expect(service.duplicatePassage(OTHER_AUTHOR, storyId, forestId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses to delete the start passage; deleting another makes its incoming choices targetless', async () => {
    const { storyId, startId, forestId } = await buildStory();
    await expect(service.deletePassage(AUTHOR, storyId, startId)).rejects.toBeInstanceOf(ValidationError);
    await service.deletePassage(AUTHOR, storyId, forestId);
    const edit = await service.getForEdit(AUTHOR, storyId);
    expect(edit.passages[0].choices[0].targetPassageId).toBeNull();
    expect(edit.warnings.map((w) => w.kind)).toContain('noEnding');
  });

  it('publish computes commonality from distinct words and returns warnings without blocking', async () => {
    const { storyId } = await buildStory();
    const result = await service.publish(AUTHOR, storyId);
    // Distinct words: 你 好 去 我 (5) + 森林 (2) → only 4/5 = 80% reach 5, so 2.
    expect(result.commonality).toBe(2);
    expect(result.warnings).toEqual([{ kind: 'choiceWithoutTarget', passageId: expect.any(String), position: 2 }]);
    expect(result.publishedAt).toBeTruthy();
  });

  it('recomputeCommonality updates the value without re-publishing', async () => {
    const { storyId } = await buildStory();
    await service.publish(AUTHOR, storyId);
    const row = mem.stories.get(storyId)!;
    const publishedAt = row.publishedAt;
    row.commonality = null;
    expect(await service.recomputeCommonality(storyId)).toBe(2);
    expect(row.commonality).toBe(2);
    expect(row.publishedAt).toBe(publishedAt);
  });
});
