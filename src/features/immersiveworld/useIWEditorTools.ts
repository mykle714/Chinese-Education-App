import { useEffect, useState } from 'react';
import {
  furnitureAtIndex, furnitureIndexOf, FURNITURE_CATALOGUE,
} from '../../engine/market/furniture';
import { lumeishTileset } from '../../engine/market/lumeishTileset';
import { useArrowPagedIndex } from '../../hooks/useArrowPagedIndex';
import type { BoardFloor } from '../../engine/market/farmTerrain';
import type { IWFacing, IWSceneCastMember } from '../../../server/contracts/iw';
import {
  decorCategoryFor, isForcedDirectionTool, isFurnitureTool, isPlaceTool, IW_PAINT_FACINGS,
  type IWEditorTool, type IWPaintTool,
} from './useIWSceneDraft';

/**
 * useIWEditorTools — the scene editor's TOOL MODIFIER state and its keyboard dispatch
 * (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * LAYER: feature view plumbing. It owns nothing about the scene itself — no cell, no cast,
 * no field — only "what would the next click stamp, and what does the board look like while
 * I aim it". Everything durable still lives in `useIWSceneDraft`.
 *
 * WHY IT EXISTS AT ALL (2026-09-19). This state used to sit inside `IWSceneMapPanel`,
 * because the palette and the canvas were the same component: the palette was a DOM overlay
 * floating on top of the Pixi board. The palette has since moved off the board into its own
 * column (`IWSceneToolsPanel`), and those two now sit in different subtrees — so the shared
 * truth between them has to live above both. That is this hook, held by
 * `IWSceneEditorPage` and handed to both halves.
 *
 * THE ONE-SOURCE-OF-TRUTH RULE THE MOVE MUST NOT BREAK: the ghost under the cursor and the
 * stamp a click lays down read the SAME number. The palette shows it, the viewer previews
 * it, a click applies it — and the draft keeps no second, invisible copy of any of it.
 */

/** What the keyboard needs to reach that is not a tool modifier — supplied by the page. */
export interface IWEditorToolsDeps {
  activeTool: IWEditorTool;
  eraseMode: boolean;
  /** Read live so a cast member added after mount is immediately reachable by its digit. */
  npcCast: IWSceneCastMember[];
  onToolChange: (tool: IWEditorTool) => void;
  onEraseModeChange: (erase: boolean) => void;
  onFloorChange: (kind: BoardFloor['kind']) => void;
}

export interface IWEditorTools {
  /** Gridlines over the board. A VIEW toggle: a reload is entitled to forget it. */
  showGrid: boolean;
  setShowGrid: (next: boolean) => void;
  /**
   * The three ANNOTATION view toggles (2026-09-20). Same nature as `showGrid` — they change
   * what the author can see, never what the scene holds, and a reload may forget them.
   *
   * ⚠️ The stored flag is not the whole answer: `IWSceneMapPanel` ORs each one with "its own
   * paint tool is active", so painting a layer always reveals it. These fields are the
   * author's persistent preference, which is what the palette buttons light from — exactly
   * the split the template editor's four mask views make.
   */
  showUnwalkable: boolean;
  setShowUnwalkable: (next: boolean) => void;
  showForcedDirection: boolean;
  setShowForcedDirection: (next: boolean) => void;
  /** The green place PINS. Not a tint — a marker list the map panel filters. */
  showPlaces: boolean;
  setShowPlaces: (next: boolean) => void;
  /** Index into the active decor tool's rotation — cycled by Space, previewed as the ghost. */
  decorVariantIdx: number;
  /** Index into {@link IW_PAINT_FACINGS} for the forced-direction tool. */
  forcedFacingIdx: number;
  /** The facing that index resolves to, for the ghost arrow and the hint line. */
  forcedFacing: IWFacing;
  /** Index into the shared `FURNITURE_CATALOGUE`, paged with ← / →. */
  furnitureIdx: number;
  /** The sprite that index resolves to, or null when no furniture pack is loaded. */
  furnitureSpriteId: number | null;
  /** The Furniture button's live readout: which piece, its iso footprint, and whether it turns. */
  furnitureLabel: string;
}

