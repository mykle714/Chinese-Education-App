import {
  IMemoryMapDAL,
  MemoryMapCandidateRow,
  MemoryMapSlotRow,
  NewSlot,
} from '../dal/interfaces/IMemoryMapDAL.js';
import {
  MEMORY_MAP_CAPACITY,
  type MemoryMapGraduateResponse,
  type MemoryMapResponse,
  type MemoryMapSlot,
  type MemoryMapWord,
} from '../contracts/wire.js';
import { rankCardQueue, rankCardQueueCooled } from './cardQueueRanking.js';
import { barForMarkType } from '../contracts/mastery.js';
import { planSlots, type Rng } from './memoryMapSpawn.js';
import type { LayoutSlot } from './memoryMapLayout.js';
import { resolveDisplayDefinition, resolveDisplayPronunciation, ddCollisionKey } from '../utils/definitions.js';
import { ValidationError } from '../types/dal.js';
import type { MarkType } from '../contracts/wire.js';
import type { ProvisionalCardService } from './ProvisionalCardService.js';

/**
 * The subset of ProvisionalCardService this service uses — narrowed so a test can hand
 * in a two-line fake instead of standing up the provisional DAL and StarterPacksService.
 */
export type MemoryMapLender = Pick<ProvisionalCardService, 'acquireLentCards'>;

/**
 * Memory Map policy (docs/MEMORY_MAP_GAME.md § 9).
 *
 * LAYER: service. Orchestration only — it reads through the DAL, decides WHICH words
 * occupy the map's slots and in what order, delegates WHERE new slots hang to the pure
 * spawn module, and writes the result back. No SQL, no geometry.
 *
 * Two operations, and they are deliberately the whole API:
 *
 *   • `loadMap`   — the game's entry point. Fill the map to MEMORY_MAP_CAPACITY and
 *                   return its slot tree plus occupants.
 *   • `graduate`  — a word was answered into reading mastery. A new word moves into its
 *                   slot.
 *
 * ── THE MAP IS ALWAYS FULL (2026-10-06) ──────────────────────────────────────
 * Every load fills empty slots and adds new ones until there are MEMORY_MAP_CAPACITY,
 * drawing occupants down a ladder that matches the game pools' (PROVISIONAL_CARDS.md
 * § 4b): the learner's RESTED cards in flp priority order → their COOLING cards,
 * nearest-to-ready first → LENT cards. Lending sits at the bottom, so a learner with a
 * real deck is re-served their own words early rather than handed strangers.
 *
 * There is no "save my run" operation because a run is not server state (§ 4).
 */
export class MemoryMapService {
  /** The single track this game exercises — a reading drill. */
  private static readonly MARK_TYPE: MarkType = 'reading';

  /**
   * The utcm ladder, best-first — the flp offering priority list (Q31), evaluated on the
   * READING track (§ 13.1). 'Mastered' is absent by construction: a reading-mastered
   * card is excluded from the candidate query (§ 2.1).
   */
  private static readonly CATEGORY_LADDER = ['Target', 'Unfamiliar', 'Comfortable'] as const;

  /** Lending rounds per fill — see `selectOccupants`. Bounded so a dd-heavy dictionary cannot loop. */
  private static readonly LEND_ROUNDS = 3;

  constructor(
    private memoryMapDAL: IMemoryMapDAL,
    private lender: MemoryMapLender,
    /**
     * Randomness source, injected so a test can pin every spawn. Defaults to
     * `Math.random` at the composition root.
     */
    private rng: Rng = Math.random
  ) {}

