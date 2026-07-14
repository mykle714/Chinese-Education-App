# Night Market Template Editor

> **Status: IMPLEMENTED (first slice).** A validator-only, **desktop-only** authoring
> surface for Night Market templates. It currently authors the **terrain + street +
> communal + placeholder + condition + house** slice of a template (terrain-1 /
> terrain-2 / street / communal-walkable / placeholder / condition masks + placed
> houses on a rectangular board), across multiple **versions** of a name. The **terrain
> masks are named generically** (terrain 1 / terrain 2) so their art can be hot-swapped
> later; they currently render as light / dark grass. **Street is a spriteless
> walkability tint** (a warm-tan highlight), not a plank sprite — it behaves like the
> other tint masks (communal / placeholder / condition). Placeholders
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
- **Header:** **Guidelines** (opens a read-only popup of the authoring rules the editor does
  **not** enforce — see *Authoring guidelines* below), **Load** (dropdown of existing template names → loads version 0), **Clear**
  (empties all masks; keeps the inherited placeholder on versions above 0), **Delete**
  (hard-deletes the WHOLE template — every version — from the DB; disabled until one is
  loaded/saved), **Properties** (popup: version dropdown + New version · width / length —
  **dropdowns** of the selectable board sizes `DIM_OPTIONS` = `2,4,6,8,10,12` then every +8
  to `44`; a legacy size outside the list is folded in so it still shows · name — for a
  fresh/unnamed template the field is **pre-filled from the server** with a free default
  `template{index}` (`GET …/suggest-name`; a loaded template keeps its own name) · optional
  **description**), **Save** (POST — **upsert by `(name, version)`**:
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
- **Left tool palette** (each color-coded group is a **horizontal row of buttons**; groups
  stack vertically and each box shrinks to fit its own buttons). Rows mirror the keyboard,
  top→bottom: **(1)** a view-control row — the **grid toggle** (own group) beside the
  mask-view toggles (own group, in mask-tool order: **street-**, **communal-**,
  **placeholder-**, **condition-highlight**, and **reusing the mask-tool icons**); **(2)** the
  masks group (Street · Communal · Placeholder · Condition — all spriteless tints); **(3)** the
  **Eraser** toggle (red) inline **before** the terrain group (Terrain 1 · Terrain 2); **(4)**
  the decor group (House · Surface decor · Common decor · Trees). The **Placeholder** tool is
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
  row masks **Q** street / **W** communal / **E** placeholder / **R** condition; home row **Tab**
  eraser modifier · **A** terrain 1 / **S** terrain 2; bottom row decor **Z** house / **X** surface /
  **C** common / **V** trees. **Tab** toggles the **eraser modifier** (not a tool — handled
  directly in the keydown effect, not via `HOTKEY_TO_TOOL`). **Space** flips the house
  placement's horizontal mirror while the **house** tool is active (a no-op / swallowed
  otherwise, so it never scrolls the page). Hotkeys are suppressed while the
  Properties dialog is open or a text field is focused (so typing a name never paints), and
  respect the same gating as the buttons (E ignored above version 0). A view-toggle key (or
  its button) flips its **independent** show-state even while that tool is active — the tool
  force-shows its tint for display, but that override never mutates the toggle.
- **Mouse:** hover highlights the cell under the cursor; **left-drag paints** the
  active tool; **middle/right-drag pans**; **wheel zooms** (integer steps).
