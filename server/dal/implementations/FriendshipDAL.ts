import type { PoolClient } from 'pg';
import { IFriendshipDAL } from '../interfaces/IFriendshipDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import type {
  Friendship,
  FriendSummary,
  FriendRequestSummary,
  RequestDirection,
} from '../../types/friends.js';
import { ValidationError, DuplicateError } from '../../types/dal.js';

/** Every column of a `friendships` row, in the order the row types expect. */
const ROW = `id, "requesterId", "addresseeId", status, "createdAt", "respondedAt"`;

/** Postgres unique-violation SQLSTATE — the pair index firing on a duplicate edge. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Persists the friend graph (`friendships`, migration 138).
 *
 * THE SYMMETRY TRICK: an accepted friendship has no meaningful direction, but the
 * row does. Rather than storing two mirrored rows (which then have to be kept in
 * sync), every read matches `"requesterId" = $1 OR "addresseeId" = $1` and picks
 * the other column as "the friend" with a CASE. That keeps one row per pair and
 * makes the unique index (LEAST/GREATEST) sufficient to prevent duplicates.
 *
 * Every method takes an optional PoolClient so a caller inside a transaction can
 * enlist the query — the shape docs/BACKEND_LAYERING.md §3 prescribes. Nothing in
 * this feature is multi-statement today; the parameter exists so a future
 * "accept + notify" transaction doesn't have to reshape the DAL.
 */
export class FriendshipDAL implements IFriendshipDAL {

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

  async findById(id: string, client?: PoolClient): Promise<Friendship | null> {
    this.requireId(id, 'id');
    const { rows } = await this.run<Friendship>(client, (c) =>
      c.query(`SELECT ${ROW} FROM friendships WHERE id = $1`, [id])
    );
    return rows[0] ?? null;
  }

  async findBetween(userA: string, userB: string, client?: PoolClient): Promise<Friendship | null> {
    this.requireId(userA, 'userA');
    this.requireId(userB, 'userB');
    const { rows } = await this.run<Friendship>(client, (c) =>
      c.query(
        `SELECT ${ROW} FROM friendships
         WHERE ("requesterId" = $1 AND "addresseeId" = $2)
            OR ("requesterId" = $2 AND "addresseeId" = $1)`,
        [userA, userB]
      )
    );
    return rows[0] ?? null;
  }

  async createRequest(
    requesterId: string,
    addresseeId: string,
    client?: PoolClient
  ): Promise<Friendship> {
    this.requireId(requesterId, 'requesterId');
    this.requireId(addresseeId, 'addresseeId');
    // The CHECK constraint would reject this too; failing here names the caller's bug.
    if (requesterId === addresseeId) throw new ValidationError('Cannot friend yourself');

    try {
      const { rows } = await this.run<Friendship>(client, (c) =>
        c.query(
          `INSERT INTO friendships ("requesterId", "addresseeId", status)
           VALUES ($1, $2, 'pending')
           RETURNING ${ROW}`,
          [requesterId, addresseeId]
        )
      );
      return rows[0];
    } catch (error: any) {
      // Two people requesting each other at the same instant both pass the
      // service's findBetween check and race to INSERT; the pair index rejects the
      // loser. Translate it so the controller answers 409, not 500.
      if (error?.code === PG_UNIQUE_VIOLATION) {
        throw new DuplicateError('A friend request already exists between these users');
      }
      throw error;
    }
  }

  async acceptRequest(id: string, client?: PoolClient): Promise<Friendship | null> {
    this.requireId(id, 'id');
    // `status = 'pending'` in the WHERE makes this idempotent: a second accept
    // matches nothing and returns null rather than re-stamping respondedAt.
    const { rows } = await this.run<Friendship>(client, (c) =>
      c.query(
        `UPDATE friendships
            SET status = 'accepted', "respondedAt" = now()
          WHERE id = $1 AND status = 'pending'
          RETURNING ${ROW}`,
        [id]
      )
    );
    return rows[0] ?? null;
  }

  async deleteById(id: string, client?: PoolClient): Promise<boolean> {
    this.requireId(id, 'id');
    const { rowCount } = await this.run(client, (c) =>
      c.query(`DELETE FROM friendships WHERE id = $1`, [id])
    );
    return rowCount > 0;
  }

  async deleteBetween(userA: string, userB: string, client?: PoolClient): Promise<boolean> {
    this.requireId(userA, 'userA');
    this.requireId(userB, 'userB');
    const { rowCount } = await this.run(client, (c) =>
      c.query(
        `DELETE FROM friendships
          WHERE ("requesterId" = $1 AND "addresseeId" = $2)
             OR ("requesterId" = $2 AND "addresseeId" = $1)`,
        [userA, userB]
      )
    );
    return rowCount > 0;
  }

  async listFriends(userId: string, client?: PoolClient): Promise<FriendSummary[]> {
    this.requireId(userId, 'userId');
    // The join target is "the column that isn't me" — see the symmetry note above.
    const { rows } = await this.run<FriendSummary>(client, (c) =>
      c.query(
        `SELECT u.id            AS "userId",
                u.name          AS name,
                u.email         AS email,
                u."avatarIconId" AS "avatarIconId",
                f."respondedAt" AS "friendsSince"
           FROM friendships f
           JOIN users u
             ON u.id = CASE WHEN f."requesterId" = $1 THEN f."addresseeId" ELSE f."requesterId" END
          WHERE f.status = 'accepted'
            AND ($1 IN (f."requesterId", f."addresseeId"))
          ORDER BY f."respondedAt" DESC NULLS LAST`,
        [userId]
      )
    );
    return rows;
  }

  async listPendingRequests(
    userId: string,
    direction: RequestDirection,
    client?: PoolClient
  ): Promise<FriendRequestSummary[]> {
    this.requireId(userId, 'userId');
    if (direction !== 'incoming' && direction !== 'outgoing') {
      throw new ValidationError(`Unknown request direction: ${direction}`);
    }

    // Incoming = rows addressed to me (I answer them). Outgoing = rows I sent (I
    // revoke them). The joined user is the other party in both cases, so one row
    // component renders both screens.
    const mineColumn = direction === 'incoming' ? '"addresseeId"' : '"requesterId"';
    const otherColumn = direction === 'incoming' ? '"requesterId"' : '"addresseeId"';

    const { rows } = await this.run<FriendRequestSummary>(client, (c) =>
      c.query(
        `SELECT f.id             AS "requestId",
                $2::text         AS direction,
                u.id             AS "userId",
                u.name           AS name,
                u.email          AS email,
                u."avatarIconId"  AS "avatarIconId",
                f."createdAt"    AS "requestedAt"
           FROM friendships f
           JOIN users u ON u.id = f.${otherColumn}
          WHERE f.status = 'pending'
            AND f.${mineColumn} = $1
          ORDER BY f."createdAt" DESC`,
        [userId, direction]
      )
    );
    return rows;
  }
}
