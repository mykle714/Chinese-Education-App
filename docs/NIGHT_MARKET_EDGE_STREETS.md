# Night Market — Edge-Flush Streets (streets along the north/east faces)

> **Status: DESIGN / IMPACT ANALYSIS — not implemented.** This doc scopes what changes when a
> template is allowed to carry a street that runs **parallel to, and flush against, its north
> (+isoY) and east (+isoX) faces**. Nothing below is built yet; the engines described are the
> *current* ones, and each section states how the new authoring freedom collides with them.
>
> Parent: [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md). Related:
> [NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md),
> [NIGHT_MARKET_TEMPLATE_EDITOR.md](./NIGHT_MARKET_TEMPLATE_EDITOR.md),
> [PEDESTRIAN_WALKING_ALGORITHM.md](./PEDESTRIAN_WALKING_ALGORITHM.md).

## The change in one line

Every system that reads a template's **border street cells** today assumes those cells are the
**cross-section of a street that runs perpendicular to the edge** (a road stub poking out of the
board). An edge-flush street is **parallel** to the edge, so the same cells now mean something
structurally different — and five engines read them.

**Coordinate reminder** (runtime convention, `versionSelection.outerEdgesOf`): `+col = east`,
`+row = NORTH`; local `(0,0)` is the SW / min-iso / near corner. "North face" = row `height-1`,
"east face" = col `width-1` — the two **far** faces, which are also the only faces the landmass
autotiler draws a rim on (`pickLandmassEdge`, `src/engine/market/freeFarmTileset.ts`).

---

## Open decisions (settle these before implementing)

| # | Question | Why it is load-bearing |
|---|---|---|
| **Q1** | If A has a flush **north** street, must the template placed north of A carry a flush **south** street? | `isPlacementLegal` (`server/dal/shared/templatePlacement.ts:275`) requires **every** cross-seam cell pair to agree on street-walkability. A full-street north row ⇒ the neighbour's whole south row must be street. **If flush streets stay N/E-only, a flush face is unmateable** — the continent can never grow across it. Either allow flush streets on all four faces (symmetric; seam rule unchanged) or relax the seam rule so a border street may abut a non-street neighbour row ("buildings front onto the road"), which is a far larger change. |
| **Q2** | When two flush streets do abut, do they **merge into one double-width street**? | `recoverStreets` (`src/engine/market/streetRecovery.ts:168`) **throws** on `width > 8` (invariant S3). Two 4-wide boulevards merge to exactly 8; two 5-wide merge to 10 → hard crash at world load, not a soft failure. |
| **Q3** | Is the N/E-only restriction a **rendering** rule or a **geometry** rule? | Only the far N/E faces are drawn by the landmass autotiler, which suggests it is visual. But anchors, conditions, seams, and recovery are all direction-**symmetric**, so a rendering-motivated asymmetry lands as a geometric asymmetry in five engines. |

---

## 1. Spawn geometry — `server/dal/shared/templatePlacement.ts`

| Function | Impact |
|---|---|
| `deriveAnchors` (:91) | An anchor is a **maximal contiguous run** of border street cells. A flush face collapses into **one anchor of width `W` (or `H`)** instead of several stub-width anchors. |
| `buildAnchorIndex` (:145) + step-3 lookup (:535) | Candidate matching is an **exact-width** map lookup on the complement edge. A width-20 parallel anchor needs a catalog template offering a width-20 complement anchor → nothing matches → the anchor is skipped **silently** (visible only through the `anchor-no-candidates` trace event). |
| `exposedAnchors` (:183) | Once a neighbour abuts part of a flush face, the exposed remainder fragments into arbitrary-width runs (3, 7, 11 …) that the catalog will never offer exactly. Anchor *supply* looks large while *usable* anchor supply collapses. |
| `matchedStreetRuns` (:303) | A full-face seam scores as **one** run, identical to a 1-cell stub, so the "reward the number of road connections" ranking stops discriminating. The loop is per-edge (:309), so a **corner-wrapping** match is counted twice. |
| `solveOffset` (:475) | Geometry still correct; the **semantics** change — mating two parallel runs no longer joins two roads end-to-end, it lays two roads side by side. |

