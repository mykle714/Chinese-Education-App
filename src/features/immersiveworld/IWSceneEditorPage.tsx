import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Menu, MenuItem, Stack, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import SaveIcon from '@mui/icons-material/Save';
import LeafPage from '../../components/LeafPage';
import { useAuth } from '../../AuthContext';
import { useConfirmation } from '../../contexts/ConfirmationContext';
import { usePageTitle } from '../../hooks/usePageTitle';
import { COLORS } from '../../theme/colors';
import IWSceneMapPanel from './IWSceneMapPanel';
import IWSceneDetailsPanel from './IWSceneDetailsPanel';
import IWSceneContentPanel from './IWSceneContentPanel';
import IWSceneActionsPanel from './IWSceneActionsPanel';
import IWScenePlacesPanel from './IWScenePlacesPanel';
import { type IWCueOption } from './IWSelectableControls';
import { blankScene, useIWSceneDraft, type IWEditorTool } from './useIWSceneDraft';
import {
  deleteScene, errorMessage, listNpcs, listScenes, loadScene, problemsFromError, saveScene,
  type IWNpcOption, type IWSceneProblem, type IWSceneSummary,
} from './immersiveWorldSceneApi';

/**
 * IWSceneEditorPage — the Immersive World scene authoring surface
 * (docs/IMMERSIVE_WORLD.md § 12 phase 1d/1e). Desktop-only, template-author-only.
 *
 * LAYER: feature page. It owns ORCHESTRATION only — load, save, delete, which scene is
 * open, which tool is active — while the draft lives in `useIWSceneDraft` and the four
 * panels render it. Nothing here writes SQL-shaped logic or reaches past
 * `immersiveWorldSceneApi.ts` for a server call.
 *
 * THE POINT OF THIS PAGE, restated because it is easy to lose: **the engineering
 * deliverable for iw is a TOOL, not content.** No scene is authored by an engineer. Phase
 * 1's kill condition is "an author cannot assemble a working scene without engineering
 * help" — so anything an author cannot express here is a gap in this page, not a thing to
 * fix in a seed script.
 *
 * THE THREE COLUMNS (§ 12 phase 1d): the MAP (reusing the night market's editor viewer),
 * the SCENE (identity, cast, completion pair) and the CONTENT — which is two panels stacked,
 * the per-NPC action scripts plus the named places and their interactions, over the scene's
 * complications, events and overheard conversations. NPCs are never authored here — they are
 * code, and this page only picks from them.
 */

/**
 * The right-hand authoring column runs out of room long before the other two do: an action
 * is a LIST OF STEPS, and every step is a row of dropdowns that has to fit side by side. So
 * that column is both wider than the left one and rendered a notch smaller than the rest of
 * the app — the shrink is scoped here rather than pushed into each panel so the two panels
 * stay ordinary MUI and there is exactly ONE place to retune the density.
 *
 * The width exists ENTIRELY for the step row (2026-09-05): every pixel added here lands on
 * the step's payload field — the comment text, the place/actor/conversation dropdown —
 * because everything else in that row (the index, the kind select, the three icon buttons)
 * is fixed-width. Widening this constant is therefore the one lever that makes a step
 * legible; the panels themselves only trim their own chrome to feed it.
 */
const IW_CONTENT_COLUMN_WIDTH = 720;

/**
 * The details column, narrowed to pay for the content column (the map keeps `flex: 1` and
 * absorbs the rest). Nothing in it is a side-by-side row — cast entries and the completion
 * pair stack — so it loses far less to the trim than the step row gains.
 */
const IW_DETAILS_COLUMN_WIDTH = 320;

/** Compact typography for everything inside the content column (labels, fields, buttons). */
const IW_CONTENT_COLUMN_DENSITY_SX = {
  // Section headers. Panel body text sets its own size explicitly, so only the shared
  // `overline` heading is retuned here — a blanket Typography rule would beat those inline
  // sizes on specificity and silently ENLARGE the 11px captions.
  '& .MuiTypography-overline': { fontSize: 10 },
  // Text fields and selects: value, floating label and helper text all step down together,
  // otherwise a 13px label sits over a 16px value and the rows look misaligned.
  '& .MuiInputBase-input': { fontSize: 13 },
  '& .MuiInputLabel-root': { fontSize: 12 },
  '& .MuiFormHelperText-root': { fontSize: 11 },
  '& .MuiButton-root': { fontSize: 12 },
  // NOTE: select options are NOT styled here — MUI renders them into a portal outside this
  // column, so a descendant rule cannot reach them. They keep the app-wide menu size.
} as const;

