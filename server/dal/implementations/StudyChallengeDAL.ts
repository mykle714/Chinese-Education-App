import type { PoolClient } from 'pg';
import type { IStudyChallengeDAL, StudyChallengeWithTimezones } from '../interfaces/IStudyChallengeDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError, DuplicateError } from '../../types/dal.js';
import { dictTableForLanguage } from '../shared/dictTable.js';
import { vetTableForLanguage, vetSortedClause, coreCategoryExpr } from '../shared/vetTable.js';
import type {
  ChallengeGameRef,
  ChallengeRound,
  ChallengeStatus,
  ChallengeVariant,
  ChallengeWord,
  DefinitionCluster,
} from '../../contracts/wire.js';
import { resolveDisplayDefinition, resolveDisplayPronunciation } from '../../utils/definitions.js';
import type {
  StudyChallengeRow,
  ChallengeCandidate,
  ChallengeWordDisplayFields,
} from '../../types/studyChallenge.js';

/**
 * Every column of a `study_challenges` row, in the order StudyChallengeRow expects.
 *
 * Built from a list rather than written twice, because the two maintenance reads
 * join `users` and therefore need every column ALIAS-QUALIFIED. Two hand-written
 * copies of a 16-column list is exactly how a column gets added to one and not the
 * other.
 */
const ROW_COLUMNS = [
  'id', '"challengerId"', '"challengeeId"', 'variant',
  '"challengerLanguage"', '"challengeeLanguage"', 'status',
  '"gameSequence"', 'words', 'rounds', '"presetDeckIds"',
  '"issuedAt"', '"weekIndex"', '"acceptedAt"', '"completedAt"', '"winnerUserId"',
] as const;

/** Unqualified column list, for the queries that select from `study_challenges` alone. */
const ROW = ROW_COLUMNS.join(', ');

/** The same list qualified with a table alias, for the queries that join `users`. */
function rowAs(alias: string): string {
  return ROW_COLUMNS.map((col) => `${alias}.${col}`).join(', ');
}

/** Postgres unique-violation SQLSTATE — the (pair, week) index firing. */
const PG_UNIQUE_VIOLATION = '23505';

/** The statuses a challenge is still live in. Kept here so both list queries agree. */
const LIVE_STATUSES = ['pending', 'accepted'];

/**
 * The bands that mean "this player already knows the word" for candidate exclusion
 * (§ 3.1 step 2). Only `Unfamiliar` — or a word held by neither player — survives.
 *
 * CORE bar only. The whole feature is core (Q3): the test is made exclusively of
 * recognition/production games, so a word a player has mastered for READING is
 * still a legitimate challenge word.
 */
const KNOWN_CORE_BANDS = ['Target', 'Comfortable', 'Mastered'];

/**
 * Persists Study Challenge (`study_challenges`, migration 148).
 *
 * See IStudyChallengeDAL for the layering rules this file obeys — and in
 * particular for the rule about `rounds` having exactly one writer, which is the
 * single most important invariant in this file.
 *
 * Table names are resolved from a language via the shared whitelist helpers
 * (`dictTableForLanguage` / `vetTableForLanguage`), which only ever return one of
 * two hard-coded names, so they are safe to splice into SQL. Everything else is
 * bound.
 */
export class StudyChallengeDAL implements IStudyChallengeDAL {

  /** Injected so a test can substitute a manager; defaults to the process singleton. */
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /** Run `fn` on the caller's client when given one, otherwise on a pooled connection. */
  private async run<T>(
    client: PoolClient | undefined,
    fn: (c: PoolClient) => Promise<any>
  ): Promise<{ rows: T[]; rowCount: number }> {
    if (client) {
      const r = await fn(client);
      return { rows: r.rows || [], rowCount: r.rowCount || 0 };
    }
    const r = await this.dbManager.executeQuery<T>(fn);
    return { rows: r.recordset, rowCount: r.rowsAffected };
  }

  /** Guard the id arguments every method here takes. */
  private requireId(value: string | undefined | null, label: string): string {
    if (!value || typeof value !== 'string') throw new ValidationError(`${label} is required`);
    return value;
  }

