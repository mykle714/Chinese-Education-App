-- Migration 71: Create the `icons8` table
--
-- Stores icons8 icons that have actually been DOWNLOADED into the app, alongside
-- the metadata icons8's v5 search API returns for each icon. The icon's own raw
-- bytes (SVG/PNG) are kept in `assetBytes` so the app never has to re-fetch from
-- img.icons8.com once an icon is downloaded.
--
-- Identity is the icons8-assigned `id` (a stable string used to build the
-- img.icons8.com URLs), used directly as the natural primary key so re-downloading
-- the same icon upserts in place rather than duplicating.
--
-- Field source: GET https://search.icons8.com/api/iconsets/v5/search  (icon object).
-- Columns down to `previewUrl` mirror that response shape one-to-one; the remaining
-- columns are local download bookkeeping. (The docs also list isFree/isExternal/
-- sizeInBytes, but the live v5 API does not return them, so they are intentionally
-- omitted.)
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS icons8 (
    -- ── icons8 v5 search-API fields (response shape) ──
    "icons8Id"         TEXT    PRIMARY KEY,               -- API `id`,            e.g. '120341'
    name               TEXT    NOT NULL,                  -- API `name`,          e.g. 'Cat'
    "commonName"       TEXT,                              -- API `commonName` slug, e.g. 'cat-emoji'
    category           TEXT,                              -- API `category`,      e.g. 'Emoji'
    subcategory        TEXT,                              -- API `subcategory`,   e.g. 'Animals & Nature'
    platform           TEXT,                              -- API `platform` / design style, e.g. 'emoji'
    "isColor"          BOOLEAN NOT NULL DEFAULT FALSE,    -- API `isColor`
    "isAnimated"       BOOLEAN NOT NULL DEFAULT FALSE,    -- API `isAnimated` (absent in response => false)
    "isExplicit"       BOOLEAN NOT NULL DEFAULT FALSE,    -- API `isExplicit`
    "authorId"         TEXT,                              -- API `authorId` (often empty string)
    "authorApiCode"    TEXT,                              -- API `authorApiCode`, e.g. 'icons8'
    "sourceFormat"     TEXT,                              -- API `sourceFormat`,  e.g. 'svg'
    "previewUrl"       TEXT,                              -- API `previewUrl` (img.icons8.com preview link)

    -- ── local download bookkeeping ──
    "assetBytes"       BYTEA,                             -- raw downloaded icon file (svg/png bytes); NULL until downloaded
    "downloadedFormat" TEXT,                              -- format actually downloaded: 'svg' | 'png'
    "downloadedSize"   INTEGER,                           -- px size requested for raster downloads; NULL for svg
    "downloadedAt"     TIMESTAMP,                         -- when `assetBytes` was fetched; NULL = metadata only
    "createdAt"        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT icons8_downloaded_format_check
        CHECK ("downloadedFormat" IS NULL OR "downloadedFormat" IN ('svg', 'png'))
);

-- Lookup helpers: humans browse by category/platform, and `commonName` is the
-- stable slug we'd dedupe/search on.
CREATE INDEX IF NOT EXISTS idx_icons8_category    ON icons8(category);
CREATE INDEX IF NOT EXISTS idx_icons8_platform    ON icons8(platform);
CREATE INDEX IF NOT EXISTS idx_icons8_common_name ON icons8("commonName");

COMMENT ON TABLE icons8 IS
  'Downloaded icons8 icons plus their v5 search-API metadata. Columns through "previewUrl" mirror the icons8 GET /api/iconsets/v5/search icon object; "assetBytes"/"downloaded*"/"createdAt" are local download bookkeeping. PK = icons8-assigned string id.';
