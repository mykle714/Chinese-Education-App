import { alpha } from '@mui/material/styles';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, CircularProgress, IconButton, Snackbar, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { IW_ACTOR_PLAYER, type IWLineSegments, type IWNpcOption, type IWScene } from '../../../../server/contracts/iw';
import { sceneLayoutToMasks } from '../immersiveWorldSceneApi';
import { popupImageUrl } from '../iwPopupArt';
import { useBlockEdgeSwipe } from '../../../hooks/useBlockEdgeSwipe';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { useTTS } from '../../../hooks/useTTS';
import LeafPage from '../../../components/LeafPage';
import AudioModeChip from '../../../components/AudioModeChip';
import InfoCardSection from '../../flashcards/FlashcardsLearnPage/InfoCardSection';
import EipTabStrip from '../../flashcards/FlashcardsLearnPage/EipTabStrip';
import TooManyTabsSnackbar from '../../flashcards/FlashcardsLearnPage/TooManyTabsSnackbar';
import { useEipTabs } from '../../flashcards/FlashcardsLearnPage/useEipTabs';
import { useFlashcardLearnSettings } from '../../../hooks/useFlashcardLearnSettings';
import { lookupVocabEntry } from '../../../api/dictionary';
import { saveSelectedSense } from '../../../utils/vocabApi';
import { senseLabelForIndex } from '../../../utils/definitionUtils';
import IWComposer from './IWComposer';
import { useKeyboardInset, useKeyboardTransition } from '../../beginnerKeyboard';
import IWSceneStage from './IWSceneStage';
import IWSpeechBubbles from './IWSpeechBubbles';
import { fetchKnownWords, loadPlayableScene } from './iwPlayApi';
import { interactivePlaces } from './iwSceneActors';
import { useIWSceneRuntime } from './useIWSceneRuntime';
import { COLORS } from '../../../theme/colors';

/**
 * IWPlayPage — `/immersive-world/:sceneId`. One stall you can talk to (§ 12 phase 2).
 *
 * LAYER: page. It loads a scene, hands it to `useIWSceneRuntime`, and arranges the three
 * surfaces the phase-2 build needs: the world (canvas), the speech (a DOM overlay over it),
 * and the input (a docked bar below it).
 *
 * ⚠️ **THE LAYOUT IS § 14 Q18's TAP RULE MADE PHYSICAL.** A tap means four different things,
 * so only the world surface routes taps by hit-test; the composer and the bubbles are their
 * own regions and consume their own. That is why the composer is a sibling of the canvas
 * rather than an overlay on it, and why the bubble layer is `pointer-events: none` except on
 * the bubbles themselves.
 *
 * ⚠️ **`useBlockEdgeSwipe(true)` IS MANDATORY**, as on every game page: without it a
 * left-edge drag is the browser's back gesture, and the whole left column of a walkable board
 * would be untappable on iOS.
 *
 * ⚠️ **WHAT PHASE 2 DOES NOT DO**, so nobody looks for it here: there is no objective, no
 * completion check, no report, no run row and no complication draw (§ 12 phase 3). A scene is
 * opened, walked around, talked to and left.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 12 phase 2, § 14 Q9, § 14 Q18.
 */
/**
 * What the learner's own bubble is labelled. A view-layer word, kept away from the runtime's
 * `labelFor`, which calls them `the customer` because that is what an NPC's prompt must read.
 */
const PLAYER_BUBBLE_NAME = 'You';

