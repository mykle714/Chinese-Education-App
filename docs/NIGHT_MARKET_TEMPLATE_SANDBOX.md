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

All header controls are **editor-style 40×40 icon buttons with a corner hotkey badge**, grouped by
scope and tinted per group (view · selection · layout) — the same chrome as the template editor's
palette, shared via `src/features/nightmarket/editorButtonStyles.tsx` (`HotkeyBadge`,
`paletteBtnSx`, `headerBtnSx`). Every button has a **bare-key hotkey**, dispatched by the keydown
effect in `TemplateSandboxPage.tsx`; hotkeys are suppressed while the picker overlay is open or
focus is in a text field. Keep the badges and that effect in sync.

| Key | Action | Group |
|---|---|---|
| `G` | Grid on/off | view |
| `S` | Street overlay on/off | view |
| `V` | Cycle the selected tile's version | selection |
| `H` | Cycle placeholder-area render mode (selected) | selection |
| `L` | Lock/unlock (selected) | selection |
| `D` | Delete selected (no confirmation) | selection |
| `A` | Add (open the picker) | layout |
| `I` | Iterate (run the growth algorithm one step) | layout |
| — | Clear the whole sandbox (**confirmed**) | layout |

**Clear deliberately has no hotkey**: it destroys the entire layout, so it must stay a considered
click behind its confirmation, never a stray keypress.

