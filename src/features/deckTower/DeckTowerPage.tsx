import React, { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
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
    prism,
    type Projector,
    projectOutline,
    roundedRectWorld,
    shadowFootprint,
    type CloudSky,
    type WindSky,
} from "./iso";
import { useAuth } from "../../AuthContext";
import { useFlpReadyCounts } from "../../hooks/useFlpReadyCounts";
import { useFocusLever, type FocusLever } from "./useFocusLever";
import { useMasteredCounts } from "../../hooks/useMasteredCounts";
import { useSwipeCommit, type SwipeDirection } from "../../hooks/useSwipeCommit";
import { builtinCollectionCount } from "../flashcards/builtinCollections";
import SpaceBackdrop, { type SpaceBand } from "./SpaceBackdrop";
import SpeedLines from "./SpeedLines";
import WorldIndicator from "./WorldIndicator";
import DeckTowerAvatar from "./DeckTowerAvatar";
import TapToStartHint from "./TapToStartHint";
import { TOWER_DECKS, otherTowerDeck, type TowerDeckId } from "./towerDecks";
import CardSplat from "./CardSplat";
import { SkyTrafficLayer, SkyTrafficSource } from "./SkyTraffic";
import { useSkyTrafficStore } from "./skyTrafficStore";
import DeckTowerPlatform, { type PlateFace } from "./DeckTowerPlatform";
import { useDeckSwap } from "./useDeckSwap";
import { useBuildProgress } from "./useBuildProgress";
import { useTowerResize } from "./useTowerResize";
import { pickTowerGrow, pickTowerShrink } from "./towerResizes";
import { TOWER_MODES, bandTotal } from "./towerModes";
import { useWorldPan, type PanCarry } from "./useWorldPan";
import { CARD_D, CARD_W, FLOOR_Z, PLATFORM_THICKNESS, TOWER_LAYOUT } from "./towerPlatforms";
import { TOWER_WORLDS, WORLD_ORDER, type TowerWorldId } from "./towerWorlds";
import { useTowerStudy } from "./useTowerStudy";
import { litWorld } from "./timeOfDay";
import { useTimeOfDay } from "./useTimeOfDay";
import TimeOfDayToggle from "./TimeOfDayToggle";
import ForcedBreakPicker from "./ForcedBreakPicker";
import type { Language } from "../../types";
import TowerCoverCard from "./TowerCoverCard";
import { readTowerHeight, writeTowerHeight } from "./towerHeightStore";
import { useHideFooter } from "../../hooks/useHideFooter";
import { useThemeColor } from "../../hooks/useThemeColor";
import { useBlockEdgeSwipe } from "../../hooks/useBlockEdgeSwipe";
import { useClaimStudySurface } from "../../minutePoints/studySurface";

/**
 * The flp session a study lays over the tower (docs/DECK_TOWER.md § "Studying the tower"):
 * the flp page itself, in its `tower` host mode. Lazy — the same chunk as the
 * `/flashcards/learn` route, loaded when the first world's session mounts parked — and
 * memoised, so the camera's per-frame re-renders of this page never re-render a session.
 */
const StudySession = lazy(() =>
    import("../flashcards/FlashcardsLearnPage").then((m) => ({ default: React.memo(m.default) }))
);

