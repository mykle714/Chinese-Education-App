# Night Market Template Sandbox

> **Status: IMPLEMENTED (first slice).** A template-author-only, **desktop-only** scratch
> surface for tiling catalog templates together freely, to preview how they compose. Sibling
> to the [Template Editor](./NIGHT_MARKET_TEMPLATE_EDITOR.md) (which *authors* templates); the
> sandbox only *arranges existing* ones. Reached from **Home → Template Sandbox** (the hub row
> is shown only when `user.isTemplateAuthor` — migration 115) → `/night-market/template-sandbox`.

This is a **freeform** authoring aid: overlaps are allowed, there is **no** placement legality
(edge-signature matching / no-overlap) and **no** unlock economy — it is hand-edited scratch
state, unrelated to the per-user runtime layout (`nightmarkettemplatelocations`) that the
minute-point economy drives. It is also the **first surface that composites multiple templates
on one grid** (the runtime placement renderer is not built yet — see
[NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md](./NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md)), so its viewer
is a self-contained multi-template renderer.

---

## What it does

- **Add** (header) opens a visual **picker** — the SAME gallery the editor's *Load* button uses
  (`TemplateLoadGallery`), plus a **dimension filter** (Width / Length dropdowns, populated from
  the catalog's distinct sizes, `Any` = no constraint). Clicking a card drops that template into
  the sandbox at the gallery's previewed version (`chosenVersion` — the most-conditions layout).
  New drops are **staggered** by a few cells so repeated adds don't perfectly stack on the origin.
- **Click** a placed template to **select** it (a yellow footprint outline marks the selection);
  clicking empty space clears the selection.
- **Drag** a selected template to **move** it — snapped to whole isometric cells, so seams line
  up. The move is committed (persisted) on pointer release; a plain click never moves it.
- **Version** dropdown (header) is enabled only when a tile is selected; it lists that template
  **name's** versions and switches the selected **instance's** rendered version
  (`activeVersion`) — each placed tile carries its own version independently.
- **Lock / Unlock** (header, enabled when selected) toggles the selected tile's `locked` flag. A
  **locked** tile cannot be dragged (its selection outline turns red and a 🔒 shows in the
  subtitle); it can still be selected, version-switched, and deleted. Persisted (migration 117), so
  the lock survives reloads.
- **Houses On / Off** (header, enabled when selected) toggles `settings.showHouses` for the
  selected tile: **On** renders an occupant house in **every placeholder area** of that template,
  **Off** renders none. This **replaces** the editor's condition-driven rule on this surface — the
  sandbox no longer decides per-area from the version's condition cells, it is all-or-nothing per
  placement. Default (setting absent) is **On**. Persisted in the `settings` bag (migration 118).
- **Delete** (header, enabled when selected) removes the selected tile from the sandbox
  (confirmation dialog).
- **Pan** — left-drag empty space, or middle/right-drag anywhere. **Zoom** — mouse wheel
  (integer steps). Same camera model as the template editor viewer.

### Deleting a template from the catalog also clears it here

When a template author **Delete Template**s a name in the editor, every author's sandbox
placement of that `templateName` is also removed (the catalog row is gone, so a placement of it
can no longer render). This is a **manual cascade** in the service layer
(`NightMarketTemplateService.deleteTemplate` → `NightMarketSandboxDAL.deleteByTemplateName`),
because `templateName` is **not** a foreign key (definitions are unique on `(name, version)`, so
the name alone is not referenceable). It is **best-effort**: a sandbox-cleanup failure is logged
but does not roll back a successful catalog delete.

---

## Architecture (by layer)

### Storage — table `nightmarkettemplatesandbox` (migration 116)

A **clone of `nightmarkettemplatelocations`** (migration 112, the runtime layout) with two
deliberate differences: **no unique-corner index** (overlaps allowed) and **no relationship to
the unlock economy** (scratch state only).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `userId` | UUID FK → users(id) ON DELETE CASCADE | the author |
| `templateName` | VARCHAR(120) | catalog key — `nightmarkettemplatedefinitions.name` (a name, **not** an FK) |
| `activeVersion` | INTEGER | this instance's rendered version (per-tile switchable) |
| `offsetCol` / `offsetRow` | INTEGER | SW (min-iso / near) corner offset in **template-cell units** (`isoX = offsetCol + col`, `isoY = offsetRow + row`). May be negative. |
| `locked` | BOOLEAN NOT NULL DEFAULT false | **migration 117** — when true, the tile cannot be dragged/moved (a move-guard only; select / version-switch / delete still work). The move SQL guards `locked = false` as a server-side backstop. |
| `settings` | JSONB NOT NULL DEFAULT `'{}'` | **migration 118** — the per-placement **render/view preference bag**. One generic column instead of a new boolean per switch, so future author-facing toggles need no migration. Keys are whitelisted by `NightMarketSandboxService.SETTINGS_SCHEMA` (unknown key ⇒ 400); patches **merge** (`settings \|\| $3::jsonb`). Current keys: `showHouses` (boolean, absent = true). Structural facts the server reasons about (`offsetCol/Row`, `activeVersion`, `locked`) stay real columns. |
| `createdAt` | TIMESTAMPTZ | insertion time = chronological order (also the depth-tiebreak) |

Indexes: `("userId","createdAt")` (per-author read order) and `("templateName")` (fast
catalog-delete cascade). **No** `UNIQUE(userId, offsetCol, offsetRow)` — that is the one index
from the runtime table intentionally dropped.

### Backend — template-author-gated CRUD

- **Service** `server/services/NightMarketSandboxService.ts` — `assertTemplateAuthor` (403,
  mirrors `NightMarketTemplateService`), then `listPlacements` / `addPlacement` / `movePlacement`
  / `setPlacementVersion` / `setPlacementLock` / `setPlacementSettings` (validated against the
  `SETTINGS_SCHEMA` key whitelist) / `removePlacement`, plus `removePlacementsForTemplate(name)` (the
  catalog-delete cascade, **not** author-gated — the caller already gated the catalog delete).
  Validates name (≤120), version (non-negative int), and offsets (integers within a generous
  ±10000 sanity clamp — offsets are freeform, so this is a bound, not a placement rule).
- **DAL** `server/dal/implementations/NightMarketSandboxDAL.ts`
  (+ `interfaces/INightMarketSandboxDAL.ts`) — pure persistence: `findByUser`, `insert`,
  `updatePosition` (guarded by `locked = false`), `updateVersion`, `updateLock`,
  `updateSettings` (jsonb **merge**, so a one-key patch keeps the rest), `deleteById`
  (all scoped to `userId`), and `deleteByTemplateName` (deliberately **not** user-scoped — the
  catalog is global).
- **Controller** `server/controllers/NightMarketSandboxController.ts` — thin; maps
  `DALError.statusCode` (403/400/404) to the response.
- **Routes** `server/routes/nightMarketSandboxRoutes.ts` — `GET /api/nightmarket-sandbox`,
  `POST /api/nightmarket-sandbox`, `PATCH …/:id/position`, `PATCH …/:id/version`,
  `PATCH …/:id/lock`, `PATCH …/:id/settings`, `DELETE …/:id`. All `authenticateToken`. Wired in `server/dal/setup.ts`
  + `server/server.ts`.
- **Cascade wiring:** the sandbox DAL is injected into `NightMarketTemplateService`
  (`setup.ts`), whose `deleteTemplate` calls `deleteByTemplateName` after removing the catalog
  rows.

### View — `src/features/nightmarket/TemplateSandboxViewer.tsx`

A Pixi host modeled on `TemplateEditorViewer`'s camera (pan/zoom, `MIN/MAX/DEFAULT_ZOOM`,
wheel-zoom-at-point). Renders **each placement** as its own `sortableChildren` container
translated to `isoToScreen(offsetCol, offsetRow)` — since `isoToScreen` is linear, a local cell
`(c,r)` lands at the correct global position — holding an `EditorTerrainLayer` (from
`buildEditorField`) + `TemplateMaskOverlays`. **The sandbox previews the finished look**: it
passes every tint flag off (`showStreet/showCommunal/showPlaceholder/showCondition = false`) and
drives houses through `TemplateMaskOverlays`' `houseMode` prop — `'filled'` (default, = the
editor/gallery's condition-driven filled-slot rule), `'all'` (every placeholder area gets a house),
or `'none'`. The sandbox passes `'all'` / `'none'` from the placement's `settings.showHouses`
(`SandboxItem.showHouses`), so a tile shows either all its placeholder houses or none, independent
of the version's condition cells; no walkability/placeholder/condition tint ever shows. Placements draw **back-to-front** by `(offsetCol + offsetRow)` (chronological
tiebreak); cross-template occlusion is per-template (a whole board is one depth) — acceptable for
a freeform sandbox. Hit-testing inverts the projection to a **global** cell (`localToGlobalCell`,
the editor's `localToCell` minus bounds) and returns the front-most placement whose footprint
contains it. Left-drag on a tile moves it (cell-snapped, committed on release); left-drag on
empty / middle / right pans. A `SelectionOutline` draws the selected footprint's four diamond
edges in the save-yellow accent.

### Page — `src/features/nightmarket/TemplateSandboxPage.tsx`

A `LeafPage` (title "Template Sandbox", back → Home). Owns the placement list, the selection, and
a **def cache** — the loaded `{width,height,masks,availableVersions}` for each
`(templateName, version)` pair actually in use, keyed `name@version`, fetched on demand via
`loadTemplate` so **any** version of **any** template can render. Bounces signed-in non-authors
to Home (UX gate; the backend is the real boundary — same stance as the editor). The header hosts
the version dropdown, Lock, Houses On/Off, Delete, and Add ↔ Cancel; the picker is an overlay (`TemplateLoadGallery`
+ the dimension filter) shown over the scene. Moves / version-switches / deletes are **optimistic**
(local update first, roll back + snackbar on failure).

### Client API — `src/features/nightmarket/templateSandboxApi.ts`

`listSandboxPlacements`, `addSandboxPlacement`, `moveSandboxPlacement`,
`setSandboxPlacementVersion`, `setSandboxPlacementLock`, `setSandboxPlacementSettings`,
`removeSandboxPlacement` + the `SandboxPlacement` / `SandboxSettings` types and
`SANDBOX_SETTING_DEFAULTS` (client-side defaults for absent settings keys). Uses
`authHeader()` + `API_BASE_URL`. The picker + render inputs reuse the editor's
`listTemplateGallery` / `loadTemplate` / `definitionToMasks` (`templateEditorApi.ts`).

### Routing / nav

- `src/App.tsx` — `/night-market/template-sandbox` (`ProtectedRoute allowPublic`, same rationale
  as the editor route: a template author may be a public account).
- `src/pages/HomePage.tsx` — the `isTemplateAuthor`-gated "Template Sandbox" hub row.

---

## Deferred / not yet built

- **No placement legality.** By design there is no seam matching / no-overlap enforcement — the
  sandbox is a scratch surface. If a "snap to legal seam" aid is wanted later, it would consume
  the same `server/dal/shared/templatePlacement.ts` geometry the runtime spawn uses.
- **Depth at overlaps** is per-template, not per-cell — a whole board sorts at one depth, so two
  overlapping templates can occlude imperfectly along the seam.
- **No copy/duplicate, no multi-select, no undo** — one selected tile at a time.

## Dependency references

- Data/view/page: `src/features/nightmarket/{TemplateSandboxViewer,TemplateSandboxPage}.tsx`,
  `templateSandboxApi.ts`; reuses `EditorTerrainLayer.tsx`, `TemplateEditorViewer.tsx`
  (`TemplateMaskOverlays`), `TemplateLoadGallery.tsx`, `templateEditorApi.ts`
  (`listTemplateGallery`/`loadTemplate`/`definitionToMasks`),
  `src/engine/market/{isometric,farmTerrain}.ts`.
- Routing/nav: `src/App.tsx`, `src/pages/HomePage.tsx`.
- Backend: `server/services/NightMarketSandboxService.ts`,
  `server/controllers/NightMarketSandboxController.ts`,
  `server/routes/nightMarketSandboxRoutes.ts`,
  `server/dal/{interfaces/INightMarketSandboxDAL,implementations/NightMarketSandboxDAL}.ts`,
  `server/dal/setup.ts`, `server/server.ts`,
  `server/services/NightMarketTemplateService.ts` (delete cascade),
  `server/types/nightMarket.ts` (`TemplateSandboxRow`),
  `database/migrations/116-create-nightmarket-template-sandbox.sql`,
  `database/migrations/117-add-locked-to-nightmarket-template-sandbox.sql`,
  `database/migrations/118-add-settings-to-nightmarket-template-sandbox.sql`.

Related: [NIGHT_MARKET_TEMPLATE_EDITOR.md](./NIGHT_MARKET_TEMPLATE_EDITOR.md),
[NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md),
[NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md).
