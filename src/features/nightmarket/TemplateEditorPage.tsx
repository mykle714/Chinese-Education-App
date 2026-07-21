import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Tooltip, Snackbar, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  MenuItem, FormControl, InputLabel, Select,
} from '@mui/material';
import GrassIcon from '@mui/icons-material/Grass';
import ParkIcon from '@mui/icons-material/Park';
import RouteIcon from '@mui/icons-material/Route';
import GroupsIcon from '@mui/icons-material/Groups';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import RuleIcon from '@mui/icons-material/Rule';
import LocalFloristIcon from '@mui/icons-material/LocalFlorist';
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot';
import ForestIcon from '@mui/icons-material/Forest';
import ViewWeekIcon from '@mui/icons-material/ViewWeek';
import BackspaceIcon from '@mui/icons-material/Backspace';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import LayersClearIcon from '@mui/icons-material/LayersClear';
import GridOnIcon from '@mui/icons-material/GridOn';
import AddIcon from '@mui/icons-material/Add';
import TuneIcon from '@mui/icons-material/Tune';
import SaveIcon from '@mui/icons-material/Save';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import CloseIcon from '@mui/icons-material/Close';
import LeafPage from '../../components/LeafPage';
import { WEIGHT } from '../../theme/scale';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useAuth } from '../../AuthContext';
import { useConfirmation } from '../../contexts/ConfirmationContext';
import type { EditorMasks, DecorCategory } from '../../engine/market/farmTerrain';
import { editorSurfaceAt, editorDecorRotation, isBlockingDecorUrl, editorDecorCategory } from '../../engine/market/farmTerrain';
import {
  PLACEHOLDER_SIZES, placeholderCoveredCells, placeholderAreaAt, placeholderAreaFits,
  placeholderAreaOverlapsAny, placeholderAreasOverlap, placeholderAreaCells,
  type PlaceholderArea,
} from '../../engine/market/placeholderArea';
import { analyzeConditions, borderStreetCells } from '../../engine/market/conditionAnalysis';
import TemplateEditorViewer, { type EditorTool } from './TemplateEditorViewer';
import TemplateLoadGallery from './TemplateLoadGallery';
import {
  checkTemplateNameAvailable, suggestTemplateName, submitTemplate,
  listTemplateGallery, loadTemplate, definitionToMasks, deleteTemplate, deleteTemplateVersion,
  type TemplateGalleryEntry,
} from './templateEditorApi';
// Toolbar chrome shared with the Template Sandbox so both authoring tools look/feel identical.
import { HotkeyBadge, headerBtnSx, paletteBtnSx } from './editorButtonStyles';

/**
 * TemplateEditorPage — validator-only Night Market template authoring surface
 * (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md). Desktop-only.
 *
 * Owns the painted mask layers (terrain 1 / terrain 2, street, communal, placeholder,
 * condition, decor) + board size + name + the active VERSION. The header
 * carries the version switcher + Load / Clear / Delete Version / Delete Template /
 * Properties / Save; a left tool
 * palette selects the active painter (+ grid/street/communal/placeholder/condition view
 * toggles). The Properties popup sets W×H + name and hosts the "New version" button.
 *
 * VERSIONS: one name owns numbered versions sharing a board size + a single
 * placeholder layout (owned by version 0; its tool/eraser are locked on higher
 * versions) but differing in terrain / streets / decor / the condition mask. Switching
 * versions RELOADS the target from the last saved state (unsaved edits are discarded
 * after a warn); "New version" copies the current board into the next version number.
 * Save upserts the active (name, version). "Delete Version" removes only the current
 * version (disabled on version 0 — the base); "Delete Template" removes the whole name
 * (all versions).
 */

const MIN_DIM = 2;
const MAX_DIM = 60;
const DEFAULT_DIM = 16;

// Selectable board dimensions (Properties width/length dropdowns): every even size
// from 2 up to 24, then multiples of 8 up to 48. Both dropdowns share this list.
// MIN_DIM/MAX_DIM still bound the handleOk validation (all options fall safely inside
// them), so a future free entry stays in range.
const DIM_OPTIONS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 32, 40, 48];

const emptyMasks = (): EditorMasks => ({
  terrain1: new Set<string>(),
  terrain2: new Set<string>(),
  street: new Set<string>(),
  communal: new Set<string>(),
  placeholder: [],
  condition: new Set<string>(),
  decor: new Map<string, string>(),
});

/**
 * A copied board region held by the clipboard tools (see `copyRegion` / `pasteAt`). Every
 * layer is stored as OFFSETS relative to the selection's min corner ("dx,dy"), so the region
 * can be re-stamped anywhere. Copy captures each per-cell mask + decor for the W×H rectangle,
 * plus every placeholder area whose whole footprint fits (partly-overhanging areas are skipped).
 * Paste overwrites the target region to match this exactly (subject to the placeholder/condition
 * version gates).
 */
interface Clipboard {
  w: number;
  h: number;
  terrain1: Set<string>;
  terrain2: Set<string>;
  street: Set<string>;
  communal: Set<string>;
  /** Fully-contained placeholder areas, re-anchored relative to the selection's min corner. */
  placeholder: PlaceholderArea[];
  condition: Set<string>;
  decor: Map<string, string>;
}

/** The clipboard group's accent (pink) — panel tint + button highlight, like the other groups. */
const CLIPBOARD_ACCENT = '244,143,177';
/** The undo/redo group's accent (steel blue) — reads as a utility group, apart from the paints. */
const HISTORY_ACCENT = '120,164,214';

/** Cap on retained undo snapshots (board is ≤60×60, so a snapshot is cheap; this just bounds memory). */
const HISTORY_LIMIT = 60;

/** Deep-clone a masks object so a history snapshot is fully detached from live edits. */
const cloneMasks = (m: EditorMasks): EditorMasks => ({
  terrain1: new Set(m.terrain1),
  terrain2: new Set(m.terrain2),
  street: new Set(m.street),
  communal: new Set(m.communal),
  // Placeholder area records are treated as immutable, so a shallow array copy fully
  // detaches the snapshot (drop/erase replace the array, never mutate an element).
  placeholder: [...m.placeholder],
  condition: new Set(m.condition),
  decor: new Map(m.decor),
});

/**
 * Border-street auto-condition (versions > 0 only). At save time every STREET cell lying
 * on the board's outer edge (col 0 / col width−1 / row 0 / row height−1) is marked as a
 * condition-mask cell: those are exactly the cells where a NEIGHBOURING template's street
 * can lean on this one, so they "matter to version selection"
 * (docs/NIGHT_MARKET_TEMPLATES.md). This is the ONLY path that lands a condition on a
 * STREET cell — the manual condition tool paints placeholder cells only. Idempotent
 * (re-running adds the same border streets). Returns a fresh masks object with `condition`
 * augmented; all other layers are shared by reference (callers replace the state wholesale).
 *
 * The outer-edge street derivation is the SAME one the runtime uses at load
 * ({@link borderStreetCells} in conditionAnalysis) — reused here so the author-facing preview
 * and the runtime's canonical scoring can never disagree on what a border-street condition is.
 */
const withBorderStreetConditions = (masks: EditorMasks, width: number, height: number): EditorMasks => {
  const condition = new Set(masks.condition);
  for (const cell of borderStreetCells(masks.street, width, height)) condition.add(cell);
  return { ...masks, condition };
};

/** `hotkey` is the single keyboard character that activates this tool (shown as a corner
 *  badge on the button and appended to its tooltip). See HOTKEY_TO_TOOL + the keydown
 *  effect, which is the authoritative dispatch and must stay in sync with these. */
interface ToolDef { tool: EditorTool; label: string; icon: React.ReactNode; hotkey: string; }
/** A color-coded palette group. `accent` is an "r,g,b" triplet reused for the group's
 *  panel tint AND the active-tool highlight of every button in the group. */
interface ToolGroup { key: string; accent: string; tools: ToolDef[]; }

/**
 * The paint palette, split into color-coded groups (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md):
 *   - masks   — street + communal walkability + placeholder + condition annotation
 *               layers, all spriteless tints (violet),
 *   - terrain — terrain 1 / terrain 2 surface masks (green); shares the top letter row with
 *               the masks group (Q/W/E/R masks · T/Y terrain),
 *   - decor   — surface / common / tree / wood-panel decor (amber).
 * Each group's `accent` tints its panel background/border (so buttons read as grouped
 * even when idle) and colors the active-tool highlight (so a lit button still reads as
 * belonging to its group). The terrain tools are named generically ("terrain 1/2") so
 * their art can be hot-swapped later (they currently paint light/dark grass).
 *
 * The ERASER is NOT a tool here — it is a separate MODIFIER toggle (`eraseMode`, rendered on
 * the bottom row) layered on TOP of the selected tool: while it is on, painting removes
 * only the selected tool's OWN layer at the cell (see `paintCell`). It is scoped to the
 * tool it was enabled on — switching tools auto-clears it (the activeTool effect) — and is
 * disabled outright for the copy/paste tools, which don't route through paintCell's erase
 * branch (see `toolSupportsEraser`).
 */
const TOOL_GROUPS: ToolGroup[] = [
  {
    key: 'masks', accent: '168,132,255',
    tools: [
      { tool: 'street', label: 'Street (walkability mask)', icon: <RouteIcon fontSize="small" />, hotkey: 'Q' },
      { tool: 'communal', label: 'Communal', icon: <GroupsIcon fontSize="small" />, hotkey: 'W' },
      { tool: 'placeholder', label: 'Placeholder (version 0 only)', icon: <HighlightAltIcon fontSize="small" />, hotkey: 'E' },
      { tool: 'condition', label: 'Condition mask (per version)', icon: <RuleIcon fontSize="small" />, hotkey: 'R' },
    ],
  },
  // Terrain sits at the END of the top letter row (after the masks Q/W/E/R), continuing the
  // same keyboard row with T/Y. Like the masks tools, terrain paints via a two-click
  // RECTANGLE selection (see the rectangleMode prop on the viewer), not a free drag-paint.
  {
    key: 'terrain', accent: '132,204,120',
    tools: [
      { tool: 'terrain1', label: 'Terrain 1', icon: <GrassIcon fontSize="small" />, hotkey: 'T' },
      { tool: 'terrain2', label: 'Terrain 2 (renders over terrain 1)', icon: <ParkIcon fontSize="small" />, hotkey: 'Y' },
    ],
  },
  // Decor tools: the four sprite-decor categories. Each decor category places its
  // currently-selected variant (previewed as a ghost); SPACE cycles the variant. Placing
  // OVERRIDES any decor/plank already on the cell. The ONE exception: a plank refuses to bury a
  // non-surface (blocking) decor — a common prop or a tree — so those flush wood panels can only
  // cover empty or surface decor (see placeDecor).
  {
    key: 'decor', accent: '255,183,77',
    tools: [
      { tool: 'familyDecor', label: 'Surface decor (Space cycles variant)', icon: <LocalFloristIcon fontSize="small" />, hotkey: 'S' },
      { tool: 'commonDecor', label: 'Common decor (Space cycles variant)', icon: <ScatterPlotIcon fontSize="small" />, hotkey: 'D' },
      { tool: 'treeDecor', label: 'Trees (Space cycles variant)', icon: <ForestIcon fontSize="small" />, hotkey: 'F' },
      { tool: 'plankDecor', label: 'Wood panel (Space cycles variant · autotiles edges)', icon: <ViewWeekIcon fontSize="small" />, hotkey: 'G' },
    ],
  },
];

