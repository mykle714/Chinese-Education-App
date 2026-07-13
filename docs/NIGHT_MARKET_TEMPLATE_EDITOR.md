# Night Market Template Editor

> **Status: IMPLEMENTED (first slice).** A validator-only, **desktop-only** authoring
> surface for Night Market templates. It currently authors the **terrain + street +
> communal + placeholder + condition + house** slice of a template (light-grass /
> dark-grass / street / communal-walkable / placeholder / condition masks + placed
> houses on a rectangular board), across multiple **versions** of a name. Placeholders
> are authored today only as a **per-cell mask** (the rectangle-with-id
> `placeholderAreas` structure, asset map, conditional cell-class rules and edge
> signatures — see [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)) are **not
> yet authorable** and will extend the same `definition` JSONB.
>
> **Versions.** One template *name* owns several numbered **versions** (migration 108,
> one DB row per `(name, version)`). All versions of a name share one board size and one
> **placeholder** layout (the shared occupant slots); they differ in terrain / streets /
> decor / the **condition mask**. Version 0 is the base and the single source of truth
> for the shared placeholder — the placeholder tool + eraser are **locked to version 0**;
> higher versions inherit it read-only. The **condition mask is the inverse**: it is a
> per-version overlay **disabled on version 0** and allowed only on higher versions (the
> server rejects a version-0 save carrying condition cells). Placement will pick a version
> per the conditional cell-class rules (see [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)).

This is the tool that produces the template definitions the placement + street-graph
systems in [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md) will consume.

---

## What it does

- A validator opens **Home → Template Editor** (the hub row is shown only when
  `user.isValidator`) → `/night-market/template-editor`.
- The board is a **rectangular `W×H` dirt plateau** (free-farm tileset). The
  validator paints **mask layers** + decor and Saves under a name.