export default function IWPlayPage() {
  usePageTitle();
  useBlockEdgeSwipe(true);
  const navigate = useNavigate();
  const { sceneId } = useParams<{ sceneId: string }>();
  const tts = useTTS();

  const [scene, setScene] = useState<IWScene | null>(null);
  const [npcs, setNpcs] = useState<IWNpcOption[]>([]);
  /** The authored lines' tap-to-look-up data, from the same scene read (§ 5.3b). */
  const [authoredSegments, setAuthoredSegments] = useState<Record<string, IWLineSegments>>({});
  const [knownWords, setKnownWords] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const runtime = useIWSceneRuntime(scene, npcs, authoredSegments);
  const { settings: learnSettings } = useFlashcardLearnSettings();

  /**
   * § 5.3c — the eip over a scene. The FOURTH host of the same panel (flp, scp, cdp, here),
   * mounted whole rather than reduced: § 5.3b's rule is that iw does not own a lookup UI, and
   * a cut-down eip would be exactly that. `language` is the SCENE's, not the account's — a
   * scene can be played in a language the account is not currently set to.
   */
  const eip = useEipTabs({ language: scene?.language });
  const [eipOpen, setEipOpen] = useState(false);
  /** The word whose lookup is in flight, so a second tap during it is ignored. */
  const eipLoadingRef = useRef<string | null>(null);

  const setPaused = runtime.setPaused;
  /**
   * Tapping a word in a bubble. The lookup runs BEFORE the sheet opens (the same order scp
   * uses) so a word with no det row leaves the scene alone instead of opening an empty sheet.
   *
   * ⚠️ The world is held for as long as the sheet is up — see `IWSceneRuntime.setPaused`.
   * A bubble never expires, but it IS replaced by the next line, so without the hold a
   * conversation running behind the sheet would swap out the line being read.
   */
  const handleSegmentOpen = useCallback(async (segment: string) => {
    if (eipLoadingRef.current) return;
    eipLoadingRef.current = segment;
    setPaused(true);
    try {
      const entry = await lookupVocabEntry(segment, scene?.language);
      eip.openForRoot(entry);
      setEipOpen(true);
    } catch (error) {
      // Silent, like scp's card-info tap: a lookup that misses is an optional detour that
      // did not pan out, and a dialog over a scene is a heavier interruption than the miss.
      console.error(`Failed to open the info panel for "${segment}":`, error);
      setPaused(false);
    } finally {
      eipLoadingRef.current = null;
    }
  }, [eip, scene?.language, setPaused]);

  // Closing KEEPS the trail (same rule as scp): reopening on the same word resumes the
  // drill-in chain. Leaving the scene unmounts the hook, which drops everything.
  const handleCloseEip = useCallback(() => {
    setEipOpen(false);
    setPaused(false);
  }, [setPaused]);

  // Written by the stage every frame, read by the bubble layer's own animation frame — see
  // IWSceneStage's `positions` prop for why this is a ref rather than state.
  const positions = useRef(new Map<string, { x: number; y: number }>());

  // The scene, once. Migration 158 shaped the five jsonb columns around exactly this read.
  useEffect(() => {
    if (!sceneId) return;
    let cancelled = false;
    loadPlayableScene(sceneId)
      .then(payload => {
        if (cancelled) return;
        setScene(payload.scene);
        setNpcs(payload.npcs);
        setAuthoredSegments(payload.lineSegments ?? {});
      })
      .catch(() => { if (!cancelled) setLoadError('That scene is not available.'); });
    return () => { cancelled = true; };
  }, [sceneId]);

  // The learner's own words (§ 9.4), on their own schedule. The scene opens without them:
  // vocabulary is GUIDANCE, so a turn taken before the list lands is written slightly less
  // well, not wrongly.
  useEffect(() => {
    let cancelled = false;
    fetchKnownWords().then(words => { if (!cancelled) setKnownWords(words); });
    return () => { cancelled = true; };
  }, []);

  const pushKnownWords = runtime.setKnownWords;
  useEffect(() => { pushKnownWords(knownWords); }, [knownWords, pushKnownWords]);

  const masks = useMemo(() => sceneLayoutToMasks(scene?.layout), [scene]);
  const places = useMemo(() => (scene ? interactivePlaces(scene) : []), [scene]);

  /**
   * actorId → the name that body wears — over the head as a nametag, and in the corner once
   * the tag has grown into a bubble: the runtime's display labels (`speakerLabels`, NOT the
   * prompt-facing `labelFor`) plus the learner, whom only a view has a word for.
   *
   * ⚠️ THE LEARNER'S ENTRY IS `foreign: false`, and it has to be. "You" is an English word
   * this view chose, not an in-world name: run through a cpcd layout in a `zh` scene it would
   * be spelled out as three tone-coloured columns. Their tag is never drawn either (the layer
   * skips `IW_ACTOR_PLAYER`) — their body IS where they are looking — but a docked bubble is
   * detached from every head, so an unlabelled one would be the only bubble whose speaker is
   * unknowable.
   */
  const speakerNames = useMemo(
    () => ({
      ...runtime.speakerLabels,
      [IW_ACTOR_PLAYER]: { text: PLAYER_BUBBLE_NAME, pinyin: '', foreign: false },
    }),
    [runtime.speakerLabels],
  );
  const popupUrl = runtime.popup ? popupImageUrl(runtime.popup.imageId) : undefined;

  // Space a keyboard is taking at the bottom of the screen, if any, plus the timing
  // that space must travel on. The inset changes in ONE step, so without the
  // transition the composer teleports to its final position while the keyboard is
  // still sliding up behind it — two events instead of one.
  //
  // ⚠️ EITHER KEYBOARD, not just ours. A Spanish learner only ever gets the OS
  // keyboard (the handwriting one is zh-only), and there the beginner inset is 0.
  // Reserving off that alone left the OS keyboard covering the bottom of the scene
  // with nothing moving out of its way.
  const keyboardInset = useKeyboardInset();
  const keyboardTransition = useKeyboardTransition('padding-bottom');

  if (loadError) {
    return (
      <LeafPage title="Immersive World" onBack={() => navigate('/immersive-world')} className="iw-play-page">
        <Box sx={{ p: 3 }}><Typography sx={{ opacity: 0.7 }}>{loadError}</Typography></Box>
      </LeafPage>
    );
  }

  return (
    <LeafPage
      title={scene?.name ?? 'Immersive World'}
      onBack={() => navigate('/immersive-world')}
      className="iw-play-page"
      contentClassName="iw-play-page__body"
      // ⚠️ A keyboard (docs/BEGINNER_KEYBOARD.md § 7a) sits OVER the app, not in
      // this page's flow, so it would otherwise cover the composer — the one
      // control the learner needs while it is open. This page cannot scroll out
      // from under it either: the stage is a fixed viewport. Reserving the height
      // here shrinks `stage-wrap` (it is the flex: 1 child) and carries the
      // composer up above the keyboard. 0 when it is closed, and animated on the
      // keyboard's own curve so the two move as one surface (§ 6z).
      //
      // ⚠️ THIS IS ALSO WHAT KEEPS THE SCENE CENTRED. `IWSceneStage` draws the
      // board at the CENTRE of its canvas, so shrinking the box (and letting the
      // stage's ResizeObserver hand the new size to Pixi) re-centres the scene
      // inside what is left of the viewport on its own. The reverse — the box
      // growing back when the keyboard closes — is deliberately NOT a shift: the
      // stage cancels it with a pan correction (its renderer `resize` handler), so
      // the scene moves when a keyboard appears and holds still when it leaves.
      // If the scene drifts behind the keyboard, this padding or that observer is
      // what stopped working.
      contentSx={{
        p: 0,
        position: 'relative',
        overflow: 'hidden',
        paddingBottom: `${keyboardInset}px`,
        transition: keyboardTransition,
      }}
      rightContent={
        <>
          {runtime.remaining !== null && (
            // § 7 asks for the wind-down to read in-world rather than as a quota bar. This is
            // the honest minimum until there is something better: a count that only appears
            // once it is meaningful, and never a progress bar draining toward "you are done".
            <Typography className="iw-play-page__remaining" sx={{ fontSize: 11, opacity: 0.6 }}>
              {runtime.remaining} left
            </Typography>
          )}
          {/*
            Narration audio mode — the SAME self-contained app-wide control the flp, scp and
            every game header render (docs/AUDIO_PLAYBACK.md). A scene speaks NPC lines aloud
            through `useTTS`, so muting on entering a quiet room is as time-sensitive here as
            it is on the flp, and it should not cost a trip to /settings.

            This is the PHONE's output route (off/passthrough/media, persisted app-wide). The
            composer used to carry a second volume-glyph chip for how loudly the PLAYER spoke
            (whisper/say/shout); it was removed with § 4c on 2026-09-23.
          */}
          <AudioModeChip className="iw-play-page__audio-chip" />
        </>
      }
    >
      <Box className="iw-play-page__stage-wrap" sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {!scene && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <CircularProgress size={20} />
          </Box>
        )}
        {scene && (
          <>
            <IWSceneStage
              width={scene.width}
              height={scene.height}
              masks={masks}
              onTick={runtime.tick}
              drawables={runtime.drawables}
              onTapCell={runtime.walkPlayerTo}
              onTapBody={runtime.focusBody}
              onTapPlace={tag => { void runtime.runPlaceInteraction(tag); }}
              places={places}
              walkable={runtime.graph.walkable}
              focusedId={runtime.focusedId}
              playerId={IW_ACTOR_PLAYER}
              positions={positions}
            />
            <IWSpeechBubbles
              bubbles={runtime.bubbles}
              lineSegments={runtime.lineSegments}
              speakerNames={speakerNames}
              positions={positions}
              language={scene.language}
              // A deliberate press, so it uses the manual voice — `speakSentence`, not the
              // autoplay-gated automatic one. That is what lets the button work UNDER MUTE
              // (§ 14 Q41), which is the state it matters most in: the line was never
              // narrated, and this is the learner's only way to hear it.
              //
              // Usually cache-warm — the clip was decoded to time the reveal, so re-hearing
              // costs nothing. Under mute nothing was prepared, so this press pays the synth
              // round-trip; that is a wait on an explicit request, not a stall in the scene.
              onReplay={text => { void tts.speakSentence(text); }}
              // § 5.3c: tap a word, read about it. Every bubble, every speaker.
              onSegmentOpen={segment => { void handleSegmentOpen(segment); }}
            />
          </>
        )}

        {/* A picture an interaction is showing — the one thing a poke can do that an authored
            action cannot (§ 14 Q43). Tapping anywhere dismisses it and the script continues. */}
        {runtime.popup && (
          <Box
            className="iw-play-page__popup"
            onClick={runtime.dismissPopup}
            sx={{
              position: 'absolute', inset: 0, zIndex: 5,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 1, p: 3, bgcolor: alpha(COLORS.onSurface, 0.72),
            }}
          >
            {popupUrl
              ? <Box component="img" src={popupUrl} alt="" sx={{ maxWidth: '100%', maxHeight: '70%', imageRendering: 'pixelated' }} />
              : <Typography sx={{ opacity: 0.6, fontSize: 12 }}>(missing picture)</Typography>}
            {runtime.popup.caption && (
              <Typography className="iw-play-page__popup-caption" sx={{ fontSize: 13, textAlign: 'center' }}>
                {runtime.popup.caption}
              </Typography>
            )}
          </Box>
        )}
      </Box>

      {scene && (
        <IWComposer
          language={scene.language}
          floor={runtime.floor}
          onSend={runtime.say}
          onContinue={runtime.continueLine}
        />
      )}

      {/* § 5.3c's eip. Mounted only while open so the sheet's open animation replays on every
          reopen (the flp's rule, and scp's). SheetPanel portals its own scrim and sheet to the
          frame, so this needs no positioning host of its own — the scrim is also what stops a
          tap reaching the stage, so reading about a word and playing the scene stay separate
          modes in the same way sorting and reading do on scp. */}
      {eipOpen && (() => {
        // The root tab is seeded before `eipOpen` flips true, so `active` is present; the
        // nulls below are a paint-safety net only.
        const active = eip.activeTab;
        const compareTab = active?.kind === 'compare' ? active : null;
        return (
          <InfoCardSection
            currentEntry={active?.kind === 'entry' ? active.entry : null}
            selectedTab={active?.kind === 'entry' ? active.selectedSubTab : 0}
            onTabChange={eip.setActiveSubTab}
            breakdownItems={active?.kind === 'entry' ? active.breakdownItems : []}
            showPinyin={learnSettings.showPinyin}
            showPinyinColor={learnSettings.showPinyinColor}
            // A scene has no card faces, so there is no flipped state to mirror.
            isFlipped={false}
            onClose={handleCloseEip}
            onBreakdownItemClick={item => { void eip.openForEntryKey(item.character); }}
            onUsedInItemClick={item => { void eip.openForEntryKey(item.entryKey); }}
            onExampleSegmentClick={segment => { void eip.openForEntryKey(segment); }}
            depth={0}
            onSpeak={tts.speak}
            onSpeakSentence={tts.speakSentence}
            speakingKey={tts.speakingKey}
            selectedSenseIndex={active?.kind === 'entry' ? active.selectedSenseIndex : 0}
            // Mirrors scp: the tab records the pick so the panel re-renders at once, and the
            // chosen cluster's label is persisted for a word the learner actually has a card
            // for. A word met in a scene usually carries no vet row (id 0), and then the pick
            // simply stays local to the tab.
            onSelectSense={index => {
              eip.setActiveSenseIndex(index);
              const entry = active?.kind === 'entry' ? active.entry : null;
              if (entry?.id) {
                saveSelectedSense(entry.id, senseLabelForIndex(entry, index))
                  .catch(err => console.error('Failed to save selected sense:', err));
              }
            }}
            compareTab={compareTab}
            onSetCompareSlot={eip.setCompareSlot}
            onCompareResult={eip.setCompareResult}
            entryTabId={eip.activeTab?.id}
            entryTabIndex={eip.activeIndex}
            tabStrip={
              <EipTabStrip
                tabs={eip.tabs}
                activeIndex={eip.activeIndex}
                onSelect={eip.setActive}
                isTabbedMode={eip.isTabbedMode}
              />
            }
            // ✕ = close the showing word; false means "that was the last one" and SheetPanel
            // plays the dismiss (whose onClose lifts the hold). Closing the last tab here
            // instead would empty the body for the whole slide-out.
            onCloseX={() => {
              if (eip.tabs.length <= 1) return false;
              eip.closeActiveTab();
              return true;
            }}
            showMinutePoints
          />
        );
      })()}
      <TooManyTabsSnackbar signal={eip.overflowSignal} />

      {/* Out-of-world messages: a refusal, an event that fired, or Q7's frozen ladder. */}
      <Snackbar
        className="iw-play-page__banner"
        open={Boolean(runtime.banner)}
        autoHideDuration={runtime.frozen ? null : 5000}
        onClose={runtime.dismissBanner}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          severity={runtime.frozen ? 'error' : 'info'}
          variant="filled"
          action={
            <IconButton size="small" color="inherit" onClick={runtime.dismissBanner} aria-label="Dismiss">
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          }
        >
          {runtime.banner}
        </Alert>
      </Snackbar>
    </LeafPage>
  );
}
