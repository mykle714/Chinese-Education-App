import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, CircularProgress, IconButton, Snackbar, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { IW_ACTOR_PLAYER, type IWNpcOption, type IWScene } from '../../../../server/contracts/iw';
import { sceneLayoutToMasks } from '../immersiveWorldSceneApi';
import { popupImageUrl } from '../iwPopupArt';
import { useBlockEdgeSwipe } from '../../../hooks/useBlockEdgeSwipe';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { useTTS } from '../../../hooks/useTTS';
import LeafPage from '../../../components/LeafPage';
import IWComposer from './IWComposer';
import IWSceneStage from './IWSceneStage';
import IWSpeechBubbles from './IWSpeechBubbles';
import { fetchKnownWords, loadPlayableScene } from './iwPlayApi';
import { interactivePlaces } from './iwSceneActors';
import { useIWSceneRuntime } from './useIWSceneRuntime';

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
export default function IWPlayPage() {
  usePageTitle();
  useBlockEdgeSwipe(true);
  const navigate = useNavigate();
  const { sceneId } = useParams<{ sceneId: string }>();
  const tts = useTTS();

  const [scene, setScene] = useState<IWScene | null>(null);
  const [npcs, setNpcs] = useState<IWNpcOption[]>([]);
  const [knownWords, setKnownWords] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const runtime = useIWSceneRuntime(scene, npcs);
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
  const popupUrl = runtime.popup ? popupImageUrl(runtime.popup.imageId) : undefined;

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
      contentSx={{ p: 0, position: 'relative', overflow: 'hidden' }}
      rightContent={
        runtime.remaining !== null
          ? (
            // § 7 asks for the wind-down to read in-world rather than as a quota bar. This is
            // the honest minimum until there is something better: a count that only appears
            // once it is meaningful, and never a progress bar draining toward "you are done".
            <Typography className="iw-play-page__remaining" sx={{ fontSize: 11, opacity: 0.6 }}>
              {runtime.remaining} left
            </Typography>
          )
          : undefined
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
              focusedId={runtime.focusedId}
              playerId={IW_ACTOR_PLAYER}
              positions={positions}
            />
            <IWSpeechBubbles
              bubbles={runtime.bubbles}
              positions={positions}
              language={scene.language}
              // Replay is cache-warm: the clip is already decoded, so re-hearing a line costs
              // nothing (§ 14 Q41). It is a deliberate press, so it uses the manual voice —
              // `speakSentence`, not the autoplay-gated automatic one.
              onReplay={text => { void tts.speakSentence(text); }}
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
              gap: 1, p: 3, bgcolor: 'rgba(0,0,0,0.72)',
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
          knownWords={knownWords}
          disabled={runtime.sending || runtime.frozen}
          sending={runtime.sending}
          onSend={runtime.say}
        />
      )}

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
