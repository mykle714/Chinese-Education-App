import { ProvisionalCardDAL } from '../dal/implementations/ProvisionalCardDAL.js';
import { StarterPacksService } from './StarterPacksService.js';
import { ValidationError } from '../types/dal.js';
import { CardBaselineSurface, CARD_BASELINES } from '../contracts/wire.js';
import type { ProvisionMode } from '../contracts/wire.js';
import { DiscoverCard } from '../types/index.js';

/**
 * Provisional cards — the baseline top-up (docs/PROVISIONAL_CARDS.md).
 *
 * LAYER: Service. Owns the POLICY; ProvisionalCardDAL owns the SQL.
 *
 * THE RULE THIS SERVICE EXISTS TO ENFORCE
 * ---------------------------------------
 * No game and no flashcards learn page may ever refuse to start because the user
 * does not have enough cards. Every surface's old "you need N cards" minimum is now
 * a BASELINE (`CARD_BASELINES` in contracts/wire.ts): the number of playable cards
 * the surface wants. When the user is short, the server LENDS them the difference as
 * provisional vet rows instead of blocking.
 *
 * WHICH WORDS GET LENT
 *   - never a word the user already holds (deck or already-lent);
 *   - never a word they explicitly skipped in discover, until fresh supply runs out;
 *   - from the level CLOSEST to the user's estimated level, widening outward;
 *   - within a level, the most common word first (det `frequencyScore`).
 *
 * The level estimate is borrowed from StarterPacksService.estimateLevel — the same
 * cold-start seed the discover flow uses — so a lent card sits at the difficulty the
 * user would have been offered to sort anyway. A brand-new user with an empty deck
 * estimates level 1 and is lent the most common level-1 words, which is exactly the
 * right first experience.
 *
 * WHY THE ROWS PERSIST
 * A lent card is a real vet row so that marks fired at it during play are recorded
 * like any other card's. It stays after the round: the user can sort it later and
 * keep the progress (StarterPacksService.sortCard promotes it in place). It is not
 * garbage-collected, because deleting it would throw that progress away — the same
 * reason undoSort demotes rather than deletes.
 *
 * TWO ENTRY POINTS
 *   - `ensureBaseline` — "top the user up to N playable cards". The cold-start guard
 *     every surface calls before assembling a round.
 *   - `lendCards` — "lend exactly N, whatever they hold". Used by the flp working
 *     loop, where the user can be far past the baseline and still have nothing to
 *     play because every card is resting on its cooldown.
 *
 * Referenced by: OnDeckVocabController (game pools, word search, the flp working
 * loop), OnDeckVocabService (the flp cooldown-exhaustion top-up).
 * Depends on: ProvisionalCardDAL, StarterPacksService.estimateLevel.
 */
/**
 * The difficulty range that exists for every language (`de."difficulty" BETWEEN 1
 * AND 6`). A shifted lend level is clamped into it, which is also what implements
 * Hydra's "floored at L <= 4" tier rule without a special case
 * (docs/HYDRA_BUBBLES.md § 6.2).
 */
const PROVISIONAL_MIN_LEVEL = 1;
const PROVISIONAL_MAX_LEVEL = 6;

export class ProvisionalCardService {
  constructor(
    private provisionalCardDAL: ProvisionalCardDAL,
    private starterPacksService: StarterPacksService
  ) {}

  /**
   * Ensure the user has at least `baseline` playable cards for `language`, lending
   * provisional cards to cover any shortfall.
   *
   * Returns what the caller needs to describe the situation to the player:
   *   - `granted`     — how many cards were lent by THIS call (0 = nothing to do);
   *   - `grantedWords`— the words lent by this call, in the order they were chosen;
   *   - `playable`    — the playable card count after topping up;
   *   - `shortfall`   — how many cards the user is STILL short after the top-up,
   *                     i.e. the dictionary genuinely ran out of lendable words.
   *                     Non-zero is not an error: the surface plays with what it has.
   *
   * NEVER THROWS ON SUPPLY EXHAUSTION. A user who has already sorted or been lent
   * every discoverable word in the language gets `shortfall > 0` and a smaller round,
   * which is still infinitely better than a block screen.
   */
  async ensureBaseline(
    userId: string,
    language: string,
    baseline: number,
    mode: ProvisionMode = 'default'
  ): Promise<{ granted: number; grantedWords: string[]; playable: number; shortfall: number }> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');

    const target = Math.max(0, Math.floor(baseline));
    let playable = await this.provisionalCardDAL.countPlayable(userId, language);
    if (playable >= target) {
      return { granted: 0, grantedWords: [], playable, shortfall: 0 };
    }

    const { granted, grantedWords } = await this.lendCards(userId, language, target - playable, mode);
    // Re-read the true playable count rather than trusting the batch size: ON CONFLICT
    // DO NOTHING means a concurrent entry may have claimed some of the same words.
    if (granted > 0) {
      playable = await this.provisionalCardDAL.countPlayable(userId, language);
    }