- **Header:** **Load** (dropdown of existing template names → loads version 0), **Clear**
  (empties all masks; keeps the inherited placeholder on versions above 0), **Delete**
  (hard-deletes the WHOLE template — every version — from the DB; disabled until one is
  loaded/saved), **Properties** (popup: version dropdown + New version · width / length /
  name / optional **description**), **Save** (POST — **upsert by `(name, version)`**:
  creates or overwrites the active version's row). The **Load** dropdown lists each name
  with its dims · version count · **author** (version 0's creator) and, on a second line,
  its **description**.
- **Load / Save / overwrite guard:** Save upserts by `(name, version)`, so it can
  *overwrite*. The accidental-overwrite guard is the **Properties rename gate**: it
  refuses any name that already exists **except** the one currently loaded/saved
  (`loadedName`). So Save can only overwrite a template that was deliberately **Loaded**;
  renaming a loaded template to a free name is a "save as". Loading over an unsaved board
  first confirms.
- **Versions (Properties popup):** a **Version** dropdown lists the name's versions;
  selecting another **reloads it from the last saved state** (unsaved edits are discarded
  after a warn — you must Save before switching). **New version** copies the current board
  into the next version number (enabled only once the template's version 0 is saved and
  there are no pending edits). Name is locked once a template has >1 version (a rename
  would orphan the others); dimensions are locked above version 0 (versions share a size).
- **Left tool palette:** Light grass · Dark grass · Street · Communal · Placeholder ·
  Condition · House · Surface decor · Common decor · Trees · Erase, plus a **grid toggle**
  and the **communal-**, **placeholder-**, and **condition-highlight view toggles**. The
  **Placeholder** tool is disabled unless the active version is 0.
- **Keyboard hotkeys** (shown as a corner badge on each button + in its tooltip;
  `HOTKEY_TO_TOOL` + the keydown effect in `TemplateEditorPage.tsx` are authoritative):
  terrain **Q** light grass / **W** dark grass / **E** street; masks **A** communal /
  **S** placeholder / **D** condition; decor **Z** house / **X** surface / **C** common /
  **V** trees; **Space** erase; view toggles **1** grid / **2** communal / **3**
  placeholder / **4** condition. Hotkeys are suppressed while the Properties dialog is
  open or a text field is focused (so typing a name never paints), and respect the same
  gating as the buttons (S ignored above version 0; a view-toggle key is a no-op while
  its tool is active and force-showing the tint).
- **Mouse:** hover highlights the cell under the cursor; **left-drag paints** the
  active tool; **middle/right-drag pans**; **wheel zooms** (integer steps).

### Mask semantics

| Layer | Painted by | Rendered as | Rules |
|---|---|---|---|
| Light grass | Light grass tool | `lightGrass_*` caps + grass-boundary overlays | — |
| Dark grass | Dark grass tool | `darkGrass_*` caps/overlays (over light) | **Independent mask** — dark and light are separate; painting dark does **not** add light. The "dark renders only over light" rule is applied at **render time** (`buildEditorField` intersects dark ∩ light), so a dark cell painted off the light patch is kept as data but simply doesn't render |
| Street | Street tool | **planks** (`plank_*`), overriding the grass surface | The street-walkable mask that street recovery will consume; **overwrites any decor** at the cell; **clears any communal** flag (mutually-exclusive walkability class) |
| Communal | Communal tool | **no sprite** — a translucent violet **highlight tint** only (like the nmp grass overlay) | The **communal-walkable** class (parks/plazas). A pure walkability annotation, so it does **not** feed surface/plank/decor rendering; **clears any street** flag (mutually-exclusive). Coexists with grass **and flush surface (family) decor** (a park is grass + flowers + communal), but is **mutually exclusive with BLOCKING objects** — a **house** or **common/tree decor**: painting one of those clears communal on the cell, and painting communal onto a cell that already holds one is **silently refused** (no-op). |
| Placeholder | Placeholder tool (**version 0 only**) | **no sprite** — a translucent cyan **highlight tint** only | Marks **placeholder-area** cells (slots a future unlock occupant fills — see [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)). An **override overlay**, not a walkability class, so it has **no** mutual-exclusion and may overlap any layer freely. **Shared across all versions** of a name (owned by version 0): the tool + eraser are disabled above version 0, which inherit it read-only. This per-cell mask is the first-slice shape; the rectangle-with-id `placeholderAreas` structure is a later evolution. |
| Condition | Condition tool (**versions above 0 only**) | **no sprite** — a translucent orange **highlight tint** only | Marks **condition-mask** cells — a **per-version** override overlay (the conditional cell-class annotation that differs between versions). It may be painted **only on a street or placeholder cell** (the two cell kinds whose class can switch between versions); painting elsewhere is a silent no-op. Removing that substrate **cascades the condition away** — painting communal over the street, or erasing the street/placeholder, clears the condition on that cell (unless the cell still carries the other substrate). It is the **inverse of placeholder's version rule**: the tool + hotkey are disabled on **version 0** (the base carries no conditional cells), and the server rejects a version-0 save that carries any. |
| House | House tool | one **`House.png`** sprite seated on its footprint (rendered by `EditorTerrainLayer` from the `houses` anchor set) | A **4×5** object (4 cells along isoX/E–W × 5 along isoY/N–S), keyed by its FRONT (near, min-iso) corner and extending +isoX/+isoY. **One click drops the whole house**; the cursor becomes a 4×5 footprint preview tinted **green** (placeable) or **red** (blocked). Placement is **refused whole** unless every footprint cell is in-bounds and free of a street or another house. It **overwrites decor and any communal flag** under its footprint but **never a street**; once placed, **street and decor cannot overwrite it** |
| Decor (×3) | Surface / Common / Trees tools | one decor sprite on top of the finished tile | Per-cell CHOICE, not a boolean. Each tap **cycles** the cell through THAT tool's rotation (see below); **does nothing on a street cell or under a house**. **Common decor and Trees are BLOCKING objects** — placing them **clears any communal flag** on the cell; **Surface (family) decor is flush and exempt** (it may coexist with communal). |
| — | Erase tool | — | Peels only the **top-most** layer present at the cell (stack order **house > decor > street > dark > light > communal > condition > placeholder**); erasing ANY footprint cell of a house removes the **whole house** in one pass; the spriteless annotations (communal, condition, placeholder) peel **last** (only once the cell is visually bare). Two rules govern the spriteless layers: **a toggled-off tint is never an erase target** (you can't erase a hidden communal/condition/placeholder — the eraser falls through to the next visible layer), and **erasing a street/placeholder cell cascade-clears any condition on it** (a condition may live only on a street/placeholder cell). **Placeholder is never erased above version 0** (inherited, read-only); clearing a fully-stacked cell takes several passes |

**Highlight view toggles.** The communal, placeholder, and condition tints each have
their own persisted palette toggle. A toggle is **forced on while its tool is active**
(auto-reveal what you are painting) and disabled in that state; when any other tool is
active, the overlay **honors the toggle setting**. Each button always reflects what is
actually shown.

### Decor tools & rotations

Decor is split into **three separate tools**, each its own `editorDecorRotation(category, surface)`
rotation. A decor tool is a **cycler**, not a stamp: tapping a cell with no decor
places that tool's first sprite; each further tap advances (wrapping). Because a cell
holds only ONE decor sprite, switching decor tools (or a cell whose surface changed)
finds the current sprite absent from the new rotation (`indexOf → −1`) and restarts at
that rotation's first entry — so the three tools swap the single decor slot between
categories rather than stacking.

| Tool (`category`) | Depends on surface? | Rotation |
|---|---|---|
| **Surface decor** (`family`) | yes | light-grass cell → `lightGrassDecor_1..7`; dark-grass → `darkGrassDecor_1..5`; dirt → `dirtDecor_1..4` |
| **Common decor** (`common`) | no | `decor_1..4` |
| **Trees** (`tree`) | no | `tree_1..2`, `largeTree_1..4` (**stumps excluded**) |

**No PROCEDURAL decor** is generated (unlike the live nmp terrain) — only decor the
validator explicitly paints shows. Changing the **width or height** in Properties
**regenerates (clears)** the board — gated behind a confirmation dialog. Changing
**only the name** leaves the painting intact.

---

## Architecture (by layer)

### Data / model — `src/engine/market/farmTerrain.ts`
- `EditorMasks` — the painted layers: seven `Set<"col,row">`
  (light/dark/street/communal/placeholder/**condition**/**houses**) + a
  `decor: Map<"col,row", url>` (per-cell decor CHOICE, not a boolean set). `communal`,
  `placeholder`, and `condition` are spriteless annotations (a walkability class, an
  occupant-slot override, and a per-version conditional annotation respectively) —
  intentionally absent from `EditorTile`/`buildEditorField`; the view highlights them
  straight from the mask. `houses` holds each placed house's FRONT-corner anchor cell
  (a 4×5 footprint); it renders as a sprite (not per-tile) but DOES suppress `decorUrl`
  under its footprint in `buildEditorField` (houses overwrite decor).
- **`src/engine/market/house.ts`** — the shared, PURE house geometry consumed by BOTH
  the editor and the live nmp house: footprint dims (`HOUSE_FOOTPRINT_X`=4,
  `HOUSE_FOOTPRINT_Y`=5), the measured `HOUSE_ANCHOR` (base-diamond front corner), and
  the `houseFootprintCells` / `houseFits` / `houseOccupiedCells` / `houseAnchorCovering`
  helpers used by the page's placement rules and the viewer's footprint preview. It
  imports no asset, so pure layers (`farmTerrain`) can depend on it.
- `editorSurfaceAt(masks, col, row)` → `'dirt' | 'lightGrass' | 'darkGrass'` (takes just
  `Pick<EditorMasks,'lightGrass'|'darkGrass'>`, the two masks it reads) and
  `editorDecorRotation(category, surface)` (`category: DecorCategory` = `'family' |
  'common' | 'tree'`) → the ordered decor-URL list for one of the three decor tools
  (`family` uses the cell surface's own set; `common` the shared `decor_*`; `tree` the
  tileset's `getTreeUrls()`). These back the decor tools' cycle.
- `buildEditorField(width, height, masks)` → `EditorTile[]` — the **mask-driven**
  twin of the procedural `buildFarmField`. Reuses the exact same neighbour →
  overlay-cap resolution (`resolveTileSurfaceUrls` / `resolveTileDarkSurfaceUrls`),
  so *"recompute overlay caps on each paint"* is just a rebuild. Applies the "dark
  renders only over light" rule at **render time** — intersecting the independent dark
  and light masks (dark painted off light is kept as data but not rendered) — and adds
  each tile's `street` flag + 4-cardinal `streetNeighbours` + resolved `decorUrl`
  (**null on street cells** — streets overwrite decor).
- `resolveTileStreetPlankUrl(tile)` — a simple plank autotiler (N–S vs E–W by
  neighbours; far-face `northEdge`/`eastEdge` cap; variation 1). The full crossing
  tileset is the deferred *tileset scheme* open question in
  [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md).

### View — `src/features/nightmarket/`
- `EditorTerrainLayer.tsx` — a trimmed `FarmTerrainLayer`: dirt slab + light/dark
  grass stack, a **plank** on every street cell (street overrides grass), and the
  **painted `decorUrl`** sprite on top (no *procedural* scatter). Driven by a `tiles`
  prop, plus a `houseCells` prop — one `House.png` sprite per placed house, anchored
  on the base-diamond front corner (`HOUSE_ANCHOR`) and z-sorted like a large decor by
  its front-corner foot cell (so terrain in front still occludes it).
- `TemplateEditorViewer.tsx` — the Pixi host (copied from `MarketEngineViewer`).
  Cell picking (`localToCell`) inverts the 2:1 iso projection against each tile's
  surface-diamond **centre**. Left-drag paints (idempotent per cell), middle/right
  drag pans, wheel zooms; a `HoverOverlay` diamond tracks the cursor. Rebuilds the
  field via `buildEditorField` whenever the board/masks change. A shared
  `MaskTintOverlay` tints each cell of a spriteless mask (gated per layer): communal
  cells **violet** (`showCommunal`), placeholder cells **cyan** (`showPlaceholder`),
  condition cells **orange** (`showCondition`) — their only visualization, mirroring the
  nmp `GrassOverlay`. When `activeTool ===
  'house'`, the single-cell `HoverOverlay` is swapped for a `HousePreviewOverlay` that
  draws the 4×5 footprint under the cursor, tinted green (placeable) / red (blocked by
  bounds, a street, or another house) — the "selector changes to a 4×5" preview.

### Page — `src/features/nightmarket/TemplateEditorPage.tsx`
Owns board size + name + the mask layers + active tool + `loadedName` (the loaded/saved
template name — the one name the rename gate permits AND the Delete target) + the
**version** state (`version`, `availableVersions`, `isNewVersion`) + a `dirty` flag.
`paintCell` resolves the active tool into a functional mask update (dark and light are
independent; the decor tools cycle; erase peels the top layer). The **placeholder tool
and eraser are gated to version 0** (`versionRef`), since placeholder is shared/owned by
v0. The **Load** button fetches the per-name list into a dropdown; picking one confirms
(if `dirty`), loads version 0, and applies its dims/name/masks + `loadedName` +
`availableVersions`. **Save** calls `submitTemplate` for the active `(name, version)` and
clears `dirty`, with a create-vs-overwrite snackbar. **Delete** (enabled only when
`loadedName` is set) confirms and hard-deletes the **whole name** (all versions), then
resets to a blank v0. `PropertiesDialog` hosts the **version dropdown** (switching calls
`handleSwitchVersion`, which — per the reload-on-switch model — warns on `dirty` then
reloads the target from the server, discarding unsaved edits) and the **New version**
button (`handleNewVersion` copies the current board into the next version number; enabled
only when the template is saved and not `dirty`). It also validates dims (`[2, 60]`) and
runs the **rename gate** (a name must be free UNLESS it equals `loadedName`); name is
locked with >1 version, dims are locked above version 0. Bounces non-validators to Home
(UX gate; the backend is the real boundary).

### Client API — `src/features/nightmarket/templateEditorApi.ts`
`checkTemplateNameAvailable(name)`, `listTemplates()` (one summary **per name** with
`versionCount`), `loadTemplate(name, version)` (returns the version + its
`availableVersions`), `submitTemplate({name,version,width,height,masks})` (returns
`{overwritten, version}`), `deleteTemplate(name)` (deletes the whole name), and
`definitionToMasks(def)` (rebuilds the editor Sets incl. `condition` + decor Map,
resolving decor stems back to URLs via `freeFarmTileset.get`). `masksToDefinition`
serializes the Sets to sorted arrays and the decor map to a `cell → sprite STEM` object
(URLs → stable stems via `freeFarmTileset.stemOf`, so a stored definition survives asset
re-fingerprinting). Uses `authHeader()` + `API_BASE_URL`.

### Backend — validator-gated, upsert-by-(name, version)
- **Service** `server/services/NightMarketTemplateService.ts` — `assertValidator`
  (403), `isNameAvailable` (free = no version of the name exists), `listTemplates`
  (one row **per name** via `DISTINCT ON (name)` + a `versionCount`), `getTemplate(name,
  version)` (404 if missing; returns `availableVersions`; **merges version 0's
  placeholder** for versions > 0), `deleteTemplate(name)` (deletes every version; 404 if
  none), `saveTemplate({name,version,…})` (validates dims + masks incl. `condition`,
  in-bounds cells; **street ⊥ communal**; each **house** anchor's 4×5 footprint
  in-bounds, no house/street overlap; `cleanDecor` guards decor under streets/houses;
  **communal ⊥ blocking objects** — a save is rejected if any communal cell sits under a
  house or carries common/tree decor, via `isBlockingDecorStem` (stem-naming classifier
  duplicated from the client tileset, kept in sync by hand). These coincidence checks
  mirror the editor's paint-time guards and re-run at save so a client bug can't persist
  an illegal overlap). **Placeholder is single-
  sourced on version 0:** saving version > 0 requires an existing version 0, must match
  its board size, and **strips placeholder** before storing (the shared value is merged
  back into the response). Conversely the **condition mask is rejected on version 0** (a
  version-0 save carrying condition cells throws a `ValidationError`, surfaced to the
  author). Save is an **upsert on `UNIQUE(name, version)`**
  (`ON CONFLICT (name, version) DO UPDATE`) preserving `id`/`createdBy`/`createdAt`; it
  returns `overwritten` via the `xmax <> 0` idiom. **No server-side overwrite guard** —
  the client rename gate is the guard. House footprint dims (4×5) are duplicated here
  (`HOUSE_FOOTPRINT_X`/`_Y`) since the server can't import the client's `house.ts`.
- **Controller** `server/controllers/NightMarketTemplateController.ts` — maps
  `DALError.statusCode` (403/400/404) to the response.
- **Routes** `server/routes/nightMarketTemplateRoutes.ts` — `GET
  /api/nightmarket-templates` (list per name), `GET …/name-available?name=`, `GET
  …/load?name=&version=` (load one version), `POST /api/nightmarket-templates`
  (save/upsert with `version`), `DELETE /api/nightmarket-templates?name=` (delete whole
  name). The `name-available` + `load` routes are static paths (no `/:id`), registered
  after the bare list route. Wired in `server/dal/setup.ts` + `server/server.ts`.

### Storage — table `nightmarkettemplatedefinitions` (migrations 107 + 108 + 109)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | VARCHAR(120) | part of the **`UNIQUE(name, version)`** key (migration 108); the name-availability target |
| `version` | INTEGER | **migration 108**, default 0. 0-based; version 0 is the base + single source of truth for the shared placeholder |
| `width` / `height` | INTEGER | board dims (cols / rows) — shared across a name's versions |
| `description` | TEXT (nullable) | **migration 109**. Optional author-written blurb shown in the Load menu. **Shared per name**, single-sourced on version 0 (NULL on higher versions, merged from v0 on read) — same rule as the placeholder. Authored via the Properties popup (locked above version 0). |
| `definition` | JSONB | `{ lightGrass, darkGrass, street, communal, placeholder, condition, houses }` cell lists + `decor` (`cell → sprite-stem` object) now; grows to the full template. `placeholder` is populated only on version 0 (empty on higher versions as stored; merged from v0 on read). Schemaless JSONB, so `communal`/`placeholder`/`condition`/`houses` were added without a migration (older rows read them as `[]`). |
| `createdBy` | UUID FK → users(id) | authoring validator |
| `createdAt` / `updatedAt` | TIMESTAMPTZ | |

This is the **catalog of template DEFINITIONS** — distinct from the *proposed*
per-user **placement** table `nightmarkettemplates` in
[NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md) (which records *where* a
placed instance sits for an account). It also supersedes, for authored content, that
doc's "template definitions live in a code registry" assumption — validators now
author into the DB; how the runtime placement/graph path reads these (DB vs. a
promote-to-code step) is a downstream decision.

---

## Deferred / not yet built

- **Rest of the template:** placeholder areas are authored today only as a **flat
  per-cell mask** — the rectangle-with-id `placeholderAreas` grouping (each area's
  `id` + `col,row,width,height`, which the placement/occupancy systems need) is not
  yet built. Asset map, conditional cell-class rules, and edge signatures are also
  unbuilt — all extend the same `definition` JSONB.
- **Versioning / history:** multiple numbered **versions** per name ARE supported
  (migration 108), but Save overwrites a version in place (no revision history within a
  version); Delete is a hard delete of the whole name. Switching versions reloads from
  the last save (no in-memory hold of unsaved versions).
- **Full street tileset:** only N–S / E–W planks with far-face caps; crossings/
  T-junctions use the default E–W plank.
- **Consumption:** nothing reads `nightmarkettemplatedefinitions` yet — placement +
  street recovery ([NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)) are the
  next consumers.

## Dependency references

- Data: `src/engine/market/farmTerrain.ts` (`EditorMasks`, `buildEditorField`,
  `resolveTileStreetPlankUrl`, `editorSurfaceAt`, `editorDecorRotation`),
  `src/engine/market/freeFarmTileset.ts` (`getPlank`, `getDecorUrls`, `getTreeUrls`),
  `src/engine/market/house.ts` (footprint dims + `HOUSE_ANCHOR` + `houseFootprintCells` /
  `houseFits` / `houseOccupiedCells` / `houseAnchorCovering`; also consumed by the live
  nmp `src/features/nightmarket/HouseLayer.tsx`).
- View/page: `src/features/nightmarket/{EditorTerrainLayer,TemplateEditorViewer,TemplateEditorPage}.tsx`,
  `templateEditorApi.ts`.
- Routing/nav: `src/App.tsx` (`/night-market/template-editor`),
  `src/pages/HomePage.tsx` (validator-gated hub row).
- Backend: `server/services/NightMarketTemplateService.ts`,
  `server/controllers/NightMarketTemplateController.ts`,
  `server/routes/nightMarketTemplateRoutes.ts`, `server/dal/setup.ts`,
  `server/server.ts`, `database/migrations/107-create-nightmarket-template-definitions.sql`,
  `database/migrations/108-add-version-to-nightmarket-template-definitions.sql`,
  `database/migrations/109-add-description-to-nightmarket-template-definitions.sql`.

Related: [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md),
[NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md),
[NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md).
