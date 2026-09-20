import { useCallback, useMemo, useRef, useState } from 'react';
import {
  editorDecorRotation, editorSurfaceAt, isBlockingDecorUrl, rollFloorSeed, DIRT_FLOOR,
  type BoardFloor, type DecorCategory, type EditorMasks,
} from '../../engine/market/farmTerrain';
import {
  scenePlaces,
  type IWInteractionStep, type IWNpcAction, type IWScene, type IWSceneCastMember,
  type IWSceneInteractions,
} from '../../../server/contracts/iw';
import { masksToSceneLayout, sceneLayoutToMasks } from './immersiveWorldSceneApi';
import {
  furnitureAt, furnitureAtIndex, furnitureBuriedDecorCells, furnitureCells, furnitureFitsBoard,
  furnitureOverlapsAny,
} from '../../engine/market/furniture';
import type { Direction } from '../../engine/market/freeFarmTileset';

/**
 * The iw scene editor's MODEL — the whole draft scene plus every mutation the panels
 * perform on it (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * LAYER: feature hook. It owns state and pure edits; it makes no server calls (the page
 * does that through `immersiveWorldSceneApi.ts`) and renders nothing.
 *
 * WHY THE MAP IS HELD SEPARATELY. Everything except the map lives on a plain `IWScene`
 * draft, but the painted layers are held as `EditorMasks` — Sets and a Map — because that
 * is what the shared `TemplateEditorViewer` consumes and what a paint stroke can update
 * cheaply. The two are joined only at the edges: `sceneLayoutToMasks` on load,
 * `masksToSceneLayout` on save. Keeping the arrays live would mean rebuilding them on
 * every painted cell.
 */

/**
 * A tool that paints the map. A strict subset of the night market's — no placeholder, no
 * condition, no copy/paste, and **no street/communal**: those are the nme's two WALKABLE
 * classes and a scene paints the inverse. See `IWSceneLayout`'s header.
 *
 * ⚠️ `unwalkable` and `forcedDirection` (2026-09-19) are the scene's own two walkability
 * masks, and they are ORDINARY PAINT LAYERS: drag to paint, eraser to remove. What makes
 * them unlike the nme's walkability tools is that nothing else on the board implies them any
 * more — a cell is impassable because it was painted so, never because of what stands on it.
 */
export type IWPaintTool =
  | 'terrain1'
  | 'terrain2'
  | 'familyDecor'
  | 'commonDecor'
  | 'treeDecor'
  // The two walkability masks. `forcedDirection` reads the palette's `variantIdx` as its
  // DIRECTION (see IW_PAINT_FACINGS), exactly as the decor tools read it as a variant.
  | 'unwalkable'
  | 'forcedDirection'
  // Places a MULTI-CELL prop from the lumeish furniture pack. A paint tool rather than a
  // place tool because it adds to a LAYER (many pieces per scene, erasable with the eraser),
  // where a place tool moves ONE known body/tag that already exists.
  | 'furniture';

/**
 * A tool that PLACES SOMETHING AT A CELL rather than painting a layer: the player's start,
 * the companion's start, a cast NPC (`npc:<id>`), or a named place (`tag:<tag>`).
 *
 * Placement is a click, not a drag: a body is somewhere, not spread over cells. A named
 * place is the one member that is not a body — but it behaves identically (one click, one
 * cell), and a tagged cell is the only kind of cell an authored action can name, so it
 * belongs on this side of the split rather than with the paint layers.
 */
export type IWPlaceTool = 'player' | 'companion' | `npc:${string}` | `tag:${string}`;

export type IWEditorTool = IWPaintTool | IWPlaceTool;

export const isPlaceTool = (tool: IWEditorTool): tool is IWPlaceTool =>
  tool === 'player' || tool === 'companion'
  || tool.startsWith('npc:') || tool.startsWith('tag:');

/** Whether a tool places furniture — the one paint tool that is not a per-cell layer. */
export const isFurnitureTool = (tool: IWEditorTool): boolean => tool === 'furniture';

