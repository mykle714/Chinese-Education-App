import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Tooltip, Snackbar, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Menu, MenuItem, ListItemText, FormControl, InputLabel, Select,
} from '@mui/material';
import GrassIcon from '@mui/icons-material/Grass';
import ParkIcon from '@mui/icons-material/Park';
import RouteIcon from '@mui/icons-material/Route';
import GroupsIcon from '@mui/icons-material/Groups';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import RuleIcon from '@mui/icons-material/Rule';
import HouseIcon from '@mui/icons-material/House';
import LocalFloristIcon from '@mui/icons-material/LocalFlorist';
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot';
import ForestIcon from '@mui/icons-material/Forest';
import BackspaceIcon from '@mui/icons-material/Backspace';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import GridOnIcon from '@mui/icons-material/GridOn';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import FilterHdrIcon from '@mui/icons-material/FilterHdr';
import AddIcon from '@mui/icons-material/Add';
import TuneIcon from '@mui/icons-material/Tune';
import SaveIcon from '@mui/icons-material/Save';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import LeafPage from '../../components/LeafPage';
import { WEIGHT } from '../../theme/scale';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useAuth } from '../../AuthContext';
import { useConfirmation } from '../../contexts/ConfirmationContext';
import type { EditorMasks, DecorCategory } from '../../engine/market/farmTerrain';
import { editorSurfaceAt, editorDecorRotation, isBlockingDecorUrl } from '../../engine/market/farmTerrain';
import {
  houseFootprintCells, houseFits, houseOccupiedCells, houseAnchorCovering,
} from '../../engine/market/house';
import TemplateEditorViewer, { type EditorTool } from './TemplateEditorViewer';
import {
  checkTemplateNameAvailable, submitTemplate,
  listTemplates, loadTemplate, definitionToMasks, deleteTemplate,
  type TemplateSummary,
} from './templateEditorApi';

/**
 * TemplateEditorPage — validator-only Night Market template authoring surface
 * (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md). Desktop-only.
 *
 * Owns the painted mask layers (light/dark grass, street, communal, placeholder,
 * condition, houses, decor) + board size + name + the active VERSION. The header
 * carries Load / Clear / Delete / Properties / Save; a left tool palette selects the
 * active painter (+ grid/communal/placeholder/condition view toggles). The Properties
 * popup sets W×H + name and hosts the version dropdown + "New version" button.
 *
 * VERSIONS: one name owns numbered versions sharing a board size + a single
 * placeholder layout (owned by version 0; its tool/eraser are locked on higher
 * versions) but differing in terrain / streets / decor / the condition mask. Switching
 * versions RELOADS the target from the last saved state (unsaved edits are discarded
 * after a warn); "New version" copies the current board into the next version number.
 * Save upserts the active (name, version); Delete removes the whole name (all versions).
 */

const MIN_DIM = 2;
const MAX_DIM = 60;
const DEFAULT_DIM = 12;

const emptyMasks = (): EditorMasks => ({
  lightGrass: new Set<string>(),
  darkGrass: new Set<string>(),
  street: new Set<string>(),
  communal: new Set<string>(),
  placeholder: new Set<string>(),
  condition: new Set<string>(),
  houses: new Set<string>(),
  decor: new Map<string, string>(),
});

/** `hotkey` is the single keyboard character that activates this tool (shown as a corner
 *  badge on the button and appended to its tooltip). See HOTKEY_TO_TOOL + the keydown
 *  effect, which is the authoritative dispatch and must stay in sync with these. */
interface ToolDef { tool: EditorTool; label: string; icon: React.ReactNode; hotkey: string; }
/** A color-coded palette group. `accent` is an "r,g,b" triplet reused for the group's
 *  panel tint AND the active-tool highlight of every button in the group. */
interface ToolGroup { key: string; accent: string; tools: ToolDef[]; }

/**
 * The paint palette, split into color-coded groups (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md):
 *   - terrain — light/dark grass + street (green),
 *   - masks   — communal + placeholder annotation layers (violet),
 *   - decor   — surface / common / tree decor + the house stamp (amber),
 *   - erase   — a standalone one-button group (red).
 * Each group's `accent` tints its panel background/border (so buttons read as grouped
 * even when idle) and colors the active-tool highlight (so a lit button still reads as
 * belonging to its group).
 */
