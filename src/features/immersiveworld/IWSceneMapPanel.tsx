import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import GridOnIcon from '@mui/icons-material/GridOn';
import GrassIcon from '@mui/icons-material/Grass';
import ParkIcon from '@mui/icons-material/Park';
import LocalFloristIcon from '@mui/icons-material/LocalFlorist';
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot';
import ForestIcon from '@mui/icons-material/Forest';
import GrainIcon from '@mui/icons-material/Grain';
import DeckIcon from '@mui/icons-material/Deck';
import BackspaceIcon from '@mui/icons-material/Backspace';
import PersonPinCircleIcon from '@mui/icons-material/PersonPinCircle';
import EmojiPeopleIcon from '@mui/icons-material/EmojiPeople';
import StorefrontIcon from '@mui/icons-material/Storefront';
import PlaceIcon from '@mui/icons-material/Place';
import TemplateEditorViewer, { type EditorMarker } from '../nightmarket/TemplateEditorViewer';
import { PaletteButton, toolGroupSx } from '../nightmarket/editorButtonStyles';
import { DIRT_FLOOR, type BoardFloor, type EditorMasks } from '../../engine/market/farmTerrain';
import { freeFarmTileset } from '../../engine/market/freeFarmTileset';
import {
  IW_PLAYER_AVATAR,
  type IWAvatar, type IWFacing, type IWNpcOption, type IWScene,
} from '../../../server/contracts/iw';
import { decorCategoryFor, isPlaceTool, type IWEditorTool, type IWPaintTool, type IWPlaceTool } from './useIWSceneDraft';

/**
 * IWSceneMapPanel — the SPATIAL half of the iw scene editor: the board, the paint palette,
 * and the pins showing who stands where (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * LAYER: feature view. It owns no DRAFT state — the draft hook does — only the three view
 * toggles, which are about looking rather than authoring. It renders the shared
 * `TemplateEditorViewer` from the night market, which is § 12 phase 1d's "reuses the nme
 * for the map" made literal: iw did not fork a map editor, it passes a different mask set
 * and a `markers` list into the one that exists.
 *
 * THE PALETTE IS THE TEMPLATE EDITOR'S, DELIBERATELY. Same 40×40 `PaletteButton`, same
 * accent-tinted `toolGroupSx` groups, same corner hotkey badges, same one-palette-row-per-
 * KEYBOARD-row layout, and the SAME KEY for the same tool wherever both editors have it
 * (T/Y terrain · S/D/F decor · B eraser · ` grid). An author who has learned one board
 * learns nothing new here. See docs/NIGHT_MARKET_TEMPLATE_EDITOR.md for the rationale
 * behind that layout.
 *
 * WHAT IS DELIBERATELY MISSING vs the night market palette: **the two WALKABILITY tools and
 * their view tints** (Q/W and 1/2), because a scene paints no walkability — every cell is
 * walkable unless a blocking prop or tree stands on it (see `IWSceneLayout`'s header). That
 * frees the whole number row, so the cast now runs 1–8 rather than 3–0. Also absent:
 * placeholder areas (a scene has no occupant slots to unlock) and the condition mask (no
 * versions to differ) — so E/R stay unbound; the plank DECOR tool; and copy/paste/undo
 * (Z/X/C/V), whose keys iw reuses for its own bodies group. Each is night-market machinery,
 * not a scene concept. If scene authoring turns out to want undo, it should be lifted into a
 * shared hook rather than re-typed here.
 *
 * WHAT IS HERE AND NOT THERE: the FLOOR row (see {@link FLOOR_CHOICES}) — a board-wide
 * dirt/wood choice the night market does not offer. It takes G, the nme's own wood key.
 */

export interface IWSceneMapPanelProps {
  scene: IWScene;
  masks: EditorMasks;
  /** Named places: "col,row" → tag (§ 14 Q42). Unplaced tags are skipped by the pins. */
  locations: Record<string, string>;
  npcs: IWNpcOption[];
  activeTool: IWEditorTool;
  onToolChange: (tool: IWEditorTool) => void;
  eraseMode: boolean;
  onEraseModeChange: (erase: boolean) => void;
  onPaintCell: (col: number, row: number, tool: IWPaintTool, erase: boolean) => void;
  /** Only ever called with a PLACE tool — the panel resolves which kind a click is. */
  onPlaceAt: (tool: IWPlaceTool, col: number, row: number) => void;
  /**
   * Set the board-wide floor. Re-picking the ACTIVE wood floor re-rolls its plank grain —
   * the draft hook owns that rule; the panel just reports the press.
   */
  onFloorChange: (kind: BoardFloor['kind']) => void;
}

