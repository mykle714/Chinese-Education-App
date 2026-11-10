import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import MobileTabScreen from "../../components/MobileTabScreen";
import { SLAB_FOOTER_TOTAL_HEIGHT } from "../../components/MobileFooter";
import {
    BOB_HEIGHT,
    CARD_THICKNESS,
    ISO,
    IsoScene,
    boundsOf,
    cardStackMetrics,
    makeCameraProjector,
    makeProjector,
    planFogClouds,
    prism,
    type FogCover,
    type Projector,
    projectOutline,
    roundedRectWorld,
    shadowFootprint,
    type CloudSky,
    type IsoRainFall,
    type IsoSnowFall,
    type WindSky,
    blendWash,
    NO_WASH,
} from "./iso";
import { useAuth } from "../../AuthContext";
import { useTestingFeatures } from "../../hooks/useTestingFeatures";
import { useFlpReadyCounts } from "../../hooks/useFlpReadyCounts";
import { useFocusLever, type FocusLever } from "./useFocusLever";
import { useMasteredCounts } from "../../hooks/useMasteredCounts";
import { useSwipeCommit, type SwipeDirection } from "../../hooks/useSwipeCommit";
import { builtinCollectionCount } from "../flashcards/builtinCollections";
import SpaceBackdrop, { type SpaceBand } from "./SpaceBackdrop";
import SpeedLines from "./SpeedLines";
import WorldIndicator from "./WorldIndicator";
import CardsCue from "./CardsCue";
import DeckTowerAvatar from "./DeckTowerAvatar";
import BankingAlwaysPlayToggle from "./BankingAlwaysPlayToggle";
import { DailyBankingOptOut, DailyBankingProvider } from "../../minutePoints/dailyBanking/DailyBankingContext";
import BankingEmbers from "../../minutePoints/dailyBanking/BankingEmbers";
import TapToStartHint from "./TapToStartHint";
import { TOWER_DECKS, otherTowerDeck, type TowerDeckId } from "./towerDecks";
import CardSplat from "./CardSplat";
import { SkyTrafficCloudShadows, SkyTrafficLayer, SkyTrafficSource } from "./SkyTraffic";
import { useSkyTrafficStore } from "./skyTrafficStore";
import DeckTowerPlatform, { type PlateFace } from "./DeckTowerPlatform";
import { useDeckSwap } from "./useDeckSwap";
import { useBuildProgress, useFixtureGrow } from "./useBuildProgress";
import { useTowerResize } from "./useTowerResize";
import { pickTowerGrow, pickTowerShrink } from "./towerResizes";
import { TOWER_MODES, bandTotal } from "./towerModes";
import { useWorldPan, type PanCarry } from "./useWorldPan";
import { CARD_D, CARD_W, FLOOR_Z, PLATFORM_THICKNESS, TOWER_LAYOUT } from "./towerPlatforms";
import { TOWER_WORLDS, WORLD_ORDER, type TowerWorldId } from "./towerWorlds";
import { useTowerStudy } from "./useTowerStudy";
import { litWorld } from "./timeOfDay";
import { useHintPawnVisit } from "../flashcards/FlashcardsLearnPage/hintPawn/hintPawnVisit";
import { useTimeOfDay } from "./useTimeOfDay";
import { useTowerWeather } from "./useTowerWeather";
import { RAIN_ALPHA, RAIN_LEAN, RAIN_STROKE_PX, SNOW_ALPHA, SNOW_R, SNOW_SPEED, SNOW_SWAY, SNOW_SWAY_RATE, isEffectless, weatherCloudCount, weatherEffect } from "./towerWeather";
import { useTowerSnow } from "./useTowerSnow";
import { SNOW_COMPONENTS, type SnowComponent } from "./towerSnow";
import SnowResetChip from "./SnowResetChip";
import { useSoftIntro } from "../../softIntro/useSoftIntro";
import { useWeatherEffectsEnabled } from "../../hooks/useWeatherEffectsSetting";
import WeatherToggle from "./WeatherToggle";
import LightningStrikeChips from "./LightningStrikeChips";
import { useLightningFlashes } from "./useLightningFlashes";
import {
    NO_LIGHTNING,
    STRIKE_CHANCE,
    pickStrikePoint,
    struckPawn,
    withStrike,
    type PlatformLightning,
    type TowerStrike,
    type WorldLightning,
} from "./towerLightning";
import { weatherDaySky, worldsUnderWeather } from "./weatherSky";
import { TOWER_TYPE_SX } from "./towerType";
import TimeOfDayToggle from "./TimeOfDayToggle";
import AuroraToggle from "./AuroraToggle";
import TesterSharedRow from "./TesterSharedRow";
import { auroraCanRoll, auroraShowing, auroraStrength, useAuroraGlowWash, useTowerAurora } from "./towerAurora";
import ForcedBreakPicker from "./ForcedBreakPicker";
import type { Language } from "../../types";
import TowerCoverCard from "./TowerCoverCard";
import { readTowerHeight, writeTowerHeight } from "./towerHeightStore";
import { useHideFooter } from "../../hooks/useHideFooter";
import { useThemeColor } from "../../hooks/useThemeColor";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { useLocation } from "react-router-dom";
import { NOTEBOOK_PATH, useNotebookTotal } from "../flashcards/writingNotebook/notebookEntry";
import { useDiscoverNavigation } from "../../hooks/useDiscoverNavigation";
import { useCategoryCounts } from "../../hooks/useCategoryCounts";
import { LEARN_NOW_LOW_THRESHOLD } from "../../../server/contracts/wire";
import type { GameExit } from "../../games/runtime/gameExit";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { useClaimStudySurface } from "../../minutePoints/studySurface";
import TowerCardsPage from "./TowerCardsPage";
import HomeStage from "./home/HomeStage";
import { useHomeEntrance } from "./home/useHomeEntrance";
import { useHomePull } from "./home/useHomePull";
import { homeDueOnLaunch, markHomeTaken } from "./home/homeLaunch";
import type { ScreenPoint } from "../../utils/pageTransition";
import { TOWER_SCENE_CLASS, TOWER_SECTION_CLASS, heightAbovePlatform, platformScrollTop, towerSceneOf, useTowerCardsScroll } from "./towerScroll";
import { withLens } from "../flashcards/collectionRef";
import type { VocabEntry } from "../../types";

/**
 * The flp session a study lays over the tower (docs/DECK_TOWER.md § "Studying the tower"):
 * the flp page itself, given its `tower` host contract (flpTowerHost.ts). Lazy — its own
 * chunk, loaded when the first world's session mounts parked — and
 * memoised, so the camera's per-frame re-renders of this page never re-render a session.
 */
const StudySession = lazy(() =>
    import("../flashcards/FlashcardsLearnPage").then((m) => ({ default: React.memo(m.default) }))
);

/**
 * `/` — the app's landing page and the footer's Flashcards tab: the learner's Learning deck drawn as a stack of cards standing on an
 * isometric platform (docs/DECK_TOWER.md), built from the iso art framework in ./iso
 * (docs/ISO_ART_FRAMEWORK.md).
 *
 * Layer: page (feature module `src/features/deckTower`). Reads each world's two figures
 * through existing hooks, no new endpoint: Learning is the bar's cards that are OFF
 * COOLDOWN right now (`useFlpReadyCounts` — the same readiness rule the flp deals by), in
 * all four utcm bands (towerModes.ts → Mix), and Mastered is the bar's whole Mastered total
 * (`useMasteredCounts`). A card that comes off cooldown while the page is up joins the tower
 * as its own sky drop (`releaseCooldowns`, docs/DECK_TOWER.md § "Cooldown releases").
 *
 * Every world also has a focus lever standing on its floor. It changes the tower's height
 * in place, and every such change plays an animation from the tower-resize library
 * (towerResizes.ts, played by one useTowerResize per world): a shrink (focus on) or a grow
 * (focus off) — docs/DECK_TOWER.md § "Tower resizes".
 *
 * Up to three WORLDS (towerWorlds.ts), side by side: reading ← main (core) → writing, the
 * skill ones only while the account has that goal on (`users.readingGoal` /
 * `writingGoal`). One world is on screen at a time — the same platform in that world's
 * colours. A horizontal swipe (or the floating corner arrow, WorldIndicator) dashes the camera to the
 * neighbour: the scene whips off, speed lines stream past, the sky turns the new world's
 * colour and the new platform slides in (useWorldPan.ts, SpeedLines.tsx). Every world's
 * tower is already standing when you arrive (main's at its last stored height — below).
 *
 * Every world has its OWN floor plate and deck: tapping the plate swaps that world's
 * tower between its two decks — the plate turns over, a transition clears the old tower,
 * a new pawn arrives and the new tower grows (one useDeckSwap per world,
 * docs/DECK_TOWER_TRANSITIONS.md).
 *
 * Tapping a Learning tower STUDIES it in place: the camera dives onto the tower's top
 * card, the flp session is laid over it, and the tower loses a card per correct mark
 * (useTowerStudy.ts, docs/DECK_TOWER.md § "Studying the tower"). On the way back out it is
 * reconciled with the server's count. The main world's Learning tower also OPENS at the
 * height it last stood at on this device and animates to today's figure
 * (towerHeightStore.ts, § "Opening at the last height").
 *
 * DAILY BANKING (docs/DAILY_MINUTE_BANKING.md): td carries the once-per-streak-day banking
 * run (moved here from the old Home page on 2026-11-04). `DailyBankingProvider` wraps
 * the whole screen so the header flame, the avatar (DeckTowerAvatar → BankingAvatarButton) and `BankingEmbers` read
 * the one run; the study sessions sit inside `DailyBankingOptOut`, because their own
 * headers' flames would otherwise draw the run and steal the embers' launch anchor.
 *
 * This file only LAYS OUT the scene: which world is up, what stands on it, and the
 * viewBox. The platform draws itself (DeckTowerPlatform.tsx).
 *
 * The footer's Flashcards tab (first tab; it took `/` from the old Home page on 2026-11-04), so
 * it renders in a non-scrolling MobileTabScreen and ends with a FooterSpacer: the scene
 * shrinks to fit above the footer bar rather than sliding under it.
 */

/** Screen px per world unit before the viewBox scales the scene to the frame. */
const UNIT = 20;

/** The platform's layout — the same in every world. */
const LAYOUT = TOWER_LAYOUT;

/**
 * World units of extra fall past the screen's bottom edge, so the outgoing tower's top
 * card (and the pawn's head) are fully clear before the swap refits the scene.
 */
const FALL_CLEARANCE = 1;

/**
 * A deck swap arriving at Learning drops the pawn and then the focus lever from the sky.
 * The pawn lands on the trap door's slam; the lever lands this many ms after it, so the
 * two arrivals read as a one-two rather than a single thud (`leverArgs`).
 */
const LEVER_LANDS_AFTER_PAWN_MS = 500;

/**
 * Gap between the platform's shadow and the scene's bottom edge (= the footer bar's top),
 * in world units. Raised from 0.4 (2026-11-04) to lift the platform off the footer and
 * leave sky for the bottom row of cues (WorldIndicator, CardsCue).
 */
const BOTTOM_MARGIN = 1.2;

/**
 * Clear sky kept above the top card, in world units, so a tower scrolled to its top
 * sits below the header (the scene starts at the very top of the
 * screen) rather than behind them.
 */
const TOP_HEADROOM = 9;

/**
 * A tower grow's camera move (docs/DECK_TOWER.md § "Tower resizes"; a grow with
 * `usesCamera`, e.g. the sky drop). The camera scrolls so the landing (the standing
 * tower's top) sits this far down the screen, leaving sky above it for the drop to fall
 * through…
 */
const LANDING_ON_SCREEN = 0.62;
/** …taking CAMERA_BASE_MS + CAMERA_MS_PER_PX per px scrolled, capped at CAMERA_MAX_MS. */
const CAMERA_BASE_MS = 260;
const CAMERA_MS_PER_PX = 0.5;
const CAMERA_MAX_MS = 900;
/** The drop's underside starts this many world units over the screen's top edge… */
const DROP_CLEARANCE = 1;
/** …and never less than this far above its landing. */
const DROP_MIN_LIFT = 8;

/**
 * The Tap to Start hint (TapToStartHint) is fixed to the platform where the top of a tower of
 * this many cards stands — it does not follow the live tower. A shorter tower leaves sky
 * under its arrow; a taller one stands in front of it and covers it.
 */
const TAP_HINT_FIT_CARDS = 40;

/**
 * How far into the dive (its eased 0 → 1) the tower UI is gone, and from where the session's
 * header and buttons fade in. Not its CARDS: the camera dives onto the count card as it
 * stands, and the session's first card is uncovered by sliding that card off once the camera
 * is down (useTowerStudy `uncovering`, TowerCoverCard).
 */
const TOWER_UI_GONE_AT = 0.4;
const SESSION_FADE_FROM = 0.6;
/** Clouds and wind are gone this far into the dive: their drifts are planned in the fixed view. */
const SKY_TRAFFIC_GONE_AT = 0.3;
/**
 * The night wash's fade over the dive (and back over the climb) is drawn in this many steps
 * of `e`: each step is a new wash, which re-washes the scene's palette. 24 steps of a 7% cast
 * is far below a visible jump.
 */
const WASH_FADE_STEPS = 24;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * A world swipe commits past this fraction of the stage's width (or on a flick)…
 * Measured in FINGER travel, so `DRAG_FOLLOW` changes how far the scene has moved by
 * then, not how far the finger has to go.
 */
const WORLD_SWIPE_FRACTION = 0.18;
/** …but never less than this many px. */
const WORLD_SWIPE_MIN_PX = 48;
/**
 * How far the scene moves per px of finger travel while a world swipe is held: toward a
 * neighbour (slightly MORE than the finger, so the world feels light to throw), and
 * toward an edge with none (a stiff rubber band).
 */
const DRAG_FOLLOW = 1.15;
const DRAG_FOLLOW_EDGE = 0.12;
/** The scene springing back after a released swipe that did not commit. */
const DRAG_SNAP_BACK = "translate 220ms ease-out";

