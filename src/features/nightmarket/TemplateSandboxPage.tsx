import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Tooltip, Snackbar, Alert,
  MenuItem, FormControl, Select, InputLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import HomeIcon from '@mui/icons-material/Home';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import LeafPage from '../../components/LeafPage';
import { WEIGHT } from '../../theme/scale';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useAuth } from '../../AuthContext';
import { useConfirmation } from '../../contexts/ConfirmationContext';
import { type EditorMasks } from '../../engine/market/farmTerrain';
import TemplateSandboxViewer, { type SandboxItem } from './TemplateSandboxViewer';
import TemplateLoadGallery from './TemplateLoadGallery';
import {
  listTemplateGallery, loadTemplate, definitionToMasks, type TemplateGalleryEntry,
} from './templateEditorApi';
import {
  listSandboxPlacements, addSandboxPlacement, moveSandboxPlacement,
  setSandboxPlacementVersion, setSandboxPlacementLock, setSandboxPlacementSettings,
  removeSandboxPlacement, SANDBOX_SETTING_DEFAULTS, type SandboxPlacement,
} from './templateSandboxApi';

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

/** Outlined header button styling — matches the template editor's header buttons. */
const headerBtnSx = {
  color: 'rgba(255,255,255,0.9)',
  borderColor: 'rgba(255,255,255,0.5)',
  backgroundColor: 'rgba(0,0,0,0.3)',
  '&:hover': { borderColor: 'white', backgroundColor: 'rgba(0,0,0,0.5)' },
  '&.Mui-disabled': { color: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.2)' },
} as const;