- **Add** (`A`) opens a visual **picker** — the SAME gallery the editor's *Load* button uses
  (`TemplateLoadGallery`), plus a **dimension filter** (Width / Length dropdowns, populated from
  the catalog's distinct sizes, `Any` = no constraint). Clicking a card drops that template into
  the sandbox at the gallery's previewed version (`chosenVersion` — the most-conditions layout).
  New drops are **staggered** by a few cells so repeated adds don't perfectly stack on the origin.
  The sandbox passes `houseMode="all"` to the gallery, so each card previews the template's
  most-conditions version **fully occupied** — the same look a freshly-added tile has here (new
  placements default to `houseMode: 'all'`). The editor's Load picker keeps the default
  `'filled'` (condition-driven) thumbnails; the prop is `TemplateLoadGallery.houseMode`.
- **Click** a placed template to **select** it (a yellow footprint outline marks the selection);
  clicking empty space clears the selection.
- **Drag** a selected template to **move** it — snapped to whole isometric cells, so seams line
  up. The move is committed (persisted) on pointer release; a plain click never moves it.
- **Version** (`V`, enabled when a selected tile has 2+ versions) **cycles** to the next version of
  that template **name**, wrapping at the end, and switches the selected **instance's** rendered
  version (`activeVersion`) — each placed tile carries its own version independently. The button
  face reads the current version (`v2`). (This replaced the former Version dropdown: cycling covers
  the handful of versions a name has and keeps the toolbar uniform.)
- **Lock / Unlock** (`L`, enabled when selected) toggles the selected tile's `locked` flag. A
  **locked** tile cannot be dragged (its selection outline turns red and a 🔒 shows in the
  subtitle); it can still be selected, version-switched, and deleted. Persisted (migration 117), so
  the lock survives reloads.
- **Houses** (`H`, enabled when selected) **cycles** `settings.houseMode` for the selected tile
  through three states:
  1. **`all`** — an occupant house in **every placeholder area** of that template (the default
     finished look; setting absent = `all`);
  2. **`placeholder`** — **no houses**, and the placeholder AREAS are **tinted** instead, so the
     author can see exactly where the occupant slots sit;
  3. **`none`** — neither.

  This **replaces** the editor's condition-driven filled-slot rule on this surface: the sandbox
  never decides per-area from the version's condition cells, it is an explicit per-placement
  choice. Persisted in the `settings` bag (migration 118).
  **`houseMode` replaced the original boolean `showHouses`** — `settings` is a generic jsonb bag,
  so no migration was needed, but any row still carrying `showHouses` is ignored and falls back to
  `all` (acceptable: scratch state). The server whitelist is now enum-aware
  (`NightMarketSandboxService.SETTINGS_SCHEMA` → `{ type, values }`, unknown value ⇒ 400).
  Render path: `SandboxItem.houseMode` → `TemplateMaskOverlays` (`showPlaceholder` for the tint,
  `houseMode='all'|'none'` for the houses) in `TemplateSandboxViewer.tsx`.
- **Delete** (`D`, enabled when selected) removes the selected tile from the sandbox
  **immediately — no confirmation**. The sandbox is a scratch surface, so re-adding one template is
  cheap and a modal only slows down iteration. (Clear is the confirmed one.)
- **Clear** (no hotkey, enabled when the sandbox is non-empty) removes **every** placement, behind a
  **confirmation dialog** — unlike a single delete it destroys the whole layout (every tile's
  position, version and settings), which is expensive to rebuild.
  Server: `DELETE /api/nightmarket-sandbox` → `NightMarketSandboxService.clearPlacements` →
  `NightMarketSandboxDAL.deleteAllForUser` (scoped to the caller).
- **Iterate** (`I`) runs the **live runtime growth algorithm one step** over the sandbox layout and
  places what it chose — the sandbox's "what would the game actually do here?" control.
  It delegates to `NightMarketPlacementService.planNextPlacement`, the **same planner** the real
  continent grows with (docs/NIGHT_MARKET_TEMPLATES.md § "Placement algorithm"), extracted out of
  `spawnTemplate` precisely so the preview can never drift from production. Behaviour:
  an **empty** sandbox seeds the starter hub at the origin (mirroring
  `NightMarketWorldService.seedHubPlacement`); otherwise the plan is persisted **at the version the
  planner chose** (its most-conditioned candidate version — the runtime instead stores v0 and lets
  recompute-on-read settle it, but the sandbox has no selector pass); a `null` plan (no legal
  candidate at any exposed anchor) opens a **modal** ("No legal placement") rather than a
  snackbar — it is the *answer* the author pressed the button for, not an error, and a toast is
  easy to miss while looking at the scene.
  Server: `POST /api/nightmarket-sandbox/iterate` → `NightMarketSandboxService.iteratePlacement`.
- **Street overlay** (`S`, always enabled) tints the **street-walkable cells of every placement**.
  The sandbox otherwise previews the *finished* look with all mask tints off (placeholder and
  condition tints are never shown here) — street is the one exception, because cross-seam street
  alignment is exactly what an author is judging when tiling. It is a **view-only, page-local,
  view-WIDE** preference (default **Off**), not per-placement and not persisted. Threaded
  `TemplateSandboxPage` → `TemplateSandboxViewer` (`showStreet` prop) → `SandboxScene` →
  `PlacedTemplate` → `TemplateMaskOverlays.showStreet`.
- **Grid On / Off** (`G`, always enabled) toggles the isometric **cell grid** over the whole
  surface: a fine green line per cell with a **red major line every 8 cells**, for eyeballing
  seams and spacing across placements. Unlike the editor's board-bounded grid, the sandbox has no
  board — the overlay spans the **currently visible cell range** (recomputed from pan/zoom/canvas
  size each render) and its major lines (every **8** cells, matching the editor's interval) are anchored at
  **global cell 0** — the editor counts its majors inward from the board's NE corner, but the
  sandbox has no board corner, so the origin is its reference (positive-modulo, so the
  lattice is continuous through negative coordinates). It is a **view-only, page-local** preference
  (default **Off**) — not per-placement, not persisted.
  Code: `SandboxGridOverlay` + `visibleGridBounds` in
  `src/features/nightmarket/TemplateSandboxViewer.tsx`; toggle state + button in
  `src/features/nightmarket/TemplateSandboxPage.tsx` (`.template-sandbox-grid-btn`).
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
| `settings` | JSONB NOT NULL DEFAULT `'{}'` | **migration 118** — the per-placement **render/view preference bag**. One generic column instead of a new boolean per switch, so future author-facing toggles need no migration. Keys are whitelisted by `NightMarketSandboxService.SETTINGS_SCHEMA` (unknown key ⇒ 400); patches **merge** (`settings \|\| $3::jsonb`). Current keys: `houseMode` (`'all' \| 'placeholder' \| 'none'`, absent = `'all'`; replaced the original boolean `showHouses`, which is now ignored where still present). Structural facts the server reasons about (`offsetCol/Row`, `activeVersion`, `locked`) stay real columns. |
| `createdAt` | TIMESTAMPTZ | insertion time = chronological order (also the depth-tiebreak) |

Indexes: `("userId","createdAt")` (per-author read order) and `("templateName")` (fast
catalog-delete cascade). **No** `UNIQUE(userId, offsetCol, offsetRow)` — that is the one index
from the runtime table intentionally dropped.

### Backend — template-author-gated CRUD

- **Service** `server/services/NightMarketSandboxService.ts` (injected with
  `NightMarketPlacementService` for `iteratePlacement`; constructed after it in `setup.ts`) — `assertTemplateAuthor` (403,
  mirrors `NightMarketTemplateService`), then `listPlacements` / `addPlacement` / `movePlacement`
  / `setPlacementVersion` / `setPlacementLock` / `setPlacementSettings` (validated against the
  `SETTINGS_SCHEMA` key whitelist) / `removePlacement`, plus `removePlacementsForTemplate(name)` (the
  catalog-delete cascade, **not** author-gated — the caller already gated the catalog delete).
  Validates name (≤120), version (non-negative int), and offsets (integers within a generous
  ±10000 sanity clamp — offsets are freeform, so this is a bound, not a placement rule).
- **DAL** `server/dal/implementations/NightMarketSandboxDAL.ts`
  (+ `interfaces/INightMarketSandboxDAL.ts`) — pure persistence: `findByUser`, `insert`,
  `updatePosition` (guarded by `locked = false`), `updateVersion`, `updateLock`,
  `updateSettings` (jsonb **merge**, so a one-key patch keeps the rest), `deleteById`,
  `deleteAllForUser` (the Clear action)
  (all scoped to `userId`), and `deleteByTemplateName` (deliberately **not** user-scoped — the
  catalog is global).
- **Controller** `server/controllers/NightMarketSandboxController.ts` — thin; maps
  `DALError.statusCode` (403/400/404) to the response.
- **Routes** `server/routes/nightMarketSandboxRoutes.ts` — `GET /api/nightmarket-sandbox`,
  `POST /api/nightmarket-sandbox`, `PATCH …/:id/position`, `PATCH …/:id/version`,
  `PATCH …/:id/lock`, `PATCH …/:id/settings`, `POST …/iterate`, `DELETE /api/nightmarket-sandbox`
  (clear all — registered **before** the `:id` delete), `DELETE …/:id`. All `authenticateToken`. Wired in `server/dal/setup.ts`
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
passes the communal/condition tints off always, `showStreet` from the view-wide Street toggle, and
`showPlaceholder` from the placement's `houseMode === 'placeholder'` and
drives houses through `TemplateMaskOverlays`' `houseMode` prop — `'filled'` (default, = the
editor/gallery's condition-driven filled-slot rule), `'all'` (every placeholder area gets a house),
or `'none'`. The sandbox drives it from the placement's `settings.houseMode`
(`SandboxItem.houseMode`): `'all'` → houses everywhere, `'placeholder'` → no houses but
`showPlaceholder` tint on, `'none'` → neither — all independent of the version's condition cells; the communal and condition tints never show. Placements draw **back-to-front** by `(offsetCol + offsetRow)` (chronological
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
the icon toolbar (Grid · Street · Version · Houses-cycle · Lock · Delete · Add · Iterate · Clear) plus the picker's
Cancel; the picker is an overlay (`TemplateLoadGallery`
+ the dimension filter) shown over the scene. Moves / version-switches / deletes are **optimistic**
(local update first, roll back + snackbar on failure).

### Client API — `src/features/nightmarket/templateSandboxApi.ts`

`listSandboxPlacements`, `addSandboxPlacement`, `moveSandboxPlacement`,
`setSandboxPlacementVersion`, `setSandboxPlacementLock`, `setSandboxPlacementSettings`,
`removeSandboxPlacement`, `clearSandboxPlacements`, `iterateSandboxPlacement` + the `SandboxPlacement` / `SandboxSettings` types and
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