- **Rectangle selection (street / communal / placeholder tools):** these three
  annotation-mask tools do **not** drag-paint. Instead they use a **press-drag-release**
  selection: **pointer-down anchors one corner**, and **releasing the button fills the whole
  rectangle** between the anchor and the cell under the pointer at release (a plain click,
  down + up on one cell, fills a 1×1 selection). While dragging, the cursor **rubber-bands
  the pending rectangle** live in the mask's own tint colour (**red** while the eraser
  modifier is on). Releasing just off the canvas falls back to the last on-board cell;
  releasing fully off-board abandons the selection. **Escape** cancels a pending drag;
  switching tools also abandons it. Each filled cell is routed through the same paint path as a single click,
  so all the mask invariants/cascades (mutual exclusion, blocking-decor refusal, condition
  upkeep) still apply — including under the eraser modifier, where the rectangle erases.
  Implemented in `TemplateEditorViewer` (`rectangleMode` prop, `RectPreviewOverlay`,
  `rectCells`); the parent turns it on for those tools and reuses `paintCell` per cell.

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
| Street | Street tool | **no sprite** — a translucent warm-**tan** **highlight tint** only (like communal) | The **street-walkable** class that street recovery will consume. Now a **spriteless walkability tint** (the plank sprite was removed), so it does **not** feed surface/decor rendering. **Mirrors communal exactly:** **clears any communal** flag (mutually-exclusive walkability class); **coexists with terrain and flush surface (family) decor** (the tint draws over them); but is **mutually exclusive with BLOCKING objects** — a **house** or **common/tree decor**: painting one of those clears street on the cell (cascade-clearing any condition), and painting street onto a cell that already holds one is **silently refused** (no-op). |
| Communal | Communal tool | **no sprite** — a translucent violet **highlight tint** only (like the nmp grass overlay) | The **communal-walkable** class (parks/plazas). A pure walkability annotation, so it does **not** feed surface/plank/decor rendering; **clears any street** flag (mutually-exclusive). Coexists with grass **and flush surface (family) decor** (a park is grass + flowers + communal), but is **mutually exclusive with BLOCKING objects** — a **house** or **common/tree decor**: painting one of those clears communal on the cell, and painting communal onto a cell that already holds one is **silently refused** (no-op). |
| Placeholder | Placeholder tool (**version 0 only**) | **no sprite** — a translucent cyan **highlight tint** only | Marks **placeholder-area** cells (slots a future unlock occupant fills — see [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)). An **override overlay**, not a walkability class, so it has **no** mutual-exclusion and may overlap any layer freely. **Shared across all versions** of a name (owned by version 0): the tool + eraser are disabled above version 0, which inherit it read-only. This per-cell mask is the first-slice shape; the rectangle-with-id `placeholderAreas` structure is a later evolution. |
| Condition | Condition tool (**versions above 0 only**) | **no sprite** — a translucent orange **highlight tint** only | Marks **condition-mask** cells — a **per-version** override overlay (the conditional cell-class annotation that differs between versions). The **manual tool paints only PLACEHOLDER cells** (painting elsewhere is a silent no-op). Border **STREET** cells get a condition **automatically at save** (see below), so at rest a condition may live on a **placeholder** cell (manual) OR a **border-street** cell (auto). Removing that substrate **cascades the condition away** — painting communal over the street, or erasing the street/placeholder, clears the condition on that cell (unless the cell still carries the other substrate). It is the **inverse of placeholder's version rule**: the tool + hotkey are disabled on **version 0** (the base carries no conditional cells), and the server rejects a version-0 save that carries any. **Auto border-street conditions (save time, versions > 0 only):** `handleSubmit` runs `withBorderStreetConditions` before POSTing — every **street cell on the board's outer edge** (col 0 / col W−1 / row 0 / row H−1) is added to the condition mask (those are the cells a neighbouring template's street can lean on, so they "matter to version selection" — see [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)). They are merged into the live board so the author sees them appear, and persist into the saved definition (idempotent — a re-save re-derives the same set). Version 0 sends none. |
| House | House tool | one **`House.png`** sprite seated on its footprint (rendered by `EditorTerrainLayer` from the `houses` **map**; **h-flipped** when the house's flip flag is set) | A rectangular object keyed by its FRONT (near, min-iso) corner and extending +isoX/+isoY — **4×5** (4 cells along isoX/E–W × 5 along isoY/N–S) by default. **One click drops the whole house**; the cursor becomes a footprint preview tinted **green** (placeable) or **red** (blocked), with a **translucent `House.png` ghost** (`HouseGhostOverlay`) drawn over it that **reflects the pending mirror** (`houseFlip`), so the facing is visible before the drop. Placement is **refused whole** unless every footprint cell is in-bounds and free of a street or another house. It **overwrites decor and any communal flag** under its footprint but **never a street**; once placed, **street and decor cannot overwrite it**. **`Space` toggles the placement's horizontal MIRROR** (a 2-facing flip). Mirroring is **not sprite-only** — a horizontal mirror about the front corner swaps the +isoX/+isoY screen directions, so a flipped house's footprint is the **TRANSPOSE** of the default (**5×4**, not 4×5). The green/red preview, the placement/occupancy math, and the ghost all honour the flip via `houseFootprintSpans(flip)`, so a mirrored house reserves exactly the cells it visually covers. Each placed house stores its own flip; the House button's icon + tooltip reflect the pending orientation. The `houseFlip` state lives in `TemplateEditorPage`, is stamped into the `houses` map value on placement, and rides through copy/paste. |
| Decor (×3) | Surface / Common / Trees tools | one decor sprite on top of the finished tile | Per-cell CHOICE, not a boolean. Each tap **cycles** the cell through THAT tool's rotation (see below); **does nothing under a house** (family decor now MAY sit on a street cell — the plank is gone). **Common decor and Trees are BLOCKING objects** — placing them **clears any street AND communal flag** on the cell (cascade-clearing any condition on a cleared street); **Surface (family) decor is flush and exempt** (it may coexist with street + communal). |
| — | Eraser **modifier** (Space) — layered on the active tool | — | A boolean toggle (`eraseMode`), **not a tool**: while on, painting with any tool **removes only THAT tool's own layer** at the cell (never the top-most layer, never another tool's) — terrain 1/2, street, communal, placeholder, condition each delete their own mask; **House** removes the whole house covering the cell (via `houseAnchorCovering`); a **decor** tool removes the cell's single decor sprite **only when it belongs to that tool's category** (`editorDecorCategory` vs `DECOR_TOOL_CATEGORY` — e.g. the Surface-decor eraser leaves a tree/common sprite untouched). Cascade rules mirror the paint cases: erasing a **street/placeholder** cell cascade-clears any condition orphaned by it. The active tool **force-shows its own tint**, so you always see the layer you are erasing (no "hidden-tint" guard is needed). **Placeholder is erasable only on version 0** (inherited read-only above). **Scoped to its tool** — switching tools auto-clears it (an `activeTool` effect) — and **disabled for the copy/paste tools** (`toolSupportsEraser`, which never route through the erase branch); the hover diamond is tinted **red** while on. |

**Highlight view toggles.** The street, communal, placeholder, and condition tints each
have their own persisted palette toggle. While a tool is active its own tint layer is
**force-shown** (auto-reveal what you are painting), but the toggle **button stays clickable
and reflects its own independent state** — the force-show overrides the display without
mutating the toggle. When any other tool is active, the overlay simply **honors the toggle
setting**. **All four toggles default ON**, so the editor opens with every mask layer
visible.

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
| **Surface decor** (`family`) | yes | terrain-1 cell → `lightGrassDecor_1..7`; terrain-2 → `darkGrassDecor_1..5`; dirt → `dirtDecor_1..4` (the terrain→tileset-bucket mapping is the render seam in `editorDecorRotation`) |
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
  (terrain1/terrain2/**street**/communal/placeholder/**condition**/**houses**) + a
  `decor: Map<"col,row", url>` (per-cell decor CHOICE, not a boolean set). `terrain1` /
  `terrain2` are the generically-named surface masks (currently light / dark grass —
  named so the art can be hot-swapped). **`street`, `communal`, `placeholder`, and
  `condition` are spriteless annotations** (two walkability classes, an occupant-slot
  override, and a per-version conditional annotation) — intentionally absent from
  `EditorTile`/`buildEditorField`; the view highlights them straight from the mask.
  `houses` is a **`Map<cell, flip>`** (front-corner anchor → horizontal mirror flag); it
  renders as a sprite (not per-tile, **h-flipped** when the flag is set) but DOES suppress
  `decorUrl` under its footprint in `buildEditorField` (houses overwrite decor — the ONLY
  layer that still suppresses decor, since street no longer draws a plank). The occupied cells
  are **flip-aware**: a mirrored house's footprint is the transpose (5×4) of the default 4×5.
- **`src/engine/market/house.ts`** — the shared, PURE house geometry consumed by BOTH
  the editor and the live nmp house: default footprint dims (`HOUSE_FOOTPRINT_X`=4,
  `HOUSE_FOOTPRINT_Y`=5), `houseFootprintSpans(flip)` (transposes the spans to 5×4 when
  mirrored), the measured `HOUSE_ANCHOR` (base-diamond front corner), and the
  `houseFootprintCells` / `houseFits` / `houseOccupiedCells` / `houseAnchorCovering` helpers
  (all taking the house's `flip`) used by the page's placement rules and the viewer's
  footprint preview. It imports no asset, so pure layers (`farmTerrain`) can depend on it.
- `editorSurfaceAt(masks, col, row)` → `'dirt' | 'terrain1' | 'terrain2'` (takes just
  `Pick<EditorMasks,'terrain1'|'terrain2'>`, the two masks it reads) and
  `editorDecorRotation(category, surface)` (`category: DecorCategory` = `'family' |
  'common' | 'tree'`) → the ordered decor-URL list for one of the three decor tools
  (`family` maps the terrain surface → its tileset decor bucket — `terrain1`→`lightGrass`,
  `terrain2`→`darkGrass` — the render seam; `common` the shared `decor_*`; `tree` the
  tileset's `getTreeUrls()`). These back the decor tools' cycle.
- `editorDecorCategory(url)` → `DecorCategory` — the inverse of `editorDecorRotation`'s
  bucketing: classifies a placed decor URL back to its tool's category (`common` / `tree`,
  else `family`). Backs the eraser modifier's per-category decor erase (a decor tool erases
  only its own category), single-sourced with `isBlockingDecorUrl` against the tileset
  buckets.
- `buildEditorField(width, height, masks)` → `EditorTile[]` — the **mask-driven**
  twin of the procedural `buildFarmField`. Reuses the exact same neighbour →
  overlay-cap resolution (`resolveTileSurfaceUrls` / `resolveTileDarkSurfaceUrls`),
  so *"recompute overlay caps on each paint"* is just a rebuild. Terrain 1 and terrain 2
  are **fully independent** masks (no terrain2 ∩ terrain1 intersection): each renders from
  its own cells and terrain 2 does not require terrain 1 beneath it — their only
  relationship is **z-order** (the view stacks the dark surface above the light one). It
  adds each tile's resolved `decorUrl` (**null only under a house** — the street mask is
  now a spriteless tint and no longer flows through the field or suppresses decor).
