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
- Because a cell's class can flip at runtime (see
  [Conditional cell classes](#conditional-cell-classes--template-versions)), the
  autotile sprite of a cell **and its neighbors** must be recomputed whenever any
  trigger changes (placeholder occupancy *or* a neighbor template appearing —
  templates are append-only, so they only ever appear, never leave),
  not just at template placement.

> **TBD:** the exact tileset scheme (4-bit edge-only vs 8-bit blob/47-tile, which
> classes participate, and the sprite atlas) is not yet specified.

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

### Conditional cell classes — template "versions"

A template is not a single fixed grid: cells can **switch walkability class** based
on runtime state, so a template has **multiple versions**. The switch can happen
**both inside and outside a placeholder's own rectangle** — most importantly it can
**flip cells between `communal-walkable` and `street-walkable`** (e.g. a short
connecting street "opens" only once a stand exists, or only once a neighbor template
is there to connect to).

**Each cell can carry multiple conditions, combined with OR — *any* satisfied
condition triggers the switch.** Two kinds of trigger:

1. **Placeholder occupancy** — a specific placeholder in *this* template is occupied
   (e.g. dropping a stand opens its access street).
2. **Template adjacency** — another template is placed adjacent on a given edge
   (e.g. a boundary street cell becomes `street-walkable` only when there is a
   neighbor to connect to, instead of dead-ending as a stub).

A single cell may depend on **multiple placeholders and multiple adjacent
templates** at once; if *any* of its conditions holds, it takes the switched class.
Because these effects reach beyond the placeholder rectangle, the conditions must be
**authored explicitly in the template object**, not inferred from occupant
footprints. Conceptually:

```
// per template, in the code registry
cellClassConditions: Array<{
  cells: Array<"col,row">,         // cells that switch together
  class: "street-walkable" | "communal-walkable" | "unwalkable",  // class when ANY trigger holds
  anyOf: Array<                    // OR — any satisfied trigger applies `class`
    | { type: "placeholderOccupied", placeholderId: string }
    | { type: "templateAdjacent",   edge: "north" | "south" | "east" | "west" }
  >,
}>
```

A cell's **effective walkability** = its template default, with the switched `class`
applied if any of its conditions holds, then overridden by any occupant footprint
covering it.

Consequences:

- The **tile graph, street graph, and autotile sprites must be recomputed** whenever
  any input to these conditions changes — a placeholder's occupancy *or* a neighbor
  template being placed (templates are append-only — never removed) — not just when
  a template is first placed.
- **No speculative edge-signature matching.** A new template is only placed when the
  existing template is **full** (all placeholders occupied — see
  [Tiling & Placement](#tiling--placement)). At that moment every *occupancy-driven*
  conditional street is already manifested, so the edge the neighbor attaches to is a
  **real, present street** — signatures are matched against the live, manifested edge,
  not a hypothetical "connected" state.

### Why streets carry an adjacency dependency (decay safety)

Once a neighbor template is attached through a conditional street, that **neighbor's
adjacency becomes a second trigger** on the same street. The street then lives on:

> `(its placeholder occupant is present)` **OR** `(the neighbor template is present)`

The point is **decay safety**. If the original placeholder occupant is later removed
by minute decay ([Unlock economy](#unlock-economy-minutes--unlocks)), the street must
**not** suddenly vanish — the neighbor template may still exist (it has its own
occupants), and a vanished street would orphan it from the graph. The adjacency
trigger forces the street to persist as long as the neighbor is there.

**Authoring invariant (must be tested).** Template authors configure these triggers
by hand, so a test must enforce the rule that makes decay safety hold:

- **Every conditional street cell that runs off a template edge must include a
  `templateAdjacent` trigger for that edge** (in addition to whatever
  `placeholderOccupied` trigger originally opened it). Without it, attaching a
  neighbor through that edge would create a street whose only lifeline is the
  occupant — and decay could disconnect a live neighbor.

Tests for these authoring rules live alongside the registry/graph tests (see
[NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md)).

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

**Templates themselves are not unlocks.** Unlocks are *placeholder occupants*;
templates are the canvas those occupants land in. The two grow on different
triggers:

### What happens when an unlock is granted

1. **Select a free placeholder spot.** Among all placed templates, pick an
   unoccupied placeholder area.
2. **Grant an unlock of that size.** The unlock chosen is sized to the selected
   placeholder (occupant footprint = placeholder area, by construction), then placed
   into that spot, flipping the template to its occupied version (see
   [Conditional cell classes](#conditional-cell-classes--template-versions)).
3. **No free placeholder? Spawn a new template.** If no unoccupied placeholder
   exists (of the size needed), append a **new template** adjacent to an existing
   one, then place the unlock into one of the new template's fresh placeholders.

### How a new template attaches

- A new template attaches onto an existing template **via its street shape** — the
  candidate's facing-edge signature must **match** the open edge it attaches to
  ([Edge signatures](#edge-signatures)), so streets stay continuous across the seam.
- Spawning only happens when the existing template is **full** (no free
  placeholder), so all of its occupancy-driven conditional streets are already
  manifested. Edge signatures are therefore matched against the **live, manifested
  edge** — no speculation needed (see
  [Conditional cell classes](#conditional-cell-classes--template-versions)).
- Templates are **never rotated**, so candidate selection is purely signature
  equality on the target edge.
- Start state: one **starter ("hub") template at the origin** — this is the
  default origin template every user has at 0 minutes (see
  [Unlock economy](#unlock-economy-minutes--unlocks)).

> **Still pending — algorithm not yet designed.** The selection/placement policy is
> deferred: which free placeholder to fill (random vs. weighted), which template to
> spawn and against which open edge, and overlap/gap/multi-edge handling.

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
the explicit list above. The threshold list lives as a **static constant in code**
(alongside the night-market registry), not in the DB.

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

**Templates are append-only — they are never removed.** Decay only ever deletes
*unlocks* (placeholder occupants); the placed templates themselves persist for the
life of the account, even if they decay to **zero occupied placeholders**. An
emptied-out template simply renders its default (unoccupied) version and keeps its
cells/streets in the graph.

Consequences:

- **No empty-template cleanup, ever.** There is no "remove now-empty templates"
  step and no hub-exception to special-case — *everything* persists, including the
  hub.
- **Freed placeholders return to the pool.** A deleted unlock reverts its
  placeholder to empty, and that slot is reusable by a future unlock. Because
  placement picks among **all** placed templates' free placeholders (see
  [Tiling & Placement](#tiling--placement)), a later re-granted unlock backfills
  these empties before any new template is spawned.
- **Adjacency-triggered streets become permanent.** A conditional street kept alive
  by a `templateAdjacent` trigger ([Why streets carry an adjacency
  dependency](#why-streets-carry-an-adjacency-dependency-decay-safety)) can never be
  orphaned, since the neighbor template it depends on is itself never removed.

> **No new `minutesLost` table.** The minute deduction is already recorded as
> `userminutepoints.penaltyMinutes` (keyed `userId, streakDate, language`) by the
> existing cron — we reuse that audit trail rather than adding a table.

---

## Storage

Two layers, mirroring the existing Night Market split between code-defined assets
and DB-persisted user state:

### Template definitions — **code registry** (static content)

Template grids, walkability classes, asset maps, placeholder areas, **conditional
cell-class rules** (occupancy + adjacency triggers — see
[Conditional cell classes](#conditional-cell-classes--template-versions)), and edge
signatures are authored in code alongside `src/engine/market/nightMarketRegistry.ts`
(and its server twin `server/config/nightMarketRegistry.ts`). Signatures can be
**derived** from the cell grid at build time rather than hand-entered, to avoid
drift. The static **minutes→unlocks schedule** (see
[Unlock economy](#unlock-economy-minutes--unlocks)) is also a code constant, here.

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
`(col,row) → (isoX, isoY)` conversion happens at render via `src/engine/market/isometric.ts`.

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
   walkability classes (after applying each template's conditional cell-class rules:
   placeholder occupancy + neighbor-template adjacency).
2. **Tile graph:** all `street-walkable` + `communal-walkable` cells become
   walkable tiles, 4-connected by adjacency (today's construction in
   `src/engine/market/tileGraph.ts`).
3. **Street graph:** built from `street-walkable` cells **only**;
   `communal-walkable` cells are excluded from edge/node computation
   (`src/engine/market/streetGraph.ts`).
4. The stitched result must still satisfy every invariant in
   [NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md)
   (rectangular nodes, uniform edge widths, etc.). The edge-signature matching
   rule is what makes cross-seam streets contiguous enough to satisfy them.

> **Still pending — algorithm not yet written.** Step 3 glosses over the hard part:
> today's street graph is built from authored `Street { isNorthSouth, start, end,
> offset, width }` objects, but templates only give us a *grid of street-walkable
> cells*. The algorithm to **recover `Street` objects (runs, widths, offsets) from
> the stitched cell map** — so the existing `buildStreetGraph` machinery and the
> graph invariants still apply — is a TBD design pass.

---

## Open questions

1. **Placement algorithm:** selection/ordering policy, gap/overlap handling,
   multi-edge constraints (see [Tiling & Placement](#tiling--placement)).
2. **Street-recovery algorithm:** how to derive `Street` objects from a stitched
   cell grid (see [Feeding TILE_GRAPH / STREET_GRAPH](#feeding-tile_graph--street_graph)).
3. **Tileset scheme:** the autotiling bitmask/atlas
   (see [Tile rendering](#tile-rendering-autotiling)).

> **Resolved — communal-walkable routing.** Communal cells are for parks/plazas
> (relax/play), never for traffic or servicing — and a stand's access tile never
> sits in one (see [Cell walkability classes](#cell-walkability-classes)). Nothing a
> pedestrian must reach lives there, so the street-graph-only movement model needs
> no changes; future ped behaviors may opt in to communal space additively.

> **Resolved — empty-template removal.** Templates are **append-only**: once placed
> they are never removed, even when they decay to zero occupants (see
> [Losing minutes removes unlocks](#losing-minutes-removes-unlocks)). This removes
> the orphaning risk entirely, so the former "empty-template removal vs. structural
> dependency" question no longer applies.

---

## Dependency references

Code this doc will depend on / drive once implemented:

- `src/engine/market/nightMarketRegistry.ts` / `server/config/nightMarketRegistry.ts` —
  will gain template definitions.
- `src/engine/market/tileGraph.ts` — tile graph built from placed-template cells.
- `src/engine/market/streetGraph.ts` — street graph built from `street-walkable` cells.
- `src/engine/market/isometric.ts` — local `(col,row)` → global `(isoX, isoY)` mapping.
- New DB table `nightmarkettemplates` (placements) + new `placedTemplateId` /
  `placeholderAreaId` columns on `nightmarketunlocks` (occupants).
- `users.totalMinutePoints` — the minute accumulator the unlock schedule reads
  (see [MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md)).
- `database/cron/expire-stale-streaks.sql` — the hourly maintenance cron gains an
  **unlock-removal** branch (templates are append-only, so there is no
  template-cleanup step; see
  [STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md)). Reuses
  `userminutepoints.penaltyMinutes` as the loss audit trail (no new table).

Related docs: [NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md),
[NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md),
[PEDESTRIAN_WALKING_ALGORITHM.md](./PEDESTRIAN_WALKING_ALGORITHM.md),
[MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md),
[STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md).
