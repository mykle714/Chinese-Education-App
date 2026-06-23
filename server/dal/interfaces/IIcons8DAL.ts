/**
 * icons8 DAL contract.
 *
 * Reads downloaded icons8 icons from the `icons8` table (migration 71). For now the
 * only consumer is the discover flow, which needs to stream an icon's stored bytes
 * to the client by its icons8 id.
 */
export interface Icons8Asset {
  /** Raw downloaded icon file bytes (svg/png) from the `assetBytes` BYTEA column. */
  assetBytes: Buffer;
  /** Format the bytes are in: 'svg' | 'png' (drives the response Content-Type). */
  downloadedFormat: string | null;
}

/** A lightweight icon listing row for the avatar picker (no bytes — the client
 *  renders each via GET /api/icons8/<id>/image). */
export interface Icons8ListItem {
  id: string;
  name: string;
}

/** One page of the icon listing plus whether more rows follow (infinite scroll). */
export interface Icons8Page {
  icons: Icons8ListItem[];
  total: number;
  hasMore: boolean;
}

export interface IIcons8DAL {
  /**
   * Fetch a single icon's downloaded bytes + format by its icons8 id (PK).
   * Returns null when the icon row is missing OR has not been downloaded yet
   * (`assetBytes` IS NULL), so callers can 404 cleanly.
   */
  getAssetById(icons8Id: string): Promise<Icons8Asset | null>;

  /**
   * Whether a downloaded icon with this id exists (used to validate avatar picks).
   * Only counts rows that actually have bytes, mirroring getAssetById.
   */
  iconExists(icons8Id: string): Promise<boolean>;

  /**
   * List downloaded icons for the avatar picker, ordered stably (name, then id) so
   * offset-based infinite scroll never skips/repeats. Returns the slice plus the
   * total count and a hasMore flag.
   */
  listIcons(offset: number, limit: number): Promise<Icons8Page>;
}
