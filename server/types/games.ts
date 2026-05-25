/**
 * Games framework types.
 * Shared shapes used by the games DALs, services, and controllers.
 */

/** A single asset row from the gameassets table. */
export interface GameAsset {
  id: string;
  gameId: string;
  assetId: string;
  displayName: string | null;
  imagePath: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/** A save-state row from the gameprogress table. */
export interface GameProgress {
  id: string;
  userId: string;
  gameId: string;
  state: Record<string, unknown>;
  updatedAt: Date;
}

/** Response for GET /api/games/:gameId/assets */
export interface GameAssetsResponse {
  gameId: string;
  assets: GameAsset[];
}

/** Response for GET /api/games/:gameId/progress (null when user has no save yet). */
export interface GameProgressResponse {
  gameId: string;
  progress: GameProgress | null;
}