export default function IWSceneEditorPage() {
  usePageTitle('Scene Editor');
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { confirm } = useConfirmation();

  // Template-author-only surface. Once auth resolves, bounce non-authors to Home. The
  // backend enforces the same gate on every endpoint — this is UX, not the boundary.
  useEffect(() => {
    if (isAuthenticated && user && !user.isTemplateAuthor) navigate('/', { replace: true });
  }, [isAuthenticated, user, navigate]);

  const draft = useIWSceneDraft();
  const { scene, masks, dirty } = draft;

  const [scenes, setScenes] = useState<IWSceneSummary[]>([]);
  const [npcs, setNpcs] = useState<IWNpcOption[]>([]);
  const [activeTool, setActiveTool] = useState<IWEditorTool>('terrain1');
  const [eraseMode, setEraseMode] = useState(false);
  // What the validator last said about the open scene. Usually WARNINGS from a save that
  // SUCCEEDED (2026-09-05) — the editor no longer refuses a half-built scene — and only in
  // the structural cases the complaints that refused one.
  const [problems, setProblems] = useState<IWSceneProblem[]>([]);
  const [status, setStatus] = useState<{ kind: 'error' | 'warning' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  /** Field path → the first complaint about it, for inline marking in the panels. */
  const problemsByField = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of problems) if (!map.has(p.field)) map.set(p.field, p.message);
    return map;
  }, [problems]);

  /**
   * The scene's complications and events, merged into one list of CUES (2026-09-06) — what a
   * dependent action or conversation may be gated on.
   *
   * Merged HERE rather than in each panel because two panels need the same pool and the
   * server merges the same two lists to validate against it; three independent merges would
   * be three chances to disagree about what a cue is.
   */
  const cues = useMemo<IWCueOption[]>(() => [
    ...scene.complications.map((c) => ({
      id: c.id, description: c.description, kind: 'complication' as const,
    })),
    ...scene.events.map((e) => ({
      id: e.id, description: e.description, kind: 'event' as const,
    })),
  ], [scene.complications, scene.events]);

  const refreshScenes = useCallback(async () => {
    try {
      setScenes(await listScenes());
    } catch (error) {
      setStatus({ kind: 'error', text: errorMessage(error, 'Failed to list scenes') });
    }
  }, []);

  useEffect(() => { void refreshScenes(); }, [refreshScenes]);

  // The picker's options follow the scene's language: a cast belongs to exactly one
  // language (§ 14 Q8), so switching language must not leave the old cast on offer.
  useEffect(() => {
    let cancelled = false;
    listNpcs(scene.language)
      .then((list) => { if (!cancelled) setNpcs(list); })
      .catch((error) => setStatus({ kind: 'error', text: errorMessage(error, 'Failed to list NPCs') }));
    return () => { cancelled = true; };
  }, [scene.language]);

  const handleNew = useCallback(async () => {
    if (dirty) {
      const ok = await confirm(
        'Starting a new scene replaces the current one — any unsaved edits will be lost. Continue?',
        { title: 'New scene?', confirmText: 'New scene', cancelText: 'Keep editing' },
      );
      if (!ok) return;
    }
    draft.loadScene(blankScene(scene.language));
    setProblems([]);
    setStatus(null);
  }, [confirm, dirty, draft, scene.language]);

  const handleLoad = useCallback(async (id: string) => {
    if (!id) return;
    if (dirty) {
      const ok = await confirm(
        'Loading a scene replaces the current one — any unsaved edits will be lost. Continue?',
        { title: 'Load scene?', confirmText: 'Load', cancelText: 'Keep editing' },
      );
      if (!ok) return;
    }
    try {
      draft.loadScene(await loadScene(id));
      setProblems([]);
      setStatus(null);
    } catch (error) {
      setStatus({ kind: 'error', text: errorMessage(error, 'Failed to load scene') });
    }
  }, [confirm, dirty, draft]);

  const handleSave = useCallback(async () => {
    setBusy(true);
    try {
      // The save SUCCEEDS with an unfinished scene and hands back what is still wrong with
      // it. Authoring happens over several sittings, so "saved" and "ready to play" are two
      // different states and the editor reports them as such.
      const { scene: saved, warnings } = await saveScene(draft.toPayload());
      draft.markSaved(saved);
      setProblems(warnings);
      setStatus(warnings.length > 0
        ? {
          kind: 'warning',
          text: `Saved “${saved.name}” with ${warnings.length} warning${warnings.length === 1 ? '' : 's'} — fix ${warnings.length === 1 ? 'it' : 'them'} before publishing.`,
        }
        : { kind: 'success', text: `Saved “${saved.name}”.` });
      void refreshScenes();
    } catch (error) {
      // Only a STRUCTURAL fault gets here (a blank name, a broken board) — and it still
      // carries EVERY such complaint at once, so the author fixes them in one pass.
      const found = problemsFromError(error);
      setProblems(found);
      setStatus({
        kind: 'error',
        text: found.length > 0
          ? `This scene cannot be saved in this shape — ${found.length} thing${found.length === 1 ? '' : 's'} to fix first.`
          : errorMessage(error, 'Failed to save scene'),
      });
    } finally {
      setBusy(false);
    }
  }, [draft, refreshScenes]);

  const handleDelete = useCallback(async () => {
    if (!scene.id) return;
    const ok = await confirm(
      `Delete “${scene.name}” permanently? A scene that has been played cannot be deleted — unpublish it instead.`,
      { title: 'Delete scene?', confirmText: 'Delete', cancelText: 'Keep it' },
    );
    if (!ok) return;
    try {
      await deleteScene(scene.id);
      draft.loadScene(blankScene(scene.language));
      setStatus({ kind: 'success', text: 'Scene deleted.' });
      void refreshScenes();
    } catch (error) {
      setStatus({ kind: 'error', text: errorMessage(error, 'Failed to delete scene') });
    }
  }, [confirm, draft, refreshScenes, scene.id, scene.name, scene.language]);

  // The Load menu's anchor. A MENU rather than a select in the field row: Load belongs in
  // the corner with the other three scene actions, and a labelled dropdown sitting alone at
  // the left of a toolbar reads as a field the author is meant to fill in.
  const loadBtnRef = useRef<HTMLButtonElement | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);

  const handleBack = useCallback(async () => {
    if (dirty) {
      const ok = await confirm(
        'Leaving the editor discards any unsaved edits to this scene. Continue?',
        { title: 'Leave the editor?', confirmText: 'Leave', cancelText: 'Keep editing' },
      );
      if (!ok) return;
    }
    navigate('/');
  }, [confirm, dirty, navigate]);

  return (
    <LeafPage
      className="iw-scene-editor-page"
      title="Scene Editor"
      onBack={() => void handleBack()}
      contentClassName="iw-scene-editor-page__body"
      contentSx={{ flexDirection: 'column', minHeight: 0 }}
    >
      {/* ── Toolbar: the four scene actions, in the corner ──────────────────────────
          Plain theme-skinned MUI buttons. The night market editor's own header styling
          (`headerBtnSx`) is deliberately NOT reused: those buttons are drawn to float over
          a dark Pixi canvas, and this toolbar sits on the app's ordinary paper ground. */}
      <Stack
        className="iw-scene-editor-page__toolbar"
        direction="row"
        alignItems="center"
        justifyContent="flex-end"
        spacing={1}
        sx={{ px: 2, py: 1, borderBottom: `1px solid ${COLORS.border}`, flex: '0 0 auto' }}
      >
        <Typography className="iw-scene-editor-page__scene-name" sx={{ mr: 'auto', fontSize: 14 }}>
          {scene.name.trim() || 'Untitled scene'}
          <Box component="span" sx={{ color: COLORS.textFaint, ml: 1 }}>
            {scene.width}×{scene.height} · {scene.language} · {scene.npcCast.length} cast
            {scene.published ? ' · published' : ''}
          </Box>
        </Typography>

        <Button
          className="iw-scene-editor-page__load-btn"
          ref={loadBtnRef}
          variant="outlined" size="small" startIcon={<FolderOpenIcon />}
          disabled={scenes.length === 0}
          onClick={() => setLoadOpen(true)}
        >
          Load
        </Button>
        <Menu
          className="iw-scene-editor-page__load-menu"
          anchorEl={loadBtnRef.current}
          open={loadOpen}
          onClose={() => setLoadOpen(false)}
        >
          {scenes.map((s) => (
            <MenuItem
              key={s.id}
              selected={s.id === scene.id}
              onClick={() => { setLoadOpen(false); void handleLoad(s.id); }}
            >
              {s.name} · {s.language} · {s.castCount} cast{s.published ? ' · published' : ''}
            </MenuItem>
          ))}
        </Menu>

        <Button
          className="iw-scene-editor-page__new-btn"
          variant="outlined" size="small" startIcon={<NoteAddIcon />}
          onClick={() => void handleNew()}
        >
          New
        </Button>
        <Button
          className="iw-scene-editor-page__delete-btn"
          variant="outlined" size="small" color="error" startIcon={<DeleteOutlineIcon />}
          disabled={!scene.id}
          onClick={() => void handleDelete()}
        >
          Delete
        </Button>
        <Button
          className="iw-scene-editor-page__save-btn"
          variant="contained" size="small" startIcon={<SaveIcon />}
          disabled={busy}
          onClick={() => void handleSave()}
        >
          {dirty ? 'Save •' : 'Save'}
        </Button>
      </Stack>

      {status && (
        <Alert
          className="iw-scene-editor-page__status"
          severity={status.kind}
          onClose={() => setStatus(null)}
          sx={{ borderRadius: 0, flex: '0 0 auto' }}
        >
          {status.text}
          {problems.length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
              {problems.map((p, i) => <li key={i}>{p.field}: {p.message}</li>)}
            </Box>
          )}
        </Alert>
      )}

      {/* ── Body: details | map | content ──
          Only the middle column is dark, because only the middle column is a Pixi canvas.
          The two authoring panels stay on the app's paper ground with ordinary fields. */}
      <Stack direction="row" sx={{ flex: 1, minHeight: 0 }}>
        <Box
          className="iw-scene-editor-page__details"
          sx={{
            width: IW_DETAILS_COLUMN_WIDTH,
            flex: '0 0 auto',
            p: 2,
            overflowY: 'auto',
            borderRight: `1px solid ${COLORS.border}`,
            backgroundColor: COLORS.white,
          }}
        >
          <IWSceneDetailsPanel
            scene={scene}
            npcs={npcs}
            problemsByField={problemsByField}
            onUpdate={draft.update}
            onAddCastMember={draft.addCastMember}
            onRemoveCastMember={draft.removeCastMember}
            onUpdateCastMember={draft.updateCastMember}
            onPlaceNpc={(npcId) => setActiveTool(`npc:${npcId}`)}
          />
        </Box>

        <Box className="iw-scene-editor-page__map" sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <IWSceneMapPanel
            scene={scene}
            masks={masks}
            places={draft.places}
            npcs={npcs}
            activeTool={activeTool}
            onToolChange={setActiveTool}
            eraseMode={eraseMode}
            onEraseModeChange={setEraseMode}
            onPaintCell={draft.paintCell}
            onPlaceAt={draft.placeAt}
            onFloorChange={draft.setFloor}
          />
        </Box>

        <Box
          className="iw-scene-editor-page__content"
          sx={{
            width: IW_CONTENT_COLUMN_WIDTH,
            flex: '0 0 auto',
            p: 2,
            overflowY: 'auto',
            borderLeft: `1px solid ${COLORS.border}`,
            backgroundColor: COLORS.white,
            ...IW_CONTENT_COLUMN_DENSITY_SX,
          }}
        >
          <IWSceneActionsPanel
            scene={scene}
            npcs={npcs}
            places={draft.places}
            problemsByField={problemsByField}
            cues={cues}
            onAddAction={draft.addAction}
            onUpdateAction={draft.updateAction}
            onRemoveAction={draft.removeAction}
          />

          {/* Directly below the actions, where the Places section used to live inside them —
              the column reads the same, but a place now carries its own interaction script
              (migration 162), which is more than one panel's worth of idea. */}
          <IWScenePlacesPanel
            scene={scene}
            npcs={npcs}
            places={draft.places}
            problemsByField={problemsByField}
            onAddPlace={draft.addPlace}
            onRenamePlace={draft.renamePlace}
            onRemovePlace={draft.removePlace}
            onPutOnBoard={(tag) => setActiveTool(`tag:${tag}`)}
            onSetInteraction={draft.setInteraction}
          />

          <IWSceneContentPanel
            scene={scene}
            npcs={npcs}
            problemsByField={problemsByField}
            cues={cues}
            onUpdate={draft.update}
          />
        </Box>
      </Stack>
    </LeafPage>
  );
}
