import { useCallback, useMemo } from 'react';
import { Box, Button, Tooltip, Typography } from '@mui/material';
import GridOnIcon from '@mui/icons-material/GridOn';
import GrassIcon from '@mui/icons-material/Grass';
import ParkIcon from '@mui/icons-material/Park';
import LocalFloristIcon from '@mui/icons-material/LocalFlorist';
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot';
import ForestIcon from '@mui/icons-material/Forest';
import GrainIcon from '@mui/icons-material/Grain';
import DeckIcon from '@mui/icons-material/Deck';
import ChairIcon from '@mui/icons-material/Chair';
import BlockIcon from '@mui/icons-material/Block';
import NavigationIcon from '@mui/icons-material/Navigation';
import BackspaceIcon from '@mui/icons-material/Backspace';
import PersonPinCircleIcon from '@mui/icons-material/PersonPinCircle';
import EmojiPeopleIcon from '@mui/icons-material/EmojiPeople';
import StorefrontIcon from '@mui/icons-material/Storefront';
import PlaceIcon from '@mui/icons-material/Place';
import { PaletteButton, paletteBtnSx, toolGroupSx } from '../nightmarket/editorButtonStyles';
import { DIRT_FLOOR, type BoardFloor, type EditorMasks } from '../../engine/market/farmTerrain';
import { type IWNpcOption, type IWScene } from '../../../server/contracts/iw';
import { WEIGHT } from '../../theme/scale';
import { isForcedDirectionTool, isPlaceTool, type IWEditorTool, type IWPaintTool } from './useIWSceneDraft';
import { CAST_HOTKEYS, type IWEditorTools } from './useIWEditorTools';

/**
 * IWSceneToolsPanel — the scene editor's PALETTE: every control that arms the next click on
 * the board, plus the two board-wide view/floor choices (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * LAYER: feature view. Stateless. The active tool and the erase modifier belong to the page,
 * the tool MODIFIERS (decor variant, furniture page, forced facing, gridlines) to
 * `useIWEditorTools`, and the board itself to `useIWSceneDraft`. This panel only draws them.
 *
 * IT USED TO FLOAT OVER THE BOARD (2026-09-19). The palette was a DOM overlay absolutely
 * positioned on top of the Pixi canvas, which cost real board area and — because Pixi binds
 * `pointerdown` to the canvas element — made the covered cells unreachable for a click that
 * STARTED there. Both problems are gone by construction now that the palette is an ordinary
 * column beside the canvas rather than on top of it, so nothing here needs `pointerEvents`
 * juggling and the board is clickable edge to edge.
 *
 * THE PALETTE IS THE TEMPLATE EDITOR'S, DELIBERATELY. Same 40×40 `PaletteButton`, same
 * accent-tinted `toolGroupSx` groups, same corner hotkey badges, and the SAME KEY for the
 * same tool wherever both editors have it (T/Y terrain · S/D/F decor · B eraser · ` grid ·
 * SPACE to cycle the active tool's variant). An author who has learned one board has learned
 * this one. See docs/NIGHT_MARKET_TEMPLATE_EDITOR.md for the rationale behind that layout.
 *
 * WHY IT IS DARK ON A LIGHT PAGE. Every control here is the night market's palette chrome,
 * which is drawn to sit on a dark Pixi canvas — white-ish idle borders over a near-black
 * button face. Rather than fork a second light-ground skin (two palettes to keep in step for
 * one panel's sake), the panel brings the dark ground WITH it. It also says something true:
 * this column is the board's chrome, and the fields in the column's other tab are not.
 */

export interface IWSceneToolsPanelProps {
  scene: IWScene;
  masks: EditorMasks;
  /** Named places: tag → "col,row". The tags are what the placement list is built from. */
  places: Record<string, string>;
  npcs: IWNpcOption[];
  activeTool: IWEditorTool;
  onToolChange: (tool: IWEditorTool) => void;
  eraseMode: boolean;
  onEraseModeChange: (erase: boolean) => void;
  /**
   * Set the board-wide floor. Re-picking the ACTIVE wood floor re-rolls its plank grain —
   * the draft hook owns that rule; the panel just reports the press.
   */
  onFloorChange: (kind: BoardFloor['kind']) => void;
  /** The live tool modifiers, shared with the map so the ghost and the stamp agree. */
  tools: IWEditorTools;
}

