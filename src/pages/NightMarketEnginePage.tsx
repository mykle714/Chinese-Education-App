import { useState, useMemo, useEffect } from 'react';
import {
  Box, Typography, Button, CircularProgress, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, Snackbar,
  Tooltip,
} from '@mui/material';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import CropFreeIcon from '@mui/icons-material/CropFree';
import StorefrontIcon from '@mui/icons-material/Storefront';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import DirectionsWalkIcon from '@mui/icons-material/DirectionsWalk';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import PinDropIcon from '@mui/icons-material/PinDrop';
import GridOnIcon from '@mui/icons-material/GridOn';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import MarketEngineViewer, {
  ALL_DEBUG_OFF, ALL_DEBUG_ON,
} from '../components/MarketEngineViewer';
import type { EngineLayer, DebugFlags } from '../components/MarketEngineViewer';
import { useNightMarket } from '../hooks/useNightMarket';
import { useMinutePoints } from '../hooks/useMinutePoints';
import { usePageTitle } from '../hooks/usePageTitle';
import { usePixiPedestrians } from '../hooks/usePixiPedestrians';
import { NIGHT_MARKET_ASSET_MAP } from '../config/nightMarketRegistry';
import type { NightMarketAssetDef, MotionSpec } from '../config/nightMarketRegistry';
import { DEMO_STALLS } from '../config/tileRegistry';
import { isoToScreen, computeLayerZ } from '../utils/isometric';

/**
 * Night Market Engine Page
 *
 * Rebuilds the night market scene on top of Pixi.js (WebGL scene graph) instead
 * of the hand-rolled Canvas2D pipeline in MarketViewerPage. Shares all data sources:
 * the same unlock hook, asset registry, isometric math, and motion utilities.
 */
