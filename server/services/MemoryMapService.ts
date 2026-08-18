import {
  IMemoryMapDAL,
  MemoryMapCandidateRow,
  MemoryMapPlacedRow,
} from '../dal/interfaces/IMemoryMapDAL.js';
import {
  MEMORY_MAP_CAPACITY,
  type MemoryMapGraduateResponse,
  type MemoryMapResponse,
  type MemoryMapWord,
} from '../contracts/wire.js';
import { rankCardQueue } from './cardQueueRanking.js';
import { spawnBatch, wordBoxSize, type MapBox, type Rng } from './memoryMapSpawn.js';
import { resolveDisplayDefinition, resolveDisplayPronunciation } from '../utils/definitions.js';
import { ValidationError } from '../types/dal.js';
import type { MarkType } from '../contracts/wire.js';

/**
 * Memory Map policy (docs/MEMORY_MAP_GAME.md § 9).
 *
 * LAYER: service. Orchestration only — it reads through the DAL, decides WHICH words
 * belong on the map and in what order, delegates WHERE they go to the pure geometry
 * module, and writes the result back. It contains no SQL and no coordinate maths.
 *
 * Two operations, and they are deliberately the whole API:
 *
 *   • `loadMap`   — the game's entry point. Top the map up to capacity and return it.
 *   • `graduate`  — a word was answered into reading mastery. Remove it, refill.
 *
 * There is no "save my run" operation because a run is not server state (§ 4): colours,
 * the prompt queue and the camera live in localStorage. The only thing a run sends the
 * server is its reading marks, through the ordinary mark endpoint.
 */
export class MemoryMapService {
  /**
   * The single track this game exercises. Memory Map is a reading drill: the learner
   * reads foreign script off the map to find an English gloss.
   */
  private static readonly MARK_TYPE: MarkType = 'reading';

  /**
   * The utcm ladder, best-first — the flp offering priority list (Q31).
   *
   * Reused rather than reinvented so the map is populated by the same judgement of
   * "what should this learner be working on now" as every other surface. Evaluated on
   * the READING track, not the core one: a map ordered by a track it does not teach
   * would put the learner's strongest reading words in front of their weakest
   * (docs/MEMORY_MAP_GAME.md § 13.1).
   *
   * 'Mastered' is absent BY CONSTRUCTION, not by omission: a reading-mastered card is
   * excluded from the candidate query in the first place (§ 2.1). Listing it would be
   * dead code that reads like a live rule.
   */
  private static readonly CATEGORY_LADDER = ['Target', 'Unfamiliar', 'Comfortable'] as const;

  constructor(
    private memoryMapDAL: IMemoryMapDAL,
    /**
     * Randomness source, injected so a test can pin every spawn. Defaults to
     * `Math.random` at the composition root. The geometry module takes the same
     * parameter for the same reason — see services/memoryMapSpawn.ts.
     */
    private rng: Rng = Math.random
  ) {}

  /**
   * The learner's map, topped up to capacity.
   *
   * Called once per game entry. Idempotent in the sense that matters: a map already at
   * capacity places nothing and returns an empty `newlyPlaced`, so re-entering the game
   * does not grow or churn it.
   */
  async loadMap(userId: string, language: string): Promise<MemoryMapResponse> {
    if (!userId) throw new ValidationError('userId is required');

    const existing = await this.memoryMapDAL.getPlacements(userId, language);
    const openSlots = MEMORY_MAP_CAPACITY - existing.length;

    // Already full (or over — see the note in `spawnInto`). Nothing to do.
    if (openSlots <= 0) {
      return {
        words: existing.map((row) => this.toWord(row)),
        newlyPlaced: [],
        capacity: MEMORY_MAP_CAPACITY,
      };
    }

    const placed = await this.spawnInto(userId, language, existing, openSlots);
    return {
      words: [...existing, ...placed].map((row) => this.toWord(row)),
      newlyPlaced: placed.map((row) => row.vocabEntryId),
      capacity: MEMORY_MAP_CAPACITY,
    };
  }

  /**
   * A word was answered and is now reading-mastered: retire it and refill its slot.
   *
   * The mastery test is re-read from the database rather than trusted from the client.
   * The client knows it just sent a positive mark, but not whether that mark was the
   * eighth — and a client that could assert "this word graduated" could delete any
   * placement it liked.
   *
   * `graduated: false` is a normal, common answer: the client calls this after every
   * correct answer, because it cannot know which one crosses the threshold.
   */
  async graduate(
    userId: string,
    language: string,
    vocabEntryId: number
  ): Promise<MemoryMapGraduateResponse> {
    if (!userId) throw new ValidationError('userId is required');
    if (!Number.isInteger(vocabEntryId)) {
      throw new ValidationError('vocabEntryId must be an integer');
    }

    const mastered = await this.memoryMapDAL.isReadingMastered(userId, language, vocabEntryId);
    if (!mastered) return { graduated: false, replacement: null };

    await this.memoryMapDAL.deletePlacement(userId, language, vocabEntryId);

    // Refill IMMEDIATELY, mid-run (Q32). The freed space is reusable, so the newcomer
    // may well land in the hole the graduate left.
    const existing = await this.memoryMapDAL.getPlacements(userId, language);
    const placed = await this.spawnInto(userId, language, existing, 1);

    return {
      graduated: true,
      replacement: placed.length > 0 ? this.toWord(placed[0]) : null,
    };
  }