/**
 * The dark ground this column brings with it — see the header note. Exported because the
 * COLUMN (`IWEditorColumn`) paints the scroll body behind this panel, and a lighter strip
 * under a short palette would read as a seam.
 */
export const IW_TOOLS_PANEL_BG = '#1C1B20';

/** One palette entry. Mirrors the night market editor's `ToolDef` field for field. */
interface PaintToolDef { tool: IWPaintTool; label: string; icon: React.ReactNode; hotkey: string }
/** A colour-coded palette group; `accent` is an "r,g,b" triplet, as in the nme. */
interface PaintToolGroup { key: string; accent: string; tools: PaintToolDef[] }

/**
 * The paint palette. Groups and accents are the night market's, minus the tools a scene has
 * no concept for (placeholder areas and the condition mask are night-market-only, and `decor`
 * loses the plank) and plus the scene's own two walkability masks, which INVERT the nme's:
 * there, Q/W paint the two walkable classes onto a board that is otherwise solid; here, Q
 * paints the cells that are NOT walkable and W paints the cells that own your facing.
 *
 * The board FLOOR is not here: it is not a paint tool (see {@link FLOOR_CHOICES}).
 *
 * Rows are looked up BY KEY below ({@link toolGroup}) rather than by index — inserting a
 * group would otherwise silently renumber every row of the JSX.
 */