  /**
   * The learner's map, filled to capacity.
   *
   * Idempotent where it matters: a full map writes nothing and returns an empty
   * `newlyPlaced`, so re-entering the game does not churn it.
   */
  async loadMap(userId: string, language: string): Promise<MemoryMapResponse> {
    if (!userId) throw new ValidationError('userId is required');

    const slots = await this.memoryMapDAL.getSlots(userId, language);
    const emptySlots = slots.filter((slot) => slot.vocabEntryId === null);
    const need = emptySlots.length + Math.max(0, MEMORY_MAP_CAPACITY - slots.length);
    if (need === 0) return this.toResponse(slots, []);

    const chosen = await this.selectOccupants(userId, language, slots, need);
    if (chosen.length === 0) return this.toResponse(slots, []);

    // Empty slots first (oldest first): they are holes in an existing island, and a
    // filled hole is better than a new coastline. The rest become new slots.
    const fills = emptySlots
      .slice(0, chosen.length)
      .map((slot, i) => ({ slotId: slot.slotId, vocabEntryId: chosen[i].vocabEntryId }));
    const newcomers = chosen.slice(fills.length);

    // The tree the plan is computed against — with the fills applied, because a filled
    // slot is sized by its new occupant and the newcomers must clear THAT tile.
    const fillById = new Map(fills.map((fill, i) => [fill.slotId, chosen[i]]));
    const tree: LayoutSlot[] = slots.map((slot) => ({
      ...this.toLayoutSlot(slot),
      entryKey: fillById.get(slot.slotId)?.entryKey ?? slot.entryKey,
    }));

    const plan = planSlots(
      tree,
      newcomers.map((card) => ({ entryKey: card.entryKey, language: card.language })),
      this.rng
    );
    const inserts: NewSlot[] = plan.map((slot, i) => ({ ...slot, vocabEntryId: newcomers[i].vocabEntryId }));

    const written = await this.memoryMapDAL.writeSpawn(userId, language, slots.length, fills, inserts);

    // Re-read rather than splice: the fresh rows carry the real slot ids and the
    // joined occupant columns. If a concurrent load won the race (`written` false), this
    // simply serves the map IT wrote, and announces no growth of our own.
    const fresh = await this.memoryMapDAL.getSlots(userId, language);
    return this.toResponse(fresh, written ? chosen.map((card) => card.vocabEntryId) : []);
  }

  /**
   * A word was answered and is now reading-mastered: a new word moves into its slot.
   *
   * Mastery is re-read from the database rather than trusted from the client — the
   * client knows it sent a positive mark, not whether it was the one that crossed the
   * threshold, and a client that could assert graduation could evict any word.
   *
   * `graduated: false` is a normal, common answer: the client calls this after every
   * correct answer.
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

    // The graduate's own row is still in `slots` here, so the dd guard below treats it
    // as taken — harmless, since a reading-mastered card is never a candidate anyway.
    const slots = await this.memoryMapDAL.getSlots(userId, language);
    const [replacement] = await this.selectOccupants(userId, language, slots, 1);

    // Same slot, new occupant (owner-settled 2026-10-06). The slot keeps its bearing,
    // tilt, bow and scale, so nothing else on the map moves except as the new word's shape
    // pushes its own subtree. Null when nothing could be found or lent — the slot is
    // then empty, and the next load tries again.
    const slotId = await this.memoryMapDAL.replaceOccupant(
      userId,
      language,
      vocabEntryId,
      replacement?.vocabEntryId ?? null
    );
    if (slotId === null || !replacement) return { graduated: true, replacement: null };

    const row = (await this.memoryMapDAL.getSlots(userId, language)).find((slot) => slot.slotId === slotId);
    return { graduated: true, replacement: row ? this.toWord(row) : null };
  }

  /**
   * Choose up to `count` new occupants for a map that currently holds `slots`.
   *
   * The ladder (see the class docblock): rested → cooling → lent. Each tier is ordered
   * by the utcm ladder outermost and the card queue within each rung, and every pick
   * passes the "two words never read the same" guard against the words already on the
   * map and those picked before it.
   *
   * Lending fires only for what the learner's own cards could not cover, and only
   * names the rows it lent (`lentIds`) — the candidate read is otherwise sorted-only.
   */
  private async selectOccupants(
    userId: string,
    language: string,
    slots: MemoryMapSlotRow[],
    count: number
  ): Promise<MemoryMapCandidateRow[]> {
    // TWO WORDS ON ONE MAP NEVER READ THE SAME (2026-08-22). The prompt names a
    // definition and asks for the word that means it; two words glossed "happy" would
    // give it two right-looking answers. Sharpest here because a slot is DURABLE.
    const takenDds = new Set<string>();
    for (const slot of slots) {
      if (slot.vocabEntryId === null) continue;
      const key = this.ddKey(slot);
      if (key) takenDds.add(key);
    }

    const chosen: MemoryMapCandidateRow[] = [];
    const take = (ordered: MemoryMapCandidateRow[]) => {
      for (const card of ordered) {
        if (chosen.length >= count) return;
        const key = this.ddKey(card);
        if (key && takenDds.has(key)) continue;
        if (key) takenDds.add(key);
        chosen.push(card);
      }
    };

    const candidates = await this.memoryMapDAL.getUnplacedCandidates(userId, language);
    const now = Date.now();
    take(this.prioritize(candidates, now, 'rested'));
    take(this.prioritize(candidates, now, 'cooling'));
    if (chosen.length >= count) return chosen;

    // ── LEND THE REST ────────────────────────────────────────────────────────
    // Excluding every card already on the map (a lent row placed by an earlier load is
    // still "held" and would otherwise be re-lent onto a second slot) and every
    // candidate we just saw (it is already in the ladder above).
    //
    // In up to LEND_ROUNDS rounds: a lent word can still lose the dd guard (it reads the
    // same as a word already on the map), and each round re-asks for exactly the slots
    // still open, excluding every row already tried — so the map ends full instead of
    // one or two short, without minting more than it places.
    const excludeIds = [
      ...slots.map((slot) => slot.vocabEntryId).filter((id): id is number => id !== null),
      ...candidates.map((card) => card.vocabEntryId),
    ];
    for (let round = 0; round < MemoryMapService.LEND_ROUNDS && chosen.length < count; round++) {
      const { lentIds } = await this.lender.acquireLentCards(userId, language, count - chosen.length, 'default', {
        excludeIds,
      });
      if (lentIds.length === 0) break; // the dictionary has nothing left to lend
      excludeIds.push(...lentIds);

      const lentSet = new Set(lentIds);
      const lent = (await this.memoryMapDAL.getUnplacedCandidates(userId, language, lentIds)).filter(
        (card) => lentSet.has(card.vocabEntryId)
      );
      // No cooldown gate for lent cards: they are here to fill the map, and a freshly
      // minted row has no marks to be cooling on anyway. Lend order is preserved.
      lent.sort((a, b) => lentIds.indexOf(a.vocabEntryId) - lentIds.indexOf(b.vocabEntryId));
      take(lent);
    }
    return chosen;
  }