/**
 * Hotkeys for the CAST, in cast order — the whole number row, since the walkability tints
 * that used to hold 1 and 2 are gone.
 *
 * ⚠️ Eight keys for a cap of eight (`IW_MAX_CAST`), so every cast member is reachable — but
 * the pairing is POSITIONAL, not by npc id: removing the first cast member re-letters the
 * rest. That is the same bargain the nme makes with its palette order, and it is why the
 * badge is drawn from this array rather than stored on the member.
 */
export const CAST_HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

/**
 * Keyboard → paint tool. The authoritative dispatch; the per-tool `hotkey` badges in
 * `IWSceneToolsPanel` are its display mirror and must match. Keys are compared lower-case
 * and the layout mirrors the physical keyboard, one palette row per keyboard row: T/Y
 * terrain (top letter row), S/D/F decor (home row), Z/X + digits bodies (bottom row /
 * number row). NON-tool keys are handled separately in the keydown effect below: ` grid,
 * A/G floor, B eraser modifier, Space decor-variant cycle, E/R/P the annotation views.
 *
 * ⚠️ WHY THE ANNOTATION VIEWS ARE NOT ON THE DIGITS, the way the template editor's are: the
 * whole number row is the CAST here (`CAST_HOTKEYS`, eight keys for a cap of eight). E and R
 * instead sit immediately right of the two mask paint tools they reveal (Q unwalkable, W
 * forced direction) on the same keyboard row, and P is the initial of the thing it shows.
 */
export const HOTKEY_TO_PAINT_TOOL: Record<string, IWPaintTool> = {
  t: 'terrain1', y: 'terrain2',
  q: 'unwalkable', w: 'forcedDirection',
  s: 'familyDecor', d: 'commonDecor', f: 'treeDecor',
  c: 'furniture',
};

