import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Tooltip, Snackbar, Alert,
  MenuItem, FormControl, Select, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import HomeIcon from '@mui/icons-material/Home';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import GridOnIcon from '@mui/icons-material/GridOn';
import RouteIcon from '@mui/icons-material/Route';
import LayersClearIcon from '@mui/icons-material/LayersClear';
import AutoAwesomeMotionIcon from '@mui/icons-material/AutoAwesomeMotion';
import LeafPage from '../../components/LeafPage';
import { WEIGHT } from '../../theme/scale';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useAuth } from '../../AuthContext';
import { useConfirmation } from '../../contexts/ConfirmationContext';
import { type EditorMasks } from '../../engine/market/farmTerrain';
import TemplateSandboxViewer, { type SandboxItem, type PendingPlacement } from './TemplateSandboxViewer';
import TemplateLoadGallery from './TemplateLoadGallery';
import {
  listTemplateGallery, loadTemplate, definitionToMasks,
  NIGHT_MARKET_HUB_TEMPLATE_NAME, type TemplateGalleryEntry,
} from './templateEditorApi';
import {
  listSandboxPlacements, addSandboxPlacement, moveSandboxPlacement,
  setSandboxPlacementVersion, setSandboxPlacementLock, setSandboxPlacementSettings,
  removeSandboxPlacement, clearSandboxPlacements, iterateSandboxPlacement,
  SANDBOX_SETTING_DEFAULTS, SANDBOX_HOUSE_MODES,
  type SandboxPlacement, type SandboxHouseMode,
} from './templateSandboxApi';
// Toolbar chrome shared with the Template Editor so both authoring tools look/feel identical.
import { HotkeyBadge, headerBtnSx, paletteBtnSx } from './editorButtonStyles';

/**
 * TemplateSandboxPage — desktop-only Template Sandbox tool
 * (docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md). Template-author-only (bounces non-authors; the
 * backend enforces it too).
 *
 * A freeform surface where an author tiles catalog templates however they please to preview how
 * they compose. Add drops a template (chosen from a visual picker with a dimension filter, the
 * same gallery the editor's Load button uses); clicking a placed tile selects it; a selected tile
 * can be dragged (cell-snapped), version-switched from the header dropdown, or deleted. The whole
 * layout persists per author in `nightmarkettemplatesandbox` (migration 116).
 *
 * State ownership: this page owns the placement list, the selection, and a DEF CACHE — the
 * loaded (tiles/masks/dims/availableVersions) for each (templateName, version) pair actually in
 * use — fetched on demand via {@link loadTemplate} so any version of any template can render. The
 * viewer is a pure renderer + gesture source.
 */

/** A loaded template version's render inputs, cached by `${name}@${version}`. */
interface CachedDef {
  width: number;
  height: number;
  masks: EditorMasks;
  /** Every version number for this name (drives the per-instance version dropdown). */
  availableVersions: number[];
}

const defKey = (name: string, version: number) => `${name}@${version}`;

// ── Toolbar group accents ("r,g,b" triplets, same convention as the editor's palette) ──
/** View toggles (grid) — the editor's default palette yellow. */
const VIEW_ACCENT = '255,224,102';
/** Actions scoped to the SELECTED tile (version · houses · lock). */
const SELECTION_ACCENT = '129,212,250';
/** Whole-layout actions (add). */
const LAYOUT_ACCENT = '165,214,167';
/** Destructive actions (delete · clear) — red so they read apart from their group's other keys. */
const DESTRUCTIVE_ACCENT = '255,140,140';

/** Button tooltip copy per placeholder-area render mode (the H cycle). */
const HOUSE_MODE_LABEL: Record<SandboxHouseMode, string> = {
  all: 'Houses in every placeholder',
  placeholder: 'Placeholder areas tinted, no houses',
  none: 'No houses, no placeholder tint',
};

/** Panel wrapper tinting a toolbar group with its accent (mirrors the editor's tool groups). */
const toolGroupSx = (accent: string) => ({
  display: 'flex', flexDirection: 'row', gap: 0.75, p: 0.75, borderRadius: 1.5,
  backgroundColor: `rgba(${accent},0.14)`,
  border: `1px solid rgba(${accent},0.4)`,
});

