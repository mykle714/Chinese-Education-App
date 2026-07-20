# Night Market Template Editor

> **Status: IMPLEMENTED (first slice).** A validator-only, **desktop-only** authoring
> surface for Night Market templates. It currently authors the **terrain + street +
> communal + placeholder + condition** slice of a template (terrain-1 /
> terrain-2 / street / communal-walkable / placeholder / condition masks + decor
> on a rectangular board), across multiple **versions** of a name. The **terrain
> masks are named generically** (terrain 1 / terrain 2) so their art can be hot-swapped
> later; they currently render as light / dark grass. **Street is a spriteless
> walkability tint** (a warm-tan highlight), not a plank sprite — it behaves like the
> other tint masks (communal / condition). Placeholders are authored as **fixed-size
> dropped areas** (4×5 / 5×4 / 4×10 / 10×4 `{col,row,w,h}` records — see the placeholder tool
> below and [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)); the asset map,
> conditional cell-class rules and edge signatures are **not yet authorable** and will
> extend the same `definition` JSONB.
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

- A **template author** opens **Home → Template Editor** (the hub row is shown only
  when `user.isTemplateAuthor` — migration 115, a flag SEPARATE from `isValidator`
  which now gates only dictionary data-approval) → `/night-market/template-editor`.
- The board is a **rectangular `W×H` dirt plateau** (free-farm tileset). The
  author paints **mask layers** + decor and Saves under a name.