const TOOL_GROUPS: ToolGroup[] = [
  {
    key: 'terrain', accent: '132,204,120',
    tools: [
      { tool: 'lightGrass', label: 'Light grass', icon: <GrassIcon fontSize="small" />, hotkey: 'Q' },
      { tool: 'darkGrass', label: 'Dark grass (renders over light)', icon: <ParkIcon fontSize="small" />, hotkey: 'W' },
      { tool: 'street', label: 'Street (plank mask)', icon: <RouteIcon fontSize="small" />, hotkey: 'E' },
    ],
  },
  {
    key: 'masks', accent: '168,132,255',
    tools: [
      { tool: 'communal', label: 'Communal', icon: <GroupsIcon fontSize="small" />, hotkey: 'A' },
      { tool: 'placeholder', label: 'Placeholder (version 0 only)', icon: <HighlightAltIcon fontSize="small" />, hotkey: 'S' },
      { tool: 'condition', label: 'Condition mask (per version)', icon: <RuleIcon fontSize="small" />, hotkey: 'D' },
    ],
  },
  {
    key: 'decor', accent: '255,183,77',
    tools: [
      { tool: 'house', label: 'House (4×5 footprint)', icon: <HouseIcon fontSize="small" />, hotkey: 'Z' },
      { tool: 'familyDecor', label: 'Surface decor (tap to cycle)', icon: <LocalFloristIcon fontSize="small" />, hotkey: 'X' },
      { tool: 'commonDecor', label: 'Common decor (tap to cycle)', icon: <ScatterPlotIcon fontSize="small" />, hotkey: 'C' },
      { tool: 'treeDecor', label: 'Trees (tap to cycle)', icon: <ForestIcon fontSize="small" />, hotkey: 'V' },
    ],
  },
  {
    key: 'erase', accent: '255,140,140',
    tools: [
      { tool: 'erase', label: 'Erase (top layer)', icon: <BackspaceIcon fontSize="small" />, hotkey: 'Space' },
    ],
  },
];

// Keyboard → tool dispatch. The authoritative source is this map; the per-tool `hotkey`
// badges above are the display mirror and must match. Keys are compared lower-case;
// Space (erase) is matched by the literal ' ' event.key. The two version-gated tools are
// gated in the keydown handler (mirroring their disabled tool buttons): placeholder ('s')
// is version-0-only, condition ('d') is versions-above-0-only.
const HOTKEY_TO_TOOL: Record<string, EditorTool> = {
  q: 'lightGrass', w: 'darkGrass', e: 'street',
  a: 'communal', s: 'placeholder', d: 'condition',
  z: 'house', x: 'familyDecor', c: 'commonDecor', v: 'treeDecor',
  ' ': 'erase',
};

