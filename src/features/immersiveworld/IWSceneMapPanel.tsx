import { useCallback, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import TemplateEditorViewer, { type EditorMarker } from '../nightmarket/TemplateEditorViewer';
import { DIRT_FLOOR, type EditorMasks } from '../../engine/market/farmTerrain';
import { freeFarmTileset } from '../../engine/market/freeFarmTileset';
import {
  iwPlayerAvatar,
  type IWAvatar, type IWFacing, type IWNpcOption, type IWScene,
} from '../../../server/contracts/iw';
import {
  decorCategoryFor, isForcedDirectionTool, isFurnitureTool, isPlaceTool,
  type IWEditorTool, type IWPaintTool, type IWPlaceTool,
} from './useIWSceneDraft';
import type { IWEditorTools } from './useIWEditorTools';
import { iwBoardVoidBg } from './iwBoardVoid';
import { useAuth } from '../../AuthContext';

/**
 * IWSceneMapPanel — the scene's BOARD: the isometric canvas, the ghost under the cursor
 * and the pins showing who stands where (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * LAYER: feature view. It owns NO state at all — the draft owns the board, the page owns
 * the active tool, and `useIWEditorTools` owns the modifiers. It renders the shared
 * `TemplateEditorViewer` from the night market, which is § 12 phase 1d's "reuses the nme
 * for the map" made literal: iw did not fork a map editor, it passes a different mask set
 * and a `markers` list into the one that exists.
 *
 * THE PALETTE LEFT THIS FILE (2026-09-19). It used to be a DOM overlay floating on top of
 * this canvas; it now lives in `IWSceneToolsPanel`, a real column beside the board. That
 * deleted a whole class of bug rather than fixing one: Pixi binds `pointerdown` to the
 * canvas element while hearing `pointermove` from the document, so every pixel the overlay
 * covered swallowed the press that STARTS an edit while still letting a drag begun
 * elsewhere paint straight through it. Bodies and places could only be placed on the part
 * of the board the palette did not cover. There is no overlay left to cover anything.
 *
 * What remains on the canvas is the one-line HINT at the bottom, which is still
 * `pointerEvents: 'none'` for exactly that reason.
 */

export interface IWSceneMapPanelProps {
  scene: IWScene;
  masks: EditorMasks;
  /** Named places: tag → "col,row" (§ 14 Q42). Unplaced tags are skipped by the pins. */
  places: Record<string, string>;
  npcs: IWNpcOption[];
  activeTool: IWEditorTool;
  eraseMode: boolean;
  onPaintCell: (col: number, row: number, tool: IWPaintTool, erase: boolean, variantIdx: number) => void;
  /** Only ever called with a PLACE tool — the panel resolves which kind a click is. */
  onPlaceAt: (tool: IWPlaceTool, col: number, row: number) => void;
  /** The live tool modifiers, shared with the palette so the ghost and the stamp agree. */
  tools: IWEditorTools;
}

/** "col,row" → a cell, or null for anything else (notably an unplaced tag's empty cell). */
function parsePlaceCell(cell: string): { col: number; row: number } | null {
  const m = /^(\d+),(\d+)$/.exec(cell);
  return m ? { col: Number(m[1]), row: Number(m[2]) } : null;
}

/**
 * The still frame that stands for a body on the editor board.
 *
 * Frame 1 of the IDLE cycle, not a walk frame: an authored scene is a snapshot of everyone
 * standing still before anything happens, and a mid-stride sprite would imply motion the
 * board does not have. The editor draws no animation at all — that is the runtime's job.
 */
function avatarSprite(avatar: IWAvatar, facing: IWFacing): string | undefined {
  return freeFarmTileset.getIdleFrames(avatar, facing)[0];
}

/** Marker colours. The player and the companion are deliberately unlike any cast pin. */
const PLAYER_MARKER_COLOR = 0x66ccff;
const COMPANION_MARKER_COLOR = 0xffcc44;
const CAST_MARKER_COLOR = 0xff7777;
/** A named place is not a body, so it is the one pin colour outside the warm/cool pair. */
const PLACE_MARKER_COLOR = 0x9cff9c;

export default function IWSceneMapPanel({
  scene, masks, places, npcs, activeTool, eraseMode, onPaintCell, onPlaceAt, tools,
}: IWSceneMapPanelProps) {

  /** The learner's body, from the author's own account (migration 164) — see the Player pin. */
  const { user } = useAuth();
  const playerAvatar = iwPlayerAvatar(user?.gender);

  /** The board's floor, read straight off the masks (absent ⇒ dirt) — no second copy to drift. */
  const floorKind = (masks.floor ?? DIRT_FLOOR).kind;

  /**
   * The EFFECTIVE annotation views: the author's stored preference OR "its own tool is armed".
   *
   * The forced-on half is the whole reason these two layers may be hidden at all. Unwalkable
   * and forced-direction change what the SIMULATION does, not just how the board looks, so
   * painting one while it is invisible is the failure worth designing out — and this is the
   * same rule the template editor applies to its four mask views. The palette buttons light
   * from the STORED flag (`tools.show*`), not from these, so a forced reveal never silently
   * rewrites what the author asked for.
   */
  const showUnwalkable = tools.showUnwalkable || activeTool === 'unwalkable';
  const showForcedDirection = tools.showForcedDirection || isForcedDirectionTool(activeTool);
  const showPlaces = tools.showPlaces || isPlaceTool(activeTool);

  const npcName = useCallback(
    (npcId: string) => npcs.find((n) => n.id === npcId)?.name ?? npcId,
    [npcs],
  );

  /** The body a cast NPC stands in, or undefined before the picker list has loaded. */
  const avatarFor = useCallback(
    (npcId: string, facing: IWFacing): string | undefined => {
      const avatar = npcs.find((n) => n.id === npcId)?.avatar;
      return avatar ? avatarSprite(avatar, facing) : undefined;
    },
    [npcs],
  );

  /** The companion's body. He is never in `npcCast`, so he is looked up by flag, not by id. */
  const companionAvatar = useMemo(
    () => npcs.find((n) => n.isCompanion)?.avatar,
    [npcs],
  );

  /**
   * The pins. Rebuilt from the draft on every change rather than kept in state: it is a
   * handful of objects, and a second copy of "where everyone stands" is exactly the kind
   * of duplicated truth that drifts.
   */
  const markers = useMemo<EditorMarker[]>(() => [
    {
      col: scene.playerStartCol, row: scene.playerStartRow,
      label: 'Player', color: PLAYER_MARKER_COLOR,
      // The learner's body is not a scene choice — it follows the account (`iwPlayerAvatar`),
      // so the author sees the body THEY will play the scene in.
      sprite: avatarSprite(playerAvatar, scene.playerStartFacing),
    },
    {
      col: scene.companionStartCol, row: scene.companionStartRow,
      label: 'Companion', color: COMPANION_MARKER_COLOR,
      // The companion IS an NPC, so his body comes from his registry entry like anyone's.
      sprite: companionAvatar && avatarSprite(companionAvatar, scene.companionStartFacing),
    },
    ...scene.npcCast.map((member) => ({
      col: member.col, row: member.row,
      label: npcName(member.npcId), color: CAST_MARKER_COLOR,
      sprite: avatarFor(member.npcId, member.facing),
    })),
    // Named places. `parsePlaceCell` returns null for an unplaced tag's empty cell,
    // which is how a named-but-unplaced place draws nothing rather than drawing at (0,0).
    // Two tags on one cell stack two pins there — that is legal, and seeing both is right.
    //
    // THE ONE PIN KIND WITH A VIEW TOGGLE (2026-09-20). A busy board can carry a place on
    // every other cell, and their labels sit exactly where the furniture the author is
    // judging is. The BODIES have no toggle: there are at most ten of them, and where
    // somebody stands is the scene rather than an annotation of it. Forced back on while a
    // place tool is armed, so aiming a place can never be done blind.
    ...(showPlaces
      ? Object.entries(places).flatMap(([tag, cell]): EditorMarker[] => {
        const at = parsePlaceCell(cell);
        return at ? [{ col: at.col, row: at.row, label: tag, color: PLACE_MARKER_COLOR }] : [];
      })
      : []),
  ], [scene.playerStartCol, scene.playerStartRow, scene.playerStartFacing,
      scene.companionStartCol, scene.companionStartRow, scene.companionStartFacing,
      scene.npcCast, npcName, avatarFor, companionAvatar, places, showPlaces, playerAvatar]);

  /**
   * One click on the board. A PLACE tool moves a body; every other tool paints its layer.
   * The viewer reports cells and stays tool-agnostic, so this is where a cell becomes a
   * meaning — the same split the night market editor makes.
   */
  const handleCell = useCallback((col: number, row: number) => {
    if (isPlaceTool(activeTool)) onPlaceAt(activeTool, col, row);
    // `variantIdx` is the ACTIVE tool's own selector: the decor rotation index for a decor
    // tool, the catalogue index for furniture. Every other paint tool ignores it.
    else if (isFurnitureTool(activeTool)) onPaintCell(col, row, activeTool, eraseMode, tools.furnitureIdx);
    else if (isForcedDirectionTool(activeTool)) onPaintCell(col, row, activeTool, eraseMode, tools.forcedFacingIdx);
    else onPaintCell(col, row, activeTool, eraseMode, tools.decorVariantIdx);
  }, [activeTool, eraseMode, tools.decorVariantIdx, tools.furnitureIdx, tools.forcedFacingIdx,
      onPaintCell, onPlaceAt]);

  return (
    <Box
      className="iw-scene-map-panel"
      sx={{
        position: 'relative', width: '100%', height: '100%',
        // DARK VOID BEHIND A WOOD BOARD (`iwBoardVoid.ts`). The Pixi canvas is transparent (`backgroundAlpha={0}`), so
        // whatever this column paints IS the void around the board. A wood floor replaces the
        // dirt slab, which leaves the deck with no plateau body — on the app's light paper it
        // reads as planks lying on a page, while against the dark void it reads as a lit platform in the
        // dark. Dirt boards keep the page's own ground, so the toggle changes only what it must.
        backgroundColor: iwBoardVoidBg(floorKind),
      }}
    >
      <TemplateEditorViewer
        width={scene.width}
        height={scene.height}
        masks={masks}
        showGrid={tools.showGrid}
        // Both tints stay OFF forever: a scene paints neither mask, so there is nothing to
        // tint. The props are still passed explicitly rather than omitted, so the intent
        // reads as "off" rather than "forgotten".
        showStreet={false}
        showCommunal={false}
        // The two iw-only tints. Unlike the pair above these have real content, so they are
        // the author's toggles — forced back on while their own tool paints (see above).
        showUnwalkable={showUnwalkable}
        showForcedDirection={showForcedDirection}
        // A place tool must not preview a paint ghost, so the decor category is suppressed
        // for it (decorCategoryFor already returns null for every place tool).
        decorCategory={decorCategoryFor(activeTool)}
        decorVariantIdx={tools.decorVariantIdx}
        // The Furniture ghost + footprint preview: the sprite ← / → have paged to, or null
        // when another tool is active (the viewer then shows its normal single-cell hover).
        furnitureSpriteId={isFurnitureTool(activeTool) ? tools.furnitureSpriteId : null}
        // The forced-direction ghost arrow: the facing Space has turned to, or null when
        // another tool is active (the viewer then shows its normal single-cell hover).
        forcedFacingGhost={isForcedDirectionTool(activeTool) ? tools.forcedFacing : null}
        activeTool={isFurnitureTool(activeTool) ? 'furniture' : undefined}
        eraseMode={eraseMode && !isPlaceTool(activeTool)}
        onPaintCell={handleCell}
        markers={markers}
      />

      <Typography
        className="iw-scene-map-panel__hint"
        // A caption must never eat the click that would place a body on the cells behind it.
        sx={{ position: 'absolute', bottom: 8, left: 16, color: 'rgba(255,255,255,0.6)', fontSize: 12, pointerEvents: 'none' }}
      >
        {isPlaceTool(activeTool)
          ? 'Click a cell to stand this body there.'
          : isFurnitureTool(activeTool)
          ? '← / → page the furniture (hold to page fast). Space turns the piece around. Click to place it; the eraser removes a whole piece.'
          : isForcedDirectionTool(activeTool)
          ? `Drag to paint. Space turns the arrow — now ${tools.forcedFacing.toUpperCase()}. A body that SETTLES here is turned this way and held; walking through is allowed but avoided.`
          : activeTool === 'unwalkable'
          ? 'Drag to paint the cells nobody may stand on or cross. Props, trees and furniture stamp this for you when placed.'
          : decorCategoryFor(activeTool)
          ? 'Drag to paint. Space cycles which prop the cursor’s ghost will place. The eraser removes the active tool’s own layer.'
          : 'Drag to paint. The eraser removes the active tool’s own layer.'}
      </Typography>
    </Box>
  );
}