/**
 * The tower's cloud band: cloud BASES sit at the height of these cards on the tower
 * (card k's underside is (k − 1) · CARD_THICKNESS above the floor), and the clouds
 * drift slowly past the tower's four sides (useCloudDrifts). Clouds are WEATHER, not
 * altitude: they fly only under the `cloudy` kind (towerWeather.ts → `weatherCloudCount`,
 * which also sets how many), in every world, whatever the card count. On a deck that stops
 * inside the band, its top is lowered to SKY_CEILING_ABOVE_TOP over the settled tower's
 * top, so the clouds drift by the tower rather than empty sky; on a deck under `from` the
 * band stays whole, above the framed scene and so out of sight (`skyBand`).
 */
const CLOUD_BAND_CARDS = { from: 150, to: 200 };

/**
 * The tower's wind band: gusts (streaks ending in a curl, IsoWind) sweep past the tower's
 * four sides with their baselines at the height of these cards (useWindGusts). They start
 * blowing when the build-up puts the `from`-th card on the tower, so a deck under 350
 * never has wind; a deck short of `to` lowers the band's top the same way as the clouds'.
 * It sits in the empty sky between the clouds (150–200) and space (450+).
 */
const WIND_BAND_CARDS = { from: 350, to: 400 };
/** How many gusts may be playing at once. Two keeps the band breezy without clutter. */
const WIND_GUSTS_MAX = 2;

/**
 * The reading and writing worlds' sky is measured at least this many cards high (the wind
 * band's top), so the travellers' bands stay at their card heights instead of shrinking to
 * a short tower. Today that only affects their clouds (weather, every world): WIND is
 * earned in every world — it blows only once the tower reaches WIND_BAND_CARDS.from
 * (`windActive`; the skill worlds' always-on wind was dropped 2026-11-08).
 * The scene (and so the scroll) is still framed to the TOWER's top, never to this sky:
 * a band above a short tower flies above the screen's top, out of sight.
 */
const SKILL_WORLD_SKY_CARDS = WIND_BAND_CARDS.to;

/**
 * Where the sky turns to space: as the middle of the screen climbs from the height of
 * card `from` to card `to`, the backdrop darkens from the sky's blue to deep navy and the
 * stars fade in (SpaceBackdrop). It is ALTITUDE, so scrolling back down brings the sky
 * back, and a tower that never reaches this band never sees space.
 */
const SPACE_BAND_CARDS = { from: 450, to: 650 };

/**
 * The rain's cloud base, as a card height on the tower's axis: IsoRain's drops (in front of
 * the tower) start no higher than this. It sits a quarter of the way into the space band,
 * the middle of the sky rain's own fade (SpaceBackdrop → `WEATHER_FADE_TO`, gone by half
 * way), so a climbed tower leaves both rains behind together.
 */
const RAIN_CEILING_CARD = SPACE_BAND_CARDS.from + (SPACE_BAND_CARDS.to - SPACE_BAND_CARDS.from) * 0.25;

/**
 * On a tower that stops inside a sky band (clouds, wind), the band's top is lowered to
 * this many world units over the settled tower's top, so its travellers stay beside the
 * tower rather than in empty sky above it.
 */
const SKY_CEILING_ABOVE_TOP = 3;

/**
 * World units (as screen height) the fog's field reaches above the platform's back corner
 * (§ Weather → fog). Over the band from there to the scene's bottom edge the fog covers the
 * screen's full width, so it rolls over the sky either side of the slab, not just over it.
 */
const FOG_ABOVE_SLAB = 3;

/**
 * A card band → world-z band: card k's underside is (k − 1) · CARD_THICKNESS over the
 * floor. The top is capped at SKY_CEILING_ABOVE_TOP over the tower's settled top
 * (`towerTopZ`, measured from the floor).
 */
function skyBand(cards: { from: number; to: number }, towerTopZ: number): { zMin: number; zMax: number } {
    const bottom = (cards.from - 1) * CARD_THICKNESS;
    const fullTop = cards.to * CARD_THICKNESS;
    // A tower that stops below the band leaves it whole rather than inverting it (the cap
    // would put its top under its bottom). Only the weather-driven clouds fly over such a
    // tower; the card-gated wind never starts there.
    const cappedTop = Math.min(fullTop, towerTopZ + SKY_CEILING_ABOVE_TOP);
    const top = cappedTop > bottom ? cappedTop : fullTop;
    return { zMin: FLOOR_Z + bottom, zMax: FLOOR_Z + top };
}

/**
 * The scene's framing for a tower of `towerCount` cards, its travellers' bands measured
 * against a sky `skyCards` high
 * (§ "Framing" in the component). Pure, so a tower resize can plan its camera move and
 * drop against the scene it is ABOUT to refit to (`startResize`).
 */
function fitScene(proj: Projector, towerCount: number, skyCards: number) {
    const slab = prism(proj, LAYOUT.platform, -PLATFORM_THICKNESS, BOB_HEIGHT).bounds;
    // Only the ground's z is read here, and it is the same in every world.
    const ground = TOWER_WORLDS.core.ground;
    const shadow = boundsOf(
        projectOutline(proj, roundedRectWorld(shadowFootprint(LAYOUT.platform, -PLATFORM_THICKNESS, ground)), ground.z)
    );
    const metrics = cardStackMetrics(towerCount);
    const towerTop = BOB_HEIGHT + FLOOR_Z + metrics.bodyHeight + metrics.topThickness;
    const tower = prism(proj, LAYOUT.card, FLOOR_Z, towerTop).bounds;
    // The sky the travellers' bands are measured against: the tower's own top, or higher
    // in a skill world. It does NOT frame the scene — the scroll stops at the tower's top.
    const skyMetrics = cardStackMetrics(skyCards);
    const skyTop = BOB_HEIGHT + FLOOR_Z + skyMetrics.bodyHeight + skyMetrics.topThickness;
    const centre = proj.project(LAYOUT.platform.x + LAYOUT.platform.w / 2, LAYOUT.platform.y + LAYOUT.platform.d / 2, 0);
    const centreX = centre.x;
    const halfWidth = Math.max(centreX - slab.minX, slab.maxX - centreX) + UNIT * 0.8;
    const minY = Math.min(slab.minY, tower.minY) - UNIT * TOP_HEADROOM;
    const maxY = Math.max(slab.maxY, shadow.maxY) + UNIT * BOTTOM_MARGIN;
    const width = 2 * halfWidth;
    const height = maxY - minY;
    // The clouds' and wind's skies: each band in world z around the tower, and
    // the screen width every crossing must run across.
    const towerTopZ = skyTop - BOB_HEIGHT;
    const screenSpan = { minX: centreX - halfWidth, maxX: centreX + halfWidth };
    const cloudSky: CloudSky = { band: skyBand(CLOUD_BAND_CARDS, towerTopZ), around: LAYOUT.card, screenSpan };
    const windSky: WindSky = { band: skyBand(WIND_BAND_CARDS, towerTopZ), around: LAYOUT.card, screenSpan };
    // The sky → space band, as viewBox y's on the tower's axis (card k's underside is
    // (k − 1) · CARD_THICKNESS up). The platform's bob is ignored — 0.35 units over a
    // ~76-unit blend.
    const axisY = (card: number) =>
        proj.project(LAYOUT.card.x + LAYOUT.card.w / 2, LAYOUT.card.y + LAYOUT.card.d / 2, FLOOR_Z + (card - 1) * CARD_THICKNESS).y;
    const spaceBand: SpaceBand = {
        viewBoxMinY: minY,
        viewBoxWidth: width,
        yFrom: axisY(SPACE_BAND_CARDS.from),
        yTo: axisY(SPACE_BAND_CARDS.to),
    };
    // How far the tower must drop to clear the screen when a transition sends it down:
    // its top (or the platform's back corner, which stands above the pawn's head, when
    // the tower is short) to the scene's bottom edge — the scroller's bottom, since a
    // plate tap scrolls there first.
    const fallDistance = Math.max(0, (maxY - Math.min(slab.minY, tower.minY)) / proj.heightUnit) + FALL_CLEARANCE;
    return {
        viewBox: `${centreX - halfWidth} ${minY} ${width} ${height}`,
        aspectRatio: `${width} / ${height}`,
        cloudSky,
        windSky,
        spaceBand,
        // IsoRain's cloud base (RAIN_CEILING_CARD), as a viewBox y.
        rainCeilingY: axisY(RAIN_CEILING_CARD),
        // The screen box the fog must cover (IsoFog, planFogClouds): the scene's full width,
        // from FOG_ABOVE_SLAB over the slab's back corner down to the scene's bottom edge.
        fogCover: { minX: centreX - halfWidth, maxX: centreX + halfWidth, minY: slab.minY - UNIT * FOG_ABOVE_SLAB, maxY } as FogCover,
        fallDistance,
        // Where a transition's card splat bursts from (CardSplat): the scene's bottom
        // edge, across the tower's screen-x span.
        splatFloor: { y: maxY, minX: tower.minX, maxX: tower.maxX },
        // The raw frame, and the tower axis' viewBox y at world z — for a tower grow's
        // camera move and drop (`startResize`).
        minX: centreX - halfWidth,
        minY,
        maxY,
        width,
        height,
        // The settled tower's highest point on screen (its top face's back corner) — where
        // the Tap to Start hint's arrow points on a TAP_HINT_FIT_CARDS tower.
        towerTopY: tower.minY,
        axisYAtZ: (z: number) => proj.project(LAYOUT.card.x + LAYOUT.card.w / 2, LAYOUT.card.y + LAYOUT.card.d / 2, z).y,
    };
}

/** The route state that opens the page on a given world (`{ towerWorld }`), validated (nav state is untyped). */
function readTowerWorldState(state: unknown): TowerWorldId | undefined {
    const w = (state as { towerWorld?: unknown } | null)?.towerWorld;
    return typeof w === "string" && (WORLD_ORDER as readonly string[]).includes(w) ? (w as TowerWorldId) : undefined;
}

/**
 * Stamp the world on screen into td's OWN history entry, as `{ towerWorld }` route state —
 * the same shape an exit (`NOTEBOOK_EXIT`, `SORT_EXIT`) pushes and `readTowerWorldState`
 * reads at mount.
 *
 * Why: the header arrow on a page launched from td (notebook, acp) lands on the right
 * world because it pushes `/` with `state.exitTo.state`. A browser-owned Back — the
 * iOS/Android edge swipe, the browser back button, Android system back — is a `POP`
 * instead: it returns to td's original entry, whose state named whatever world td was
 * OPENED on (usually none → main). Writing the current world into that entry as the
 * learner moves between worlds makes every POP land where the arrow would
 * (docs/BACK_NAVIGATION.md § 2.1 Rule 1).
 *
 * `window.history.replaceState`, not `navigate(…, { replace: true })`: this must not be a
 * router navigation — that would re-render every location subscriber on each world swipe
 * and count as a REPLACE. React Router 7's BrowserRouter keeps an entry's route state at
 * `history.state.usr` (beside its `key` and `idx`, which are preserved), and re-reads it
 * from there on the POP. The in-memory `location.state` goes stale until then, which is
 * fine: td reads it only at mount.
 *
 * Keyed on the CHOSEN world (`pan.world`), not the shown one, so the brief moment before
 * the goals load (when only main is shown) does not overwrite a remembered writing world.
 *
 * Referenced by docs: DECK_TOWER.md § "Worlds" (Getting back), BACK_NAVIGATION.md § 3.1.
 */
function useRememberTowerWorld(world: TowerWorldId): void {
    useEffect(() => {
        const entry = window.history.state as { usr?: unknown } | null;
        // Not an entry React Router wrote (no `idx`/`key` wrapper) — leave it alone.
        if (!entry || typeof entry !== "object") return;
        const usr = entry.usr && typeof entry.usr === "object" ? (entry.usr as Record<string, unknown>) : {};
        if (usr.towerWorld === world) return;
        window.history.replaceState({ ...entry, usr: { ...usr, towerWorld: world } }, "");
    }, [world]);
}

/**
 * Where the Writing Notebook's Back leads when it was opened from the writing world's
 * paper stack (docs/DECK_TOWER.md § "The notebook stack"): back here, on the writing
 * world. The notebook reads it as `state.exitTo` (WritingNotebookPage → `leave`).
 */
const NOTEBOOK_EXIT: GameExit = { path: "/", label: "Deck Tower", state: { towerWorld: "writing" } };

/**
 * Where Add Cards' Back leads when it was opened from the main world's mini sort platform
 * (docs/DECK_TOWER.md § "The sort platform"): back here, on main. acp reads it as
 * `state.exitTo` (AddCardsPage → `leave`).
 */
const SORT_EXIT: GameExit = { path: "/", label: "Deck Tower", state: { towerWorld: "core" } };

/** Notebook points per sheet on the writing world's paper stack — keeps a busy notebook's stack small. */
const NOTEBOOK_POINTS_PER_SHEET = 20;

/**
 * The paper stack's sheets for a notebook total: one to start, so it is a button before
 * anything is written, plus one per full NOTEBOOK_POINTS_PER_SHEET points (0–19 → 1,
 * 20–39 → 2, …).
 */
function notebookSheets(total: number): number {
    return 1 + Math.floor(Math.max(0, total) / NOTEBOOK_POINTS_PER_SHEET);
}

