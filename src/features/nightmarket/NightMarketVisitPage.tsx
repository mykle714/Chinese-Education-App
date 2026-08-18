import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Typography } from '@mui/material';
import LeafPage from '../../components/LeafPage';
import DelayedCircularProgress from '../../components/DelayedCircularProgress';
import MarketEngineViewer, { ALL_DEBUG_OFF } from './MarketEngineViewer';
import { useMarketWorld } from './useMarketWorld';
import { usePageTitle } from '../../hooks/usePageTitle';
import { FONTS } from '../../theme/fonts';
import { SIZE, WEIGHT } from '../../theme/scale';

/**
 * Somebody else's night market, read-only — the profile page's "Visit their night
 * market" destination (docs/USER_PROFILE_PAGE.md § Night market visit).
 *
 * ── WHY THIS IS A SEPARATE PAGE FROM NightMarketEnginePage ────────────────────
 * That page is not just a viewer: it owns the minute-point badge, the occupant
 * counter, the template-author minute-adjust tool (a WRITE against the signed-in
 * account) and the debug-overlay column. Every one of those is about the viewer's own
 * market and would be either wrong or dangerous pointed at someone else's — the
 * minutes badge would show the visitor's wallet beside a stranger's market, and the
 * author tool would silently credit the visitor while they look at another continent.
 *
 * Hiding those controls behind an `isVisit` prop would leave the write paths mounted
 * and one conditional away from firing. A separate page has no such paths to hide:
 * it renders the camera and the world and nothing else. The two share everything that
 * is genuinely common — {@link useMarketWorld} and {@link MarketEngineViewer}.
 *
 * The read itself is also read-only on the server: the visit branch of
 * `GET /api/nightMarket/layout?userId=` suppresses the first-load hub seeding, so
 * opening a market that does not exist yet reports that rather than creating one.
 */
function NightMarketVisitPage() {
  const { userId } = useParams<{ userId: string }>();
  usePageTitle('Night Market');
  const navigate = useNavigate();

  // Lock body scrolling so the mouse wheel is reserved for canvas zoom — same rule as
  // the owner's page.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  // No reload token: nothing on this page can change the world it is showing.
  const marketWorld = useMarketWorld(0, userId ?? null);
  const { loading: isLoading, error } = marketWorld;

  const back = () => navigate(-1);

  if (isLoading) {
    return (
      <LeafPage title="Night Market" onBack={back}>
        <Box
          className="night-market-visit-loading"
          sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, minHeight: 0 }}
        >
          <DelayedCircularProgress className="night-market-visit-loading-spinner" />
        </Box>
      </LeafPage>
    );
  }

  if (error) {
    return (
      <LeafPage title="Night Market" onBack={back}>
        <Box className="night-market-visit-error" sx={{ p: 3 }}>
          <Alert className="night-market-visit-error-alert" severity="info">{error}</Alert>
        </Box>
      </LeafPage>
    );
  }

  return (
    <LeafPage title="Night Market" onBack={back} className="night-market-visit-root">
      <Box
        className="night-market-visit-page"
        sx={{ display: 'flex', flexDirection: 'column', width: '100%', flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}
      >
        {/* A standing "you are a guest here" marker. Without it a visited market is
            pixel-identical to your own, and the only difference — that none of your
            controls are here — reads as the page being broken. */}
        <Box
          className="night-market-visit-header"
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            p: 1.5,
            background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 100%)',
            pointerEvents: 'none',
          }}
        >
          <Typography
            className="night-market-visit-header-label"
            sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, fontWeight: WEIGHT.bold, color: 'white' }}
          >
            Visiting
          </Typography>
        </Box>

        <Box
          className="night-market-visit-canvas-container"
          sx={{ flexGrow: 1, width: '100%', height: '100%', position: 'relative' }}
        >
          {/* Grid and debug overlays are off and have no toggles: they are authoring
              tools, and this page is not an authoring surface. */}
          <MarketEngineViewer showGrid={false} debug={ALL_DEBUG_OFF} world={marketWorld} />
        </Box>
      </Box>
    </LeafPage>
  );
}

export default NightMarketVisitPage;