function TemplateSandboxPage() {
  usePageTitle();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { confirm } = useConfirmation();

  const [placements, setPlacements] = useState<SandboxPlacement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Def cache: (name@version) → loaded render inputs. Never mutated in place (React identity).
  const [defs, setDefs] = useState<Map<string, CachedDef>>(new Map());
  // View-only preferences (not persisted, not per-placement): the isometric cell grid overlay and
  // the street-mask tint. Both are view-WIDE — they apply to every placement, not the selection.
  const [showGrid, setShowGrid] = useState(false);
  const [showStreet, setShowStreet] = useState(false);
  const [galleryEntries, setGalleryEntries] = useState<TemplateGalleryEntry[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [widthFilter, setWidthFilter] = useState<number | 'any'>('any');
  const [heightFilter, setHeightFilter] = useState<number | 'any'>('any');
  const [snack, setSnack] = useState<{ msg: string; sev: 'success' | 'error' } | null>(null);
  // PLACEMENT MODE — a template picked from the gallery that is riding the cursor, not yet placed.
  // Nothing is persisted while it is pending: the row is created on the DROP, so cancelling
  // (Escape) leaves no trace. Only the identity is held here; the ghost's render inputs come from
  // the def cache, which is why the pick awaits ensureDef before entering the mode. Declared up
  // here with the other page state because the Escape effect below closes over it.
  const [pending, setPending] = useState<{ templateName: string; activeVersion: number } | null>(null);

  // Guard concurrent def fetches for the same key (avoid double-loading the same version).
  const inFlight = useRef<Set<string>>(new Set());

  // UX gate: bounce a signed-in non-author to Home (the backend also enforces isTemplateAuthor
  // on every endpoint — this is UX, not the security boundary). Same stance as the editor.
  useEffect(() => {
    if (isAuthenticated && user && !user.isTemplateAuthor) navigate('/', { replace: true });
  }, [isAuthenticated, user, navigate]);

  /** Ensure a (name, version) def is cached; fetch + convert to masks if not. */
  const ensureDef = useCallback(async (name: string, version: number) => {
    const key = defKey(name, version);
    if (inFlight.current.has(key)) return;
    // Read the latest cache via the functional setter to avoid a stale-closure miss.
    let present = false;
    setDefs((prev) => { present = prev.has(key); return prev; });
    if (present) return;
    inFlight.current.add(key);
    try {
      const tpl = await loadTemplate(name, version);
      const cached: CachedDef = {
        width: tpl.width,
        height: tpl.height,
        masks: definitionToMasks(tpl.definition),
        availableVersions: tpl.availableVersions,
      };
      setDefs((prev) => new Map(prev).set(key, cached));
    } catch (err) {
      setSnack({ msg: err instanceof Error ? err.message : `Failed to load ${name} v${version}`, sev: 'error' });
    } finally {
      inFlight.current.delete(key);
    }
  }, []);

  // Initial load: the author's saved sandbox layout + the defs it references.
  useEffect(() => {
    if (!isAuthenticated || !user?.isTemplateAuthor) return;
    (async () => {
      try {
        const rows = await listSandboxPlacements();
        setPlacements(rows);
        for (const r of rows) ensureDef(r.templateName, r.activeVersion);
      } catch (err) {
        setSnack({ msg: err instanceof Error ? err.message : 'Failed to load sandbox', sev: 'error' });
      }
    })();
  }, [isAuthenticated, user?.isTemplateAuthor, ensureDef]);

  // ── Render items: placements joined to their loaded def (skip until the def arrives) ──
  const items: SandboxItem[] = useMemo(() => {
    const out: SandboxItem[] = [];
    for (const p of placements) {
      const def = defs.get(defKey(p.templateName, p.activeVersion));
      if (!def) continue; // not loaded yet — it appears once ensureDef resolves
      out.push({
        id: p.id,
        templateName: p.templateName,
        activeVersion: p.activeVersion,
        offsetCol: p.offsetCol,
        offsetRow: p.offsetRow,
        width: def.width,
        height: def.height,
        masks: def.masks,
        locked: p.locked,
        // Absent setting = the default filled look (see SANDBOX_SETTING_DEFAULTS).
        houseMode: p.settings?.houseMode ?? SANDBOX_SETTING_DEFAULTS.houseMode,
      });
    }
    return out;
  }, [placements, defs]);

  const selected = placements.find((p) => p.id === selectedId) ?? null;
  // The hub is the surface's PERMANENT fixture: seeded locked at the origin (by Clear, or by
  // Iterate on an empty sandbox) and protected server-side from unlock, move and delete
  // (NightMarketSandboxService), mirroring the runtime's one-hub-at-(0,0) invariant. The
  // selection-scoped Lock and Delete buttons grey out for it; version and houses still apply.
  const selectedIsHub = selected?.templateName === NIGHT_MARKET_HUB_TEMPLATE_NAME;
  // Memoized so its array identity is stable across renders — it is a dep of the version-cycle
  // callback, which in turn is a dep of the hotkey effect (a fresh [] each render would
  // re-register the keydown listener on every render).
  const selectedVersions = useMemo(
    () => (selected
      ? defs.get(defKey(selected.templateName, selected.activeVersion))?.availableVersions ?? [selected.activeVersion]
      : []),
    [selected, defs],
  );

  // ── Add flow: open the picker (lazy-load the gallery once), pick → drop into the sandbox ──
  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    if (galleryEntries === null) {
      try {
        setGalleryEntries(await listTemplateGallery());
      } catch (err) {
        setSnack({ msg: err instanceof Error ? err.message : 'Failed to load templates', sev: 'error' });
      }
    }
  }, [galleryEntries]);

  // Dismiss the picker without adding anything (Cancel button / Escape).
  const closePicker = useCallback(() => setPickerOpen(false), []);

  // Escape backs out of the picker, matching the Cancel button.
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePicker(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen, closePicker]);

  /** Abandon placement mode without adding anything (Escape / picking a different template). */
  const cancelPending = useCallback(() => setPending(null), []);

  // Escape also aborts placement mode — the only way out other than dropping, since the tile is
  // stuck to the cursor. Registered separately from the picker's Escape because the two states are
  // mutually exclusive (the pick closes the picker before the mode starts).
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelPending(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, cancelPending]);

  const handlePick = useCallback(async (entry: TemplateGalleryEntry) => {
    setPickerOpen(false);
    try {
      // The gallery previews (and we place) the version with the most conditions — its
      // chosenVersion — matching the thumbnail the author just clicked.
      await ensureDef(entry.name, entry.chosenVersion);
      setPending({ templateName: entry.name, activeVersion: entry.chosenVersion });
    } catch (err) {
      setSnack({ msg: err instanceof Error ? err.message : 'Failed to add template', sev: 'error' });
    }
  }, [ensureDef]);

  // The pending template joined to its loaded def — the viewer's ghost inputs. Null while the def
  // is still loading (ensureDef is awaited before `pending` is set, so this is a transient miss
  // only if the cache was evicted, which it never is today).
  const pendingItem: PendingPlacement | null = useMemo(() => {
    if (!pending) return null;
    const def = defs.get(defKey(pending.templateName, pending.activeVersion));
    if (!def) return null;
    return {
      templateName: pending.templateName,
      activeVersion: pending.activeVersion,
      width: def.width,
      height: def.height,
      masks: def.masks,
      // A fresh placement takes the default look, so the ghost previews exactly what will land.
      houseMode: SANDBOX_SETTING_DEFAULTS.houseMode,
    };
  }, [pending, defs]);

  /** The drop click — NOW the row is created, at the cell the author aimed at. */
  const handlePendingDrop = useCallback(async (offsetCol: number, offsetRow: number) => {
    if (!pending) return;
    setPending(null); // leave placement mode immediately; a failed insert re-reports via the snack
    try {
      const row = await addSandboxPlacement({
        templateName: pending.templateName,
        activeVersion: pending.activeVersion,
        offsetCol,
        offsetRow,
      });
      setPlacements((prev) => [...prev, row]);
      setSelectedId(row.id);
    } catch (err) {
      setSnack({ msg: err instanceof Error ? err.message : 'Failed to add template', sev: 'error' });
    }
  }, [pending]);

  // The catalog MINUS the hub. The hub is seed-only on this surface (Clear/Iterate plant exactly
  // one at the origin and the server rejects a hand-added second), so offering it in the picker
  // would only ever produce a rejected add. Filtered once here so the dimension dropdowns below
  // never advertise a size that only the hub has either.
  const pickableEntries = useMemo(
    () => (galleryEntries ?? []).filter((e) => e.name !== NIGHT_MARKET_HUB_TEMPLATE_NAME),
    [galleryEntries],
  );

  // Filter the picker's entries by the chosen board dimensions (Any = no constraint).
  const filteredEntries = useMemo(() => (
    pickableEntries.filter(
      (e) => (widthFilter === 'any' || e.width === widthFilter) && (heightFilter === 'any' || e.height === heightFilter),
    )
  ), [pickableEntries, widthFilter, heightFilter]);

  // Distinct widths / heights present in the catalog, for the filter dropdowns.
  const widthOptions = useMemo(
    () => [...new Set(pickableEntries.map((e) => e.width))].sort((a, b) => a - b),
    [pickableEntries],
  );
  const heightOptions = useMemo(
    () => [...new Set(pickableEntries.map((e) => e.height))].sort((a, b) => a - b),
    [pickableEntries],
  );

  // ── Drag commit: persist a moved tile's new SW-corner offset ──
  const handleMove = useCallback(async (id: string, offsetCol: number, offsetRow: number) => {
    // Optimistic local update; roll back on failure.
    let prevRow: SandboxPlacement | undefined;
    setPlacements((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      prevRow = p;
      return { ...p, offsetCol, offsetRow };
    }));
    try {
      await moveSandboxPlacement(id, offsetCol, offsetRow);
    } catch (err) {
      if (prevRow) setPlacements((prev) => prev.map((p) => (p.id === id ? prevRow! : p)));
      setSnack({ msg: err instanceof Error ? err.message : 'Failed to move template', sev: 'error' });
    }
  }, []);

  // ── Version switch for the selected tile ──
  const handleVersionChange = useCallback(async (version: number) => {
    if (!selected) return;
    const id = selected.id;
    const name = selected.templateName;
    await ensureDef(name, version); // load the target version's render inputs first
    let prevVersion = selected.activeVersion;
    setPlacements((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      prevVersion = p.activeVersion;
      return { ...p, activeVersion: version };
    }));
    try {
      await setSandboxPlacementVersion(id, version);
    } catch (err) {
      setPlacements((prev) => prev.map((p) => (p.id === id ? { ...p, activeVersion: prevVersion } : p)));
      setSnack({ msg: err instanceof Error ? err.message : 'Failed to switch version', sev: 'error' });
    }
  }, [selected, ensureDef]);

  // Version CYCLING (the V hotkey / the version button): step to the next version of the
  // selected template, wrapping at the end. The dropdown's explicit pick and this share
  // handleVersionChange, so both persist identically.
  const handleCycleVersion = useCallback(() => {
    if (!selected || selectedVersions.length < 2) return;
    const i = selectedVersions.indexOf(selected.activeVersion);
    handleVersionChange(selectedVersions[(i + 1) % selectedVersions.length]);
  }, [selected, selectedVersions, handleVersionChange]);

  // ── Lock / unlock the selected tile (a locked tile can't be dragged) ──
  const handleToggleLock = useCallback(async () => {
    // The hub stays locked forever (see `selectedIsHub`) — the hotkey must no-op for it just like
    // the greyed-out button, or L would fire a request the server rejects.
    if (!selected || selected.templateName === NIGHT_MARKET_HUB_TEMPLATE_NAME) return;
    const id = selected.id;
    const next = !selected.locked;
    setPlacements((prev) => prev.map((p) => (p.id === id ? { ...p, locked: next } : p)));
    try {
      await setSandboxPlacementLock(id, next);
    } catch (err) {
      setPlacements((prev) => prev.map((p) => (p.id === id ? { ...p, locked: !next } : p)));
      setSnack({ msg: err instanceof Error ? err.message : 'Failed to change lock', sev: 'error' });
    }
  }, [selected]);

  // ── Placeholder-area render mode for the selected tile (settings.houseMode, persisted) ──
  // A three-state CYCLE rather than an on/off toggle: 'all' (a house in every placeholder area) →
  // 'placeholder' (no houses; the areas are tinted so the slots are visible) → 'none' → back. This
  // replaces the editor's condition-driven filled-slot rule on the sandbox surface.
  const selectedHouseMode: SandboxHouseMode = selected
    ? selected.settings?.houseMode ?? SANDBOX_SETTING_DEFAULTS.houseMode
    : SANDBOX_SETTING_DEFAULTS.houseMode;

  const handleCycleHouseMode = useCallback(async () => {
    if (!selected) return;
    const id = selected.id;
    const prevSettings = selected.settings ?? {};
    const current = prevSettings.houseMode ?? SANDBOX_SETTING_DEFAULTS.houseMode;
    const next = SANDBOX_HOUSE_MODES[(SANDBOX_HOUSE_MODES.indexOf(current) + 1) % SANDBOX_HOUSE_MODES.length];
    // Optimistic; roll the whole settings object back on failure.
    setPlacements((prev) => prev.map((p) => (p.id === id ? { ...p, settings: { ...p.settings, houseMode: next } } : p)));
    try {
      await setSandboxPlacementSettings(id, { houseMode: next });
    } catch (err) {
      setPlacements((prev) => prev.map((p) => (p.id === id ? { ...p, settings: prevSettings } : p)));
      setSnack({ msg: err instanceof Error ? err.message : 'Failed to change placeholder render mode', sev: 'error' });
    }
  }, [selected]);

  // ── Delete the selected tile (no confirmation: the sandbox is a scratch surface,
  // so re-adding a template is cheap and a modal just slows down iteration) ──
  const handleDelete = useCallback(async () => {
    // The hub is undeletable (see `selectedIsHub`); no-op so the D hotkey matches its disabled button.
    if (!selected || selected.templateName === NIGHT_MARKET_HUB_TEMPLATE_NAME) return;
    const id = selected.id;
    try {
      await removeSandboxPlacement(id);
      setPlacements((prev) => prev.filter((p) => p.id !== id));
      setSelectedId(null);
    } catch (err) {
      setSnack({ msg: err instanceof Error ? err.message : 'Failed to remove template', sev: 'error' });
    }
  }, [selected]);

  // ── Iterate: let the LIVE growth algorithm place the next template ──
  // The server runs the same planner the real night market grows with and persists its choice, so
  // this is a true preview of runtime behaviour rather than a re-implementation. An empty sandbox
  // seeds the starter hub; `null` means no legal candidate at any exposed anchor.
  const [iterating, setIterating] = useState(false);
  // A failed iterate is a RESULT, not an error — the algorithm ran and found nothing legal. It gets
  // a modal rather than a snackbar because it is the answer the author pressed the button for, and
  // a toast can be missed while they are looking at the scene.
  const [noPlacementOpen, setNoPlacementOpen] = useState(false);
  const handleIterate = useCallback(async () => {
    if (iterating) return; // one step at a time — the algorithm reads the layout it is growing
    setIterating(true);
    try {
      const row = await iterateSandboxPlacement();
      if (!row) {
        setNoPlacementOpen(true);
        return;
      }
      await ensureDef(row.templateName, row.activeVersion);
      setPlacements((prev) => [...prev, row]);
      setSelectedId(row.id);
      setSnack({ msg: `Placed ${row.templateName} v${row.activeVersion} at (${row.offsetCol}, ${row.offsetRow})`, sev: 'success' });
    } catch (err) {
      setSnack({ msg: err instanceof Error ? err.message : 'Failed to iterate the sandbox', sev: 'error' });
    } finally {
      setIterating(false);
    }
  }, [iterating, ensureDef]);

  // Is the sandbox ALREADY in the post-reset state (nothing but the hub, sitting at the origin)?
  // That is what Clear produces, so pressing it again would be a no-op — the button greys out.
  // Note this is deliberately NOT "empty": an empty sandbox (an author who has never cleared or
  // iterated) still has a reset to perform, namely seeding the hub.
  const isFreshlyCleared = placements.length === 1
    && placements[0].templateName === NIGHT_MARKET_HUB_TEMPLATE_NAME
    && placements[0].offsetCol === 0 && placements[0].offsetRow === 0;

  // ── Clear / RESET the whole sandbox ──
  // Unlike the single-tile delete this DOES confirm: it destroys the entire layout (every tile's
  // position/version/settings), which is far more work to rebuild than re-adding one template.
  // It does not leave the surface EMPTY — the server reseeds the hub, locked, at the origin, so
  // Clear returns the sandbox to a fresh account's starting state and the next Iterate has the
  // same anchor the live growth algorithm would start from.
  const handleClear = useCallback(async () => {
    if (isFreshlyCleared) return; // already just the hub — nothing to reset
    const ok = await confirm(
      `Remove all ${placements.length} template${placements.length === 1 ? '' : 's'} from your sandbox and start over from the hub at the origin? This cannot be undone.`,
      { title: 'Reset the sandbox?', confirmText: 'Reset' },
    );
    if (!ok) return;
    try {
      const { placement } = await clearSandboxPlacements();
      await ensureDef(placement.templateName, placement.activeVersion);
      setPlacements([placement]);
      setSelectedId(null);
    } catch (err) {
      setSnack({ msg: err instanceof Error ? err.message : 'Failed to clear sandbox', sev: 'error' });
    }
  }, [isFreshlyCleared, placements.length, confirm, ensureDef]);

  // ── Keyboard hotkeys ────────────────────────────────────────────────────────────
  // One bare key per toolbar button (badged on each button): A add · D delete · L lock ·
  // H houses · V version cycle · G grid · S street overlay · I iterate. CLEAR IS DELIBERATELY
  // KEYLESS — it destroys the whole layout, so it must stay a considered click (+ confirmation),
  // never a stray keypress. The selection-scoped keys (D/L/H/V) no-op
  // without a selection, mirroring their disabled buttons. Suppressed while the picker overlay
  // is open (it owns Escape and its own clicks) and while focus is in a text field, so typing
  // in the filter dropdowns never fires an action.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Let native/browser shortcuts through; only bare keypresses are hotkeys.
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (pickerOpen) return;
      // Placement mode owns the pointer and Escape; the selection-scoped keys (D/L/H/V) would act
      // on a tile the author is not looking at, so the whole set is suspended until the drop.
      if (pending) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;

      switch (e.key.toLowerCase()) {
        case 'a': openPicker(); break;
        case 'g': setShowGrid((v) => !v); break;
        case 's': setShowStreet((v) => !v); break;
        case 'i': handleIterate(); break;
        case 'd': handleDelete(); break;
        case 'l': handleToggleLock(); break;
        case 'h': handleCycleHouseMode(); break;
        case 'v': handleCycleVersion(); break;
        default: return;
      }
      e.preventDefault(); // stop the key from re-triggering a focused button
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pickerOpen, pending, openPicker, handleIterate, handleDelete, handleToggleLock, handleCycleHouseMode, handleCycleVersion]);

  return (
    <LeafPage title="Template Sandbox" onBack={() => navigate('/')} className="template-sandbox-root">
      <Box
        className="template-sandbox-page"
        sx={{ display: 'flex', flexDirection: 'column', width: '100%', flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}
      >
        {/* Header overlay: title + version switcher + Add / Delete. */}
        <Box
          className="template-sandbox-header"
          sx={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 100%)',
            p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          }}
        >
          <Box className="template-sandbox-title-block">
            <Typography
              className="template-sandbox-title" variant="h4" component="h1"
              sx={{ color: 'white', fontWeight: WEIGHT.bold, textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}
            >
              Template Sandbox
            </Typography>
            <Typography
              className="template-sandbox-subtitle" variant="body2"
              sx={{ color: 'rgba(255,255,255,0.85)', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', mt: 0.5 }}
            >
              {/* Placement mode takes over the subtitle: it is the only on-screen instruction for a
                  mode the author cannot click their way out of (Escape or drop). */}
              {pending
                ? `Placing ${pending.templateName} v${pending.activeVersion} — click to drop · drag to pan · Esc to cancel`
                : selected
                  ? `${selected.templateName} — v${selected.activeVersion} · (${selected.offsetCol}, ${selected.offsetRow})${selected.locked ? ' · 🔒 locked' : ''}`
                  : `${placements.length} template${placements.length === 1 ? '' : 's'} · click one to select`}
            </Typography>
          </Box>

          {/* Toolbar — editor-style 40×40 icon buttons with corner hotkey badges, grouped by
              scope: VIEW (grid) · SELECTION (version/houses/lock/delete) · LAYOUT (add/clear).
              Each group's tint matches its accent, exactly as in the template editor's palette.
              The hotkeys are badged here and dispatched in the keydown effect above — keep the
              two in sync. */}
          <Box className="template-sandbox-header-actions" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            {/* View-wide (not selection-scoped): the cell grid, with a red line every 8 cells. */}
            <Box className="template-sandbox-tool-group template-sandbox-tool-group-view" sx={toolGroupSx(VIEW_ACCENT)}>
              <Tooltip title={showGrid ? 'Hide the cell grid (G)' : 'Show the cell grid — red line every 8 cells (G)'} placement="bottom">
                <Button
                  className="template-sandbox-grid-btn"
                  variant={showGrid ? 'contained' : 'outlined'} size="small"
                  onClick={() => setShowGrid((v) => !v)}
                  sx={paletteBtnSx(showGrid, VIEW_ACCENT)}
                >
                  <GridOnIcon fontSize="small" />
                  <HotkeyBadge label="G" />
                </Button>
              </Tooltip>

              {/* The street-walkability tint, on EVERY placement — the sandbox otherwise previews
                  the finished look, but street alignment across seams is what tiling is judged on. */}
              <Tooltip title={showStreet ? 'Hide the street mask (S)' : 'Show the street mask on every template (S)'} placement="bottom">
                <Button
                  className="template-sandbox-street-btn"
                  variant={showStreet ? 'contained' : 'outlined'} size="small"
                  onClick={() => setShowStreet((v) => !v)}
                  sx={paletteBtnSx(showStreet, VIEW_ACCENT)}
                >
                  <RouteIcon fontSize="small" />
                  <HotkeyBadge label="S" />
                </Button>
              </Tooltip>
            </Box>

            {/* Selection-scoped actions — all disabled until a tile is selected. */}
            <Box className="template-sandbox-tool-group template-sandbox-tool-group-selection" sx={toolGroupSx(SELECTION_ACCENT)}>
              {/* Per-instance version CYCLER: steps to this template name's next version and
                  wraps. Reads out the current version in its face, so no dropdown is needed. */}
              <Tooltip
                title={selected
                  ? `Version ${selected.activeVersion}${selected.activeVersion === 0 ? ' (base)' : ''} of ${selectedVersions.length} — cycle to the next (V)`
                  : 'Select a template to switch its version'}
                placement="bottom"
              >
                <span>
                  <Button
                    className="template-sandbox-version-btn" variant="outlined" size="small"
                    onClick={handleCycleVersion} disabled={!selected || selectedVersions.length < 2}
                    sx={paletteBtnSx(false, SELECTION_ACCENT)}
                  >
                    <Typography component="span" sx={{ fontSize: '0.8125rem', fontWeight: WEIGHT.bold, lineHeight: 1 }}>
                      {selected ? `v${selected.activeVersion}` : 'v–'}
                    </Typography>
                    <HotkeyBadge label="V" />
                  </Button>
                </span>
              </Tooltip>

              {/* Tri-state CYCLE (not a toggle): houses → placeholder tint → nothing. The icon
                  names the CURRENT state; 'all' and 'placeholder' both count as lit. */}
              <Tooltip title={`${HOUSE_MODE_LABEL[selectedHouseMode]} — cycle (H)`} placement="bottom">
                <span>
                  <Button
                    className={`template-sandbox-houses-btn template-sandbox-houses-btn--${selectedHouseMode}`}
                    variant={selectedHouseMode === 'none' ? 'outlined' : 'contained'} size="small"
                    onClick={handleCycleHouseMode} disabled={!selected}
                    sx={paletteBtnSx(!!selected && selectedHouseMode !== 'none', SELECTION_ACCENT)}
                  >
                    {selectedHouseMode === 'all' ? <HomeIcon fontSize="small" />
                      : selectedHouseMode === 'placeholder' ? <HighlightAltIcon fontSize="small" />
                      : <HomeOutlinedIcon fontSize="small" />}
                    <HotkeyBadge label="H" />
                  </Button>
                </span>
              </Tooltip>

              {/* Disabled for the hub — it is pinned to the origin and can never be unlocked. */}
              <Tooltip
                title={selectedIsHub
                  ? 'The night market hub is pinned to the origin — it cannot be unlocked'
                  : selected?.locked
                    ? 'Unlock so this template can be dragged (L)'
                    : 'Lock this template so it cannot be dragged (L)'}
                placement="bottom"
              >
                <span>
                  <Button
                    className="template-sandbox-lock-btn"
                    variant={selected?.locked ? 'contained' : 'outlined'} size="small"
                    onClick={handleToggleLock} disabled={!selected || selectedIsHub}
                    sx={paletteBtnSx(!!selected?.locked, SELECTION_ACCENT)}
                  >
                    {selected?.locked ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" />}
                    <HotkeyBadge label="L" />
                  </Button>
                </span>
              </Tooltip>

              {/* Deletes immediately — no confirmation (the sandbox is a scratch surface).
                  Disabled for the hub, which is a permanent fixture of the surface. */}
              <Tooltip
                title={selectedIsHub
                  ? 'The night market hub is a permanent fixture — it cannot be deleted'
                  : 'Delete the selected template from the sandbox (D)'}
                placement="bottom"
              >
                <span>
                  <Button
                    className="template-sandbox-delete-btn" variant="outlined" size="small"
                    onClick={handleDelete} disabled={!selected || selectedIsHub}
                    sx={paletteBtnSx(false, DESTRUCTIVE_ACCENT)}
                  >
                    <DeleteForeverIcon fontSize="small" />
                    <HotkeyBadge label="D" />
                  </Button>
                </span>
              </Tooltip>
            </Box>

            {/* Whole-layout actions. */}
            <Box className="template-sandbox-tool-group template-sandbox-tool-group-layout" sx={toolGroupSx(LAYOUT_ACCENT)}>
              <Tooltip title="Add a template to the sandbox (A)" placement="bottom">
                <Button
                  className="template-sandbox-add-btn" variant="outlined" size="small"
                  onClick={openPicker}
                  sx={paletteBtnSx(false, LAYOUT_ACCENT)}
                >
                  <AddIcon fontSize="small" />
                  <HotkeyBadge label="A" />
                </Button>
              </Tooltip>

              {/* Runs the live runtime growth algorithm one step (server-side) and places its pick. */}
              <Tooltip
                title="Iterate — place the template the live growth algorithm would place next (I)"
                placement="bottom"
              >
                <span>
                  <Button
                    className="template-sandbox-iterate-btn" variant="outlined" size="small"
                    onClick={handleIterate} disabled={iterating}
                    sx={paletteBtnSx(false, LAYOUT_ACCENT)}
                  >
                    <AutoAwesomeMotionIcon fontSize="small" />
                    <HotkeyBadge label="I" />
                  </Button>
                </span>
              </Tooltip>

              {/* The only confirmed action here — it destroys every tile's position/version/settings.
                  Deliberately has NO hotkey for the same reason (see the keydown effect). */}
              <Tooltip title="Reset the sandbox — clear every template back to just the locked hub at the origin" placement="bottom">
                <span>
                  <Button
                    className="template-sandbox-clear-btn" variant="outlined" size="small"
                    onClick={handleClear} disabled={isFreshlyCleared}
                    sx={paletteBtnSx(false, DESTRUCTIVE_ACCENT)}
                  >
                    <LayersClearIcon fontSize="small" />
                  </Button>
                </span>
              </Tooltip>
            </Box>
          </Box>
        </Box>

        {/* The composite sandbox scene. */}
        <TemplateSandboxViewer
          items={items}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMove={handleMove}
          showGrid={showGrid}
          showStreet={showStreet}
          pendingItem={pendingItem}
          onPendingDrop={handlePendingDrop}
        />

        {/* Picker overlay — the visual template gallery with a dimension filter, over the scene. */}
        {pickerOpen && (
          <Box
            className="template-sandbox-picker"
            sx={{
              position: 'absolute', inset: 0, zIndex: 20,
              backgroundColor: 'rgba(10,10,14,0.96)',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <Box
              className="template-sandbox-picker-filters"
              sx={{ display: 'flex', gap: 2, alignItems: 'center', p: 2, pt: 3 }}
            >
              <Typography sx={{ color: 'white', fontWeight: WEIGHT.bold }}>Pick a template</Typography>
              <FormControl size="small" className="template-sandbox-filter-width" sx={{ minWidth: 120 }}>
                <InputLabel sx={{ color: 'rgba(255,255,255,0.7)' }}>Width</InputLabel>
                <Select
                  label="Width"
                  value={widthFilter}
                  onChange={(e) => setWidthFilter(e.target.value === 'any' ? 'any' : Number(e.target.value))}
                  sx={pickerSelectSx}
                >
                  <MenuItem value="any">Any</MenuItem>
                  {widthOptions.map((w) => (
                    <MenuItem key={w} value={w}>{w}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" className="template-sandbox-filter-height" sx={{ minWidth: 120 }}>
                <InputLabel sx={{ color: 'rgba(255,255,255,0.7)' }}>Length</InputLabel>
                <Select
                  label="Length"
                  value={heightFilter}
                  onChange={(e) => setHeightFilter(e.target.value === 'any' ? 'any' : Number(e.target.value))}
                  sx={pickerSelectSx}
                >
                  <MenuItem value="any">Any</MenuItem>
                  {heightOptions.map((h) => (
                    <MenuItem key={h} value={h}>{h}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8125rem' }}>
                {galleryEntries === null ? 'Loading…' : `${filteredEntries.length} shown`}
              </Typography>
              {/* Cancel must live inside the picker: the overlay (zIndex 20) paints over the
                  header (zIndex 10), so a header-level dismiss button would be unreachable. */}
              <Button
                className="template-sandbox-picker-cancel-btn" variant="outlined" size="small"
                startIcon={<CloseIcon />} onClick={closePicker}
                sx={{ ...headerBtnSx, ml: 'auto' }}
              >
                Cancel
              </Button>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0 }}>
              {/* `houseMode="all"` so each card previews the template FULLY OCCUPIED — the same look a
                  freshly-added tile has here (sandbox placements default to houseMode 'all'), rather
                  than the editor's condition-driven filled-slot rule. */}
              {galleryEntries !== null && (
                <TemplateLoadGallery entries={filteredEntries} onPick={handlePick} houseMode="all" />
              )}
            </Box>
          </Box>
        )}
      </Box>

      {/* Iterate's "nothing fits" result — see handleIterate. */}
      <Dialog
        className="template-sandbox-no-placement-dialog"
        open={noPlacementOpen}
        onClose={() => setNoPlacementOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>No legal placement</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            The growth algorithm found no legal candidate at any exposed anchor of this layout —
            every complement-direction, equal-width catalog anchor either overlaps a placed template
            or disagrees across the seam. On a real night market it would stop growing here.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button className="template-sandbox-no-placement-ok" onClick={() => setNoPlacementOpen(false)}>OK</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snack ? (
          <Alert severity={snack.sev} onClose={() => setSnack(null)} sx={{ width: '100%' }}>
            {snack.msg}
          </Alert>
        ) : undefined}
      </Snackbar>
    </LeafPage>
  );
}

/** White-on-dark select styling for the picker filter dropdowns. */
const pickerSelectSx = {
  color: 'white',
  '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.4)' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white' },
  '.MuiSvgIcon-root': { color: 'rgba(255,255,255,0.8)' },
} as const;

export default TemplateSandboxPage;