/**
 * Whether a tool stamps a FACING. Its own predicate, beside {@link isFurnitureTool}, because
 * the panel has to know which meaning `variantIdx` carries for the active tool: a decor
 * rotation, a furniture catalogue index, or — here — a compass direction.
 */
export const isForcedDirectionTool = (tool: IWEditorTool): boolean => tool === 'forcedDirection';

/** The decor category a decor tool paints, or null for a non-decor tool. */
const DECOR_CATEGORY: Partial<Record<IWPaintTool, DecorCategory>> = {
  familyDecor: 'family',
  commonDecor: 'common',
  treeDecor: 'tree',
};

export const decorCategoryFor = (tool: IWEditorTool): DecorCategory | null =>
  (isPlaceTool(tool) ? null : DECOR_CATEGORY[tool] ?? null);

/**
 * The facings the forced-direction tool cycles through, in Space-press order.
 *
 * Declared here rather than imported from `IW_FACINGS` (the server contract) because this is
 * a TOOL's cycle order, not the wire's value set: the two happen to coincide today, and if a
 * fifth facing were ever authored the picker's order would still be a UI decision. The values
 * themselves are the engine's `Direction`, which is what the mask stores.
 */
export const IW_PAINT_FACINGS: readonly Direction[] = ['n', 'e', 's', 'w'] as const;

/** Board defaults for a brand-new scene — small enough to fill, big enough to walk in. */
const DEFAULT_DIM = 12;

/**
 * The cell a named place carries before it has been put on the board.
 *
 * `layout.places` is keyed by TAG and valued by cell, so a tag can exist with no cell at
 * all — it is stored as the empty string, which CANNOT parse as "col,row". The validator
 * rejects any value it cannot parse, which is exactly right: an unplaced tag must not be
 * saveable, and this makes "you named a place but never put it anywhere" a save error
 * rather than a scene whose action walks nowhere.
 */
export const UNPLACED_CELL = '';

/** True for a tag that has been dropped on a cell (as opposed to merely named). */
export const isPlacedCell = (cell: string) => /^\d+,\d+$/.test(cell);

/** Rewrite every `walk_to_tag` step in one cast member from one tag name to another. */
const renameTagInCast = (from: string, to: string) => (m: IWSceneCastMember): IWSceneCastMember => (
  m.actions ? {
    ...m,
    actions: m.actions.map((a) => ({
      ...a,
      steps: a.steps.map((st) => (st.kind === 'walk_to_tag' && st.tag === from ? { ...st, tag: to } : st)),
    })),
  } : m
);

/** Drop every `walk_to_tag` step in one cast member that pointed at a deleted tag. */
const dropTagFromCast = (tag: string) => (m: IWSceneCastMember): IWSceneCastMember => (
  m.actions ? {
    ...m,
    actions: m.actions.map((a) => ({
      ...a,
      steps: a.steps.filter((st) => !(st.kind === 'walk_to_tag' && st.tag === tag)),
    })),
  } : m
);

/**
 * Drop every interaction step that pointed at something that has just gone.
 *
 * ⚠️ WHY THIS EXISTS AT ALL, given the validator would catch a dangling reference anyway: a
 * step that still LOOKS chosen in its dropdown is a worse failure than one that is visibly
 * missing, and the author did not cause it — they deleted an NPC, not a poke script. Same
 * reasoning as `removeCastMember` dropping a departed NPC's conversation turns.
 *
 * An interaction whose LAST step is dropped this way is left as an empty script rather than
 * deleted: the place stays interactive-but-blank, which is visible in the panel and fixable,
 * where a silently-removed entry would just look like the tool ate it.
 */
const dropInteractionSteps = (
  interactions: IWSceneInteractions,
  drop: (step: IWInteractionStep) => boolean,
): IWSceneInteractions => Object.fromEntries(
  Object.entries(interactions).map(([tag, steps]) => [tag, steps.filter((st) => !drop(st))]),
);