export function useIWEditorTools({
  activeTool, eraseMode, npcCast, onToolChange, onEraseModeChange, onFloorChange,
}: IWEditorToolsDeps): IWEditorTools {
  const [showGrid, setShowGrid] = useState(true);

  /**
   * The three annotation views. All default ON: an author who has not asked to hide anything
   * must see everything the board holds, and a hidden layer is the one state that can make an
   * empty-looking cell lie about what is on it.
   */
  const [showUnwalkable, setShowUnwalkable] = useState(true);
  const [showForcedDirection, setShowForcedDirection] = useState(true);
  const [showPlaces, setShowPlaces] = useState(true);

  /**
   * The selected DECOR variant, as an index into the active decor tool's rotation — cycled by
   * Space, previewed as the viewer's ghost, and stamped verbatim by a click. Mirrors the night
   * market editor's `decorVariantIdx` field for field, including the two rules that make the
   * palette honest:
   *   • ONE source of truth — the ghost and the stamp read the same number, so what you see
   *     under the cursor is what a click places;
   *   • a click does NOT advance it — placing the same prop twice, or dragging a row of one
   *     prop, is the common act and must not require re-picking the variant each cell.
   * It is not reset on a tool change — the modulo is applied per rotation, as in the nme.
   */
  const [decorVariantIdx, setDecorVariantIdx] = useState(0);

  /**
   * The facing the forced-direction tool will stamp, as an index into {@link IW_PAINT_FACINGS}
   * — cycled by Space, previewed as the viewer's ghost arrow, and stamped verbatim by a click.
   * Same contract as `decorVariantIdx`, and it rides through the same `variantIdx` parameter.
   */
  const [forcedFacingIdx, setForcedFacingIdx] = useState(0);
  const forcedFacing = IW_PAINT_FACINGS[forcedFacingIdx % IW_PAINT_FACINGS.length];

  /**
   * The selected FURNITURE sprite, as an index into the shared `FURNITURE_CATALOGUE` — the
   * same catalogue and the same ← / → paging the night market editor's Furniture tool uses,
   * so the two palettes cannot drift into showing different furniture or answering to
   * different keys. Live only while the Furniture tool is active, leaving the arrows free.
   */
  const { index: furnitureIdx, setIndex: setFurnitureIdx } = useArrowPagedIndex(
    FURNITURE_CATALOGUE.length,
    isFurnitureTool(activeTool),
  );
  const furnitureSpriteId = furnitureAtIndex(furnitureIdx);

  const furnitureLabel = (() => {
    if (furnitureSpriteId === null) return 'no furniture pack loaded';
    const span = lumeishTileset.span(furnitureSpriteId);
    const turnable = lumeishTileset.facingSibling(furnitureSpriteId) ? ' · Space turns it around' : '';
    return `#${furnitureSpriteId} (${furnitureIdx + 1}/${FURNITURE_CATALOGUE.length}) · ${span.w}×${span.h} cells${turnable}`;
  })();

  // ── Keyboard hotkeys ──────────────────────────────────────────────────────────────
  // Same contract as the night market editor's: bare keypresses only (never hijack a
  // browser shortcut), and suppressed whenever focus is in a text field, so typing a
  // scene's objective can never paint its board.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;

      const key = e.key.toLowerCase();

      // The VIEW toggles. Grid keeps the nme's own key; the three annotation views take
      // E/R/P (the digits are the cast here — see HOTKEY_TO_PAINT_TOOL's note). Functional
      // setters, so none of them has to join this effect's dependency list.
      if (key === '`') { setShowGrid(!showGrid); e.preventDefault(); return; }
      if (key === 'e') { setShowUnwalkable((v) => !v); e.preventDefault(); return; }
      if (key === 'r') { setShowForcedDirection((v) => !v); e.preventDefault(); return; }
      if (key === 'p') { setShowPlaces((v) => !v); e.preventDefault(); return; }

      // B toggles the eraser MODIFIER, layered on top of the selected tool. A place tool
      // has no layer to erase, so B is a no-op there — mirroring the disabled button.
      if (key === 'b') { if (!isPlaceTool(activeTool)) onEraseModeChange(!eraseMode); e.preventDefault(); return; }

      // Space cycles the active decor tool's variant (the ghost previews it), and is
      // swallowed otherwise so it never scrolls the page or re-taps a focused button.
      if (key === ' ') {
        if (decorCategoryFor(activeTool)) setDecorVariantIdx((i) => i + 1);
        // Forced direction: turn the arrow one quarter — N → E → S → W. The SAME key as the
        // decor variant and the furniture facing, because it is the same idea: Space changes
        // what the active tool would stamp, and the ghost says what that is.
        else if (isForcedDirectionTool(activeTool)) setForcedFacingIdx((i) => i + 1);
        // Furniture: jump to the piece's OPPOSITE FACING. A sprite SWAP, never a render flip —
        // the pack's two facings are independently shaded art, so mirroring one would light
        // the wrong face (see engine/market/furniture.ts). A no-op for an unpaired sprite.
        else if (isFurnitureTool(activeTool) && furnitureSpriteId !== null) {
          const sibling = lumeishTileset.facingSibling(furnitureSpriteId);
          const siblingIdx = sibling ? furnitureIndexOf(sibling.id) : -1;
          if (siblingIdx >= 0) setFurnitureIdx(siblingIdx);
        }
        e.preventDefault();
        return;
      }

      // The FLOOR row. Not tools, so they are handled here beside the view toggles rather
      // than through HOTKEY_TO_PAINT_TOOL — pressing one must not change what a click does.
      if (key === 'a') { onFloorChange('dirt'); e.preventDefault(); return; }
      if (key === 'g') { onFloorChange('wood'); e.preventDefault(); return; }

      // The two fixed bodies, then the cast along the digits.
      if (key === 'z') { onToolChange('player'); e.preventDefault(); return; }
      if (key === 'x') { onToolChange('companion'); e.preventDefault(); return; }
      const castIdx = CAST_HOTKEYS.indexOf(key as typeof CAST_HOTKEYS[number]);
      if (castIdx >= 0) {
        const member = npcCast[castIdx];
        if (member) onToolChange(`npc:${member.npcId}`);
        e.preventDefault();
        return;
      }

      const tool = HOTKEY_TO_PAINT_TOOL[key];
      if (!tool) return;
      onToolChange(tool);
      e.preventDefault(); // stop the key from re-triggering a focused button
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTool, eraseMode, showGrid, furnitureSpriteId, setFurnitureIdx,
      onEraseModeChange, onToolChange, onFloorChange, npcCast]);

  return {
    showGrid, setShowGrid,
    showUnwalkable, setShowUnwalkable,
    showForcedDirection, setShowForcedDirection,
    showPlaces, setShowPlaces,
    decorVariantIdx, forcedFacingIdx, forcedFacing,
    furnitureIdx, furnitureSpriteId, furnitureLabel,
  };
}