- (The former `resolveTileStreetPlankUrl` plank autotiler was **removed** — street is now
  a spriteless walkability tint drawn straight from the mask, not a plank sprite.)

### View — `src/features/nightmarket/`
- `EditorTerrainLayer.tsx` — a trimmed `FarmTerrainLayer`: dirt slab + light/dark
  grass stack and the **painted `decorUrl`** sprite on top (no *procedural* scatter, and
  **no plank** — the street mask is a spriteless tint the viewer draws separately). Driven
  by a `tiles` prop, plus a `houses` prop (`{cell, flip}[]`) — one `House.png` sprite per
  placed house, anchored on the base-diamond front corner (`HOUSE_ANCHOR`) and z-sorted like a
  large decor by its front-corner foot cell (so terrain in front still occludes it). A house
  with `flip: true` renders **h-mirrored** (`scale.x = -1` about the anchor — same foot cell).
- `TemplateEditorViewer.tsx` — the Pixi host (copied from `MarketEngineViewer`).
  Cell picking (`localToCell`) inverts the 2:1 iso projection against each tile's
  surface-diamond **centre**. Left-drag paints (idempotent per cell), middle/right
  drag pans, wheel zooms; a `HoverOverlay` diamond tracks the cursor. Rebuilds the
  field via `buildEditorField` whenever the board/masks change. A shared
  `MaskTintOverlay` tints each cell of a spriteless mask (gated per layer): street cells
  warm-**tan** (`showStreet`), communal cells **violet** (`showCommunal`), placeholder
  cells **cyan** (`showPlaceholder`), condition cells **orange** (`showCondition`) — their
  only visualization, mirroring the nmp `GrassOverlay`. When `activeTool ===
  'house'`, the single-cell `HoverOverlay` is swapped for a `HousePreviewOverlay` (the
  flip-aware footprint under the cursor — 4×5, or 5×4 when mirrored) PLUS a `HouseGhostOverlay`
  (a translucent, flip-mirrored `House.png` seated exactly like the eventual house), tinted
  green (placeable) / red (blocked by bounds or another house — a house now overwrites the
  street/communal tint under its footprint, so a street no longer blocks placement).

