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
 * open, which tool is active — while the draft lives in `useIWSceneDraft` and the three
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
 * the SCENE (identity, cast, completion pair) and the CONTENT (complications, overheard
 * conversations). NPCs are never authored here — they are code, and this page only picks
 * from them.
 */

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
  const [problems, setProblems] = useState<IWSceneProblem[]>([]);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  /** Field path → the first complaint about it, for inline marking in the panels. */
  const problemsByField = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of problems) if (!map.has(p.field)) map.set(p.field, p.message);
    return map;
  }, [problems]);

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
      const saved = await saveScene(draft.toPayload());
      draft.markSaved(saved);
      setProblems([]);
      setStatus({ kind: 'success', text: `Saved “${saved.name}”.` });
      void refreshScenes();
    } catch (error) {
      // A refused save carries EVERY field complaint, so the author fixes them in one pass
      // rather than one save round-trip per error.
      const found = problemsFromError(error);
      setProblems(found);
      setStatus({
        kind: 'error',
        text: found.length > 0
          ? `${found.length} problem${found.length === 1 ? '' : 's'} to fix before this scene can be saved.`
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
          severity={status.kind === 'error' ? 'error' : 'success'}
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
          sx={{ width: 360, p: 2, overflowY: 'auto', borderRight: `1px solid ${COLORS.border}`, backgroundColor: COLORS.white }}
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
            locations={draft.locations}
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
          sx={{ width: 420, p: 2, overflowY: 'auto', borderLeft: `1px solid ${COLORS.border}`, backgroundColor: COLORS.white }}
        >
          <IWSceneActionsPanel
            scene={scene}
            npcs={npcs}
            locations={draft.locations}
            problemsByField={problemsByField}
            onAddLocation={draft.addLocation}
            onRenameLocation={draft.renameLocation}
            onRemoveLocation={draft.removeLocation}
            onPlaceLocation={(tag) => setActiveTool(`loc:${tag}`)}
            onAddAction={draft.addAction}
            onUpdateAction={draft.updateAction}
            onRemoveAction={draft.removeAction}
          />

          <IWSceneContentPanel
            scene={scene}
            npcs={npcs}
            problemsByField={problemsByField}
            onUpdate={draft.update}
          />
        </Box>
      </Stack>
    </LeafPage>
  );
}