/** An empty scene, ready to author. `completerNpcId` is deliberately blank: it must be chosen. */
export function blankScene(language: 'zh' | 'es' = 'zh'): IWScene {
  return {
    language,
    name: '',
    published: false,
    // The scene brief (migration 160) — prose for the model about what this place is and
    // what its place tags mean. Empty is a valid scene; it simply says nothing extra.
    sceneNotes: '',
    completerNpcId: '',
    // Blank, like `completerNpcId` above: the completion action is one of the completer's
    // own authored actions, so there is nothing to default it to until one has been written.
    completionAction: '',
    playerStartCol: 0,
    playerStartRow: 0,
    playerStartFacing: 's',
    companionStartCol: 1,
    companionStartRow: 0,
    companionStartFacing: 's',
    width: DEFAULT_DIM,
    height: DEFAULT_DIM,
    layout: {
      terrain1: [], terrain2: [], decor: {}, furniture: [], places: {}, floor: DIRT_FLOOR,
      // An empty room: nothing is impassable and no cell owns a facing until one is painted.
      unwalkable: [], forcedDirection: {},
    },
    npcCast: [],
    complications: [],
    // The SCHEDULED half of the world's behaviour (migration 161) — armed by a
    // `schedule_event` step or by an event's own "at scene open" delay, never drawn at random.
    events: [],
    conversations: [],
    // Place interactions (migration 162): tag → the script that runs when the learner walks
    // up. An OBJECT, not a list — it is keyed by place tag, because an interaction is a
    // property of a place rather than a thing standing beside one.
    interactions: {},
  };
}

function emptyMasks(): EditorMasks {
  return {
    terrain1: new Set(), terrain2: new Set(),
    // street/communal/placeholder/condition are never painted by a scene; they exist only
    // because `EditorMasks` is the night market editor's shape (see `sceneLayoutToMasks`).
    street: new Set(), communal: new Set(),
    placeholder: [], condition: new Set(), decor: new Map(), floor: DIRT_FLOOR,
    furniture: [],
    // The scene's own two masks (2026-09-19). Unlike the four above these ARE painted here.
    unwalkable: new Set(), forcedDirection: new Map(),
  };
}

export interface IWSceneDraft {
  /** Everything except the painted map. `layout` on this object is STALE while editing. */
  scene: IWScene;
  /** The painted map, live. Joined back into `scene.layout` by `toPayload`. */
  masks: EditorMasks;
  dirty: boolean;

  /** Patch any non-map field. */
  update: (patch: Partial<IWScene>) => void;
  /** Replace the whole draft — used on load and on New. */
  loadScene: (scene: IWScene) => void;

  /** Apply the active paint tool to one cell. `erase` removes that tool's own layer. */
  /**
   * Paint one cell. `variantIdx` is the caller's currently-selected decor variant (the one
   * the ghost is previewing); it is ignored by the non-decor tools. The draft does NOT own
   * it — see the comment on the decor branch below.
   */
  paintCell: (col: number, row: number, tool: IWPaintTool, erase: boolean, variantIdx: number) => void;
  /** Move the player start, the companion start, or a cast NPC to a cell. */
  placeAt: (tool: IWPlaceTool, col: number, row: number) => void;

  /**
   * Set the board-wide floor. Choosing WOOD while the board is already wood RE-ROLLS the
   * seed, which reshuffles the deck's plank grain — the only way to ask for a different
   * random arrangement, since the grain is otherwise frozen. Choosing dirt keeps the seed
   * so that toggling back restores the same deck.
   */
  setFloor: (kind: BoardFloor['kind']) => void;

  addCastMember: (npcId: string) => void;
  removeCastMember: (npcId: string) => void;
  updateCastMember: (npcId: string, patch: Partial<IWSceneCastMember>) => void;

  /**
   * Named places (§ 14 Q42): tag → "col,row" (or {@link UNPLACED_CELL} while unplaced).
   * Held BESIDE the masks rather than inside them, because `EditorMasks` is the night
   * market's type and knows nothing about tags — `toPayload` folds the two together into
   * `layout`.
   */
  places: Record<string, string>;
  /** Create a tag with no cell yet; the author then places it with the `tag:` tool. */
  addPlace: (tag: string) => void;
  /** Rename a tag in place, keeping its cell. Also rewrites the steps that walk to it. */
  renamePlace: (from: string, to: string) => void;
  /** Forget a tag entirely, and any action step that walked to it. */
  removePlace: (tag: string) => void;

