import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { WEIGHT } from '../../theme/scale';
import {
  Box, Typography, Button, Alert, Snackbar, Tooltip,
} from '@mui/material';
import LeafPage from '../../components/LeafPage';
import DelayedCircularProgress from '../../components/DelayedCircularProgress';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import GridOnIcon from '@mui/icons-material/GridOn';
import GrassIcon from '@mui/icons-material/Grass';
import LabelIcon from '@mui/icons-material/Label';
import MarketEngineViewer, { ALL_DEBUG_OFF } from './MarketEngineViewer';
import type { DebugFlags } from './MarketEngineViewer';
import { useNightMarket } from './useNightMarket';
import { useMinutePoints } from '../../minutePoints/useMinutePoints';
import { usePageTitle } from '../../hooks/usePageTitle';
import { NIGHT_MARKET_ASSET_MAP } from '../../engine/market/nightMarketRegistry';

/**
 * Night Market Engine Page
 *
 * Hosts the Pixi.js night market. The market was rebuilt on the free-farm 2:1
 * tileset: the page renders a static grass-plateau terrain (see
 * {@link MarketEngineViewer} / FarmTerrainLayer) with a pan/zoom camera. The
 * former demo stalls + walking pedestrians were removed; the unlock economy
 * (minute-points → unlocks) still runs, ready to drive an authored layout later.
 */
function NightMarketEnginePage() {
  usePageTitle('Night Market Engine');
  const navigate = useNavigate();

  // Lock body scrolling so the mouse wheel is reserved for canvas zoom.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  const {
    isLoading,
    error,
    nextThreshold,
    totalUnlockable,
    canUnlock,
    newUnlock,
    clearNewUnlock,
    unlocks,
  } = useNightMarket();

  const { accumulativeMinutePoints } = useMinutePoints();

  const [debug, setDebug] = useState<DebugFlags>(ALL_DEBUG_OFF);
  const toggleDebugFlag = (key: keyof DebugFlags) =>
    setDebug(prev => ({ ...prev, [key]: !prev[key] }));

  // Gridlines are off by default; toggled on via the debug overlay column.
  const [showGrid, setShowGrid] = useState(false);

  const earnedCount = unlocks.filter(u => u.unlockOrder > 0).length;

  // Night Market is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md): no footer, DOWN back
  // arrow (→ Home), slides up on enter / down on exit. All three states render
  // through one LeafPage so it stays a single instance and the enter slide plays once.
  if (isLoading) {
    return (
      <LeafPage title="Night Market" onBack={() => navigate("/")}>
        <Box
          className="night-market-engine-loading"
          sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, minHeight: 0 }}
        >
          <DelayedCircularProgress className="night-market-engine-loading-spinner" />
        </Box>
      </LeafPage>
    );
  }

  if (error) {
    return (
      <LeafPage title="Night Market" onBack={() => navigate("/")}>
        <Box className="night-market-engine-error" sx={{ p: 3 }}>
          <Alert className="night-market-engine-error-alert" severity="error">{error}</Alert>
        </Box>
      </LeafPage>
    );
  }

  return (
    <LeafPage title="Night Market" onBack={() => navigate("/")} className="night-market-engine-root">
    <Box
      className="night-market-engine-page"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Header overlay */}
      <Box
        className="night-market-engine-header"
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 100%)',
          p: 2,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <Box className="night-market-engine-title-block">
          <Typography
            className="night-market-engine-title"
            variant="h4"
            component="h1"
            sx={{ color: 'white', fontWeight: WEIGHT.bold, textShadow: '2px 2px 4px rgba(0,0,0,0.8)', display: 'flex', alignItems: 'baseline', gap: 1.5 }}
          >
            Night Market
            <Typography
              component="span"
              variant="h6"
              sx={{ color: 'rgba(255,255,255,0.55)', fontWeight: WEIGHT.regular }}
            >
              (Pixi.js)
            </Typography>
          </Typography>
          <Typography
            className="night-market-engine-unlock-counter"
            variant="body2"
            sx={{ color: 'rgba(255,255,255,0.8)', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', mt: 0.5 }}
          >
            {earnedCount} / {totalUnlockable} unlocked
          </Typography>
        </Box>

        <Box className="night-market-engine-header-actions" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {!canUnlock && totalUnlockable > earnedCount && (
          <Typography
            className="night-market-engine-next-unlock-hint"
            variant="body2"
            sx={{ color: 'rgba(255,255,255,0.7)', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', textAlign: 'right', mt: 1 }}
          >
            Next unlock at {nextThreshold} pts ({accumulativeMinutePoints} / {nextThreshold})
          </Typography>
        )}
        </Box>
      </Box>

      {/* Debug overlay toggle column — accumulates down the right edge */}
      <Box
        className="night-market-engine-debug-column"
        sx={{
          position: 'absolute',
          top: 96,
          right: 16,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        {([
          { key: 'all-off', label: 'Turn all debug overlays off', icon: <VisibilityOffIcon fontSize="small" />, active: false, onClick: () => setDebug(ALL_DEBUG_OFF) },
          { key: 'origin', label: 'Toggle iso (0, 0) origin crosshair', icon: <GpsFixedIcon fontSize="small" />, active: debug.origin, onClick: () => toggleDebugFlag('origin') },
          { key: 'grass', label: 'Toggle grass-tile overlay', icon: <GrassIcon fontSize="small" />, active: debug.grass, onClick: () => toggleDebugFlag('grass') },
          { key: 'overlay-labels', label: 'Toggle overlay-tile labels (which sprite each cell used)', icon: <LabelIcon fontSize="small" />, active: debug.overlayLabels, onClick: () => toggleDebugFlag('overlayLabels') },
          { key: 'grid', label: 'Toggle gridlines', icon: <GridOnIcon fontSize="small" />, active: showGrid, onClick: () => setShowGrid(prev => !prev) },
        ] as const).map(({ key, label, icon, active, onClick }) => (
          <Tooltip key={key} title={label} placement="left">
            <Button
              className={`night-market-engine-debug-toggle night-market-engine-debug-toggle-${key}`}
              variant={active ? 'contained' : 'outlined'}
              size="small"
              onClick={onClick}
              sx={{
                minWidth: 0,
                width: 36,
                height: 36,
                p: 0,
                color: active ? 'black' : 'rgba(255,255,255,0.7)',
                borderColor: 'rgba(255,255,255,0.4)',
                backgroundColor: active ? 'rgba(255,224,102,0.9)' : 'rgba(0,0,0,0.3)',
                '&:hover': { borderColor: 'white', backgroundColor: active ? 'rgba(255,224,102,1)' : 'rgba(0,0,0,0.5)' },
              }}
            >
              {icon}
            </Button>
          </Tooltip>
        ))}
      </Box>

      {/* Pixi.js canvas viewer */}
      <Box
        className="night-market-engine-canvas-container"
        sx={{ flexGrow: 1, width: '100%', height: '100%', position: 'relative' }}
      >
        <MarketEngineViewer showGrid={showGrid} debug={debug} />
      </Box>

      {/* New unlock snackbar */}
      <Snackbar
        className="night-market-engine-unlock-snackbar"
        open={!!newUnlock}
        autoHideDuration={4000}
        onClose={clearNewUnlock}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={
          newUnlock
            ? `Unlocked: ${NIGHT_MARKET_ASSET_MAP.get(newUnlock.assetId)?.displayName || newUnlock.assetId}!`
            : ''
        }
      />
    </Box>
    </LeafPage>
  );
}

export default NightMarketEnginePage;