  /**
   * Place up to `slots` new words onto a map that already holds `existing`.
   *
   * The three steps, in order, are the whole of the map's population policy:
   *   1. ask the DAL for every eligible-but-unplaced card;
   *   2. order them by the flp priority list, on the reading track;
   *   3. hand the top `slots` to the geometry module and persist what comes back.
   *
   * Returns the rows as persisted, hydrated for the wire.
   */
  private async spawnInto(
    userId: string,
    language: string,
    existing: MemoryMapPlacedRow[],
    slots: number
  ): Promise<MemoryMapPlacedRow[]> {
    const candidates = await this.memoryMapDAL.getUnplacedCandidates(userId, language);
    if (candidates.length === 0) return [];

    const chosen = this.prioritize(candidates, Date.now()).slice(0, slots);
    if (chosen.length === 0) return [];

    // The boxes already on the map, so newcomers tangent against them rather than each
    // other only. Sizes are recomputed from the stored scale by the SAME function the
    // client draws with, which is what keeps geometry and typography in agreement.
    const occupied: MapBox[] = existing.map((row) => ({
      x: row.x,
      y: row.y,
      ...wordBoxSize(row.entryKey, row.scale, row.language),
    }));

    const positions = spawnBatch(
      occupied,
      chosen.map((card) => ({ entryKey: card.entryKey, language: card.language })),
      this.rng
    );

    return this.memoryMapDAL.insertPlacements(
      userId,
      language,
      chosen.map((card, i) => ({ vocabEntryId: card.vocabEntryId, ...positions[i] }))
    );
  }

  /**
   * Candidate cards in offering order: the utcm ladder outermost, the longest-waiting
   * queue within each rung (Q31).
   *
   * WHY THE LADDER IS OUTERMOST. Ranking everything in one pass and letting arrival
   * times decide would fill a map with Comfortable words purely because they have been
   * resting the longest — which is exactly backwards for a learner. The ladder says
   * which mastery band the learner should be working in; the queue says which card
   * within that band has waited longest. Same two-level shape the flp uses.
   *
   * NOTE ON COOLDOWN. `rankCardQueue` DROPS cards that are still cooling down, so a map
   * short of capacity does not necessarily mean the learner is short of cards — it can
   * mean their remaining cards were all read correctly this morning. That is the right
   * behaviour (a word answered an hour ago is not worth drilling) and it is why the map
   * grows over days rather than all at once.
   */
  private prioritize(
    candidates: MemoryMapCandidateRow[],
    now: number
  ): MemoryMapCandidateRow[] {
    const ordered: MemoryMapCandidateRow[] = [];

    for (const rung of MemoryMapService.CATEGORY_LADDER) {
      const inRung = candidates.filter((card) => card.readingCategory === rung);
      const ranked = rankCardQueue(inRung, now, {
        markTypes: [MemoryMapService.MARK_TYPE],
        // The cooldown WINDOW comes from the same reading category the rung does —
        // one track in, one track out (docs/MASTERY_REWORK.md § Per-type cooldown).
        windowCategoryOf: (card) => card.readingCategory,
      });
      ordered.push(...ranked.map(({ card }) => card));
    }

    return ordered;
  }

  /**
   * A stored row as the client receives it.
   *
   * The one transformation that happens here is the dd: `resolveDisplayDefinition`
   * honours the learner's per-card `selectedSense`, so the prompt reads exactly what
   * their own flashcard reads. Showing a different sense's gloss makes the game look
   * like it does not know their word — the games-wide sense-correctness rule.
   */
  private toWord(row: MemoryMapPlacedRow): MemoryMapWord {
    return {
      vocabEntryId: row.vocabEntryId,
      x: row.x,
      y: row.y,
      scale: row.scale,
      entryKey: row.entryKey,
      language: row.language,
      // Sense-resolved, exactly like the definition beside it. A heteronym's reading
      // belongs to its SENSE, not to the word (过去 = `guò qù` "the past" vs `guò qu` the
      // directional suffix), so printing the entry-level column here would show one
      // sense's tones under another sense's gloss. That mattered little while the map
      // hid pinyin behind a spoiler; the prompt bar now shows it outright.
      pronunciation: resolveDisplayPronunciation({
        pronunciation: row.pronunciation,
        definitionClusters: row.definitionClusters as never,
        selectedSense: row.selectedSense,
      }),
      definition: resolveDisplayDefinition({
        definition: row.definition,
        definitionClusters: row.definitionClusters as never,
        selectedSense: row.selectedSense,
      }),
    };
  }
}