**Likely fix:** type each anchor as **crossing** (street body extends inward, perpendicular to the
edge) vs **parallel** (street body runs along the edge). Only crossing anchors belong in the anchor
index; parallel faces need their own rule or exclusion.

---

## 2. Version selection / conditions — `conditionAnalysis.ts`, `seamAdjacency.ts` (+ server mirror)

`borderStreetCells` (`src/engine/market/conditionAnalysis.ts:84`) promotes **every** outer-edge
street cell to a condition cell, then `labelIslands` 4-connects them.

- **Corner wrap.** Cell `(W-1, H-1)` lies on both the N and E edge, so a flush north street plus a
  flush east street form **one island spanning two faces**. `abuttingBorderIslandIds`
  (`src/engine/market/seamAdjacency.ts:110`) satisfies an island when **any** cell abuts along
  **any** of that cell's outward normals → a neighbour to the north also satisfies the *east* face.
  This is the "1-cell-thick template" edge case documented in
  [NIGHT_MARKET_TEMPLATES.md § The seal constraint](./NIGHT_MARKET_TEMPLATES.md#the-seal-constraint),
  **generalised to every template**. Fix: split border islands **per edge / per outward normal**
  before satisfaction testing.
- **Denominator collapse.** `conditionCount` = island count. Merging a face's worth of stubs into
  one island changes both the absolute `satisfiedConditions` ranking and the ratio tiebreak — so
  **already-authored templates' version selection shifts** as soon as flush streets exist beside them.
- **Mixed-substrate islands.** A flush street hugging a placeholder area is far more likely to be
  4-adjacent to a manually painted placeholder condition cell, firing the `hasPlaceholder &&
  hasBorder` coercion path (`conditionAnalysis.ts:123`) and its error log. The "keep them
  non-adjacent" authoring invariant becomes much harder to honour.
- **Two copies.** Every behavioural edit must land in **both** the client engine
  (`src/engine/market/conditionAnalysis.ts`, `seamAdjacency.ts`) **and** the hand-synced server
  mirror `server/dal/shared/versionSelection.ts`.

---

## 3. The seal guard — `server/dal/shared/continentSeal.ts`

An "open street condition" is a border-street island whose outer edge does not abut. With flush
faces, nearly every placement always has one, so `sealsContinent` reports *"growth is still
possible"* while in reality no catalog template can mate a width-20 parallel anchor. The guard fails
**toward false-negative**: the unlock economy stalls with `all-anchors-exhausted` instead of the
intended `anchor-all-candidates-seal` authoring signal. Openness must be judged on **mateable
(crossing) anchors**, not on any border island.

---

## 4. Street recovery + graph invariants — `streetRecovery.ts` → `streetGraph.ts`

Where a wrong decision becomes a crash or a broken pedestrian:

- **S3 width bound.** `growMaximalRect` widens perpendicular across the seam, so two abutting flush
  streets recover as **one rectangle of the summed width**; `> 8` throws at load
  (`streetRecovery.ts:168`). See **Q2**.
- **E2 / N2 uniform width.** A flush street with a neighbour along only *part* of its length is 4
  wide where the neighbour exists and 2 wide where it does not. The maximal-rect cover splits it
  into overlapping rectangles and edge-body / node widths stop matching — violating **E2/E3/N2** in
  [NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md).
- **N1 rectangular nodes.** A flush border street crossed by the neighbour's perpendicular street at
  the seam is exactly the "three mutually overlapping streets → L-shaped node" pathology the
  authoring invariant test guards (`src/engine/market/__tests__/graphAssumptions.test.ts`).
- **Recompute triggers.** A street's **width** now changes when a neighbour spawns or is pruned —
  not just its sprites. The rebuild-trigger list in
  [NIGHT_MARKET_TEMPLATES.md § Tile rendering](./NIGHT_MARKET_TEMPLATES.md#tile-rendering-autotiling)
  must say so explicitly.

---

## 5. Pedestrians — `pedestrianAgent.ts`, `tileGraph.ts`

Downstream of §4 rather than new logic: lane counts on a seam street change under growth/decay
mid-session; a stand's access tile (A1–A3) can end up 4-adjacent to a border street whose other half
belongs to a different template; dead-end stubs appear at the exposed ends of flush streets. Re-walk
the last-mile assumptions once **Q2** is settled.

---

## 6. Rendering / autotiling — `freeFarmTileset.ts`, `farmTerrain.ts`, terrain layers

The N/E faces are exactly where `buildFarmField` stamps the tall-dirt `fieldEdge` plateau rim, so a
flush street occupies the rim cell — road art sitting on the cliff lip. Needs a decision on whether
the rim is suppressed or restyled under street, and the boundary autotile must flip between capped
and continuous when a neighbour **appears or is pruned**.

---

## 7. Authoring surfaces — editor + sandbox

- `withBorderStreetConditions` (editor save) floods an entire face with orange condition tint, and
  the author-facing island-count breakdown in the Save toast becomes misleading.
- The editor's red major lattice is already counted inward from the **N/E faces**
  (`GRID_MAJOR_EDGE_OFFSET` / `GRID_MAJOR_INTERVAL`, `TemplateEditorViewer.tsx`) — the flush-street
  affordance must agree with it, since "streets may only begin at a red gridline" is an existing
  authoring guideline (`AUTHORING_GUIDELINES`, `TemplateEditorPage.tsx`).
- Candidate new validations: refuse/warn on a flush street wide enough to exceed width 8 when
  doubled (**Q2**); warn on a flush face no catalog template can mate (**Q1**).
- The nms **Iterate** decision trace fills with `anchor-no-candidates` for the giant parallel widths,
  and its `catalogWidthsByEdge` summary gets noisy — see
  [NIGHT_MARKET_TEMPLATE_SANDBOX.md](./NIGHT_MARKET_TEMPLATE_SANDBOX.md).

---

## 8. Data + tests + docs

- **Existing catalog rows are re-interpreted at load** — anchors and border conditions are both
  re-derived, never persisted — so any template already carrying an accidental flush border run
  changes behaviour the moment the rules change. Audit `nightmarkettemplatedefinitions` before
  shipping.
- Tests to extend: `src/__tests__/continentSeal.test.ts`,
  `src/engine/market/__tests__/graphAssumptions.test.ts`,
  `src/engine/market/__tests__/conditionAnalysis.test.ts`, the placement tests.
- Docs to update once implemented: [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)
  (§ Edge signatures, § Anchors and the anchor index, § isPlacementLegal, § Version selection rule,
  § The seal constraint, § Street recovery),
  [NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md) (S3/N1/N2/E2 restated for
  seam-merged streets), [NIGHT_MARKET_TEMPLATE_EDITOR.md](./NIGHT_MARKET_TEMPLATE_EDITOR.md),
  [PEDESTRIAN_WALKING_ALGORITHM.md](./PEDESTRIAN_WALKING_ALGORITHM.md).

---

## Recommended shape

Three concepts cover most of the surface:

1. **Type the anchors** (`crossing` vs `parallel`) in `deriveAnchors`, and index only crossing ones.
   Parallel faces then stop polluting the anchor index, the seal guard, and the width-match lookup.
2. **Split border-street condition islands per outward edge** before satisfaction testing — this
   fixes the corner-wrap false satisfaction and retires the 1-cell-thick edge case at the same time.
3. **Answer Q2 with a hard authoring cap** (e.g. flush street width ≤ 4, so any legal merge stays
   ≤ 8), enforced in the editor at save, so `recoverStreets` can never throw at load.

---

## Dependency references

Code this doc analyses: `server/dal/shared/templatePlacement.ts` (`deriveAnchors`,
`exposedAnchors`, `buildAnchorIndex`, `isPlacementLegal`, `matchedStreetRuns`, `planSpawn`),
`server/dal/shared/continentSeal.ts`, `server/dal/shared/versionSelection.ts`,
`src/engine/market/conditionAnalysis.ts`, `src/engine/market/seamAdjacency.ts`,
`src/engine/market/streetRecovery.ts`, `src/engine/market/marketWorld.ts`,
`src/engine/market/templateStitch.ts`, `src/engine/market/streetGraph.ts`,
`src/engine/market/tileGraph.ts`, `src/engine/market/freeFarmTileset.ts`,
`src/engine/market/farmTerrain.ts`, `src/features/nightmarket/TemplateEditorPage.tsx`,
`src/features/nightmarket/TemplateEditorViewer.tsx`.