const DeckTowerPage: React.FC = () => {
    const { user } = useAuth();
    const slideNavigate = useSlideNavigate();
    // The Writing Notebook's total: the writing world's paper stack stands 1 + this many
    // sheets. Undefined while loading, on failure, with the `writingNotebook` flag off or
    // for a non-Chinese account — no stack is drawn then.
    const notebookTotal = useNotebookTotal();
    // Add Cards (acp) for the account's language — the main world's mini sort platform opens it.
    const { sortPath } = useDiscoverNavigation();
    // "Cards low": the core Learning count (U+T+C, cooling or not — NOT the tower's own
    // off-cooldown figure) under LEARN_NOW_LOW_THRESHOLD. It makes the main world's mini
    // sort platform hop (`hopping` below), nudging the learner toward Add Cards.
    // Keyed on `ok`, not `loaded`: a failed fetch reads as 0 and must not make it jump.
    // (`learningLow` itself is derived below, once `mastered` is in scope.)
    const coreCategoryCounts = useCategoryCounts("core");
    // Ready-now (off-cooldown) counts per band of each bar. Fetched on open; a card coming
    // off cooldown while the page is up is counted in by its own sky drop
    // (§ "Cooldown releases", `releaseCooldowns`).
    const readyCounts: Record<TowerWorldId, ReturnType<typeof useFlpReadyCounts>> = {
        core: useFlpReadyCounts("core"),
        reading: useFlpReadyCounts("reading"),
        writing: useFlpReadyCounts("writing"),
    };
    const mastered = useMasteredCounts();

    // Each world's tower resizes (docs/DECK_TOWER.md § "Tower resizes"): the focus lever's
    // shrinks and grows.
    const resizes: Record<TowerWorldId, ReturnType<typeof useTowerResize>> = {
        core: useTowerResize(),
        reading: useTowerResize(),
        writing: useTowerResize(),
    };

    // ── Worlds ────────────────────────────────────────────────────────────────────
    // The skill worlds follow the account's goals (`users.readingGoal` / `writingGoal`).
    const worldShown = (id: TowerWorldId) =>
        id === "core" || (id === "reading" ? user?.readingGoal === true : user?.writingGoal === true);
    const shownWorlds = WORLD_ORDER.filter(worldShown);
    // A goal switched ON while td is mounted (the AccountSheet opens over it) may also have
    // switched that world's focus on (docs/FOCUS_MODE.md § 1a). The skill worlds' counts
    // were read with the goal off, so they still stand the whole pile with focus off:
    // re-read them so the world opens on today's set and its lever already pulled. Keyed
    // on the goal booleans, never on `token` (CLAUDE.md § silent token refresh).
    const readingGoalOn = user?.readingGoal === true;
    const writingGoalOn = user?.writingGoal === true;
    const goalsBefore = useRef({ reading: readingGoalOn, writing: writingGoalOn });
    useEffect(() => {
        if (readingGoalOn && !goalsBefore.current.reading) readyCounts.reading.reload();
        if (writingGoalOn && !goalsBefore.current.writing) readyCounts.writing.reload();
        goalsBefore.current = { reading: readingGoalOn, writing: writingGoalOn };
        // `reload` is a stable useCallback; the counts objects themselves change every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [readingGoalOn, writingGoalOn]);
    // ── Time of day (docs/DECK_TOWER.md § "Time of day") ─────────────────────────
    // The light every world is drawn under right now: each world's sky at this hour,
    // and the wash over everything on it. Feature testers can pin a phase
    // (TimeOfDayToggle). `testingFeatures` = a `users.isFeatureTester` account AND the
    // Settings "Enable testing features" switch (useTestingFeatures).
    const testingFeatures = useTestingFeatures();
    const timeOfDay = useTimeOfDay(testingFeatures);
    const dayLight = timeOfDay.light;
    // The flp session (HTML over the scene) and the slab footer are NOT washed. They used to
    // be, through an SVG feColorMatrix `url()` filter, but WebKit rasterises an SVG filter on
    // HTML on the CPU: every repaint inside the session (a key press, the eip opening)
    // re-filtered the whole layer, which made the flp's taps lag at night. Cut 2026-10-30
    // (docs/DECK_TOWER.md § "Time of day" → "The wash").
    // ── Weather (docs/DECK_TOWER.md § "Weather") ──────────────────────────────────
    // The learner's real weather, when the per-device Settings switch is on: particles in
    // the backdrop (`weatherEffect` → WeatherLayer), fog over the platform (DeckTowerPlatform → IsoFog). Feature testers can pin a kind
    // (WeatherToggle). The weather also sets main's day sky colour (weatherSky.ts,
    // docs/TOWER_WEATHER_SKY.md); reading and writing keep their fixed skies.
    const towerWeather = useTowerWeather(testingFeatures);
    const weather = towerWeather.weather;
    // ── Aurora (docs/DECK_TOWER.md § "Time of day" → "Aurora") ────────────────────
    // Reading only: a 1% roll on this visit's first clear night, kept until the page is left
    // (towerAurora.ts). Its strength rides the pan's palette into SpaceBackdrop; while it
    // shows, the weather's effects and the shooting stars are suppressed (`auroraUp`).
    const aurora = useTowerAurora(auroraCanRoll(dayLight.shootingStars, weather, towerWeather.settled), testingFeatures);
    const auroraOf = (id: TowerWorldId) => auroraStrength(id, aurora.active, dayLight.nightShare);
    // The weather's effects as observed — `weatherFx` (below, after the world is known)
    // is this minus whatever a showing aurora suppresses.
    // Memoised on the observation's fields (a tester pin is a new object every render) so
    // SpaceBackdrop's repaint effect and the particle loop don't restart on unrelated renders.
    const observedWeatherFx = useMemo(() => {
        const fx = weatherEffect(weather);
        return isEffectless(fx) ? undefined : fx;
    }, [weather?.kind, weather?.intensity]); // eslint-disable-line react-hooks/exhaustive-deps
    // The same rain in iso space: drops falling in front of the tower and splashing on the
    // platform (DeckTowerPlatform → IsoRain). The sky's canvas rain is behind the svg, so
    // without this the platform and the tower hid every drop that would have reached them.
    // Drizzle, rain and storm all draw it; snow and fog do not.
    const rainFall = useMemo<IsoRainFall | undefined>(
        () =>
            observedWeatherFx && observedWeatherFx.rainDensity > 0
                ? {
                      density: observedWeatherFx.rainDensity,
                      speed: observedWeatherFx.rainSpeed,
                      length: observedWeatherFx.rainLength,
                      lean: RAIN_LEAN,
                      alpha: RAIN_ALPHA,
                      strokePx: RAIN_STROKE_PX,
                  }
                : undefined,
        [observedWeatherFx],
    );
    // The same snow in iso space: flakes falling in front of the tower and settling on the
    // platform (DeckTowerPlatform → IsoSnow), with the sky's flake look (towerWeather.ts SNOW_*).
    const snowFall = useMemo<IsoSnowFall | undefined>(
        () =>
            observedWeatherFx && observedWeatherFx.snowDensity > 0
                ? {
                      density: observedWeatherFx.snowDensity,
                      alpha: SNOW_ALPHA,
                      radius: SNOW_R,
                      speed: SNOW_SPEED,
                      sway: SNOW_SWAY,
                      swayRate: SNOW_SWAY_RATE,
                  }
                : undefined,
        [observedWeatherFx],
    );
    // The worlds as the sky sees them: main's day sky follows the weather. Memoised on the
    // hex, because `light.skyOf` caches per world object.
    const mainDaySky = weatherDaySky(weather);
    const skyWorlds = useMemo(() => worldsUnderWeather(mainDaySky), [mainDaySky]);
    // td opens on the world its route state names: an exit's arrow push (`NOTEBOOK_EXIT`,
    // `SORT_EXIT`), or — on a browser-owned Back (edge swipe, back button) — the world td
    // stamped into its own entry before leaving (`useRememberTowerWorld`).
    const location = useLocation();
    const pan = useWorldPan(
        (id) => ({ sky: dayLight.skyOf(skyWorlds[id]), space: skyWorlds[id].space, aurora: auroraOf(id) }),
        readTowerWorldState(location.state),
    );
    useRememberTowerWorld(pan.world);
    // The world on screen. One whose goal is switched off while it is up falls back to main.
    const worldId: TowerWorldId = shownWorlds.includes(pan.world) ? pan.world : "core";
    // An aurora showing in this world is the sky's only event: no rain, snow, lightning,
    // fog or clouds (all read `weatherFx` / `cloudsInSky` below), and no shooting stars.
    const auroraUp = auroraShowing(worldId, aurora.active, dayLight.nightShare);
    const weatherFx = auroraUp ? undefined : observedWeatherFx;
    // The light the scene is drawn under: the hour's light, plus — in a world with a live
    // aurora — the aurora's glow over the wash (platform, cards, pawns, title; the sky is
    // left alone, it IS the light). Same object as `dayLight` when there is no aurora, so
    // every memo keyed on the light or its wash holds.
    const auroraGlowWash = useAuroraGlowWash(dayLight.wash, auroraOf(worldId));
    const light = useMemo(
        () => (auroraGlowWash === dayLight.wash ? dayLight : { ...dayLight, wash: auroraGlowWash }),
        [dayLight, auroraGlowWash],
    );
    // The page's own white things painted on the sky (title, arrows, speed lines) — lit too.
    const skyInk = light.wash(ISO.white);
    // The browser's top-edge colour follows the settled world's sky. Without a claim it is
    // the paper default, and iOS Safari draws its scroll-edge effect behind the clock as a
    // paper-white fade over the sky (and the top of a tall tower). Keyed on the world's
    // sky, not `pan.palette.sky`, so a pan does not rewrite the meta tag every frame.
    useThemeColor(light.skyOf(skyWorlds[worldId]));

    // ── Studying the tower (docs/DECK_TOWER.md § "Studying the tower") ────────────
    // The session is page state, not a route: useTowerStudy owns the dive, the camera and
    // the flp's host contract; this page draws the scene through its camera and hands the
    // tower back when it has climbed out (`climbedOut`, defined with the framing below).
    const climbedOut = useRef<(world: TowerWorldId, cards: number) => void>(() => {});
    const study = useTowerStudy({
        unit: UNIT,
        card: LAYOUT.card,
        // Every enabled world's session mounts, parked, as the page lands and stays
        // (§ "Parked sessions"), so a tap on any world's tower dives straight in instead of
        // waiting on the working loop. The world on screen first, so its deal goes out
        // first. Not before sign-in: the session deals for the account.
        dealtWorlds: user?.id !== undefined ? [worldId, ...shownWorlds.filter((w) => w !== worldId)] : [],
        onClimbedOut: (w, n) => climbedOut.current(w, n),
    });
    const studying = (id: TowerWorldId) => study.active && study.world === id;
    // While a session is up the footer slides away, the edge swipe is blocked (a game-like
    // surface — docs/UX_AND_NAVIGATION.md), and the page earns minute points as a study
    // surface (src/minutePoints/studySurface.ts) — only once the camera is down, so the
    // dive and the climb do not count.
    // The flp hint pawn's visit scope (docs/HINT_PAWN.md § "Dismissing"): a swipe-away
    // lasts until td is left, across every session and world, so the visit starts here.
    useHintPawnVisit();
    // (The footer's hide — `useHideFooter` — is with the home stage below: it hides for both.)
    useBlockEdgeSwipe(study.active);
    useClaimStudySurface(study.phase === "studying");
    // A world's two decks, read through its own bar: Learning = that bar's OFF-COOLDOWN
    // cards (the flp's own readiness rule, so the tower never shows a card the flp would not
    // deal), in all four utcm bands (towerModes.ts → Mix). Mastered = that bar's whole
    // Mastered total, cooling or not. Undefined until loaded, so no tower builds from a
    // placeholder 0.
    const learningLow = coreCategoryCounts.ok
        // (The 'learn-now' kind never reads the mastered counts; `mastered.counts` only fills the slot.)
        && (builtinCollectionCount({ kind: "learn-now", world: "core" }, coreCategoryCounts.counts, mastered.counts) ?? 0) < LEARN_NOW_LOW_THRESHOLD;
    const learningCount = (worldId: TowerWorldId): number | undefined =>
        readyCounts[worldId].loaded ? bandTotal(readyCounts[worldId].counts, TOWER_MODES.mix.bands) : undefined;
    const deckCountsFor = (worldId: TowerWorldId): Record<TowerDeckId, number | undefined> => ({
        "learn-now": learningCount(worldId),
        // The 'mastered' kind reads only `mastered.counts`; the band counts argument is unused.
        mastered: mastered.loaded ? builtinCollectionCount({ kind: "mastered", world: worldId }, readyCounts[worldId].counts, mastered.counts) ?? 0 : undefined,
    });

    const world = useMemo(() => litWorld(skyWorlds[worldId], light), [skyWorlds, worldId, light]);
    // The home screen's platform always stands in the MAIN world's colours, lit for the hour.
    const homeWorld = useMemo(() => litWorld(skyWorlds.core, light), [skyWorlds, light]);
    const worldIndex = shownWorlds.indexOf(worldId);
    const leftWorld = worldIndex > 0 ? shownWorlds[worldIndex - 1] : undefined;
    const rightWorld = worldIndex < shownWorlds.length - 1 ? shownWorlds[worldIndex + 1] : undefined;

    // One independent deck switch per world.
    const swaps: Record<TowerWorldId, ReturnType<typeof useDeckSwap>> = {
        core: useDeckSwap(),
        reading: useDeckSwap(),
        writing: useDeckSwap(),
    };
    const swap = swaps[worldId];
    // Mid-swap, the old tower has cleared (`outgoing` gone) but the new tower's sky drop has
    // not started playing yet: the platform is empty. See `towerCountFor`.
    const swapDropPending = (id: TowerWorldId) => swaps[id].busy && swaps[id].outgoing === null && resizes[id].toCards === null;
    // The deck each tower is fitted to — the old one until it has fallen clear, then the new.
    // While a resize plays (or holds), the Learning tower keeps the height it had at the
    // tap, so the build-up never sees the count change mid-animation.
    //
    // A swap's new tower arrives as a SKY DROP (docs/DECK_TOWER_TRANSITIONS.md § "The new
    // tower's sky drop"), not a build-up: from the old tower clearing until the drop is
    // planned at `readyMs` the platform stands empty (`swapDropPending` → 0 cards), and the
    // drop's resize then holds it at 0 (`heldCards`) until the new cards have landed.
    // `heldCards` applies on either deck: a hold or resize only exists on Mastered through
    // that swap drop (the plate is off while one is held, and every other hold is Learning's).
    const towerCountFor = (id: TowerWorldId): number | undefined => {
        // Being studied: the tower loses a card per correct mark (useTowerStudy).
        if (studying(id)) return study.cards;
        if (swapDropPending(id)) return 0;
        const held = resizes[id].heldCards;
        return held !== null ? held : deckCountsFor(id)[swaps[id].towerDeck];
    };
    const towerCounts: Record<TowerWorldId, number | undefined> = {
        core: towerCountFor("core"),
        reading: towerCountFor("reading"),
        writing: towerCountFor("writing"),
    };
    // A tower may grow once its counts are in and its swap's platform is not empty.
    const mayGrow = (id: TowerWorldId) => towerCounts[id] !== undefined && swaps[id].towerOnStage;
    // Every world keeps its tower built, on screen or not, so arriving shows it standing.
    // Every tower appears at full height: nothing builds up any more (`animate` false). Main
    // used to build up on page load; since 2026-10-24 it opens at the height it last stood
    // at and plays a tower resize to today's figure (§ "Opening at the last height"), or —
    // with nothing stored — simply stands. A deck swap's new tower used to build up too;
    // since 2026-11-09 it falls in as a sky drop (`startSwapDrop`).
    const progress: Record<TowerWorldId, number> = {
        core: useBuildProgress(mayGrow("core"), towerCounts.core ?? 0, false),
        reading: useBuildProgress(mayGrow("reading"), towerCounts.reading ?? 0, false),
        writing: useBuildProgress(mayGrow("writing"), towerCounts.writing ?? 0, false),
    };

    // The stack is drawn: the old tower as it stood at the tap while it falls, nothing while
    // the platform is empty mid-swap, then the build-up (from 0 cards until counts arrive).
    const stackDrawn = swap.outgoing !== null || swap.towerOnStage;
    const stackProgress = swap.outgoing?.frozenProgress ?? progress[worldId];
    // The corner fixtures (notebook stack, sort platform) grow in on their own clock after a
    // swap lands on Learning — the tower itself sky-drops in, so there is no build-up for
    // them to ride. Only the world on screen draws fixtures, so one clock serves every world.
    // Leaving Learning they fall at full height (towerOnStage stays true until `clearedMs`).
    const fixtureProgress = useFixtureGrow(mayGrow(worldId), swap.busy);
    const towerCount = towerCounts[worldId] ?? 0;
    // This world's tower resize. While a resize plays, the scene is fitted to the TALLER of
    // its two heights: a shrink starts from it, and a grow needs its sky to fall through.
    const resize = resizes[worldId];
    // Where the pawn stands on the tower's top: the count card carries it off from there.
    const summitSpot = useRef<{ x: number; y: number } | null>(null);

    // ── Snow (docs/TOWER_SNOW.md) ─────────────────────────────────────────────────
    // Snow settles on each world's components ONLY ON PAGE ENTRY — when it is snowing then
    // and a component was last cleared 6 h ago or more — and stays until cleared (useTowerSnow,
    // towerSnow.ts). Shown with the weather: the Settings switch on, or a tester's pin.
    const weatherEffectsOn = useWeatherEffectsEnabled();
    const towerSnow = useTowerSnow({
        shown: weatherEffectsOn || (testingFeatures && towerWeather.override !== "auto"),
        entry: { ready: towerWeather.settled, snowing: weather?.kind === "snow" },
        towerCards: towerCounts,
        cloudBaseCards: CLOUD_BAND_CARDS.from,
    });
    // Until this si graduates (1 day, 4 visits) snow never covers text (docs/TOWER_SNOW.md
    // § "Covering text"). Counted on every visit, snowy or not.
    const snowCoverText = useSoftIntro("towerSnowCover") === "graduated";
    // The trap door drops everything on the platform, snow and all: when a world's swap ENDS
    // (the door shut, the new deck standing) every one of its components is cleared — no
    // brush-off, the snow has already left with its object (the floor's slid off the door).
    // Under reduced motion a swap is instant (never busy), so a deck change seen while idle
    // counts as a swap's end too.
    // A LAYOUT effect: the render where the swap ends (door shut, the platform's slide-off
    // reset) still has the old covers, and a passive effect's clear landed a frame later — the
    // floor's snow flashed back on for that painted frame. Cleared here, React re-renders
    // with the cleared covers before the browser paints.
    const swapBefore = useRef<Record<TowerWorldId, { busy: boolean; deck: TowerDeckId }>>({
        core: { busy: false, deck: swaps.core.towerDeck },
        reading: { busy: false, deck: swaps.reading.towerDeck },
        writing: { busy: false, deck: swaps.writing.towerDeck },
    });
    const swapKey = WORLD_ORDER.map((id) => `${swaps[id].busy ? 1 : 0}${swaps[id].towerDeck}`).join(",");
    useLayoutEffect(() => {
        for (const id of WORLD_ORDER) {
            const { busy, towerDeck } = swaps[id];
            const before = swapBefore.current[id];
            if (!busy && (before.busy || before.deck !== towerDeck)) towerSnow.clear(id, SNOW_COMPONENTS);
            swapBefore.current[id] = { busy, deck: towerDeck };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [swapKey]);
    // A study: the snowy top card rides the count card off the deck (TowerCoverCard); once the
    // session is up the tower's snow is cleared, so the card comes back bare.
    const studyWorld = study.world;
    useEffect(() => {
        if (study.phase === "studying" && studyWorld) towerSnow.clear(studyWorld, "tower");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [study.phase, studyWorld]);
    // A sky drop (a grow: cards off cooldown, focus off, opening above the last height) lands
    // on the top card and knocks its snow off — brushed off on the impact. This is also why a
    // tower growing into the clouds never keeps a cap there.
    const dropLandedKey = WORLD_ORDER.map((id) => (resizes[id].dropLanded ? 1 : 0)).join("");
    useEffect(() => {
        for (const id of WORLD_ORDER) if (resizes[id].dropLanded) towerSnow.clear(id, "tower", { brush: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dropLandedKey]);
    // The covers DeckTowerPlatform draws for the world on screen. The tower's only while the
    // Learning deck stands (the Mastered tower is only ever reached through a trap door, which
    // clears) and while the scene's top card is the one showing — not while the count card
    // is its own layer or off the deck.
    const snowCover = (c: SnowComponent) => towerSnow.cover(worldId, c);
    const platformSnow = {
        covers: {
            floor: snowCover("floor"),
            plate: snowCover("plate"),
            tower: swap.towerDeck === "learn-now" && study.towerPrintShown ? snowCover("tower") : undefined,
            lever: snowCover("lever"),
            sortBin: snowCover("sortBin"),
            notebook: snowCover("notebook"),
        },
        coverText: snowCoverText,
        trail: towerSnow.trail(worldId, "floor"),
        towerTrail: towerSnow.trail(worldId, "tower"),
        swapping: swap.busy,
    };
    // Cards standing on the tower. A sky drop counts from its IMPACT (not the resize's end,
    // IMPACT_MS later), so a total crossing STARTLE_AT_CARDS startles the pawn as it lands.
    const cardsOnTower = !stackDrawn ? 0 : resize.dropLanded && resize.toCards !== null ? resize.toCards : Math.round(towerCount * stackProgress);
    // While a session is up the scene stays fitted to the tower as it stood at the tap: the
    // camera aims through this frame, and a refit would move the svg under it.
    // Mid-swap, from the old tower clearing until its sky drop starts, the platform stands
    // empty but the scene is already fitted to the new deck's tower (refit at `clearedMs`, as
    // the drop it is about to receive needs), so the drop's start causes no second refit.
    const fitCount = studying(worldId)
        ? study.fitCards
        : swapDropPending(worldId)
          ? (deckCountsFor(worldId)[swap.towerDeck] ?? 0)
          : resize.toCards !== null
          ? Math.max(towerCount, resize.toCards)
          : towerCount;

    // The FIXED view: every framing number (fitScene, the hint, the sky bands, the sky
    // traffic) is measured in it. The scene itself is drawn through the study camera while
    // a session is up (`sceneProj`), which starts and ends exactly on this view.
    const proj = useMemo(() => makeProjector(UNIT), []);
    const sceneProj = useMemo(() => (study.view ? makeCameraProjector(study.view) : proj), [study.view, proj]);

    // ── Framing: a FIXED scale, and scrolling instead of zooming ─────────────────
    // The viewBox's WIDTH is the platform's (centred on its own centre and ignoring the
    // shadow, which slides off down-right with the light), and the svg is always the
    // stage's full width — so the scale is fixed by the platform and never changes with
    // the deck size or the world.
    // Cards keep a fixed thickness too, so a big deck makes a tower far taller than the
    // screen; rather than zoom out to fit it, the viewBox grows UPWARD to the settled
    // tower's top (+ TOP_HEADROOM), the svg's height follows (aspect-ratio = the
    // viewBox's), and the stage scrolls. Fitted to the world ON SCREEN only, so each world
    // scrolls as tall as its own tower.
    //
    // The bottom edge is the platform SHADOW plus BOTTOM_MARGIN: the scroller clips at the
    // footer bar, so anything below the svg would be cut off. The svg is fitted to the
    // SETTLED tower, so nothing reflows during a build-up (it refits once, when its counts
    // arrive, before it grows).
    // A skill world's travellers fly as if its tower reached SKILL_WORLD_SKY_CARDS (the
    // framing still stops at the real tower's top).
    const alwaysHasSky = worldId !== "core";
    const skyCardsFor = (count: number) => (alwaysHasSky ? Math.max(count, SKILL_WORLD_SKY_CARDS) : count);
    const skyCards = skyCardsFor(fitCount);
    const scene = useMemo(() => fitScene(proj, fitCount, skyCards), [proj, fitCount, skyCards]);
    // The fog's field (iso/fogClouds.ts), planned per framing against the FIXED view so the
    // study camera re-projects the same pills rather than re-planning them. Only under fog.
    const fogOn = (weatherFx?.fog ?? 0) > 0;
    const fogClouds = useMemo(() => (fogOn ? planFogClouds(proj, FLOOR_Z, scene.fogCover) : null), [fogOn, proj, scene.fogCover]);
    // The Tap to Start hint's fixed frame: a TAP_HINT_FIT_CARDS tower's. Its width and
    // bottom edge are every scene's (the platform's), so only its tower top differs.
    const hintFit = useMemo(() => fitScene(proj, TAP_HINT_FIT_CARDS, TAP_HINT_FIT_CARDS), [proj]);

    // The sky travellers circle the tower on screen. None start while the camera dashes
    // between worlds (the ones already out finish their crossing). They are scheduled and
    // drawn by SkyTraffic.tsx, outside this page's render: a crossing starting or ending
    // re-renders only the two sky layers, not the page (SkyTraffic.tsx header).
    const skyLive = !pan.busy && !study.active;
    const skyTraffic = useSkyTrafficStore();
    // Clouds follow the weather, not the tower (CLOUD_BAND_CARDS): 0 = none in the sky.
    const cloudsInSky = auroraUp ? 0 : weatherCloudCount(weather);
    const cloudsActive = skyLive && cloudsInSky > 0;
    // Wind blows only once the tower reaches the wind band, in EVERY world (2026-11-08: the
    // skill worlds' always-on wind was dropped). Clouds still keep the skill worlds' sky.
    const windActive = skyLive && cardsOnTower >= WIND_BAND_CARDS.from;

    // ── Lightning strikes (docs/DECK_TOWER.md § "Weather" → "Lightning strikes") ───
    // One clock for the sky's flash and the strike roll (useLightningFlashes), so a strike
    // always lands on a flash. Each world remembers its burn marks and crispy pawns until
    // the learner leaves the page (towerLightning.ts); the platform remounts per world, so
    // the record lives here. Pawn keys restart at 0 per world — hence per world, too.
    const [lightningByWorld, setLightningByWorld] = useState<Record<TowerWorldId, WorldLightning>>({
        core: NO_LIGHTNING,
        reading: NO_LIGHTNING,
        writing: NO_LIGHTNING,
    });
    // The bolt coming down now, and the world it is in (a pan can start under it).
    const [bolt, setBolt] = useState<{ world: TowerWorldId; strike: TowerStrike } | null>(null);
    const strikeIds = useRef(0);
    // Each pawn's live floor position (IsoPawn `floorSpot`), by world and swap key. Refs, so
    // the motion loop writes them without renders; created on first ask and kept.
    const pawnSpots = useRef(new Map<string, React.MutableRefObject<{ x: number; y: number } | null>>());
    const pawnSpotFor = (world: TowerWorldId, key: number) => {
        const id = `${world}:${key}`;
        let ref = pawnSpots.current.get(id);
        if (!ref) {
            ref = { current: null };
            pawnSpots.current.set(id, ref);
        }
        return ref;
    };
    /**
     * Strikes the platform on screen: at a random visible floor spot, or with `atPawn` at the
     * pawn (a tester chip; a random spot while it is not on the floor). Not while the camera
     * is studying or dashing, nor mid deck swap (the floor may be swinging open). Returns
     * whether it struck.
     */
    const strikePlatform = (atPawn: boolean): boolean => {
        if (study.active || pan.busy || swap.busy) return false;
        const pawns = swap.pawns.filter((p) => !p.outgoing).map((p) => ({ key: p.key, spot: pawnSpotFor(worldId, p.key).current }));
        const aimed = atPawn ? pawns.find((p) => p.spot)?.spot : null;
        const at = aimed ? { x: aimed.x, y: aimed.y } : pickStrikePoint();
        if (!at) return false;
        const strike: TowerStrike = { id: ++strikeIds.current, at };
        const hit = struckPawn(at, pawns);
        setLightningByWorld((all) => ({ ...all, [worldId]: withStrike(all[worldId], strike, hit) }));
        setBolt({ world: worldId, strike });
        return true;
    };
    const strikeRef = useRef(strikePlatform);
    strikeRef.current = strikePlatform;
    const lightningFlashes = useLightningFlashes(weatherFx?.lightning === true, () => {
        if (Math.random() < STRIKE_CHANCE) strikeRef.current(false);
    });
    // A tester's forced strike: flash the sky with it, as a storm's would.
    const forceStrike = (atPawn: boolean) => {
        if (strikeRef.current(atPawn)) lightningFlashes.fire();
    };
    const platformLightning: PlatformLightning = {
        ...lightningByWorld[worldId],
        bolt: bolt?.world === worldId ? bolt.strike : null,
        onBoltDone: () => setBolt(null),
        pawnSpot: (key) => pawnSpotFor(worldId, key),
    };

    // ── Scroll height, shared by every world ─────────────────────────────────────
    // The camera pans SIDEWAYS, so it keeps its height: arriving in a world opens at the
    // altitude the learner last scrolled to (`climb`, px above the PLATFORM LINE — the svg's
    // height differs per world, so a scrollTop would not carry over). A shorter tower clips
    // it at its top, but `climb` keeps the altitude asked for, so panning on to a taller
    // world climbs back to it. `climb` is NEGATIVE down in the cards page (towerScroll), and
    // an arrival keeps that depth too, in the next world's cards. A refit WITHIN a world (its
    // counts arriving, a deck swap's refit) opens on the platform — unless the learner is
    // down in the cards, where the refit happens out of sight and keeps their place. Keyed
    // on the world and the viewBox, which only change with those, so a silent token refresh
    // or the build-up never yanks it.
    const scrollerRef = useRef<HTMLDivElement>(null);
    // The spacer under the footer bar at the scroller's bottom (see the scroller's note):
    // its px height is the footer's (a CSS calc with the safe area, so it is measured).
    const footerSpacerRef = useRef<HTMLDivElement>(null);
    const footerPx = () => footerSpacerRef.current?.offsetHeight ?? 0;
    const [footerSpacerPx, setFooterSpacerPx] = useState(0);
    useLayoutEffect(() => {
        const measure = () => setFooterSpacerPx(footerSpacerRef.current?.offsetHeight ?? 0);
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, []);
    const climb = useRef(0);
    // The world the scroller last showed — a change of it is an arrival, not a refit.
    const scrolledWorld = useRef<TowerWorldId>(worldId);
    // The scrollTop the page itself last set: the scroll event that echoes it (or the
    // browser's clamp of it) is not the learner moving, so it must not overwrite `climb`.
    const placedScrollTop = useRef<number | null>(null);

    // ── The home screen (docs/HOME_SCREEN.md) ─────────────────────────────────────
    // The HOME STAGE (home/HomeStage.tsx) stands ABOVE the tower: its own platform and pawn
    // over td's sky, with Dictionary and Enter under it. The app opens on it once per launch;
    // Enter takes the camera down to the deck's top and scrolls on down to the platform, and a
    // fresh pull past the deck's top takes it back up (home/useHomeEntrance.ts,
    // home/useHomePull.ts). While it is up: no header, no footer, no world swipe, and the
    // tower's own events (the opening grow, cooldown drops, the banking run) WAIT, so they play
    // once the learner can see them.
    const [homeOnLaunch] = useState(homeDueOnLaunch);
    useEffect(() => {
        if (homeOnLaunch) markHomeTaken();
    }, [homeOnLaunch]);
    // The sky's altitude through a shift's cruise, as viewBox y's (SpaceBackdrop `altitudeY`):
    // from where the shift left to where it lands. Measured by `onCruise`.
    const homeAltitudes = useRef<{ from: number; to: number } | null>(null);
    // Set while a shift holds the scroller at the tower's top (a refit must keep it there):
    // from Enter's cruise to its landing, and from a return's start to its cruise.
    const homeAtTop = useRef(false);
    /** viewBox y at the middle of the view for a given scrollTop — SpaceBackdrop's own altitude
     * formula. Both rects carry the scroller's shift transform, so it cancels. */
    const altitudeAt = (el: HTMLDivElement): ((top: number) => number) | null => {
        const svg = towerSceneOf(el);
        if (!svg) return null;
        const svgRect = svg.getBoundingClientRect();
        const scale = svgRect.width / scene.width;
        const svgContentTop = svgRect.top - el.getBoundingClientRect().top + el.scrollTop;
        const viewH = el.clientHeight - footerPx();
        return (top) => scene.minY + (top + viewH / 2 - svgContentTop) / scale;
    };
    const home = useHomeEntrance({
        shown: homeOnLaunch,
        scrollerRef,
        // Nothing is on screen: move the scroller to where the shift lands, and blend the sky there.
        onCruise: (direction) => {
            const el = scrollerRef.current;
            if (!el) return;
            cardsScroll.cancelGlide();
            const midAt = altitudeAt(el);
            // Enter lands on the tower's top; a return parks the scroller on the platform line,
            // where it stands under the home (the launch's own state).
            const to = direction === "enter" ? 0 : platformScrollTop(el);
            homeAltitudes.current = midAt ? { from: midAt(el.scrollTop), to: midAt(to) } : null;
            el.scrollTop = to;
            placedScrollTop.current = el.scrollTop;
            climb.current = heightAbovePlatform(el);
            homeAtTop.current = direction === "enter";
        },
        descentTarget: () => (scrollerRef.current ? platformScrollTop(scrollerRef.current) : 0),
        onPlaced: (top) => {
            placedScrollTop.current = top;
        },
        onLanded: () => {
            homeAtTop.current = false;
            homeAltitudes.current = null;
            const el = scrollerRef.current;
            if (el) {
                el.scrollTop = platformScrollTop(el);
                placedScrollTop.current = el.scrollTop;
            }
            climb.current = 0;
            cardsScroll.syncHeader();
        },
        onHome: () => {
            homeAtTop.current = false;
            homeAltitudes.current = null;
        },
    });
    const homeUp = home.phase !== "done";
    const homeShifting = home.phase === "enter" || home.phase === "return";
    // The home stage itself is on screen (at rest and through both shifts; not the descent).
    const homeStageShown = home.phase === "home" || homeShifting;
    const homePhaseRef = useRef(home.phase);
    homePhaseRef.current = home.phase;
    // The footer slides back in as the descent starts, and away as a return starts; a study hides it too.
    useHideFooter(study.active || homeStageShown);
    // The sky's altitude override through a shift, once its cruise has measured it (null = follow the scroll).
    const homeAltitudeY =
        homeShifting && homeAltitudes.current
            ? homeAltitudes.current.from + (homeAltitudes.current.to - homeAltitudes.current.from) * home.frame.altitudeT
            : null;
    // The banking run is held only until the learner first leaves the home: a later return home
    // must not cancel a run already playing (it is stamped seen as it starts).
    const homeLeftOnce = useRef(!homeOnLaunch);
    if (!homeUp) homeLeftOnce.current = true;
    const bankingHeld = homeUp && !homeLeftOnce.current;
    // Dictionary from home: the circle grows out of the key; its Back comes to td (the home
    // screen is spent by then), closing the circle onto the same point (DictionaryPage → `homeBack`).
    const openDictionaryFromHome = (at: ScreenPoint) =>
        slideNavigate("/dictionary", { circleFrom: at, state: { circleFrom: at, homeBack: true } });
    // ── The cards page under the platform (§ "The cards page") ────────────────────
    // Its root (the header hand-off measures its top; a world swipe slides it with the
    // scene) and the page header's layer, which its title row pushes off. The platform stop
    // and the hand-off are useTowerCardsScroll's (towerScroll.ts).
    const cardsPageRef = useRef<HTMLDivElement>(null);
    const headerLayerRef = useRef<HTMLDivElement>(null);
    const cardsScroll = useTowerCardsScroll({
        scrollerRef,
        headerLayerRef,
        cardsPageRef,
        isPlaced: (top) => placedScrollTop.current !== null && Math.abs(top - placedScrollTop.current) < 1,
        // The platform stop and every glide frame (the cue, the up arrow, the snap zone).
        // The altitude to keep is wherever it put the view: 0 on the platform, negative in
        // the cards page.
        onPlaced: (top) => {
            placedScrollTop.current = top;
            const el = scrollerRef.current;
            climb.current = el ? heightAbovePlatform(el) : 0;
        },
        enabled: !study.active && !homeUp,
        // The snap stays out of the way of the page's own camera moves (the same set that
        // blocks a pan — `panBlocked` below, which is declared after this hook).
        snapEnabled: !(pan.busy || swap.busy || resize.busy || study.active || homeUp),
    });
    // The header layer remounts when a session's camera comes back up: re-apply the push.
    useLayoutEffect(() => {
        if (!study.cameraDown) cardsScroll.syncHeader();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- cardsScroll's methods read refs
    }, [study.cameraDown]);
    // A card in the cards page opens its cdp through that world's lens — the swipe's
    // closing click (a desktop drag) is not a tap, the guard the tower's own tap uses.
    // Read through a ref so the handler the memoized cards page receives keeps one identity:
    // this page re-renders every frame of a build-up, a resize or a pan.
    const openTowerCardRef = useRef<(entry: VocabEntry, cardWorld: TowerWorldId) => void>(() => {});
    openTowerCardRef.current = (entry, cardWorld) => {
        if (worldSwipe.wasDrag() || pan.busy || study.active) return;
        slideNavigate(withLens(`/flashcards/card/${entry.id}`, cardWorld));
    };
    const onOpenTowerCard = useCallback((entry: VocabEntry, cardWorld: TowerWorldId) => openTowerCardRef.current(entry, cardWorld), []);
    // The scroller's own onScroll, so it is attached however late the scroller mounts.
    const recordClimb = (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        if (placedScrollTop.current !== null && Math.abs(el.scrollTop - placedScrollTop.current) < 1) return;
        placedScrollTop.current = null;
        climb.current = heightAbovePlatform(el);
    };
    // A tower resize's refit (to the taller frame as a grow starts, to the shorter one as a
    // shrink ends) keeps the altitude instead, like an arrival: the camera stays on
    // what the learner is watching. It names the viewBox it expects, so a switch that ends
    // up not refitting cannot leak the exception onto a later refit.
    const keepClimbFor = useRef<string | null>(null);
    useLayoutEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;
        // The home move owns the scroller: through the shift it stands at the tower's top, and
        // the descent reads the platform line live every frame (useHomeEntrance).
        if (homePhaseRef.current === "descend") return;
        if ((homePhaseRef.current === "enter" || homePhaseRef.current === "return") && homeAtTop.current) {
            el.scrollTop = 0;
            placedScrollTop.current = el.scrollTop;
            return;
        }
        const keepClimb = keepClimbFor.current === scene.viewBox;
        keepClimbFor.current = null;
        // A refit places the scroller itself: a glide still running would drag it off.
        cardsScroll.cancelGlide();
        const line = platformScrollTop(el);
        if (scrolledWorld.current !== worldId || keepClimb || climb.current < 0) {
            scrolledWorld.current = worldId;
            el.scrollTop = line - climb.current; // the browser clamps at both ends
            placedScrollTop.current = el.scrollTop;
        } else {
            el.scrollTop = line;
            // Back on the platform: that is now the altitude to keep.
            climb.current = 0;
            placedScrollTop.current = el.scrollTop;
        }
        cardsScroll.syncHeader();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- cardsScroll's methods read refs
    }, [worldId, scene.viewBox]);

    // ── The deck switch (the world's floor plate) ────────────────────────────────
    // Ignored mid-swap, mid-pan and until its counts are in, so the swap never builds a
    // tower from a count that has not arrived.
    // Scrolls to the bottom first: the fall distance is measured from there, and the
    // refit at the swap's `cleared` beat re-snaps there.
    const countsLoaded = (id: TowerWorldId) => {
        const c = deckCountsFor(id);
        return c["learn-now"] !== undefined && c.mastered !== undefined;
    };
    const onPlateTap = () => {
        if (swap.busy || pan.busy || resize.busy || study.active || !countsLoaded(worldId)) return;
        keepClimbFor.current = null;
        const el = scrollerRef.current;
        if (el) el.scrollTo({ top: platformScrollTop(el), behavior: "smooth" });
        swap.toggle({ fallDistance: scene.fallDistance, progress: progress[worldId], cards: cardsOnTower });
    };

    // ── The focus lever (docs/FOCUS_MODE.md § 5) ─────────────────────────────────
    // One per world, like the counts and the swaps, so each world's lever keeps its own
    // state across world swipes. Only the world on screen's lever is drawn; every world's
    // popup is mounted (at most one is ever open).
    //
    // The lever never moves on an open trap door — its hatch would hang in mid-air beside
    // the swung slab. Leaving Learning, it stays standing and falls away with the old
    // tower (DeckTowerPlatform wraps it in the tower's fall), then is put away sunk and
    // shut, unanimated, once cleared. Arriving at Learning, it never comes up through
    // the hatch: it FALLS FROM THE SKY on the incoming pawn's own entrance animation,
    // landing a staggered beat after the pawn (useLeverMotion `skyEntrance`). The cue
    // exists from transition t = 0, so the lever is shown from then — hidden until its
    // fall starts.
    //
    // STAGGER. The pawn lands on the door's slam; the lever lands LEVER_LANDS_AFTER_PAWN_MS
    // after it, so the arrivals read as a one-two rather than a single thud. The cue is only
    // shifted later, never earlier: the fall still plays its whole timeline, and a lever
    // still waiting draws nothing and takes no taps (DeckTowerPlatform `leverTappable`),
    // even once the swap is over.
    const leverArgs = (id: TowerWorldId) => {
        const s = swaps[id];
        const pawnCue = s.busy && s.titleDeck === "learn-now" ? s.pawns.find((p) => !p.outgoing)?.entrance : undefined;
        const skyEntrance = pawnCue && { ...pawnCue, startAt: pawnCue.startAt + LEVER_LANDS_AFTER_PAWN_MS };
        const learningShown = s.busy
            ? (s.outgoing !== null && s.towerDeck === "learn-now") || pawnCue !== undefined
            : s.titleDeck === "learn-now" && s.towerDeck === "learn-now";
        return {
            world: id,
            ready: readyCounts[id],
            learningShown,
            busy: s.busy || pan.busy || resizes[id].busy || study.active,
            hideInstantly: s.busy,
            skyEntrance,
            // The auto-on popup waits for a real visit (docs/FOCUS_MODE.md § 1a).
            onScreen: worldId === id,
            // Hold the tower where it stands until the flipped counts land (`resolveRecount`).
            onRecount: () => {
                if (swaps[id].towerDeck === "learn-now") resizes[id].hold(towerCounts[id] ?? 0, readyCounts[id].version);
            },
        };
    };
    const focusLevers: Record<TowerWorldId, FocusLever> = {
        core: useFocusLever(leverArgs("core")),
        reading: useFocusLever(leverArgs("reading")),
        writing: useFocusLever(leverArgs("writing")),
    };
    // ── Tower resizes (docs/DECK_TOWER.md § "Tower resizes") ─────────────────────
    // Plans the world on screen's tower going from `fromCards` to `toCards` with an
    // animation picked from the library, and plays it. Called by the focus lever's re-read
    // (`resolveRecount`).
    // Where a grow's camera move ends (scrollTop), set as it is planned.
    const cameraTarget = useRef(0);
    // The frame a tower of `cards` refits to keeps the altitude (see `keepClimbFor`).
    const keepClimbThroughRefit = (cards: number) => {
        const toScene = fitScene(proj, cards, skyCardsFor(cards));
        keepClimbFor.current = toScene.viewBox !== scene.viewBox ? toScene.viewBox : null;
        return toScene;
    };
    // `camera: false` drops onto the view as it stands (the deck swap's drop: the scroller is
    // already snapped to the platform, whose floor is the landing).
    const startResize = (fromCards: number, toCards: number, opts: { camera?: boolean } = {}) => {
        const toScene = keepClimbThroughRefit(toCards);
        if (toCards <= fromCards) {
            resize.play(pickTowerShrink().plan({ fromCards, toCards }));
            return;
        }
        const grow = pickTowerGrow();
        const el = scrollerRef.current;
        if (!grow.usesCamera || !el) {
            resize.play(grow.plan({ fromCards, toCards, skyAbove: DROP_MIN_LIFT, cameraMs: 0 }));
            return;
        }
        // Planned against the TALLER frame it is about to refit to. The svg is pinned to the
        // bottom of the view (above the footer spacer) and as wide as it, so its scale is
        // fixed and its top sits `svgTop` px down the scroll content (0 once it overflows).
        // `viewH` is the part of the scroller above the footer bar — what the learner sees.
        const viewH = el.clientHeight - footerPx();
        const scale = el.clientWidth / toScene.width;
        const svgH = toScene.height * scale;
        const svgTop = Math.max(0, viewH - svgH);
        const maxScroll = Math.max(0, svgH - viewH);
        // The camera: the landing (the standing tower's top) LANDING_ON_SCREEN down the screen.
        const landingZ = FLOOR_Z + fromCards * CARD_THICKNESS;
        const landingPx = svgTop + (toScene.axisYAtZ(landingZ) - toScene.minY) * scale;
        const target = Math.min(maxScroll, Math.max(0, landingPx - viewH * LANDING_ON_SCREEN));
        const from = Math.min(maxScroll, Math.max(0, maxScroll - climb.current)); // where the kept altitude puts it
        // No camera: the view stays where it is (the camera effect re-asserts the same scrollTop).
        const end = opts.camera === false ? Math.min(maxScroll, Math.max(0, el.scrollTop)) : target;
        const travel = opts.camera === false ? 0 : Math.abs(target - from);
        cameraTarget.current = end;
        // The new cards start with their underside just over the screen's top edge (at the
        // camera's end), so the whole drop falls in from out of sight.
        const screenTopY = toScene.minY + (end - svgTop) / scale;
        const screenTopZ = (toScene.axisYAtZ(FLOOR_Z) - screenTopY) / proj.heightUnit;
        resize.play(
            grow.plan({
                fromCards,
                toCards,
                skyAbove: Math.max(DROP_MIN_LIFT, screenTopZ + DROP_CLEARANCE - landingZ),
                cameraMs: travel < 2 ? 0 : Math.min(CAMERA_MAX_MS, CAMERA_BASE_MS + travel * CAMERA_MS_PER_PX),
            })
        );
    };
    // ── A deck swap's new tower (docs/DECK_TOWER_TRANSITIONS.md § "The new tower's sky drop")
    // At the swap's `readyMs` — the trap door slams and the new pawn lands — the new deck's
    // tower falls in from above the screen onto the bare floor: a 0 → count SKY_DROP, with
    // no camera move (the scroller was re-snapped to the platform at `clearedMs`). A LAYOUT
    // effect, so the frame the platform turns on stage is never painted with the tower at
    // full height. Only the world on screen can be mid-swap (no pans mid-swap). Under
    // reduced motion the swap is instant and never pending; an empty deck plays nothing.
    const swapReadyKey = swap.busy && swap.towerOnStage && swapDropPending(worldId) ? `${worldId}:${swap.towerDeck}` : null;
    useLayoutEffect(() => {
        if (swapReadyKey === null) return;
        startResize(0, deckCountsFor(worldId)[swap.towerDeck] ?? 0, { camera: false });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per swap's ready beat
    }, [swapReadyKey]);
    // The focus lever's re-read landing (its counts' fetch `version` moving past the one its
    // hold was taken at): the held tower shrinks (focus on) or grows (focus off) to the new
    // figure. Off screen, or no longer on Learning, the hold is just let go. Through a ref,
    // so the effect below only re-runs when a version moves.
    const resolveRecount = useRef<(id: TowerWorldId) => void>(() => {});
    resolveRecount.current = (id) => {
        const r = resizes[id];
        if (r.holdVersion === null || r.holdVersion === readyCounts[id].version) return;
        const toCards = learningCount(id);
        if (id !== worldId || toCards === undefined || swaps[id].towerDeck !== "learn-now") {
            r.release();
            return;
        }
        // Cards the learner cleared by marking them are progress, not an event: the tower
        // just stands at its new height, with no collapse (§ "Tower resizes").
        if (r.holdQuietShrink && toCards < (r.heldCards ?? 0)) {
            keepClimbThroughRefit(toCards);
            r.release();
            return;
        }
        startResize(r.heldCards ?? 0, toCards);
    };
    // Held while the home screen is up: the opening grow plays once the descent has landed,
    // where it can be seen (docs/HOME_SCREEN.md § "What waits").
    useEffect(() => {
        if (homeUp) return;
        for (const id of WORLD_ORDER) resolveRecount.current(id);
    }, [readyCounts.core.version, readyCounts.reading.version, readyCounts.writing.version, homeUp]);
    // ── Cooldown releases (docs/DECK_TOWER.md § "Cooldown releases") ────────────────
    // A card whose cooldown ends while the page is up joins the tower then, as its OWN sky
    // drop: useFlpReadyCounts holds the release schedule and reports cards that came due
    // (`pendingReleases`); this counts them in one at a time, each with a one-card grow.
    // While a drop plays the tower stands at its `fromCards`, so counting the card in at
    // the drop's start shows it only as it lands. Releases that come due during a swap,
    // pan, resize or study wait and then play one after another. The tower shown is the
    // only one animated: an off-screen world, or this one on its Mastered deck, takes its
    // releases quietly (arriving there shows the tower standing at the new height).
    // A hidden tab takes none (its drop would play unseen); the return re-read below
    // settles them.
    const releaseCooldowns = useRef<() => void>(() => {});
    releaseCooldowns.current = () => {
        if (document.hidden) return;
        for (const id of WORLD_ORDER) {
            const r = readyCounts[id];
            if (r.pendingReleases === 0 || studying(id) || swaps[id].busy || resizes[id].busy) continue;
            const watched = id === worldId && swaps[id].towerDeck === "learn-now";
            if (!watched) {
                r.applyReleases(r.pendingReleases);
                continue;
            }
            const fromCards = towerCounts[id];
            if (pan.busy || homeUp || fromCards === undefined) continue;
            startResize(fromCards, fromCards + 1);
            r.applyReleases(1);
        }
    };
    useEffect(() => {
        releaseCooldowns.current();
    }, [
        readyCounts.core.pendingReleases, readyCounts.reading.pendingReleases, readyCounts.writing.pendingReleases,
        resizes.core.busy, resizes.reading.busy, resizes.writing.busy,
        swaps.core.busy, swaps.reading.busy, swaps.writing.busy,
        swaps.core.towerDeck, swaps.reading.towerDeck, swaps.writing.towerDeck,
        pan.busy, study.active, worldId, homeUp,
    ]);
    // Back from a hidden tab: re-read every world (timers sleep in the background, and
    // another device may have marked cards meanwhile). The tower shown is held first, so
    // the cards that came off cooldown while it was out of sight land as one grow, like
    // opening the page (§ "Opening at the last height"); a lower figure just stands.
    const rereadOnReturn = useRef<() => void>(() => {});
    rereadOnReturn.current = () => {
        for (const id of WORLD_ORDER) {
            if (studying(id)) continue; // the climb-out re-reads it
            if (id === worldId && swaps[id].towerDeck === "learn-now" && !swaps[id].busy && !pan.busy) {
                resizes[id].hold(towerCounts[id] ?? 0, readyCounts[id].version, { quietShrink: true });
            }
            readyCounts[id].reload();
        }
    };
    useEffect(() => {
        const onVisibility = () => {
            if (!document.hidden) rereadOnReturn.current();
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => document.removeEventListener("visibilitychange", onVisibility);
    }, []);
    // A grow's camera move itself: scrollTop eased to the landing, written straight to the DOM
    // (marked as the page's own, so `climb` ignores it) and recorded as the new altitude.
    const cameraKey = resize.camera?.key;
    const cameraMs = resize.camera?.durationMs ?? 0;
    useEffect(() => {
        const el = scrollerRef.current;
        if (cameraKey === undefined || !el) return;
        cardsScroll.cancelGlide(); // the camera owns the scroller for its move
        const from = el.scrollTop;
        const to = cameraTarget.current;
        const settle = () => {
            climb.current = heightAbovePlatform(el);
        };
        if (cameraMs <= 0 || Math.abs(to - from) < 1) {
            el.scrollTop = to;
            placedScrollTop.current = el.scrollTop;
            settle();
            return;
        }
        const start = performance.now();
        let raf = 0;
        const tick = (now: number) => {
            const u = Math.min(1, (now - start) / cameraMs);
            const eased = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; // ease-in-out cubic
            el.scrollTop = from + (to - from) * eased;
            placedScrollTop.current = el.scrollTop;
            if (u < 1) raf = requestAnimationFrame(tick);
            else settle();
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- cardsScroll's methods read refs
    }, [cameraKey, cameraMs]);

    // ── Moving between worlds ────────────────────────────────────────────────────
    // Not while this world's deck swap runs: its fall is measured for the scene on screen.
    const panBlocked = pan.busy || swap.busy || resize.busy || study.active || homeUp;
    // Back up to the home: a FRESH pull past the deck's top (momentum stops there — useHomePull).
    // Not while anything else is moving the camera (`panBlocked` covers the home move itself).
    useHomePull({ scrollerRef, enabled: !panBlocked, onPull: home.returnHome });
    const goTo = (to: TowerWorldId | undefined, carry?: PanCarry) => {
        if (to && !panBlocked) pan.go(to, carry);
    };
    /** The world a swipe in `direction` heads for (LEFT brings the right-hand one in). */
    const swipeTarget = (direction: SwipeDirection) => (direction === "left" ? rightWorld : leftWorld);
    // A horizontal swipe on the scene: LEFT brings the right-hand world in (the camera
    // moves right), RIGHT the left-hand one. Axis-locked, so a vertical drag still climbs
    // the tower. While held, the scene runs slightly ahead of the finger — stiffly toward an
    // edge with no world beyond it — and springs back if the swipe does not commit. A
    // committed swipe hands its offset and release speed to the pan (`PanCarry`), which
    // carries the scene on from there: the drag's `translate` is dropped in the same frame
    // the pan's `transform` takes the offset over, so nothing jumps.
    const worldSwipe = useSwipeCommit({
        axisLock: true,
        disabled: panBlocked,
        threshold: () => Math.max(WORLD_SWIPE_MIN_PX, (scrollerRef.current?.clientWidth ?? 0) * WORLD_SWIPE_FRACTION),
        onCommit: (_id, direction, release) => {
            const width = scrollerRef.current?.clientWidth || 1;
            goTo(swipeTarget(direction), {
                shift: (release.dx * DRAG_FOLLOW) / width,
                velocity: (release.vx * DRAG_FOLLOW) / width,
            });
        },
        // The scene's svg is the camera (the header title stays put), and the cards page
        // under the platform rides along with it.
        paint: (scroller, dx, commit) => {
            const movers = [towerSceneOf(scroller), cardsPageRef.current].filter(
                (el): el is SVGSVGElement | HTMLDivElement => el !== null
            );
            if (dx === null) {
                // Committing toward a world: the pan takes the offset over, so drop it at
                // once. Otherwise (no world that way, or springing back) ease it home.
                const carried = commit !== undefined && swipeTarget(commit) !== undefined && !panBlocked;
                for (const el of movers) {
                    el.style.transition = carried ? "none" : DRAG_SNAP_BACK;
                    el.style.translate = "";
                }
                return;
            }
            const toward = swipeTarget(dx < 0 ? "left" : "right");
            for (const el of movers) {
                el.style.transition = "none";
                el.style.translate = `${dx * (toward ? DRAG_FOLLOW : DRAG_FOLLOW_EDGE)}px 0`;
            }
        },
    });

    const faceFor = (deck: TowerDeckId): PlateFace => ({
        text: TOWER_DECKS[deck].label,
        band: TOWER_DECKS[deck].band,
        wallSteps: TOWER_DECKS[deck].plateWallSteps,
    });
    const splat = swap.splat;

    // ── The study's fades, all on the dive's eased position `e` (0 = tower view) ─────
    const e = study.e;
    const towerUiOpacity = 1 - clamp01(e / TOWER_UI_GONE_AT);
    // The cards page's per-frame styling: the pan's slide (the scene's own transform) and
    // the dive's fade. Memoized so a frame that changes neither keeps the page memoized.
    const cardsPageShift = pan.sceneShiftX;
    const studyActive = study.active;
    const cardsPageStyle = useMemo<React.CSSProperties>(
        () => ({
            transform: cardsPageShift !== 0 ? `translateX(${(cardsPageShift * 100).toFixed(2)}%)` : undefined,
            opacity: towerUiOpacity,
            pointerEvents: studyActive ? "none" : undefined,
        }),
        [cardsPageShift, towerUiOpacity, studyActive]
    );
    const sessionOpacity = study.cameraDown ? 1 : study.phase === "preparing" ? 0 : clamp01((e - SESSION_FADE_FROM) / (1 - SESSION_FADE_FROM));
    const skyTrafficOpacity = 1 - clamp01(e / SKY_TRAFFIC_GONE_AT);
    // The sky's altitude while a session is up: HELD where the view stood at the tap, so
    // the sky (and its stars) stays as it was for the whole session — it does not follow
    // the camera's dive or climb (docs/DECK_TOWER.md § "Studying the tower").
    const studyAltitudeY = study.active ? study.startMidY : null;
    // The night wash fades out on the dive and back in on the climb, so the count card the
    // camera lands on is already unwashed when the (never-washed) flp card takes its place —
    // no blue seam at night (docs/DECK_TOWER.md § Time of day → "The wash"). Stepped to
    // 1/WASH_FADE_STEPS of the dive, because a new wash identity re-washes IsoScene's whole
    // palette; held at NO_WASH while the camera is down (e = 1). Day's NO_WASH passes through
    // `blendWash` as the identity, so by day this costs nothing.
    const washFadeStep = Math.round(clamp01(e) * WASH_FADE_STEPS);
    const sceneWash = useMemo(
        () => (washFadeStep === 0 ? light.wash : blendWash(light.wash, NO_WASH, washFadeStep / WASH_FADE_STEPS)),
        [light.wash, washFadeStep]
    );

    // ── Tap to Start (docs/DECK_TOWER.md § "Tap to Start") ───────────────────────
    // Only the Learning tower starts a session — the flp deals exactly that deck: this
    // world's bar, in Study Mix over the whole library (the only loop the flp deals). Not
    // mid-swap, mid-pan or mid-resize, and not on an empty or still-loading tower.
    const startable =
        swap.titleDeck === "learn-now" &&
        swap.towerDeck === "learn-now" &&
        !swap.busy &&
        !study.active &&
        towerCounts[worldId] !== undefined &&
        towerCount > 0;
    // The tap STUDIES the tower in place (useTowerStudy): no navigation. The session is the
    // world's bar in Study Mix — already mounted
    // and dealt under the tower (useTowerStudy § "Studying the tower" → "Parked sessions").
    const onStackTap = () => {
        // The click that ends a world swipe (or a scroll) is not a tap.
        if (worldSwipe.wasDrag() || pan.busy || resize.busy || study.active) return;
        const el = scrollerRef.current;
        const svg = towerSceneOf(el ?? null);
        if (!el || !svg) return;
        // The sky's altitude right now — the viewBox y at the middle of the view — which the
        // backdrop holds for the whole session (SpaceBackdrop `altitudeY`).
        const svgRect = svg.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const scale = svgRect.width / scene.width;
        const startMidY = scene.minY + (elRect.top + (el.clientHeight - footerPx()) / 2 - svgRect.top) / scale;
        study.start({ world: worldId, cards: towerCount, svg, viewBox: { minX: scene.minX, minY: scene.minY, width: scene.width }, startMidY });
    };

    // ── Handing the tower back after a session ───────────────────────────────────
    // The climb has ended: the tower stands at the session's count (`cards`) — the local
    // tally of correct marks, which can be off the server's (a correct mark dropped on
    // cooldown, an Unfamiliar card's 5-minute rest running out mid-session). So it is held
    // there and the bar's counts re-read; when they land, `resolveRecount` plays a grow to
    // the real figure — the focus lever's path — or, for a lower figure, quietly stands
    // there. Every world reconciles; the refit from the frozen session frame to the
    // tower's new height keeps the altitude.
    climbedOut.current = (w, n) => {
        keepClimbThroughRefit(n);
        resizes[w].hold(n, readyCounts[w].version, { quietShrink: true });
        readyCounts[w].reload();
    };

    // ── Opening at the last height (docs/DECK_TOWER.md § "Opening at the last height") ──
    // Main's Learning tower only. On arrival it stands at the height it had when the
    // learner last saw it on this device (towerHeightStore.ts), held there until the bar's
    // counts land; then `resolveRecount` plays the grow (cards came off cooldown) to today's
    // figure. A lower figure (cards marked in the games) just shows. Nothing stored: it
    // just stands at its height. Taken once per account + language.
    const userId = user?.id;
    const language = user?.selectedLanguage ?? "zh";
    const openedAtHeightFor = useRef<string | null>(null);
    useLayoutEffect(() => {
        if (userId === undefined) return;
        const key = `${userId}:${language}`;
        if (openedAtHeightFor.current === key) return;
        openedAtHeightFor.current = key;
        if (readyCounts.core.loaded) return; // the counts beat us here: nothing to animate from
        const stored = readTowerHeight(userId, language, "core", "learn-now");
        if (stored !== null) resizes.core.hold(stored, readyCounts.core.version, { quietShrink: true });
    // Taken once per account + language; the hold's own version check does the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, language]);
    // …and the height it stands at is written back whenever it is SETTLED (not mid-resize,
    // mid-swap or loading), and through a session on it, card by card.
    const coreSettledCount =
        studying("core")
            ? study.cards
            : !resizes.core.busy && !swaps.core.busy && swaps.core.towerDeck === "learn-now" && readyCounts.core.loaded
              ? towerCounts.core
              : undefined;
    useEffect(() => {
        if (userId === undefined || coreSettledCount === undefined) return;
        writeTowerHeight(userId, language, "core", "learn-now", coreSettledCount);
    }, [userId, language, coreSettledCount]);

    return (
        // The banking run waits for the home screen to go (it is stamped seen as it starts).
        <DailyBankingProvider held={bankingHeld}>
            <MobileTabScreen
                // The world's title ("Flashcards", "Reading", "Writing")
                // is the header's title. It stays put through a pan and swaps text mid-pan,
                // while no scene is on screen; the deck shown is named by the plate and the
                // top card. White, so it reads on the sky and on space.
                title={world.title}
                headerTitleColor={skyInk}
                headerTrailingActions={<DeckTowerAvatar />}
                // Lift the header above the scroller (zIndex 1) so its flame and avatar are
                // tappable — see the two-layer note below.
                // While a session is up the session's own header stands here, so this one fades
                // with the dive and is UNMOUNTED once the camera is down: a minute-earning page
                // must mount exactly one PageHeader (each runs its own minute-points tick).
                wrapHeader={(header) =>
                    study.cameraDown ? null : (
                        <Box
                            ref={headerLayerRef}
                            className="deck-tower-page__header-layer"
                            sx={{
                                position: "relative",
                                zIndex: 2,
                                ...TOWER_TYPE_SX,
                                // Away while the home stage is up; fades in as the descent starts.
                                opacity: homeStageShown ? 0 : towerUiOpacity,
                                transition: homeUp ? "opacity 320ms ease-out" : undefined,
                                pointerEvents: study.active || homeUp ? "none" : undefined,
                            }}
                        >
                            {header}
                            {/* Feature-tester chips (docs/DECK_TOWER.md § "Feature-tester rows").
                                The short groups pair up on a TesterSharedRow — sky looks
                                together, the two actions together; the long Weather and
                                Forced-break rows keep a row each. */}
                            {testingFeatures && (
                                <>
                                    <TesterSharedRow name="sky">
                                        <TimeOfDayToggle value={timeOfDay.override} onChange={timeOfDay.setOverride} />
                                        <AuroraToggle value={aurora.override} onChange={aurora.setOverride} />
                                    </TesterSharedRow>
                                    <WeatherToggle value={towerWeather.override} onChange={towerWeather.setOverride} />
                                    <TesterSharedRow name="actions">
                                        <LightningStrikeChips onStrike={() => forceStrike(false)} onStrikePawn={() => forceStrike(true)} />
                                        <SnowResetChip onReset={towerSnow.reset} />
                                        <BankingAlwaysPlayToggle />
                                    </TesterSharedRow>
                                    <ForcedBreakPicker world={worldId} language={language as Language} />
                                </>
                            )}
                        </Box>
                    )
                }
                scrollable={false}
                surfaceColor={pan.palette.sky}
                className="deck-tower-page"
            >
                {/* Two layers:
                      - the SCROLLER (the scene) covers the WHOLE screen down to the footer bar —
                        header included — so a tall tower climbs over the header and off the top
                        of the screen;
                      - the HEADER is lifted above the scroller (`wrapHeader`), so its controls
                        (the minute-points flame, the profile picture) stay tappable. The
                        trade-off: a drag that starts on the header strip does not scroll the
                        tower, and a tall tower passes under the header's text.
                    ⚠️ The stage is deliberately NOT positioned. The scroller's containing block
                    is then MobileTabScreen's ScreenRoot (position: relative, the full screen),
                    which (a) puts its top at the top of the screen rather than under the
                    header, and (b) escapes the clipping of MobileTabScreen's ScrollArea, which
                    is overflow-hidden but unpositioned. Making the stage `position: relative`
                    would trap the scene under the header again. */}
                <Box className="deck-tower-page__stage" sx={{ flex: 1, minHeight: 0, ...TOWER_TYPE_SX }}>
                    {/* The sky behind the scene, in the world's colour (blending mid-pan), which
                        darkens into space as a tall tower is climbed (SPACE_BAND_CARDS). Same
                        box and z-index as the scroller but earlier in the DOM, so the scroller
                        paints over it. */}
                    <SpaceBackdrop
                        scrollerRef={scrollerRef}
                        band={scene.spaceBand}
                        palette={pan.palette}
                        groundStars={light.groundStars}
                        shootingStars={light.shootingStars && !auroraUp}
                        weather={weatherFx}
                        flashId={lightningFlashes.flashId}
                        // To the screen's bottom edge, not the footer's top: the slab footer
                        // floats, so sky shows in the gaps beside and below it.
                        bottom={0}
                        altitudeY={studyAltitudeY ?? homeAltitudeY}
                        scrollerBottomInset={footerSpacerPx}
                    />

                    {/* The one scroll surface (vertical only — the app's opt-in scrolling, see
                        docs/UX_AND_NAVIGATION.md). It runs under the footer slab. The scene's
                        `marginTop: auto` pins it to the bottom, so a short tower sits on the
                        footer with sky above it; a tall one overflows and scrolls. (NOT
                        `justify-content: flex-end` — that overflows past the TOP edge, where a
                        scroll container cannot reach, and the tower's top would be lost.)
                        It is also the world-swipe surface: `touch-action: pan-y` leaves the
                        vertical scroll native and hands horizontal drags to `worldSwipe`.
                        It runs to the screen's BOTTOM edge, its last SLAB_FOOTER_TOTAL_HEIGHT a
                        spacer under the footer slab, so a fully-scrolled tower rests its platform
                        on the slab's top. The band is NOT clipped: the slab floats, so a tall
                        tower scrolling down passes behind it and shows in the gaps beside and
                        below it. Locked (no scroll) while a session is up: the camera aims
                        through the frame on screen. */}
                    <Box
                        ref={scrollerRef}
                        className="deck-tower-page__scroller"
                        data-swipe-id="world"
                        {...worldSwipe.handlers}
                        onScroll={recordClimb}
                        sx={{
                            position: "absolute",
                            zIndex: 1,
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            overflowX: "hidden",
                            // Locked through a study and the home move (the descent scrolls it itself).
                            overflowY: study.active || homeUp ? "hidden" : "auto",
                            overscrollBehavior: "contain",
                            touchAction: study.active || homeUp ? "none" : "pan-y",
                            // The home stage: the tower is laid out (measurable) but unseen;
                            // Enter raises it in from below, a return drops it off the bottom
                            // (`towerY`, stage heights).
                            visibility: home.phase === "home" ? "hidden" : undefined,
                            transform: homeShifting ? `translateY(${(home.frame.towerY * 100).toFixed(2)}%)` : undefined,
                            pointerEvents: homeUp ? "none" : undefined,
                            // No visible scrollbar (desktop draws a chunky grey one over the sky).
                            // Wheel / trackpad / touch scrolling all still work.
                            scrollbarWidth: "none",
                            "&::-webkit-scrollbar": { display: "none" },
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        {/* Falling things lose their floor shadows (the floor is gone from under
                            them). Targets the shadow paths' own classes: the pawn's shadow GROUP
                            has its opacity written inline every frame, which a class can't beat. */}
                        <style>{`
                            .deck-tower-page__falling .iso-card-stack__shadow,
                            .deck-tower-page__falling .iso-paper-stack__shadow,
                            .deck-tower-page__falling .iso-sort-platform__shadow,
                            .deck-tower-page__falling .iso-pawn__shadow,
                            .deck-tower-page__falling .iso-pawn__decal-anchor,
                            .deck-tower-page__falling .iso-hatch__shadow { opacity: 0; transition: opacity 120ms ease-out; }
                            /* A falling floor fixture (the lever) leaves its
                               hatch behind: the lift top, hole and flaps belong to the swung-away
                               floor, so only the fixture itself drops. */
                            .deck-tower-page__falling .iso-hatch__lift-top,
                            .deck-tower-page__falling .iso-hatch__hole,
                            .deck-tower-page__falling .iso-hatch__flap { display: none; }
                        `}</style>
                        {/* Schedules the clouds and wind the scene's two sky layers draw; renders nothing. */}
                        <SkyTrafficSource
                            store={skyTraffic}
                            proj={proj}
                            cloudSky={scene.cloudSky}
                            windSky={scene.windSky}
                            cloudsActive={cloudsActive}
                            windActive={windActive}
                            maxClouds={Math.max(1, cloudsInSky)}
                            maxGusts={WIND_GUSTS_MAX}
                        />
                        {/* The TOWER SECTION: the scene and the band under the footer slab. At least
                            a screen tall, the scene pinned to its bottom (`marginTop: auto`), so a
                            short tower still rests on the footer with sky above it now that the
                            cards page runs on below. Its bottom edge is the platform line
                            (towerScroll). */}
                        <Box
                            className={TOWER_SECTION_CLASS}
                            // `position: relative` anchors the bottom row of cues (WorldIndicator,
                            // CardsCue), which live IN this section so they scroll with the
                            // platform rather than staying fixed to the screen.
                            sx={{ position: "relative", minHeight: "100%", flexShrink: 0, display: "flex", flexDirection: "column" }}
                        >
                        <IsoScene
                            proj={sceneProj}
                            // Fades out with the dive (sceneWash above).
                            wash={sceneWash}
                            viewBox={scene.viewBox}
                            className={TOWER_SCENE_CLASS}
                            // `transform` is the world pan's slide (stage widths); a held swipe's
                            // follow is written to the separate `translate` property (paint above),
                            // so the two never overwrite each other.
                            style={{
                                width: "100%",
                                aspectRatio: scene.aspectRatio,
                                flexShrink: 0,
                                marginTop: "auto",
                                display: "block",
                                overflow: "visible",
                                transform: pan.sceneShiftX !== 0 ? `translateX(${(pan.sceneShiftX * 100).toFixed(2)}%)` : undefined,
                            }}
                        >
                            {/* "Tap to Start", painted on the sky at a fixed height over the
                                platform. First in the scene, so the tower paints over it. */}
                            <TapToStartHint
                                centreX={hintFit.minX + hintFit.width / 2}
                                tipY={hintFit.towerTopY}
                                visible={startable && !pan.busy}
                            />
                            {/* Keyed by world: arriving mounts a fresh platform and pawn. */}
                            <DeckTowerPlatform
                                key={worldId}
                                world={world}
                                hingeAngle={swap.hingeAngle}
                                stack={
                                    stackDrawn
                                        ? {
                                              count: towerCount,
                                              progress: stackProgress,
                                              label: TOWER_DECKS[swap.towerDeck].label,
                                              bandColor: TOWER_DECKS[swap.towerDeck].band,
                                              collapse: resize.collapse,
                                              drop: resize.drop,
                                              dropFigure: resize.toCards ?? undefined,
                                              onTap: startable && !pan.busy && !resize.busy ? onStackTap : undefined,
                                              // Bare while the count card is its own layer or off the deck.
                                              printOpacity: study.towerPrintShown ? 1 : 0,
                                          }
                                        : null
                                }
                                fadeOpacity={studying(worldId) ? study.platformOpacity : 1}
                                // The deck itself never fades (§ "The platform fades").
                                keepDeck={studying(worldId)}
                                bobPaused={study.active}
                                // Not while the count is loading: it reads as 0 then (towerCount's `?? 0`).
                                showImprint={towerCounts[worldId] !== undefined}
                                stackFalling={swap.outgoing !== null}
                                dropPx={(swap.outgoing?.drop ?? 0) * proj.heightUnit}
                                pawns={swap.pawns}
                                cardsOnTower={cardsOnTower}
                                // Mid-swap the build-up is a real grow from 0; otherwise the
                                // count is real once loaded and the snap to full height has
                                // happened (progress leaves 0 the render after counts arrive).
                                towerCountKnown={swap.busy || (mayGrow(worldId) && stackProgress > 0)}
                                summitCards={resize.toCards !== null ? Math.min(cardsOnTower, resize.toCards) : cardsOnTower}
                                summitHeld={study.active}
                                summitSpot={summitSpot}
                                swapOutgoing={swap.outgoing !== null}
                                plate={{
                                    face: faceFor(swap.titleDeck),
                                    ariaLabel: `Show ${TOWER_DECKS[otherTowerDeck(swap.titleDeck)].title}`,
                                    onTap: onPlateTap,
                                    // Pressing it brushes the snow off it, like the sort platform's tap.
                                    onPress: () => towerSnow.clear(worldId, "plate", { brush: true }),
                                    busy: swap.busy || pan.busy || resize.busy || study.active,
                                }}
                                // Pulling the lever brushes the snow off its ball (docs/TOWER_SNOW.md).
                                lever={{
                                    ...focusLevers[worldId].lever,
                                    onTap: () => {
                                        focusLevers[worldId].lever.onTap();
                                        towerSnow.clear(worldId, "lever", { brush: true });
                                    },
                                }}
                                notebook={
                                    // Only with the Learning tower drawn: swap.towerDeck is the OLD deck until
                                    // the trap door clears, so leaving Learning it falls with the tower, and
                                    // arriving it waits off stage, then grows in on the slam (`fixtureProgress`).
                                    worldId === "writing" && notebookTotal !== undefined && stackDrawn && swap.towerDeck === "learn-now"
                                        ? {
                                              sheets: notebookSheets(notebookTotal),
                                              progress: fixtureProgress,
                                              ariaLabel: "Open the Writing Notebook",
                                              // In and out with the circle transition, from and back onto the stack
                                              // (`circleFrom` — the notebook reads it back for its Back).
                                              // Its snow brushes off as the circle opens (concurrent, not before).
                                              onTap: (at) => {
                                                  towerSnow.clear(worldId, "notebook", { brush: true });
                                                  slideNavigate(NOTEBOOK_PATH, { circleFrom: at, state: { exitTo: NOTEBOOK_EXIT, circleFrom: at } });
                                              },
                                              busy: swap.busy || pan.busy || resize.busy || study.active,
                                          }
                                        : undefined
                                }
                                sortBin={
                                    // The notebook's rules, on main: only with the Learning tower drawn,
                                    // falling with it, growing in on the slam (docs/DECK_TOWER.md § "The sort platform").
                                    worldId === "core" && stackDrawn && swap.towerDeck === "learn-now"
                                        ? {
                                              progress: fixtureProgress,
                                              hopping: learningLow,
                                              ariaLabel: "Add cards",
                                              // In with the world pan's dash (src/hooks/pageDash.ts): the camera
                                              // travels RIGHT onto acp, in this world's washed streaks. The streak
                                              // colour rides along in `state.dash`, so acp's Back dashes back LEFT
                                              // and returns here (`SORT_EXIT`).
                                              onTap: () => {
                                                  const from = scrollerRef.current;
                                                  if (!from) return;
                                                  // Its snow brushes off as the dash leaves (concurrent, not before).
                                                  towerSnow.clear(worldId, "sortBin", { brush: true });
                                                  const dash = { lineColor: light.wash(ISO.wind) };
                                                  slideNavigate(sortPath, { dash: { ...dash, from }, state: { exitTo: SORT_EXIT, dash } });
                                              },
                                              busy: swap.busy || pan.busy || resize.busy || study.active,
                                          }
                                        : undefined
                                }
                                // Clouds and wind on the tower's BACK sides (under it) and FRONT
                                // sides (over it) — SkyTraffic.tsx.
                                behind={<SkyTrafficLayer store={skyTraffic} side="behind" opacity={skyTrafficOpacity} />}
                                // The clouds' shadows on the floor and the ground (iso/IsoCloudShadow.tsx).
                                cloudShadows={({ receiver, clip }) => (
                                    <SkyTrafficCloudShadows store={skyTraffic} receiver={receiver} clip={clip} opacity={skyTrafficOpacity} />
                                )}
                                front={<SkyTrafficLayer store={skyTraffic} side="front" opacity={skyTrafficOpacity} />}
                                // Fog lies over the platform in iso space, not on the sky (iso/IsoFog.tsx).
                                fog={fogClouds && weatherFx ? { opacity: weatherFx.fog, clouds: fogClouds } : undefined}
                                // Not during a study: the camera's projector moves every frame, and
                                // the session covers the platform anyway.
                                rain={study.active || auroraUp ? undefined : rainFall}
                                rainCeilingY={scene.rainCeilingY}
                                lightning={platformLightning}
                                // Not during a study, like the rain.
                                snowFall={study.active || auroraUp ? undefined : snowFall}
                                snow={platformSnow}
                            />
                            {/* Over everything: the old tower hitting the floor below the screen. */}
                            {splat && (
                                <CardSplat
                                    key={`splat-${worldId}-${splat.id}`}
                                    elapsedMs={splat.elapsedMs}
                                    floorY={scene.splatFloor.y}
                                    minX={scene.splatFloor.minX}
                                    maxX={scene.splatFloor.maxX}
                                    unit={UNIT}
                                    cards={splat.cards}
                                    bandColor={TOWER_DECKS[splat.deck].band}
                                    cardW={CARD_W}
                                    cardD={CARD_D}
                                />
                            )}
                        </IsoScene>
                        {/* The band under the footer slab (see the scroller's note). */}
                        <Box ref={footerSpacerRef} className="deck-tower-page__footer-spacer" sx={{ height: SLAB_FOOTER_TOTAL_HEIGHT, flexShrink: 0 }} />
                        {/* THE BOTTOM ROW OF CUES — part of the scrolling content, not fixed to the
                            screen: positioned in this section (its bottom = the footer spacer's
                            bottom), so at rest they sit just above the footer slab, and they move
                            with the platform (up and away as the cards page rises, down out of
                            view as a tall tower is climbed). Hidden while the camera dashes or a
                            deck swap runs (neither swipe nor arrow works then). */}
                        {leftWorld && (
                            <WorldIndicator side="left" name={TOWER_WORLDS[leftWorld].name} onTap={() => goTo(leftWorld)} hidden={panBlocked} bottom={SLAB_FOOTER_TOTAL_HEIGHT} color={skyInk} />
                        )}
                        {rightWorld && (
                            <WorldIndicator side="right" name={TOWER_WORLDS[rightWorld].name} onTap={() => goTo(rightWorld)} hidden={panBlocked} bottom={SLAB_FOOTER_TOTAL_HEIGHT} color={skyInk} />
                        )}
                        {/* The way down to the cards page, between the two world arrows; it also
                            fades as the cards page rises. */}
                        <CardsCue scrollerRef={scrollerRef} onTap={cardsScroll.toCards} hidden={panBlocked} bottom={SLAB_FOOTER_TOTAL_HEIGHT} color={skyInk} />
                        </Box>

                        {/* THE CARDS PAGE — the world's card library under the platform
                            (§ "The cards page"). Keyed by world: a pan mounts the next world's
                            page, on its own lens. It slides with the scene through a pan, and
                            fades with the tower's UI on a study's dive. */}
                        <TowerCardsPage
                            key={worldId}
                            ref={cardsPageRef}
                            world={worldId}
                            ink={skyInk}
                            sky={pan.palette.sky}
                            onOpenCard={onOpenTowerCard}
                            onUp={cardsScroll.up}
                            style={cardsPageStyle}
                        />
                    </Box>

                    {/* The study session (docs/DECK_TOWER.md § "Studying the tower"): the flp,
                        laid over the scene, its card exactly on the tower's top card. One per
                        enabled world, mounted PARKED as the page lands and kept (§ "Studying the tower" → "Parked sessions"):
                        a parked layer is laid out — so its card can be measured for the camera the
                        moment its tower is tapped — but clipped away to nothing (clip-path also
                        hides its children whatever their own visibility, and takes no hits). The
                        studied one fades in with the dive and takes input once the camera is down. */}
                    {study.sessions.map(({ key, host }) => (
                        <Box
                            key={key}
                            className={`deck-tower-page__study-layer deck-tower-page__study-layer--${host.parked ? "parked" : "studied"}`}
                            aria-hidden={host.parked || undefined}
                            sx={{
                                position: "absolute",
                                inset: 0,
                                zIndex: 3,
                                display: "flex",
                                flexDirection: "column",
                                opacity: host.parked ? 0 : sessionOpacity,
                                clipPath: host.parked ? "inset(50%)" : undefined,
                                pointerEvents: !host.parked && study.phase === "studying" ? "auto" : "none",
                            }}
                        >
                            {/* Out of the banking run's reach: this session's own header flame
                                (mounted even while parked) must not draw the run or become the
                                embers' launch point — DailyBankingContext § OPT-OUT BOUNDARY. */}
                            <DailyBankingOptOut>
                                <Suspense fallback={null}>
                                    <StudySession tower={host} />
                                </Suspense>
                            </DailyBankingOptOut>
                        </Box>
                    ))}
                    {/* The tower's count card, over the session while it slides off the deck (and
                        back on before the climb) — TowerCoverCard. */}
                    {study.cover && (
                        <TowerCoverCard
                            pawnAt={summitSpot.current}
                            cover={study.cover}
                            // The studied tower's deck: its top card's head band rides along. Only
                            // Learning can be studied (onStackTap), so that is the fallback.
                            deck={TOWER_DECKS[study.world ? swaps[study.world].towerDeck : "learn-now"]}
                            // The scene's own (dive-faded) wash: unwashed while down, like the flp card under it.
                            wash={sceneWash}
                            // A snowy top card rides off with its snow; it comes back bare (the
                            // tower's snow is cleared once the session is up).
                            snow={study.world && study.cover.mode === "lifting" ? towerSnow.cover(study.world, "tower") : undefined}
                            // Its trail rides off with it (the pawn's channel through the cap).
                            snowTrail={study.world ? towerSnow.trail(study.world, "tower") : undefined}
                        />
                    )}

                    {/* The dash between worlds: streaks racing past, over the (empty) sky. */}
                    {pan.busy && pan.direction !== 0 && (
                        <SpeedLines direction={pan.direction} strength={pan.speed} bottom={0} color={light.wash(ISO.wind)} />
                    )}
                    {/* The home shifts: the pan's streaks turned vertical — rising as Enter takes the camera
                        down, falling as a return takes it back up. */}
                    {homeShifting && (
                        <SpeedLines axis="y" direction={home.phase === "return" ? 1 : -1} strength={home.frame.speed} bottom={0} color={light.wash(ISO.wind)} />
                    )}

                    {/* THE HOME STAGE (docs/HOME_SCREEN.md) — over everything td draws, on td's sky. */}
                    {homeStageShown && (
                        <HomeStage
                            proj={proj}
                            // td's frame: its width and bottom edge are the same for every tower.
                            frame={scene}
                            world={homeWorld}
                            wash={light.wash}
                            rain={auroraUp ? undefined : rainFall}
                            snowFall={auroraUp ? undefined : snowFall}
                            fog={fogClouds && weatherFx ? { opacity: weatherFx.fog, clouds: fogClouds } : undefined}
                            sky={pan.palette.sky}
                            shiftY={homeShifting ? home.frame.homeY : 0}
                            busy={home.phase !== "home"}
                            onDictionary={openDictionaryFromHome}
                            onEnter={home.enter}
                        />
                    )}

                </Box>
                {focusLevers.core.dialog}
                {focusLevers.reading.dialog}
                {focusLevers.writing.dialog}
            </MobileTabScreen>
            {/* The banking run's ember stream — portaled to <body>, so its place here is moot. */}
            <BankingEmbers />
        </DailyBankingProvider>
    );
};

export default DeckTowerPage;