// Which decor category each decor tool places/erases. Used by the per-tool eraser to
// remove a cell's single decor sprite only when it belongs to the selected decor tool.
const DECOR_TOOL_CATEGORY: Partial<Record<EditorTool, DecorCategory>> = {
  familyDecor: 'family', commonDecor: 'common', treeDecor: 'tree', plankDecor: 'plank',
};

// Tools the ERASER modifier does NOT apply to. The eraser inverts a PAINT tool (removing
// its own layer at a cell via paintCell's erase branch); `copy`/`paste` are region tools
// that never route through that branch, so the eraser is meaningless — and thus disabled —
// while either is active. Every other tool paints a layer and supports erasing.
const ERASER_UNSUPPORTED_TOOLS: ReadonlySet<EditorTool> = new Set<EditorTool>(['copy', 'paste']);
const toolSupportsEraser = (tool: EditorTool): boolean => !ERASER_UNSUPPORTED_TOOLS.has(tool);

// Keyboard → tool dispatch. The authoritative source is this map; the per-tool `hotkey`
// badges above are the display mirror and must match. Keys are compared lower-case. Layout
// mirrors the physical keyboard, one palette row per keyboard row: Q/W/E/R masks + T/Y terrain
// (top letter row), S/D/F/G decor (home row), C/V copy/paste (bottom row). NON-tool actions
// live on the bottom row too and are handled separately in the keydown effect (not via this
// map): Z undo, X redo, B eraser modifier. The two version-gated tools are gated in the keydown
// handler (mirroring their disabled tool buttons): placeholder ('e') is version-0-only,
// condition ('r') is versions-above-0-only; paste ('v') is gated when the clipboard is empty.
const HOTKEY_TO_TOOL: Record<string, EditorTool> = {
  q: 'street', w: 'communal', e: 'placeholder', r: 'condition',
  t: 'terrain1', y: 'terrain2',
  s: 'familyDecor', d: 'commonDecor', f: 'treeDecor', g: 'plankDecor',
  c: 'copy', v: 'paste',
};

