/**
 * Arena wire + row types (docs/ARENA_FEATURE.md § 9).
 *
 * Mirrored on the client at src/api/arena.ts. Row types model the tables;
 * response types model what the board actually renders.
 */

/** 1-12. Division 1 is the bottom rung, 12 the top. */
export type ArenaDivision = number;

/** How an arena came into existence (§ 5.3). */
export type ArenaFormationKind = 'batch' | 'straggler';

/** A row of `arenas`. */
export interface Arena {
  id: string;
  division: ArenaDivision;
  timezone: string;
  geoCellPrefix: string | null;
  formationKind: ArenaFormationKind;
  weekStartsAt: Date;
  closesAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
}

/** A row of `arena_members`. `userId === null` means synthetic (§ 6.1). */
export interface ArenaMember {
  id: string;
  arenaId: string;
  userId: string | null;
  language: string;
  syntheticName: string | null;
  syntheticAvatarIconId: string | null;
  syntheticSeed: number | null;
  syntheticTarget: number | null;
  minutesEarned: number;
  finalRank: number | null;
  divisionChange: number | null;
  isLive: boolean;
  updatedAt: Date;
  createdAt: Date;
}

/**
 * One rendered row of the board.
 *
 * Deliberately carries NOTHING beyond name, avatar, language and score
 * (settled as Q20). An arena puts a learner in front of 24 strangers they did
 * not choose and cannot leave, so anything more is a disclosure they never
 * agreed to. Adding a field here is a privacy decision, not a layout tweak —
 * take it back to the question log.
 */
export interface ArenaEntry {
  rank: number;
  /** Null for synthetic members — the client must not link or route on this. */
  userId: string | null;
  name: string;
  avatarIconId: string | null;
  language: string;
  score: number;
  /** True for the requesting user's own row, so the client can highlight it. */
  isViewer: boolean;
  /**
   * Which side of the promotion/relegation line this rank sits on, computed
   * server-side so the client never re-derives the cutoffs and drifts.
   */
  zone: 'promote' | 'hold' | 'relegate';
}

/** The four states of /arena (§ 2.3). */
export type ArenaState =
  /** In an arena, racing. */
  | 'live'
  /** Arena closed, results readable, next week's opt-in open. */
  | 'results'
  /** Not in an arena; the break is open and they may opt in. */
  | 'opt-in'
  /** Not in an arena and the break has passed — wait for next week. */
  | 'closed';

/** Boundary instants the client renders a countdown against. */
export interface ArenaBoundaries {
  weekStartsAt: string;
  closesAt: string;
  /** The arena's IANA zone. */
  timezone: string;
  /**
   * True when the arena's timezone differs from the viewer's current one, in
   * which case the UI labels every time with the ARENA's zone (§ 3). A member
   * who travels mid-week keeps racing on the clock they started on.
   */
  timezoneDiffersFromViewer: boolean;
}

/** GET /api/arena */
export interface ArenaBoardResponse {
  state: ArenaState;
  division: ArenaDivision;
  arenaId: string | null;
  entries: ArenaEntry[];
  boundaries: ArenaBoundaries | null;
  /** Set only in the 'results' state: what last week's finish did to the rung. */
  divisionChange: number | null;
  /** Whether the viewer has already opted into the coming week. */
  optedInNextWeek: boolean;
}
