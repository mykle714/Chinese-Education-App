/**
 * Weekly-achievement types.
 * Shared shapes used by the weeklies DAL and controller.
 */

/** A row from the weeklies table: one weekly achievement earned by one user. */
export interface Weekly {
  id: string;
  userId: string;
  /** Client-chosen achievement key, e.g. 'bubbleMatch'. */
  activity: string;
  achievedAt: Date;
}

/** Response for GET /api/users/me/weeklies — the user's achievements this week. */
export interface WeekliesResponse {
  weeklies: Weekly[];
}