function TemplateSandboxPage() {
  usePageTitle();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { confirm } = useConfirmation();

  const [placements, setPlacements] = useState<SandboxPlacement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Def cache: (name@version) → loaded render inputs. Never mutated in place (React identity).
  const [defs, setDefs] = useState<Map<string, CachedDef>>(new Map());
  const [galleryEntries, setGalleryEntries] = useState<TemplateGalleryEntry[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [widthFilter, setWidthFilter] = useState<number | 'any'>('any');
  const [heightFilter, setHeightFilter] = useState<number | 'any'>('any');
  const [snack, setSnack] = useState<{ msg: string; sev: 'success' | 'error' } | null>(null);

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
        showHouses: p.settings?.showHouses ?? SANDBOX_SETTING_DEFAULTS.showHouses,
      });
    }
    return out;
  }, [placements, defs]);

  const selected = placements.find((p) => p.id === selectedId) ?? null;
  const selectedVersions = selected
    ? defs.get(defKey(selected.templateName, selected.activeVersion))?.availableVersions ?? [selected.activeVersion]
    : [];

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

  const handlePick = useCallback(async (entry: TemplateGalleryEntry) => {
    setPickerOpen(false);
    // Stagger new drops so repeated adds don't perfectly stack on the origin (overlaps ARE
    // allowed, but a small offset keeps each fresh tile grabbable).
    const n = placements.length;
    const offsetCol = (n % 6) * 4;
    const offsetRow = Math.floor(n / 6) * 4;
    try {
      // The gallery previews (and we place) the version with the most conditions — its
      // chosenVersion — matching the thumbnail the author just clicked.
      await ensureDef(entry.name, entry.chosenVersion);
      const row = await addSandboxPlacement({
        templateName: entry.name,
        activeVersion: entry.chosenVersion,
        offsetCol,
        offsetRow,
      });
      setPlacements((prev) => [...prev, row]);
      setSelectedId(row.id);
    } catch (err) {
      setSnack({ msg: err instanceof Error ? err.message : 'Failed to add template', sev: 'error' });
    }
  }, [placements.length, ensureDef]);

  // Filter the picker's entries by the chosen board dimensions (Any = no constraint).
  const filteredEntries = useMemo(() => {
    if (!galleryEntries) return [];
    return galleryEntries.filter(
      (e) => (widthFilter === 'any' || e.width === widthFilter) && (heightFilter === 'any' || e.height === heightFilter),
    );
  }, [galleryEntries, widthFilter, heightFilter]);

  // Distinct widths / heights present in the catalog, for the filter dropdowns.
  const widthOptions = useMemo(
    () => [...new Set((galleryEntries ?? []).map((e) => e.width))].sort((a, b) => a - b),
    [galleryEntries],
  );
  const heightOptions = useMemo(
    () => [...new Set((galleryEntries ?? []).map((e) => e.height))].sort((a, b) => a - b),
    [galleryEntries],
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

  // ── Lock / unlock the selected tile (a locked tile can't be dragged) ──
  const handleToggleLock = useCallback(async () => {
    if (!selected) return;
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

  // ── Houses on/off for the selected tile (settings.showHouses, persisted in the settings bag) ──
  // ON = every placeholder area of that template previews an occupant house; OFF = none. This
  // replaces the editor's condition-driven filled-slot rule on the sandbox surface.
  const selectedShowHouses = selected
    ? selected.settings?.showHouses ?? SANDBOX_SETTING_DEFAULTS.showHouses
    : false;

  const handleToggleHouses = useCallback(async () => {
    if (!selected) return;
    const id = selected.id;
    const prevSettings = selected.settings ?? {};
    const next = !(prevSettings.showHouses ?? SANDBOX_SETTING_DEFAULTS.showHouses);
    // Optimistic; roll the whole settings object back on failure.
    setPlacements((prev) => prev.map((p) => (p.id === id ? { ...p, settings: { ...p.settings, showHouses: next } } : p)));
    try {
      await setSandboxPlacementSettings(id, { showHouses: next });
    } catch (err) {
      setPlacements((prev) => prev.map((p) => (p.id === id ? { ...p, settings: prevSettings } : p)));
      setSnack({ msg: err instanceof Error ? err.message : 'Failed to change houses setting', sev: 'error' });
    }
  }, [selected]);

  // ── Delete the selected tile ──
  const handleDelete = useCallback(async () => {
    if (!selected) return;
    const ok = await confirm(
      `Remove "${selected.templateName}" from your sandbox layout?`,
      { title: 'Remove from sandbox?', confirmText: 'Remove' },
    );
    if (!ok) return;
    const id = selected.id;
    try {
      await removeSandboxPlacement(id);
      setPlacements((prev) => prev.filter((p) => p.id !== id));
      setSelectedId(null);
    } catch (err) {
      setSnack({ msg: err instanceof Error ? err.message : 'Failed to remove template', sev: 'error' });
    }
  }, [selected, confirm]);

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
              {selected
                ? `${selected.templateName} — v${selected.activeVersion} · (${selected.offsetCol}, ${selected.offsetRow})${selected.locked ? ' · 🔒 locked' : ''}`
                : `${placements.length} template${placements.length === 1 ? '' : 's'} · click one to select`}
            </Typography>
          </Box>

          <Box className="template-sandbox-header-actions" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            {/* Per-instance version switcher — enabled only when a tile is selected. Lists the
                selected template name's versions; switching re-renders that one instance. */}
            <FormControl size="small" className="template-sandbox-version" disabled={!selected}>
              <Select
                className="template-sandbox-version-select"
                value={selected ? selected.activeVersion : ''}
                displayEmpty
                onChange={(e) => handleVersionChange(Number(e.target.value))}
                renderValue={(v) => (selected ? `Version ${v}${v === 0 ? ' (base)' : ''}` : 'Version')}
                sx={{
                  color: 'rgba(255,255,255,0.9)',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  fontSize: '0.8125rem',
                  '.MuiSelect-select': { py: '4px', pl: '10px' },
                  '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.5)' },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'white' },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'white' },
                  '&.Mui-disabled .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
                  '.MuiSvgIcon-root': { color: 'rgba(255,255,255,0.9)' },
                }}
              >
                {selectedVersions.map((v) => (
                  <MenuItem key={v} value={v} className="template-sandbox-version-option">
                    {`Version ${v}${v === 0 ? ' (base)' : ''}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Tooltip title={selectedShowHouses ? 'Hide the houses in this template’s placeholders' : 'Show a house in every placeholder of this template'}>
              <span>
                <Button
                  className="template-sandbox-houses-btn" variant="outlined" size="small"
                  startIcon={selectedShowHouses ? <HomeIcon /> : <HomeOutlinedIcon />}
                  onClick={handleToggleHouses} disabled={!selected}
                  sx={headerBtnSx}
                >
                  {selectedShowHouses ? 'Houses On' : 'Houses Off'}
                </Button>
              </span>
            </Tooltip>

            <Tooltip title={selected?.locked ? 'Unlock so this template can be dragged' : 'Lock this template so it cannot be dragged'}>
              <span>
                <Button
                  className="template-sandbox-lock-btn" variant="outlined" size="small"
                  startIcon={selected?.locked ? <LockIcon /> : <LockOpenIcon />}
                  onClick={handleToggleLock} disabled={!selected}
                  sx={headerBtnSx}
                >
                  {selected?.locked ? 'Unlock' : 'Lock'}
                </Button>
              </span>
            </Tooltip>

            <Tooltip title="Delete the selected template from the sandbox">
              <span>
                <Button
                  className="template-sandbox-delete-btn" variant="outlined" size="small"
                  startIcon={<DeleteForeverIcon />} onClick={handleDelete} disabled={!selected}
                  sx={headerBtnSx}
                >
                  Delete
                </Button>
              </span>
            </Tooltip>

            <Button
              className="template-sandbox-add-btn" variant="outlined" size="small"
              startIcon={<AddIcon />} onClick={openPicker}
              sx={headerBtnSx}
            >
              Add
            </Button>
          </Box>
        </Box>

        {/* The composite sandbox scene. */}
        <TemplateSandboxViewer
          items={items}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMove={handleMove}
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
              {galleryEntries !== null && <TemplateLoadGallery entries={filteredEntries} onPick={handlePick} />}
            </Box>
          </Box>
        )}
      </Box>

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
