/**
 * @deprecated DOM/Canvas2D renderer — superseded by NightMarketEnginePage (Pixi).
 * Accessible at /night-market-legacy for dev reference. Do not add new features here.
 */
import { useState, useMemo, useEffect } from 'react';
import { Box, Typography, Button, CircularProgress, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Snackbar } from '@mui/material';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import MarketViewer from '../components/MarketViewer';
import { useNightMarket } from '../hooks/useNightMarket';
import { useWorkPoints } from '../hooks/useWorkPoints';
import { usePageTitle } from '../hooks/usePageTitle';
import { usePedestrians } from '../hooks/usePedestrians';
import { NIGHT_MARKET_ASSET_MAP } from '../config/nightMarketRegistry';
import type { NightMarketAssetDef, FrameAnimation, MotionSpec } from '../config/nightMarketRegistry';
import { DEMO_STALLS, WALKWAYS } from '../config/walkwayRegistry';
import { isoToScreen, computeLayerZ } from '../utils/isometric';
import { polylineLength, pointAtT } from '../utils/walkwayTraversal';
import floorTileUrl from '../assets/test assets/floor.png';

/**
 * Night Market Page
 *
 * Renders the user's personal night market scene using server-persisted unlock data.
 * Each user's market is unique — items are randomly unlocked as they earn work points.
 * Base set items are seeded automatically on first visit.
 */
