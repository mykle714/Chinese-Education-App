import { useCallback, useMemo, useRef, useState } from 'react';
import {
  editorDecorRotation, editorSurfaceAt, rollFloorSeed, DIRT_FLOOR,
  type BoardFloor, type DecorCategory, type EditorMasks,
} from '../../engine/market/farmTerrain';
import type { IWNpcAction, IWScene, IWSceneCastMember } from '../../../server/contracts/iw';
import { masksToSceneLayout, sceneLayoutToMasks } from './immersiveWorldSceneApi';

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
 * condition, no copy/paste, and (since 2026-09-05) **no street/communal**: a scene has no
 * walkability masks to paint. See `IWSceneLayout`'s header for why the model is inverted.
 */
export type IWPaintTool =
  | 'terrain1'
  | 'terrain2'
  | 'familyDecor'
  | 'commonDecor'
  | 'treeDecor';

/**
 * A tool that PLACES SOMETHING AT A CELL rather than painting a layer: the player's start,
 * the companion's start, a cast NPC (`npc:<id>`), or a named place (`loc:<tag>`).
 *
 * Placement is a click, not a drag: a body is somewhere, not spread over cells. A named
 * place is the one member that is not a body — but it behaves identically (one click, one
 * cell), and a tagged cell is the only kind of cell an authored action can name, so it
 * belongs on this side of the split rather than with the paint layers.
 */
export type IWPlaceTool = 'player' | 'companion' | `npc:${string}` | `loc:${string}`;

export type IWEditorTool = IWPaintTool | IWPlaceTool;

export const isPlaceTool = (tool: IWEditorTool): tool is IWPlaceTool =>
  tool === 'player' || tool === 'companion'
  || tool.startsWith('npc:') || tool.startsWith('loc:');

/** The decor category a decor tool paints, or null for a non-decor tool. */
const DECOR_CATEGORY: Partial<Record<IWPaintTool, DecorCategory>> = {
  familyDecor: 'family',
  commonDecor: 'common',
  treeDecor: 'tree',
};

export const decorCategoryFor = (tool: IWEditorTool): DecorCategory | null =>
  (isPlaceTool(tool) ? null : DECOR_CATEGORY[tool] ?? null);

/** Board defaults for a brand-new scene — small enough to fill, big enough to walk in. */
const DEFAULT_DIM = 12;

/**
 * Key prefix for a named place that has been created but not yet put on the board.
 *
 * `layout.locations` is keyed by cell, and an unplaced tag has no cell — so it is parked
 * under a key that CANNOT parse as one ("col,row" is digits and a comma). The validator
 * rejects any key it cannot parse, which is exactly right: an unplaced tag must not be
 * saveable, and this makes "you named a place but never put it anywhere" a save error
 * rather than a scene whose action walks nowhere.
 */
export const UNPLACED_PREFIX = 'unplaced:';

export const isUnplacedLocationKey = (cell: string) => cell.startsWith(UNPLACED_PREFIX);

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

/** An empty scene, ready to author. `completerNpcId` is deliberately blank: it must be chosen. */
export function blankScene(language: 'zh' | 'es' = 'zh'): IWScene {
  return {
    language,
    name: '',
    published: false,
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
    layout: { terrain1: [], terrain2: [], decor: {}, locations: {}, floor: DIRT_FLOOR },
    npcCast: [],
    complications: [],
    conversations: [],
  };
}