/**
 * /deck-tower — the learner's Learning deck drawn as a stack of cards standing on an
 * isometric platform (docs/DECK_TOWER.md), built from the iso art framework in ./iso
 * (docs/ISO_ART_FRAMEWORK.md).
 *
 * Layer: page (feature module `src/features/deckTower`). Reads each world's two figures
 * through existing hooks, no new endpoint: Learning is the bar's cards that are OFF
 * COOLDOWN right now (`useFlpReadyCounts` — the same readiness rule the flp deals by), in
 * all four utcm bands (towerModes.ts → Mix), and Mastered is the bar's whole Mastered total
 * (`useMasteredCounts`).
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
 * colour and the new platform slides in (useWorldPan.ts, SpeedLines.tsx). The main tower
 * builds up on page load; a skill world's tower is already standing when you arrive.
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
 * This file only LAYS OUT the scene: which world is up, what stands on it, and the
 * viewBox. The platform draws itself (DeckTowerPlatform.tsx).
 *
 * The footer's Deck tab (it took Discover's slot 2026-10-17), so it renders in a
 * non-scrolling MobileTabScreen and ends with a FooterSpacer: the scene shrinks to fit
 * above the footer bar rather than sliding under it. Still experimental.
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
 * in world units.
 */
const BOTTOM_MARGIN = 0.4;

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

/** The study header's title: the deck, named with its world off the main one. */
const studyTitleFor = (world: TowerWorldId) =>
    world === "core" ? TOWER_DECKS["learn-now"].title : `${TOWER_WORLDS[world].name}: ${TOWER_DECKS["learn-now"].title}`;

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
 * drift slowly past the tower's four sides (useCloudDrifts). They fade in when the
 * build-up puts the `from`-th card on the tower, so a deck under 250 never has clouds.
 * On a deck that stops short of `to`, the band's top is lowered to SKY_CEILING_ABOVE_TOP
 * over the settled tower's top, so the clouds drift by the tower rather than empty sky.
 */
const CLOUD_BAND_CARDS = { from: 250, to: 300 };
/** How many clouds may be in the sky at once (2–3 is the look; 3 slots, with gaps between drifts). */
const CLOUDS_IN_SKY_MAX = 3;

/**
 * The tower's wind band: gusts (streaks ending in a curl, IsoWind) sweep past the tower's
 * four sides with their baselines at the height of these cards (useWindGusts). They start
 * blowing when the build-up puts the `from`-th card on the tower, so a deck under 350
 * never has wind; a deck short of `to` lowers the band's top the same way as the clouds'.
 * It sits in the empty sky between the clouds (250–300) and space (450+).
 */
const WIND_BAND_CARDS = { from: 350, to: 400 };
/** How many gusts may be playing at once. Two keeps the band breezy without clutter. */
const WIND_GUSTS_MAX = 2;

/**
 * The reading and writing worlds always have their clouds and wind, however short
 * their tower (for now — their decks are usually far smaller than main's): their sky is
 * measured at least this many cards high (the wind band's top), the travellers' bands stay
 * at their card heights instead of shrinking to the tower, and they fly whatever the
 * card count. Main keeps the earn-them rule (a band appears once the tower reaches it).
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
 * On a tower that stops inside a sky band (clouds, wind), the band's top is lowered to
 * this many world units over the settled tower's top, so its travellers stay beside the
 * tower rather than in empty sky above it.
 */
const SKY_CEILING_ABOVE_TOP = 3;

/**
 * A card band → world-z band: card k's underside is (k − 1) · CARD_THICKNESS over the
 * floor. The top is capped at SKY_CEILING_ABOVE_TOP over the tower's settled top
 * (`towerTopZ`, measured from the floor).
 */
