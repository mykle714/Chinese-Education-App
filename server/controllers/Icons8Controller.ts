import { Request, Response } from 'express';
import { IIcons8DAL } from '../dal/interfaces/IIcons8DAL.js';
import { searchIcons } from '../services/Icons8FetchService.js';

/**
 * Icons8Controller
 *
 * GET /api/icons8/:iconId/image
 *   returns: the raw icon image (svg/png) stored in icons8.assetBytes, with a
 *   long-lived immutable Cache-Control so the browser/<img> caches it forever.
 *
 * Used by the discover flow: each DiscoverCard carries an `iconId`, and the client
 * renders the icon via <img src="/api/icons8/<iconId>/image">. The route is public
 * (no auth) on purpose — an <img> tag cannot attach an Authorization header, and
 * the icons themselves are non-sensitive public artwork.
 *
 * TODO(cdn): This serves icon bytes straight out of Postgres (icons8.assetBytes).
 * That's the interim approach — once we stand up our own CDN/object store, push the
 * downloaded bytes there at download time and serve a CDN URL instead of streaming
 * BYTEA through the app server (keeps the DB/dumps lean and offloads delivery). When
 * that lands, DiscoverCard should carry the CDN URL directly and this endpoint can go.
 */
export class Icons8Controller {
  constructor(private icons8DAL: IIcons8DAL) {}

  /** Map a stored downloadedFormat to its HTTP Content-Type. */
  private contentTypeFor(format: string | null): string {
    switch (format) {
      case 'svg': return 'image/svg+xml';
      case 'png': return 'image/png';
      // Unknown/NULL format: let the browser sniff rather than mislabel.
      default: return 'application/octet-stream';
    }
  }

  /**
   * GET /api/icons8?offset=&limit=
   *   returns: { icons: [{ id, name }], total, hasMore } — one page of the icon
   *   catalog for the avatar picker's infinite scroll. Each icon's bytes are fetched
   *   separately via getIconImage. Auth-gated (only logged-in users pick avatars).
   */
  async listIcons(req: Request, res: Response): Promise<void> {
    try {
      // Default page size 48; DAL clamps offset/limit to safe bounds.
      const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
      const limit = parseInt(String(req.query.limit ?? '48'), 10) || 48;

      const page = await this.icons8DAL.listIcons(offset, limit);
      res.json(page);
    } catch (err: any) {
      console.error('[Icons8Controller] listIcons error:', err);
      res.status(500).json({ error: err?.message || 'Failed to list icons' });
    }
  }

  /**
   * GET /api/icons8/search?term=&offset=&limit=
   *   returns: { icons: [{ id, name }], hasMore } — a page of live icons8 search
   *   results for the custom card icon layout's "add icon" dialog. Auth-gated.
   *
   * The search response carries ids + names only (no image URL), so the client
   * previews each tile directly from the icons8 CDN (img.icons8.com/?id=...) and
   * only downloads+caches the SVG on select (POST /api/icons8/:iconId/ensure).
   */
  async searchIcons(req: Request, res: Response): Promise<void> {
    try {
      const term = String(req.query.term ?? '').trim();
      if (!term) {
        res.json({ icons: [], hasMore: false });
        return;
      }
      const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
      // Clamp the page size to keep each batch of CDN <img> loads light on mobile.
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '48'), 10) || 48, 1), 48);

      const { icons, total } = await searchIcons(term, { offset, amount: limit });
      res.json({
        icons: icons.map((i) => ({ id: i.id, name: i.name })),
        hasMore: offset + icons.length < total,
      });
    } catch (err: any) {
      console.error('[Icons8Controller] searchIcons error:', err);
      res.status(502).json({ error: err?.message || 'Icon search failed' });
    }
  }

  /**
   * POST /api/icons8/:iconId/ensure
   *   Ensures the icon's SVG is cached locally (downloads from icons8 if missing) so
   *   it can be served by GET /api/icons8/<id>/image. Idempotent. Auth-gated; called
   *   when a user selects a search result for the custom card icon layout.
   *   returns: { id } on success, 404 when icons8 has no such icon.
   */
  async ensureIcon(req: Request, res: Response): Promise<void> {
    try {
      const iconId = String(req.params.iconId || '').trim();
      if (!iconId) {
        res.status(400).json({ error: 'iconId is required' });
        return;
      }
      const cached = await this.icons8DAL.ensureCached(iconId);
      if (!cached) {
        res.status(404).json({ error: 'Icon not found' });
        return;
      }
      res.json({ id: iconId });
    } catch (err: any) {
      console.error('[Icons8Controller] ensureIcon error:', err);
      res.status(502).json({ error: err?.message || 'Failed to cache icon' });
    }
  }

  async getIconImage(req: Request, res: Response): Promise<void> {
    try {
      const iconId = String(req.params.iconId || '').trim();
      if (!iconId) {
        res.status(400).json({ error: 'iconId is required' });
        return;
      }

      const asset = await this.icons8DAL.getAssetById(iconId);
      // Missing row OR not-yet-downloaded (assetBytes NULL) both surface as 404.
      if (!asset) {
        res.status(404).json({ error: 'Icon not found' });
        return;
      }

      res.setHeader('Content-Type', this.contentTypeFor(asset.downloadedFormat));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Length', String(asset.assetBytes.length));
      res.end(asset.assetBytes);
    } catch (err: any) {
      console.error('[Icons8Controller] getIconImage error:', err);
      res.status(500).json({ error: err?.message || 'Failed to load icon' });
    }
  }
}