  /**
   * Place INTERACTIONS (migration 162): tag → the script that runs when the learner walks up.
   * Lives on the scene rather than beside `places` because it is scene data, not board
   * geometry — but every mutation of a tag above keeps the two in step.
   */
  /** Give a place a script (or take its last one away). An empty list makes it inert. */
  setInteraction: (tag: string, steps: IWInteractionStep[]) => void;

  /** Per-NPC authored actions (§ 14 Q42). */
  addAction: (npcId: string) => void;
  updateAction: (npcId: string, actionId: string, patch: Partial<IWNpcAction>) => void;
  removeAction: (npcId: string, actionId: string) => void;

  /** The payload to POST: the draft with its live map folded back into `layout`. */
  toPayload: () => IWScene;
  markSaved: (saved: IWScene) => void;
}

export function useIWSceneDraft(): IWSceneDraft {
  const [scene, setScene] = useState<IWScene>(() => blankScene());
  const [masks, setMasks] = useState<EditorMasks>(emptyMasks);
  const [places, setPlaces] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  // Board dimensions for `paintCell`, which is identity-stable (deps `[]`) so a paint stroke
  // never re-creates the viewer's handler. Only the furniture branch reads them — it is the
  // one paint tool whose target can extend past the cell it was clicked on, so it is the one
  // that must bounds-check.
  const dimsRef = useRef({ width: scene.width, height: scene.height });
  dimsRef.current = { width: scene.width, height: scene.height };

  const update = useCallback((patch: Partial<IWScene>) => {
    setScene((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }, []);

  const loadScene = useCallback((next: IWScene) => {
    setScene(next);
    setMasks(sceneLayoutToMasks(next.layout));
    setPlaces({ ...scenePlaces(next.layout) });
    setDirty(false);
  }, []);

  const paintCell = useCallback((col: number, row: number, tool: IWPaintTool, erase: boolean, variantIdx: number) => {
    const k = `${col},${row}`;
    setDirty(true);
    setMasks((prev) => {
      // The two scene masks are OPTIONAL on `EditorMasks` (the night market never paints
      // them), but this stroke always materializes both — so the local type says so and the
      // branches below need no `?? new Set()` noise.
      const next: EditorMasks & {
        unwalkable: Set<string>;
        forcedDirection: Map<string, Direction>;
      } = {
        terrain1: new Set(prev.terrain1),
        terrain2: new Set(prev.terrain2),
        street: prev.street,             // scenes never paint any of these four;
        communal: prev.communal,         // carried untouched (always empty)
        placeholder: prev.placeholder,
        condition: new Set(prev.condition),
        decor: new Map(prev.decor),
        floor: prev.floor,              // board-wide; a paint stroke never touches it
        furniture: prev.furniture ?? [], // replaced (not mutated) by the furniture branch
        // COPIED, not carried: unlike the four night-market masks above, a scene paints
        // both of these — and several branches below stamp `unwalkable` as a side effect of
        // placing a solid object, so it must be a fresh Set on every stroke.
        unwalkable: new Set(prev.unwalkable ?? []),
        forcedDirection: new Map(prev.forcedDirection ?? []),
      };
      // Every caller below goes through these two, so the "a solid object stamps the mask"
      // rule is written once. It is an AUTHORING CONVENIENCE and nothing more: the runtime
      // reads the mask alone and has no idea a sprite was ever involved (§ 3a).
      const stampSolid = (cells: Iterable<string>) => {
        for (const cell of cells) next.unwalkable.add(cell);
      };
      const unstampSolid = (cells: Iterable<string>) => {
        for (const cell of cells) next.unwalkable.delete(cell);
      };

      // FURNITURE — a multi-cell OBJECT, so it is a record list rather than a cell in a mask.
      // `variantIdx` carries the palette's catalogue INDEX here, exactly as it carries the
      // decor rotation index for the decor tools: the selector is a tool modifier owned by
      // the palette (← / → page it, the ghost previews it) and the draft must not keep a
      // second, invisible copy of it.
      if (tool === 'furniture') {
        if (erase) {
          // A click anywhere inside a piece's footprint removes the WHOLE piece — an author
          // points at the middle of a sofa, not at its foot cell.
          const hit = furnitureAt(next.furniture ?? [], col, row);
          if (hit) {
            next.furniture = (next.furniture ?? []).filter((f) => f !== hit);
            // The solidity goes with the piece, symmetrically with the stamp below. Chosen
            // over "the mask is independent once stamped" because the alternative leaves an
            // invisible wall where a sofa used to be, and an invisible wall an author did not
            // mean to paint is the harder of the two mistakes to SEE.
            unstampSolid(furnitureCells(hit));
          }
          return next;
        }
        const id = furnitureAtIndex(variantIdx);
        if (id === null) return next;
        const piece = { col, row, id };
        // Refused (no-op) only if the footprint leaves the board or touches another PIECE.
        // Terrain, floor and flush surface decor are not solid, so a piece simply stands on
        // them; a blocking prop/tree IS solid and is displaced below rather than refusing the
        // drop. Board dims come from the scene, which is why they are read here.
        if (!furnitureFitsBoard(piece, dimsRef.current.width, dimsRef.current.height)) return next;
        if (furnitureOverlapsAny(piece, next.furniture ?? [])) return next;
        // Clear any BLOCKING decor (a prop or a tree) from every cell the piece covers. Two
        // solid objects cannot share a cell, so the new one REPLACES the old rather than being
        // refused. Flush surface decor stays — furniture stands on the ground, and the ground
        // may have grass tufts on it. Sweeps the whole FOOTPRINT, not just the clicked cell.
        // ⚠️ In a scene this also changes WALKABILITY: blocking decor is the only thing that
        // makes a cell impassable (§ 3a), and furniture does not yet block — so replacing a
        // tree with a table currently OPENS that cell up. That is the same gap tracked in
        // docs/LUMEISH_ASSET_PIPELINE.md § 7, surfacing here rather than a new one.
        for (const cell of furnitureBuriedDecorCells(piece, next.decor, isBlockingDecorUrl)) {
          next.decor.delete(cell);
        }
        next.furniture = [...(next.furniture ?? []), piece];
        // A dropped piece is SOLID, over its whole footprint. Before 2026-09-19 furniture
        // blocked nothing at all — walkability was derived from decor, which a piece is not —
        // so a table was scenery the learner walked straight through (the gap tracked in
        // docs/LUMEISH_ASSET_PIPELINE.md § 7). Stamping the mask here closes it.
        stampSolid(furnitureCells(piece));
        return next;
      }

      const category = DECOR_CATEGORY[tool];
      if (category) {
        if (erase) {
          // Erasing a SOLID prop/tree takes its stamped mask with it (see the furniture
          // eraser above). Flush family decor never stamped anything, so nothing is cleared
          // for it — checking what was actually there is what keeps erasing a grass tuft from
          // punching a hole in a hand-painted wall.
          const gone = next.decor.get(k);
          if (gone && isBlockingDecorUrl(gone)) unstampSolid([k]);
          next.decor.delete(k);
          return next;
        }
        const rotation = editorDecorRotation(category, editorSurfaceAt(next, col, row));
        if (rotation.length === 0) return next;
        // Stamp the variant the CALLER has selected, and do not advance it. The index is a
        // tool modifier owned by the palette (Space cycles it, the ghost previews it), exactly
        // as in the night market editor's `paintCell` — the draft must not have a second,
        // invisible copy of it. Auto-advancing here (the previous behaviour) made every click
        // place a different prop, made a drag spray a row of mismatched ones, and left the
        // ghost preview permanently lying about what a click would place.
        next.decor.set(k, rotation[variantIdx % rotation.length]);
        // A prop/tree and a piece of FURNITURE are both solid objects, so they cannot share a
        // cell: dropping one on the other REPLACES it (the whole piece, from whichever of its
        // cells was clicked). The flush surface-decor family is exempt — it lies flat and
        // furniture legitimately stands on it. Mirrors the furniture branch above.
        if (category === 'common' || category === 'tree') {
          const buried = furnitureAt(next.furniture ?? [], col, row);
          if (buried) {
            next.furniture = (next.furniture ?? []).filter((f) => f !== buried);
            // The displaced piece's solidity leaves with it across its WHOLE footprint —
            // only the clicked cell gains a prop, so the rest of the sofa must not stay
            // invisibly solid.
            unstampSolid(furnitureCells(buried));
          }
          // A prop or a tree is a solid object, so it stamps the mask on the cell it lands on
          // (after the displacement above, which could otherwise unstamp this very cell).
          // Flush family decor stamps nothing: it lies flat and is walked over.
          stampSolid([k]);
        }
        return next;
      }

      // THE WALKABILITY MASK. A plain cell mask — no sprite, no rotation, nothing to cycle.
      if (tool === 'unwalkable') {
        if (erase) next.unwalkable.delete(k);
        else next.unwalkable.add(k);
        return next;
      }

      // THE FACING MASK. `variantIdx` carries the DIRECTION here, exactly as it carries the
      // decor rotation index and the furniture catalogue index elsewhere: the selector is a
      // tool modifier owned by the palette (Space cycles it, the ghost arrow previews it),
      // and the draft must not keep a second, invisible copy of it.
      if (tool === 'forcedDirection') {
        if (erase) next.forcedDirection.delete(k);
        else next.forcedDirection.set(k, IW_PAINT_FACINGS[variantIdx % IW_PAINT_FACINGS.length]);
        return next;
      }

      const layer = next[tool as 'terrain1' | 'terrain2'];
      if (erase) layer.delete(k);
      else layer.add(k);
      return next;
    });
  }, []);

  const placeAt = useCallback((tool: IWPlaceTool, col: number, row: number) => {
    setDirty(true);

    // A place tag is map data, not scene data, so it is the one place tool that writes to
    // `places` instead of to the scene.
    if (tool.startsWith('tag:')) {
      const tag = tool.slice('tag:'.length);
      // Clicking with a tag MOVES it: a tag names exactly one cell, so the click replaces
      // whatever cell it named before (or the unplaced sentinel, which is what turns
      // "named" into "placed"). Nothing is cleared from the target cell — several tags may
      // legitimately name the same one.
      setPlaces((prev) => ({ ...prev, [tag]: `${col},${row}` }));
      return;
    }

    setScene((prev) => {
      if (tool === 'player') return { ...prev, playerStartCol: col, playerStartRow: row };
      if (tool === 'companion') return { ...prev, companionStartCol: col, companionStartRow: row };
      const npcId = tool.slice('npc:'.length);
      return {
        ...prev,
        npcCast: prev.npcCast.map((m) => (m.npcId === npcId ? { ...m, col, row } : m)),
      };
    });
  }, []);

  const setFloor = useCallback((kind: BoardFloor['kind']) => {
    setDirty(true);
    setMasks((prev) => {
      const current = prev.floor ?? DIRT_FLOOR;
      // Re-picking wood is the "shuffle" affordance; every other transition keeps the seed.
      const seed = kind === 'wood' && current.kind === 'wood' ? rollFloorSeed()
        : current.seed || rollFloorSeed();
      return { ...prev, floor: { kind, seed } };
    });
  }, []);

  const addCastMember = useCallback((npcId: string) => {
    setDirty(true);
    setScene((prev) => {
      if (prev.npcCast.some((m) => m.npcId === npcId)) return prev;
      // Drop the newcomer on the first FREE cell, scanning row-major. Placing them on an
      // occupied cell would save-block the scene the moment they are added, which reads as
      // the tool being broken rather than as an authoring choice to make.
      const taken = new Set<string>([
        `${prev.playerStartCol},${prev.playerStartRow}`,
        `${prev.companionStartCol},${prev.companionStartRow}`,
        ...prev.npcCast.map((m) => `${m.col},${m.row}`),
      ]);
      let col = 0, row = 0;
      outer: for (let r = 0; r < prev.height; r++) {
        for (let c = 0; c < prev.width; c++) {
          if (!taken.has(`${c},${r}`)) { col = c; row = r; break outer; }
        }
      }
      return { ...prev, npcCast: [...prev.npcCast, { npcId, col, row, facing: 's' }] };
    });
  }, []);

  const removeCastMember = useCallback((npcId: string) => {
    setDirty(true);
    setScene((prev) => ({
      ...prev,
      npcCast: prev.npcCast.filter((m) => m.npcId !== npcId),
      // A departed NPC cannot still be the completer. Clearing it here is what stops the
      // single most damaging authoring error from surviving a cast edit.
      completerNpcId: prev.completerNpcId === npcId ? '' : prev.completerNpcId,
      // …nor can they still speak in an authored exchange; drop those lines with them.
      conversations: prev.conversations.map((conv) => ({
        ...conv,
        turns: conv.turns.filter((t) => t.npcId !== npcId),
      })),
      // …nor can a poke still ask them to perform something. Their `npc_action` steps go
      // with them, for the same reason their conversation turns do.
      interactions: dropInteractionSteps(
        prev.interactions ?? {},
        (st) => st.kind === 'npc_action' && st.npcId === npcId,
      ),
    }));
  }, []);

  const updateCastMember = useCallback((npcId: string, patch: Partial<IWSceneCastMember>) => {
    setDirty(true);
    setScene((prev) => ({
      ...prev,
      npcCast: prev.npcCast.map((m) => (m.npcId === npcId ? { ...m, ...patch } : m)),
    }));
  }, []);

  // ── Named places (§ 14 Q42) ───────────────────────────────────────────────
  // A tag exists independently of any cell: an author names it, then places it. That order
  // is deliberate — the alternative (click a cell, get prompted for a name) makes the map
  // the only place a tag can be seen, and a scene's list of places is worth reading on its
  // own, next to the actions that walk to them.
  const addPlace = useCallback((tag: string) => {
    const clean = tag.trim();
    if (!clean) return;
    setDirty(true);
    // Uncelled tags live in the same record under a sentinel CELL, so one structure holds
    // both "named but unplaced" and "named and placed" without a second list to keep in sync.
    setPlaces((prev) => (clean in prev ? prev : { ...prev, [clean]: UNPLACED_CELL }));
  }, []);

  const renamePlace = useCallback((from: string, to: string) => {
    const clean = to.trim();
    if (!clean || clean === from) return;
    // Renaming onto a name that already exists would silently MERGE two places (one key,
    // one cell), so it is refused outright — and refused HERE, before anything is touched,
    // so the cast rewrite below can never repoint steps at somebody else's place.
    if (clean in places) return;
    setDirty(true);
    // The tag IS the key, so a rename moves the entry — and `fromEntries` keeps its cell.
    setPlaces((prev) => Object.fromEntries(
      Object.entries(prev).map(([tag, cell]) => [tag === from ? clean : tag, cell]),
    ));
    // The steps that walked there must follow the rename, or a save that was valid a
    // moment ago becomes invalid for a reason the author did not cause. The place's own
    // interaction moves with it too — the tag IS the key, so a rename that did not carry it
    // would silently strand the script under a name nothing points at.
    setScene((prev) => ({
      ...prev,
      npcCast: prev.npcCast.map(renameTagInCast(from, clean)),
      interactions: Object.fromEntries(
        Object.entries(prev.interactions ?? {}).map(([tag, steps]) => [tag === from ? clean : tag, steps]),
      ),
    }));
  }, [places]);

  const removePlace = useCallback((tag: string) => {
    setDirty(true);
    setPlaces((prev) => Object.fromEntries(
      Object.entries(prev).filter(([t]) => t !== tag),
    ));
    // Drop the steps that pointed at it, for the same reason removeCastMember drops the
    // conversation turns of a departed NPC: a dangling reference is a silent playback stall.
    setScene((prev) => ({
      ...prev,
      npcCast: prev.npcCast.map(dropTagFromCast(tag)),
      // The place is gone, so nothing can trigger its script any more — an interaction has
      // no identity apart from the tag it hangs on.
      interactions: Object.fromEntries(
        Object.entries(prev.interactions ?? {}).filter(([t]) => t !== tag),
      ),
    }));
  }, []);

  // ── Authored actions (§ 14 Q42) ───────────────────────────────────────────
  const addAction = useCallback((npcId: string) => {
    setDirty(true);
    setScene((prev) => ({
      ...prev,
      npcCast: prev.npcCast.map((m) => {
        if (m.npcId !== npcId) return m;
        const actions = m.actions ?? [];
        const taken = new Set(actions.map((a) => a.id));
        let n = 1;
        while (taken.has(`act${n}`)) n++;
        // One `wait_for_response` by default: nearly every action ends by handing the floor
        // back, and an author who does not want it can delete one step.
        return {
          ...m,
          actions: [...actions, { id: `act${n}`, name: '', steps: [{ kind: 'wait_for_response' }] }],
        };
      }),
    }));
  }, []);

  const updateAction = useCallback((npcId: string, actionId: string, patch: Partial<IWNpcAction>) => {
    setDirty(true);
    setScene((prev) => ({
      ...prev,
      npcCast: prev.npcCast.map((m) => (m.npcId === npcId
        ? { ...m, actions: (m.actions ?? []).map((a) => (a.id === actionId ? { ...a, ...patch } : a)) }
        : m)),
    }));
  }, []);

  const removeAction = useCallback((npcId: string, actionId: string) => {
    setDirty(true);
    setScene((prev) => ({
      ...prev,
      npcCast: prev.npcCast.map((m) => (m.npcId === npcId
        ? { ...m, actions: (m.actions ?? []).filter((a) => a.id !== actionId) }
        : m)),
      // Deleting the action a scene was ending on clears the nomination rather than leaving
      // it pointing at nothing. The validator would catch the dangle either way, but a stale
      // pick that still LOOKS chosen in the picker is the more confusing failure.
      completionAction:
        prev.completerNpcId === npcId && prev.completionAction === actionId
          ? ''
          : prev.completionAction,
      // A poke that performed this action has lost its script. Dropped rather than left
      // dangling, for the same reason the completion nomination is cleared just above.
      interactions: dropInteractionSteps(
        prev.interactions ?? {},
        (st) => st.kind === 'npc_action' && st.npcId === npcId && st.actionId === actionId,
      ),
    }));
  }, []);

  // ── Place interactions (migration 162, § 14 Q43) ──────────────────────────
  // One setter for the whole script rather than add/update/remove-step triplets: a place has
  // exactly one interaction, the panel already holds it as a list, and three mutations of one
  // array is three chances for them to disagree about what an empty script means.
  const setInteraction = useCallback((tag: string, steps: IWInteractionStep[]) => {
    setDirty(true);
    setScene((prev) => {
      const next = { ...(prev.interactions ?? {}) };
      // An empty script REMOVES the entry: that is how an author turns a place back into an
      // ordinary walk destination, and leaving `tag: []` behind would persist a place that
      // reads as interactive everywhere except when you poke it.
      if (steps.length === 0) delete next[tag];
      else next[tag] = steps;
      return { ...prev, interactions: next };
    });
  }, []);

  const toPayload = useCallback((): IWScene => ({
    ...scene,
    layout: masksToSceneLayout(masks, places),
  }), [scene, masks, places]);

  const markSaved = useCallback((saved: IWScene) => {
    // Keep the author's live map rather than the server's echo of it: they are the same
    // content, and swapping in a fresh Set/Map would remount every painted layer.
    setScene((prev) => ({ ...saved, layout: prev.layout }));
    setDirty(false);
  }, []);

  return useMemo(() => ({
    scene, masks, dirty, places,
    update, loadScene, paintCell, placeAt, setFloor,
    addCastMember, removeCastMember, updateCastMember,
    addPlace, renamePlace, removePlace,
    addAction, updateAction, removeAction, setInteraction,
    toPayload, markSaved,
  }), [scene, masks, dirty, places, update, loadScene, paintCell, placeAt, setFloor,
       addCastMember, removeCastMember, updateCastMember,
       addPlace, renamePlace, removePlace,
       addAction, updateAction, removeAction, setInteraction, toPayload, markSaved]);
}