- **Header:** a **Version** dropdown (switches the active version — see *Versions* below),
  **Guidelines** (opens a read-only popup of the authoring rules the editor does
  **not** enforce — see *Authoring guidelines* below), **Load** (opens the visual **Load gallery** — see *Load gallery* below), **Clear**
  (empties all masks; keeps the inherited placeholder on versions above 0), **Delete
  Version** (hard-deletes only the CURRENT version's row — disabled on **version 0**, the
  base, and until a template is loaded; a never-saved new version is simply discarded
  locally, then version 0 is reloaded as the surviving board), **Delete Template**
  (hard-deletes the WHOLE template — every version — from the DB; disabled until one is
  loaded/saved), **Properties** (popup: New version · width / length —
  **dropdowns** of the selectable board sizes `DIM_OPTIONS` = `2,4,…,20` (every +2 up to 20)
  then every +8 to `44`; a legacy size outside the list is folded in so it still shows · name — for a
  fresh/unnamed template the field is **pre-filled from the server** with a free default
  `template{index}` (`GET …/suggest-name`; a loaded template keeps its own name) · optional
  **description**), **Save** (POST — **upsert by `(name, version)`**:
  creates or overwrites the active version's row).
- **Load gallery** (`TemplateLoadGallery.tsx`): pressing **Load** replaces the canvas with a
  scrolling grid of **thumbnails** — every template rendered as a real, scaled isometric board
  (terrain / decor + the spriteless mask tints + filled-slot occupant houses, via the shared
  `EditorTerrainLayer` + the exported `TemplateMaskOverlays`). The whole grid lives in **one** Pixi `Application` (a
  single WebGL context — a per-tile Application would exhaust the browser's ~16-context budget).
  Each card is captioned `name · W×H · v{chosenVersion}[ of {versionCount}] · {conditionCount}
  cond`. Per the author's request each thumbnail previews the **version with the most condition
  cells** (the richest layout), chosen server-side (ties → highest version; a single-version
  template previews version 0, which has none). Clicking a card loads **that** previewed
  version (`loadTemplate(name, chosenVersion)`), confirming first if the current board is dirty.
  While the gallery is open the tool palette is hidden and the **Load** button becomes a
  **Cancel** button that closes it without loading. Backed by `GET …/gallery` →
  `listTemplateGallery` (one entry per name, carrying the chosen version's full definition with
  v0's placeholder/description merged in).
- **Load / Save / overwrite guard:** Save upserts by `(name, version)`, so it can
  *overwrite*. The accidental-overwrite guard is the **Properties rename gate**: it
  refuses any name that already exists **except** the one currently loaded/saved
  (`loadedName`). So Save can only overwrite a template that was deliberately **Loaded**;
  renaming a loaded template to a free name is a "save as". Loading over an unsaved board
  first confirms.
- **Versions:** a **Version** dropdown in the **header** lists the name's versions;
  selecting another **reloads it from the last saved state** (unsaved edits are discarded
  after a warn — you must Save before switching). **New version** (in the Properties popup)
  copies the current board
  into the next version number (enabled only once the template's version 0 is saved and
  there are no pending edits). Name is locked once a template has >1 version (a rename
  would orphan the others); dimensions are locked above version 0 (versions share a size).
- **Left tool palette** (each color-coded group is a **horizontal row of buttons**; groups
  stack vertically and each box shrinks to fit its own buttons). Rows mirror the keyboard,
  top→bottom: **(1)** a view-control row — the **grid toggle** (own group) beside the
  mask-view toggles (own group, in mask-tool order: **street-**, **communal-**,
  **placeholder-**, **condition-highlight**, and **reusing the mask-tool icons**); **(2)** the
  masks group (Street · Communal · Placeholder · Condition — all spriteless tints) sharing the
  row with the **terrain group** (Terrain 1 · Terrain 2) to its right; **(3)** the decor group
  (Surface decor · Common decor · Trees · **Wood panel**); **(4)** the bottom row — history (Undo · Redo),
  the clipboard group (Copy · Paste), and the **Eraser** toggle (red). The **Placeholder** tool is
  disabled unless the active version is 0. The **Eraser is a MODIFIER, not a tool**: it toggles
  on top of the currently-selected tool and, while on, inverts that tool's paint into an erase
  of **only that tool's own layer** (see the Erase row below). It is **scoped to the tool it
  was enabled on** — switching to a different tool **auto-clears** it (an `activeTool` effect) —
  and the hover diamond turns **red** while it is on. The toggle (and its **B** hotkey) is
  **disabled for the copy/paste tools** (`toolSupportsEraser`) — region tools that never route
  through the erase branch, so the modifier has no meaning there.
- **Keyboard hotkeys** (shown as a corner badge on each button + in its tooltip;
  `HOTKEY_TO_TOOL` + the keydown effect in `TemplateEditorPage.tsx` are authoritative). Keys
  mirror the physical keyboard, one palette row per keyboard row: number row **`** grid, then
  view toggles **1** street / **2** communal / **3** placeholder / **4** condition; top letter
  row masks **Q** street / **W** communal / **E** placeholder / **R** condition followed by
  terrain **T** terrain 1 / **Y** terrain 2; home row decor **S** surface /
  **D** common / **F** trees / **G** wood panel; bottom row **Z** undo / **X** redo / **C** copy / **V** paste /
  **B** eraser modifier. **B** toggles the **eraser modifier** (not a tool — handled
  directly in the keydown effect, not via `HOTKEY_TO_TOOL`). **Space** is a per-tool
  modifier: it **cycles the placeholder DROP size** (4×5 → 5×4 → 4×10 → 10×4 → 4×5) while the
  placeholder tool is active, or **cycles the selected variant** of any **decor** tool
  (surface / common / trees / wood panel — the ghost previews it); a no-op / swallowed
  otherwise, so it never scrolls the page.
  Hotkeys are suppressed while the
  Properties dialog is open or a text field is focused (so typing a name never paints), and
  respect the same gating as the buttons (E ignored above version 0). A view-toggle key (or
  its button) flips its **independent** show-state even while that tool is active — the tool
  force-shows its tint for display, but that override never mutates the toggle.
- **Mouse:** hover highlights the cell under the cursor; **left-drag paints** the
  active tool; **middle/right-drag pans**; **wheel zooms** (integer steps).
- **Rectangle selection (street / communal tools + terrain 1 / terrain 2 + Wood panel):**
  these tools do **not** drag-paint. Instead they use a **press-drag-release**
  selection: **pointer-down anchors one corner**, and **releasing the button fills the whole
  rectangle** between the anchor and the cell under the pointer at release (a plain click,
  down + up on one cell, fills a 1×1 selection). While dragging, the cursor **rubber-bands
  the pending rectangle** live in the layer's own tint colour — the mask's tint for the
  annotation tools, the terrain group's green for terrain, a wood brown for the plank
  (Wood panel) tool (**red** while the eraser
  modifier is on). Releasing just off the canvas falls back to the last on-board cell;
  releasing fully off-board abandons the selection. **Escape** cancels a pending drag;
  switching tools also abandons it. Each filled cell is routed through the same paint path as a single click,
  so all the mask invariants/cascades (mutual exclusion, blocking-decor refusal, condition
  upkeep) still apply — including under the eraser modifier, where the rectangle erases.
  Implemented in `TemplateEditorViewer` (`rectangleMode` prop, `RectPreviewOverlay`,
  `rectCells`); the parent turns it on for those tools and reuses `paintCell` per cell.
- **Placeholder DROP (placeholder tool):** the placeholder tool is **not** a rectangle
  tool and **not** a drag-paint — it **drops a fixed-size area**. The
  cursor is a footprint of the current drop size (**4×5 / 5×4 / 4×10 / 10×4**, cycled with
  **Space**), anchored at the hovered near corner and extending +isoX/+isoY, tinted
  **green** (droppable) or **red** (refused). **One click drops the whole area**; the drop
  is **refused** unless the whole footprint is in-bounds and overlaps **no existing area**
  (occupant slots stay distinct). Under the **eraser** modifier, one click **removes the
  whole area** under the cursor. Version-0-only (like before). Implemented in
  `TemplateEditorViewer` (`placeholderSize` prop, `PlaceholderPreviewOverlay`,
  `PlaceholderAreaOverlay` for the per-area outline) + `TemplateEditorPage`'s `paintCell`
  placeholder branch; geometry lives in `src/engine/market/placeholderArea.ts` (the source of
  truth for the area shape + `PLACEHOLDER_SIZES`). The server can't import that module (it's
  outside the `server/` Docker build context), so it mirrors the shape + sizes in
  `server/dal/shared/placeholderArea.ts`; the guard test
  `src/__tests__/placeholderAreaSync.test.ts` fails the build if the two drift.
- **Filled-slot occupant preview (houses):** a placeholder area whose footprint contains any
  **condition-mask** cell reads as an **OCCUPIED** slot for that version, so the editor previews
  its occupant exactly as the runtime does — a **house**, or **two adjacent houses** for a
  4×10 / 10×4 slot — **in place of the placeholder + condition tint** (the orange condition tint
  is stripped on those cells; **border-street** condition cells, outside any placeholder, still
  tint). Since the manual condition tool paints only placeholder cells on **versions > 0**,
  version 0 (no conditions) shows plain cyan slots. **The occupant houses ride the CONDITION view
  toggle** (`showCondition` — a filled slot *is* a condition): toggling conditions off hides the
  houses, and their slots fall back to the normal cyan placeholder tint so they don't vanish.
  (`TemplateMaskOverlays` exposes an optional **`houseMode`** prop — `'filled'` (the default,
  derived from `showCondition`, i.e. exactly this coupling) / `'all'` / `'none'`; the
  [Template Sandbox](./NIGHT_MARKET_TEMPLATE_SANDBOX.md) passes `'all'` or `'none'` from its
  per-placement Houses toggle, so there the houses ignore conditions entirely.)
  Implemented in `TemplateEditorViewer`'s
  `TemplateMaskOverlays` (`PlaceholderOccupantHouses` + the filled/empty area split), so both the
  editor scene and the Load gallery show it. The house-tiling geometry is
  `occupantHousesForArea` in `src/engine/market/house.ts`, shared with the runtime
  `PlaceholderHouseLayer` (a 4×5 `House.png` footprint tiles each slot; 5-wide slots use the
  h-flipped 5×4 transpose). **There is no manual House tool** — the only houses the editor draws
  are these occupant previews.

### Authoring guidelines (not enforced)

The **Guidelines** header button opens `GuidelinesDialog` (a stateless read-only popup in
`TemplateEditorPage.tsx`). It lists the layout rules the editor does **not** validate — the
author must honor them by hand. Keep this list and `AUTHORING_GUIDELINES` in the code in sync:

1. Only streets of **width 3 or 6** may touch the template edge; other widths are interior-only.
2. The **maximum street width is 6**.
3. Outwards-facing streets go at **prescribed edge spots**: measuring from either bottom edge,
   the first street's bottom edge sits **2 cells** from the edge, then every **8 cells** after.

### Mask semantics

| Layer | Painted by | Rendered as | Rules |
|---|---|---|---|
| Terrain 1 | Terrain 1 tool | `lightGrass_*` caps + grass-boundary overlays (art is hot-swappable) | — |
| Terrain 2 | Terrain 2 tool | `darkGrass_*` caps/overlays (drawn on top of terrain 1; art is hot-swappable) | **Fully independent mask** — terrain 1 and terrain 2 are completely separate; painting terrain 2 does **not** add terrain 1, and terrain 2 renders on its own cells **whether or not terrain 1 is underneath**. Their only relationship is **z-order**: terrain 2 always draws on top of terrain 1 (the view stacks the dark surface above the light one). There is **no** longer any terrain2 ∩ terrain1 intersection at render time |
| Street | Street tool | **no sprite** — a translucent warm-**tan** **highlight tint** only (like communal) | The **street-walkable** class that street recovery will consume. Now a **spriteless walkability tint** (the plank sprite was removed), so it does **not** feed surface/decor rendering. **Mirrors communal exactly:** **clears any communal** flag (mutually-exclusive walkability class); **coexists with terrain and flush surface (family) decor** (the tint draws over them); but is **mutually exclusive with BLOCKING common/tree decor**: painting one of those clears street on the cell (cascade-clearing any condition), and painting street onto a cell that already holds one is **silently refused** (no-op). |
| Communal | Communal tool | **no sprite** — a translucent violet **highlight tint** only (like the nmp grass overlay) | The **communal-walkable** class (parks/plazas). A pure walkability annotation, so it does **not** feed surface/plank/decor rendering; **clears any street** flag (mutually-exclusive). Coexists with grass **and flush surface (family) decor** (a park is grass + flowers + communal), but is **mutually exclusive with BLOCKING common/tree decor**: painting one of those clears communal on the cell, and painting communal onto a cell that already holds one is **silently refused** (no-op). |
| Placeholder | Placeholder tool (**version 0 only**) | **no sprite** — translucent cyan **highlight tint** + a per-area **outline** | **Fixed-size DROPPED areas** — each a **4×5 / 5×4 / 4×10 / 10×4** `{col,row,w,h}` rectangle (occupant slots a future unlock fills — see [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)). **Space cycles the drop size**; one click drops one area (refused if it would overhang the board or overlap another area), the eraser removes a whole area. Stored as **discrete records** (not a cell mask) so **adjacent slots stay distinct**. An **override overlay**, not a walkability class, so an area may overlap any *other* layer freely, but **areas may not overlap each other**. **Shared across all versions** of a name (owned by version 0): the tool + eraser are disabled above version 0, which inherit it read-only. Each area is drawn with a bright outline (`PlaceholderAreaOverlay`) so touching slots read apart. |
| Condition | Condition tool (**versions above 0 only**) | **no sprite** — a translucent orange **highlight tint** only | Marks **condition-mask** cells — a **per-version** override overlay (the conditional cell-class annotation that differs between versions). The **manual tool paints only PLACEHOLDER cells** (painting elsewhere is a silent no-op). Border **STREET** cells get a condition **automatically at save** (see below), so at rest a condition may live on a **placeholder** cell (manual) OR a **border-street** cell (auto). Removing that substrate **cascades the condition away** — painting communal over the street, or erasing the street/placeholder, clears the condition on that cell (unless the cell still carries the other substrate). It is the **inverse of placeholder's version rule**: the tool + hotkey are disabled on **version 0** (the base carries no conditional cells), and the server rejects a version-0 save that carries any. **Auto border-street conditions (save time, versions > 0 only):** `handleSubmit` runs `withBorderStreetConditions` before POSTing — every **street cell on the board's outer edge** (col 0 / col W−1 / row 0 / row H−1) is added to the condition mask (those are the cells a neighbouring template's street can lean on, so they "matter to version selection" — see [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)). They are merged into the live board so the author sees them appear, and persist into the saved definition (idempotent — a re-save re-derives the same set; `withBorderStreetConditions` reuses the runtime's `borderStreetCells` primitive so preview and scoring agree). Version 0 sends none. Save also computes the **island count** live and shows the author the breakdown (display-only — **no persisted `conditionCount` column**, decision 2026-07-17; the runtime re-derives it at load — see [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)). |
| Decor (×4) | Surface / Common / Trees / Wood panel tools | one decor sprite on the finished tile — **`dirtDecor_*` renders BELOW the grass surfaces** (`isDirtDecorUrl` → `z = layerZ − 0.1`) so grass painted over the cell covers it; every other family renders **on top** (`z = layerZ + 0.15`) | Per-cell CHOICE, not a boolean. Each tool places its **currently-selected variant** (chosen with **Space**, previewed as a **ghost** — `DecorGhostOverlay`); a click **OVERRIDES** whatever decor/plank was on the cell (decor freely overwrites decor — **except a Wood panel refuses to bury a blocking common prop/tree**). **Common decor and Trees are BLOCKING objects** — placing them **clears any street AND communal flag** on the cell (cascade-clearing any condition on a cleared street); **Surface (family) decor and Wood panels are flush and exempt** (they coexist with street + communal). The **Wood panel** tool tiles by **rectangle** (see the rectangle-selection bullet), the others **drag-paint**. |
| — | Eraser **modifier** (B) — layered on the active tool | — | A boolean toggle (`eraseMode`), **not a tool**: while on, painting with any tool **removes only THAT tool's own layer** at the cell (never the top-most layer, never another tool's) — terrain 1/2, street, communal, condition each delete their own mask; **Placeholder** removes the whole AREA under the cursor (areas are dropped/erased atomically); a **decor** tool removes the cell's single decor sprite **only when it belongs to that tool's category** (`editorDecorCategory` vs `DECOR_TOOL_CATEGORY` — e.g. the Surface-decor eraser leaves a tree/common sprite untouched). Cascade rules mirror the paint cases: erasing a **street** cell (or a **placeholder area's** cell) cascade-clears any condition orphaned by it. The active tool **force-shows its own tint**, so you always see the layer you are erasing (no "hidden-tint" guard is needed). **Placeholder is erasable only on version 0** (inherited read-only above). **Scoped to its tool** — switching tools auto-clears it (an `activeTool` effect) — and **disabled for the copy/paste tools** (`toolSupportsEraser`, which never route through the erase branch); the hover diamond is tinted **red** while on. |

**Highlight view toggles.** The street, communal, placeholder, and condition tints each
have their own persisted palette toggle. While a tool is active its own tint layer is
**force-shown** (auto-reveal what you are painting), but the toggle **button stays clickable
and reflects its own independent state** — the force-show overrides the display without
mutating the toggle. When any other tool is active, the overlay simply **honors the toggle
setting**. **All four toggles default ON**, so the editor opens with every mask layer
visible.

### Decor tools & rotations

Decor is split into **four separate tools**, each its own `editorDecorRotation(category, surface)`
rotation. A decor tool places its **currently-selected variant**: **Space** advances the shared
`decorVariantIdx` (read modulo the active rotation's length, so it simply wraps), and the
**ghost** (`DecorGhostOverlay`) previews `rotation[idx % len]` for the hovered cell's surface
before the click. A click **OVERRIDES** any decor/plank already on the cell (a cell still holds
only ONE decor sprite; the tools no longer *cycle* a cell's existing sprite — that moved to the
Space selector). **Exception:** the **Wood panel** tool **refuses to bury a non-surface (blocking)
decor** — a common prop or a tree (`isBlockingDecorUrl`) — so a plank only lands on an empty or
surface-decor cell (it can still overwrite family/plank decor).

| Tool (`category`) | Depends on surface? | Selection (Space cycles) |
|---|---|---|
| **Surface decor** (`family`) | yes | terrain-1 cell → `lightGrassDecor_1..7`; terrain-2 → `darkGrassDecor_1..5`; dirt → `dirtDecor_1..4` (the terrain→tileset-bucket mapping is the render seam in `editorDecorRotation`) |
| **Common decor** (`common`) | no | `decor_1..4` |
| **Trees** (`tree`) | no | `tree_1..2`, `largeTree_1..4` (**stumps excluded**) |
| **Wood panel** (`plank`) | no | the **center** tiles `plank_{ns,ew}_{1..3}_center` (`editorPlankCenters`) — the flat mid-run panel in each iso orientation × board variation |

**Wood-panel autotiling.** A placed plank **stores its center tile**; the render layer
(`plankRenderUrl`, applied in `buildEditorField`'s `decorAt`) swaps that center for its far-end
**edge cap** — `eastEdge` for an `ew` panel (+isoX face), `northEdge` for an `ns` panel (+isoY
face), the only two faces the pack caps (mirrors `buildWalkway`) — wherever that far neighbour is
**not itself a plank**. So an author only ever picks the flat tile and the exposed run-ends cap
themselves. Planks are **flush / walkable** (not blocking, like family decor). Unlike the other
decor tools, Wood panel tiles by **rectangle** (`rectangleMode`), not drag-paint.

**No PROCEDURAL decor** is generated (unlike the live nmp terrain) — only decor the
validator explicitly paints shows. Changing the **width or height** in Properties
**regenerates (clears)** the board — gated behind a confirmation dialog. Changing
**only the name** leaves the painting intact.

---

## Architecture (by layer)

### Data / model — `src/engine/market/farmTerrain.ts`
- `EditorMasks` — the painted layers: six `Set<"col,row">`
  (terrain1/terrain2/**street**/communal/placeholder/**condition**) + a
  `decor: Map<"col,row", url>` (per-cell decor CHOICE, not a boolean set). `terrain1` /
  `terrain2` are the generically-named surface masks (currently light / dark grass —
  named so the art can be hot-swapped). **`street`, `communal`, `placeholder`, and
  `condition` are spriteless annotations** (two walkability classes, an occupant-slot
  override, and a per-version conditional annotation) — intentionally absent from
  `EditorTile`/`buildEditorField`; the view highlights them straight from the mask. (There
  is **no `houses` mask** — the manual House tool was removed; the only houses drawn are the
  filled-slot occupant previews, derived from placeholder + condition — see the view section.)
- **`src/engine/market/house.ts`** — the shared, PURE house geometry consumed by the live nmp
  house (`HouseLayer`) and the placeholder-occupant renderers: footprint dims
  (`HOUSE_FOOTPRINT_X`=4, `HOUSE_FOOTPRINT_Y`=5), the measured `HOUSE_ANCHOR` (base-diamond
  front corner), and `occupantHousesForArea(area)` — which tiles a placeholder area into 1–2
  `{col,row,flip}` house footprints (5-wide slots use the flipped 5×4 transpose). Shared by the
  runtime `PlaceholderHouseLayer` and the editor's occupant preview. It imports no asset, so pure
  layers (`farmTerrain`) can depend on it.
- `editorSurfaceAt(masks, col, row)` → `'dirt' | 'terrain1' | 'terrain2'` (takes just
  `Pick<EditorMasks,'terrain1'|'terrain2'>`, the two masks it reads) and
  `editorDecorRotation(category, surface)` (`category: DecorCategory` = `'family' |
  'common' | 'tree' | 'plank'`) → the ordered decor-URL list for one of the four decor tools
  (`family` maps the terrain surface → its tileset decor bucket — `terrain1`→`lightGrass`,
  `terrain2`→`darkGrass` — the render seam; `common` the shared `decor_*`; `tree` the
  tileset's `getTreeUrls()`; `plank` the wood-panel centers, `editorPlankCenters()`). These
  back the decor tools' Space-cycled variant selection + ghost.
- `editorPlankCenters()` → the flat `plank_{ns,ew}_{1..3}_center` URLs (what the Wood-panel
  tool cycles + stores); `isPlankUrl(url)` tests the `plank_*` stem; `plankRenderUrl(centerUrl,
  isPlankAt, x, y)` autotiles a stored center → its far-end `eastEdge`/`northEdge` cap where
  the +isoX/+isoY face abuts a non-plank cell (applied in `buildEditorField`'s `decorAt`).
- `editorDecorCategory(url)` → `DecorCategory` — the inverse of `editorDecorRotation`'s
  bucketing: classifies a placed decor URL back to its tool's category (`plank` / `common` /
  `tree`, else `family`). Backs the eraser modifier's per-category decor erase (a decor tool
  erases only its own category), single-sourced with `isBlockingDecorUrl`/`isPlankUrl` against
  the tileset buckets. **Planks are flush/non-blocking** (absent from `isBlockingDecorUrl`).
- `buildEditorField(width, height, masks)` → `EditorTile[]` — the **mask-driven**
  twin of the procedural `buildFarmField`. Reuses the exact same neighbour →
  overlay-cap resolution (`resolveTileSurfaceUrls` / `resolveTileDarkSurfaceUrls`),
  so *"recompute overlay caps on each paint"* is just a rebuild. Terrain 1 and terrain 2
  are **fully independent** masks (no terrain2 ∩ terrain1 intersection): each renders from
  its own cells and terrain 2 does not require terrain 1 beneath it — their only
  relationship is **z-order** (the view stacks the dark surface above the light one). It
  adds each tile's resolved `decorUrl` (never suppressed now — the street mask is a spriteless
  tint that doesn't flow through the field, and the house layer was removed).
- (The former `resolveTileStreetPlankUrl` plank autotiler was **removed** — street is now
  a spriteless walkability tint drawn straight from the mask, not a plank sprite.)

### View — `src/features/nightmarket/`
- `EditorTerrainLayer.tsx` — a trimmed `FarmTerrainLayer`: dirt slab + light/dark
  grass stack and the **painted `decorUrl`** sprite on top (no *procedural* scatter, and
  **no plank** — the street mask is a spriteless tint the viewer draws separately). Driven
  by a `tiles` prop only (the house layer was removed — filled-slot occupant houses are drawn
  by `TemplateMaskOverlays`, not here).
- `TemplateEditorViewer.tsx` — the Pixi host (copied from `MarketEngineViewer`).
  Cell picking (`localToCell`) inverts the 2:1 iso projection against each tile's
  surface-diamond **centre**. Left-drag paints (idempotent per cell), middle/right
  drag pans, wheel zooms; a `HoverOverlay` diamond tracks the cursor. Rebuilds the
  field via `buildEditorField` whenever the board/masks change. A shared
  `MaskTintOverlay` tints each cell of a spriteless mask (gated per layer): street cells
  warm-**tan** (`showStreet`), communal cells **violet** (`showCommunal`), placeholder
  cells **cyan** (`showPlaceholder`), condition cells **orange** (`showCondition`) — their
  only visualization, mirroring the nmp `GrassOverlay`. The shared `TemplateMaskOverlays` also
  renders **`PlaceholderOccupantHouses`**: any placeholder area containing a condition cell reads
  as FILLED and previews an occupant house (or two, for a 4×10/10×4 slot) in place of its
  placeholder + condition tint (those cells are stripped from the cyan/orange fills).

### Page — `src/features/nightmarket/TemplateEditorPage.tsx`
Owns board size + name + the mask layers + active tool + `loadedName` (the loaded/saved
template name — the one name the rename gate permits AND the Delete Template / Delete
Version target) + the
**version** state (`version`, `availableVersions`, `isNewVersion`) + a `dirty` flag.
`paintCell` resolves the active tool into a functional mask update (terrain 1 and terrain
2 are independent; **street mirrors communal** — mutually exclusive with communal + with
blocking common/tree decor, coexisting with terrain + family decor; the decor tools cycle). When the
**eraser modifier** (`eraseMode`) is on, `paintCell` inverts the active tool into an erase
of **only that tool's own layer** at the cell (a per-tool `switch` before the paint
`switch`; decor tools honor `editorDecorCategory` so each removes only its own category).
The **placeholder tool and eraser branch are gated to version 0** (`versionRef`), since
placeholder is shared/owned by v0. The **Load** button opens the visual **gallery**
(`TemplateLoadGallery`, fetched via `listTemplateGallery`); picking a card confirms
(if `dirty`), loads that card's previewed `chosenVersion`, and applies its dims/name/masks +
`loadedName` + `availableVersions`. While open, the **Load** button toggles to **Cancel** and
the tool palette is hidden. **Save** first (on versions > 0) runs `withBorderStreetConditions` to auto-mark every
border **street** cell as a condition — merging them into the live board and submitting the
same augmented masks (setMasks is async, so it must not rely on the state update landing
before the POST). For the author's information, the editor also computes the **condition
island count** live (via `analyzeConditions`, the same analysis the runtime uses) and shows
the breakdown ("N conditions — P placeholder, B border-street") in the Save toast + the
condition-tool tooltip. This count is **display-only — not persisted** (decision 2026-07-17:
no `conditionCount` column; the runtime re-derives it at load — see the *Version selection
rule* in [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)). Version 0 shows `0` (it
carries no conditions). Save then calls `submitTemplate` for the active `(name, version)` and
clears `dirty`, with a create-vs-overwrite snackbar. **Delete Template**
(`handleDelete`, enabled only when `loadedName` is set) confirms and hard-deletes the
**whole name** (all versions) via `deleteTemplate`, then resets to a blank v0. **Delete
Version** (`handleDeleteVersion`, disabled on **version 0** and until `loadedName` is set)
removes only the current version: a never-saved new version (`isNewVersion`) is discarded
locally (dropped from `availableVersions`, no server call); a saved version > 0 is
hard-deleted via `deleteTemplateVersion` (`DELETE …/version?name&version` — the server
also rejects version 0 as a backstop, since it is the placeholder/description source of
truth). Either path then reloads version 0 as the surviving board. The **version dropdown**
lives in the header (switching calls
`handleSwitchVersion`, which — per the reload-on-switch model — warns on `dirty` then
reloads the target from the server, discarding unsaved edits). `PropertiesDialog` hosts the **New version**
button (`handleNewVersion` copies the current board into the next version number; enabled
only when the template is saved and not `dirty`). It also validates dims (`[2, 60]`) and
runs the **rename gate** (a name must be free UNLESS it equals `loadedName`); name is
locked with >1 version, dims are locked above version 0. Bounces non-validators to Home
(UX gate; the backend is the real boundary).

### Client API — `src/features/nightmarket/templateEditorApi.ts`
`checkTemplateNameAvailable(name)`, `listTemplates()` (one summary **per name** with
`versionCount` — now unused on the client after the gallery replaced the text dropdown; the
`GET …` list endpoint is still live), `listTemplateGallery()` (one **`TemplateGalleryEntry`**
per name — a summary PLUS the full `definition` of its most-conditions `chosenVersion`, for
the visual Load gallery), `loadTemplate(name, version)` (returns the version + its
`availableVersions`), `submitTemplate({name,version,width,height,masks})` (returns
`{overwritten, version}`), `deleteTemplate(name)` (deletes the whole name),
`deleteTemplateVersion(name, version)` (deletes one version — `DELETE …/version`), and
`definitionToMasks(def)` (rebuilds the editor Sets incl. `condition` + decor Map,
resolving decor stems back to URLs via `freeFarmTileset.get`). `masksToDefinition`
serializes the Sets to sorted arrays and the decor map to a `cell → sprite STEM` object
(URLs → stable stems via `freeFarmTileset.stemOf`, so a stored definition survives asset
re-fingerprinting). Uses `authHeader()` + `API_BASE_URL`.

### Backend — validator-gated, upsert-by-(name, version)
- **Service** `server/services/NightMarketTemplateService.ts` — `assertValidator`
  (403), `isNameAvailable` (free = no version of the name exists), `suggestDefaultName`
  (returns `template{index}` for the smallest free positive `index` — canonical
  `template<n>` names only, no leading zeros — pre-fills the Properties popup for a fresh
  template), `listTemplates`
  (one row **per name** via `DISTINCT ON (name)` + a `versionCount`), `getTemplate(name,
  version)` (404 if missing; returns `availableVersions`; **merges version 0's
  placeholder** for versions > 0), `deleteTemplate(name)` (deletes every version; 404 if
  none; **then cascades to the Template Sandbox** — best-effort
  `NightMarketSandboxDAL.deleteByTemplateName(name)` removes every author's placements of the
  deleted name, see [NIGHT_MARKET_TEMPLATE_SANDBOX.md](./NIGHT_MARKET_TEMPLATE_SANDBOX.md)), `deleteTemplateVersion(name, version)` (deletes ONE version; **rejects version 0**
  with a 400 — it is the base/placeholder source of truth; 404 if that version is missing),
  `saveTemplate({name,version,…})` (validates dims + masks incl. `condition`,
  in-bounds cells; **street ⊥ communal**; family decor MAY sit on a street; **BOTH walkability
  classes (street + communal) ⊥ blocking common/tree decor** — a save is rejected if any street
  or communal cell carries common/tree decor, via `isBlockingDecorStem` (stem-naming classifier
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
  the client rename gate is the guard.
- **Controller** `server/controllers/NightMarketTemplateController.ts` — maps
  `DALError.statusCode` (403/400/404) to the response.
- **Routes** `server/routes/nightMarketTemplateRoutes.ts` — `GET
  /api/nightmarket-templates` (list per name), `GET …/name-available?name=`, `GET
  …/suggest-name` (→ `{ name }`, a free default), `GET …/load?name=&version=` (load one
  version), `POST /api/nightmarket-templates` (save/upsert with `version`), `DELETE
  /api/nightmarket-templates/version?name=&version=` (delete ONE version — registered
  before the bare DELETE), `DELETE /api/nightmarket-templates?name=` (delete whole name).
  The `name-available` +
  `suggest-name` + `load` routes are static paths (no `/:id`), registered after the bare
  list route. Wired in `server/dal/setup.ts` + `server/server.ts`.

### Storage — table `nightmarkettemplatedefinitions` (migrations 107 + 108 + 109)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | VARCHAR(120) | part of the **`UNIQUE(name, version)`** key (migration 108); the name-availability target |
| `version` | INTEGER | **migration 108**, default 0. 0-based; version 0 is the base + single source of truth for the shared placeholder |
| `width` / `height` | INTEGER | board dims (cols / rows) — shared across a name's versions |
| `description` | TEXT (nullable) | **migration 109**. Optional author-written blurb shown in the Load menu. **Shared per name**, single-sourced on version 0 (NULL on higher versions, merged from v0 on read) — same rule as the placeholder. Authored via the Properties popup (locked above version 0). |
| ~~`conditionCount`~~ | — | **DROPPED (decision 2026-07-17) — not a column.** The condition island count has no DB reader (the version selector re-derives it in-memory at load; placement keys on anchor width). It is computed **live in the editor** at save for the author's display only, and re-derived at load for scoring. See *Version selection rule* / *Storage* in [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md). |
| `definition` | JSONB | `{ terrain1, terrain2, street, communal, condition }` cell lists + `placeholder` (`{col,row,w,h}[]` — dropped occupant-slot areas) + `decor` (`cell → sprite-stem` object) now; grows to the full template. `placeholder` is populated only on version 0 (empty on higher versions as stored; merged from v0 on read). Schemaless JSONB, so `communal`/`placeholder`/`condition` were added without a migration (older rows read them as `[]`). ⚠️ **No-back-compat-read** shape changes: the terrain keys were **renamed `lightGrass`/`darkGrass` → `terrain1`/`terrain2`** (pre-rename templates load with **empty terrain**); `placeholder` changed from a **flat `string[]` cell mask → `{col,row,w,h}[]` area records** (pre-change templates load with **no placeholder areas** — re-drop them). A legacy `houses` key (from the removed House tool) is **ignored on read** — the editor no longer authors houses. |
| `createdBy` | UUID FK → users(id) | authoring validator |
| `createdAt` / `updatedAt` | TIMESTAMPTZ | |

This is the **catalog of template DEFINITIONS** — distinct from the *proposed*
per-user **placement** table `nightmarkettemplatelocations` in
[NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md) (which records *where* a
placed instance sits for an account). It also supersedes, for authored content, that
doc's "template definitions live in a code registry" assumption — validators now
author into the DB; how the runtime placement/graph path reads these (DB vs. a
promote-to-code step) is a downstream decision.

---

## Deferred / not yet built

- **Rest of the template:** placeholder areas ARE now authored as explicit
  `{col,row,w,h}` drop records (fixed 4×5 / 5×4 / 4×10 / 10×4 sizes) — distinct occupant slots.
  A stable per-area **`id`** (for the placement/occupancy systems to key an occupant on)
  is not yet added. Asset map, conditional cell-class rules, and edge signatures are also
  unbuilt — all extend the same `definition` JSONB.
- **Versioning / history:** multiple numbered **versions** per name ARE supported
  (migration 108), but Save overwrites a version in place (no revision history within a
  version); Delete is a hard delete of the whole name. Switching versions reloads from
  the last save (no in-memory hold of unsaved versions).
- **Street rendering:** street is authored as a spriteless walkability **tint** — it does
  NOT render as a road/plank sprite in the editor. (The old plank autotiler was removed.)
  A future street tileset/render pass, if wanted, would consume the same `street` mask.
- **Consumption:** nothing reads `nightmarkettemplatedefinitions` yet — placement +
  street recovery ([NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)) are the
  next consumers.

## Dependency references

- Data: `src/engine/market/farmTerrain.ts` (`EditorMasks`, `buildEditorField`,
  `editorSurfaceAt`, `editorDecorRotation`, `editorPlankCenters`, `plankRenderUrl`,
  `isPlankUrl`, `editorDecorCategory`),
  `src/engine/market/freeFarmTileset.ts` (`getDecorUrls`, `getTreeUrls`, `getPlank`),
  `src/engine/market/walkway.ts` (`PLANK_VARIATIONS`),
  `src/engine/market/house.ts` (footprint dims + `HOUSE_ANCHOR` + `occupantHousesForArea`;
  also consumed by the live nmp `src/features/nightmarket/HouseLayer.tsx` and the runtime
  occupant `src/features/nightmarket/PlaceholderHouseLayer.tsx`).
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
[NIGHT_MARKET_TEMPLATE_SANDBOX.md](./NIGHT_MARKET_TEMPLATE_SANDBOX.md) — the sibling
template-author, desktop-only tool that *tiles* existing templates (this editor *authors* them);
its `nightmarkettemplatesandbox` rows are cleared when **Delete Template** removes a name,
[NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md),
[NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md).