  /**
   * Candidate cards in offering order for one tier: the utcm ladder outermost, then the
   * queue within each rung (Q31).
   *
   * WHY THE LADDER IS OUTERMOST. Ranking everything in one pass would fill a map with
   * Comfortable words purely because they have rested the longest — backwards for a
   * learner. Same two-level shape the flp uses.
   *
   * `rested` = off cooldown, longest-waiting first (`rankCardQueue`); `cooling` = still
   * on cooldown, nearest-to-ready first (`rankCardQueueCooled`). Marks fired at a
   * cooling card are dropped by the mark endpoint's guard — the accepted trade for
   * re-serving the learner's own words instead of lending strangers (§ 4b).
   */
  private prioritize(
    candidates: MemoryMapCandidateRow[],
    now: number,
    tier: 'rested' | 'cooling'
  ): MemoryMapCandidateRow[] {
    const bar = barForMarkType(MemoryMapService.MARK_TYPE);
    const ordered: MemoryMapCandidateRow[] = [];

    for (const rung of MemoryMapService.CATEGORY_LADDER) {
      const inRung = candidates.filter((card) => card.readingCategory === rung);
      if (tier === 'rested') ordered.push(...rankCardQueue(inRung, now, { bar }).map(({ card }) => card));
      else ordered.push(...rankCardQueueCooled(inRung, now, { bar }));
    }
    return ordered;
  }

  private ddKey(row: { definition?: string | null; definitionClusters?: unknown; selectedSense?: string | null }) {
    return ddCollisionKey({
      definition: row.definition ?? null,
      definitionClusters: row.definitionClusters as never,
      selectedSense: row.selectedSense ?? null,
    });
  }

  private toLayoutSlot(row: MemoryMapSlotRow): LayoutSlot {
    return {
      slotId: row.slotId,
      parentSlotId: row.parentSlotId,
      link: row.link,
      angle: row.angle,
      tilt: row.tilt,
      bow: row.bow,
      scale: row.scale,
      entryKey: row.entryKey,
      language: row.language,
    };
  }

  private toResponse(rows: MemoryMapSlotRow[], newlyPlaced: number[]): MemoryMapResponse {
    const slots: MemoryMapSlot[] = rows.map((row) => ({
      slotId: row.slotId,
      parentSlotId: row.parentSlotId,
      link: row.link,
      angle: row.angle,
      tilt: row.tilt,
      bow: row.bow,
      scale: row.scale,
      vocabEntryId: row.vocabEntryId,
    }));
    const words = rows.filter((row) => row.vocabEntryId !== null).map((row) => this.toWord(row));
    return { slots, words, newlyPlaced, capacity: MEMORY_MAP_CAPACITY };
  }

  /**
   * An occupied slot's word as the client receives it. The dd and pronunciation are
   * resolved through the learner's `selectedSense`, so the prompt reads exactly what
   * their own flashcard reads (the games-wide sense-correctness rule) — and a
   * heteronym's reading belongs to its SENSE, not to the word (过去 `guò qù` vs `guò qu`).
   */
  private toWord(row: MemoryMapSlotRow): MemoryMapWord {
    return {
      vocabEntryId: row.vocabEntryId as number,
      slotId: row.slotId,
      entryKey: row.entryKey ?? '',
      language: row.language,
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