function MarketViewerPage() {
  usePageTitle("Night Market");

  // Lock body scrolling so the mouse wheel is reserved for canvas zoom.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
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

  const { accumulativeWorkPoints } = useWorkPoints();

  // State for the item info dialog (shown on tap)
  const [selectedAsset, setSelectedAsset] = useState<NightMarketAssetDef | null>(null);

  // Build layers array from unlocks: flatten each asset's sub-layers into renderable Layer objects.
  // Each stand may produce multiple layers (background, entity, foreground, overlay), all sharing a groupId.
  const layers = useMemo(() => {
    const result: Array<{
      imagePath: string;
      x: number;
      y: number;
      zIndex: number;
      scale: number;
      groupId: string;
      motions?: MotionSpec[];
      frameAnimation?: FrameAnimation;
    }> = [];

    const pushAsset = (assetDef: NightMarketAssetDef, isoX: number, isoY: number, groupIdSuffix = '') => {
      const { screenX, screenY } = isoToScreen(isoX, isoY);
      for (const sl of assetDef.layers) {
        // Compose asset-level and layer-level motions additively.
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

    // User's server-persisted unlocks.
    // Skip the base-set stall at the origin — it sits on top of the central
    // hub where all walkways meet and would obscure the demo navigation view.
    for (const unlock of unlocks) {
      const assetDef = NIGHT_MARKET_ASSET_MAP.get(unlock.assetId);
      if (!assetDef) {
        console.warn(`[Night Market] Unknown assetId: ${unlock.assetId}`);
        continue;
      }
      if (assetDef.isoX === 0 && assetDef.isoY === 0) continue;
      pushAsset(assetDef, assetDef.isoX, assetDef.isoY);
    }

    // Walkway tiles — render each walkway as floor.png tiles sampled along the
    // polyline at fixed iso intervals. Rendered in the background slot so
    // stalls and pedestrians always draw on top. Walkways do not participate
    // in hit-testing groups (no groupId set), so tapping them falls through.
    const TILE_STEP_ISO = 7;  // iso-distance between consecutive tiles
    const TILE_SCALE = 1.0;
    for (const walkway of WALKWAYS) {
      const totalLen = polylineLength(walkway.polyline);
      if (totalLen === 0) continue;
      const tileCount = Math.max(2, Math.ceil(totalLen / TILE_STEP_ISO) + 1);
      for (let i = 0; i < tileCount; i++) {
        const t = i / (tileCount - 1);
        const { isoPos } = pointAtT(walkway.polyline, t);
        const { screenX, screenY } = isoToScreen(isoPos[0], isoPos[1]);
        result.push({
          imagePath: floorTileUrl,
          x: screenX,
          y: screenY,
          zIndex: computeLayerZ(isoPos[0], isoPos[1], 'background'),
          scale: TILE_SCALE,
          groupId: `walkway-${walkway.walkwayId}-${i}`,
        });
      }
    }

    // Demo stalls — scene infrastructure placed at walkway endpoints to
    // demonstrate the pedestrian navigation system.
    for (const stall of DEMO_STALLS) {
      pushAsset(stall, stall.isoX, stall.isoY, '-demo');
    }

    return result;
  }, [unlocks]);

  // Iso grid overlay: fine (every 10, green) underneath, major (every 100, red)
  // on top. Walkway polylines render on top of both as tan paths.
  const gridLines = useMemo(() => {
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number; color?: string }> = [];
    const MIN = -500;
    const MAX = 500;
    const buildGrid = (step: number, color: string) => {
      for (let v = MIN; v <= MAX; v += step) {
        const a = isoToScreen(v, MIN);
        const b = isoToScreen(v, MAX);
        lines.push({ x1: a.screenX, y1: a.screenY, x2: b.screenX, y2: b.screenY, color });
        const c = isoToScreen(MIN, v);
        const d = isoToScreen(MAX, v);
        lines.push({ x1: c.screenX, y1: c.screenY, x2: d.screenX, y2: d.screenY, color });
      }
    };
    // Push green first so red major lines render on top.
    buildGrid(10, 'rgba(0, 200, 0, 0.5)');
    buildGrid(100, 'rgba(255, 0, 0, 0.9)');

    return lines;
  }, []);

  // Pedestrians — hook owns state + the per-frame tick. getDrawables is called
  // by MarketViewer each frame inside its render loop.
  const { getDrawables: getPedestrianDrawables, getStates: getPedestrianStates } = usePedestrians();

  // Sprite image paths that may appear in dynamicDrawables — preloaded once.
  const dynamicSpriteImages = useMemo(() => {
    const set = new Set<string>();
    for (const p of getPedestrianStates()) set.add(p.sprite.imagePath);
    return Array.from(set);
    // getPedestrianStates is stable; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Handle tap on a layer in the canvas — show item info dialog.
   *  Receives groupId (assetId string) for grouped layers, or a numeric index for ungrouped ones. */
  const handleLayerTap = (id: string | number) => {
    if (typeof id === 'string') {
      const assetDef = NIGHT_MARKET_ASSET_MAP.get(id);
      console.log('[Night Market] Tapped group:', id, assetDef ?? '(no asset def)');
      if (assetDef) {
        setSelectedAsset(assetDef);
      }
    } else {
      console.log('[Night Market] Tapped ungrouped layer index:', id);
    }
  };

  // Calculate earned unlock count (exclude base set items with unlockOrder = 0)
  const earnedCount = unlocks.filter(u => u.unlockOrder > 0).length;

  if (isLoading) {
    return (
      <Box className="night-market-loading" sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 64px)' }}>
        <CircularProgress className="night-market-loading-spinner" />
      </Box>
    );
  }

  if (error) {
    return (
      <Box className="night-market-error" sx={{ p: 3 }}>
        <Alert className="night-market-error-alert" severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box
      className="night-market-page"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: 'calc(100vh - 64px)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Header overlay with title and unlock info */}
      <Box
        className="night-market-header"
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
        <Box className="night-market-title-block">
          <Typography
            className="night-market-title"
            variant="h4"
            component="h1"
            sx={{
              color: 'white',
              fontWeight: 'bold',
              textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
            }}
          >
            Night Market
          </Typography>
          <Typography
            className="night-market-unlock-counter"
            variant="body2"
            sx={{
              color: 'rgba(255,255,255,0.8)',
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
              mt: 0.5,
            }}
          >
            {earnedCount} / {totalUnlockable} unlocked
          </Typography>
        </Box>

        {/* Unlock button — visible when user has enough points */}
        {canUnlock && (
          <Button
            className="night-market-unlock-button"
            variant="contained"
            color="warning"
            startIcon={<LockOpenIcon />}
            onClick={unlockNext}
            disabled={isUnlocking}
            sx={{
              textShadow: '1px 1px 2px rgba(0,0,0,0.3)',
              fontWeight: 'bold',
            }}
          >
            {isUnlocking ? 'Unlocking...' : 'Unlock New Item'}
          </Button>
        )}

        {/* Progress toward next unlock when not yet eligible */}
        {!canUnlock && totalUnlockable > earnedCount && (
          <Typography
            className="night-market-next-unlock-hint"
            variant="body2"
            sx={{
              color: 'rgba(255,255,255,0.7)',
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
              textAlign: 'right',
              mt: 1,
            }}
          >
            Next unlock at {nextThreshold} pts ({accumulativeWorkPoints} / {nextThreshold})
          </Typography>
        )}
      </Box>

      {/* Canvas viewer — fills remaining space */}
      <Box
        className="night-market-canvas-container"
        sx={{
          flexGrow: 1,
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      >
        <MarketViewer
          layers={layers}
          gridLines={gridLines}
          onLayerTap={handleLayerTap}
          dynamicSpriteImages={dynamicSpriteImages}
          dynamicDrawables={getPedestrianDrawables}
        />
      </Box>

      {/* Item info dialog — shown when a layer is tapped */}
      <Dialog
        className="night-market-item-dialog"
        open={!!selectedAsset}
        onClose={() => setSelectedAsset(null)}
        maxWidth="xs"
        fullWidth
      >
        {selectedAsset && (
          <>
            <DialogTitle className="night-market-item-dialog-title">{selectedAsset.displayName}</DialogTitle>
            <DialogContent className="night-market-item-dialog-content">
              <Typography className="night-market-item-description" variant="body1">{selectedAsset.description}</Typography>
              <Typography className="night-market-item-type" variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Type: {selectedAsset.unlockType}
              </Typography>
            </DialogContent>
            <DialogActions className="night-market-item-dialog-actions">
              <Button className="night-market-item-dialog-close" onClick={() => setSelectedAsset(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* New unlock notification snackbar */}
      <Snackbar
        className="night-market-unlock-snackbar"
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

export default MarketViewerPage;
