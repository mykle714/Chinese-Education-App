# Night Market Templates

> **Status: DESIGN — authoring built, runtime not yet built.** This doc specifies the
> template system that is the *authoring source* for a user's Night Market layout.
> **Authoring exists**: validators paint templates in the desktop editor
> ([NIGHT_MARKET_TEMPLATE_EDITOR.md](./NIGHT_MARKET_TEMPLATE_EDITOR.md)), persisted to
> the DB catalog `nightmarkettemplatedefinitions` (migrations 107–109). The **runtime
> that consumes the catalog** (placement → street recovery → graph feeding → render) is
> not yet built; cross-references to that code are forward-looking.
>
> **Two design decisions are locked (this settles the earlier "code registry" and
> per-cell-trigger TBDs):**
>
> 1. **Catalog is read DB-direct.** The runtime reads `nightmarkettemplatedefinitions`
>    live; there is **no promote-to-code registry**. Derived structures (edge
>    signatures, `anchorIndex`) are computed **at load**, not at build.
> 2. **Versions are full walkability snapshots.** A template name has numbered
>    versions; each version is a *complete* cell grid (its own walkability). The
>    per-cell OR-trigger model (`cellClassConditions`) is **dropped** — runtime picks
>    *which whole version to show* via a pluggable **version selector** (see
>    [Template versions](#template-versions--full-snapshots)). The selector is a
>    **random stub for now**; the real rule (keyed on template placement + which
>    placeholders are filled) is future work.
>
> The **version-selection rule is now designed** (condition-mask island scoring; see
> [Version selection rule](#version-selection-rule)) — only its `selectVersion` code is
> still a random stub. Remaining TBDs: the hard decay-safety guarantee and the tileset
> scheme (see [Open questions](#open-questions)).
>
> **Build tracker:** the runtime implementation plan (modules, slices, status) lives in
> [NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md](./NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md).

## Why templates

The Night Market map is assembled from **prebuilt rectangular templates tiled
together**. Authoring complete, hand-designed templates and snapping them together
gives every user a randomized-feeling market **without baking randomization into
the design of any individual layout** — the variety comes from *which* templates
get placed and *where*, not from procedurally generating streets/stands.

Key properties:

- Templates are **rectangular only** (arbitrary `W × H`; there is no fixed size).
- Templates are **never rotated** — they are placed at their authored orientation.
- Every user starts with **exactly one starter template at the map origin**.
- As the user unlocks things, more templates are placed adjacent to existing ones.
- Templates are the **source of truth for the tile graph and street graph** — the
  street/tile graphs are *computed from the placed template layout* (this replaces
  today's hand-authored tile registry; see
  [Feeding TILE_GRAPH / STREET_GRAPH](#feeding-tile_graph--street_graph)).

This sits on top of the existing Night Market feature
([NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md)) and must keep the graph
invariants in [NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md)
satisfied *after* templates are stitched into the global graph.

---

## Local coordinate system

Each template has its own local cell grid:

- **`col`** increases **eastward** (same direction as global `isoX`).
- **`row`** increases **southward**.
- **Origin cell `(0, 0)`** is the **north-west corner** of the template.
- A template of size `W × H` owns cells `col ∈ [0, W)`, `row ∈ [0, H)`.

A placed template has a **map offset** that maps its local `(col, row)` to global
isometric tile coordinates. (The exact offset→`(isoX, isoY)` formula is defined
once placement lands; conceptually it is a pure translation since templates never
rotate.)

---

## Cell walkability classes

Every cell has exactly one walkability class:

| Class | In street graph? | Tile-nav walkable? | Meaning |
|---|---|---|---|
| `street-walkable` | **Yes** | Yes | Part of a street; participates in street-graph (edges/nodes) computation. |
| `communal-walkable` | **No** | Yes | Walkable open space (plazas, courtyards) that is **not** a street. Pedestrians may stand/route across it for tile-based navigation, but it does **not** factor into street-graph edge/node construction. |
| `unwalkable` | No | No | Blocked (buildings, water, decor footprints, void). |

> **Note:** `communal-walkable` is a **new walkability tier** the current pedestrian
> algorithm does not model yet. The street graph ignores these cells entirely; only
> the tile graph marks them walkable.
>
> **What communal space is for:** parks, plazas, and similar open areas meant for
> **relaxing and playing — not for traffic or servicing.** This is a hard authoring
> invariant: **a stand's access tile never lives in a `communal-walkable` cell**
> (access tiles are always on a `street-walkable` edge body or inside a node — see
> [PEDESTRIAN_WALKING_ALGORITHM.md](./PEDESTRIAN_WALKING_ALGORITHM.md) last-mile).
> Because nothing a pedestrian *must* reach is ever in communal space, the current
> street-graph-only movement model needs **no changes** to support these cells.
> Future pedestrian behaviors **may** opt in to communal space (e.g. peds wandering
> into a park to idle/play), but that is additive and not required for the system to
> function.

---

## Asset map

A template stores a **map of which assets render in which cells**:

```
assetMap: { [localCellKey: "col,row"]: assetId }
```

- Most cells have **no** asset entry — they render a **default tile** (a base
  ground/street tile). Large multi-cell assets are drawn *over* those default
  tiles, so the cells a big asset visually covers are typically not themselves
  asset-map entries.
- **Multi-cell assets are anchored at a single cell.** The registry knows the
  asset's footprint (mirroring how stands work today: a stand's footprint/access
  is derived from one tile — see `standFootprintTiles` in `src/engine/market/tileGraph.ts`).
  The anchor cell holds the `assetId`; the asset's footprint extends from there.

---

## Tile rendering (autotiling)

The **default ground/street tiles** (cells with no explicit `assetMap` entry) are
not a single fixed sprite — **the sprite chosen for a cell depends on that cell's
neighbors.** This is classic *autotiling* (Wang / bitmask tiling): a street cell
surrounded by other street cells renders a "middle of road" sprite, while a street
cell with non-street neighbors renders an edge/corner sprite so the path visually
terminates cleanly.

- The neighbor signal is the **walkability class** of adjacent cells
  (`street-walkable` vs not), evaluated **across template seams** on the stitched
  global grid — so streets that continue into an abutting template render as
  continuous road, not as two capped stubs. (This is exactly what the edge-signature
  matching rule in [Edge signatures](#edge-signatures) guarantees.)
- Because a cell's class can differ between versions (see
  [Template versions](#template-versions--full-snapshots)), the autotile sprite of a
  cell **and its neighbors** must be recomputed whenever a placed template's **active
  version changes** or a neighbor template appears **or is pruned on decay** (empty
  dangling templates can now be removed — see
  [Losing minutes removes templates](#losing-minutes-removes-templates)), not just at
  template placement.

> **TBD:** the exact tileset scheme (4-bit edge-only vs 8-bit blob/47-tile, which
> classes participate, and the sprite atlas) is not yet specified.

**Implemented (landmass autotiling).** The first concrete autotiler ships in
`src/engine/market/freeFarmTileset.ts`:
- `pickLandmassEdge(neighbours)` — 4-cardinal edge-only scheme over the free-farm
  `LandmassEdge` vocabulary (`center`, `northEdge`, `eastEdge`, `northEdge_eastEdge`,
  and four convex `*Round` corners). Only the far **N (+isoY)** and **E (+isoX)** faces
  are authored/visible; a missing near S/W neighbour names a round but draws no rim.
- `pickGrassBorderOverlays(kind, neighbours)` — the **grass↔dirt boundary** autotiler:
  given a dirt tile's 8-neighbour grass occupancy, returns the overlay URLs to STACK so grass
  from adjacent patch cells spills onto the tile. **Edge-centric + convex dots**: one
  full-edge overlay per grass cardinal (`nw,n,ne`/`ne,e,se`/`sw,s,se`/`nw,w,sw`); two adjacent
  grass cardinals overlap at their shared vertex → concave corner filled seamlessly; a single
  isolated diagonal (both flanks dirt) → a corner dot (`ne`/`nw`/`se`/`sw`). Validated against
  the pack art on an irregular blob before wiring.
- `pickGrassOverlay(neighbours)` — lower-level exact compass-set lookup that the above builds on.
- `src/engine/market/farmTerrain.ts` (`buildFarmField` + `buildGrassPatch`) marks each tile
  grass/dirt (one contiguous wobbly patch), the tallDirt `fieldEdge` for the plateau rim, and
  the 8-dir `grassNeighbours`; rendered by `features/nightmarket/FarmTerrainLayer.tsx`.
  See *Terrain rendering* in [NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md).

---

## Placeholder areas

Placeholder areas are **authored explicitly, one dropped rectangle per area.** The
editor's placeholder tool **drops a fixed-size area** at the hovered near corner (it is a
footprint DROP, *not* a free-painted mask or a two-click rectangle —
see [NIGHT_MARKET_TEMPLATE_EDITOR.md](./NIGHT_MARKET_TEMPLATE_EDITOR.md)). Each drop is
stored as its **own `{col,row,w,h}` record** (near-corner anchor + span, extending
+isoX/+isoY), single-sourced on **version 0** and shared by every version:

```
placeholder: Array<{ col, row, w, h }>   // authored directly — each element is one area
```

- **Why records, not a cell mask.** The old model stored a flat `Set<"col,row">` and
  derived areas via connected-component labeling at load. That could not tell **two
  adjacent slots** apart — touching islands merged into one area. Storing each drop as a
  discrete record keeps adjacent occupant slots **distinct**, which is what the placement /
  occupant system needs.
- **Fixed sizes only.** A dropped area is one of exactly four sizes — **4×5**, **5×4**
  (the rotated 4×5), **4×10**, or **10×4** (the rotated 4×10). The editor's placeholder tool
  cycles between them with **Space**; the server rejects any off-menu size on save. (`w` is
  the isoX/col span, `h` the isoY/row span.)
- **No overlap.** Areas may overlap any *other* layer freely (they are an override
  overlay, not a walkability class) but **not each other** — a drop onto a cell already
  covered by another area is refused, and the server re-checks this on save. The
  **occupant asset's footprint equals the area**, so there is no sub-area anchoring or
  partial fill to reason about.
- **Refuse out-of-bounds.** A drop whose whole `w×h` footprint would not fit inside the
  board is refused (no clipping).
- Because the placeholder list lives on version 0 and is shared, **occupant slots are
  fixed per template name** — a version can only re-skin the streets/communal/decor
  *around* the slots; it cannot add or remove a slot. (The records are identical across
  versions, so occupant identity survives a version change.)

> **Legacy note.** Templates saved under the old flat-cell-mask model load with **no
> placeholder areas** (a cell mask has no `{col,row,w,h}` shape to recover), so their slots
> must be **re-dropped** — the same "must re-save" stance as the terrain1/terrain2 rename.

Semantics:

- A placeholder area is a region that **can be occupied** by an *occupant asset*
  (e.g. a newly unlocked stand the user drops there).
- **Default (unoccupied) state:** the area renders **whatever the template
  originally defined** for those cells (its default tiles / authored assets). The
  template's own content *is* the empty state — there is no separate "empty
  sprite" to author.
- **Occupied state:** when an occupant asset is placed, **the original template
  content in that area is suppressed** (not rendered) and the occupant asset is
  rendered instead. This is true regardless of what tiles/assets were originally
  authored at those cells.

So placeholder areas are an **overlay/override list**, not a cell attribute. A
cell's walkability class and asset-map entry describe the *default* template; the
placeholder layer decides, at render time, whether the default or an occupant is
shown for a given area.

### Template versions — full snapshots

A template name is not a single fixed grid: it has **numbered versions**, and **each
version is a complete, independent walkability snapshot** (its own street / communal /
decor layers). Versions exist so a template can re-skin itself in response to runtime
state — most importantly to **flip cells between `communal-walkable` and
`street-walkable`** (e.g. a short connecting street that is only "open" in some
versions). Version 0 owns the shared placeholder mask; higher versions inherit it (see
[Placeholder areas](#placeholder-areas)), so **the occupant slots are identical across
versions — only the surrounding walkability differs.**

There is **no per-cell trigger model.** Instead the runtime, at load, chooses **one
active version per placed template** through a pluggable **version selector**:

```
selectVersion(placed, worldState): number   // returns one of the name's availableVersions
```

- **Current implementation — random stub.** `selectVersion` returns a version chosen
  at random (persisted with the placement so it is stable, not re-rolled each render).
  This makes the *plumbing* for version changing exist end-to-end now; only the policy
  is a stub.
- **Selection rule — designed (selector still a random stub in code).** The real
  selector keys on **template placement + which placeholders are filled**, scored over
  the per-version condition mask (see
  [Version selection rule](#version-selection-rule) below). When it lands it replaces
  only the body of `selectVersion`; the seam and the "one active version per placed
  template" model do not change.

#### Version selection rule

Each version carries a **condition mask** (the per-version orange annotation authored
in the editor). The rule scores every version by **how much of its condition mask is
currently satisfied** and renders the best-scoring one.

**A single condition = one island.** A *condition* is **one connected component
(4-connected island) of condition-mask cells** within a version's mask — not a single
cell. The number of islands is the version's **total condition count** — the scoring
denominator. It is **not persisted** (decision 2026-07-17: no `conditionCount` column —
see [Storage](#storage)); the runtime re-derives it at load from the stored masks
(`analyzeConditions().conditionCount`), and the editor computes it live at save for the
author's information only (see
[NIGHT_MARKET_TEMPLATE_EDITOR.md](./NIGHT_MARKET_TEMPLATE_EDITOR.md)).

**Two kinds of condition, by the substrate the island sits on:**

| Island substrate | How authored | Satisfied when… |
|---|---|---|
| **Placeholder cells** | manually painted (the condition tool paints only placeholder cells) | the placeholder area under the island is **filled** (occupied by an unlock) |
| **Border-street cells** | auto-added at save by `withBorderStreetConditions` (every street cell on the board's outer edge) | that outer edge is **adjacent to a separate placed template** (a neighbor abuts across that seam) |

> **Islands never mix substrates (authoring invariant).** Authors keep placeholder
> condition cells and border-street condition cells **non-adjacent**, so every island
> is purely one kind. If a mixed island is nonetheless encountered at load, it is
> **treated as a placeholder condition and an error is logged** (fallback, not a
> supported authoring state).

**Score and pick.** For each version, count its **`satisfiedConditions`** (islands
currently met) and its ratio `satisfiedConditions / conditionCount`. The selector
renders the version with the **highest absolute `satisfiedConditions` count** across the
name's `availableVersions` — a version that realizes *more* concrete conditions wins even
if it carries more unmet ones (a lower ratio).

- **Tiebreak.** On an equal absolute satisfied count, prefer the version with the
  **higher `satisfiedConditions / conditionCount` ratio**; if still tied, the **lowest
  version number**. (Reversed 2026-07-18 from the earlier ratio-primary rule so that
  satisfying more conditions always outranks a cleaner but smaller version.)
- **Version 0 is the default floor.** Version 0 carries no condition cells
  (`conditionCount = 0`, `satisfiedConditions = 0`), so its `0/0` ratio is defined as
  **0**. Because the final tiebreak favors the **lowest** version number, version 0
  **wins every all-zero tie** —
  when nothing is satisfied (no occupants placed, no neighbors abutting), the base
  version renders. A higher version only supersedes it by **actually satisfying at least
  one condition** (`satisfiedConditions ≥ 1`, which outranks v0's `0`).

**Decay safety falls out of street conditions.** A version that keeps a border street
as `street-walkable` can *score* that street's condition when a neighbor abuts; a
version that flips the same edge to communal has no condition cell there (the condition
cascades away with its street substrate) and cannot score it. So the ratio rule
**naturally biases toward keeping streets a live neighbor leans on**. This is a soft
bias, not yet a hard guarantee — the graph-invariant test that a selection never drops
a depended-on street is still future work (see [Open questions](#open-questions)).

A cell's **effective walkability** = the *active version's* value for that cell, then
overridden by any occupant footprint covering it.

Consequences:

- The **tile graph, street graph, and autotile sprites are recomputed** whenever a
  placed template's **active version changes** or a neighbor template appears **or is
  pruned** (empty dangling templates are removed on decay — see
  [Losing minutes removes templates](#losing-minutes-removes-templates)) — not just at
  first placement.
- **The scoring engine exists; render-time wiring is pending.** The pure version-selection
  engine is built (`conditionAnalysis` + `seamAdjacency` + `conditionScoreSelector`, Phase A)
  and the editor auto-adds border-street conditions at save + shows the live island count
  (Phase B, display-only — no persisted `conditionCount`). What remains is feeding the
  selector **real** inputs at render — filled placeholder ids + neighbor occupancy — which
  lands with the placement schema in slice 3. Until then `useMarketWorld` still selects via
  the random stub.

> **Decay safety is now a property of the version selector, not per-cell triggers.**
> Under the old model a street cell carried an explicit `templateAdjacent` OR-trigger
> so it would survive its occupant decaying while a neighbor still leaned on it. With
> full snapshots, the equivalent guarantee comes from the selection rule: it must never
> pick a version that removes a street a live neighbor depends on. The
> [Version selection rule](#version-selection-rule) **softly** delivers this via
> border-street conditions (a kept street scores when a neighbor abuts; a flipped-to-
> communal edge cannot), but the **hard** guarantee — a graph-invariant test that no
> selection ever drops a depended-on street — is still open (see
> [Open questions](#open-questions)).

---

## Edge signatures

To stitch templates so **streets line up across seams**, each template carries a
**street-edge signature** per edge: a binary number whose bits mark which boundary
cells are `street-walkable`.

### Bit ordering (comparable across edges)

Signatures must be directly comparable when two edges abut, so all edges are read
in a consistent direction:

| Edge | Cells | Read direction | Bit 0 (LSB) |
|---|---|---|---|
| **North** | row `0`, all cols | **west → east** (`col 0 → W-1`) | westmost cell (`col 0`) |
| **South** | row `H-1`, all cols | **west → east** (`col 0 → W-1`) | westmost cell (`col 0`) |
| **West** | col `0`, all rows | **north → south** (`row 0 → H-1`) | northmost cell (`row 0`) |
| **East** | col `W-1`, all rows | **north → south** (`row 0 → H-1`) | northmost cell (`row 0`) |

Each bit is `1` if that boundary cell is `street-walkable`, else `0`.

> ⚠️ **Compass-label inconsistency (documentation only — does not affect correctness).**
> This table labels **row 0 = North**, but the **runtime coordinate system** (§ Local coordinate
> system, and `versionSelection.outerEdgesOf`) labels **row 0 = South** (min-iso = SW/near corner,
> +row = north). The implementation (`server/dal/shared/templatePlacement.ts`) follows the
> **runtime** convention. This is safe because the placement algorithm never relies on the compass
> label: anchors match by **complement pairing** (n↔s, e↔w) + **cell coincidence** read in a
> consistent along-edge direction, and the hard constraint is the cell-level `isPlacementLegal`
> check — not the whole-edge signature. The signature/bit-order is only an *indexing convenience*.
> The two edges of any seam vary along the same axis (n/s edges by col, e/w edges by row), so a
> single along-edge min coordinate aligns both regardless of which end is called "north".

### Matching rule (load-bearing)

**Abutting templates must have equal facing-edge signatures** — this is a hard
invariant the placement algorithm must enforce, so street cells align and streets
stay continuous across the seam:

- Template **B placed east of A** ⟹ `A.east == B.west`
  (both read north→south; requires equal heights).
- Template **B placed south of A** ⟹ `A.south == B.north`
  (both read west→east; requires equal widths).

Because the read directions were chosen to match, the constraint is a plain
equality of the two signatures (no reversal needed). Equal signatures also imply
the shared dimension (height for E/W seams, width for N/S seams) matches.

---

## Tiling & Placement

> **Implementation.** The pure geometry lives in `server/dal/shared/templatePlacement.ts`
> (`deriveAnchors`, `exposedAnchors`, `buildAnchorIndex`, `isPlacementLegal`, `matchedStreetRuns`,
> `maximinSpread`, `planSpawn`); the write orchestration is `NightMarketPlacementService`
> (`placeUnlock` / `spawnTemplate` / `grantUnlocks`). Spawn runs **server-side, once, persisted** —
> never recomputed on the client. **Candidate version rule:** a candidate's walkability is matched
> against its **most-conditioned version** — the version with the largest `condition` mask, NOT the
> base v0. Base versions are empty (no streets → no anchors → untileable), so matching on v0 makes
> almost nothing fit; the condition-rich versions carry a template's road connectivity, i.e. every
> edge it could tile against, so they represent its full attachment potential. Picking the template
> and picking its render version are **two separate steps**: candidacy uses the max-condition version;
> the placed template's real active version is then settled by recompute-on-read on the next layout
> read (§ Version selection). See `NightMarketPlacementService.spawnTemplate`.

**Templates themselves are not unlocks.** Unlocks are *placeholder occupants*;
templates are the canvas those occupants land in. The two grow on different
triggers:

### What happens when an unlock is granted

1. **Select a free placeholder spot.** Among all placed templates, pick an
   unoccupied placeholder area.
2. **Grant an unlock of that size.** The unlock chosen is sized to the selected
   placeholder (occupant footprint = placeholder area, by construction), then placed
   into that spot, occupying that slot; the placed template may then re-select its
   active version (see [Template versions](#template-versions--full-snapshots)).
3. **No free placeholder? Spawn a new template.** If no unoccupied placeholder
   exists (of the size needed), append a **new template** adjacent to an existing
   one, then place the unlock into one of the new template's fresh placeholders.

### How a new template attaches

New templates are stitched onto the existing **contiguous continent** along a shared
**anchor**. The whole policy is deterministic except a final random tiebreak; because
the result is **persisted** to `nightmarkettemplatelocations`, the algorithm runs **once,
server-side, at spawn time** and is never recomputed on the client.

- Start state: one **starter ("hub") template at the origin** — the default origin
  template every user has at 0 minutes (see
  [Unlock economy](#unlock-economy-minutes--unlocks)).
- **The hub is SEED-ONLY.** Exactly one hub exists per user, planted at `(0,0)` by
  `NightMarketWorldService.seedHubPlacement`, and it is **never a spawn candidate**:
  `NightMarketPlacementService.spawnTemplate` filters `night-market-hub` out of the
  growth catalog, so the anchor algorithm can never stitch a second hub onto the
  continent. (Before this guard the growth path could re-pick the hub, producing
  duplicate-hub layouts.)
- Spawning only happens when the existing continent is **full** (no free
  placeholder), so every placed template has settled on an active version and anchors
  are matched against the **live, currently-rendered** edges — no speculation (see
  [Template versions](#template-versions--full-snapshots)).
- Templates are **never rotated**, so an edge only ever mates with its opposite
  cardinal (`east↔west`, `north↔south`); candidate lookup is complement-direction +
  equal width.

#### Anchors and the anchor index

An **anchor** is a **maximal contiguous run of `street-walkable` boundary cells on a
single edge** of a template, described by `(direction, width)` (width = cells in the
run). One edge can hold several anchors (separated by non-street gaps); one template
can carry anchors on all four edges. Anchors are **derived from the cell grid at load**
(never hand-entered — same anti-drift rationale as edge signatures) and indexed for
fast lookup:

```
anchorIndex: Map<Direction, Map<width, TemplateAnchor[]>>
TemplateAnchor = { templateId, edge, runStart /* first run cell's offset along the edge */, width }
```

so "every template with a width-`W` west-facing anchor" is a direct
`anchorIndex[west][W]` lookup.

#### Placement algorithm

1. **Enumerate exposed continent anchors.** Across all placed templates, find every
   maximal contiguous run of `street-walkable` boundary cells whose cells are
   **exposed** (not abutting an already-placed template). Each yields a concrete cell
   run + `(direction, width)`.
2. **Pick the closest anchor.** Rank exposed anchors by distance from the map origin
   (run-centroid Manhattan distance, cell units); take the nearest.
3. **Gather candidate placements.** Look up `anchorIndex[complement(direction)][width]`.
   Each `(candidate template, matching run)` mates to the anchor in exactly **one**
   alignment — the two runs' cells must coincide, pinning both the parallel and
   perpendicular offsets — so each pair is one fully-determined placement.
4. **Discard illegal placements** with [`isPlacementLegal`](#isplacementlegalplaceda-placedb--cell-level-seam-check),
   evaluated against **every** already-placed template the candidate would touch
   (nestling into a concavity can create several seams at once).
5. **Rank by matched street runs (maximize).** Score = number of **distinct
   contiguous street runs** the placement joins across all its seams, where a matched
   run is a maximal contiguous set of seam cell-pairs that are `street-walkable` on
   both sides. The anchor itself is one; extra seams may add more. A width-4 join and
   a width-1 join each count as **one** run — this rewards the *number* of road
   connections, not their width.
6. **Tiebreak — maximin spread (maximize).** For each **exposed** edge cell of the
   newly placed template, fan out along that cell's outward normal to the first other
   placed template (void ⇒ ∞). Take the **minimum** such gap over the placement's
   exposed edge cells; prefer the placement whose minimum gap is **largest**. This
   spreads templates apart and avoids pinch points. (Anchor-touching cells are gap 0
   and are excluded, or the metric collapses to 0 for every candidate.)
7. **Tiebreak — random.** Pick uniformly among survivors. Safe to be truly random
   because the choice is persisted, not recomputed.

**Anchor fallback + logging.** If **no candidate at the closest anchor is legal**,
advance to the **next-closest** anchor and repeat, emitting a
`template-match-not-found` log (account, current template layout, the attempted
anchor) for each anchor that fails. If **every** exposed anchor fails, emit a final
`template-match-not-found` log (account, template layout, flag: *all anchors
exhausted*) and abort the spawn.

#### `isPlacementLegal(placedA, placedB)` — cell-level seam check

Given two placed templates (each `{ templateId, offsetCol, offsetRow }`):

- **No overlap.** Their cell footprints must be disjoint (any overlap ⇒ illegal).
- **Seam compatibility.** For every pair of cells adjacent **across the shared seam**
  (one cell in A, the orthogonally-adjacent cell in B), both must be `street-walkable`
  or both must be non-street. A single disagreeing pair ⇒ illegal.

This **cell-level** rule generalizes the whole-edge "equal facing-edge signatures"
statement in [Edge signatures](#edge-signatures): equal signatures is only the special
case of two equal-dimension templates butting flush. Partial or multi-template
abutment on a continent needs the per-cell form. Walkability is read from each
template's **active version** (see
[Template versions](#template-versions--full-snapshots)) in its post-placement state.

---

## Unlock economy (minutes → unlocks)

The number of unlocks a user has is a **pure function of their lifetime minute
points** (`users.totalMinutePoints` — the accumulator from
[MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md), where 1 minute point ≈ 60s of
study). Earning minutes grants unlocks; losing minutes takes them back.

### Schedule

| Total minute points ≥ | Total unlocks | Notes |
|---|---|---|
| 0 | 0 | **hub only** — the default origin template |
| 1 | 1 | |
| 2 | 2 | |
| 3 | 3 | early unlocks are 1 minute apart |
| 5 | 4 | |
| 7 | 5 | |
| 10 | 6 | |
| 14 | 7 | |
| 18 | 8 | |
| 22 | 9 | mid unlocks are 4 minutes apart |
| 26 | 10 | |
| 30 | 11 | |
| 34 | 12 | |
| 38 | 13 | |
| 42 | 14 | |
| 47 | 15 | 5 minutes apart |
| 52 | 16 | |
| 60 | 17 | |
| 60 + 60·k | 17 + k | **steady state: +1 unlock per hour** beyond minute 60 |

For `m ≥ 60`: `unlocks(m) = 17 + floor((m − 60) / 60)`. Below 60 the thresholds are
the explicit list above. The threshold list lives as a **static constant in code**:
`server/dal/shared/unlockSchedule.ts` (`UNLOCK_BREAKPOINTS` + `unlocksForMinutes`) is the
**source of truth**. The hourly decay cron (`database/cron/expire-stale-streaks.sql`) hard-codes
the same breakpoints as a SQL `CASE` (SQL can't import TS) — keep the two in sync. The grant flow
(`NightMarketPlacementService.grantUnlocks`) is invoked best-effort from
`UserMinutePointsService.incrementMinutePoints` after each earned minute; it is **idempotent**
(fills up to `unlocks(m)`, no-op when already there). Occupants currently carry a **generic
`assetId`** — the real stand-asset catalog (and occupant→stand rendering) is a later visual slice.

Each granted unlock triggers the placement flow in
[Tiling & Placement](#tiling--placement) (fill a free placeholder, or spawn a new
template when none are free).

### Losing minutes removes unlocks

`totalMinutePoints` can **decrease** — the hourly maintenance cron debits it on
streak breaks and continued inactivity (see
[STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md)). When it drops below a
threshold, the user must lose unlocks to match the schedule again. This cleanup
**extends the existing hourly cron** (`database/cron/expire-stale-streaks.sql`) so
it runs in the **same transaction** that debits the minutes:

1. After the debit, compute `target = unlocks(totalMinutePoints)`.
2. While the user has **more** unlocks than `target`, **delete unlocks at random**
   from `nightmarketunlocks` until the count matches.

Decay's SQL step deletes only *unlocks* (placeholder occupants); freed placeholders
return to the pool and a later re-granted unlock backfills them (placement picks among
**all** placed templates' free slots) before any new template is spawned.

### Losing minutes removes templates

Decay's occupant deletion is followed by a **template prune** — see
[Losing minutes removes unlocks](#losing-minutes-removes-unlocks) for the occupant
step it builds on. This **reverses the former "templates are append-only" rule**: a
template that decay leaves both **empty and weakly attached** is now removed, iterated
to a fixpoint.

A placement is removed when **all** hold:

- **Empty** — it holds **0 occupants** (all placeholder slots vacated). Nothing visible
  is lost.
- **Not the starter hub** (`night-market-hub`) — the hub is always kept.
- **Touched on {0, 1, or 2 *adjacent*} sides** — encoded as `!(hasEast && hasWest) &&
  !(hasHigh && hasLow)` (at most one neighbour per axis). This keeps well-anchored
  interior pieces (3–4 sides) and **never removes a 2-*opposite*-side corridor/bridge**,
  so a single prune can't sever the continent.

Because removing one placement only ever *reduces* a neighbour's touched-side set, the
predicate is monotonic and the fixpoint is order-independent — every currently-removable
placement is peeled each pass until a pass removes nothing.

- **Layer.** Pure geometry in `server/dal/shared/templatePrune.ts`
  (`prunableDanglingPlacements`); the service wrapper
  `NightMarketPlacementService.pruneDanglingTemplates` loads placements/dims/occupants and
  deletes via `INightMarketPlacementDAL.deletePlacements` (occupants cascade — zero here by
  the empty rule).
- **Triggers (both decay paths).** The live author minute-loss tool via
  `reconcileUnlocks`; the inactivity cron via the compiled companion script
  `dist/scripts/night-market/prune-dangling-templates.js` (`:02`, see
  [STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md)).
- **Known edge (geometric spec).** An *empty L-connector* (2 **adjacent** sides) that is
  the sole link to an **occupied** template **is** removable, orphaning that occupied
  template into a floating island. The opposite-bridge guard only protects corridors, not
  L-connectors. This is the accepted trade-off of the "no opposing pair" rule (vs. a full
  hub-connectivity guard).

> **No new `minutesLost` table.** The minute deduction is already recorded as
> `userminutepoints.penaltyMinutes` (keyed `userId, streakDate, language`) by the
> existing cron — we reuse that audit trail rather than adding a table.

---

## Storage

Two layers, mirroring the existing Night Market split between code-defined assets
and DB-persisted user state:

### Template definitions — **DB catalog** (authored content)

Templates are authored by validators in the **desktop template editor**
([NIGHT_MARKET_TEMPLATE_EDITOR.md](./NIGHT_MARKET_TEMPLATE_EDITOR.md)) and persisted to
the DB table **`nightmarkettemplatedefinitions`** (migrations 107–109), one row per
`(name, version)`. Each row stores the version's cell grid — walkability layers
(street / communal), the shared placeholder **areas** (`{col,row,w,h}` records,
single-sourced on version 0), the condition mask, decor stems, house anchors — plus
`width`/`height` and the shared `description`.

**Condition count — NOT a persisted column (decision 2026-07-17).** The version's total
condition count (the number of 4-connected islands in its condition mask, see
[Version selection rule](#version-selection-rule)) is **not** stored. An earlier draft
proposed a scalar `conditionCount` column "for searchability", but tracing consumers found
**no query filters by it**: the version selector loads all of a placement's versions and
scores them **in-memory**, re-deriving the count at load (`analyzeConditions().conditionCount`
in the version-selection engine); placement/spawn keys on **anchor width**, not condition
count. A stored column would be a denormalized cache with **no reader** — and load
re-derivation makes it authoritative-elsewhere, so it could only drift.

Instead:
- **At save**, the editor computes the count **live** from the masks (running the same
  `analyzeConditions` the runtime uses) and shows the author the breakdown
  ("N conditions — P placeholder, B border-street") in the Save toast + the condition-tool
  tooltip. This is the "generated on save for the author's information" goal — **display
  only, nothing persisted**. `withBorderStreetConditions` still folds the auto-added
  border-street cells into the saved condition mask so the author sees the orange cells
  appear on the board.
- **At load**, the runtime re-derives border-street conditions + island analysis from the
  stored masks (`street ∩ outer-edge`), so scoring can **never go stale** and there is
  **nothing to backfill**. Version 0 carries no conditions → count 0.

**The runtime reads this catalog DB-direct** (decision #1 in the status block): there
is **no promote-to-code registry**. Derived structures are computed **at load, not at
build**:

- **Placeholder areas** — read directly from the stored `{col,row,w,h}` records; no
  derivation step (they are authored explicitly — see
  [Placeholder areas](#placeholder-areas)).
- **Edge signatures + `anchorIndex`** — derived from each version's street cells (see
  [Edge signatures](#edge-signatures) and
  [Anchors and the anchor index](#anchors-and-the-anchor-index)).

The static **minutes→unlocks schedule** (see
[Unlock economy](#unlock-economy-minutes--unlocks)) remains a **code constant** (it is
policy, not authored content), living alongside the placement module.

### Per-user placement — **one new table + existing unlocks** (persisted)

Which template sits where **persists for the life of the account**, so it needs a
new table. **Placeholder occupants are unlocks** — a placeholder is, by design, a
slot that an *unlock* fills — so occupancy is recorded on the existing
`nightmarketunlocks` table rather than a separate one.

> ⚠️ **PROPOSED schema — pending confirmation before any migration is written.**
> Per project rules, new tables/columns must be confirmed with the user first.

**Proposed new table `nightmarkettemplatelocations`** (placed templates — where each
user has dropped a copy of a catalog template):

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `userId` | UUID FK → users(id) ON DELETE CASCADE | owner |
| `templateName` | VARCHAR | the catalog key — `nightmarkettemplatedefinitions.name` (a **name**, not a specific version) |
| `activeVersion` | INTEGER | the version currently rendered, chosen by `selectVersion` (random stub) and **persisted so it is stable across renders** |
| `offsetCol` | INTEGER | SW (min-iso / near) corner's column offset in **template-cell units** |
| `offsetRow` | INTEGER | SW (min-iso / near) corner's row offset in **template-cell units** |
| `createdAt` | TIMESTAMPTZ | insertion time — doubles as chronological placement order |

A placement references a template **by name**; `activeVersion` records which snapshot
is currently shown (see [Template versions](#template-versions--full-snapshots)).

> **No `placeOrder` ordinal.** An earlier draft carried a `placeOrder` column
> (`0` = starter hub, `1+` = unlocks). It was dropped as redundant: the **starter hub**
> is identified by the name constant `NIGHT_MARKET_HUB_TEMPLATE_NAME` and sits at
> origin (`offsetCol/offsetRow = 0`), and **chronological order** is already `createdAt`.
> Nothing in the placement or decay algorithms consumes a gap-free ordinal — spawning
> ranks anchors by distance from origin, and decay removes `nightmarketunlocks` rows,
> never templates — so a separate sequence column would be redundant state at risk of
> drifting out of sync.
Offset is stored in **local `col/row` cell units** (not global isoX/isoY); the
`(col,row) → (isoX, isoY)` conversion happens at render via `src/engine/market/isometric.ts`.

**Proposed additions to existing `nightmarketunlocks`** (an unlock occupies a
placeholder area). Both are **NOT NULL** — every unlock is placed into a
placeholder slot at the moment it is unlocked, so there is no "unplaced unlock"
state:

| Column | Type | Notes |
|---|---|---|
| `placedTemplateId` | UUID FK → nightmarkettemplatelocations(id), NOT NULL | which placed template the occupant sits in |
| `placeholderAreaId` | VARCHAR, NOT NULL | which placeholder area within that template |

This keeps occupants and unlocks as one concept: a placeholder *placeholds for an
unlock*, and the unlock row records which slot it landed in. The existing
`nightmarketunlocks` table will be **cleared** before these columns are added, so
the migration can add them as NOT NULL without a backfill.

---

## Feeding TILE_GRAPH / STREET_GRAPH

Templates **replace hand-authored tile registration** as the source for the graphs:

1. Place templates per the user's persisted layout → a global set of cells with
   walkability classes (using each placed template's **active version**, selected by
   `selectVersion` — see [Template versions](#template-versions--full-snapshots) — then
   applying occupant footprints).
2. **Tile graph:** all `street-walkable` + `communal-walkable` cells become
   walkable tiles, 4-connected by adjacency (today's construction in
   `src/engine/market/tileGraph.ts`).
3. **Street recovery:** decompose the `street-walkable` cells **only** (communal
   cells excluded) into `Street` rectangles + per-cell `intersectingStreets` — see
   [Street recovery](#street-recovery-mask--street) below.
4. **Street graph:** feed the recovered `Street[]` + stamped tiles into the
   **existing** `buildStreetGraph` (`src/engine/market/streetGraph.ts`) unchanged —
   it builds nodes (with projection), dead-ends, and lane edge bodies.
5. The stitched result must still satisfy every invariant in
   [NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md)
   (rectangular nodes, uniform edge widths, etc.). The edge-signature matching
   rule is what makes cross-seam streets contiguous enough to satisfy them.

### Street recovery (mask → `Street[]`)

The street mask is the **authored source of truth**; recovery turns the *stitched*
mask into the `Street` rectangles the existing `buildStreetGraph` already consumes.
Recovery is a **pure function of the stitched mask** — it runs in the graph-build
path (client + server) on load, replacing today's hand-authored `Street[]`; **nothing
is persisted** (only the template *placements* are — see [Storage](#storage)).

**Do not build nodes/edges here.** Recovery only produces `Street[]` +
`intersectingStreets`; `buildStreetGraph` does nodes/edges. Reimplementing that from
the mask would drop projection (breaking [N2](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md))
and dead-end handling (dropping stub edges + `bodyTileSet`).

**Algorithm — greedy maximal-rectangle cover.** A run-length heuristic (fan out, take
the shorter axis as width) is **not** used: at a crossing the perpendicular fan
measures the *crossing* street, not the width, and short crossings (both arms ≤ 8)
read as bogus-but-legal widths that no `width ≤ 8` gate can catch. Instead:

1. **Sample** an uncovered street cell; **grow its maximal axis-aligned rectangle**
   (extend N/S/E/W until a non-street cell) and emit it as a `Street`
   (`isNorthSouth = height > width`, with `start/end/offset/width` from its extent;
   synthesize a stable `name`).
2. **Stamp ownership** — add the emitted street to `intersectingStreets` for every
   cell it covers.
3. **Skip** any cell already covered by a **same-orientation** rectangle (dedup). A
   cell that ends up under rectangles of **both** orientations is an **intersection**
   — detected by ownership, needing no width test.
4. **Repeat** until every street cell is covered.
5. **Assert `width ∈ [1, 8]`** on every emitted street (the authoring bound — see
   [NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md) S3). A
   `width > 8` means a malformed mask or a sampling bug — **fail loudly**.

Because every emitted street is a genuine filled rectangle, S1/S2/E2 hold by
construction; projection inside `buildStreetGraph` covers T-junctions (N2).

> **Authoring invariant (tested, not enforced in recovery).** Three streets mutually
> overlapping can yield an **L-shaped node** (violates
> [N1](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md)). Rather than complicate recovery, a test
> asserts every `buildStreetGraph` node comes out rectangular; a pathological authored
> mask fails the test and the author fixes the mask
> (`src/engine/market/__tests__/graphAssumptions.test.ts`).

---

## Open questions

1. **Hard decay-safety guarantee.** The [Version selection rule](#version-selection-rule)
   is designed and `conditionCount` gives it its denominator, but `selectVersion` is
   still a **random stub** in code. The condition-mask scoring *softly* protects streets
   a live neighbor leans on (border-street conditions); the remaining open piece is the
   **hard** guarantee — a graph-invariant test that a selection **never** removes a
   street a live neighbor depends on.
   > **Decision 2026-07-17: the scored selector is the accepted final form.** The
   > soft-bias scoring rule ships as version-selection's final form; the hard
   > graph-invariant guarantee is **explicitly deferred** as a separate future item, not
   > a blocker for de-stubbing `selectVersion`.
2. **Tileset scheme:** the autotiling bitmask/atlas
   (see [Tile rendering](#tile-rendering-autotiling)).

> **Resolved — version-selection rule.** A condition is one 4-connected island of
> condition-mask cells; placeholder-cell islands satisfy when their area is filled,
> border-street-cell islands when a separate template abuts the edge. The runtime
> renders the version with the highest absolute `satisfiedConditions` count (tiebreak:
> higher `satisfiedConditions / conditionCount` ratio, then lowest version number;
> version 0's `0` satisfied is the default floor, so it wins every all-zero tie).
> `conditionCount` is the version's
> island count, re-derived at load (NOT persisted — decision 2026-07-17). **Built (Phase A):**
> the pure selector (`conditionAnalysis` + `seamAdjacency` + `conditionScoreSelector`) and
> the editor's live count (Phase B). **Remaining:** feeding real inputs at render (slice 3
> wiring) and the deferred hard decay-safety test.

> **Resolved — street-recovery algorithm.** Greedy maximal-rectangle cover of the
> stitched street mask → `Street[]` + `intersectingStreets`, fed to the existing
> `buildStreetGraph`; `width ∈ [1,8]` assertion; L-shaped-node authoring invariant
> under test (see [Street recovery](#street-recovery-mask--street)).

> **Resolved — placement algorithm.** Anchor-driven, run-off-the-origin selection with
> cell-level legality, distinct-street-run ranking, maximin spread tiebreak, random
> final tiebreak, and nearest-first anchor fallback with `template-match-not-found`
> logging (see [How a new template attaches](#how-a-new-template-attaches)).

> **Resolved — communal-walkable routing.** Communal cells are for parks/plazas
> (relax/play), never for traffic or servicing — and a stand's access tile never
> sits in one (see [Cell walkability classes](#cell-walkability-classes)). Nothing a
> pedestrian must reach lives there, so the street-graph-only movement model needs
> no changes; future ped behaviors may opt in to communal space additively.

> **Resolved — empty-template removal (was: append-only).** Templates are **no longer
> append-only**. On any decay, a placement that is empty (0 occupants) AND weakly
> attached ({0,1,2-adjacent} sides, never the hub, never a 2-opposite bridge) is pruned,
> iterated to a fixpoint (see
> [Losing minutes removes templates](#losing-minutes-removes-templates)). The 2-opposite
> guard prevents severing the continent; the one residual orphaning case (an empty
> L-connector to an occupied piece) is the accepted trade-off documented there.

---

## Dependency references

Code this doc will depend on / drive once implemented:

- **DB catalog `nightmarkettemplatedefinitions`** (migrations 107–109) read DB-direct
  via `NightMarketTemplateService` — the authored source; **no code registry.** The
  version selector's `conditionCount` denominator is **re-derived at load** from the
  stored masks (no `conditionCount` column — decision 2026-07-17; see
  [Version selection rule](#version-selection-rule)).
- **New catalog-load module** — reads the catalog and computes, at load, the
  **`selectVersion` seam** (random stub; the real body scores versions by
  `satisfiedConditions / conditionCount` — see
  [Version selection rule](#version-selection-rule)) and the **`anchorIndex`** keyed by
  `(direction, width)`; the **placeholder areas** are read directly (authored as
  `{col,row,w,h}` records, no derivation) (see
  [Anchors and the anchor index](#anchors-and-the-anchor-index),
  [Placeholder areas](#placeholder-areas),
  [Template versions](#template-versions--full-snapshots)).
- **New placement module** (server-side, runs at spawn time) — the anchor-driven
  algorithm + `isPlacementLegal` cell-level seam check + `template-match-not-found`
  logging (see [How a new template attaches](#how-a-new-template-attaches)).
- `src/engine/market/tileGraph.ts` — tile graph built from placed-template cells.
- **New street-recovery module** — greedy maximal-rectangle cover of the stitched
  street mask → `Street[]` + `intersectingStreets` (see
  [Street recovery](#street-recovery-mask--street)); its output feeds
  `buildStreetGraph`.
- `src/engine/market/streetGraph.ts` — street graph built from the recovered
  `Street[]` (unchanged; still does nodes/projection/dead-ends/edge bodies).
- `src/engine/market/isometric.ts` — local `(col,row)` → global `(isoX, isoY)` mapping.
- New DB table `nightmarkettemplatelocations` (placements — references the catalog by
  `templateName` + persisted `activeVersion`) + new `placedTemplateId` /
  `placeholderAreaId` columns on `nightmarketunlocks` (occupants).
- **Distinct scratch table** `nightmarkettemplatesandbox` (migration 116) — the per-author
  freeform Template Sandbox layout, a clone of `nightmarkettemplatelocations` minus the
  unique-corner index and unrelated to the unlock economy. Not part of the runtime path; see
  [NIGHT_MARKET_TEMPLATE_SANDBOX.md](./NIGHT_MARKET_TEMPLATE_SANDBOX.md).
- `users.totalMinutePoints` — the minute accumulator the unlock schedule reads
  (see [MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md)).
- `database/cron/expire-stale-streaks.sql` — the hourly maintenance cron has an
  **unlock-removal** branch (SQL); a **companion compiled-JS job** one minute later
  (`dist/scripts/night-market/prune-dangling-templates.js`) then prunes empty dangling
  templates (see [STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md)). Reuses
  `userminutepoints.penaltyMinutes` as the loss audit trail (no new table).
- `server/dal/shared/templatePrune.ts` — pure decay-time template-prune geometry
  (`prunableDanglingPlacements`); wrapped by
  `NightMarketPlacementService.pruneDanglingTemplates` +
  `INightMarketPlacementDAL.deletePlacements` (see
  [Losing minutes removes templates](#losing-minutes-removes-templates)).

Related docs: [NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md),
[NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md),
[PEDESTRIAN_WALKING_ALGORITHM.md](./PEDESTRIAN_WALKING_ALGORITHM.md),
[MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md),
[STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md).
