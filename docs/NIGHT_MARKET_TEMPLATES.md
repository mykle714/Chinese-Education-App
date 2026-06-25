# Night Market Templates

> **Status: DESIGN / not yet implemented.** This doc specifies the template system
> that will become the *authoring source* for a user's Night Market layout. The
> placement algorithm (which template goes where, and when) is deliberately left
> as a TBD — see [Tiling & Placement](#tiling--placement). Cross-references to code
> are forward-looking until the system is built.

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
> the tile graph marks them walkable. How peds use communal space (free roaming vs.
> only as last-mile connective tissue) is an open question — see
> [Open questions](#open-questions).

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
  is derived from one tile — see `standFootprintTiles` in `src/utils/tileGraph.ts`).
  The anchor cell holds the `assetId`; the asset's footprint extends from there.

---

## Placeholder areas

Separate from the per-cell asset map, a template defines a **list of placeholder
areas**. Each area is a **rectangle** in local `(col,row)` space:

```
placeholderAreas: Array<{ id, col, row, width, height }>  // axis-aligned rectangle
```

The **occupant asset's footprint always equals the area size** (`width × height`),
so an occupant exactly fills its placeholder — there is no sub-area anchoring or
partial fill to reason about.

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

### Occupancy changes walkability

Placing an occupant **can change the walkability** of the cells in its placeholder
area (e.g. an occupant asset blocks cells that were communal-walkable in the
template's default state). Therefore:

- A cell's effective walkability = its template default, **overridden** by any
  occupant covering it.
- The **tile graph and street graph must be recomputed** whenever a placeholder's
  occupancy changes (occupant added/removed), not just when templates are placed.

Because occupant footprints exactly equal their placeholder areas, the set of
cells whose walkability can flip is exactly the placeholder area's rectangle.

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

**TBD — algorithm not yet designed.** What we know so far:

- Start: one **starter template at the origin**, with its own edge signatures.
- Growth: as the user unlocks things, additional templates are appended adjacent
  to placed templates, choosing candidates whose facing-edge signature **matches**
  the open edge they attach to.
- Templates are **not rotated**, so candidate selection is purely by signature
  equality on the target edge.

Selection/ordering policy (random vs. weighted, how unlocks map to placements,
overlap/gap handling, multi-edge constraints) is deferred to a later design pass.

---

## Storage

Two layers, mirroring the existing Night Market split between code-defined assets
and DB-persisted user state:

### Template definitions — **code registry** (static content)

Template grids, walkability classes, asset maps, placeholder areas, and edge
signatures are authored in code alongside `src/config/nightMarketRegistry.ts`
(and its server twin `server/config/nightMarketRegistry.ts`). Signatures can be
**derived** from the cell grid at build time rather than hand-entered, to avoid
drift.

### Per-user placement — **one new table + existing unlocks** (persisted)

Which template sits where **persists for the life of the account**, so it needs a
new table. **Placeholder occupants are unlocks** — a placeholder is, by design, a
slot that an *unlock* fills — so occupancy is recorded on the existing
`nightmarketunlocks` table rather than a separate one.

> ⚠️ **PROPOSED schema — pending confirmation before any migration is written.**
> Per project rules, new tables/columns must be confirmed with the user first.

**Proposed new table `nightmarkettemplates`** (placed templates):

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `userId` | UUID FK → users(id) ON DELETE CASCADE | owner |
| `templateId` | VARCHAR | key into the code registry |
| `offsetCol` | INTEGER | NW corner's column offset in **template-cell units** |
| `offsetRow` | INTEGER | NW corner's row offset in **template-cell units** |
| `placeOrder` | INTEGER | 0 = starter template at origin, 1+ = unlocked placements |
| `createdAt` | TIMESTAMPTZ | |

Offset is stored in **local `col/row` cell units** (not global isoX/isoY); the
`(col,row) → (isoX, isoY)` conversion happens at render via `src/utils/isometric.ts`.

**Proposed additions to existing `nightmarketunlocks`** (an unlock occupies a
placeholder area). Both are **NOT NULL** — every unlock is placed into a
placeholder slot at the moment it is unlocked, so there is no "unplaced unlock"
state:

| Column | Type | Notes |
|---|---|---|
| `placedTemplateId` | UUID FK → nightmarkettemplates(id), NOT NULL | which placed template the occupant sits in |
| `placeholderAreaId` | VARCHAR, NOT NULL | which placeholder area within that template |

This keeps occupants and unlocks as one concept: a placeholder *placeholds for an
unlock*, and the unlock row records which slot it landed in. The existing
`nightmarketunlocks` table will be **cleared** before these columns are added, so
the migration can add them as NOT NULL without a backfill.

---

## Feeding TILE_GRAPH / STREET_GRAPH

Templates **replace hand-authored tile registration** as the source for the graphs:

1. Place templates per the user's persisted layout → a global set of cells with
   walkability classes (after applying any placeholder occupants).
2. **Tile graph:** all `street-walkable` + `communal-walkable` cells become
   walkable tiles, 4-connected by adjacency (today's construction in
   `src/utils/tileGraph.ts`).
3. **Street graph:** built from `street-walkable` cells **only**;
   `communal-walkable` cells are excluded from edge/node computation
   (`src/utils/streetGraph.ts`).
4. The stitched result must still satisfy every invariant in
   [NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md)
   (rectangular nodes, uniform edge widths, etc.). The edge-signature matching
   rule is what makes cross-seam streets contiguous enough to satisfy them.

---

## Open questions

1. **Communal-walkable routing:** do pedestrians free-roam communal cells, or are
   they only connective tissue for last-mile approach? The street graph ignores
   them, so the pedestrian algorithm needs a defined behavior for them.
2. **Placement algorithm:** selection/ordering policy, gap/overlap handling,
   multi-edge constraints (see [Tiling & Placement](#tiling--placement)).

---

## Dependency references

Code this doc will depend on / drive once implemented:

- `src/config/nightMarketRegistry.ts` / `server/config/nightMarketRegistry.ts` —
  will gain template definitions.
- `src/utils/tileGraph.ts` — tile graph built from placed-template cells.
- `src/utils/streetGraph.ts` — street graph built from `street-walkable` cells.
- `src/utils/isometric.ts` — local `(col,row)` → global `(isoX, isoY)` mapping.
- New DB table `nightmarkettemplates` (placements) + new `placedTemplateId` /
  `placeholderAreaId` columns on `nightmarketunlocks` (occupants).

Related docs: [NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md),
[NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md),
[PEDESTRIAN_WALKING_ALGORITHM.md](./PEDESTRIAN_WALKING_ALGORITHM.md).