  private requireLanguage(value: string | undefined | null): string {
    if (!value) throw new ValidationError('language is required');
    return value;
  }

  async findById(id: string, client?: PoolClient): Promise<StudyChallengeRow | null> {
    this.requireId(id, 'id');
    const { rows } = await this.run<StudyChallengeRow>(client, (c) =>
      c.query(`SELECT ${ROW} FROM study_challenges WHERE id = $1`, [id])
    );
    return rows[0] ?? null;
  }

  async findForPairInWeek(
    userA: string,
    userB: string,
    weekIndex: number,
    client?: PoolClient
  ): Promise<StudyChallengeRow | null> {
    this.requireId(userA, 'userA');
    this.requireId(userB, 'userB');

    // Direction-blind, matching the unique index: either player may have issued it.
    // Deliberately status-blind too — a resolved row still holds its week.
    const { rows } = await this.run<StudyChallengeRow>(client, (c) =>
      c.query(
        `SELECT ${ROW} FROM study_challenges
          WHERE LEAST("challengerId", "challengeeId") = LEAST($1::uuid, $2::uuid)
            AND GREATEST("challengerId", "challengeeId") = GREATEST($1::uuid, $2::uuid)
            AND "weekIndex" = $3`,
        [userA, userB, weekIndex]
      )
    );
    return rows[0] ?? null;
  }

  async listLiveForUser(userId: string, client?: PoolClient): Promise<StudyChallengeRow[]> {
    this.requireId(userId, 'userId');
    const { rows } = await this.run<StudyChallengeRow>(client, (c) =>
      c.query(
        `SELECT ${ROW} FROM study_challenges
          WHERE status = ANY($2::text[])
            AND $1 IN ("challengerId", "challengeeId")
          ORDER BY "issuedAt" DESC`,
        [userId, LIVE_STATUSES]
      )
    );
    return rows;
  }