function skyBand(cards: { from: number; to: number }, towerTopZ: number): { zMin: number; zMax: number } {
    const top = Math.min(cards.to * CARD_THICKNESS, towerTopZ + SKY_CEILING_ABOVE_TOP);
    return { zMin: FLOOR_Z + (cards.from - 1) * CARD_THICKNESS, zMax: FLOOR_Z + top };
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

const DeckTowerPage: React.FC = () => {
    const { user } = useAuth();
    // Ready-now (off-cooldown) counts per band of each bar. Fetched once on open: a card
    // coming off cooldown while the page is up does not grow the tower.
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
    // The skill worlds follow the account's goals — the same gate as the fdp's Centers.
    const worldShown = (id: TowerWorldId) =>
        id === "core" || (id === "reading" ? user?.readingGoal === true : user?.writingGoal === true);
    const shownWorlds = WORLD_ORDER.filter(worldShown);
    // ── Time of day (docs/DECK_TOWER.md § "Time of day") ─────────────────────────
    // The light every world is drawn under right now: each world's sky at this hour,
    // and the wash over everything on it. Feature testers can pin a phase
    // (TimeOfDayToggle, users.isFeatureTester).
    const isFeatureTester = user?.isFeatureTester === true;
    const timeOfDay = useTimeOfDay(isFeatureTester);
    const light = timeOfDay.light;
    // The page's own white things painted on the sky (title, arrows, speed lines) — lit too.
    const skyInk = light.wash(ISO.white);
    // The flp session (HTML over the scene) and the slab footer are NOT washed. They used to
    // be, through an SVG feColorMatrix `url()` filter, but WebKit rasterises an SVG filter on
    // HTML on the CPU: every repaint inside the session (a key press, the eip opening)
    // re-filtered the whole layer, which made the flp's taps lag at night. Cut 2026-10-30
    // (docs/DECK_TOWER.md § "Time of day" → "The wash").
    const pan = useWorldPan((id) => ({ sky: light.skyOf(TOWER_WORLDS[id]), space: TOWER_WORLDS[id].space }));
    // The world on screen. One whose goal is switched off while it is up falls back to main.
    const worldId: TowerWorldId = shownWorlds.includes(pan.world) ? pan.world : "core";
    // The browser's top-edge colour follows the settled world's sky. Without a claim it is
    // the paper default, and iOS Safari draws its scroll-edge effect behind the clock as a
    // paper-white fade over the sky (and the top of a tall tower). Keyed on the world's
    // sky, not `pan.palette.sky`, so a pan does not rewrite the meta tag every frame.
    useThemeColor(light.skyOf(TOWER_WORLDS[worldId]));

    // ── Studying the tower (docs/DECK_TOWER.md § "Studying the tower") ────────────
    // The session is page state, not a route: useTowerStudy owns the dive, the camera and
    // the flp's host contract; this page draws the scene through its camera and hands the
    // tower back when it has climbed out (`climbedOut`, defined with the framing below).
    const climbedOut = useRef<(world: TowerWorldId, cards: number) => void>(() => {});
    const study = useTowerStudy({
        unit: UNIT,
        card: LAYOUT.card,
        // Each world's session mounts, parked, on its first visit and stays (§ "Parked
        // sessions"), so a tap dives straight in instead of waiting on the working loop.
        // Not before sign-in: the session deals for the account.
        visitedWorld: user?.id !== undefined ? worldId : null,
        titleFor: studyTitleFor,
        onClimbedOut: (w, n) => climbedOut.current(w, n),
    });
    const studying = (id: TowerWorldId) => study.active && study.world === id;
    // While a session is up the footer slides away, the edge swipe is blocked (a game-like
    // surface — docs/UX_AND_NAVIGATION.md), and the page earns minute points as a study
    // surface (src/minutePoints/studySurface.ts) — only once the camera is down, so the
    // dive and the climb do not count.
    useHideFooter(study.active);
    useBlockEdgeSwipe(study.active);
    useClaimStudySurface(study.phase === "studying");
    // A world's two decks, read through its own bar: Learning = that bar's OFF-COOLDOWN
    // cards (the flp's own readiness rule, so the tower never shows a card the flp would not
    // deal), in all four utcm bands (towerModes.ts → Mix). Mastered = that bar's whole
    // Mastered total, cooling or not. Undefined until loaded, so no tower builds from a
    // placeholder 0.
    const learningCount = (worldId: TowerWorldId): number | undefined =>
        readyCounts[worldId].loaded ? bandTotal(readyCounts[worldId].counts, TOWER_MODES.mix.bands) : undefined;
    const deckCountsFor = (worldId: TowerWorldId): Record<TowerDeckId, number | undefined> => ({
        "learn-now": learningCount(worldId),
        // The 'mastered' kind reads only `mastered.counts`; the band counts argument is unused.
        mastered: mastered.loaded ? builtinCollectionCount({ kind: "mastered", world: worldId }, readyCounts[worldId].counts, mastered.counts) ?? 0 : undefined,
    });

    const world = useMemo(() => litWorld(TOWER_WORLDS[worldId], light), [worldId, light]);
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
    // The deck each tower is fitted to — the old one until it has fallen clear, then the new.
    // While a resize plays (or holds), the Learning tower keeps the height it had at the
    // tap, so the build-up never sees the count change mid-animation.
    const towerCountFor = (id: TowerWorldId): number | undefined => {
        // Being studied: the tower loses a card per correct mark (useTowerStudy).
        if (studying(id)) return study.cards;
        const held = resizes[id].heldCards;
        return held !== null && swaps[id].towerDeck === "learn-now" ? held : deckCountsFor(id)[swaps[id].towerDeck];
    };
    const towerCounts: Record<TowerWorldId, number | undefined> = {
        core: towerCountFor("core"),
        reading: towerCountFor("reading"),
        writing: towerCountFor("writing"),
    };
    // A tower may grow once its counts are in and its swap's platform is not empty.
    const mayGrow = (id: TowerWorldId) => towerCounts[id] !== undefined && swaps[id].towerOnStage;
    // Every world keeps its tower built, on screen or not, so arriving shows it standing.
    // Every tower appears at full height (no build-up) and only grows after a deck swap
    // there (`animate` = mid-swap). Main used to build up on page load; since 2026-10-24 it
    // opens at the height it last stood at and plays a tower resize to today's figure
    // (§ "Opening at the last height"), or — with nothing stored — simply stands.
    const progress: Record<TowerWorldId, number> = {
        core: useBuildProgress(mayGrow("core"), towerCounts.core ?? 0, swaps.core.busy),
        reading: useBuildProgress(mayGrow("reading"), towerCounts.reading ?? 0, swaps.reading.busy),
        writing: useBuildProgress(mayGrow("writing"), towerCounts.writing ?? 0, swaps.writing.busy),
    };

    // The stack is drawn: the old tower as it stood at the tap while it falls, nothing while
    // the platform is empty mid-swap, then the build-up (from 0 cards until counts arrive).
    const stackDrawn = swap.outgoing !== null || swap.towerOnStage;
    const stackProgress = swap.outgoing?.frozenProgress ?? progress[worldId];
    const towerCount = towerCounts[worldId] ?? 0;
    // This world's tower resize. While a resize plays, the scene is fitted to the TALLER of
    // its two heights: a shrink starts from it, and a grow needs its sky to fall through.
    const resize = resizes[worldId];
    // Cards standing on the tower. A sky drop counts from its IMPACT (not the resize's end,
    // IMPACT_MS later), so a total crossing STARTLE_AT_CARDS startles the pawn as it lands.
    const cardsOnTower = !stackDrawn ? 0 : resize.dropLanded && resize.toCards !== null ? resize.toCards : Math.round(towerCount * stackProgress);
    // While a session is up the scene stays fitted to the tower as it stood at the tap: the
    // camera aims through this frame, and a refit would move the svg under it.
    const fitCount = studying(worldId)
        ? study.fitCards
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
    // The Tap to Start hint's fixed frame: a TAP_HINT_FIT_CARDS tower's. Its width and
    // bottom edge are every scene's (the platform's), so only its tower top differs.
    const hintFit = useMemo(() => fitScene(proj, TAP_HINT_FIT_CARDS, TAP_HINT_FIT_CARDS), [proj]);

    // The sky travellers circle the tower on screen. None start while the camera dashes
    // between worlds (the ones already out finish their crossing). They are scheduled and
    // drawn by SkyTraffic.tsx, outside this page's render: a crossing starting or ending
    // re-renders only the two sky layers, not the page (SkyTraffic.tsx header).
    const skyLive = !pan.busy && !study.active;
    const skyTraffic = useSkyTrafficStore();
    const cloudsActive = skyLive && (alwaysHasSky || cardsOnTower >= CLOUD_BAND_CARDS.from);
    const windActive = skyLive && (alwaysHasSky || cardsOnTower >= WIND_BAND_CARDS.from);

    // ── Scroll height, shared by every world ─────────────────────────────────────
    // The camera pans SIDEWAYS, so it keeps its height: arriving in a world opens at the
    // altitude the learner last scrolled to (`climb`, px above the bottom — the svg's
    // height differs per world, so a scrollTop would not carry over). A shorter tower clips
    // it at its top, but `climb` keeps the altitude asked for, so panning on to a taller
    // world climbs back to it. A refit WITHIN a world (its counts arriving, a deck swap's
    // refit) opens at the BOTTOM — the platform. Keyed on the world and the viewBox, which
    // only change with those, so a silent token refresh or the build-up never yanks it.
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
    // The scroller's own onScroll, so it is attached however late the scroller mounts.
    const recordClimb = (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        if (placedScrollTop.current !== null && Math.abs(el.scrollTop - placedScrollTop.current) < 1) return;
        placedScrollTop.current = null;
        climb.current = Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop);
    };
    // A tower resize's refit (to the taller frame as a grow starts, to the shorter one as a
    // shrink ends) keeps the altitude instead, like an arrival: the camera stays on
    // what the learner is watching. It names the viewBox it expects, so a switch that ends
    // up not refitting cannot leak the exception onto a later refit.
    const keepClimbFor = useRef<string | null>(null);
    useLayoutEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;
        const keepClimb = keepClimbFor.current === scene.viewBox;
        keepClimbFor.current = null;
        if (scrolledWorld.current !== worldId || keepClimb) {
            scrolledWorld.current = worldId;
            el.scrollTop = el.scrollHeight - el.clientHeight - climb.current; // the browser clamps at the top
            placedScrollTop.current = el.scrollTop;
        } else {
            el.scrollTop = el.scrollHeight;
            // Back on the platform: that is now the altitude to keep.
            climb.current = 0;
            placedScrollTop.current = el.scrollTop;
        }
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
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
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
    const startResize = (fromCards: number, toCards: number) => {
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
        const travel = Math.abs(target - from);
        cameraTarget.current = target;
        // The new cards start with their underside just over the screen's top edge (at the
        // camera's end), so the whole drop falls in from out of sight.
        const screenTopY = toScene.minY + (target - svgTop) / scale;
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
    useEffect(() => {
        for (const id of WORLD_ORDER) resolveRecount.current(id);
    }, [readyCounts.core.version, readyCounts.reading.version, readyCounts.writing.version]);
    // A grow's camera move itself: scrollTop eased to the landing, written straight to the DOM
    // (marked as the page's own, so `climb` ignores it) and recorded as the new altitude.
    const cameraKey = resize.camera?.key;
    const cameraMs = resize.camera?.durationMs ?? 0;
    useEffect(() => {
        const el = scrollerRef.current;
        if (cameraKey === undefined || !el) return;
        const from = el.scrollTop;
        const to = cameraTarget.current;
        const settle = () => {
            climb.current = Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop);
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
    }, [cameraKey, cameraMs]);

    // ── Moving between worlds ────────────────────────────────────────────────────
    // Not while this world's deck swap runs: its fall is measured for the scene on screen.
    const panBlocked = pan.busy || swap.busy || resize.busy || study.active;
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
        // The scene's svg is the camera (the header title stays put).
        paint: (scroller, dx, commit) => {
            const movers = [scroller.querySelector<SVGSVGElement>(":scope > svg")].filter(
                (el): el is SVGSVGElement => el !== null
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

    const faceFor = (deck: TowerDeckId): PlateFace => ({ text: TOWER_DECKS[deck].label, band: TOWER_DECKS[deck].band });
    const splat = swap.splat;

    // ── The study's fades, all on the dive's eased position `e` (0 = tower view) ─────
    const e = study.e;
    const towerUiOpacity = 1 - clamp01(e / TOWER_UI_GONE_AT);
    const sessionOpacity = study.cameraDown ? 1 : study.phase === "preparing" ? 0 : clamp01((e - SESSION_FADE_FROM) / (1 - SESSION_FADE_FROM));
    const skyTrafficOpacity = 1 - clamp01(e / SKY_TRAFFIC_GONE_AT);
    // The sky's altitude while a session is up: from where the view stood at the tap to
    // the camera's (the tower's top), so studying down a tall tower brings the sky back.
    const studyAltitudeY = study.active ? study.startMidY + (scene.axisYAtZ(study.cameraZ) - study.startMidY) * e : null;

    // ── Tap to Start (docs/DECK_TOWER.md § "Tap to Start") ───────────────────────
    // Only the Learning tower starts a session — the flp deals exactly that deck: this
    // world's bar, in Mix (no `mode`), the same path FlpStudyHand's Mix card opens. Not
    // mid-swap, mid-pan or mid-resize, and not on an empty or still-loading tower.
    const startable =
        swap.titleDeck === "learn-now" &&
        swap.towerDeck === "learn-now" &&
        !swap.busy &&
        !study.active &&
        towerCounts[worldId] !== undefined &&
        towerCount > 0;
    // The tap STUDIES the tower in place (useTowerStudy): no navigation. The session is the
    // world's bar in Mix — the same deal FlpStudyHand's Mix card opens — already mounted
    // and dealt under the tower (useTowerStudy § "Studying the tower" → "Parked sessions").
    const onStackTap = () => {
        // The click that ends a world swipe (or a scroll) is not a tap.
        if (worldSwipe.wasDrag() || pan.busy || resize.busy || study.active) return;
        const el = scrollerRef.current;
        const svg = el?.querySelector<SVGSVGElement>(":scope > svg");
        if (!el || !svg) return;
        // The sky's altitude right now — the viewBox y at the middle of the view — so the
        // backdrop can blend from it to the camera's (SpaceBackdrop `altitudeY`).
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
        <MobileTabScreen
            // The world's title ("Flashcards", "Reading Flashcards", "Writing Flashcards")
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
                        className="deck-tower-page__header-layer"
                        sx={{ position: "relative", zIndex: 2, fontFamily: FONTS.cjk, fontWeight: WEIGHT.bold, fontSynthesis: "weight", opacity: towerUiOpacity, pointerEvents: study.active ? "none" : undefined }}
                    >
                        {header}
                        {isFeatureTester && <TimeOfDayToggle value={timeOfDay.override} onChange={timeOfDay.setOverride} />}
                        {isFeatureTester && <ForcedBreakPicker world={worldId} language={language as Language} />}
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
            <Box className="deck-tower-page__stage" sx={{ flex: 1, minHeight: 0, fontFamily: FONTS.cjk, fontWeight: WEIGHT.bold, fontSynthesis: "weight" }}>
                {/* The sky behind the scene, in the world's colour (blending mid-pan), which
                    darkens into space as a tall tower is climbed (SPACE_BAND_CARDS). Same
                    box and z-index as the scroller but earlier in the DOM, so the scroller
                    paints over it. */}
                <SpaceBackdrop
                    scrollerRef={scrollerRef}
                    band={scene.spaceBand}
                    palette={pan.palette}
                    groundStars={light.groundStars}
                    shootingStars={light.shootingStars}
                    // To the screen's bottom edge, not the footer's top: the slab footer
                    // floats, so sky shows in the gaps beside and below it.
                    bottom={0}
                    altitudeY={studyAltitudeY}
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
                        overflowY: study.active ? "hidden" : "auto",
                        overscrollBehavior: "contain",
                        touchAction: study.active ? "none" : "pan-y",
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
                        maxClouds={CLOUDS_IN_SKY_MAX}
                        maxGusts={WIND_GUSTS_MAX}
                    />
                    <IsoScene
                        proj={sceneProj}
                        wash={light.wash}
                        viewBox={scene.viewBox}
                        className="deck-tower-page__scene"
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
                            deckOpacity={studying(worldId) ? study.deckOpacity : 1}
                            bobPaused={study.active}
                            // Not while the count is loading: it reads as 0 then (towerCount's `?? 0`).
                            showImprint={towerCounts[worldId] !== undefined}
                            stackFalling={swap.outgoing !== null}
                            dropPx={(swap.outgoing?.drop ?? 0) * proj.heightUnit}
                            pawns={swap.pawns}
                            cardsOnTower={cardsOnTower}
                            swapOutgoing={swap.outgoing !== null}
                            plate={{
                                face: faceFor(swap.titleDeck),
                                ariaLabel: `Show ${TOWER_DECKS[otherTowerDeck(swap.titleDeck)].title}`,
                                onTap: onPlateTap,
                                busy: swap.busy || pan.busy || resize.busy || study.active,
                            }}
                            lever={focusLevers[worldId].lever}
                            // Clouds and wind on the tower's BACK sides (under it) and FRONT
                            // sides (over it) — SkyTraffic.tsx.
                            behind={<SkyTrafficLayer store={skyTraffic} side="behind" opacity={skyTrafficOpacity} />}
                            front={<SkyTrafficLayer store={skyTraffic} side="front" opacity={skyTrafficOpacity} />}
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
                </Box>

                {/* The study session (docs/DECK_TOWER.md § "Studying the tower"): the flp,
                    laid over the scene, its card exactly on the tower's top card. One per
                    visited world, mounted PARKED on the visit and kept (§ "Studying the tower" → "Parked sessions"):
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
                        <Suspense fallback={null}>
                            <StudySession tower={host} />
                        </Suspense>
                    </Box>
                ))}
                {/* The tower's count card, over the session while it slides off the deck (and
                    back on before the climb) — TowerCoverCard. */}
                {study.cover && (
                    <TowerCoverCard
                        cover={study.cover}
                        // The studied tower's deck: its top card's head band rides along. Only
                        // Learning can be studied (onStackTap), so that is the fallback.
                        deck={TOWER_DECKS[study.world ? swaps[study.world].towerDeck : "learn-now"]}
                        wash={light.wash}
                    />
                )}

                {/* The dash between worlds: streaks racing past, over the (empty) sky. */}
                {pan.busy && pan.direction !== 0 && (
                    <SpeedLines direction={pan.direction} strength={pan.speed} bottom={0} color={light.wash(ISO.wind)} />
                )}

                {/* The way to the neighbouring worlds. Hidden while the camera dashes or a
                    deck swap runs (neither swipe nor arrow works then). */}
                {leftWorld && (
                    <WorldIndicator side="left" name={TOWER_WORLDS[leftWorld].name} onTap={() => goTo(leftWorld)} hidden={panBlocked} bottom={SLAB_FOOTER_TOTAL_HEIGHT} color={skyInk} />
                )}
                {rightWorld && (
                    <WorldIndicator side="right" name={TOWER_WORLDS[rightWorld].name} onTap={() => goTo(rightWorld)} hidden={panBlocked} bottom={SLAB_FOOTER_TOTAL_HEIGHT} color={skyInk} />
                )}
            </Box>
            {focusLevers.core.dialog}
            {focusLevers.reading.dialog}
            {focusLevers.writing.dialog}
        </MobileTabScreen>
    );
};

export default DeckTowerPage;
