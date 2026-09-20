import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Menu, MenuItem, Stack, Tab, Tabs, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import SaveIcon from '@mui/icons-material/Save';
import LeafPage from '../../components/LeafPage';
import { useAuth } from '../../AuthContext';
import { useConfirmation } from '../../contexts/ConfirmationContext';
import { usePageTitle } from '../../hooks/usePageTitle';
import { COLORS } from '../../theme/colors';
import IWEditorColumn from './IWEditorColumn';
import IWSceneMapPanel from './IWSceneMapPanel';
import IWSceneToolsPanel, { IW_TOOLS_PANEL_BG } from './IWSceneToolsPanel';
import IWSceneDetailsPanel from './IWSceneDetailsPanel';
import IWSceneContentPanel from './IWSceneContentPanel';
import IWSceneActionsPanel from './IWSceneActionsPanel';
import IWScenePlacesPanel from './IWScenePlacesPanel';
import { type IWCueOption } from './IWSelectableControls';
import { blankScene, useIWSceneDraft, type IWEditorTool } from './useIWSceneDraft';
import { useIWEditorTools } from './useIWEditorTools';
import { useIWEditorLayout } from './useIWEditorLayout';
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
 * THE THREE COLUMNS (§ 12 phase 1d): the MAP (reusing the night market's editor viewer)
 * between two COLLAPSIBLE side columns — the left one a two-page tab set (the SCENE's
 * identity/cast/completion pair, and the board's TOOLS), the right one the CONTENT: the
 * per-NPC action scripts plus the named places and their interactions, over the scene's
 * complications, events and overheard conversations. NPCs are never authored here — they are
 * code, and this page only picks from them.
 *
 * THE 2026-09-19 RESHAPE, and the two ideas behind it:
 *
 *  1. **Nothing floats over the board any more.** The paint/place palette used to be a DOM
 *     overlay on top of the Pixi canvas; it is now the left column's Tools page
 *     (`IWSceneToolsPanel`). The board is clickable edge to edge as a result — see that
 *     panel's header for the pointer bug the overlay had by construction.
 *  2. **Both side columns collapse SIDEWAYS to a rail** (`IWEditorColumn`), because the
 *     scarce resource in this editor is board WIDTH: the map is the body row's only
 *     `flex: 1` child, so every pixel a column gives up goes to the canvas. Which columns
 *     are open, and which page the left one shows, persist per browser
 *     (`useIWEditorLayout`) — authoring a scene spans many sittings.
 *
 * The tool MODIFIERS (gridlines, decor variant, furniture page, forced facing) and the
 * keyboard dispatch live in `useIWEditorTools`, held here: the palette and the canvas are
 * now in different subtrees, so their one shared truth has to sit above both.
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
 * The LEFT column, narrowed to pay for the content column (the map keeps `flex: 1` and
 * absorbs the rest). Nothing on its Details page is a side-by-side row — cast entries and
 * the completion pair stack — so it loses far less to the trim than the step row gains.
 *
 * ONE width for BOTH of its pages, deliberately: a per-page width would resize the Pixi
 * canvas every time the author flipped between the fields and the tools, and a board that
 * re-lays-out on a tab press reads as a glitch. 320 also happens to be four palette groups
 * wide, so the Tools page needs no width of its own.
 */
const IW_LEFT_COLUMN_WIDTH = 320;

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

  // Which columns are open and which page the left one shows — chrome only, persisted per
  // browser. Deliberately NOT part of the draft: hiding a column must never make a scene dirty.
  const layout = useIWEditorLayout();

  /**
   * The tool MODIFIERS and the whole keyboard dispatch. Held here because the palette
   * (left column) and the canvas (middle) are siblings — the ghost under the cursor and the
   * stamp a click lays down must read the same number, and neither subtree can own it.
   */
  const tools = useIWEditorTools({
    activeTool,
    eraseMode,
    npcCast: scene.npcCast,
    onToolChange: setActiveTool,
    onEraseModeChange: setEraseMode,
    onFloorChange: draft.setFloor,
  });

  /**
   * Arm a placement tool AND show the palette that owns it. Both cross-column jumps — the
   * cast list's "place this NPC" and the places panel's "put this tag on the board" — go
   * through here, because selecting a tool the author cannot see is a dead press.
   */
  const armPlacementTool = useCallback((tool: IWEditorTool) => {
    setActiveTool(tool);
    layout.setLeftPage('tools');
  }, [layout.setLeftPage]); // eslint-disable-line react-hooks/exhaustive-deps -- the setter is stable; the layout object is not

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

      {/* ── Body: [details | tools] · map · content ──
          Only the middle column is dark, because only the middle column is a Pixi canvas —
          with ONE exception: the Tools page brings the night market's dark palette chrome
          with it rather than forking a second, light-ground skin of every palette button
          (see `IWSceneToolsPanel`). The map is the row's only `flex: 1` child, so collapsing
          either side column hands the freed width straight to the board. */}
      <Stack direction="row" sx={{ flex: 1, minHeight: 0 }}>
        <IWEditorColumn
          // Named for the SLOT, not its contents: this column shows either page.
          className="iw-scene-editor-page__left-column"
          side="left"
          // The rail names the page it would come back to, so expanding is never a surprise.
          label={layout.leftPage === 'tools' ? 'Tools' : 'Details'}
          width={IW_LEFT_COLUMN_WIDTH}
          collapsed={layout.leftCollapsed}
          onToggleCollapsed={layout.setLeftCollapsed}
          bodyBackground={layout.leftPage === 'tools' ? IW_TOOLS_PANEL_BG : COLORS.white}
          header={(
            <Tabs
              className="iw-scene-editor-page__left-tabs"
              value={layout.leftPage}
              onChange={(_, page) => layout.setLeftPage(page as 'details' | 'tools')}
              sx={{
                minHeight: 34,
                '& .MuiTab-root': { minHeight: 34, px: 1.5, fontSize: 12, textTransform: 'none' },
              }}
            >
              <Tab className="iw-scene-editor-page__left-tab-details" value="details" label="Details" />
              <Tab className="iw-scene-editor-page__left-tab-tools" value="tools" label="Tools" />
            </Tabs>
          )}
        >
          {/* BOTH pages are mounted only one at a time. The Tools page holds no state of its
              own (the modifiers live in `useIWEditorTools`, above), so unmounting it loses
              nothing — and the Details page's fields are all driven by the draft. */}
          {layout.leftPage === 'details' ? (
            <Box className="iw-scene-editor-page__details-page" sx={{ p: 2 }}>
              <IWSceneDetailsPanel
                scene={scene}
                npcs={npcs}
                problemsByField={problemsByField}
                onUpdate={draft.update}
                onAddCastMember={draft.addCastMember}
                onRemoveCastMember={draft.removeCastMember}
                onUpdateCastMember={draft.updateCastMember}
                onPlaceNpc={(npcId) => armPlacementTool(`npc:${npcId}`)}
              />
            </Box>
          ) : (
            <IWSceneToolsPanel
              scene={scene}
              masks={masks}
              places={draft.places}
              npcs={npcs}
              activeTool={activeTool}
              onToolChange={setActiveTool}
              eraseMode={eraseMode}
              onEraseModeChange={setEraseMode}
              onFloorChange={draft.setFloor}
              tools={tools}
            />
          )}
        </IWEditorColumn>

        <Box className="iw-scene-editor-page__map" sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <IWSceneMapPanel
            scene={scene}
            masks={masks}
            places={draft.places}
            npcs={npcs}
            activeTool={activeTool}
            eraseMode={eraseMode}
            onPaintCell={draft.paintCell}
            onPlaceAt={draft.placeAt}
            tools={tools}
          />
        </Box>

        <IWEditorColumn
          className="iw-scene-editor-page__content-column"
          side="right"
          label="Content"
          width={IW_CONTENT_COLUMN_WIDTH}
          collapsed={layout.rightCollapsed}
          onToggleCollapsed={layout.setRightCollapsed}
          bodySx={{ p: 2, ...IW_CONTENT_COLUMN_DENSITY_SX }}
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
            onPutOnBoard={(tag) => armPlacementTool(`tag:${tag}`)}
            onSetInteraction={draft.setInteraction}
          />

          <IWSceneContentPanel
            scene={scene}
            npcs={npcs}
            problemsByField={problemsByField}
            cues={cues}
            onUpdate={draft.update}
          />
        </IWEditorColumn>
      </Stack>
    </LeafPage>
  );
}
