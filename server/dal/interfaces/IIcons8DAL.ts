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

  /**
   * Ensure an icon's SVG bytes are cached locally so GET /api/icons8/<id>/image can
   * serve it. If the row is missing or has no bytes yet, fetches the icon from the
   * live icons8 API (getById) and inserts/updates it. Idempotent. Used by the custom
   * card icon layout's "download on select" step (docs/CARD_ICON_LAYOUT.md).
   * Returns true when the icon ends up cached, false when icons8 has no such icon.
   */
  ensureCached(icons8Id: string): Promise<boolean>;

  /**
   * Return the cached default icon-search response for a det entry, warming it on a
   * miss. The "default query" is the card's English meaning, computed client-side and
   * passed in as `term`; the response (first page of icons8 ids+names) is cached on
   * the shared det row (`defaultIconResults`, migration 87) so the picker can show
   * results instantly on open. See docs/CARD_ICON_LAYOUT.md.
   *
   * - Cache hit  -> returns the stored list (may be []), no icons8 call.
   * - Cache miss -> if `term` is non-empty, runs ONE live icons8 search, writes the
   *   result back to det, and returns it; if `term` is empty (or no det row matches),
   *   returns [] without writing.
   *
   * @param language vet/det language code ('zh' | 'es'); selects the det table.
   * @param entryKey det `word1` headword.
   * @param pos      saved vet POS (Spanish disambiguation); NULL for Chinese.
   * @param term     client-computed default search term (iconSearchTerm()).
   */
  getOrWarmDefaultIconResults(
    language: string,
    entryKey: string,
    pos: string | null,
    term: string
  ): Promise<Icons8ListItem[]>;
}