    const shortfall = Math.max(0, target - playable);
    return { granted, grantedWords, playable, shortfall };
  }

  /**
   * Turn a TIER OFFSET into an absolute lend level, clamped into 1..6.
   *
   * WHY AN OFFSET CROSSES THE WIRE AND A LEVEL DOES NOT. Hydra Bubbles maps a rolled
   * color to a tier relative to the learner: red = L, yellow = L-1, green = L-2,
   * blue = L-3 (docs/HYDRA_BUBBLES.md § 6.2). Only the SERVER knows `L` —
   * `estimateLevel` is not exposed to the client and there is no reason to expose it.
   * Splitting the computation here keeps each half where its data already lives: the
   * client owns the per-color offsets, the server owns the learner's level. The
   * alternative was an endpoint whose only job was to ship `L` out so the client
   * could send a number back that the server already knew.
   *
   * The clamp is also what implements the doc's "floored at L <= 4" rule — at L = 4
   * the offsets already land on 4/3/2/1, and below that the clamp holds them there —
   * so there is no special case for a beginner.
   */
  async resolveLendLevel(userId: string, language: string, offset: number): Promise<number> {
    const base = await this.starterPacksService.estimateLevel(userId, language);
    return Math.max(
      PROVISIONAL_MIN_LEVEL,
      Math.min(PROVISIONAL_MAX_LEVEL, base + Math.round(offset))
    );
  }

  /**
   * Lend exactly `count` cards, REGARDLESS of how many the user already holds.
   *
   * This is the unconditional primitive `ensureBaseline` is built on, and it exists
   * as its own entry point because the flp working loop needs a case the baseline
   * cannot express: a learner with hundreds of playable cards, all of them resting on
   * their per-type cooldown. `ensureBaseline` no-ops there (the count is already past
   * the baseline) even though the loop has nothing to serve. The loop asks for the
   * cards it is short and honors the cooldown instead of re-serving a cooling card.
   * See OnDeckVocabService.getDistributedWorkingLoop and docs/PROVISIONAL_CARDS.md.
   *
   * Two passes. The first draws from fresh supply only; the second is reached only
   * when fresh supply cannot cover the gap, and recycles words the user skipped in
   * discover.
   *
   * `opts.level` pins the difficulty this lends around, overriding the learner's own
   * estimated level. Callers that think in TIERS resolve one with `resolveLendLevel`
   * first. It does NOT change how many cards are lent, and it does not narrow supply
   * — an exhausted level widens outward like any other.
   *
   * `granted` counts rows that actually landed. `grantedWords` lists every word
   * ATTEMPTED, so it can slightly overstate when a concurrent request won the same
   * word — harmless, because a word lost that way is one the user now holds anyway,
   * and the list's only consumers are the exclusion filter and the "sort these cards"
   * hand-off. Returns `{ granted: 0 }` rather than throwing when supply runs out.
   */
  async lendCards(
    userId: string,
    language: string,
    count: number,
    mode: ProvisionMode = 'default',
    opts: { level?: number } = {}
  ): Promise<{ granted: number; grantedWords: string[] }> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');

    const want = Math.max(0, Math.floor(count));
    if (want === 0) return { granted: 0, grantedWords: [] };

    // Which difficulty to lend AROUND — the learner's own estimated level unless the
    // caller pinned one. Either way it is a CENTRE, not a filter: findCandidates
    // orders by ABS(difficulty - level), so an exhausted level widens outward rather
    // than returning nothing. That is exactly Hydra's "pull from the next level up"
    // fallback (docs/HYDRA_BUBBLES.md § 6.2), and it means a nonsense level can never
    // starve a round.
    const level = opts.level ?? (await this.starterPacksService.estimateLevel(userId, language));
    const grantedWords: string[] = [];
    let granted = 0;

    for (const includeSkipped of [false, true]) {
      const need = want - granted;
      if (need <= 0) break;

      const candidates = await this.provisionalCardDAL.findCandidates(
        userId,
        language,
        level,
        need,
        { excludeWords: grantedWords, includeSkipped }
      );
      if (candidates.length === 0) continue;

      const words = candidates.map((c) => c.word1);
      const inserted = await this.provisionalCardDAL.insertProvisional(userId, words, language);
      grantedWords.push(...words);
      granted += inserted.length;
    }

    if (granted > 0) {
      console.log(
        `[Provisional] Lent ${granted} card(s) to user=${userId.substring(0, 8)}… language=${language} ` +
          `level=${level}${opts.level !== undefined ? ' (pinned)' : ''} mode=${mode} requested=${want}` +
          (granted < want ? ` (${want - granted} short — dictionary supply exhausted)` : '')
      );
    }

    return { granted, grantedWords };
  }

  /**
   * `ensureBaseline` keyed by surface, so callers name the surface rather than
   * hard-coding a number and re-introducing the drift the baselines table removed.
   *
   * `multiplier` over-provisions past the baseline. Only Word Search uses it: its
   * ten words must have mutually DISTINCT characters, a constraint a row count
   * cannot express, so it retries with a bigger pool (PROVISION_RETRY_FACTOR).
   */
  async ensureBaselineForSurface(
    userId: string,
    language: string,
    surface: CardBaselineSurface,
    multiplier = 1,
    mode: ProvisionMode = 'default'
  ): Promise<{ granted: number; grantedWords: string[]; playable: number; shortfall: number }> {
    const baseline = Math.ceil(CARD_BASELINES[surface] * Math.max(1, multiplier));
    return this.ensureBaseline(userId, language, baseline, mode);
  }

  /**
   * The `mastered-first` FILLER LADDER — the player's own cards, hardest-known first,
   * and only then lent ones (docs/STUDY_CHALLENGE.md § 5.2).
   *
   * ⚠️ THIS, NOT THE `mode` PARAMETER ABOVE, IS WHERE `mastered-first` ACTUALLY LIVES,
   * and the distinction matters to anyone reading § 5.2 and looking for it:
   *
   *   * `ensureBaseline` decides HOW MANY cards a surface gets. It is already correct
   *     for challenges without any mode-specific logic — a player with a real library
   *     is over the baseline, so nothing is lent; a brand-new player is short, so the
   *     ladder's last rung fires. `mode` is threaded through it for logging and so a
   *     future mode can change the lending ORDER, not because the count changes.
   *   * this method decides WHICH cards, IN WHAT ORDER, and that is the whole
   *     substance of the ladder: Mastered (most recently first) → Comfortable → Target
   *     → Unfamiliar → lent.
   *
   * `excludeWords` must carry the contested ten, so a contested word can never also
   * appear as filler on the same board.
   *
   * Returns vet ids in ladder order. Every step degrades silently to the next, so no
   * caller has to check whether the player has mastered cards.
   */
  async getFillerPool(
    userId: string,
    language: string,
    count: number,
    excludeWords: string[] = []
  ): Promise<number[]> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');

    const want = Math.max(0, Math.floor(count));
    if (want === 0) return [];

    // Rungs 1-4: the player's own cards, hardest-known first. One query — the band
    // descent is an ORDER BY, not four round trips.
    const own = await this.provisionalCardDAL.findOwnCardsByBand(userId, language, want, {
      excludeWords,
    });
    const ids = own.map((card) => card.id);
    if (ids.length >= want) return ids.slice(0, want);

    // Rung 5: lend the remainder. Reached immediately by a brand-new player, which is
    // exactly the never-block behaviour PROVISIONAL_CARDS.md already guarantees, and
    // never reached by a learner with a real library.
    const { grantedWords } = await this.lendCards(
      userId,
      language,
      want - ids.length,
      'mastered-first'
    );
    if (grantedWords.length === 0) {
      // Supply exhausted. A SHORT board is the correct answer, never a refusal.
      return ids;
    }

    // Re-read through the same ladder so the lent rows come back as vet ids in one
    // consistent ordering, rather than being appended from a different query's shape.
    const topped = await this.provisionalCardDAL.findOwnCardsByBand(userId, language, want, {
      excludeWords,
    });
    if (topped.length >= ids.length) return topped.slice(0, want).map((card) => card.id);
    return ids;
  }

  /** The entryKeys of every card currently lent to this user for a language. */
  async listProvisionalKeys(userId: string, language: string): Promise<string[]> {
    return this.provisionalCardDAL.listProvisionalKeys(userId, language);
  }

  /**
   * The discover cards for the temporary words this user still holds — the set the
   * sort flow is handed when the player taps "Sort these cards" after a round.
   *
   * `words` narrows it to the cards a specific round actually used; omit it to offer
   * every outstanding provisional card. Either way the result is INTERSECTED with what
   * the user genuinely still holds as provisional, so a stale client list (cards
   * already sorted in another tab, or words never lent at all) cannot smuggle
   * arbitrary words into the sort flow.
   */
  async getSortSet(userId: string, language: string, words?: string[]): Promise<DiscoverCard[]> {
    const held = await this.provisionalCardDAL.listProvisionalKeys(userId, language);
    if (held.length === 0) return [];

    let selected = held;
    if (words && words.length > 0) {
      const heldSet = new Set(held);
      // Preserve the caller's order (the order the round played them in), but keep
      // only words that are still provisional.
      selected = words.filter((word) => heldSet.has(word));
      if (selected.length === 0) return [];
    }

    return this.starterPacksService.getCardsForWords(selected, userId, language);
  }
}