### Page — `src/features/nightmarket/TemplateEditorPage.tsx`
Owns board size + name + the mask layers + active tool + `loadedName` (the loaded/saved
template name — the one name the rename gate permits AND the Delete target) + the
**version** state (`version`, `availableVersions`, `isNewVersion`) + a `dirty` flag.
`paintCell` resolves the active tool into a functional mask update (terrain 1 and terrain
2 are independent; **street mirrors communal** — mutually exclusive with communal + with
blocking objects, coexisting with terrain + family decor; the decor tools cycle). When the
**eraser modifier** (`eraseMode`) is on, `paintCell` inverts the active tool into an erase
of **only that tool's own layer** at the cell (a per-tool `switch` before the paint
`switch`; decor tools honor `editorDecorCategory` so each removes only its own category).
The **placeholder tool and eraser branch are gated to version 0** (`versionRef`), since
placeholder is shared/owned by v0. The **Load** button fetches the per-name list into a dropdown; picking one confirms
(if `dirty`), loads version 0, and applies its dims/name/masks + `loadedName` +
`availableVersions`. **Save** first (on versions > 0) runs `withBorderStreetConditions` to auto-mark every
border **street** cell as a condition — merging them into the live board and submitting the
same augmented masks (setMasks is async, so it must not rely on the state update landing
before the POST) — then calls `submitTemplate` for the active `(name, version)` and
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
  (403), `isNameAvailable` (free = no version of the name exists), `suggestDefaultName`
  (returns `template{index}` for the smallest free positive `index` — canonical
  `template<n>` names only, no leading zeros — pre-fills the Properties popup for a fresh
  template), `listTemplates`
  (one row **per name** via `DISTINCT ON (name)` + a `versionCount`), `getTemplate(name,
  version)` (404 if missing; returns `availableVersions`; **merges version 0's
  placeholder** for versions > 0), `deleteTemplate(name)` (deletes every version; 404 if
  none), `saveTemplate({name,version,…})` (validates dims + masks incl. `condition`,
  in-bounds cells; **street ⊥ communal**; each **house** anchor's flip-aware footprint
  (4×5, or 5×4 when mirrored — `houseFootprintSpans`) in-bounds, no house/street overlap; `cleanDecor` guards decor under houses (family decor
  MAY sit on a street now); **BOTH walkability classes (street + communal) ⊥ blocking
  objects** — a save is rejected if any street or communal cell sits under a house or
  carries common/tree decor, via `isBlockingDecorStem` (stem-naming classifier
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
  the client rename gate is the guard. House footprint dims (4×5) + the flip transpose
  (`houseFootprintSpans`) are duplicated here (`HOUSE_FOOTPRINT_X`/`_Y`) since the server
  can't import the client's `house.ts` — kept in sync by hand.
- **Controller** `server/controllers/NightMarketTemplateController.ts` — maps
  `DALError.statusCode` (403/400/404) to the response.
- **Routes** `server/routes/nightMarketTemplateRoutes.ts` — `GET
  /api/nightmarket-templates` (list per name), `GET …/name-available?name=`, `GET
  …/suggest-name` (→ `{ name }`, a free default), `GET …/load?name=&version=` (load one
  version), `POST /api/nightmarket-templates` (save/upsert with `version`), `DELETE
  /api/nightmarket-templates?name=` (delete whole name). The `name-available` +
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
| `definition` | JSONB | `{ terrain1, terrain2, street, communal, placeholder, condition }` cell lists + `houses` (`{cell, flip}[]` — front-corner anchor + horizontal-mirror flag) + `decor` (`cell → sprite-stem` object) now; grows to the full template. `placeholder` is populated only on version 0 (empty on higher versions as stored; merged from v0 on read). Schemaless JSONB, so `communal`/`placeholder`/`condition`/`houses` were added without a migration (older rows read them as `[]`). ⚠️ Two **no-back-compat-read** shape changes: the terrain keys were **renamed `lightGrass`/`darkGrass` → `terrain1`/`terrain2`** (pre-rename templates load with **empty terrain**); `houses` gained the **`{cell, flip}` object shape** — but that one IS back-compat: a legacy bare `"col,row"` string reads as `flip: false` (`definitionToMasks` + the server's `cleanHouses`). |
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
- **Street rendering:** street is authored as a spriteless walkability **tint** — it does
  NOT render as a road/plank sprite in the editor. (The old plank autotiler was removed.)
  A future street tileset/render pass, if wanted, would consume the same `street` mask.
- **Consumption:** nothing reads `nightmarkettemplatedefinitions` yet — placement +
  street recovery ([NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)) are the
  next consumers.

## Dependency references

- Data: `src/engine/market/farmTerrain.ts` (`EditorMasks`, `buildEditorField`,
  `editorSurfaceAt`, `editorDecorRotation`),
  `src/engine/market/freeFarmTileset.ts` (`getDecorUrls`, `getTreeUrls`),
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
