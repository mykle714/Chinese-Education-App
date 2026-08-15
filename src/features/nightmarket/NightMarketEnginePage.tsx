import { useState, useEffect, useMemo } from 'react';
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
import CropFreeIcon from '@mui/icons-material/CropFree';
import WidgetsIcon from '@mui/icons-material/Widgets';
import ViewComfyIcon from '@mui/icons-material/ViewComfy';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import MarketEngineViewer, { ALL_DEBUG_OFF } from './MarketEngineViewer';
import type { DebugFlags } from './MarketEngineViewer';
import { useMarketWorld } from './useMarketWorld';
import { useMinutePoints } from '../../minutePoints/useMinutePoints';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useAuth } from '../../AuthContext';
import { adjustAuthorMinutes } from './nightMarketLayoutApi';
// The badge's "2d 3h 5m" formatter and its unit sizes now live in one place, shared
// with the friends leaderboard (src/utils/formatDuration.ts). This page keeps the
// day/hour/minute output it has always had — weeks are opt-in and it does not opt in.
import { MINUTES_PER_HOUR, formatMinutesAsDuration } from '../../utils/formatDuration';

/**
 * Night Market Engine Page
 *
 * Hosts the Pixi.js night market: the user's continent, assembled from authored templates
 * tiled onto their own layout, walked by ambient pedestrians, under a pan/zoom camera. The
 * page OWNS the layout load ({@link useMarketWorld}) and renders its spinner/error states,
 * handing the assembled world down to the presentational {@link MarketEngineViewer}.
 *
 * The economy is PUSH-based: minute points grant occupants server-side
 * (`NightMarketPlacementService.grantUnlocks`), and each layout read reflects the result. There
 * is no client-driven "unlock" action — the retired `useNightMarket` hook that used to gate this
 * page on the dead `/api/nightMarket/unlocks` endpoint was removed, along with the "N / M
 * unlocked" and "Next unlock at X pts" readouts it fed (both were permanently 0/0 and a static
 * config constant respectively). See docs/NIGHT_MARKET_FEATURE.md § "Unlock Flow".
 */

/**
 * Pedestrian load ladder for the scale harness (docs/REACT_NATIVE_MIGRATION.md action item 4a).
 *
 * `undefined` is deliberately FIRST so the page opens at the real ambient population and the knob
 * is opt-in — a load test must never be the default state of a user-facing page.
 *
 * The rungs bracket the 1,000-ped target roughly logarithmically: the interesting result is the
 * rung where frame time leaves 16.7ms, and a linear ladder would spend most of its steps past it.
 */
const PED_LOAD_STEPS: Array<number | undefined> = [undefined, 50, 200, 500, 1000];

/** Compact rung label for the debug button ("—", "200", "1k"). */
function pedLoadLabel(count: number | undefined): string {
  if (count === undefined) return '—';
  return count >= 1000 ? `${count / 1000}k` : String(count);
}

/**
 * The author minute-adjust tool's step buttons, ordered left-to-right (negatives first).
 * `amt` is always MINUTES — it is what gets sent to `/api/nightMarket/dev/adjustMinutes` and
 * what accumulates into `pendingDelta`; `label` is display-only, so the hour-sized steps read
 * as "1h"/"6h" instead of an opaque "+60"/"+360". The hour-sized steps mirror the unlock
 * schedule (docs/NIGHT_MARKET_TEMPLATES.md § Unlock economy), where 60 minutes is the
 * steady-state breakpoint of one unlock per hour; the ±1 step is the finest grain the
 * economy has, for walking the early breakpoints one unlock — one placeholder — at a time.
 */
const AUTHOR_MINUTE_STEPS: ReadonlyArray<{ amt: number; label: string }> = [
  { amt: -6 * MINUTES_PER_HOUR, label: '6h' },
  { amt: -MINUTES_PER_HOUR, label: '1h' },
  { amt: -1, label: '1' },
  { amt: 1, label: '1' },
  { amt: MINUTES_PER_HOUR, label: '1h' },
  { amt: 6 * MINUTES_PER_HOUR, label: '6h' },
];

