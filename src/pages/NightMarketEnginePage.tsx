import { useState, useMemo, useEffect } from 'react';
import {
  Box, Typography, Button, CircularProgress, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, Snackbar,
  Tooltip,
} from '@mui/material';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import BugReportIcon from '@mui/icons-material/BugReport';
import MarketEngineViewer from '../components/MarketEngineViewer';
import type { EngineLayer } from '../components/MarketEngineViewer';
import { useNightMarket } from '../hooks/useNightMarket';
import { useMinutePoints } from '../hooks/useMinutePoints';
import { usePageTitle } from '../hooks/usePageTitle';
import { usePixiPedestrians } from '../hooks/usePixiPedestrians';
import { NIGHT_MARKET_ASSET_MAP } from '../config/nightMarketRegistry';
import type { NightMarketAssetDef, MotionSpec } from '../config/nightMarketRegistry';
import { DEMO_STALLS } from '../config/walkwayRegistry';
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
  const [showDebug, setShowDebug] = useState(false);

  // Pedestrian simulation driven by Pixi's useTick — no separate RAF loop.
  const pedestrians = usePixiPedestrians();

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
        <Tooltip title={showDebug ? 'Hide debug overlay' : 'Show debug overlay (POI labels + pedestrian states)'}>
          <Button
            className="night-market-engine-debug-toggle"
            variant={showDebug ? 'contained' : 'outlined'}
            size="small"
            onClick={() => setShowDebug(v => !v)}
            sx={{
              minWidth: 0,
              color: showDebug ? 'black' : 'rgba(255,255,255,0.7)',
              borderColor: 'rgba(255,255,255,0.4)',
              backgroundColor: showDebug ? 'rgba(255,224,102,0.9)' : 'rgba(0,0,0,0.3)',
              '&:hover': { borderColor: 'white', backgroundColor: showDebug ? 'rgba(255,224,102,1)' : 'rgba(0,0,0,0.5)' },
            }}
          >
            <BugReportIcon fontSize="small" />
          </Button>
        </Tooltip>

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

      {/* Pixi.js canvas viewer */}
      <Box
        className="night-market-engine-canvas-container"
        sx={{ flexGrow: 1, width: '100%', height: '100%', position: 'relative' }}
      >
        <MarketEngineViewer layers={layers} onLayerTap={handleLayerTap} pedestrians={pedestrians} showGrid showDebug={showDebug} />
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
