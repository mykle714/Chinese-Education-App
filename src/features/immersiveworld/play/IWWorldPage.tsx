import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import LeafPage from '../../../components/LeafPage';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { listPlayableScenes } from './iwPlayApi';
import type { IWSceneSummary } from '../../../../server/contracts/iw';

/**
 * IWWorldPage — `/immersive-world`, the list of places you can walk into (§ 14 Q9).
 *
 * LAYER: page. It answers one question — which scene — and then gets out of the way.
 *
 * ⚠️ **IT IS A LEAF, NOT A HUB, AND THAT IS TEMPORARY.** § 9's cadence is once per day and
 * Q9 wants the hp row to show today's STATE (available / in progress / done); none of that
 * exists yet, because phase 2 has no run row to read it from. So this is a plain list, and
 * the day the run row lands it should become the surface Q9 describes rather than growing a
 * second one beside it.
 *
 * ⚠️ **A LEARNER SEES PUBLISHED SCENES ONLY**, and only in their own study language. Both
 * are the server's decision (`/play/scenes`), not a filter applied here — an author's drafts
 * must not be enumerable from a client that stops filtering.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 12 phase 2, § 14 Q9.
 */
export default function IWWorldPage() {
  usePageTitle();
  const navigate = useNavigate();
  const [scenes, setScenes] = useState<IWSceneSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPlayableScenes()
      .then(data => { if (!cancelled) setScenes(data.scenes); })
      .catch(() => { if (!cancelled) setError('Could not load the world right now.'); });
    return () => { cancelled = true; };
  }, []);

  return (
    <LeafPage title="Immersive World" onBack={() => navigate('/')} className="iw-world-page">
      <Box className="iw-world-page__body" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {scenes === null && !error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}><CircularProgress size={20} /></Box>
        )}
        {error && <Typography sx={{ opacity: 0.7, fontSize: 14 }}>{error}</Typography>}
        {scenes?.length === 0 && (
          <Typography className="iw-world-page__empty" sx={{ opacity: 0.7, fontSize: 14 }}>
            No scenes have been published for your language yet.
          </Typography>
        )}
        {scenes?.map(scene => (
          <Box
            key={scene.id}
            className="iw-world-page__scene"
            onClick={() => navigate(`/immersive-world/${scene.id}`)}
            sx={{
              p: 1.5, borderRadius: 2, cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.12)',
              bgcolor: 'rgba(255,255,255,0.04)',
            }}
          >
            <Typography className="iw-world-page__scene-name" sx={{ fontSize: 16 }}>{scene.name}</Typography>
            <Typography className="iw-world-page__scene-meta" sx={{ fontSize: 11, opacity: 0.55 }}>
              {scene.castCount} {scene.castCount === 1 ? 'person' : 'people'}
            </Typography>
          </Box>
        ))}
      </Box>
    </LeafPage>
  );
}