/** One palette entry. Mirrors the night market editor's `ToolDef` field for field. */
interface PaintToolDef { tool: IWPaintTool; label: string; icon: React.ReactNode; hotkey: string; }
/** A colour-coded palette group; `accent` is an "r,g,b" triplet, as in the nme. */
interface PaintToolGroup { key: string; accent: string; tools: PaintToolDef[]; }

/**
 * The paint palette. Groups and accents are the night market's, minus the tools a scene has
 * no concept for — the whole `masks` group is gone (walkability is not authored; placeholder
 * and condition are night-market-only) and `decor` loses the plank. The board FLOOR is not
 * here: it is not a paint tool (see {@link FLOOR_CHOICES}).
 */
const TOOL_GROUPS: PaintToolGroup[] = [
  {
    key: 'terrain', accent: '132,204,120',
    tools: [
      { tool: 'terrain1', label: 'Terrain 1 (light grass)', icon: <GrassIcon fontSize="small" />, hotkey: 'T' },
      { tool: 'terrain2', label: 'Terrain 2 (renders over terrain 1)', icon: <ParkIcon fontSize="small" />, hotkey: 'Y' },
    ],
  },
  {
    key: 'decor', accent: '255,183,77',
    tools: [
      { tool: 'familyDecor', label: 'Surface decor (Space cycles variant)', icon: <LocalFloristIcon fontSize="small" />, hotkey: 'S' },
      { tool: 'commonDecor', label: 'Props (Space cycles variant)', icon: <ScatterPlotIcon fontSize="small" />, hotkey: 'D' },
      { tool: 'treeDecor', label: 'Trees (Space cycles variant)', icon: <ForestIcon fontSize="small" />, hotkey: 'F' },
    ],
  },
];

/** The bodies group's accent (blue) and the eraser's (red, as in the nme). */
const BODIES_ACCENT = '102,204,255';
const ERASE_ACCENT = '255,120,120';

/** The floor group's accent — a wood brown, distinct from the decor group's amber. */
const FLOOR_ACCENT = '193,140,90';

/**
 * The FLOOR row: what the board shows where no terrain mask covers it.
 *
 * NOT paint tools — that is why they live outside `TOOL_GROUPS` and never become the
 * `activeTool`. Pressing one changes the whole board at once and leaves the click behavior
 * alone, so the pair reads as a RADIO (the active floor stays lit) rather than as a tool
 * selection. Wood is a plank deck whose grain is randomized per cell from a stored seed;
 * pressing Wood again re-rolls it (see `useIWSceneDraft.setFloor`).
 *
 * Hotkeys A / G sit on the home row beside the decor tools rather than claiming a palette
 * row of keys of their own: the floor is a surface concept, and every other home-row key
 * (S/D/F) is already a surface. G is also the night market's own wood-panel key, so the
 * one wood thing in each editor answers to the same letter.
 */
const FLOOR_CHOICES: { kind: BoardFloor['kind']; label: string; icon: React.ReactNode; hotkey: string }[] = [
  { kind: 'dirt', label: 'Dirt floor — the bare plateau (A)', icon: <GrainIcon fontSize="small" />, hotkey: 'A' },
  { kind: 'wood', label: 'Wood floor — plank deck on every bare cell; press again to reshuffle the grain (G)', icon: <DeckIcon fontSize="small" />, hotkey: 'G' },
];

/**
 * Hotkeys for the CAST, in cast order. The night market's bottom row is Z/X/C/V (undo,
 * redo, copy, paste); iw has none of those, so the two fixed bodies take Z and X and the
 * cast runs along the digits — the WHOLE number row, since dropping the walkability tints
 * freed 1 and 2 (only ` is still spoken for, and it is not a digit).
 *
 * ⚠️ Eight keys for a cap of eight (`IW_MAX_CAST`), so every cast member is reachable — but
 * the pairing is POSITIONAL, not by npc id: removing the first cast member re-letters the
 * rest. That is the same bargain the nme makes with its palette order, and it is why the
 * badge is drawn from this array rather than stored on the member.
 */
const CAST_HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

/**
 * Keyboard → paint tool. The authoritative dispatch; the per-tool `hotkey` badges above are
 * its display mirror and must match. Keys are compared lower-case and the layout mirrors the
 * physical keyboard, one palette row per keyboard row: T/Y terrain (top letter row), S/D/F
 * decor (home row), Z/X + digits bodies (bottom row / number row). NON-tool keys are handled
 * separately in the keydown effect: ` grid, A/G floor, B eraser modifier, Space
 * decor-variant cycle.
 */
