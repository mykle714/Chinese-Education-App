/**
 * Icons8FetchService — thin server-side client for the public icons8 HTTP API.
 *
 * LAYER: service layer. Wraps the two complementary icons8 endpoints so both the
 * request path (Icons8Controller: live search + download-on-select for the custom
 * card icon layout, see docs/CARD_ICON_LAYOUT.md) and the offline backfill script
 * (server/scripts/backfill/backfill-icons.js) share one definition of the filters,
 * auth, and response shapes.
 *
 *   - search   https://search-app.icons8.com/api/iconsets/v7/search
 *       returns ids + metadata (isColor / isExplicit / authorId / sourceFormat …)
 *       but NOT the previewUrl or the SVG bytes.
 *   - getById  https://api-icons.icons8.com/publicApi/icons/icon?id=<id>
 *       returns previewUrl + the raw `svg` string but NOT the search-only metadata.
 *
 * AUTH: the public API key (ICONS8_API_KEY) is passed as the `token` query param on
 * both endpoints.
 */

// The public API key. Read lazily (per call) so the module can be imported before
// dotenv runs; throws only when an actual call is attempted without a token.
function icons8Token(): string {
  const token = process.env.ICONS8_API_KEY;
  if (!token) {
    throw new Error('ICONS8_API_KEY is not set; cannot call the icons8 API');
  }
  return token;
}

// Browser-ish headers the icons8 edge expects; auth is the `token` query param.
const ICONS8_HEADERS: Record<string, string> = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  origin: 'https://icons8.com',
  referer: 'https://icons8.com/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
};

/** One icon as returned by the search endpoint (search-only metadata shape). */
export interface Icons8SearchIcon {
  id: string;
  name: string;
  commonName?: string;
  category?: string;
  subcategory?: string;
  platform?: string;
  isColor?: boolean;
  isExplicit?: boolean;
  authorId?: string;
  authorApiCode?: string;
  sourceFormat?: string;
}

/** A page of search results plus the total match count (for hasMore paging). */
export interface Icons8SearchResult {
  icons: Icons8SearchIcon[];
  /** Total number of icons matching the term across all pages (countAll). */
  total: number;
}

/** One icon as returned by getById (previewUrl + raw svg, no search metadata). */
export interface Icons8FullIcon {
  id: string;
  name: string;
  commonName?: string;
  categoryName?: string;
  subcategoryName?: string;
  platform?: string;
  isAnimated?: boolean;
  previewUrl?: string;
  /** Raw SVG markup; stored as the icon's assetBytes. */
  svg?: string;
}

/**
 * SEARCH the icons8 catalog for `term`. The filters here MUST stay in lockstep with
 * the representative-icon backfill (backfill-icons.js) so the custom-layout picker
 * surfaces the same catalog slice we link as default card icons: color style, no
 * animation, English-indexed.
 */
export async function searchIcons(
  term: string,
  opts: { offset?: number; amount?: number } = {}
): Promise<Icons8SearchResult> {
  const params = new URLSearchParams({
    isAnimated: 'false',
    style: 'color',
    language: 'en',
    analytics: 'false',
    saveAnalytics: 'false',
    amount: String(opts.amount ?? 48),
    isOuch: 'true',
    replaceNameWithSynonyms: 'true',
    offset: String(opts.offset ?? 0),
    term,
    token: icons8Token(),
  });
  const url = `https://search-app.icons8.com/api/iconsets/v7/search?${params.toString()}`;

  const res = await fetch(url, { headers: ICONS8_HEADERS });
  if (!res.ok) {
    throw new Error(`icons8 search HTTP ${res.status} for term "${term}"`);
  }
  const data: any = await res.json();
  const icons: Icons8SearchIcon[] = Array.isArray(data?.icons) ? data.icons : [];
  // countAll is the total across all pages; used to compute hasMore upstream.
  const total = Number(data?.parameters?.countAll ?? icons.length) || icons.length;
  return { icons, total };
}

/**
 * getIconById — full metadata + raw SVG bytes for an icon id. Returns null on a
 * not-found / unsuccessful response.
 */
export async function getIconById(iconId: string): Promise<Icons8FullIcon | null> {
  const params = new URLSearchParams({ id: iconId, token: icons8Token() });
  const url = `https://api-icons.icons8.com/publicApi/icons/icon?${params.toString()}`;

  const res = await fetch(url, { headers: ICONS8_HEADERS });
  if (!res.ok) {
    throw new Error(`icons8 getIconById HTTP ${res.status} for id "${iconId}"`);
  }
  const data: any = await res.json();
  if (!data?.success || !data?.icon) return null;
  return data.icon as Icons8FullIcon;
}