  async countActiveForUser(userId: string, language: string, client?: PoolClient): Promise<number> {
    this.requireId(userId, 'userId');
    this.requireLanguage(language);

    // WHAT THIS COUNTS, precisely (Q65): challenges the user is COMMITTED to.
    //   * they issued it and it is still pending  -> counts (their own decision)
    //   * it is accepted, either role             -> counts (their own decision)
    //   * somebody else issued it and it is still pending -> DOES NOT COUNT
    // The last line is the load-bearing one. If incoming invitations consumed
    // slots, one friend could fill a user's quota with invitations they never asked
    // for and lock them out of challenging anyone.
    //
    // Language is matched per ROLE, because the two sides of a cross-language
    // challenge spend a slot in different languages.
    const { rows } = await this.run<{ count: string }>(client, (c) =>
      c.query(
        `SELECT COUNT(*) AS count
           FROM study_challenges
          WHERE (
                  ("challengerId" = $1 AND "challengerLanguage" = $2
                    AND status IN ('pending', 'accepted'))
               OR ("challengeeId" = $1 AND "challengeeLanguage" = $2
                    AND status = 'accepted')
                )`,
        [userId, language]
      )
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  async findLastResolvedForPair(
    userA: string,
    userB: string,
    client?: PoolClient
  ): Promise<StudyChallengeRow | null> {
    this.requireId(userA, 'userA');
    this.requireId(userB, 'userB');

    // Ordered by "completedAt" — stamped for EVERY terminal status — so the crown
    // reads the genuinely most recent resolution rather than the most recent win.
    // A draw or no_contest therefore surfaces as a row with a null winner, which is
    // what lets the service leave the previous champion in place.
    const { rows } = await this.run<StudyChallengeRow>(client, (c) =>
      c.query(
        `SELECT ${ROW} FROM study_challenges
          WHERE LEAST("challengerId", "challengeeId") = LEAST($1::uuid, $2::uuid)
            AND GREATEST("challengerId", "challengeeId") = GREATEST($1::uuid, $2::uuid)
            AND "completedAt" IS NOT NULL
          ORDER BY "completedAt" DESC
          LIMIT 1`,
        [userA, userB]
      )
    );
    return rows[0] ?? null;
  }

  async listHistoryForUser(
    userId: string,
    limit: number,
    before?: string | null,
    client?: PoolClient
  ): Promise<StudyChallengeRow[]> {
    this.requireId(userId, 'userId');
    const take = Math.min(Math.max(1, Math.floor(limit)), 100);

    // Keyset, not offset: the log only grows, and an offset page shifts under the
    // reader every time an older challenge resolves.
    const { rows } = await this.run<StudyChallengeRow>(client, (c) =>
      c.query(
        `SELECT ${ROW} FROM study_challenges
          WHERE $1 IN ("challengerId", "challengeeId")
            AND "completedAt" IS NOT NULL
            AND ($2::timestamptz IS NULL OR "completedAt" < $2::timestamptz)
          ORDER BY "completedAt" DESC
          LIMIT $3`,
        [userId, before ?? null, take]
      )
    );
    return rows;
  }

  async createChallenge(
    input: {
      challengerId: string;
      challengeeId: string;
      variant: ChallengeVariant;
      challengerLanguage: string;
      challengeeLanguage: string;
      gameSequence: ChallengeGameRef[];
      words: Record<string, ChallengeWord[]>;
      weekIndex: number;
    },
    client?: PoolClient
  ): Promise<StudyChallengeRow> {
    this.requireId(input.challengerId, 'challengerId');
    this.requireId(input.challengeeId, 'challengeeId');
    this.requireLanguage(input.challengerLanguage);
    this.requireLanguage(input.challengeeLanguage);
    // The CHECK constraint would reject this too; failing here names the caller's bug.
    if (input.challengerId === input.challengeeId) {
      throw new ValidationError('Cannot challenge yourself');
    }

    try {
      const { rows } = await this.run<StudyChallengeRow>(client, (c) =>
        c.query(
          `INSERT INTO study_challenges (
             "challengerId", "challengeeId", variant,
             "challengerLanguage", "challengeeLanguage",
             "gameSequence", words, "weekIndex"
           )
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
           RETURNING ${ROW}`,
          [
            input.challengerId,
            input.challengeeId,
            input.variant,
            input.challengerLanguage,
            input.challengeeLanguage,
            JSON.stringify(input.gameSequence),
            JSON.stringify(input.words),
            input.weekIndex,
          ]
        )
      );
      return rows[0];
    } catch (error: any) {
      // study_challenges_pair_week_uniq. The service checks first, but two taps of
      // Challenge — or a crossing challenge from the other side — race past that
      // check; translate so the controller answers 409 rather than 500.
      if (error?.code === PG_UNIQUE_VIOLATION) {
        throw new DuplicateError('You already have a challenge with this friend this week');
      }
      throw error;
    }
  }

  async acceptChallenge(
    id: string,
    words: Record<string, ChallengeWord[]>,
    presetDeckIds: Record<string, number>,
    client?: PoolClient
  ): Promise<StudyChallengeRow | null> {
    this.requireId(id, 'id');

    // `status = 'pending'` is what makes a double-accept a no-op rather than a
    // second pair of decks with the first pair orphaned.
    const { rows } = await this.run<StudyChallengeRow>(client, (c) =>
      c.query(
        `UPDATE study_challenges
            SET status = 'accepted',
                "acceptedAt" = now(),
                words = $2::jsonb,
                "presetDeckIds" = $3::jsonb
          WHERE id = $1 AND status = 'pending'
          RETURNING ${ROW}`,
        [id, JSON.stringify(words), JSON.stringify(presetDeckIds)]
      )
    );
    return rows[0] ?? null;
  }

  async resolveChallenge(
    id: string,
    status: ChallengeStatus,
    winnerUserId: string | null,
    fromStatuses: ChallengeStatus[],
    client?: PoolClient
  ): Promise<StudyChallengeRow | null> {
    this.requireId(id, 'id');
    if (!fromStatuses.length) throw new ValidationError('fromStatuses is required');

    // The `status = ANY(fromStatuses)` guard is what makes every caller idempotent:
    // the maintenance unit is Persistent=true, so a tick missed to a reboot re-runs
    // and must not re-resolve (or re-stamp) a challenge it already resolved.
    //
    // "completedAt" is stamped for EVERY terminal status, including expired and
    // no_contest, because it is the history log's sort key — a resolved challenge
    // with a null sort key would silently vanish from the log.
    const { rows } = await this.run<StudyChallengeRow>(client, (c) =>
      c.query(
        `UPDATE study_challenges
            SET status = $2,
                "winnerUserId" = $3,
                "completedAt" = now()
          WHERE id = $1 AND status = ANY($4::text[])
          RETURNING ${ROW}`,
        [id, status, winnerUserId, fromStatuses]
      )
    );
    return rows[0] ?? null;
  }

  async deletePending(id: string, challengerId: string, client?: PoolClient): Promise<boolean> {
    this.requireId(id, 'id');
    this.requireId(challengerId, 'challengerId');

    // Both the ownership filter and the status filter are in the WHERE, so a
    // challengee cannot withdraw (they decline instead) and an accepted challenge
    // cannot be deleted — by then decks exist and a history entry is owed.
    const { rowCount } = await this.run(client, (c) =>
      c.query(
        `DELETE FROM study_challenges
          WHERE id = $1 AND "challengerId" = $2 AND status = 'pending'`,
        [id, challengerId]
      )
    );
    return rowCount > 0;
  }

  /**
   * ⚠️ THE ONLY WRITER OF `rounds` — see the header of IStudyChallengeDAL.
   *
   * ONE STATEMENT, deliberately. `jsonb_set` with `create_missing = true` reads,
   * modifies and writes the column inside the row lock this UPDATE takes, so two
   * players submitting in the same instant serialise and neither write is lost.
   * There is no read-modify-write across a round trip here and there must never be.
   *
   * `rounds #> path IS NULL` makes it INSERT-ONLY: a resubmission of a round that
   * exists matches nothing and returns false, which the service turns into a
   * rejection (Q40 — a submitted round is final, no replays). The same guard makes
   * a retried request idempotent.
   *
   * An ETag/version column would be strictly worse: optimistic concurrency exists
   * to protect a read-modify-write across a round trip, and this shape does not
   * have one — the client sends a score for one slot and never needs the rest of
   * the blob.
   */
  async recordRound(
    id: string,
    userId: string,
    roundIndex: number,
    round: ChallengeRound,
    client?: PoolClient
  ): Promise<boolean> {
    this.requireId(id, 'id');
    this.requireId(userId, 'userId');
    if (!Number.isInteger(roundIndex) || roundIndex < 1) {
      throw new ValidationError('roundIndex must be a positive integer');
    }

    const { rowCount } = await this.run(client, (c) =>
      c.query(
        `UPDATE study_challenges
            SET rounds = jsonb_set(rounds, ARRAY[$2, $3], $4::jsonb, true)
          WHERE id = $1
            AND rounds #> ARRAY[$2, $3] IS NULL
          RETURNING id`,
        [id, userId, String(roundIndex), JSON.stringify(round)]
      )
    );
    return rowCount > 0;
  }

  async clearPresetDeckId(id: string, userId: string, client?: PoolClient): Promise<void> {
    this.requireId(id, 'id');
    this.requireId(userId, 'userId');

    // `- $2` removes one key from the object. The deck row itself is dropped by the
    // caller; this only forgets the pointer, so the orphan sweep (maintenance pass
    // 4) has nothing left to find.
    await this.run(client, (c) =>
      c.query(
        `UPDATE study_challenges SET "presetDeckIds" = "presetDeckIds" - $2 WHERE id = $1`,
        [id, userId]
      )
    );
  }

  async findCandidates(
    input: {
      userA: string;
      userB: string | null;
      language: string;
      minLevel: number;
      maxLevel: number;
      limit: number;
      excludeWords?: string[];
    },
    client?: PoolClient
  ): Promise<ChallengeCandidate[]> {
    this.requireId(input.userA, 'userA');
    this.requireLanguage(input.language);
    if (input.limit <= 0) return [];

    const det = dictTableForLanguage(input.language);
    const vet = vetTableForLanguage(input.language);
    const excludeWords = input.excludeWords ?? [];

    // $1 language, $2 userA, $3 userB (nullable), $4 minLevel, $5 maxLevel,
    // $6 excludeWords, $7 limit, $8 known-core-bands.
    const params: unknown[] = [
      input.language,
      input.userA,
      input.userB,
      input.minLevel,
      input.maxLevel,
      excludeWords,
      Math.floor(input.limit),
      KNOWN_CORE_BANDS,
    ];

    // "This player already knows the word" — a vet row banded above Unfamiliar on
    // the CORE bar. Banded in-query via compute_core_category (migration 143) rather
    // than fetched and banded in the service, because the exclusion has to happen
    // INSIDE the ranked query or the LIMIT would be applied to the wrong set.
    //
    // Note this deliberately matches ANY bucket: a provisional (lent) card the
    // player has already banded up still means they know the word.
    const knowsClause = (userParam: string) => `
      EXISTS (
        SELECT 1 FROM ${vet} k
         WHERE k."userId" = ${userParam}
           AND k."entryKey" = de.word1
           AND k.language = de.language
           AND ${coreCategoryExpr('k')} = ANY($8::text[])
      )`;

    // "In this player's library AND still Unfamiliar for them" — the strongest
    // fairness signal there is, because a word each player independently sorted is a
    // word each of them independently CHOSE to learn. There is deliberately no
    // half-credit tier for a word in only one library (Q4): that would tilt the set
    // toward whichever player had sorted more, the opposite of the intent.
    const chosenClause = (userParam: string) => `
      EXISTS (
        SELECT 1 FROM ${vet} l
         WHERE l."userId" = ${userParam}
           AND l."entryKey" = de.word1
           AND l.language = de.language
           AND ${vetSortedClause('l')}
           AND ${coreCategoryExpr('l')} = 'Unfamiliar'
      )`;

    // For a different-word challenge the same algorithm runs per player, with the
    // band collapsed to that one player's level and the exclusions consulting only
    // them (§ 8.1). `userB IS NULL` is that mode.
    const bothChosen = input.userB
      ? `(${chosenClause('$2')} AND ${chosenClause('$3')})`
      : chosenClause('$2');
    const eitherKnows = input.userB
      ? `(${knowsClause('$2')} OR ${knowsClause('$3')})`
      : knowsClause('$2');

    const { rows } = await this.run<ChallengeCandidate & { definitionClusters: DefinitionCluster[] | null }>(client, (c) =>
      c.query(
        // `definitions->>0` is the entry's lead gloss — the same value
        // `dictJoin`'s `de.definition` exposes (docs/DEFINITION_MAPPING.md). There
        // is no `shortDefinition` column on either det table; the confirmation
        // flow only needs enough to draw a reviewable tile.
        //
        // `definitionClusters` rides along only to feed the display resolvers below; it is
        // stripped before the row leaves this method, so `ChallengeCandidate` is unchanged.
        `SELECT de.id               AS "dictionaryEntryId",
                de.word1            AS "word1",
                de.language         AS "language",
                de.pronunciation    AS "pronunciation",
                de.definitions->>0  AS "definition",
                de."definitionClusters" AS "definitionClusters",
                de."difficulty"     AS "difficulty",
                de."frequencyScore" AS "frequencyScore",
                de."iconId"         AS "iconId"
           FROM ${det} de
          WHERE de.language = $1
            AND de.discoverable = TRUE
            AND de."difficulty" BETWEEN $4 AND $5
            AND de.word1 <> ALL($6::text[])
            AND NOT ${eitherKnows}
          ORDER BY (${bothChosen}) DESC,
                   de."frequencyScore" DESC NULLS LAST,
                   de.id ASC
          LIMIT $7`,
        params
      )
    );
    // Sense-resolve the two display fields, then drop the clusters. A candidate is a bare det
    // row with no vet row behind it, so there is no `selectedSense` and both resolvers land on
    // the entry's default sense — which is the point: the `pronunciation` column is the
    // unreviewed CEDICT seed and disagrees with the corrected cluster reading on ~54 zh
    // heteronyms (重点 = `chóng diǎn` in the column, `zhòng diǎn` in its clusters). Without
    // this, the challenge tile and the flashcard for the same word print different pinyin.
    return rows.map(({ definitionClusters, ...row }) => ({
      ...row,
      pronunciation: resolveDisplayPronunciation({ ...row, definitionClusters }),
      definition: resolveDisplayDefinition({ ...row, definitionClusters }),
    }));
  }

  async findEntryIdByWord(
    word1: string,
    language: string,
    client?: PoolClient
  ): Promise<number | null> {
    if (!word1) throw new ValidationError('word1 is required');
    this.requireLanguage(language);

    // Not filtered on `discoverable`: a word can legitimately have been un-flagged
    // since the challenge was issued, and a strike must still be able to write the
    // learner's own mark against it. The challenge's words are not re-validated
    // against discoverability anywhere else either.
    const { rows } = await this.run<{ id: number }>(client, (c) =>
      c.query(
        `SELECT id FROM ${dictTableForLanguage(language)}
          WHERE word1 = $1 AND language = $2
          LIMIT 1`,
        [word1, language]
      )
    );
    return rows[0]?.id ?? null;
  }

  async findDisplayFieldsByWords(
    word1s: string[],
    language: string,
    client?: PoolClient
  ): Promise<Record<string, ChallengeWordDisplayFields>> {
    this.requireLanguage(language);
    if (word1s.length === 0) return {};

    // Same late-resolution rule as findEntryIdByWord, and deliberately not filtered
    // on `discoverable` for the same reason: a stored challenge word must still draw
    // with its pinyin and gloss after the det row has been un-flagged. One query for
    // the whole set — the read path calls this once per challenge, not once per word.
    //
    // `definitions->>0` is the entry's lead gloss, the same value `findCandidates`
    // exposes as `definition` (docs/DEFINITION_MAPPING.md), so a stored word and a
    // candidate carry the SAME English on the review screen.
    const { rows } = await this.run<
      ChallengeWordDisplayFields & { word1: string; definitionClusters: DefinitionCluster[] | null }
    >(client, (c) =>
      c.query(
        `SELECT word1,
                id                 AS "dictionaryEntryId",
                pronunciation,
                definitions->>0    AS "definition",
                "definitionClusters",
                "frequencyScore",
                "iconId"
           FROM ${dictTableForLanguage(language)}
          WHERE language = $1 AND word1 = ANY($2::text[])`,
        [language, word1s]
      )
    );

    const map: Record<string, ChallengeWordDisplayFields> = {};
    for (const row of rows) {
      map[row.word1] = {
        dictionaryEntryId: row.dictionaryEntryId,
        // Sense-resolved for the same reason as `findCandidates` above, and via the same
        // resolvers — a stored challenge word and a candidate must print identical pinyin and
        // English for the same det entry. The clusters do not leave this method.
        pronunciation: resolveDisplayPronunciation(row),
        definition: resolveDisplayDefinition(row),
        frequencyScore: row.frequencyScore,
        iconId: row.iconId,
      };
    }
    return map;
  }

  async listPendingWithTimezones(client?: PoolClient): Promise<StudyChallengeWithTimezones[]> {
    return this.listWithTimezones('pending', client);
  }

  async listAcceptedWithTimezones(client?: PoolClient): Promise<StudyChallengeWithTimezones[]> {
    return this.listWithTimezones('accepted', client);
  }

  /**
   * The shared body of the two maintenance reads. Both need the same row plus both
   * players' CURRENT timezones — never a snapshot (Q50) — so the only difference is
   * which status they select.
   *
   * The status is a caller-supplied literal from a two-value union, but it is bound
   * as a parameter anyway: a literal spliced into SQL is a habit that outlives the
   * caller that was safe.
   */
  private async listWithTimezones(
    status: 'pending' | 'accepted',
    client?: PoolClient
  ): Promise<StudyChallengeWithTimezones[]> {
    const { rows } = await this.run<StudyChallengeWithTimezones>(client, (c) =>
      c.query(
        `SELECT ${rowAs('sc')},
                cr.timezone AS "challengerTimezone",
                ce.timezone AS "challengeeTimezone"
           FROM study_challenges sc
           JOIN users cr ON cr.id = sc."challengerId"
           JOIN users ce ON ce.id = sc."challengeeId"
          WHERE sc.status = $1
          ORDER BY sc."issuedAt" ASC`,
        [status]
      )
    );
    return rows;
  }
}