const TOOL_GROUPS: PaintToolGroup[] = [
  {
    key: 'terrain', accent: '132,204,120',
    tools: [
      { tool: 'terrain1', label: 'Terrain 1 (light grass)', icon: <GrassIcon fontSize="small" />, hotkey: 'T' },
      { tool: 'terrain2', label: 'Terrain 2 (renders over terrain 1)', icon: <ParkIcon fontSize="small" />, hotkey: 'Y' },
    ],
  },
  // WALKABILITY — the masks that decide where a body may go. Their accents are the BOARD
  // TINT colours (`UNWALKABLE_OVERLAY_COLOR` / `FORCED_OVERLAY_COLOR` in
  // TemplateEditorViewer), so the button and the cells it paints are recognisably the same
  // thing. Both tints DO have a view toggle as of 2026-09-20 (see VIEW_TOGGLES) — the
  // paint-blind risk they used to be protected from by always drawing is now handled by
  // forcing a layer back on whenever its own tool here is the active one.
  {
    key: 'walkability', accent: '255,59,48',
    tools: [
      { tool: 'unwalkable', label: 'Unwalkable — nobody may stand on or cross these cells', icon: <BlockIcon fontSize="small" />, hotkey: 'Q' },
    ],
  },
  {
    key: 'facing', accent: '46,230,168',
    tools: [
      { tool: 'forcedDirection', label: 'Forced direction (Space turns the arrow)', icon: <NavigationIcon fontSize="small" />, hotkey: 'W' },
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
  // FURNITURE: the whole lumeish pack behind ONE button, paged with ← / →. Its own group
  // because it is the one paint tool that places a MULTI-CELL object with real occupancy
  // rather than filling a cell. Same tool, same catalogue and same keys as the night market
  // editor's (docs/LUMEISH_ASSET_PIPELINE.md § 6b). `C` because the home row is full
  // (S/D/F decor, A/G floor) and the nme's own furniture key `A` is the dirt floor here.
  {
    key: 'furniture', accent: '198,156,109', // warm wood
    tools: [
      { tool: 'furniture', label: 'Furniture (← / → page the pack)', icon: <ChairIcon fontSize="small" />, hotkey: 'C' },
    ],
  },
];

/**
 * The ANNOTATION VIEW toggles (2026-09-20): show/hide what the board draws ON TOP of the
 * terrain, as opposed to what a click paints.
 *
 * ⚠️ EACH ONE SHARES ITS PAINT TOOL'S ICON on purpose. A view button and its layer are the
 * same subject seen twice, and inventing a second glyph for "the unwalkable layer" would
 * make the author learn two symbols for one idea. What separates them is position (the View
 * section, not Paint) and the fact that a view button never becomes the active tool.
 *
 * WHY THESE THREE AND NOT THE BODIES. Unwalkable and forced-direction cells can blanket a
 * board, and places can be dense enough to hide the furniture underneath their labels. The
 * player/companion/cast pins are at most ten, and they are the SCENE rather than an
 * annotation of it — nothing would be gained by letting them disappear.
 *
 * `read`/`set` take the whole tools object rather than a pre-bound pair, so this stays a
 * plain data table like {@link TOOL_GROUPS} instead of a list of closures rebuilt per render.
 */
interface ViewToggleDef {
  key: string;
  label: string;
  icon: React.ReactNode;
  hotkey: string;
  /** The author's STORED preference — what the button lights from, never the forced-on value. */
  read: (tools: IWEditorTools) => boolean;
  set: (tools: IWEditorTools, next: boolean) => void;
  /** True while the tool that paints this layer is armed, i.e. while the view is forced on. */
  forcedBy: (activeTool: IWEditorTool) => boolean;
}

const VIEW_TOGGLES: ViewToggleDef[] = [
  {
    key: 'unwalkable',
    label: 'unwalkable cells',
    icon: <BlockIcon fontSize="small" />,
    hotkey: 'E',
    read: (t) => t.showUnwalkable,
    set: (t, next) => t.setShowUnwalkable(next),
    forcedBy: (tool) => tool === 'unwalkable',
  },
  {
    key: 'forced',
    label: 'forced-direction arrows',
    icon: <NavigationIcon fontSize="small" />,
    hotkey: 'R',
    read: (t) => t.showForcedDirection,
    set: (t, next) => t.setShowForcedDirection(next),
    forcedBy: isForcedDirectionTool,
  },
  {
    key: 'places',
    label: 'place pins',
    icon: <PlaceIcon fontSize="small" />,
    hotkey: 'P',
    read: (t) => t.showPlaces,
    set: (t, next) => t.setShowPlaces(next),
    forcedBy: isPlaceTool,
  },
];

/** One palette group by key. Throws nothing: an unknown key renders nothing, visibly. */
const toolGroup = (key: string): PaintToolGroup | undefined => TOOL_GROUPS.find((g) => g.key === key);

/** The bodies group's accent (blue) and the eraser's (red, as in the nme). */
const BODIES_ACCENT = '102,204,255';
const ERASE_ACCENT = '255,120,120';
/** The floor group's accent — a wood brown, distinct from the decor group's amber. */
const FLOOR_ACCENT = '193,140,90';
/** The places group's accent. Green, as the place PINS on the board are. */
const PLACE_ACCENT = '150,255,150';

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
 * (S/D/F) is already a surface. G is also the night market's own wood-panel key.
 */
const FLOOR_CHOICES: { kind: BoardFloor['kind']; label: string; icon: React.ReactNode; hotkey: string }[] = [
  { kind: 'dirt', label: 'Dirt floor — the bare plateau (A)', icon: <GrainIcon fontSize="small" />, hotkey: 'A' },
  { kind: 'wood', label: 'Wood floor — plank deck on every bare cell; press again to reshuffle the grain (G)', icon: <DeckIcon fontSize="small" />, hotkey: 'G' },
];

/** Section heading inside the dark column — the light-ground `overline` would vanish here. */
const ToolsSectionLabel = ({ children }: { children: string }) => (
  <Typography
    className="iw-scene-tools-panel__section-label"
    sx={{
      fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
      fontWeight: WEIGHT.medium, color: 'rgba(255,255,255,0.55)', userSelect: 'none',
    }}
  >
    {children}
  </Typography>
);

/**
 * One place button. The ONLY palette control in either editor that is not a 40×40 icon,
 * because it is the only one whose meaning is a NAME the author invented — a pin icon
 * cannot say "stall" from "kitchen door", and a scene is expected to carry many places, so
 * hover-to-read a tooltip would mean hunting. It borrows `paletteBtnSx`'s colours (same
 * idle/active/hover treatment, same accent) and overrides only the hard-pinned box, so it
 * still reads as a member of the palette rather than a stray chip.
 */
const PlaceChip = ({ tag, active, onClick }: { tag: string; active: boolean; onClick: () => void }) => (
  <Tooltip title={`Put “${tag}” on a cell — clicking again moves it`} placement="top">
    <Button
      className={`iw-scene-tool iw-scene-tool-loc iw-scene-tool-loc-${tag.replace(/\s+/g, '-')}`}
      variant="outlined"
      size="small"
      onClick={onClick}
      startIcon={<PlaceIcon fontSize="small" />}
      sx={{
        ...paletteBtnSx(active, PLACE_ACCENT),
        // Undo the fixed 40×40 box: a name sets the width, and the list wraps.
        width: 'auto', minWidth: 0, maxWidth: '100%',
        height: 32, minHeight: 32, maxHeight: 32,
        px: 1, textTransform: 'none', whiteSpace: 'nowrap',
        fontSize: 12, fontWeight: WEIGHT.medium,
        '& .MuiButton-startIcon': { mr: 0.5, ml: 0 },
      }}
    >
      {tag}
    </Button>
  </Tooltip>
);

export default function IWSceneToolsPanel({
  scene, masks, places, npcs, activeTool, onToolChange,
  eraseMode, onEraseModeChange, onFloorChange, tools,
}: IWSceneToolsPanelProps) {
  /** The board's floor, read straight off the masks (absent ⇒ dirt) — no second copy to drift. */
  const floorKind = (masks.floor ?? DIRT_FLOOR).kind;

  const npcName = useCallback(
    (npcId: string) => npcs.find((n) => n.id === npcId)?.name ?? npcId,
    [npcs],
  );

  /** Every tag in the scene, placed or not — one button each, alphabetical. */
  const placeTags = useMemo(() => Object.keys(places).sort(), [places]);

  /** Render one colour-coded paint group as a row of buttons, exactly as the nme does. */
  const renderToolGroup = ({ key, accent, tools: groupTools }: PaintToolGroup) => (
    <Box
      key={key}
      className={`iw-scene-tool-group iw-scene-tool-group-${key}`}
      sx={toolGroupSx(accent)}
    >
      {groupTools.map(({ tool, label, icon, hotkey }) => (
        <PaletteButton
          key={tool}
          className={`iw-scene-tool iw-scene-tool-${tool}`}
          // The furniture button reports which piece is selected — the pack ships no names,
          // so the id plus the cursor ghost IS the identification.
          title={`${label} (${hotkey})${tool === 'furniture' ? ` · ${tools.furnitureLabel}` : ''}${
            // The LETTER, not `IW_FACING_LABELS`: those labels are known to be rotated one
            // quadrant from what the engine actually renders (see `sceneActor.facingForStep`),
            // and the ghost arrow on the board is derived from the engine — so quoting the
            // prose here would have the tooltip contradict the arrow under the cursor.
            tool === 'forcedDirection' ? ` · now facing ${tools.forcedFacing.toUpperCase()}` : ''
          }`}
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
      className="iw-scene-tools-panel"
      sx={{
        minHeight: '100%', backgroundColor: IW_TOOLS_PANEL_BG,
        p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5,
      }}
    >
      {/* ── VIEW + ERASER ── the two modifiers that are about HOW you work rather than what
          you place. Paired on one row because both are toggles, not selections. */}
      <Box className="iw-scene-tools-panel__section iw-scene-tools-panel__section-view">
        <ToolsSectionLabel>View</ToolsSectionLabel>
        <Box className="iw-scene-tool-row" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.75 }}>
          <Box className="iw-scene-tool-group iw-scene-tool-group-grid" sx={toolGroupSx()}>
            <PaletteButton
              className="iw-scene-grid-toggle"
              title="Toggle gridlines (`)"
              hotkey="`"
              active={tools.showGrid}
              onClick={() => tools.setShowGrid(!tools.showGrid)}
            >
              <GridOnIcon fontSize="small" />
            </PaletteButton>
          </Box>
          {/* The three annotation views. One group with the neutral accent, like the
              template editor's four mask views: the hue belongs to the LAYER (which the
              paint buttons already carry), and four coloured groups in one row would read
              as four unrelated things. */}
          <Box className="iw-scene-tool-group iw-scene-tool-group-mask-view" sx={toolGroupSx()}>
            {VIEW_TOGGLES.map((v) => {
              const forced = v.forcedBy(activeTool);
              return (
                <PaletteButton
                  key={v.key}
                  className={`iw-scene-view-toggle iw-scene-view-toggle-${v.key}`}
                  title={forced
                    ? `Show ${v.label} (${v.hotkey}) — shown anyway while its own tool is active`
                    : `Show ${v.label} (${v.hotkey})`}
                  hotkey={v.hotkey}
                  // Lit from the STORED preference, not the effective one: a forced reveal is
                  // the map's business and must not look like the author turned it back on.
                  active={v.read(tools)}
                  onClick={() => v.set(tools, !v.read(tools))}
                >
                  {v.icon}
                </PaletteButton>
              );
            })}
          </Box>
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

      {/* ── PAINT ── the per-cell layers, in keyboard-row order: terrain and the two
          walkability masks (top letter row), then decor and furniture (home row). */}
      <Box className="iw-scene-tools-panel__section iw-scene-tools-panel__section-paint">
        <ToolsSectionLabel>Paint</ToolsSectionLabel>
        <Box className="iw-scene-tool-row" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.75 }}>
          {renderToolGroup(toolGroup('terrain')!)}
          {renderToolGroup(toolGroup('walkability')!)}
          {renderToolGroup(toolGroup('facing')!)}
        </Box>
        <Box className="iw-scene-tool-row" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
          {renderToolGroup(toolGroup('decor')!)}
          {renderToolGroup(toolGroup('furniture')!)}
        </Box>
      </Box>

      {/* ── FLOOR ── a radio, not a tool: it restyles the whole board rather than arming the
          next click, so grouping it with the paints would misread. */}
      <Box className="iw-scene-tools-panel__section iw-scene-tools-panel__section-floor">
        <ToolsSectionLabel>Floor</ToolsSectionLabel>
        <Box className="iw-scene-tool-row" sx={{ display: 'flex', gap: 1, mt: 0.75 }}>
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
      </Box>

      {/* ── PLACEMENT ── LAST, and deliberately the only section that grows.
          Everything above it is a fixed, known set of tools; the bodies list grows with the
          cast (up to `IW_MAX_CAST`) and the places list grows without bound as an author
          names them, so the two sit at the BOTTOM where growth pushes nothing out of place.
          Placing is also a different KIND of act from painting: a click sets where one
          person or one named cell IS, rather than adding to a layer. */}
      <Box
        className="iw-scene-tools-panel__section iw-scene-tools-panel__section-placement"
        sx={{ mt: 'auto', pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.12)' }}
      >
        <ToolsSectionLabel>Placement</ToolsSectionLabel>

        <Box className="iw-scene-tool-row iw-scene-tool-row-bodies" sx={{ display: 'flex', gap: 1, mt: 0.75 }}>
          <Box
            className="iw-scene-tool-group iw-scene-tool-group-bodies"
            sx={{ ...toolGroupSx(BODIES_ACCENT), flexWrap: 'wrap' }}
          >
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
        </Box>

        {/* Tags are created in the content column; this list only places the ones that
            exist, so it is absent until the first one is named. */}
        {placeTags.length > 0 && (
          <Box className="iw-scene-tool-row iw-scene-tool-row-places" sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <Box
              className="iw-scene-tool-group iw-scene-tool-group-places"
              sx={{ ...toolGroupSx(PLACE_ACCENT), flexWrap: 'wrap', minWidth: 0 }}
            >
              {placeTags.map((tag) => (
                <PlaceChip
                  key={tag}
                  tag={tag}
                  active={activeTool === `tag:${tag}`}
                  onClick={() => onToolChange(`tag:${tag}`)}
                />
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
