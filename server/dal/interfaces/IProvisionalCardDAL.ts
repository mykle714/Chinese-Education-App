/**
 * Data access for PROVISIONAL cards (migration 140, docs/PROVISIONAL_CARDS.md).
 *
 * A provisional card is a vet row in bucket 'provisional': a word the SERVER handed
 * a user so a game or the flashcards learn page could reach its baseline card count,
 * rather than refusing to start. It is a real row (it has an id and accepts marks)
 * but it is not in the user's deck until they sort it.
 *
 * LAYER: DAL. It owns no tables of its own — it reads the per-language det table for
 * candidate words and writes rows into the per-language vet table. The POLICY (how
 * many to grant, when, and to which surface) lives in ProvisionalCardService.
 *
 * The candidate query is deliberately the same shape as the discover supply query in
 * StarterPacksService._fetchSupplyRows: nearest-level-first, then commonality. The two
 * are NOT shared because they answer different questions — discover asks "what should
 * this user sort next?" (and recycles skips, and honors a client-driven target level),
 * while this asks "what can I safely lend them right now?".
 */
export interface ProvisionalCandidate {
  /** det surrogate id, scoped to the language's det table. */
  id: number;
  /** det `word1` — the vet `entryKey`. */
  word1: string;
  /** det `difficulty` (1..6), for logging/telemetry. */
  difficulty: number | null;
  /** det `frequencyScore` (1..5 commonality), for logging/telemetry. */
  frequencyScore: number | null;
}

export interface IProvisionalCardDAL {
  /**
   * Count the cards this user has SORTED for `language` (`vetSortedClause`) — the
   * number the baseline is compared against.
   *
   * SORTED, NOT PLAYABLE (2026-08-20). This used to count outstanding provisional
   * rows too, on the reasoning that counting only sorted cards would re-provision a
   * fresh batch on every entry. The re-provisioning is prevented properly now — the
   * lend path re-lends held rows before it mints any (`findHeldProvisional`) — and
   * counting lent rows had made the baseline unfalsifiable: a learner who had been
   * lent 184 cards and sorted 4 read as "well past baseline", so nothing ever
   * topped them up and every round was played on borrowed words. The baseline asks
   * "did they sort enough cards?", and only sorted cards can answer that.
   */
  countSorted(userId: string, language: string): Promise<number>;

  /**
   * The ids of provisional rows this user ALREADY HOLDS for `language`, nearest to
   * `level` first — the RE-LEND source that the lend path draws from before minting
   * anything new.
   *
   * Why this exists: provisional rows are no longer ordinary candidates (the
   * selection queries are sorted-only), so without re-lending, every round that
   * needed lent cards would mint a brand-new batch and the bucket would grow without
   * bound. Re-lending caps it at the learner's true deficit and, because the rows
   * keep their accumulated marks, means the progress they earn on a borrowed word
   * survives to whenever they sort it.
   *
   * Not cooldown-filtered: that is the caller's business (each surface cools on the
   * mark type it emits), and the pools split fresh from cooled themselves.
   */
  findHeldProvisional(
    userId: string,
    language: string,
    level: number,
    limit: number,
    excludeIds?: number[]
  ): Promise<number[]>;

  /**
   * Pick up to `limit` words to lend the user, ordered by
   *   1. distance from `level`   — ABS(difficulty - level) ASC, so in-level words
   *      come first and the search widens outward only as far as the data forces.
   *   2. commonality             — frequencyScore DESC NULLS LAST, so the most
   *      useful everyday word at a given level is lent first.
   *   3. id                      — a stable tiebreak, so repeat calls are deterministic.
   *
   * Excludes, by construction:
   *   - any word the user already holds a vet row for, in EITHER bucket (so a word
   *     is never lent twice, and never lent when it is already in their deck);
   *   - any word in `excludeWords` (the caller's in-flight set);
   *   - words the user explicitly skipped in discover, unless `includeSkipped`.
   */
  findCandidates(
    userId: string,
    language: string,
    level: number,
    limit: number,
    opts?: { excludeWords?: string[]; includeSkipped?: boolean }
  ): Promise<ProvisionalCandidate[]>;

  /**
   * Insert `entryKeys` as provisional vet rows for the user and return the ids of
   * the rows that were actually created.
   *
   * Idempotent: a key the user already holds is skipped (ON CONFLICT DO NOTHING on
   * the (userId, entryKey, language) unique index) rather than raising, so two
   * concurrent game entries cannot collide.
   */
  insertProvisional(userId: string, entryKeys: string[], language: string): Promise<number[]>;

  /**
   * The entryKeys of every provisional card the user currently holds for a language.
   * Used to tell the client which of the served cards are temporary, and to build
   * the end-of-round "sort these" hand-off.
   */
  listProvisionalKeys(userId: string, language: string): Promise<string[]>;

  /**
   * The user's OWN cards, hardest-known first — the `mastered-first` filler ladder
   * (docs/STUDY_CHALLENGE.md § 5.2).
   *
   * Ordered by descending core band — **Mastered → Comfortable → Target →
   * Unfamiliar** — then, within Mastered, most recently mastered first (`masteredAt`,
   * migration 142), then commonality, then id.
   *
   * ⚠️ THIS IS NOT LENDING. Every row it returns is a card the user already holds;
   * it exists so a Study Challenge round can pad its board with the player's OWN
   * easiest material before borrowing anything. Filler must not be a source of
   * difficulty: a challenge measures its nine contested words, and padding the board
   * with words the player has never seen would add noise and reward whoever got
   * luckier filler. `default` lending is the LAST rung of the ladder, reached only
   * when the player's whole library is exhausted — which is exactly a brand-new
   * learner, and exactly what lending is for.
   *
   * Why descend the bands rather than jump straight to lending: the player's own
   * Unfamiliar card is one they CHOSE to sort, and is still more familiar than a word
   * the server lent them sight-unseen.
   */
  findOwnCardsByBand(
    userId: string,
    language: string,
    limit: number,
    opts?: {
      /** Words that must never be filler — a challenge's contested set. */
      excludeWords?: string[];
      /**
       * Rows already in play (on a board, in a buffer). Load-bearing for a MID-RUN
       * top-up: the ladder is deterministic, so a caller that filtered afterwards
       * would be handed the same top-N it already holds and come back empty.
       */
      excludeIds?: number[];
    }
  ): Promise<OwnCardCandidate[]>;
}

/** One of the user's own cards, as the `mastered-first` ladder returns it. */
export interface OwnCardCandidate {
  /** vet row id. */
  id: number;
  /** vet `entryKey` — the word. */
  entryKey: string;
  /** The computed core utcm band this card sits in, for logging/telemetry. */
  category: string;
}