function TemplateEditorPage() {
  usePageTitle('Template Editor');
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { confirm } = useConfirmation();

  // Template-author-only surface. Once auth resolves, bounce non-authors to Home.
  // (The backend also enforces isTemplateAuthor on every endpoint — this is UX, not
  // the security boundary.)
  useEffect(() => {
    if (isAuthenticated && user && !user.isTemplateAuthor) navigate('/', { replace: true });
  }, [isAuthenticated, user, navigate]);

  const [width, setWidth] = useState(DEFAULT_DIM);
  const [height, setHeight] = useState(DEFAULT_DIM);
  const [name, setName] = useState('');
  // Optional, shared-per-name description (authored on version 0; inherited read-only on
  // higher versions). Kept as '' when absent; sent to the server as null when blank.
  const [description, setDescription] = useState('');
  const [masks, setMasks] = useState<EditorMasks>(emptyMasks);
  const [activeTool, setActiveTool] = useState<EditorTool>('terrain1');
  // The eraser MODIFIER. Not a tool — a toggle layered on top of the selected tool: while
  // on, painting removes only that tool's OWN layer at the cell (see paintCell). It is
  // scoped to the tool it was enabled on: switching to a different tool auto-clears it (the
  // activeTool effect below), so the eraser never silently carries into the next tool.
  const [eraseMode, setEraseMode] = useState(false);
  // The placeholder DROP size, as an index into PLACEHOLDER_SIZES (0 = 4×5, 1 = 5×4 rotated,
  // 2 = 4×10, 3 = 10×4 rotated). Space cycles it while the placeholder tool is active; each drop
  // stamps an area of this size. (Placeholder areas are fixed-size drops now, not a
  // free-painted mask — so adjacent slots stay distinct — see the placeholder tool.)
  const [placeholderSizeIdx, setPlaceholderSizeIdx] = useState(0);
  // The selected DECOR variant, as an index into the active decor tool's rotation. Space cycles
  // it while any decor tool is active; a click places `rotation[idx % len]` (the ghost previews
  // it). One shared index across the decor tools — each rotation length differs, so it is always
  // read modulo the active rotation, and it simply advances unbounded (the modulo keeps it valid).
  const [decorVariantIdx, setDecorVariantIdx] = useState(0);
  const [showGrid, setShowGrid] = useState(true);

  // ── Versions ──────────────────────────────────────────────────────────────────
  // The active version number (0 = base/default), the full set of version numbers
  // for the loaded name (drives the Properties dropdown), and whether the active
  // version is a NOT-YET-SAVED new version (created via "New version"). Version 0 is
  // the single source of truth for the shared placeholder mask, so the placeholder
  // tool + eraser are gated to v0 (see paintCell).
  const [version, setVersion] = useState(0);
  const [availableVersions, setAvailableVersions] = useState<number[]>([0]);
  const [isNewVersion, setIsNewVersion] = useState(false);
  // Unsaved edits since the last load/save — gates the switch-version and Load warns.
  const [dirty, setDirty] = useState(false);
  // Persistent toggle for the street-walkable highlight — same forced-on-while-active
  // semantics as showCommunal below (street is now a spriteless tint, not a plank).
  const [showStreet, setShowStreet] = useState(true);
  // Persistent toggle for the communal-walkable highlight. The overlay is forced on
  // while the communal TOOL is active (auto-reveal what you're painting); otherwise it
  // honors this setting. The toggle button reflects this persisted value, not the
  // forced-on state.
  const [showCommunal, setShowCommunal] = useState(true);
  // Persistent toggle for the placeholder-area highlight — same forced-on-while-active
  // semantics as showCommunal above.
  const [showPlaceholder, setShowPlaceholder] = useState(true);
  // Persistent toggle for the condition-mask highlight — same forced-on-while-active
  // semantics as showCommunal above.
  const [showCondition, setShowCondition] = useState(true);

  // Live condition breakdown for the AUTHOR (docs/NIGHT_MARKET_TEMPLATES.md § Version
  // selection rule → "generated on save for the author's information"). Runs the SAME
  // load-time analysis the runtime selector uses (`analyzeConditions` re-derives the
  // border-street conditions from `street ∩ outer-edge` and labels every 4-connected
  // island), so the count the author sees === the runtime's `conditionCount` denominator.
  // Version 0 carries no conditions by rule → always 0. Nothing here is persisted; the
  // count is display-only (decision 2026-07-17: no `conditionCount` column — no DB reader).
  const conditionInfo = useMemo(() => {
    if (version === 0) return { total: 0, placeholder: 0, borderStreet: 0 };
    const { islands, conditionCount } = analyzeConditions({
      condition: masks.condition,
      placeholderAreas: masks.placeholder,
      street: masks.street,
      width,
      height,
    });
    return {
      total: conditionCount,
      placeholder: islands.filter((i) => i.kind === 'placeholder').length,
      borderStreet: islands.filter((i) => i.kind === 'border-street').length,
    };
  }, [masks, width, height, version]);

  // The clipboard buffer for the copy/paste tools (null = empty). Set by `copyRegion`,
  // consumed by `pasteAt`; paste does NOT clear it, so one copy can be stamped many times.
  // Persists across tool switches / loads until the next copy replaces it.
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);

  // The template currently loaded / last saved. `loadedName` is the ONE existing name
  // the Properties rename gate permits (so Save can only overwrite a deliberately loaded
  // template, never a name collided into by accident) AND the Delete target. It is the
  // saved name of the CURRENT template (all its versions); null until a load/save.
  const [loadedName, setLoadedName] = useState<string | null>(null);

  const [propsOpen, setPropsOpen] = useState(false);
  // The read-only authoring-guidelines popup (rules we do NOT programmatically enforce —
  // the author must follow them by hand). See GuidelinesDialog below.
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Load GALLERY: whether the visual template picker is open (overlays the canvas, Load button
  // becomes Cancel), and its fetched entries (null while the fetch is in flight).
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryEntries, setGalleryEntries] = useState<TemplateGalleryEntry[] | null>(null);
  const [snack, setSnack] = useState<{ open: boolean; msg: string; severity: 'success' | 'error' }>(
    { open: false, msg: '', severity: 'success' },
  );

  // Reserve the mouse wheel for canvas zoom (lock body scroll while mounted).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  // Latest tool for the paint callback without recreating the viewer's handler.
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  // Latest board dims for the paint callback — the placeholder tool needs them to bounds-check
  // its drop footprint. Kept in refs (like activeToolRef) so paintCell stays identity-stable.
  const widthRef = useRef(width);
  widthRef.current = width;
  const heightRef = useRef(height);
  heightRef.current = height;
  // Latest version for the paint callback — the placeholder tool/eraser are gated to
  // version 0 (placeholder is shared, owned by v0), so paintCell needs the live value.
  const versionRef = useRef(version);
  versionRef.current = version;
  // Latest eraser-modifier state for the paint callback (kept in a ref, like activeTool,
  // so paintCell stays identity-stable). When on, paintCell erases the active tool's own
  // layer instead of painting it.
  const eraseModeRef = useRef(eraseMode);
  eraseModeRef.current = eraseMode;

  // The eraser is scoped to the tool it was turned on for: any change of the active tool
  // (via a palette button, a hotkey, or a programmatic fallback) auto-deactivates it, so it
  // never silently carries into the next tool. Toggling the eraser itself doesn't change
  // activeTool, so this fires only on genuine tool switches.
  useEffect(() => {
    setEraseMode(false);
  }, [activeTool]);
  // Latest placeholder drop size for the paint callback (kept in a ref, like activeTool, so
  // paintCell stays identity-stable). Read when the placeholder tool drops an area.
  const placeholderSizeRef = useRef(PLACEHOLDER_SIZES[placeholderSizeIdx]);
  placeholderSizeRef.current = PLACEHOLDER_SIZES[placeholderSizeIdx];
  // Latest decor variant index for the paint callback (kept in a ref so paintCell stays
  // identity-stable). Read when a decor tool places its selected sprite.
  const decorVariantIdxRef = useRef(decorVariantIdx);
  decorVariantIdxRef.current = decorVariantIdx;
  // Latest masks for the copy tool, which READS the current board (paintCell mutates via a
  // functional update and needs no ref, but copyRegion needs a live snapshot to capture).
  const masksRef = useRef(masks);
  masksRef.current = masks;
  // Latest clipboard for the paste callback + the paste hotkey gate (kept identity-stable).
  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;

  // ── Undo / redo history ─────────────────────────────────────────────────────────
  // Snapshot-based history over the whole masks object. The two STACKS are refs (mutated
  // imperatively so the handlers stay identity-stable and StrictMode-safe — no side effects
  // inside a state updater); `canUndo`/`canRedo` mirror their non-emptiness to drive the
  // button disabled state. A snapshot of the PRE-edit board is pushed at the start of each
  // logical edit — a drag stroke (viewer `onEditBegin`), a rectangle fill, a paste, or Clear —
  // so one gesture is one undo step. Undo/redo swap the live board with the top of a stack,
  // pushing the current board onto the opposite stack. History is reset on load/version-switch
  // /dimension-change (a fresh board context).
  const undoStackRef = useRef<EditorMasks[]>([]);
  const redoStackRef = useRef<EditorMasks[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const syncHistoryFlags = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);
  // Snapshot the current board as a new undo step (and drop the redo future). Called BEFORE a
  // mutating edit is applied, so it captures the pre-edit state.
  const pushHistory = useCallback(() => {
    undoStackRef.current = [...undoStackRef.current, cloneMasks(masksRef.current)].slice(-HISTORY_LIMIT);
    redoStackRef.current = [];
    syncHistoryFlags();
  }, [syncHistoryFlags]);
  // Forget all history (used when the board is replaced wholesale — load/switch/reset/resize).
  const resetHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncHistoryFlags();
  }, [syncHistoryFlags]);
  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const restored = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, cloneMasks(masksRef.current)];
    setMasks(restored);
    setDirty(true);
    syncHistoryFlags();
  }, [syncHistoryFlags]);
  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const restored = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, cloneMasks(masksRef.current)];
    setMasks(restored);
    setDirty(true);
    syncHistoryFlags();
  }, [syncHistoryFlags]);

  // Paint the active tool onto a cell. Functional update → never stale. Terrain 1 and
  // terrain 2 are fully independent masks (their only relationship is z-order — terrain 2
  // draws on top of terrain 1). When the eraser MODIFIER is on (eraseModeRef), the tool's paint is inverted:
  // it REMOVES only that tool's OWN layer at the cell (never the top-most layer, never
  // another tool's) — see the erase branch below.
  const paintCell = useCallback((col: number, row: number) => {
    const k = `${col},${row}`;
    setDirty(true); // any paint stroke makes the board unsaved (harmless on a no-op)
    setMasks(prev => {
      const terrain1 = new Set(prev.terrain1);
      const terrain2 = new Set(prev.terrain2);
      const street = new Set(prev.street);
      const communal = new Set(prev.communal);
      let placeholder = prev.placeholder; // areas are immutable; replaced (not mutated) on drop/erase
      const condition = new Set(prev.condition);
      const decor = new Map(prev.decor);
      const tool = activeToolRef.current;
      // Which cells any placeholder area currently covers — the coverage set the condition
      // cascades key on ("a condition may live only on a street/placeholder cell"). The
      // street/communal/decor branches never touch `placeholder`, so this stays valid
      // for them; the placeholder branch recomputes coverage after it drops/erases an area.
      const placeholderCells = placeholderCoveredCells(placeholder);

      // Place a decor tool's currently-selected variant on the cell. The variant is chosen
      // with Space (decorVariantIdx) and previewed as a ghost; a click stamps it, OVERRIDING
      // any decor/plank already there (decor freely overwrites decor, EXCEPT a plank refuses to
      // bury a blocking common prop/tree — guarded below). For family/plank the index resolves
      // against the cell's surface rotation; common/tree/plank rotations are surface-agnostic.
      const placeDecor = (category: DecorCategory) => {
        // A plank is a flush wood panel and must never bury a NON-SURFACE (blocking) decor —
        // a common prop or a tree. Those are real objects a plank would visually cover, so the
        // plank tool skips any cell already holding one (family/plank surface decor is fine to
        // overwrite). Mirrors isBlockingDecorUrl via the cell's decor category.
        if (category === 'plank') {
          const existing = decor.get(k);
          if (existing && isBlockingDecorUrl(existing)) return;
        }
        const surface = editorSurfaceAt({ terrain1, terrain2 }, col, row);
        const rotation = editorDecorRotation(category, surface);
        if (rotation.length === 0) return;
        decor.set(k, rotation[decorVariantIdxRef.current % rotation.length]);
        // Common decor and trees are BLOCKING objects — they overwrite BOTH walkability
        // classes (street + communal): a road/park tile can't hold a tree/prop. Surface
        // (family) decor and plank wood panels are flush and may coexist with them, so they
        // are exempt. Removing the street substrate cascade-clears any condition on the cell
        // (a condition may live only on a street/placeholder cell).
        if (category === 'common' || category === 'tree') {
          communal.delete(k);
          if (street.delete(k) && !placeholderCells.has(k)) condition.delete(k);
        }
      };

      // ── Eraser modifier ────────────────────────────────────────────────────────
      // When the eraser is toggled on, painting REMOVES only the ACTIVE tool's own layer
      // at the cell. Each tool erases exactly what it paints; the cascade rules mirror the
      // paint cases (a condition may live only on a street/placeholder cell, so removing
      // its last substrate clears it). The active tool force-shows its own tint (see the
      // viewer's show* props), so you always see the layer you are erasing.
      if (eraseModeRef.current) {
        switch (tool) {
          case 'terrain1': terrain1.delete(k); break;
          case 'terrain2': terrain2.delete(k); break;
          case 'street':
            if (street.delete(k) && !placeholderCells.has(k)) condition.delete(k);
            break;
          case 'communal': communal.delete(k); break;
          case 'placeholder': {
            // Placeholder is shared/owned by v0 (inherited read-only above), so it is
            // erasable ONLY on version 0 — mirrors the paint guard. A click removes the WHOLE
            // area under the cursor (areas are dropped/erased atomically, never per-cell).
            if (versionRef.current !== 0) break;
            const hit = placeholderAreaAt(placeholder, col, row);
            if (!hit) break;
            placeholder = placeholder.filter((a) => a !== hit);
            // Cascade-clear any condition orphaned by the removed area (a condition may live
            // only on a street/placeholder cell). Always empty on v0 → safety no-op, but kept
            // to hold the invariant regardless of how conditions ever land on v0.
            const stillCovered = placeholderCoveredCells(placeholder);
            for (const c of placeholderAreaCells(hit)) {
              if (!street.has(c) && !stillCovered.has(c)) condition.delete(c);
            }
            break;
          }
          case 'condition': condition.delete(k); break;
          // A cell holds ONE decor sprite shared by the three decor tools, so a decor
          // eraser removes it only when it belongs to THIS tool's category ("only erase
          // the selected tool") — e.g. the surface-decor eraser leaves a tree untouched.
          case 'familyDecor':
          case 'commonDecor':
          case 'treeDecor':
          case 'plankDecor': {
            const current = decor.get(k);
            if (current && editorDecorCategory(current) === DECOR_TOOL_CATEGORY[tool]) decor.delete(k);
            break;
          }
        }
        return { terrain1, terrain2, street, communal, placeholder, condition, decor };
      }

      switch (tool) {
        case 'terrain1': terrain1.add(k); break;
        // Terrain 2 is a fully INDEPENDENT mask — it does NOT add terrain 1 underneath and
        // does not require it. Terrain 2 renders on its own cells regardless of terrain 1;
        // their only relationship is z-order (terrain 2 draws on top of terrain 1).
        case 'terrain2': terrain2.add(k); break;
        case 'street': {
          // Street is now a spriteless walkability tint that MIRRORS communal: it can't
          // sit under a BLOCKING decor — common decor or a tree — so painting it there is
          // silently REFUSED (no-op). Flush surface-family decor and the grass terrain
          // coexist with it (the tint draws over them).
          const blockingDecor = decor.has(k) && isBlockingDecorUrl(decor.get(k)!);
          if (blockingDecor) break;
          // Street and communal are mutually-exclusive walkability classes, so painting
          // street clears communal.
          street.add(k);
          communal.delete(k);
          break;
        }
        case 'communal': {
          // Communal-walkable is a walkability annotation (parks/plazas) with no sprite.
          // It can't sit under a BLOCKING decor — common decor or a tree — so painting it
          // there is silently REFUSED (no-op). (Flush surface-family decor is fine.)
          const blockingDecor = decor.has(k) && isBlockingDecorUrl(decor.get(k)!);
          if (blockingDecor) break;
          // It also can't coexist with the street class, so painting it clears street.
          // A condition may live only on a street/placeholder cell, so if this paint
          // removes the street substrate and the cell isn't also a placeholder, the
          // condition would be orphaned — cascade-clear it too (invariant upkeep).
          communal.add(k);
          if (street.delete(k) && !placeholderCells.has(k)) condition.delete(k);
          break;
        }
        case 'placeholder': {
          // Placeholder areas are FIXED-SIZE DROPS (4×5 / 5×4 / 4×10 / 10×4 — Space cycles the
          // size), anchored at the hovered near corner and extending +isoX/+isoY. They are an
          // OVERRIDE overlay, not a walkability class, so an area may overlap any surface
          // freely — but NOT another area (each is a distinct occupant slot). SHARED across
          // versions (owned by version 0), so paintable ONLY on version 0; on higher versions
          // the tool button is disabled and this guard is the backstop. The drop is refused
          // (no-op) unless the whole footprint is in-bounds and hits no existing area.
          if (versionRef.current !== 0) break;
          const { w, h } = placeholderSizeRef.current;
          const area: PlaceholderArea = { col, row, w, h };
          if (!placeholderAreaFits(area, widthRef.current, heightRef.current)) break;
          if (placeholderAreaOverlapsAny(area, placeholder)) break;
          placeholder = [...placeholder, area];
          break;
        }
        case 'condition':
          // The condition mask is a PER-VERSION override overlay (differs between
          // versions). It is the INVERSE of placeholder's version rule: paintable ONLY on
          // versions > 0 (on version 0 the tool button is disabled and this guard is the
          // backstop). MANUAL painting annotates ONLY a PLACEHOLDER cell — painting it
          // anywhere else is a silent no-op. (Border STREET cells also carry a condition,
          // but that is placed AUTOMATICALLY at save time, not by this tool — see
          // handleSubmit's withBorderStreetConditions.) A condition may therefore live on a
          // placeholder cell (manual) or a border-street cell (auto); removing either
          // substrate cascades the condition away (see the communal + erase cases).
          if (versionRef.current === 0) break;
          if (!placeholderCells.has(k)) break;
          condition.add(k);
          break;
        case 'familyDecor': placeDecor('family'); break;
        case 'commonDecor': placeDecor('common'); break;
        case 'treeDecor': placeDecor('tree'); break;
        case 'plankDecor': placeDecor('plank'); break;
      }
      return { terrain1, terrain2, street, communal, placeholder, condition, decor };
    });
  }, []);

  // ── Clipboard: copy / paste ─────────────────────────────────────────────────────
  // COPY captures the selected rectangle into the clipboard as offsets relative to its min
  // corner: every per-cell mask + decor for the W×H region, plus every placeholder area whose
  // ENTIRE footprint fits inside the rectangle (a partly-overhanging area is skipped). Reads the
  // live board via masksRef; does not mutate.
  const copyRegion = useCallback((a: { col: number; row: number }, b: { col: number; row: number }) => {
    const c0 = Math.min(a.col, b.col), c1 = Math.max(a.col, b.col);
    const r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row);
    const w = c1 - c0 + 1, h = r1 - r0 + 1;
    const m = masksRef.current;
    // Cells of a boolean mask that lie in the rectangle, re-keyed to "dx,dy" offsets.
    const pick = (set: Set<string>): Set<string> => {
      const out = new Set<string>();
      for (const key of set) {
        const [col, row] = key.split(',').map(Number);
        if (col >= c0 && col <= c1 && row >= r0 && row <= r1) out.add(`${col - c0},${row - r0}`);
      }
      return out;
    };
    const decor = new Map<string, string>();
    for (const [key, url] of m.decor) {
      const [col, row] = key.split(',').map(Number);
      if (col >= c0 && col <= c1 && row >= r0 && row <= r1) decor.set(`${col - c0},${row - r0}`, url);
    }
    // Placeholder areas whose WHOLE footprint fits the rectangle → re-anchored to its min
    // corner (a partly-overhanging area is skipped — an occupant slot is captured whole or
    // not at all). Kept as {col,row,w,h} records so pasted slots stay distinct.
    const placeholder: PlaceholderArea[] = [];
    for (const area of m.placeholder) {
      if (area.col >= c0 && area.col + area.w - 1 <= c1 && area.row >= r0 && area.row + area.h - 1 <= r1) {
        placeholder.push({ col: area.col - c0, row: area.row - r0, w: area.w, h: area.h });
      }
    }
    setClipboard({
      w, h,
      terrain1: pick(m.terrain1), terrain2: pick(m.terrain2),
      street: pick(m.street), communal: pick(m.communal),
      placeholder, condition: pick(m.condition),
      decor,
    });
  }, []);

  // PASTE stamps the clipboard with its min corner at (col,row), OVERWRITING the target
  // region to match the clipboard exactly. Refused if the footprint would overhang the board
  // (guaranteed 1:1 with the copy). Each cell's layers are set to match the clipboard.
  // Placeholder is written only on v0 (it is shared/owned by v0 and inherited read-only above)
  // and condition only on v>0 (forbidden on v0) — mirroring the tool version gates, so paste
  // never breaks those invariants.
  const pasteAt = useCallback((col: number, row: number) => {
    const clip = clipboardRef.current;
    if (!clip) return;
    const { w, h } = clip;
    if (col < 0 || row < 0 || col + w > widthRef.current || row + h > heightRef.current) return;
    const v = versionRef.current;
    const writePlaceholder = v === 0;
    const writeCondition = v > 0;
    pushHistory(); // one undo step for the whole paste
    setMasks(prev => {
      const terrain1 = new Set(prev.terrain1);
      const terrain2 = new Set(prev.terrain2);
      const street = new Set(prev.street);
      const communal = new Set(prev.communal);
      let placeholder = prev.placeholder; // areas replaced (not mutated) below, only on v0
      const condition = new Set(prev.condition);
      const decor = new Map(prev.decor);
      // Overwrite every region cell to exactly match the clipboard.
      const setMembership = (set: Set<string>, key: string, present: boolean) => {
        if (present) set.add(key); else set.delete(key);
      };
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const off = `${dx},${dy}`;
          const key = `${col + dx},${row + dy}`;
          setMembership(terrain1, key, clip.terrain1.has(off));
          setMembership(terrain2, key, clip.terrain2.has(off));
          setMembership(street, key, clip.street.has(off));
          setMembership(communal, key, clip.communal.has(off));
          if (writeCondition) setMembership(condition, key, clip.condition.has(off));
          const url = clip.decor.get(off);
          if (url) decor.set(key, url); else decor.delete(key);
        }
      }
      // Placeholder areas paste WHOLE (not per-cell, to keep each slot distinct), and only on
      // v0. Drop any existing area that intersects the target region, then stamp the captured
      // areas at their translated anchors (in-bounds by construction — the paste footprint fits
      // and each captured area was fully inside the clip).
      if (writePlaceholder) {
        const region: PlaceholderArea = { col, row, w, h };
        placeholder = placeholder.filter((a) => !placeholderAreasOverlap(a, region));
        for (const a of clip.placeholder) {
          placeholder = [...placeholder, { col: col + a.col, row: row + a.row, w: a.w, h: a.h }];
        }
      }
      return { terrain1, terrain2, street, communal, placeholder, condition, decor };
    });
    setDirty(true);
  }, [pushHistory]);

  // The rectangle-drag release. Copy captures the region (no board change → no history); the
  // mask tools snapshot once then fill it cell-by-cell through the shared paintCell (so every
  // invariant/cascade applies, all under a single undo step).
  const handleRectComplete = useCallback((a: { col: number; row: number }, b: { col: number; row: number }) => {
    if (activeToolRef.current === 'copy') { copyRegion(a, b); return; }
    pushHistory();
    const c0 = Math.min(a.col, b.col), c1 = Math.max(a.col, b.col);
    const r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) paintCell(c, r);
  }, [copyRegion, paintCell, pushHistory]);

  // ── Keyboard hotkeys ────────────────────────────────────────────────────────────
  // Palette hotkeys mirror the keyboard's physical layout, one palette row per keyboard row
  // (first button = the row's left key, later buttons step right):
  //   `  grid · 1/2/3/4 view toggles        (number row — top palette row)
  //   Q/W/E/R masks                         (top letter row)
  //   A/S terrain · D/F/G/H decor           (home row)
  //   Z undo · X redo · C/V copy/paste · B eraser  (bottom row)
  // Masks/terrain/decor/copy/paste select via HOTKEY_TO_TOOL; grid + the four view toggles +
  // Z undo / X redo / the B eraser MODIFIER are handled directly below (not tools). SPACE cycles
  // the placeholder drop size / decor variant of the active tool. Suppressed while the Properties
  // dialog is open or focus is in a text field, so typing never paints. Keyed on [version] so the
  // placeholder gate (v0-only) reads the current version.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Let native/browser shortcuts through; only bare keypresses are hotkeys.
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      // Never hijack typing (Properties name/dimension fields, any editable target).
      const el = e.target as HTMLElement | null;
      if (propsOpen || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) return;

      const key = e.key.toLowerCase();
      // View toggles (top palette row). Each toggle is independent of the paint tools: while
      // a tool is active its tint is force-shown for display, but the toggle itself stays
      // freely settable (mirrors the always-clickable buttons), so the key flips it regardless.
      if (key === '`') { setShowGrid(v => !v); e.preventDefault(); return; }
      if (key === '1') { setShowStreet(v => !v); e.preventDefault(); return; }
      if (key === '2') { setShowCommunal(v => !v); e.preventDefault(); return; }
      if (key === '3') { setShowPlaceholder(v => !v); e.preventDefault(); return; }
      if (key === '4') { setShowCondition(v => !v); e.preventDefault(); return; }

      // Undo / redo (bottom-row Z / X). No-ops at the ends of their stacks (handlers guard).
      if (key === 'z') { handleUndo(); e.preventDefault(); return; }
      if (key === 'x') { handleRedo(); e.preventDefault(); return; }

      // B toggles the eraser modifier (layered on top of whatever tool is selected). Ignored
      // for tools that don't support erasing (copy/paste) — mirrors the disabled toggle button.
      if (key === 'b') { if (toolSupportsEraser(activeTool)) setEraseMode(v => !v); e.preventDefault(); return; }

      // Space is a per-tool modifier: it cycles the placeholder DROP size
      // 4×5 → 5×4 → 4×10 → 10×4 → 4×5 (placeholder tool), OR advances the selected decor variant
      // (any decor tool — the ghost previews it). Elsewhere it is swallowed so it never scrolls
      // the page or re-taps a focused button.
      if (key === ' ') {
        if (activeTool === 'placeholder') setPlaceholderSizeIdx(i => (i + 1) % PLACEHOLDER_SIZES.length);
        else if (DECOR_TOOL_CATEGORY[activeTool]) setDecorVariantIdx(i => i + 1);
        e.preventDefault();
        return;
      }

      const tool = HOTKEY_TO_TOOL[key];
      if (!tool) return;
      // Version-gated tools mirror their disabled tool buttons: placeholder is v0-only,
      // condition is versions-above-0-only (the two are inverses of each other).
      if (tool === 'placeholder' && version !== 0) return;
      if (tool === 'condition' && version === 0) return;
      // Paste mirrors its disabled button — no-op until something has been copied.
      if (tool === 'paste' && !clipboardRef.current) return;
      setActiveTool(tool);
      e.preventDefault(); // stop the key from re-triggering a focused button
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [propsOpen, version, activeTool, handleUndo, handleRedo]);

  // Clear the board. On version 0 this wipes everything (incl. the placeholder it
  // owns); on higher versions the placeholder is inherited/read-only, so it is kept.
  const handleClear = () => {
    pushHistory(); // Clear is undoable
    setMasks(prev => (version === 0
      ? emptyMasks()
      : { ...emptyMasks(), placeholder: [...prev.placeholder] }));
    setDirty(true);
  };

  // "New Template" — throw away the current board and start fresh: a blank, unbound
  // v0 board at the default size with no name. Warns first (like Load/version-switch)
  // if there are unsaved edits, since this is destructive.
  const handleNewTemplate = async () => {
    if (dirty) {
      const ok = await confirm(
        'Starting a new template replaces the current board — any unsaved edits will be lost. Continue?',
        { title: 'New template?', confirmText: 'New template', cancelText: 'Keep editing' },
      );
      if (!ok) return;
    }
    setWidth(DEFAULT_DIM);
    setHeight(DEFAULT_DIM);
    setName('');
    resetToBlank();
    if (activeTool === 'condition' || activeTool === 'placeholder') setActiveTool('terrain1');
  };

  // Reset all version/loaded state back to a blank, unbound v0 board (after delete).
  const resetToBlank = () => {
    setMasks(emptyMasks());
    setDescription('');
    setVersion(0);
    setAvailableVersions([0]);
    setIsNewVersion(false);
    setLoadedName(null);
    setDirty(false);
    resetHistory(); // the board is gone — its edit history no longer applies
  };

  // Load a specific (name, version) row into the editor, replacing the board. Used by
  // both the Load dropdown (version 0) and the version switcher. Clears dirty; the two
  // version-gated tools can't stay active across a version boundary, so drop back to a
  // safe tool: placeholder off a non-base version, condition off version 0.
  const applyLoadedVersion = (tpl: Awaited<ReturnType<typeof loadTemplate>>) => {
    setWidth(tpl.width);
    setHeight(tpl.height);
    setName(tpl.name);
    setDescription(tpl.description ?? '');
    setMasks(definitionToMasks(tpl.definition));
    setVersion(tpl.version);
    setAvailableVersions(tpl.availableVersions.length ? tpl.availableVersions : [tpl.version]);
    setLoadedName(tpl.name);
    setIsNewVersion(false);
    setDirty(false);
    resetHistory(); // fresh board context — prior undo history no longer applies
    if (tpl.version !== 0 && activeTool === 'placeholder') setActiveTool('terrain1');
    if (tpl.version === 0 && activeTool === 'condition') setActiveTool('terrain1');
  };

  // Open the visual Load GALLERY (overlays the canvas), fetching every template's thumbnail
  // definition fresh each time. On a fetch failure the gallery is closed with a snack error.
  const handleOpenGallery = async () => {
    setGalleryOpen(true);
    setGalleryEntries(null); // null → the overlay shows a "Loading…" state until this resolves
    try {
      setGalleryEntries(await listTemplateGallery());
    } catch (err) {
      setGalleryOpen(false);
      setSnack({ open: true, msg: err instanceof Error ? err.message : 'Failed to load template gallery', severity: 'error' });
    }
  };

  // Close the gallery without loading anything (the Load button's Cancel state).
  const handleCloseGallery = () => setGalleryOpen(false);

  // Load a template picked from the gallery. Loads the SAME version the thumbnail previewed
  // (its most-conditions `chosenVersion`), warning first if the current board has unsaved
  // edits. Marks it as the loaded template so the rename gate will permit an overwriting Save.
  const handlePickTemplate = async (entry: TemplateGalleryEntry) => {
    if (dirty) {
      const ok = await confirm(
        `Loading "${entry.name}" replaces the current board — any unsaved edits will be lost. Continue?`,
        { title: 'Load template?', confirmText: 'Load', cancelText: 'Keep editing' },
      );
      if (!ok) return;
    }
    try {
      const tpl = await loadTemplate(entry.name, entry.chosenVersion);
      applyLoadedVersion(tpl);
      setGalleryOpen(false);
      setSnack({ open: true, msg: `Loaded "${tpl.name}" (v${tpl.version})`, severity: 'success' });
    } catch (err) {
      setSnack({ open: true, msg: err instanceof Error ? err.message : 'Failed to load template', severity: 'error' });
    }
  };

  // Switch the active version. Per the chosen model, switching RELOADS the target
  // version from the last SAVED state, so unsaved edits are discarded (after a warn).
  // A never-saved new version has no server row to return to — leaving it drops it
  // from the dropdown.
  const handleSwitchVersion = async (target: number) => {
    if (target === version) return;
    if (dirty) {
      const label = isNewVersion ? `the new version ${version}` : `version ${version}`;
      const ok = await confirm(
        `You have unsaved edits to ${label}. Switching to version ${target} will discard them. Continue?`,
        { title: 'Switch version?', confirmText: 'Switch', cancelText: 'Keep editing' },
      );
      if (!ok) return;
    }
    // Drop a discarded, never-saved new version from the dropdown before leaving it.
    if (isNewVersion) setAvailableVersions(vs => vs.filter(v => v !== version));
    if (!loadedName) return; // no saved template to reload from (shouldn't happen)
    try {
      const tpl = await loadTemplate(loadedName, target);
      applyLoadedVersion(tpl);
      setSnack({ open: true, msg: `Switched to version ${target}`, severity: 'success' });
    } catch (err) {
      setSnack({ open: true, msg: err instanceof Error ? err.message : 'Failed to load version', severity: 'error' });
    }
  };

  // Create a new version by COPYING the current board. Requires the template (its
  // version 0) to be saved, because the server needs v0's placeholder + size when the
  // new version is saved. The copy keeps the current masks; placeholder becomes
  // read-only (inherited from v0) on the new version, so drop the placeholder tool.
  const handleNewVersion = () => {
    if (loadedName !== name.trim() || !name.trim()) {
      setSnack({ open: true, msg: 'Save the template (version 0) before adding versions', severity: 'error' });
      return;
    }
    if (dirty) {
      setSnack({ open: true, msg: 'Save the current version before adding another', severity: 'error' });
      return;
    }
    const next = Math.max(...availableVersions) + 1;
    setAvailableVersions(vs => [...vs, next]);
    setVersion(next);
    setIsNewVersion(true);
    setDirty(true);
    resetHistory(); // new version context — start its undo history fresh
    if (activeTool === 'placeholder') setActiveTool('terrain1');
    setSnack({ open: true, msg: `New version ${next} (copied) — Save to keep it`, severity: 'success' });
  };

  const handleSubmit = async () => {
    // No name chosen yet (never opened Properties) — don't block the save; adopt the next
    // free default name ("template{n}") from the server, exactly as the Properties popup
    // would have pre-filled it. `name` state is async, so carry the resolved value locally.
    let saveName = name.trim();
    if (!saveName) {
      setSubmitting(true);
      try {
        saveName = (await suggestTemplateName()).trim();
        setName(saveName);
      } catch (err) {
        setSnack({ open: true, msg: err instanceof Error ? err.message : 'Could not pick a template name', severity: 'error' });
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
    }
    // Auto-place border-street conditions before saving (versions > 0 only — version 0
    // carries no condition mask). Merge them into the live board so the author SEES the
    // orange cells appear, and submit the SAME augmented object: setMasks is async, so we
    // must not depend on the state update landing before the POST reads `masks`.
    const outgoing = version > 0 ? withBorderStreetConditions(masks, width, height) : masks;
    if (outgoing !== masks) setMasks(outgoing);
    setSubmitting(true);
    try {
      const { overwritten } = await submitTemplate({
        name: saveName, version, width, height, description: description.trim() || null, masks: outgoing,
      });
      // A successful save makes this the loaded template — subsequent saves overwrite it,
      // the rename gate now permits its name, and Delete now targets it.
      setLoadedName(saveName);
      setIsNewVersion(false);
      setDirty(false);
      setAvailableVersions(vs => (vs.includes(version) ? vs : [...vs, version].sort((a, b) => a - b)));
      // Report the condition breakdown so the author knows how many scored conditions the
      // saved version carries (versions > 0 only — version 0 has none). This mirrors the
      // runtime's load-time count; nothing is persisted (see `conditionInfo`).
      const conditionSuffix =
        version > 0
          ? ` — ${conditionInfo.total} condition${conditionInfo.total === 1 ? '' : 's'} ` +
            `(${conditionInfo.placeholder} placeholder, ${conditionInfo.borderStreet} border-street)`
          : '';
      setSnack({
        open: true,
        msg:
          (overwritten
            ? `Saved version ${version} of "${saveName}"`
            : `Created version ${version} of "${saveName}"`) + conditionSuffix,
        severity: 'success',
      });
    } catch (err) {
      setSnack({ open: true, msg: err instanceof Error ? err.message : 'Submit failed', severity: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // Delete the WHOLE loaded template (every version) from the DB (hard delete,
  // confirmed). Only enabled when a template is actually loaded/saved. Afterward the
  // board resets to a blank, unbound v0 so a Save would create anew.
  const handleDelete = async () => {
    if (!loadedName) return;
    const ok = await confirm(
      `Permanently delete "${loadedName}" and ALL its versions from the database? This cannot be undone.`,
      { title: 'Delete template?', confirmText: 'Delete', cancelText: 'Cancel' },
    );
    if (!ok) return;
    try {
      await deleteTemplate(loadedName);
      const deleted = loadedName;
      resetToBlank();
      setSnack({ open: true, msg: `Deleted "${deleted}"`, severity: 'success' });
    } catch (err) {
      setSnack({ open: true, msg: err instanceof Error ? err.message : 'Failed to delete template', severity: 'error' });
    }
  };

  // Delete ONLY the current version (never version 0 — that is the base/placeholder
  // source of truth, so the button is disabled there and the server rejects it). Two
  // paths: a never-saved new version has no DB row, so we just drop it from the dropdown
  // locally; a saved version > 0 is hard-deleted (confirmed) via the version endpoint.
  // Either way we then reload version 0 as the surviving board.
  const handleDeleteVersion = async () => {
    if (!loadedName || version === 0) return;
    const gone = version;

    // Never-saved new version: nothing to delete server-side — discard it locally.
    if (isNewVersion) {
      const ok = await confirm(
        `Discard the unsaved version ${gone}? It has not been saved, so this only drops it.`,
        { title: 'Discard version?', confirmText: 'Discard', cancelText: 'Cancel' },
      );
      if (!ok) return;
      setAvailableVersions(vs => vs.filter(v => v !== gone));
      try {
        const tpl = await loadTemplate(loadedName, 0);
        applyLoadedVersion(tpl);
        setSnack({ open: true, msg: `Discarded version ${gone}`, severity: 'success' });
      } catch (err) {
        setSnack({ open: true, msg: err instanceof Error ? err.message : 'Failed to reload base version', severity: 'error' });
      }
      return;
    }

    const ok = await confirm(
      `Permanently delete version ${gone} of "${loadedName}"? This cannot be undone.`,
      { title: 'Delete version?', confirmText: 'Delete', cancelText: 'Cancel' },
    );
    if (!ok) return;
    try {
      await deleteTemplateVersion(loadedName, gone);
      // Reload version 0 (the surviving base); applyLoadedVersion refreshes
      // availableVersions from the server, dropping the deleted one.
      const tpl = await loadTemplate(loadedName, 0);
      applyLoadedVersion(tpl);
      setSnack({ open: true, msg: `Deleted version ${gone}`, severity: 'success' });
    } catch (err) {
      setSnack({ open: true, msg: err instanceof Error ? err.message : 'Failed to delete version', severity: 'error' });
    }
  };

  // The three paint groups, pulled out by key so the palette can place them individually
  // (eraser inline before terrain; masks directly above the mask-view toggles) instead of
  // mapping TOOL_GROUPS in a fixed vertical order.
  const terrainGroup = TOOL_GROUPS.find(g => g.key === 'terrain')!;
  const decorGroup = TOOL_GROUPS.find(g => g.key === 'decor')!;
  const masksGroup = TOOL_GROUPS.find(g => g.key === 'masks')!;

  // Render one color-coded tool group as a horizontal row of paint-tool buttons. The two
  // version-gated tools (placeholder = v0-only, condition = versions-above-0-only) disable
  // their button off the wrong version, mirroring the keydown gate + the server guards.
  const renderToolGroup = ({ key, accent, tools }: ToolGroup) => (
    <Box
      key={key}
      className={`template-editor-tool-group template-editor-tool-group-${key}`}
      sx={{
        display: 'flex', flexDirection: 'row', gap: 0.75, p: 0.75, borderRadius: 1.5,
        backgroundColor: `rgba(${accent},0.14)`,
        border: `1px solid rgba(${accent},0.4)`,
      }}
    >
      {tools.map(({ tool, label, icon, hotkey }) => {
        const disabled =
          (tool === 'placeholder' && version !== 0) ||
          (tool === 'condition' && version === 0);
        const disabledReason =
          tool === 'placeholder'
            ? 'Placeholder is editable only on version 0'
            : 'The condition mask is only available on versions above 0';
        return (
          <Tooltip
            key={tool}
            // The placeholder button reports its current DROP size — cycled by Space while the
            // tool is active.
            title={disabled
              ? disabledReason
              : `${label} (${hotkey})${
                  tool === 'placeholder'
                    ? ` · ${PLACEHOLDER_SIZES[placeholderSizeIdx].w}×${PLACEHOLDER_SIZES[placeholderSizeIdx].h} (Space to resize)`
                    : ''
                }`}
            placement="top"
          >
            <span>
              <Button
                className={`template-editor-tool template-editor-tool-${tool}`}
                variant={activeTool === tool ? 'contained' : 'outlined'}
                size="small"
                disabled={disabled}
                onClick={() => setActiveTool(tool)}
                sx={paletteBtnSx(activeTool === tool, accent)}
              >
                {icon}
                <HotkeyBadge label={hotkey} />
              </Button>
            </span>
          </Tooltip>
        );
      })}
    </Box>
  );

  // The clipboard group (Copy · Paste) — rendered on its own (not via renderToolGroup) so
  // Copy can show a persistent "loaded" ring once something is captured and Paste can be
  // disabled until then. Both use the shared pink CLIPBOARD_ACCENT.
  const renderClipboardGroup = () => (
    <Box
      className="template-editor-tool-group template-editor-tool-group-clipboard"
      sx={{
        display: 'flex', flexDirection: 'row', gap: 0.75, p: 0.75, borderRadius: 1.5,
        backgroundColor: `rgba(${CLIPBOARD_ACCENT},0.14)`,
        border: `1px solid rgba(${CLIPBOARD_ACCENT},0.4)`,
      }}
    >
      {/* Copy — rectangle-select a region into the clipboard. A pink ring marks a loaded
          clipboard (distinct from the contained fill that marks the active tool). */}
      <Tooltip
        title={clipboard
          ? `Copy region (C) · clipboard holds ${clipboard.w}×${clipboard.h}`
          : 'Copy region — drag a rectangle to capture it (C)'}
        placement="top"
      >
        <span>
          <Button
            className="template-editor-tool template-editor-tool-copy"
            variant={activeTool === 'copy' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => setActiveTool('copy')}
            sx={{
              ...paletteBtnSx(activeTool === 'copy', CLIPBOARD_ACCENT),
              ...(clipboard ? { boxShadow: `0 0 0 2px rgba(${CLIPBOARD_ACCENT},0.9)` } : {}),
            }}
          >
            <ContentCopyIcon fontSize="small" />
            <HotkeyBadge label="C" />
          </Button>
        </span>
      </Tooltip>
      {/* Paste — stamp the clipboard as a footprint (like the placeholder drop). Disabled until
          something has been copied. */}
      <Tooltip
        title={clipboard ? `Paste clipboard (V) — ${clipboard.w}×${clipboard.h} stamp` : 'Copy a region first to paste'}
        placement="top"
      >
        <span>
          <Button
            className="template-editor-tool template-editor-tool-paste"
            variant={activeTool === 'paste' ? 'contained' : 'outlined'}
            size="small"
            disabled={!clipboard}
            onClick={() => setActiveTool('paste')}
            sx={paletteBtnSx(activeTool === 'paste', CLIPBOARD_ACCENT)}
          >
            <ContentPasteIcon fontSize="small" />
            <HotkeyBadge label="V" />
          </Button>
        </span>
      </Tooltip>
    </Box>
  );

  // The history group (Undo · Redo) — its own group at the start of the bottom row. Each
  // button disables at the end of its stack; both are pure board-state actions, not tools.
  const renderHistoryGroup = () => (
    <Box
      className="template-editor-tool-group template-editor-tool-group-history"
      sx={{
        display: 'flex', flexDirection: 'row', gap: 0.75, p: 0.75, borderRadius: 1.5,
        backgroundColor: `rgba(${HISTORY_ACCENT},0.14)`,
        border: `1px solid rgba(${HISTORY_ACCENT},0.4)`,
      }}
    >
      <Tooltip title={canUndo ? 'Undo (Z)' : 'Nothing to undo'} placement="top">
        <span>
          <Button
            className="template-editor-tool template-editor-tool-undo"
            variant="outlined"
            size="small"
            disabled={!canUndo}
            onClick={handleUndo}
            sx={paletteBtnSx(false, HISTORY_ACCENT)}
          >
            <UndoIcon fontSize="small" />
            <HotkeyBadge label="Z" />
          </Button>
        </span>
      </Tooltip>
      <Tooltip title={canRedo ? 'Redo (X)' : 'Nothing to redo'} placement="top">
        <span>
          <Button
            className="template-editor-tool template-editor-tool-redo"
            variant="outlined"
            size="small"
            disabled={!canRedo}
            onClick={handleRedo}
            sx={paletteBtnSx(false, HISTORY_ACCENT)}
          >
            <RedoIcon fontSize="small" />
            <HotkeyBadge label="X" />
          </Button>
        </span>
      </Tooltip>
    </Box>
  );

  return (
    <LeafPage title="Template Editor" onBack={() => navigate('/')} className="template-editor-root">
      <Box
        className="template-editor-page"
        sx={{ display: 'flex', flexDirection: 'column', width: '100%', flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}
      >
        {/* Header overlay: title + Clear / Submit / Properties */}
        <Box
          className="template-editor-header"
          sx={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 100%)',
            p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          }}
        >
          <Box className="template-editor-title-block">
            <Typography
              className="template-editor-title" variant="h4" component="h1"
              sx={{ color: 'white', fontWeight: WEIGHT.bold, textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}
            >
              Template Editor
            </Typography>
            <Typography
              className="template-editor-name-line" variant="body2"
              sx={{ color: 'rgba(255,255,255,0.85)', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', mt: 0.5 }}
            >
              {`${name.trim() || 'Untitled'} — ${width}×${height} · v${version}`}
            </Typography>
          </Box>

          <Box className="template-editor-header-actions" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            {/* Version switcher — switches the active (name, version), reloading the target
                from its last saved state (unsaved edits discarded after a warn). Lives here
                (not in Properties) so switching versions is a one-click header action. The
                "New version" button still lives in Properties beside the shared name/size. */}
            <FormControl
              size="small"
              className="template-editor-header-version"
            >
              <Select
                className="template-editor-header-version-select"
                value={version}
                onChange={(e) => handleSwitchVersion(Number(e.target.value))}
                // Rendered to read like the outlined header buttons (headerBtnSx): no
                // floating label, small-button metrics, same border/background/hover.
                renderValue={(v) => `Version ${v}${v === 0 ? ' (base)' : ''}${isNewVersion ? ' • unsaved' : ''}`}
                sx={{
                  color: 'rgba(255,255,255,0.9)',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  fontSize: '0.8125rem',
                  '.MuiSelect-select': { py: '4px', pl: '10px' },
                  '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.5)' },
                  '&:hover': { backgroundColor: 'rgba(0,0,0,0.5)' },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white' },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'white' },
                  '.MuiSvgIcon-root': { color: 'rgba(255,255,255,0.9)' },
                }}
              >
                {availableVersions.map((v) => (
                  <MenuItem key={v} value={v} className="template-editor-header-version-option">
                    {`Version ${v}${v === 0 ? ' (base)' : ''}${isNewVersion && v === version ? ' • unsaved' : ''}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Tooltip title="Authoring guidelines (rules the editor does not enforce)">
              <Button
                className="template-editor-guidelines-btn" variant="outlined" size="small"
                startIcon={<MenuBookIcon />} onClick={() => setGuidelinesOpen(true)}
                sx={headerBtnSx}
              >
                Guidelines
              </Button>
            </Tooltip>
            <Tooltip title="Start a fresh blank template (warns if you have unsaved edits)">
              <Button
                className="template-editor-new-btn" variant="outlined" size="small"
                startIcon={<NoteAddIcon />} onClick={handleNewTemplate}
                sx={headerBtnSx}
              >
                New Template
              </Button>
            </Tooltip>
            {/* Load ↔ Cancel: opening the visual gallery flips this button to Cancel so the
                author can back out of the picker. */}
            {galleryOpen ? (
              <Button
                className="template-editor-load-cancel-btn" variant="outlined" size="small"
                startIcon={<CloseIcon />} onClick={handleCloseGallery}
                sx={headerBtnSx}
              >
                Cancel
              </Button>
            ) : (
              <Button
                className="template-editor-load-btn" variant="outlined" size="small"
                startIcon={<FolderOpenIcon />} onClick={handleOpenGallery}
                sx={headerBtnSx}
              >
                Load
              </Button>
            )}
            <Button
              className="template-editor-clear-btn" variant="outlined" size="small"
              startIcon={<DeleteSweepIcon />} onClick={handleClear}
              sx={headerBtnSx}
            >
              Clear
            </Button>
            <Tooltip
              title={
                !loadedName
                  ? 'Load a template to delete a version'
                  : version === 0
                    ? 'Version 0 is the base — use Delete Template to remove it'
                    : isNewVersion
                      ? `Discard the unsaved version ${version}`
                      : `Delete only version ${version} of this template`
              }
            >
              <span>
                <Button
                  className="template-editor-delete-version-btn" variant="outlined" size="small"
                  startIcon={<LayersClearIcon />} onClick={handleDeleteVersion}
                  disabled={!loadedName || version === 0}
                  sx={{ ...headerBtnSx, color: 'rgba(255,140,140,0.95)', borderColor: 'rgba(255,140,140,0.5)', '&:hover': { borderColor: 'rgb(255,140,140)', backgroundColor: 'rgba(80,0,0,0.4)' } }}
                >
                  Delete Version
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={loadedName ? 'Delete the loaded template (all versions) from the database' : 'Load a template to delete it'}>
              <span>
                <Button
                  className="template-editor-delete-btn" variant="outlined" size="small"
                  startIcon={<DeleteForeverIcon />} onClick={handleDelete} disabled={!loadedName}
                  sx={{ ...headerBtnSx, color: 'rgba(255,140,140,0.95)', borderColor: 'rgba(255,140,140,0.5)', '&:hover': { borderColor: 'rgb(255,140,140)', backgroundColor: 'rgba(80,0,0,0.4)' } }}
                >
                  Delete Template
                </Button>
              </span>
            </Tooltip>
            <Button
              className="template-editor-properties-btn" variant="outlined" size="small"
              startIcon={<TuneIcon />} onClick={() => setPropsOpen(true)}
              sx={headerBtnSx}
            >
              Properties
            </Button>
            <Button
              className="template-editor-submit-btn" variant="contained" size="small"
              startIcon={<SaveIcon />} onClick={handleSubmit} disabled={submitting}
              sx={{ ...headerBtnSx, color: 'black', backgroundColor: 'rgba(255,224,102,0.95)', '&:hover': { backgroundColor: 'rgba(255,224,102,1)' } }}
            >
              Save
            </Button>
          </Box>
        </Box>

        {/* Left tool palette + grid toggle — hidden while the Load gallery overlays the canvas. */}
        {!galleryOpen && (
        <Box
          className="template-editor-tool-palette"
          // alignItems:flex-start so each group/row box shrinks to fit its own buttons
          // rather than stretching to the width of the widest group.
          sx={{ position: 'absolute', top: 96, left: 16, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}
        >
          {/* Row 1 (top) — view controls: gridlines toggle (own group) beside the mask-view
              toggles (own group). Hotkeys read left-to-right along the number row: ` grid,
              then 1/2/3/4 in the same order as the mask paint tools below (street, communal,
              placeholder, condition) and REUSING their icons. Each mask-view toggle stays
              clickable and reflects its OWN independent show* state; while its paint tool is
              active the layer is force-shown (see the show* || activeTool props on the viewer
              below), which overrides — but does not mutate — the toggle. */}
          <Box className="template-editor-tool-row" sx={{ display: 'flex', gap: 1 }}>
            <Box
              className="template-editor-tool-group template-editor-tool-group-grid"
              sx={{
                display: 'flex', flexDirection: 'row', gap: 0.75, p: 0.75, borderRadius: 1.5,
                backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              <Tooltip title="Toggle gridlines (`)" placement="top">
                <Button
                  className="template-editor-grid-toggle"
                  variant={showGrid ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => setShowGrid(v => !v)}
                  sx={paletteBtnSx(showGrid)}
                >
                  <GridOnIcon fontSize="small" />
                  <HotkeyBadge label="`" />
                </Button>
              </Tooltip>
            </Box>
            <Box
              className="template-editor-tool-group template-editor-tool-group-mask-view"
              sx={{
                display: 'flex', flexDirection: 'row', gap: 0.75, p: 0.75, borderRadius: 1.5,
                backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              <Tooltip
                title={
                  activeTool === 'street'
                    ? 'Toggle street-walkable highlight (1) — layer auto-shown while the street tool is active'
                    : 'Toggle street-walkable highlight (1)'
                }
                placement="top"
              >
                <span>
                  <Button
                    className="template-editor-street-toggle"
                    variant={showStreet ? 'contained' : 'outlined'}
                    size="small"
                    onClick={() => setShowStreet(v => !v)}
                    sx={paletteBtnSx(showStreet)}
                  >
                    <RouteIcon fontSize="small" />
                    <HotkeyBadge label="1" />
                  </Button>
                </span>
              </Tooltip>
              <Tooltip
                title={
                  activeTool === 'communal'
                    ? 'Toggle communal-walkable highlight (2) — layer auto-shown while the communal tool is active'
                    : 'Toggle communal-walkable highlight (2)'
                }
                placement="top"
              >
                <span>
                  <Button
                    className="template-editor-communal-toggle"
                    variant={showCommunal ? 'contained' : 'outlined'}
                    size="small"
                    onClick={() => setShowCommunal(v => !v)}
                    sx={paletteBtnSx(showCommunal)}
                  >
                    <GroupsIcon fontSize="small" />
                    <HotkeyBadge label="2" />
                  </Button>
                </span>
              </Tooltip>
              <Tooltip
                title={
                  activeTool === 'placeholder'
                    ? 'Toggle placeholder-area highlight (3) — layer auto-shown while the placeholder tool is active'
                    : 'Toggle placeholder-area highlight (3)'
                }
                placement="top"
              >
                <span>
                  <Button
                    className="template-editor-placeholder-toggle"
                    variant={showPlaceholder ? 'contained' : 'outlined'}
                    size="small"
                    onClick={() => setShowPlaceholder(v => !v)}
                    sx={paletteBtnSx(showPlaceholder)}
                  >
                    <HighlightAltIcon fontSize="small" />
                    <HotkeyBadge label="3" />
                  </Button>
                </span>
              </Tooltip>
              <Tooltip
                title={
                  <>
                    {activeTool === 'condition'
                      ? 'Toggle condition-mask highlight (4) — layer auto-shown while the condition tool is active'
                      : 'Toggle condition-mask highlight (4)'}
                    {version > 0 && (
                      <Box component="span" sx={{ display: 'block', mt: 0.5, opacity: 0.85 }}>
                        {conditionInfo.total} condition{conditionInfo.total === 1 ? '' : 's'} on this
                        version — {conditionInfo.placeholder} placeholder,{' '}
                        {conditionInfo.borderStreet} border-street (auto-added at save)
                      </Box>
                    )}
                  </>
                }
                placement="top"
              >
                <span>
                  <Button
                    className="template-editor-condition-toggle"
                    variant={showCondition ? 'contained' : 'outlined'}
                    size="small"
                    onClick={() => setShowCondition(v => !v)}
                    sx={paletteBtnSx(showCondition)}
                  >
                    <RuleIcon fontSize="small" />
                    <HotkeyBadge label="4" />
                  </Button>
                </span>
              </Tooltip>
            </Box>
          </Box>

          {/* Row 2 (top letter row) — mask paint tools (Q/W/E/R), directly below the mask-view
              toggles that reveal them, with the terrain tools (T/Y) continuing the same row to
              their right. Both groups paint via the two-click rectangle selection. */}
          <Box className="template-editor-tool-row" sx={{ display: 'flex', gap: 1 }}>
            {renderToolGroup(masksGroup)}
            {renderToolGroup(terrainGroup)}
          </Box>

          {/* Row 3 (home row) — decor tools (S/D/F/G). */}
          {renderToolGroup(decorGroup)}

          {/* Row 4 (bottom keyboard row Z X C V B) — history (Undo Z · Redo X) at the start,
              then the clipboard tools (Copy C · Paste V), then the ERASER modifier (B). The
              eraser is a persistent toggle layered on top of the selected tool (while on,
              painting erases only that tool's own layer), so it keeps its own red group. */}
          <Box className="template-editor-tool-row" sx={{ display: 'flex', gap: 1 }}>
            {renderHistoryGroup()}
            {renderClipboardGroup()}
            <Box
              className="template-editor-tool-group template-editor-tool-group-erase"
              sx={{
                display: 'flex', flexDirection: 'row', gap: 0.75, p: 0.75, borderRadius: 1.5,
                backgroundColor: 'rgba(255,140,140,0.14)', border: '1px solid rgba(255,140,140,0.4)',
              }}
            >
              <Tooltip
                // Disabled for tools that can't be erased (copy/paste); its own layer-removal
                // has no meaning there. A <span> wrapper lets the tooltip show while disabled.
                title={toolSupportsEraser(activeTool)
                  ? `Eraser — removes only the selected tool's layer (B)${eraseMode ? ' · ON' : ''}`
                  : 'The eraser does not apply to the copy/paste tools'}
                placement="top"
              >
                <span>
                  <Button
                    className="template-editor-erase-toggle"
                    variant={eraseMode ? 'contained' : 'outlined'}
                    size="small"
                    disabled={!toolSupportsEraser(activeTool)}
                    onClick={() => setEraseMode(v => !v)}
                    sx={paletteBtnSx(eraseMode, '255,140,140')}
                  >
                    <BackspaceIcon fontSize="small" />
                    <HotkeyBadge label="B" />
                  </Button>
                </span>
              </Tooltip>
            </Box>
          </Box>
        </Box>
        )}

        {/* Pixi canvas */}
        <Box className="template-editor-canvas-container" sx={{ flexGrow: 1, width: '100%', height: '100%', position: 'relative' }}>
          <TemplateEditorViewer
            width={width}
            height={height}
            masks={masks}
            showGrid={showGrid}
            // Force each highlight on while painting its layer; otherwise honor the toggle.
            showStreet={showStreet || activeTool === 'street'}
            showCommunal={showCommunal || activeTool === 'communal'}
            showPlaceholder={showPlaceholder || activeTool === 'placeholder'}
            showCondition={showCondition || activeTool === 'condition'}
            activeTool={activeTool}
            // Drives the placeholder DROP ghost's size (4×5 / 5×4 / 4×10 / 10×4 — Space cycles it).
            placeholderSize={PLACEHOLDER_SIZES[placeholderSizeIdx]}
            // Drive the decor GHOST: the active decor tool's category (null for non-decor tools)
            // + the selected variant index (Space cycles it). The viewer resolves the sprite for
            // the hovered cell's surface and previews it before the click.
            decorCategory={DECOR_TOOL_CATEGORY[activeTool] ?? null}
            decorVariantIdx={decorVariantIdx}
            // The street/communal walkability tools, the terrain tools, the wood-panel (plank)
            // decor tool, AND the copy tool select by press-drag-release rectangle; the parent
            // decides what the finished rectangle means (fill the mask, fill terrain, tile planks,
            // or capture the region for copy). The OTHER decor tools drag-paint instead, and
            // placeholder is a fixed-size footprint DROP, not a rectangle.
            rectangleMode={
              activeTool === 'street' || activeTool === 'communal' ||
              activeTool === 'terrain1' || activeTool === 'terrain2' ||
              activeTool === 'plankDecor' || activeTool === 'copy'
            }
            onRectComplete={handleRectComplete}
            // Paste stamps the clipboard as a footprint (like the placeholder drop).
            pasteMode={activeTool === 'paste' && !!clipboard}
            pasteFootprint={clipboard ? { w: clipboard.w, h: clipboard.h } : null}
            onPasteAt={pasteAt}
            eraseMode={eraseMode}
            onPaintCell={paintCell}
            // Snapshot the pre-stroke board so a whole drag-paint is one undo step.
            onEditBegin={pushHistory}
          />

          {/* Load GALLERY overlay — the visual template picker. Covers the canvas (below the
              header, whose Load↔Cancel button stays reachable) while open. Shows a loading /
              empty state until the fetched entries arrive; picking one loads it and closes. */}
          {galleryOpen && (
            <Box
              className="template-editor-gallery-overlay"
              sx={{
                position: 'absolute', inset: 0, zIndex: 6,
                backgroundColor: 'rgba(12,16,24,0.82)',
                display: 'flex', flexDirection: 'column',
              }}
            >
              {galleryEntries === null ? (
                <Box
                  className="template-editor-gallery-status"
                  sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.8)' }}
                >
                  <Typography>Loading templates…</Typography>
                </Box>
              ) : galleryEntries.length === 0 ? (
                <Box
                  className="template-editor-gallery-status"
                  sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.8)' }}
                >
                  <Typography>No templates yet</Typography>
                </Box>
              ) : (
                // Pad the top so the first row clears the translucent header.
                <Box sx={{ flex: 1, minHeight: 0, pt: '84px' }}>
                  <TemplateLoadGallery entries={galleryEntries} onPick={handlePickTemplate} />
                </Box>
              )}
            </Box>
          )}
        </Box>

        <PropertiesDialog
          open={propsOpen}
          initialWidth={width}
          initialHeight={height}
          initialName={name}
          initialDescription={description}
          loadedName={loadedName}
          currentVersion={version}
          availableVersions={availableVersions}
          // New versions require a saved template (v0 on the server) and no pending edits.
          canAddVersion={loadedName === name.trim() && !!name.trim() && !dirty}
          onNewVersion={() => { setPropsOpen(false); handleNewVersion(); }}
          onCancel={() => setPropsOpen(false)}
          onApply={(w, h, nm, desc, resetBoard) => {
            setWidth(w);
            setHeight(h);
            setName(nm);
            setDescription(desc);
            // Only a dimension change regenerates the board; a name-only edit keeps
            // the painting (the dialog has already confirmed the reset with the user).
            if (resetBoard) { setMasks(emptyMasks()); resetHistory(); } // new board → drop history
            setDirty(true);
            setPropsOpen(false);
          }}
        />

        <GuidelinesDialog open={guidelinesOpen} onClose={() => setGuidelinesOpen(false)} />

        <Snackbar
          className="template-editor-snackbar"
          open={snack.open}
          autoHideDuration={4000}
          onClose={() => setSnack(s => ({ ...s, open: false }))}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>
            {snack.msg}
          </Alert>
        </Snackbar>
      </Box>
    </LeafPage>
  );
}

// ─── Guidelines dialog ───────────────────────────────────────────────────────────
// A read-only reference popup listing the template AUTHORING rules that the editor does
// NOT programmatically enforce — the author must honor them by hand. Purely informational
// (no state, no side effects); opened from the header's Guidelines button. Keep this copy
// in sync with docs/NIGHT_MARKET_TEMPLATE_EDITOR.md when the rules change.
const AUTHORING_GUIDELINES: string[] = [
  'Only streets of width 3 or 6 may touch the edge of the template. Streets of other widths can still be placed within the interior.',
  'The maximum street width is 6.',
  'Streets may only begin at a red gridline. Streets are referenced from the north and east faces, so the red lattice is counted inward from those two edges.',
  'All streets on a template must be contiguous — every street cell reachable from every other by street cells alone. No detached street islands. This holds per version, since each version paints its own street mask.',
];

function GuidelinesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog className="template-editor-guidelines-dialog" open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Template Authoring Guidelines</DialogTitle>
      <DialogContent>
        <Typography
          className="template-editor-guidelines-intro" variant="body2"
          sx={{ color: 'text.secondary', mb: 1.5 }}
        >
          These rules are not enforced by the editor — follow them by hand while authoring.
        </Typography>
        <Box
          component="ol"
          className="template-editor-guidelines-list"
          sx={{ m: 0, pl: 3, display: 'flex', flexDirection: 'column', gap: 1.25 }}
        >
          {AUTHORING_GUIDELINES.map((rule, i) => (
            <Typography
              key={i}
              component="li"
              className="template-editor-guideline-item"
              variant="body2"
              sx={{ lineHeight: 1.5 }}
            >
              {rule}
            </Typography>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button className="template-editor-guidelines-close" onClick={onClose} variant="contained">
          Got it
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Properties dialog ───────────────────────────────────────────────────────────
// Sets width/height/name + the active VERSION. OK validates dims, checks name
// availability (server), and on success applies + regenerates the board. A taken name
// blocks with an inline error. The "New version" button adds a version immediately (not
// gated behind OK); version SWITCHING lives in the header. Name is locked once a template has more
// than one version (renaming would orphan the others); dimensions are locked on any
// version above 0 (all versions of a name share the base board size).
function PropertiesDialog({
  open, initialWidth, initialHeight, initialName, initialDescription, loadedName,
  currentVersion, availableVersions, canAddVersion,
  onNewVersion, onApply, onCancel,
}: {
  open: boolean;
  initialWidth: number;
  initialHeight: number;
  initialName: string;
  /** The shared per-name description (from version 0), '' if none. */
  initialDescription: string;
  /** The currently loaded/saved template name — the one existing name the rename gate
   *  permits (so overwriting requires a deliberate load), or null if none. */
  loadedName: string | null;
  /** The active version number (0 = base). */
  currentVersion: number;
  /** All version numbers for this name — drives the name/dims/description locks. */
  availableVersions: number[];
  /** Whether "New version" is allowed right now (template saved + no pending edits). */
  canAddVersion: boolean;
  /** Create a new version copying the current board. */
  onNewVersion: () => void;
  onApply: (width: number, height: number, name: string, description: string, resetBoard: boolean) => void;
  onCancel: () => void;
}) {
  const { confirm } = useConfirmation();
  const [w, setW] = useState(String(initialWidth));
  const [h, setH] = useState(String(initialHeight));
  const [nm, setNm] = useState(initialName);
  const [desc, setDesc] = useState(initialDescription);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // Name is locked once the template has multiple versions (a rename hits only the
  // active version's row, orphaning the rest); dims + description are locked above
  // version 0 (both are shared per name, owned by version 0).
  const nameLocked = availableVersions.length > 1;
  const dimsLocked = currentVersion !== 0;
  const descLocked = currentVersion !== 0;

  // The dropdown option lists. A template saved with a legacy size not in DIM_OPTIONS
  // (older free-entry board) must still show its value rather than render a blank Select
  // (which also triggers an out-of-range MUI warning), so fold the current draft value in
  // and re-sort. New picks are always from DIM_OPTIONS.
  const withCurrent = (n: number): number[] =>
    (DIM_OPTIONS.includes(n) ? DIM_OPTIONS : [...DIM_OPTIONS, n].sort((a, b) => a - b));
  const widthOptions = withCurrent(Number(w));
  const heightOptions = withCurrent(Number(h));

  // Re-seed the draft fields each time the dialog opens.
  useEffect(() => {
    if (open) {
      setW(String(initialWidth));
      setH(String(initialHeight));
      setNm(initialName);
      setDesc(initialDescription);
      setError(null);
    }
  }, [open, initialWidth, initialHeight, initialName, initialDescription]);

  // When the dialog opens for a FRESH (unnamed) template, pre-fill the name field with a
  // server-suggested free default ("template{index}"). Skipped when the template already
  // has a name (e.g. a loaded one) so we never clobber it. Only fills if the field is
  // still empty when the request resolves (the author may have typed meanwhile); a failed
  // suggest is non-fatal — the field just stays blank. `cancelled` guards a late resolve
  // after the dialog closes.
  useEffect(() => {
    if (!open || initialName.trim()) return;
    let cancelled = false;
    suggestTemplateName()
      .then((suggested) => { if (!cancelled) setNm((cur) => (cur.trim() ? cur : suggested)); })
      .catch(() => { /* leave the field blank; the author can type a name */ });
    return () => { cancelled = true; };
  }, [open, initialName]);

  const handleOk = async () => {
    const wi = Number(w);
    const hi = Number(h);
    if (!Number.isInteger(wi) || !Number.isInteger(hi) || wi < MIN_DIM || hi < MIN_DIM || wi > MAX_DIM || hi > MAX_DIM) {
      setError(`Width and height must be integers between ${MIN_DIM} and ${MAX_DIM}`);
      return;
    }
    const trimmed = nm.trim();
    if (!trimmed) {
      setError('Template name is required');
      return;
    }
    setChecking(true);
    setError(null);
    try {
      // Rename gate — the accidental-overwrite guard: a name must be free, EXCEPT the
      // currently loaded template's own name (editing it in place is legitimate). This
      // is why Submit can only overwrite a template that was deliberately loaded.
      if (trimmed !== loadedName) {
        const available = await checkTemplateNameAvailable(trimmed);
        if (!available) {
          setError(`A template named "${trimmed}" already exists — load it to edit it`);
          return;
        }
      }
      // A dimension change regenerates (clears) the board; a name-only edit does not.
      // Warn + confirm before discarding painted cells; keep the dialog open on cancel.
      const dimsChanged = wi !== initialWidth || hi !== initialHeight;
      if (dimsChanged) {
        const ok = await confirm(
          'Changing the width or height regenerates the board — all painted cells (grass, streets, and decor) will be cleared. Continue?',
          { title: 'Reset the board?', confirmText: 'Reset board', cancelText: 'Keep editing' },
        );
        if (!ok) return;
      }
      onApply(wi, hi, trimmed, desc.trim(), dimsChanged);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Name check failed');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog className="template-editor-properties-dialog" open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>Template Properties</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {/* "New version" copies the current board into the next version number. The
              version SWITCHER now lives in the header (one-click); this button stays here
              beside the shared per-name name/size it depends on. */}
          <Box className="template-editor-version-row" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Tooltip title={canAddVersion ? 'Create a new version copying this board' : 'Save this version first to add another'}>
              <span>
                <Button
                  className="template-editor-new-version-btn"
                  variant="outlined" size="small" startIcon={<AddIcon />}
                  disabled={!canAddVersion} onClick={onNewVersion}
                >
                  New version
                </Button>
              </span>
            </Tooltip>
          </Box>

          <TextField
            className="template-editor-name-field" label="Template name" value={nm}
            onChange={(e) => setNm(e.target.value)} fullWidth autoFocus={!nameLocked}
            disabled={nameLocked}
            helperText={nameLocked ? 'Renaming is disabled while a template has multiple versions' : undefined}
          />
          <TextField
            className="template-editor-description-field" label="Description (optional)" value={desc}
            onChange={(e) => setDesc(e.target.value)} fullWidth multiline minRows={2} maxRows={5}
            disabled={descLocked} inputProps={{ maxLength: 500 }}
            helperText={descLocked
              ? 'Description is set on version 0 and shared by every version.'
              : 'Shown in the Load menu. Shared across all versions of this template.'}
          />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <FormControl size="small" fullWidth disabled={dimsLocked}>
              <InputLabel id="template-editor-width-label">Width (cols)</InputLabel>
              <Select
                labelId="template-editor-width-label"
                className="template-editor-width-field" label="Width (cols)" value={w}
                onChange={(e) => setW(String(e.target.value))}
              >
                {widthOptions.map((d) => (
                  <MenuItem key={d} value={String(d)} className="template-editor-width-option">{d}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth disabled={dimsLocked}>
              <InputLabel id="template-editor-height-label">Length (rows)</InputLabel>
              <Select
                labelId="template-editor-height-label"
                className="template-editor-height-field" label="Length (rows)" value={h}
                onChange={(e) => setH(String(e.target.value))}
              >
                {heightOptions.map((d) => (
                  <MenuItem key={d} value={String(d)} className="template-editor-height-option">{d}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {dimsLocked
              ? 'Board size is set on version 0 and shared by every version.'
              : 'Changing width or height regenerates the board (painted cells are cleared, after a confirmation). Changing only the name keeps your painting.'}
          </Typography>
          {error && <Alert severity="error" className="template-editor-properties-error">{error}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button className="template-editor-properties-cancel" onClick={onCancel} disabled={checking}>Cancel</Button>
        <Button className="template-editor-properties-ok" onClick={handleOk} variant="contained" disabled={checking}>
          {checking ? 'Checking…' : 'OK'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default TemplateEditorPage;
