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

export interface IIcons8DAL {
  /**
   * Fetch a single icon's downloaded bytes + format by its icons8 id (PK).
   * Returns null when the icon row is missing OR has not been downloaded yet
   * (`assetBytes` IS NULL), so callers can 404 cleanly.
   */
  getAssetById(icons8Id: string): Promise<Icons8Asset | null>;
}