const HOTKEY_TO_PAINT_TOOL: Record<string, IWPaintTool> = {
  t: 'terrain1', y: 'terrain2',
  s: 'familyDecor', d: 'commonDecor', f: 'treeDecor',
};

/** "col,row" → a cell, or null for anything else (notably an unplaced tag's sentinel key). */
function parseLocationCell(cell: string): { col: number; row: number } | null {
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
const LOCATION_MARKER_COLOR = 0x9cff9c;

/** The bodies-group accent, reused by the places group so the two read as one family. */
const LOCATION_ACCENT = '150,255,150';

export default function IWSceneMapPanel({
  scene, masks, locations, npcs, activeTool, onToolChange, eraseMode, onEraseModeChange,
  onPaintCell, onPlaceAt, onFloorChange,
}: IWSceneMapPanelProps) {

  /** The board's floor, read straight off the masks (absent ⇒ dirt) — no second copy to drift. */
  const floorKind = (masks.floor ?? DIRT_FLOOR).kind;

  // View toggles. Local because they are about LOOKING, not authoring: nothing here reaches
  // the draft, and a reload is entitled to forget them.
  const [showGrid, setShowGrid] = useState(true);

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

  /** Every distinct tag in the scene, placed or not — one palette button each. */
  const placeTags = useMemo(
    () => [...new Set(Object.values(locations))].sort(),
    [locations],
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
      // The learner's body is a constant, not a scene choice (`IW_PLAYER_AVATAR`).
      sprite: avatarSprite(IW_PLAYER_AVATAR, scene.playerStartFacing),
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
    // Named places. `parseLocationCell` returns null for an unplaced tag's sentinel key,
    // which is how a named-but-unplaced place draws nothing rather than drawing at (0,0).
    ...Object.entries(locations).flatMap(([cell, tag]): EditorMarker[] => {
      const at = parseLocationCell(cell);
      return at ? [{ col: at.col, row: at.row, label: String(tag), color: LOCATION_MARKER_COLOR }] : [];
    }),
  ], [scene.playerStartCol, scene.playerStartRow, scene.playerStartFacing,
      scene.companionStartCol, scene.companionStartRow, scene.companionStartFacing,
      scene.npcCast, npcName, avatarFor, companionAvatar, locations]);

  /**
   * One click on the board. A PLACE tool moves a body; every other tool paints its layer.
   * The viewer reports cells and stays tool-agnostic, so this is where a cell becomes a
   * meaning — the same split the night market editor makes.
   */
  const handleCell = useCallback((col: number, row: number) => {
    if (isPlaceTool(activeTool)) onPlaceAt(activeTool, col, row);
    else onPaintCell(col, row, activeTool, eraseMode);
  }, [activeTool, eraseMode, onPaintCell, onPlaceAt]);

  // ── Keyboard hotkeys ──────────────────────────────────────────────────────────────
  // Same contract as the night market editor's: bare keypresses only (never hijack a
  // browser shortcut), and suppressed whenever focus is in a text field, so typing a
  // scene's objective can never paint its board. The cast keys are read off the CURRENT
  // cast, so a member added after mount is immediately reachable.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;

      const key = e.key.toLowerCase();

      // The one view toggle left, on the nme's own key. (1/2 used to hold the walkability
      // tints; they are cast keys now — see CAST_HOTKEYS.)
      if (key === '`') { setShowGrid((v) => !v); e.preventDefault(); return; }

      // B toggles the eraser MODIFIER, layered on top of the selected tool. A place tool
      // has no layer to erase, so B is a no-op there — mirroring the disabled button.
      if (key === 'b') { if (!isPlaceTool(activeTool)) onEraseModeChange(!eraseMode); e.preventDefault(); return; }

      // Space cycles the active decor tool's variant (the ghost previews it), and is
      // swallowed otherwise so it never scrolls the page or re-taps a focused button.
      if (key === ' ') { e.preventDefault(); return; }

      // The FLOOR row. Not tools, so they are handled here beside the view toggles rather
      // than through HOTKEY_TO_PAINT_TOOL — pressing one must not change what a click does.
      if (key === 'a') { onFloorChange('dirt'); e.preventDefault(); return; }
      if (key === 'g') { onFloorChange('wood'); e.preventDefault(); return; }

      // The two fixed bodies, then the cast along the digits.
      if (key === 'z') { onToolChange('player'); e.preventDefault(); return; }
      if (key === 'x') { onToolChange('companion'); e.preventDefault(); return; }
      const castIdx = CAST_HOTKEYS.indexOf(key as typeof CAST_HOTKEYS[number]);
      if (castIdx >= 0) {
        const member = scene.npcCast[castIdx];
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
  }, [activeTool, eraseMode, onEraseModeChange, onToolChange, onFloorChange, scene.npcCast]);

  /** Render one colour-coded paint group as a horizontal row, exactly as the nme does. */
  const renderToolGroup = ({ key, accent, tools }: PaintToolGroup) => (
    <Box
      key={key}
      className={`iw-scene-tool-group iw-scene-tool-group-${key}`}
      sx={toolGroupSx(accent)}
    >
      {tools.map(({ tool, label, icon, hotkey }) => (
        <PaletteButton
          key={tool}
          className={`iw-scene-tool iw-scene-tool-${tool}`}
          title={`${label} (${hotkey})`}
          hotkey={hotkey}
          active={activeTool === tool}
          accent={accent}
          onClick={() => onToolChange(tool)}
        >
          {icon}
        </PaletteButton>
      ))}
    </Box>
  );

  return (
    <Box
      className="iw-scene-map-panel"
      sx={{
        position: 'relative', width: '100%', height: '100%',
        // BLACK BEHIND A WOOD BOARD. The Pixi canvas is transparent (`backgroundAlpha={0}`), so
        // whatever this column paints IS the void around the board. A wood floor replaces the
        // dirt slab, which leaves the deck with no plateau body — on the app's light paper it
        // reads as planks lying on a page, while against black it reads as a lit platform in the
        // dark. Dirt boards keep the page's own ground, so the toggle changes only what it must.
        backgroundColor: floorKind === 'wood' ? '#000' : 'transparent',
      }}
    >
      <TemplateEditorViewer
        width={scene.width}
        height={scene.height}
        masks={masks}
        showGrid={showGrid}
        // Both tints stay OFF forever: a scene paints neither mask, so there is nothing to
        // tint. The props are still passed explicitly rather than omitted, so the intent
        // reads as "off" rather than "forgotten".
        showStreet={false}
        showCommunal={false}
        // A place tool must not preview a paint ghost, so the decor category is suppressed
        // for it (decorCategoryFor already returns null for every place tool).
        decorCategory={decorCategoryFor(activeTool)}
        eraseMode={eraseMode && !isPlaceTool(activeTool)}
        onPaintCell={handleCell}
        markers={markers}
      />

      {/* Left tool palette — same position, spacing and row order as the template editor. */}
      <Box
        className="iw-scene-map-panel__palette"
        sx={{ position: 'absolute', top: 16, left: 16, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}
      >
        {/* Row 1 — the only view toggle: gridlines. The walkability tints that used to sit
            beside it are gone with the masks they showed. */}
        <Box className="iw-scene-tool-row" sx={{ display: 'flex', gap: 1 }}>
          <Box className="iw-scene-tool-group iw-scene-tool-group-grid" sx={toolGroupSx()}>
            <PaletteButton
              className="iw-scene-grid-toggle"
              title="Toggle gridlines (`)"
              hotkey="`"
              active={showGrid}
              onClick={() => setShowGrid((v) => !v)}
            >
              <GridOnIcon fontSize="small" />
            </PaletteButton>
          </Box>
        </Box>

        {/* Row 2 (top letter row) — terrain (T/Y). */}
        <Box className="iw-scene-tool-row" sx={{ display: 'flex', gap: 1 }}>
          {renderToolGroup(TOOL_GROUPS[0])}
        </Box>

        {/* Row 3 (home row) — decor tools (S/D/F). */}
        {renderToolGroup(TOOL_GROUPS[1])}

        {/* Row 4 — the FLOOR radio (A/G). Its own row because it is not a tool: it restyles
            the whole board rather than arming the next click, so grouping it with the paints
            would misread. Wood pressed twice reshuffles the deck. */}
        <Box className="iw-scene-tool-row" sx={{ display: 'flex', gap: 1 }}>
          <Box className="iw-scene-tool-group iw-scene-tool-group-floor" sx={toolGroupSx(FLOOR_ACCENT)}>
            {FLOOR_CHOICES.map(({ kind, label, icon, hotkey }) => (
              <PaletteButton
                key={kind}
                className={`iw-scene-floor iw-scene-floor-${kind}`}
                title={label}
                hotkey={hotkey}
                active={floorKind === kind}
                accent={FLOOR_ACCENT}
                onClick={() => onFloorChange(kind)}
              >
                {icon}
              </PaletteButton>
            ))}
          </Box>
        </Box>

        {/* Row 5 (bottom row) — the BODIES group, then the eraser modifier at B, in the
            same position the night market editor's eraser occupies. Placing a body is a
            different KIND of act from painting: a click sets where one person stands
            rather than adding to a layer, which is why it gets its own group. */}
        <Box className="iw-scene-tool-row" sx={{ display: 'flex', gap: 1 }}>
          <Box className="iw-scene-tool-group iw-scene-tool-group-bodies" sx={toolGroupSx(BODIES_ACCENT)}>
            <PaletteButton
              className="iw-scene-tool iw-scene-tool-player"
              title="Place the player's start (Z)"
              hotkey="Z"
              active={activeTool === 'player'}
              accent={BODIES_ACCENT}
              onClick={() => onToolChange('player')}
            >
              <PersonPinCircleIcon fontSize="small" />
            </PaletteButton>
            <PaletteButton
              className="iw-scene-tool iw-scene-tool-companion"
              title="Place the companion's start (X) — the scene opens by walking the player to him"
              hotkey="X"
              active={activeTool === 'companion'}
              accent={BODIES_ACCENT}
              onClick={() => onToolChange('companion')}
            >
              <EmojiPeopleIcon fontSize="small" />
            </PaletteButton>
            {scene.npcCast.map((member, i) => (
              <PaletteButton
                key={member.npcId}
                className={`iw-scene-tool iw-scene-tool-npc-${member.npcId}`}
                title={`Place ${npcName(member.npcId)}${CAST_HOTKEYS[i] ? ` (${CAST_HOTKEYS[i]})` : ''}`}
                hotkey={CAST_HOTKEYS[i]}
                active={activeTool === `npc:${member.npcId}`}
                accent={BODIES_ACCENT}
                onClick={() => onToolChange(`npc:${member.npcId}`)}
              >
                <StorefrontIcon fontSize="small" />
              </PaletteButton>
            ))}
          </Box>
          {/* Places. Their own group because a place is not a body: clicking with one ADDS a
              cell to the tag rather than moving anything, so several cells can share a name
              and `walk_to_tag` heads for the nearest. Tags are created in the content panel
              — this palette only places the ones that exist. */}
          {placeTags.length > 0 && (
            <Box className="iw-scene-tool-group iw-scene-tool-group-places" sx={toolGroupSx(LOCATION_ACCENT)}>
              {placeTags.map((tag) => (
                <PaletteButton
                  key={tag}
                  className={`iw-scene-tool iw-scene-tool-loc-${tag.replace(/\s+/g, '-')}`}
                  title={`Tag a cell as “${tag}” — click as many cells as you like`}
                  active={activeTool === `loc:${tag}`}
                  accent={LOCATION_ACCENT}
                  onClick={() => onToolChange(`loc:${tag}`)}
                >
                  <PlaceIcon fontSize="small" />
                </PaletteButton>
              ))}
            </Box>
          )}
          <Box className="iw-scene-tool-group iw-scene-tool-group-erase" sx={toolGroupSx(ERASE_ACCENT)}>
            {/* Disabled for the place tools — a body has no layer to erase, so the modifier
                is meaningless there. PaletteButton's span wrapper keeps the tooltip alive. */}
            <PaletteButton
              className="iw-scene-erase-toggle"
              title={isPlaceTool(activeTool)
                ? 'The eraser does not apply to the placement tools'
                : `Eraser — removes only the selected tool's layer (B)${eraseMode ? ' · ON' : ''}`}
              hotkey="B"
              active={eraseMode}
              accent={ERASE_ACCENT}
              disabled={isPlaceTool(activeTool)}
              onClick={() => onEraseModeChange(!eraseMode)}
            >
              <BackspaceIcon fontSize="small" />
            </PaletteButton>
          </Box>
        </Box>
      </Box>

      <Typography
        className="iw-scene-map-panel__hint"
        sx={{ position: 'absolute', bottom: 8, left: 16, color: 'rgba(255,255,255,0.6)', fontSize: 12 }}
      >
        {isPlaceTool(activeTool)
          ? 'Click a cell to stand this body there.'
          : 'Drag to paint. The eraser removes the active tool’s own layer.'}
      </Typography>
    </Box>
  );
}