function NightMarketEnginePage() {
  usePageTitle('Night Market Engine');
  const navigate = useNavigate();

  // Lock body scrolling so the mouse wheel is reserved for canvas zoom.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  const { accumulativeMinutePoints } = useMinutePoints();
  const { user } = useAuth();
  const isTemplateAuthor = !!user?.isTemplateAuthor;

  // Author minute-adjust tool state. `pendingDelta` accumulates the ±N button presses; Submit
  // fires one request. `displayNet` overrides the badge with the server's fresh net after a
  // submit (useMinutePoints doesn't re-fetch on its own). `reloadToken` bump forces the market
  // to re-read the layout so granted/decayed occupants (houses) redraw.
  const [pendingDelta, setPendingDelta] = useState(0);
  const [displayNet, setDisplayNet] = useState<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // The layout load lives HERE, not in the canvas: this page owns the spinner and the error
  // panel, and the viewer below is presentational over the result. Previously the scene fetched
  // it internally and its `error` was discarded, so a failed layout load drew a silently blank
  // market while the page showed a spinner for an unrelated (dead) endpoint.
  const marketWorld = useMarketWorld(reloadToken);
  const { world, loading: isLoading, error } = marketWorld;

  // Occupant progress across the whole continent: how many placeholder unit slots currently hold
  // an occupant, out of every slot the tiled templates expose. This replaces the old
  // "N / M unlocked" counter, which read from the retired unlock economy and was always "0 / 0".
  const { filledSlots, totalSlots } = useMemo(() => {
    const areas = world?.placeholderAreas ?? [];
    return { filledSlots: areas.filter((a) => a.filled).length, totalSlots: areas.length };
  }, [world]);

  const shownMinutes = displayNet ?? accumulativeMinutePoints;

  const submitPendingDelta = async () => {
    if (pendingDelta === 0 || submitting) return;
    setSubmitting(true);
    setAdjustError(null);
    try {
      const { totalMinutePoints } = await adjustAuthorMinutes(pendingDelta);
      setDisplayNet(totalMinutePoints);
      setPendingDelta(0);
      setReloadToken((t) => t + 1); // redraw the market with the new occupant set
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : 'Failed to adjust minutes');
    } finally {
      setSubmitting(false);
    }
  };

  const [debug, setDebug] = useState<DebugFlags>(ALL_DEBUG_OFF);
  const toggleDebugFlag = (key: keyof DebugFlags) =>
    setDebug(prev => ({ ...prev, [key]: !prev[key] }));

  // Pedestrian load-test knob (docs/REACT_NATIVE_MIGRATION.md action item 4a). Cycles the ambient
  // walker count so frame cost can be measured against a known load instead of being argued about.
  // `undefined` = the hook's own default, i.e. the population a real user sees.
  const [pedLoadStep, setPedLoadStep] = useState(0);
  const pedCount = PED_LOAD_STEPS[pedLoadStep];
  const cyclePedLoad = () => setPedLoadStep(prev => (prev + 1) % PED_LOAD_STEPS.length);

  // Gridlines are off by default; toggled on via the debug overlay column.
  const [showGrid, setShowGrid] = useState(false);

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
            className="night-market-engine-occupant-counter"
            variant="body2"
            sx={{ color: 'rgba(255,255,255,0.8)', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', mt: 0.5 }}
          >
            {filledSlots} / {totalSlots} stalls
          </Typography>
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
          { key: 'template-bounds', label: 'Toggle template boundaries + names', icon: <CropFreeIcon fontSize="small" />, active: debug.templateBounds, onClick: () => toggleDebugFlag('templateBounds') },
          { key: 'placeholder-bounds', label: 'Toggle placeholder boundaries + labels', icon: <WidgetsIcon fontSize="small" />, active: debug.placeholderBounds, onClick: () => toggleDebugFlag('placeholderBounds') },
          { key: 'grid', label: 'Toggle gridlines', icon: <GridOnIcon fontSize="small" />, active: showGrid, onClick: () => setShowGrid(prev => !prev) },
          { key: 'chunked-terrain', label: 'Toggle baked terrain chunks (zoomed-out ground)', icon: <ViewComfyIcon fontSize="small" />, active: debug.chunkedTerrain, onClick: () => toggleDebugFlag('chunkedTerrain') },
          // Load-test knob — DEV ONLY. Unlike the overlays above this one degrades the page on
          // purpose: it would let any user seed 1,000 walkers and stall their own device, so it
          // must not exist in a production build. The button shows the current rung because a load
          // you have to hover to read is a load you will forget you set.
          ...(import.meta.env.DEV ? [{
            key: 'ped-load',
            label: `Pedestrian load — ${pedCount ?? 'default'} walkers (tap to cycle)`,
            icon: (
              <Box component="span" className="night-market-engine-ped-load-value" sx={{ fontSize: 12, fontWeight: 700, lineHeight: 1 }}>
                {pedLoadLabel(pedCount)}
              </Box>
            ),
            active: pedCount !== undefined,
            onClick: cyclePedLoad,
          }] : []),
        ]).map(({ key, label, icon, active, onClick }) => (
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

      {/* Account minute-points balance — bottom-left pill (the account's current
          minutes, i.e. the server's totalMinutePoints, surfaced by useMinutePoints as
          accumulativeMinutePoints). Kept clear of the title (top-left), debug column
          (top-right) and unlock snackbar (bottom-center). */}
      <Box
        className="night-market-engine-minutes-badge"
        sx={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.5,
          py: 0.75,
          borderRadius: 999,
          backgroundColor: 'rgba(0,0,0,0.45)',
          border: '1px solid rgba(255,255,255,0.25)',
          pointerEvents: 'none',
        }}
      >
        <AccessTimeIcon
          className="night-market-engine-minutes-badge-icon"
          sx={{ fontSize: 18, color: 'rgba(255,224,102,0.95)' }}
        />
        <Typography
          className="night-market-engine-minutes-badge-value"
          variant="body2"
          sx={{ color: 'white', fontWeight: WEIGHT.bold, textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}
        >
          {formatMinutesAsDuration(shownMinutes)}
        </Typography>
      </Box>

      {/* Author minute-adjust tool — a row of ±N signal buttons + Submit next to the minutes
          badge, visible only to template authors (isTemplateAuthor). Presses accumulate into
          pendingDelta on the client; Submit fires ONE request that writes an earn (+) or loss (−)
          signal and reconciles the market. See docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md. */}
      {isTemplateAuthor && (
        <Box
          className="night-market-engine-author-tool"
          sx={{
            position: 'absolute',
            bottom: 16,
            left: 140,
            right: 16,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            flexWrap: 'wrap',
          }}
        >
          {/* Step sizes track the unlock schedule's shape (docs/NIGHT_MARKET_TEMPLATES.md
              § Unlock economy): 15 = a few mid-curve unlocks, 60 = the steady-state breakpoint
              (1 unlock/hour), 360 = six hours, enough to grow the continent in one press. The
              hour-sized steps are LABELLED in hours (1h / 6h) because "+360" reads as an opaque
              minute count; `amt` stays in minutes — the label is display-only. */}
          {AUTHOR_MINUTE_STEPS.map(({ amt, label }) => (
            <Button
              key={amt}
              className={`night-market-engine-author-tool-btn night-market-engine-author-tool-btn-${amt > 0 ? 'plus' : 'minus'}${Math.abs(amt)}`}
              variant="contained"
              size="small"
              onClick={() => setPendingDelta((d) => d + amt)}
              sx={{
                // Widened from 44 so the 4-glyph labels (+360 / −360) don't wrap or clip.
                minWidth: 52,
                height: 32,
                p: 0,
                fontWeight: WEIGHT.bold,
                color: 'white',
                backgroundColor: amt > 0 ? 'rgba(76,175,80,0.85)' : 'rgba(211,47,47,0.85)',
                '&:hover': { backgroundColor: amt > 0 ? 'rgba(76,175,80,1)' : 'rgba(211,47,47,1)' },
              }}
            >
              {amt > 0 ? `+${label}` : `-${label}`}
            </Button>
          ))}
          <Box
            className="night-market-engine-author-tool-pending"
            sx={{
              px: 1.25,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 1,
              backgroundColor: 'rgba(0,0,0,0.45)',
              border: '1px solid rgba(255,255,255,0.25)',
              color: 'white',
              fontWeight: WEIGHT.bold,
              minWidth: 56,
              justifyContent: 'center',
            }}
          >
            {pendingDelta > 0 ? `+${pendingDelta}` : pendingDelta}
          </Box>
          <Button
            className="night-market-engine-author-tool-submit"
            variant="contained"
            size="small"
            disabled={pendingDelta === 0 || submitting}
            onClick={submitPendingDelta}
            sx={{ height: 32, fontWeight: WEIGHT.bold, backgroundColor: 'rgba(255,224,102,0.95)', color: 'black', '&:hover': { backgroundColor: 'rgba(255,224,102,1)' } }}
          >
            Submit
          </Button>
        </Box>
      )}

      {/* Pixi.js canvas viewer */}
      <Box
        className="night-market-engine-canvas-container"
        sx={{ flexGrow: 1, width: '100%', height: '100%', position: 'relative' }}
      >
        <MarketEngineViewer showGrid={showGrid} debug={debug} pedCount={pedCount} world={marketWorld} />
      </Box>

      {/* Author minute-adjust error (403 for non-authors, network, etc.) */}
      <Snackbar
        className="night-market-engine-author-tool-error"
        open={!!adjustError}
        autoHideDuration={5000}
        onClose={() => setAdjustError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setAdjustError(null)}>{adjustError}</Alert>
      </Snackbar>
    </Box>
    </LeafPage>
  );
}

export default NightMarketEnginePage;