function emptyMasks(): EditorMasks {
  return {
    terrain1: new Set(), terrain2: new Set(),
    // street/communal/placeholder/condition are never painted by a scene; they exist only
    // because `EditorMasks` is the night market editor's shape (see `sceneLayoutToMasks`).
    street: new Set(), communal: new Set(),
    placeholder: [], condition: new Set(), decor: new Map(), floor: DIRT_FLOOR,
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
  paintCell: (col: number, row: number, tool: IWPaintTool, erase: boolean) => void;
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
   * Named places (§ 14 Q42): "col,row" → tag. Held BESIDE the masks rather than inside
   * them, because `EditorMasks` is the night market's type and knows nothing about tags —
   * `toPayload` folds the two together into `layout`.
   */
  locations: Record<string, string>;
  /** Create a tag with no cell yet; the author then places it with the `loc:` tool. */
  addLocation: (tag: string) => void;
  /** Rename every cell carrying `from`. Also rewrites the steps that walk to it. */
  renameLocation: (from: string, to: string) => void;
  /** Forget a tag entirely, and any action step that walked to it. */
  removeLocation: (tag: string) => void;

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
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  // The decor variant index advances per placement so repeated clicks with one tool cycle
  // its rotation — the same affordance the night market editor gives, minus the Space key.
  const decorVariantRef = useRef(0);

  const update = useCallback((patch: Partial<IWScene>) => {
    setScene((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }, []);

  const loadScene = useCallback((next: IWScene) => {
    setScene(next);
    setMasks(sceneLayoutToMasks(next.layout));
    setLocations({ ...(next.layout?.locations ?? {}) });
    setDirty(false);
  }, []);

  const paintCell = useCallback((col: number, row: number, tool: IWPaintTool, erase: boolean) => {
    const k = `${col},${row}`;
    setDirty(true);
    setMasks((prev) => {
      const next: EditorMasks = {
        terrain1: new Set(prev.terrain1),
        terrain2: new Set(prev.terrain2),
        street: prev.street,             // scenes never paint any of these four;
        communal: prev.communal,         // carried untouched (always empty)
        placeholder: prev.placeholder,
        condition: new Set(prev.condition),
        decor: new Map(prev.decor),
        floor: prev.floor,              // board-wide; a paint stroke never touches it
      };

      const category = DECOR_CATEGORY[tool];
      if (category) {
        if (erase) { next.decor.delete(k); return next; }
        const rotation = editorDecorRotation(category, editorSurfaceAt(next, col, row));
        if (rotation.length === 0) return next;
        next.decor.set(k, rotation[decorVariantRef.current % rotation.length]);
        decorVariantRef.current += 1;
        // Nothing to clear: painting a common prop or a tree is ITSELF what makes the cell
        // impassable (`farmTerrain.isBlockingDecorUrl`). In the night market this branch also
        // had to strip the cell's walkable class; a scene has none to strip.
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
    // `locations` instead of to the scene.
    if (tool.startsWith('loc:')) {
      const tag = tool.slice('loc:'.length);
      setLocations((prev) => {
        const next = { ...prev };
        // Clicking with a tag ADDS a cell rather than moving the tag: several cells may
        // share one name, and `walk_to_tag` heads for the nearest. Dropping the unplaced
        // sentinel is what turns "named" into "placed".
        delete next[`${UNPLACED_PREFIX}${tag}`];
        next[`${col},${row}`] = tag;
        return next;
      });
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
  const addLocation = useCallback((tag: string) => {
    const clean = tag.trim();
    if (!clean) return;
    setDirty(true);
    // Uncelled tags live in the same record under a sentinel key, so one structure holds
    // both "named but unplaced" and "named and placed" without a second list to keep in sync.
    setLocations((prev) => (Object.values(prev).includes(clean)
      ? prev
      : { ...prev, [`${UNPLACED_PREFIX}${clean}`]: clean }));
  }, []);

  const renameLocation = useCallback((from: string, to: string) => {
    const clean = to.trim();
    if (!clean || clean === from) return;
    setDirty(true);
    setLocations((prev) => Object.fromEntries(
      Object.entries(prev).map(([cell, tag]) => [
        // An unplaced tag's key encodes its own name, so renaming has to move the key too.
        cell.startsWith(UNPLACED_PREFIX) && tag === from ? `${UNPLACED_PREFIX}${clean}` : cell,
        tag === from ? clean : tag,
      ]),
    ));
    // The steps that walked there must follow the rename, or a save that was valid a
    // moment ago becomes invalid for a reason the author did not cause.
    setScene((prev) => ({ ...prev, npcCast: prev.npcCast.map(renameTagInCast(from, clean)) }));
  }, []);

  const removeLocation = useCallback((tag: string) => {
    setDirty(true);
    setLocations((prev) => Object.fromEntries(
      Object.entries(prev).filter(([, t]) => t !== tag),
    ));
    // Drop the steps that pointed at it, for the same reason removeCastMember drops the
    // conversation turns of a departed NPC: a dangling reference is a silent playback stall.
    setScene((prev) => ({ ...prev, npcCast: prev.npcCast.map(dropTagFromCast(tag)) }));
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
    }));
  }, []);

  const toPayload = useCallback((): IWScene => ({
    ...scene,
    layout: masksToSceneLayout(masks, locations),
  }), [scene, masks, locations]);

  const markSaved = useCallback((saved: IWScene) => {
    // Keep the author's live map rather than the server's echo of it: they are the same
    // content, and swapping in a fresh Set/Map would remount every painted layer.
    setScene((prev) => ({ ...saved, layout: prev.layout }));
    setDirty(false);
  }, []);

  return useMemo(() => ({
    scene, masks, dirty, locations,
    update, loadScene, paintCell, placeAt, setFloor,
    addCastMember, removeCastMember, updateCastMember,
    addLocation, renameLocation, removeLocation,
    addAction, updateAction, removeAction,
    toPayload, markSaved,
  }), [scene, masks, dirty, locations, update, loadScene, paintCell, placeAt, setFloor,
       addCastMember, removeCastMember, updateCastMember,
       addLocation, renameLocation, removeLocation,
       addAction, updateAction, removeAction, toPayload, markSaved]);
}
