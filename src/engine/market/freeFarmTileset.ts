/**
 * freeFarmTileset — asset registry + lookup helpers for the `free-farm-assets`
 * tilepack (`src/assets/free-farm-assets/`).
 *
 * LAYER: pure asset/lookup layer. It resolves *which sprite URL* to draw for a
 * given semantic request (a walk frame, a grass-edge overlay, a landmass tile).
 * It does NOT render, animate on a clock, or know about the isometric transform
 * — callers (a canvas/DOM renderer) own the draw loop and call `frameAt(...)`
 * with their own elapsed time. This mirrors how `tileRegistry.ts` stays a data
 * layer separate from the renderer.
 *
 * NAMING CONVENTION (reverse-engineered from the folder; see the class doc for
 * the authoritative parse). Only *renamed* assets are indexed here — leftover
 * `r{row}_c{col}.png` grid cells and the `unused/ usued/ Originals/` folders are
 * deliberately excluded, because an un-renamed file signals "not adopted".
 *
 * Assets are pulled in with `import.meta.glob` (eager, as URLs) rather than ~180
 * explicit `import` lines. This is a deliberate departure from tileRegistry's
 * per-file imports, justified by volume; Vite still fingerprints/bundles each
 * file exactly as an explicit import would.
 *
 * Referenced by docs: docs/NIGHT_MARKET_TEMPLATES.md (autotiling / asset map)
 * — update that doc's "Tile rendering (autotiling)" section if the overlay
 * selection semantics here change.
 */

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** The four facing directions a player sprite is authored for. */
export type Direction = 'n' | 'e' | 's' | 'w';

/** The 8 compass tokens used in grass-overlay filenames. */
export type Compass = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Two grass palettes shipped by the pack. */
export type GrassKind = 'light' | 'dark';

export type PlayerGender = 'male' | 'female';
export type PlayerState = 'idle' | 'walking';

/**
 * A walkway runs along one of two iso axes:
 *   - `ew` (east↔west) — boards seamed along the NE–SW diagonal, laid along +isoX,
 *   - `ns` (north↔south) — boards seamed along the NW–SE diagonal, laid along +isoY.
 * The pack authors 3 board-pattern variations per direction (`plank_{dir}_{1..3}_…`).
 */
export type WalkwayDirection = 'ew' | 'ns';

/**
 * Plank end-cap vocabulary. `center` is the flat mid-run tile; the pack authors an
 * end cap only on each direction's FAR face — `eastEdge` for an `ew` run (its
 * east/+isoX end), `northEdge` for an `ns` run (its north/+isoY end) — mirroring the
 * landmass rule that only the two far iso faces are ever visible.
 */
export type PlankCap = 'center' | 'eastEdge' | 'northEdge';

/**
 * Loose "decor" families the pack ships (small scatter sprites that sit on top of
 * a finished tile). `lightGrass`/`darkGrass`/`dirt` are surface-specific; `common`
 * (the generic `decor_N` set) may sit on any surface. Consumers pick a decor for a
 * tile from its own surface family PLUS `common` — see the nmp decor scatter pass
 * in {@link ../../engine/market/farmTerrain.resolveTileDecorUrl}.
 */
export type DecorFamily = 'lightGrass' | 'darkGrass' | 'dirt' | 'common';

/**
 * Edge/corner suffix vocabulary shared by every "landmass" material
 * (`lightGrass`, `darkGrass`, `tallDirt`). NOTE: the pack only ships north/east
 * edges — in an iso diamond only the two far faces are visible, so south/west
 * edges are never authored (NOT mirrored).
 */
export type LandmassEdge =
  | 'center'
  | 'northEdge'
  | 'eastEdge'
  | 'northEdge_eastEdge'
  | 'northeastRound'
  | 'northwestRound'
  | 'southeastRound'
  | 'southwestRound';

// ---------------------------------------------------------------------------
// Pixel dimensions (NOT the iso-unit TILE_SIZE from nightMarketRegistry, which
// is 1). These are source-sprite pixel sizes for the sprite sheets this pack
// was sliced from.
// ---------------------------------------------------------------------------