function TemplateEditorPage() {
  usePageTitle('Template Editor');
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { confirm } = useConfirmation();

  // Validator-only surface. Once auth resolves, bounce non-validators to Home.
  // (The backend also enforces validator on every endpoint — this is UX, not the
  // security boundary.)
  useEffect(() => {
    if (isAuthenticated && user && !user.isValidator) navigate('/', { replace: true });
  }, [isAuthenticated, user, navigate]);

  const [width, setWidth] = useState(DEFAULT_DIM);
  const [height, setHeight] = useState(DEFAULT_DIM);
  const [name, setName] = useState('');
  // Optional, shared-per-name description (authored on version 0; inherited read-only on
  // higher versions). Kept as '' when absent; sent to the server as null when blank.
  const [description, setDescription] = useState('');
  const [masks, setMasks] = useState<EditorMasks>(emptyMasks);
  const [activeTool, setActiveTool] = useState<EditorTool>('lightGrass');
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
  // Persistent toggle for the communal-walkable highlight. The overlay is forced on
  // while the communal TOOL is active (auto-reveal what you're painting); otherwise it
  // honors this setting. The toggle button reflects this persisted value, not the
  // forced-on state.
  const [showCommunal, setShowCommunal] = useState(false);
  // Persistent toggle for the placeholder-area highlight — same forced-on-while-active
  // semantics as showCommunal above.
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  // Persistent toggle for the condition-mask highlight — same forced-on-while-active
  // semantics as showCommunal above.
  const [showCondition, setShowCondition] = useState(false);

  // The template currently loaded / last saved. `loadedName` is the ONE existing name
  // the Properties rename gate permits (so Save can only overwrite a deliberately loaded
  // template, never a name collided into by accident) AND the Delete target. It is the
  // saved name of the CURRENT template (all its versions); null until a load/save.
  const [loadedName, setLoadedName] = useState<string | null>(null);

  const [propsOpen, setPropsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Load dropdown: anchor element + the fetched template summaries.
  const [loadAnchor, setLoadAnchor] = useState<null | HTMLElement>(null);
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
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
  // Latest board dims for the paint callback — the house tool needs them to bounds-check
  // its 4×5 footprint. Kept in refs (like activeToolRef) so paintCell stays identity-stable.
  const widthRef = useRef(width);
  widthRef.current = width;
  const heightRef = useRef(height);
  heightRef.current = height;
  // Latest version for the paint callback — the placeholder tool/eraser are gated to
  // version 0 (placeholder is shared, owned by v0), so paintCell needs the live value.
  const versionRef = useRef(version);
  versionRef.current = version;
  // Latest highlight-toggle values for the erase branch. The eraser must NOT clear a
  // spriteless mask (communal / condition / placeholder) whose tint is toggled off — you
  // can't erase what you can't see. During erase activeTool is 'erase' (never the mask's
  // own tool), so these raw toggle values equal the tint's actual on-screen visibility.
  const showCommunalRef = useRef(showCommunal);
  showCommunalRef.current = showCommunal;
  const showPlaceholderRef = useRef(showPlaceholder);
  showPlaceholderRef.current = showPlaceholder;
  const showConditionRef = useRef(showCondition);
  showConditionRef.current = showCondition;

  // Paint the active tool onto a cell. Functional update → never stale. Light and dark
  // grass are independent masks (dark renders over light only at render time). Erase
  // removes only the TOP-MOST layer present
  // at the cell — visual stacking order decor > street > dark grass > light grass —
  // so clearing a fully-stacked cell takes several erase passes (one per layer).
  const paintCell = useCallback((col: number, row: number) => {
    const k = `${col},${row}`;
    setDirty(true); // any paint stroke makes the board unsaved (harmless on a no-op)
    setMasks(prev => {
      const light = new Set(prev.lightGrass);
      const dark = new Set(prev.darkGrass);
      const street = new Set(prev.street);
      const communal = new Set(prev.communal);
      const placeholder = new Set(prev.placeholder);
      const condition = new Set(prev.condition);
      const houses = new Set(prev.houses);
      const decor = new Map(prev.decor);
      const tool = activeToolRef.current;
      // Cells covered by an already-placed house. Street/decor may NOT overwrite these,
      // and house placement may not overlap them (nor a street).
      const occupied = houseOccupiedCells(houses);

      // Cycle a cell through one decor tool's rotation: first tap places rotation[0],
      // each subsequent tap advances (wrapping). A current decor not in this rotation
      // (a different category / stale surface) → indexOf −1 → restarts at rotation[0],
      // so switching decor tools swaps the sprite to that tool's first entry.
      const cycleDecor = (category: DecorCategory) => {
        if (street.has(k)) return; // no decor slot on a street cell (plank covers it)
        if (occupied.has(k)) return; // decor cannot overwrite a placed house
        const surface = editorSurfaceAt({ lightGrass: light, darkGrass: dark }, col, row);
        const rotation = editorDecorRotation(category, surface);
        if (rotation.length === 0) return;
        const current = decor.get(k);
        const nextIdx = (current ? rotation.indexOf(current) : -1) + 1;
        decor.set(k, rotation[nextIdx % rotation.length]);
        // Common decor and trees are BLOCKING objects — they overwrite the communal
        // class (a park/plaza tile can't hold a tree/prop). Surface (family) decor is
        // flush and may coexist with communal, so it is exempt.
        if (category === 'common' || category === 'tree') communal.delete(k);
      };

      switch (tool) {
        case 'lightGrass': light.add(k); break;
        // Dark grass is an INDEPENDENT mask — it does NOT add light underneath. The
        // "dark renders only over light" rule is applied at render time (buildEditorField
        // intersects dark∩light), so a dark cell with no light simply doesn't render.
        case 'darkGrass': dark.add(k); break;
        case 'street':
          // A street may not overwrite a placed house (house wins once dropped).
          if (occupied.has(k)) break;
          // Streets overwrite decor — a plank fully covers the cell. Street and
          // communal are mutually-exclusive walkability classes, so clear communal.
          street.add(k);
          decor.delete(k);
          communal.delete(k);
          break;
        case 'communal': {
          // Communal-walkable is a walkability annotation (parks/plazas) with no sprite.
          // It can't sit under a BLOCKING object — a placed house, common decor, or a
          // tree — so painting it there is silently REFUSED (no-op), mirroring how the
          // house tool refuses on a blocked cell. (Flush surface-family decor is fine.)
          const blockingDecor = decor.has(k) && isBlockingDecorUrl(decor.get(k)!);
          if (occupied.has(k) || blockingDecor) break;
          // It also can't coexist with the street class, so painting it clears street.
          // A condition may live only on a street/placeholder cell, so if this paint
          // removes the street substrate and the cell isn't also a placeholder, the
          // condition would be orphaned — cascade-clear it too (invariant upkeep).
          communal.add(k);
          if (street.delete(k) && !placeholder.has(k)) condition.delete(k);
          break;
        }
        case 'placeholder':
          // Placeholder areas are an OVERRIDE overlay, not a walkability class, so they
          // may overlap any surface freely — no mutual exclusion. SHARED across versions
          // (owned by version 0), so it is paintable ONLY on version 0; on higher
          // versions the tool button is disabled and this guard is the backstop.
          if (versionRef.current !== 0) break;
          placeholder.add(k);
          break;
        case 'condition':
          // The condition mask is a PER-VERSION override overlay (differs between
          // versions). It is the INVERSE of placeholder's version rule: paintable ONLY on
          // versions > 0 (on version 0 the tool button is disabled and this guard is the
          // backstop). It annotates ONLY a STREET or PLACEHOLDER cell — the two cell kinds
          // whose walkability class can switch between versions — so painting it anywhere
          // else is a silent no-op. (Removing that street/placeholder substrate cascades
          // the condition away; see the communal + erase cases.)
          if (versionRef.current === 0) break;
          if (!street.has(k) && !placeholder.has(k)) break;
          condition.add(k);
          break;
        case 'house': {
          // The hovered cell is the house's FRONT (near) corner; its 4×5 footprint
          // extends +isoX/+isoY. Refuse the whole placement unless every footprint cell
          // is in-bounds and free of a street or another house (streets/houses are not
          // overwritten). On success, the house overwrites decor under its footprint.
          if (!houseFits(col, row, widthRef.current, heightRef.current)) break;
          const footprint = houseFootprintCells(col, row);
          const blocked = footprint.some((c) => street.has(c) || occupied.has(c));
          if (blocked) break;
          houses.add(k);
          // A house overwrites decor AND the communal class under its whole footprint
          // (a park tile can't hold a house).
          for (const c of footprint) { decor.delete(c); communal.delete(c); }
          break;
        }
        case 'familyDecor': cycleDecor('family'); break;
        case 'commonDecor': cycleDecor('common'); break;
        case 'treeDecor': cycleDecor('tree'); break;
        case 'erase': {
          // A house is the top-most object, so erasing ANY of its footprint cells removes
          // the WHOLE house (one pass) before peeling that cell's terrain layers below.
          const houseAnchor = houseAnchorCovering(houses, col, row);
          if (houseAnchor) { houses.delete(houseAnchor); break; }
          // Peel the highest visible layer only; lower layers need another pass. The
          // spriteless annotations (communal, condition, placeholder) are peeled LAST —
          // only once the cell is visually bare — to avoid silently clearing an (often
          // hidden) class. Two extra rules apply here:
          //   • A toggled-OFF spriteless mask is NOT an erase target — you can't erase a
          //     tint you can't see, so the eraser skips a hidden communal/condition/
          //     placeholder and falls through to the next visible layer.
          //   • Erasing a street or placeholder cell cascade-clears any condition on it:
          //     a condition may live only on a street/placeholder cell, so removing its
          //     last substrate must remove the condition too (invariant upkeep).
          // Placeholder is shared/owned by v0, so the eraser NEVER clears it on higher
          // versions (it is inherited, read-only there).
          if (decor.has(k)) decor.delete(k);
          else if (street.has(k)) { street.delete(k); if (!placeholder.has(k)) condition.delete(k); }
          else if (dark.has(k)) dark.delete(k);
          else if (light.has(k)) light.delete(k);
          else if (communal.has(k) && showCommunalRef.current) communal.delete(k);
          else if (condition.has(k) && showConditionRef.current) condition.delete(k);
          else if (versionRef.current === 0 && showPlaceholderRef.current && placeholder.has(k)) {
            placeholder.delete(k);
            condition.delete(k); // cascade (condition is always empty on v0 → safety no-op)
          }
          break;
        }
      }
      return { lightGrass: light, darkGrass: dark, street, communal, placeholder, condition, houses, decor };
    });
  }, []);

  // ── Keyboard hotkeys ────────────────────────────────────────────────────────────
  // Tool select: Q/W/E terrain, A/S/D masks, Z/X/C/V decor, Space erase (HOTKEY_TO_TOOL).
  // View toggles: 1 grid, 2 communal, 3 placeholder, 4 condition. Suppressed while the
  // Properties dialog is open or focus is in a text field, so typing a name never paints.
  // Keyed on [version] so the placeholder gate (v0-only) reads the current version.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Let native/browser shortcuts through; only bare keypresses are hotkeys.
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      // Never hijack typing (Properties name/dimension fields, any editable target).
      const el = e.target as HTMLElement | null;
      if (propsOpen || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) return;

      const key = e.key.toLowerCase();
      // View toggles (utility panel). Mirror the button gating: a toggle whose tool is
      // active is auto-forced-on and its button disabled, so ignore its key then too.
      if (key === '1') { setShowGrid(v => !v); e.preventDefault(); return; }
      if (key === '2') { if (activeTool !== 'communal') setShowCommunal(v => !v); e.preventDefault(); return; }
      if (key === '3') { if (activeTool !== 'placeholder') setShowPlaceholder(v => !v); e.preventDefault(); return; }
      if (key === '4') { if (activeTool !== 'condition') setShowCondition(v => !v); e.preventDefault(); return; }

      const tool = HOTKEY_TO_TOOL[key];
      if (!tool) return;
      // Version-gated tools mirror their disabled tool buttons: placeholder is v0-only,
      // condition is versions-above-0-only (the two are inverses of each other).
      if (tool === 'placeholder' && version !== 0) return;
      if (tool === 'condition' && version === 0) return;
      setActiveTool(tool);
      e.preventDefault(); // stop Space from re-triggering a focused button
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [propsOpen, version, activeTool]);

  // Clear the board. On version 0 this wipes everything (incl. the placeholder it
  // owns); on higher versions the placeholder is inherited/read-only, so it is kept.
  const handleClear = () => {
    setMasks(prev => (version === 0
      ? emptyMasks()
      : { ...emptyMasks(), placeholder: new Set(prev.placeholder) }));
    setDirty(true);
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
    if (tpl.version !== 0 && activeTool === 'placeholder') setActiveTool('lightGrass');
    if (tpl.version === 0 && activeTool === 'condition') setActiveTool('lightGrass');
  };

  // Open the Load dropdown, fetching the template list fresh each time it opens.
  const handleOpenLoad = async (anchor: HTMLElement) => {
    setLoadAnchor(anchor);
    setTemplates(null); // show a loading item until the fetch resolves
    try {
      setTemplates(await listTemplates());
    } catch (err) {
      setLoadAnchor(null);
      setSnack({ open: true, msg: err instanceof Error ? err.message : 'Failed to list templates', severity: 'error' });
    }
  };

  // Load a chosen template (version 0) into the editor. Warns first if the current
  // board has unsaved edits. Marks it as the loaded template so the rename gate will
  // permit a Save that overwrites it.
  const handleLoad = async (summary: TemplateSummary) => {
    setLoadAnchor(null);
    if (dirty) {
      const ok = await confirm(
        `Loading "${summary.name}" replaces the current board — any unsaved edits will be lost. Continue?`,
        { title: 'Load template?', confirmText: 'Load', cancelText: 'Keep editing' },
      );
      if (!ok) return;
    }
    try {
      const tpl = await loadTemplate(summary.name, 0);
      applyLoadedVersion(tpl);
      setSnack({ open: true, msg: `Loaded "${tpl.name}"`, severity: 'success' });
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
    if (activeTool === 'placeholder') setActiveTool('lightGrass');
    setSnack({ open: true, msg: `New version ${next} (copied) — Save to keep it`, severity: 'success' });
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setSnack({ open: true, msg: 'Set a template name in Properties first', severity: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      const { overwritten } = await submitTemplate({
        name: name.trim(), version, width, height, description: description.trim() || null, masks,
      });
      // A successful save makes this the loaded template — subsequent saves overwrite it,
      // the rename gate now permits its name, and Delete now targets it.
      setLoadedName(name.trim());
      setIsNewVersion(false);
      setDirty(false);
      setAvailableVersions(vs => (vs.includes(version) ? vs : [...vs, version].sort((a, b) => a - b)));
      setSnack({
        open: true,
        msg: overwritten ? `Saved version ${version} of "${name.trim()}"` : `Created version ${version} of "${name.trim()}"`,
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
              {name.trim() ? `${name.trim()} — ${width}×${height}` : `Untitled — ${width}×${height}`}
            </Typography>
          </Box>

          <Box className="template-editor-header-actions" sx={{ display: 'flex', gap: 1 }}>
            <Button
              className="template-editor-load-btn" variant="outlined" size="small"
              startIcon={<FolderOpenIcon />} onClick={(e) => handleOpenLoad(e.currentTarget)}
              sx={headerBtnSx}
            >
              Load
            </Button>
            <Button
              className="template-editor-clear-btn" variant="outlined" size="small"
              startIcon={<DeleteSweepIcon />} onClick={handleClear}
              sx={headerBtnSx}
            >
              Clear
            </Button>
            <Tooltip title={loadedName ? 'Delete the loaded template (all versions) from the database' : 'Load a template to delete it'}>
              <span>
                <Button
                  className="template-editor-delete-btn" variant="outlined" size="small"
                  startIcon={<DeleteForeverIcon />} onClick={handleDelete} disabled={!loadedName}
                  sx={{ ...headerBtnSx, color: 'rgba(255,140,140,0.95)', borderColor: 'rgba(255,140,140,0.5)', '&:hover': { borderColor: 'rgb(255,140,140)', backgroundColor: 'rgba(80,0,0,0.4)' } }}
                >
                  Delete
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

          {/* Load dropdown — template names (name-ordered). Selecting one loads it. */}
          <Menu
            className="template-editor-load-menu"
            anchorEl={loadAnchor}
            open={Boolean(loadAnchor)}
            onClose={() => setLoadAnchor(null)}
          >
            {templates === null && (
              <MenuItem disabled className="template-editor-load-loading">Loading…</MenuItem>
            )}
            {templates !== null && templates.length === 0 && (
              <MenuItem disabled className="template-editor-load-empty">No templates yet</MenuItem>
            )}
            {templates?.map((t) => (
              <MenuItem
                key={t.name}
                className="template-editor-load-item"
                onClick={() => handleLoad(t)}
                sx={{ maxWidth: 360, whiteSpace: 'normal', alignItems: 'flex-start' }}
              >
                <ListItemText
                  primary={t.name}
                  // Multi-line secondary (meta line + optional description) → render in a
                  // div so we don't nest block spans inside the default <p>.
                  secondaryTypographyProps={{ component: 'div' }}
                  secondary={
                    <>
                      <Box component="span" className="template-editor-load-meta" sx={{ display: 'block' }}>
                        {`${t.width}×${t.height} · ${t.versionCount} version${t.versionCount === 1 ? '' : 's'}`}
                        {t.author ? ` · by ${t.author}` : ''}
                      </Box>
                      {t.description && (
                        <Box
                          component="span"
                          className="template-editor-load-description"
                          sx={{ display: 'block', mt: 0.25, fontStyle: 'italic', opacity: 0.85 }}
                        >
                          {t.description}
                        </Box>
                      )}
                    </>
                  }
                />
              </MenuItem>
            ))}
          </Menu>
        </Box>

        {/* Left tool palette + grid toggle */}
        <Box
          className="template-editor-tool-palette"
          sx={{ position: 'absolute', top: 96, left: 16, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          {/* Color-coded tool groups: each panel's accent tints its background/border
              and the active-tool highlight of its buttons (see TOOL_GROUPS). */}
          {TOOL_GROUPS.map(({ key, accent, tools }) => (
            <Box
              key={key}
              className={`template-editor-tool-group template-editor-tool-group-${key}`}
              sx={{
                display: 'flex', flexDirection: 'column', gap: 0.75, p: 0.75, borderRadius: 1.5,
                backgroundColor: `rgba(${accent},0.14)`,
                border: `1px solid rgba(${accent},0.4)`,
              }}
            >
              {tools.map(({ tool, label, icon, hotkey }) => {
                // Version-gated tools (inverse of each other): placeholder is shared/owned
                // by version 0, so it's disabled on higher versions (inherited, read-only);
                // condition is a per-version overlay, so it's disabled on version 0 (the
                // base carries none). See handleNewVersion + the server-side guards.
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
                    title={disabled ? disabledReason : `${label} (${hotkey})`}
                    placement="right"
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
          ))}
          {/* Utility panel (neutral tint): gridlines + the communal/placeholder view
              toggles — these are visibility controls, not paint tools, so they sit
              apart from the color-coded tool groups above. */}
          <Box
            className="template-editor-tool-group template-editor-tool-group-view"
            sx={{
              display: 'flex', flexDirection: 'column', gap: 0.75, p: 0.75, borderRadius: 1.5,
              backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)',
            }}
          >
          <Tooltip title="Toggle gridlines (1)" placement="right">
            <Button
              className="template-editor-grid-toggle"
              variant={showGrid ? 'contained' : 'outlined'}
              size="small"
              onClick={() => setShowGrid(v => !v)}
              sx={paletteBtnSx(showGrid)}
            >
              <GridOnIcon fontSize="small" />
              <HotkeyBadge label="1" />
            </Button>
          </Tooltip>
          <Tooltip
            title={
              activeTool === 'communal'
                ? 'Communal highlight (auto-shown while the communal tool is active)'
                : 'Toggle communal-walkable highlight (2)'
            }
            placement="right"
          >
            {/* Persistent view toggle for the communal tint. Forced on (and disabled)
                while the communal tool is active, so the button always reflects what is
                actually shown. */}
            <span>
              <Button
                className="template-editor-communal-toggle"
                variant={showCommunal || activeTool === 'communal' ? 'contained' : 'outlined'}
                size="small"
                disabled={activeTool === 'communal'}
                onClick={() => setShowCommunal(v => !v)}
                sx={paletteBtnSx(showCommunal || activeTool === 'communal')}
              >
                <VisibilityIcon fontSize="small" />
                <HotkeyBadge label="2" />
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            title={
              activeTool === 'placeholder'
                ? 'Placeholder highlight (auto-shown while the placeholder tool is active)'
                : 'Toggle placeholder-area highlight (3)'
            }
            placement="right"
          >
            {/* Persistent view toggle for the placeholder tint. Forced on (and disabled)
                while the placeholder tool is active, so the button always reflects what
                is actually shown. */}
            <span>
              <Button
                className="template-editor-placeholder-toggle"
                variant={showPlaceholder || activeTool === 'placeholder' ? 'contained' : 'outlined'}
                size="small"
                disabled={activeTool === 'placeholder'}
                onClick={() => setShowPlaceholder(v => !v)}
                sx={paletteBtnSx(showPlaceholder || activeTool === 'placeholder')}
              >
                <VisibilityOutlinedIcon fontSize="small" />
                <HotkeyBadge label="3" />
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            title={
              activeTool === 'condition'
                ? 'Condition highlight (auto-shown while the condition tool is active)'
                : 'Toggle condition-mask highlight (4)'
            }
            placement="right"
          >
            {/* Persistent view toggle for the condition tint. Forced on (and disabled)
                while the condition tool is active, so the button always reflects what
                is actually shown. */}
            <span>
              <Button
                className="template-editor-condition-toggle"
                variant={showCondition || activeTool === 'condition' ? 'contained' : 'outlined'}
                size="small"
                disabled={activeTool === 'condition'}
                onClick={() => setShowCondition(v => !v)}
                sx={paletteBtnSx(showCondition || activeTool === 'condition')}
              >
                <FilterHdrIcon fontSize="small" />
                <HotkeyBadge label="4" />
              </Button>
            </span>
          </Tooltip>
          </Box>
        </Box>

        {/* Pixi canvas */}
        <Box className="template-editor-canvas-container" sx={{ flexGrow: 1, width: '100%', height: '100%', position: 'relative' }}>
          <TemplateEditorViewer
            width={width}
            height={height}
            masks={masks}
            showGrid={showGrid}
            // Force each highlight on while painting its layer; otherwise honor the toggle.
            showCommunal={showCommunal || activeTool === 'communal'}
            showPlaceholder={showPlaceholder || activeTool === 'placeholder'}
            showCondition={showCondition || activeTool === 'condition'}
            activeTool={activeTool}
            onPaintCell={paintCell}
          />
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
          isNewVersion={isNewVersion}
          // New versions require a saved template (v0 on the server) and no pending edits.
          canAddVersion={loadedName === name.trim() && !!name.trim() && !dirty}
          onSwitchVersion={handleSwitchVersion}
          onNewVersion={() => { setPropsOpen(false); handleNewVersion(); }}
          onCancel={() => setPropsOpen(false)}
          onApply={(w, h, nm, desc, resetBoard) => {
            setWidth(w);
            setHeight(h);
            setName(nm);
            setDescription(desc);
            // Only a dimension change regenerates the board; a name-only edit keeps
            // the painting (the dialog has already confirmed the reset with the user).
            if (resetBoard) setMasks(emptyMasks());
            setDirty(true);
            setPropsOpen(false);
          }}
        />

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

// Small corner badge showing a button's keyboard hotkey. Absolutely anchored to the
// bottom-right of the (position:relative) MUI ButtonBase; multi-char labels ("Space")
// shrink to fit the 40px button. Non-interactive so it never eats the button's clicks.
const HotkeyBadge = ({ label }: { label: string }) => (
  <Box
    component="span"
    className="template-editor-hotkey-badge"
    sx={{
      position: 'absolute', bottom: 1, right: 3,
      fontSize: label.length > 1 ? 7 : 9, lineHeight: 1,
      fontWeight: WEIGHT.bold, letterSpacing: '0.02em',
      opacity: 0.9, pointerEvents: 'none',
    }}
  >
    {label}
  </Box>
);

const headerBtnSx = {
  color: 'rgba(255,255,255,0.9)', borderColor: 'rgba(255,255,255,0.5)',
  backgroundColor: 'rgba(0,0,0,0.3)',
  '&:hover': { borderColor: 'white', backgroundColor: 'rgba(0,0,0,0.5)' },
} as const;

// `accent` is an "r,g,b" triplet colouring the active-tool state so a lit button reads
// as belonging to its group; defaults to the palette yellow for the ungrouped grid/view
// toggles. The idle state stays neutral (white-ish border) so groups are distinguished
// by their panel tint, not by idle button colour.
const paletteBtnSx = (active: boolean, accent = '255,224,102') => ({
  minWidth: 0, width: 40, height: 40, p: 0,
  color: active ? 'black' : 'rgba(255,255,255,0.8)',
  borderColor: active ? `rgba(${accent},0.6)` : 'rgba(255,255,255,0.4)',
  backgroundColor: active ? `rgba(${accent},0.95)` : 'rgba(0,0,0,0.35)',
  '&:hover': { borderColor: active ? `rgba(${accent},1)` : 'white', backgroundColor: active ? `rgba(${accent},1)` : 'rgba(0,0,0,0.55)' },
});

// ─── Properties dialog ───────────────────────────────────────────────────────────
// Sets width/height/name + the active VERSION. OK validates dims, checks name
// availability (server), and on success applies + regenerates the board. A taken name
// blocks with an inline error. The version dropdown + "New version" button switch/add
// versions immediately (not gated behind OK). Name is locked once a template has more
// than one version (renaming would orphan the others); dimensions are locked on any
// version above 0 (all versions of a name share the base board size).
function PropertiesDialog({
  open, initialWidth, initialHeight, initialName, initialDescription, loadedName,
  currentVersion, availableVersions, isNewVersion, canAddVersion,
  onSwitchVersion, onNewVersion, onApply, onCancel,
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
  /** All version numbers for this name (dropdown options). */
  availableVersions: number[];
  /** Whether the active version is a not-yet-saved new version. */
  isNewVersion: boolean;
  /** Whether "New version" is allowed right now (template saved + no pending edits). */
  canAddVersion: boolean;
  /** Switch to another (already-saved) version — reloads it, discarding unsaved edits. */
  onSwitchVersion: (version: number) => void;
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
          {/* Version switcher + New version. Placeholder is shared across a name's
              versions (owned by version 0); the terrain / streets / decor / condition
              mask differ per version. */}
          <Box className="template-editor-version-row" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="template-editor-version-label">Version</InputLabel>
              <Select
                labelId="template-editor-version-label"
                className="template-editor-version-select"
                label="Version"
                value={currentVersion}
                onChange={(e) => onSwitchVersion(Number(e.target.value))}
              >
                {availableVersions.map((v) => (
                  <MenuItem key={v} value={v} className="template-editor-version-option">
                    {`Version ${v}${v === 0 ? ' (base)' : ''}${isNewVersion && v === currentVersion ? ' • unsaved' : ''}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
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
            <TextField
              className="template-editor-width-field" label="Width (cols)" type="number" value={w}
              onChange={(e) => setW(e.target.value)} inputProps={{ min: MIN_DIM, max: MAX_DIM }} fullWidth
              disabled={dimsLocked}
            />
            <TextField
              className="template-editor-height-field" label="Length (rows)" type="number" value={h}
              onChange={(e) => setH(e.target.value)} inputProps={{ min: MIN_DIM, max: MAX_DIM }} fullWidth
              disabled={dimsLocked}
            />
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