function NightMarketEnginePage() {
  usePageTitle('Night Market Engine');

  // Lock body scrolling so the mouse wheel is reserved for canvas zoom.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  const {
    unlocks,
    isLoading,
    error,
    nextThreshold,
    totalUnlockable,
    canUnlock,
    unlockNext,
    newUnlock,
    clearNewUnlock,
    isUnlocking,
  } = useNightMarket();

  const { accumulativeMinutePoints } = useMinutePoints();

  const [selectedAsset, setSelectedAsset] = useState<NightMarketAssetDef | null>(null);
  const [debug, setDebug] = useState<DebugFlags>(ALL_DEBUG_OFF);

  const toggleDebugFlag = (key: keyof DebugFlags) =>
    setDebug(prev => ({ ...prev, [key]: !prev[key] }));

  // Pedestrian simulation driven by Pixi's useTick — no separate RAF loop.
  const pedestrians = usePixiPedestrians(100);

  // Mirror the `frozen` debug flag into the pedestrian sim's speed multiplier.
  useEffect(() => {
    pedestrians.setSpeedMultiplier(debug.frozen ? 0 : 1);
  }, [debug.frozen, pedestrians]);

  // Build EngineLayer list from user unlocks + demo stalls — same logic as MarketViewerPage.
  const layers = useMemo(() => {
    const result: EngineLayer[] = [];

    const pushAsset = (assetDef: NightMarketAssetDef, isoX: number, isoY: number, groupIdSuffix = '') => {
      const { screenX, screenY } = isoToScreen(isoX, isoY);
      for (const sl of assetDef.layers) {
        const motions: MotionSpec[] = [];
        if (assetDef.motion) motions.push(assetDef.motion);
        if (sl.motion) motions.push(sl.motion);
        result.push({
          imagePath: sl.imagePath,
          x: screenX + (sl.offsetX ?? 0),
          y: screenY + (sl.offsetY ?? 0),
          zIndex: computeLayerZ(isoX, isoY, sl.slot),
          scale: sl.scale ?? assetDef.scale,
          groupId: (sl.groupId ?? assetDef.assetId) + groupIdSuffix,
          motions: motions.length > 0 ? motions : undefined,
          frameAnimation: sl.frameAnimation,
        });
      }
    };

    for (const unlock of unlocks) {
      const assetDef = NIGHT_MARKET_ASSET_MAP.get(unlock.assetId);
      if (!assetDef) {
        console.warn(`[NM Engine] Unknown assetId: ${unlock.assetId}`);
        continue;
      }
      pushAsset(assetDef, assetDef.isoX, assetDef.isoY);
    }

    for (const stall of DEMO_STALLS) {
      pushAsset(stall, stall.isoX, stall.isoY, '-demo');
    }

    return result;
  }, [unlocks]);

  const handleLayerTap = (id: string | number) => {
    if (typeof id === 'string') {
      const assetDef = NIGHT_MARKET_ASSET_MAP.get(id);
      if (assetDef) setSelectedAsset(assetDef);
    }
  };

  const earnedCount = unlocks.filter(u => u.unlockOrder > 0).length;

  if (isLoading) {
    return (
      <Box
        className="night-market-engine-loading"
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 64px)' }}
      >
        <CircularProgress className="night-market-engine-loading-spinner" />
      </Box>
    );
  }

  if (error) {
    return (
      <Box className="night-market-engine-error" sx={{ p: 3 }}>
        <Alert className="night-market-engine-error-alert" severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box
      className="night-market-engine-page"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: 'calc(100vh - 64px)',
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
            sx={{ color: 'white', fontWeight: 'bold', textShadow: '2px 2px 4px rgba(0,0,0,0.8)', display: 'flex', alignItems: 'baseline', gap: 1.5 }}
          >
            Night Market
            <Typography
              component="span"
              variant="h6"
              sx={{ color: 'rgba(255,255,255,0.55)', fontWeight: 'normal' }}
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
        {canUnlock && (
          <Button
            className="night-market-engine-unlock-button"
            variant="contained"
            color="warning"
            startIcon={<LockOpenIcon />}
            onClick={unlockNext}
            disabled={isUnlocking}
            sx={{ textShadow: '1px 1px 2px rgba(0,0,0,0.3)', fontWeight: 'bold' }}
          >
            {isUnlocking ? 'Unlocking...' : 'Unlock New Item'}
          </Button>
        )}

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
          { key: 'all-on', label: 'Turn all debug overlays on', icon: <VisibilityIcon fontSize="small" />, active: false, onClick: () => setDebug(ALL_DEBUG_ON) },
          { key: 'all-off', label: 'Turn all debug overlays off', icon: <VisibilityOffIcon fontSize="small" />, active: false, onClick: () => setDebug(ALL_DEBUG_OFF) },
          { key: 'footprints', label: 'Toggle stand footprint outlines', icon: <CropFreeIcon fontSize="small" />, active: debug.footprints, onClick: () => toggleDebugFlag('footprints') },
          { key: 'standLabels', label: 'Toggle stand and pedestrian name labels', icon: <StorefrontIcon fontSize="small" />, active: debug.standLabels, onClick: () => toggleDebugFlag('standLabels') },
          { key: 'streetLabels', label: 'Toggle street name labels', icon: <AltRouteIcon fontSize="small" />, active: debug.streetLabels, onClick: () => toggleDebugFlag('streetLabels') },
          { key: 'pedestrianStates', label: 'Toggle pedestrian FSM state labels', icon: <DirectionsWalkIcon fontSize="small" />, active: debug.pedestrianStates, onClick: () => toggleDebugFlag('pedestrianStates') },
          { key: 'origin', label: 'Toggle iso (0, 0) origin crosshair', icon: <GpsFixedIcon fontSize="small" />, active: debug.origin, onClick: () => toggleDebugFlag('origin') },
          { key: 'coordinates', label: 'Toggle (isoX, isoY) coordinates on stands and pedestrians', icon: <PinDropIcon fontSize="small" />, active: debug.coordinates, onClick: () => toggleDebugFlag('coordinates') },
          { key: 'tileInfo', label: 'Toggle per-tile street/edge/node info (small font — zoom in to read)', icon: <GridOnIcon fontSize="small" />, active: debug.tileInfo, onClick: () => toggleDebugFlag('tileInfo') },
          { key: 'frozen', label: 'Freeze all pedestrians', icon: <PauseCircleOutlineIcon fontSize="small" />, active: debug.frozen, onClick: () => toggleDebugFlag('frozen') },
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
        <MarketEngineViewer layers={layers} onLayerTap={handleLayerTap} pedestrians={pedestrians} showGrid debug={debug} />
      </Box>

      {/* Item info dialog */}
      <Dialog
        className="night-market-engine-item-dialog"
        open={!!selectedAsset}
        onClose={() => setSelectedAsset(null)}
        maxWidth="xs"
        fullWidth
      >
        {selectedAsset && (
          <>
            <DialogTitle className="night-market-engine-item-dialog-title">{selectedAsset.displayName}</DialogTitle>
            <DialogContent className="night-market-engine-item-dialog-content">
              <Typography className="night-market-engine-item-description" variant="body1">
                {selectedAsset.description}
              </Typography>
              <Typography
                className="night-market-engine-item-type"
                variant="caption"
                color="text.secondary"
                sx={{ mt: 1, display: 'block' }}
              >
                Type: {selectedAsset.unlockType}
              </Typography>
            </DialogContent>
            <DialogActions className="night-market-engine-item-dialog-actions">
              <Button className="night-market-engine-item-dialog-close" onClick={() => setSelectedAsset(null)}>
                Close
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

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
  );
}

export default NightMarketEnginePage;