/** Source cell size of every Environment tile (32×32 grid). */
export const FARM_TILE_PX = 32;
/** Source frame size of every Player sprite (48×48 grid). */
export const PLAYER_FRAME_PX = 48;
/** Frames per direction in every player animation (idle & walking both use 4). */
export const PLAYER_FRAMES_PER_DIR = 4;

// Canonical clockwise ordering so a *set* of compass tokens maps to one stable
// key regardless of the order they appear in a filename
// (`nw,n,ne` and `ne,n,nw` collapse to the same key).
const COMPASS_ORDER: Compass[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

function compassSetKey(dirs: Iterable<Compass>): string {
  const set = new Set(dirs);
  return COMPASS_ORDER.filter((d) => set.has(d)).join(',');
}

// ---------------------------------------------------------------------------
// Raw asset load (Vite): path -> url. Eager so the maps are ready synchronously.
// ---------------------------------------------------------------------------

const RAW: Record<string, string> = import.meta.glob(
  '../../assets/free-assets/free-farm-assets/**/*.png',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

/** basename without extension, e.g. ".../male_walking_s3.png" -> "male_walking_s3". */
function stem(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.endsWith('.png') ? base.slice(0, -4) : base;
}

/** True for assets we intentionally do NOT index (see module doc). */
function isExcluded(path: string): boolean {
  if (/\/(unused|usued|Originals)\//.test(path)) return true; // not-adopted buckets
  if (/\/r\d+_c\d+\.png$/.test(path)) return true;            // un-renamed grid cells
  return false;
}

// ---------------------------------------------------------------------------
// FreeFarmTileset
// ---------------------------------------------------------------------------

export class FreeFarmTileset {
  /** Every adopted asset, keyed by bare filename stem (escape-hatch lookup). */
  private readonly byStem = new Map<string, string>();

  /** Reverse of {@link byStem}: fingerprinted url -> filename stem (for debug labels). */
  private readonly stemByUrl = new Map<string, string>();

  /** players[gender][state][dir] -> [frame1..frame4] url, index 0 == frame "1". */
  private readonly players: Record<
    PlayerGender,
    Record<PlayerState, Record<Direction, string[]>>
  > = {
    male: { idle: emptyDirs(), walking: emptyDirs() },
    female: { idle: emptyDirs(), walking: emptyDirs() },
  };

  /** grassOverlays[kind] : canonical compass-set key -> url. */
  private readonly grassOverlays: Record<GrassKind, Map<string, string>> = {
    light: new Map(),
    dark: new Map(),
  };

  /** decor[family] : the ordered list of scatter-decor urls in that family. */
  private readonly decor: Record<DecorFamily, string[]> = {
    lightGrass: [],
    darkGrass: [],
    dirt: [],
    common: [],
  };

  /**
   * Standing-tree urls (`tree_n`, `largeTree_n`) — larger surface-agnostic props,
   * NOT part of the {@link DecorFamily} scatter sets. The template editor folds
   * these into every cell's decor rotation (see farmTerrain.editorDecorRotation).
   * Stumps are intentionally excluded (they read as felled trees, not decor).
   */
  private readonly trees: string[] = [];

  constructor(raw: Record<string, string> = RAW) {
    for (const [path, url] of Object.entries(raw)) {
      if (isExcluded(path)) continue;
      const name = stem(path);
      this.byStem.set(name, url);
      this.stemByUrl.set(url, name);
      this.indexPlayer(name, url);
      this.indexGrassOverlay(name, url);
      this.indexDecor(name, url);
      this.indexTree(name, url);
    }
  }

  // --- indexing -----------------------------------------------------------

  private indexPlayer(name: string, url: string): void {
    // `{gender}_{state}_{dir}{frame}`
    const m = /^(male|female)_(idle|walking)_([nesw])([1-4])$/.exec(name);
    if (!m) return;
    const gender = m[1] as PlayerGender;
    const state = m[2] as PlayerState;
    const dir = m[3] as Direction;
    const frameIdx = Number(m[4]) - 1; // filename frames are 1-based
    this.players[gender][state][dir][frameIdx] = url;
  }

  private indexGrassOverlay(name: string, url: string): void {
    // `{light|dark}GrassOverlay_{compass,comma,list}`
    const m = /^(light|dark)GrassOverlay_(.+)$/.exec(name);
    if (!m) return;
    const kind = m[1] as GrassKind;
    const dirs = m[2].split(',') as Compass[];
    this.grassOverlays[kind].set(compassSetKey(dirs), url);
  }

  private indexDecor(name: string, url: string): void {
    // Surface-specific families: `{light|dark}GrassDecor_{n}`, `dirtDecor_{n}`.
    const surface = /^(lightGrass|darkGrass|dirt)Decor_\d+$/.exec(name);
    if (surface) {
      this.decor[surface[1] as DecorFamily].push(url);
      return;
    }
    // Generic common decor: `decor_{n}` (usable on any surface).
    if (/^decor_\d+$/.test(name)) this.decor.common.push(url);
  }

  private indexTree(name: string, url: string): void {
    // Standing trees only — small `tree_{n}` and `largeTree_{n}` (no stumps).
    if (/^(tree|largeTree)_\d+$/.test(name)) this.trees.push(url);
  }

  // --- players ------------------------------------------------------------

  /**
   * The ordered frame URLs of a directional animation loop. Returns 4 frames
   * (index 0 == authored frame "1"). Callers advance through these on their own
   * clock — see `frameAt`.
   */
  getFrames(gender: PlayerGender, state: PlayerState, dir: Direction): string[] {
    return this.players[gender][state][dir];
  }

  /** Convenience wrappers for the two states. */
  getWalkFrames(gender: PlayerGender, dir: Direction): string[] {
    return this.getFrames(gender, 'walking', dir);
  }
  getIdleFrames(gender: PlayerGender, dir: Direction): string[] {
    return this.getFrames(gender, 'idle', dir);
  }

  /**
   * Pick the frame to show for a looping animation given elapsed time. Pure
   * function of its inputs — no internal clock — so it is trivial to drive from
   * a rAF loop or test deterministically.
   *
   * @param frames  the array from `getFrames`
   * @param elapsedMs  time since the animation started
   * @param fps  playback rate (default 8fps, a typical 4-frame walk cadence)
   */
  static frameAt(frames: string[], elapsedMs: number, fps = 8): string {
    if (frames.length === 0) return '';
    const i = Math.floor((elapsedMs / 1000) * fps) % frames.length;
    return frames[i];
  }

  // --- grass overlays -----------------------------------------------------

  /**
   * Direct lookup: the overlay whose authored side-set exactly equals `dirs`.
   * `undefined` if the pack has no tile for that combination (only ~16 of the
   * 256 possible combinations exist).
   */
  getGrassOverlay(kind: GrassKind, dirs: Compass[]): string | undefined {
    return this.grassOverlays[kind].get(compassSetKey(dirs));
  }

  /**
   * Higher-level autotile pick from an 8-neighbour occupancy map.
   *
   * Semantics (confirmed): the compass-set names the sides where a neighbour
   * *IS* grass of this `kind`, so we build the direction set from the truthy
   * neighbours and look it up. The pack ships 16 sets: 4 diagonals, 4
   * cardinal+diagonal caps, 4 full cardinal edges, and 4 two-cardinal corners.
   */
  pickGrassOverlay(
    kind: GrassKind,
    neighbours: Partial<Record<Compass, boolean>>,
  ): string | undefined {
    const dirs = COMPASS_ORDER.filter((d) => neighbours[d]);
    return this.getGrassOverlay(kind, dirs);
  }

  /** Every compass-set the pack actually ships an overlay for (for tests/debug). */
  listGrassOverlaySets(kind: GrassKind): Compass[][] {
    return [...this.grassOverlays[kind].keys()].map(
      (k) => k.split(',') as Compass[],
    );
  }

  /**
   * Autotile pick for a "landmass" surface (grass or tallDirt) from its 4
   * cardinal neighbours — which sides of THIS tile still have solid ground.
   *
   * The pack only authors rims on the two *far* faces (N = +isoY / top-left,
   * E = +isoX / top-right); the near S/W faces are never visible, so a missing
   * S or W neighbour contributes no rim. Outer convex corners (two adjacent
   * cardinals missing) use the rounded variant named by those two directions:
   *
   *   missing N+E → northeastRound   missing N+W → northwestRound
   *   missing S+E → southeastRound   missing S+W → southwestRound
   *
   * A single missing far side → `northEdge` / `eastEdge`; a missing near side
   * alone → `center`. Fully surrounded → `center`. `northEdge_eastEdge` is
   * reserved for concave meets and is not emitted by this convex-corner logic.
   */
  pickLandmassEdge(neighbours: Partial<Record<Compass, boolean>>): LandmassEdge {
    const openN = !neighbours.n; // no ground to the north (far, top-left)
    const openE = !neighbours.e; // no ground to the east  (far, top-right)
    const openS = !neighbours.s; // near face — invisible, but names the round
    const openW = !neighbours.w; // near face — invisible, but names the round

    // Convex corners first (two adjacent cardinals open).
    if (openN && openE) return 'northeastRound';
    if (openN && openW) return 'northwestRound';
    if (openS && openE) return 'southeastRound';
    if (openS && openW) return 'southwestRound';

    // Single visible far edge.
    if (openN) return 'northEdge';
    if (openE) return 'eastEdge';

    // Interior, or only near (S/W) sides open → no visible rim.
    return 'center';
  }

  /**
   * Pick the grass-boundary overlay pieces to STACK on a DIRT tile so that grass
   * from its adjacent grass tiles spills correctly onto this tile's diamond. This
   * is the "which overlay for a tile + its 8 neighbours" operation: pass the
   * 8-neighbour grass-occupancy of a dirt tile, get back the overlay sprite URLs
   * to draw on it.
   *
   * Model (edge + inner-corner + convex dots — validated against the pack art):
   *  - Two ADJACENT grass cardinals form a concave notch. Stacking their two
   *    full-edge overlays makes them OVERLAP at the shared corner vertex, and
   *    each sprite's soft boundary rim paints over the other's grass — a visible
   *    seam at the peak. Instead emit the pack's dedicated INNER-CORNER piece
   *    (`n,ne,e` / `n,nw,w` / `e,se,s` / `w,sw,s`), authored for exactly that
   *    two-face wrap, and SUPPRESS both of that pair's full edges. It also tapers
   *    the outer (far) vertices correctly, which the two full edges wrongly bulge.
   *  - A grass cardinal with NEITHER perpendicular neighbour grass is a straight
   *    boundary → its full-edge overlay (`nw,n,ne` / `ne,e,se` / `sw,s,se` /
   *    `nw,w,sw`), which correctly rounds both of its corners. (Opposite grass
   *    cardinals — n&s or e&w — are two such straight edges that share no vertex,
   *    so both are kept with no collision.)
   *  - A DIAGONAL neighbour that is grass while BOTH its flanking cardinals are
   *    dirt (an isolated convex touch) → the single-corner dot (`ne`/`nw`/`se`/
   *    `sw`). On an inner-corner tile only the OPPOSITE diagonal can qualify.
   *
   * NOTE: the terrain generator ({@link buildGrassPatch}'s notch-close pass)
   * guarantees no dirt tile borders grass on ≥3 cardinals, so inner pieces never
   * share a face and this decomposition is always collision-free in practice.
   *
   * Returns overlay URLs in back-to-front stack order. Empty for an interior dirt
   * tile with no grass neighbour. Unknown/missing pack tiles are skipped.
   */
  pickGrassBorderOverlays(
    kind: GrassKind,
    neighbours: Partial<Record<Compass, boolean>>,
  ): string[] {
    const n = !!neighbours.n, e = !!neighbours.e, s = !!neighbours.s, w = !!neighbours.w;
    const ne = !!neighbours.ne, nw = !!neighbours.nw, se = !!neighbours.se, sw = !!neighbours.sw;

    const sets: Compass[][] = [];
    // Inner-corner pieces for each ADJACENT grass-cardinal pair (concave notch).
    // These replace the two colliding full edges that share that pair's vertex.
    if (n && e) sets.push(['n', 'ne', 'e']); // shared vertex ne (top)
    if (n && w) sets.push(['n', 'nw', 'w']); // shared vertex nw (left)
    if (e && s) sets.push(['e', 'se', 's']); // shared vertex se (right)
    if (s && w) sets.push(['w', 'sw', 's']); // shared vertex sw (bottom)
    // Full-edge overlays only for grass cardinals NOT consumed by an inner piece
    // (neither perpendicular neighbour is grass) — i.e. a straight grass boundary.
    if (n && !e && !w) sets.push(['n', 'nw', 'ne']);
    if (e && !n && !s) sets.push(['e', 'ne', 'se']);
    if (s && !e && !w) sets.push(['s', 'sw', 'se']);
    if (w && !n && !s) sets.push(['w', 'nw', 'sw']);
    // Convex dots for isolated diagonal touches (both flanks dirt).
    if (ne && !n && !e) sets.push(['ne']);
    if (nw && !n && !w) sets.push(['nw']);
    if (se && !s && !e) sets.push(['se']);
    if (sw && !s && !w) sets.push(['sw']);

    const urls: string[] = [];
    for (const set of sets) {
      const url = this.getGrassOverlay(kind, set);
      if (url) urls.push(url);
    }
    return urls;
  }

  // --- decor --------------------------------------------------------------

  /** The scatter-decor urls in one family (empty if the pack ships none). */
  getDecorUrls(family: DecorFamily): string[] {
    return this.decor[family];
  }

  /** The standing-tree urls (`tree_n`, `largeTree_n`); see {@link trees}. */
  getTreeUrls(): string[] {
    return this.trees;
  }

  // --- landmass / generic -------------------------------------------------

  /** A grass base tile, e.g. `getGrassBase('light', 'northEdge')`. */
  getGrassBase(kind: GrassKind, edge: LandmassEdge): string | undefined {
    return this.byStem.get(`${kind === 'light' ? 'lightGrass' : 'darkGrass'}_${edge}`);
  }

  /** A raised-dirt (cliff) base tile. */
  getTallDirt(edge: LandmassEdge): string | undefined {
    return this.byStem.get(`tallDirt_${edge}`);
  }

  /**
   * A walkway plank tile, e.g. `getPlank('ew', 2, 'center')`. `variation` ∈ {1,2,3}
   * selects the board pattern; `cap` picks the flat mid-run tile (`center`) or the
   * far-end cap for that direction (`eastEdge` for `ew`, `northEdge` for `ns`).
   * `undefined` if the pack ships no such stem (e.g. an out-of-range variation).
   */
  getPlank(direction: WalkwayDirection, variation: number, cap: PlankCap): string | undefined {
    return this.byStem.get(`plank_${direction}_${variation}_${cap}`);
  }

  /**
   * Escape hatch for the families with simpler flat naming (planks, walkways,
   * fences, stairs, soil, sprouts, trees, decor). Pass the exact filename stem,
   * e.g. `get('plank_ew_2_center')`, `get('sprout_3')`, `get('largeTree_1')`.
   */
  get(stemName: string): string | undefined {
    return this.byStem.get(stemName);
  }

  /** All adopted stems (useful for building a picker/palette UI). */
  keys(): string[] {
    return [...this.byStem.keys()];
  }

  /** Reverse lookup: the filename stem for a resolved (fingerprinted) sprite url. */
  stemOf(url: string): string | undefined {
    return this.stemByUrl.get(url);
  }
}

function emptyDirs(): Record<Direction, string[]> {
  return { n: [], e: [], s: [], w: [] };
}

/** Shared singleton — the pack is static content, so one instance is enough. */
export const freeFarmTileset = new FreeFarmTileset();
