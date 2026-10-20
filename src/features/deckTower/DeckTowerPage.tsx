import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Box, Typography } from "@mui/material";
import MobileTabScreen from "../../components/MobileTabScreen";
import { FOOTER_TOTAL_HEIGHT } from "../../components/MobileFooter";
import {
    BOB_HEIGHT,
    CARD_THICKNESS,
    ISO,
    IsoBird,
    IsoCloud,
    IsoScene,
    IsoWind,
    boundsOf,
    cardStackMetrics,
    makeProjector,
    prism,
    type Projector,
    projectOutline,
    roundedRectWorld,
    shadowFootprint,
    sortCloudsBackToFront,
    useBirdFlights,
    useCloudDrifts,
    useWindGusts,
    type BirdSky,
    type CloudSky,
    type WindSky,
} from "./iso";
import { useAuth } from "../../AuthContext";
import { useFlpReadyCounts } from "../../hooks/useFlpReadyCounts";
import { useFocusLever, type FocusLever } from "./useFocusLever";
import { useMasteredCounts } from "../../hooks/useMasteredCounts";
import { useSwipeCommit, type SwipeDirection } from "../../hooks/useSwipeCommit";
import { builtinCollectionCount } from "../flashcards/builtinCollections";
import { pageHeaderTitleTypeSx } from "../../components/PageHeader";
import SpaceBackdrop, { type SpaceBand } from "./SpaceBackdrop";
import SpeedLines from "./SpeedLines";
import WorldIndicator from "./WorldIndicator";
import { TOWER_DECKS, otherTowerDeck, type TowerDeckId } from "./towerDecks";
import CardSplat from "./CardSplat";
import DeckTowerPlatform, { type PlateFace } from "./DeckTowerPlatform";
import { useDeckSwap } from "./useDeckSwap";
import { useBuildProgress } from "./useBuildProgress";
import { useStudyModeSwitch } from "./useStudyModeSwitch";
import { MIX_ONLY_BANDS, TOWER_MODES, bandTotal, otherTowerMode, type TowerModeId } from "./towerModes";
import { useWorldPan, type PanCarry } from "./useWorldPan";
import { CARD_D, CARD_W, FLOOR_Z, PLATFORM_THICKNESS, TOWER_LAYOUT } from "./towerPlatforms";
import { TOWER_WORLDS, WORLD_ORDER, type TowerWorldId } from "./towerWorlds";

/**
 * /deck-tower — the learner's Learn Now deck drawn as a stack of cards standing on an
 * isometric platform (docs/DECK_TOWER.md), built from the iso art framework in ./iso
 * (docs/ISO_ART_FRAMEWORK.md).
 *
 * Layer: page (feature module `src/features/deckTower`). Reads each world's two figures
 * through existing hooks, no new endpoint: Learn Now is the bar's cards that are OFF
 * COOLDOWN right now (`useFlpReadyCounts` — the same readiness rule the flp deals by), in
 * the bands of the world's Mix / Review mode, and Mastered is the bar's whole Mastered total
 * (`useMasteredCounts`).
 *
 * Every world also has a Mix / Review switch on its platform wall (useStudyModeSwitch.ts):
 * Review ghosts the Unfamiliar + Target cards out of the tower and lets the rest settle;
 * Mix drops them back on from the sky (docs/DECK_TOWER.md § "Mix / Review switch").
 *
 * Up to three WORLDS (towerWorlds.ts), side by side: reading ← main (core) → writing, the
 * skill ones only while the account has that goal on (`users.readingGoal` /
 * `writingGoal`). One world is on screen at a time — the same platform in that world's
 * colours. A horizontal swipe (or the floating edge arrow, WorldIndicator) dashes the camera to the
 * neighbour: the scene whips off, speed lines stream past, the sky turns the new world's
 * colour and the new platform slides in (useWorldPan.ts, SpeedLines.tsx). The main tower
 * builds up on page load; a skill world's tower is already standing when you arrive.
 *
 * Every world has its OWN floor plate and deck: tapping the plate swaps that world's
 * tower between its two decks — the plate turns over, a transition clears the old tower,
 * a new pawn arrives and the new tower grows (one useDeckSwap per world,
 * docs/DECK_TOWER_TRANSITIONS.md).
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
 * Gap between the platform's shadow and the scene's bottom edge (= the footer bar's top),
 * in world units.
 */
const BOTTOM_MARGIN = 0.4;

/**
 * Clear sky kept above the top card, in world units, so a tower scrolled to its top
 * sits below the header and title block (the scene starts at the very top of the
 * screen) rather than behind them.
 */
const TOP_HEADROOM = 9;

/**
 * The Mix / Review switch's Review → Mix drop (docs/DECK_TOWER.md § "Mix / Review switch").
 * The camera scrolls so the landing (the Review tower's top) sits this far down the
 * screen, leaving sky above it for the drop to fall through…
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

/** A world swipe commits past this fraction of the stage's width (or on a flick)… */
const WORLD_SWIPE_FRACTION = 0.18;
/** …but never less than this many px. */
const WORLD_SWIPE_MIN_PX = 48;
/**
 * How much of the finger's travel the scene follows while a world swipe is held:
 * toward a neighbour, and toward an edge with none (a stiff rubber band).
 */
const DRAG_FOLLOW = 0.4;
const DRAG_FOLLOW_EDGE = 0.12;
/** The scene springing back after a released swipe that did not commit. */
const DRAG_SNAP_BACK = "translate 220ms ease-out";

/**
 * The tower's bird band: birds fly at the height of these cards on the tower (card k's
 * underside is (k − 1) · CARD_THICKNESS above the floor), along its four sides
 * (useBirdFlights). They take wing when the build-up puts the `from`-th card on the
 * tower, so a deck under 100 cards never has birds. On a deck that stops short of `to`,
 * the band's top is lowered to SKY_CEILING_ABOVE_TOP over the settled tower's top, so
 * the birds circle the tower rather than empty sky.
 */
const BIRD_BAND_CARDS = { from: 100, to: 150 };
/** How many birds may be in the air at once. One: a single bird crosses, then a pause, then the next. */
const BIRDS_AIRBORNE_MAX = 1;

/**
 * The tower's cloud band: cloud BASES sit at the height of these cards, and the clouds
 * drift slowly past the tower's four sides (useCloudDrifts). They fade in when the
 * build-up puts the `from`-th card on the tower, so a deck under 250 never has clouds;
 * a deck short of `to` lowers the band's top the same way as the birds'.
 */
const CLOUD_BAND_CARDS = { from: 250, to: 300 };
/** How many clouds may be in the sky at once (2–3 is the look; 3 slots, with gaps between drifts). */
const CLOUDS_IN_SKY_MAX = 3;

/**
 * The tower's wind band: gusts (streaks ending in a curl, IsoWind) sweep past the tower's
 * four sides with their baselines at the height of these cards (useWindGusts). They start
 * blowing when the build-up puts the `from`-th card on the tower, so a deck under 350
 * never has wind; a deck short of `to` lowers the band's top the same way as the birds'.
 * It sits in the empty sky between the clouds (250–300) and space (450+).
 */
const WIND_BAND_CARDS = { from: 350, to: 400 };
/** How many gusts may be playing at once. Two keeps the band breezy without clutter. */
const WIND_GUSTS_MAX = 2;

/**
 * The reading and writing worlds always have their birds, clouds and wind, however short
 * their tower (for now — their decks are usually far smaller than main's): their sky is
 * framed at least this many cards high (the wind band's top), the travellers' bands stay
 * at their card heights instead of shrinking to the tower, and they fly whatever the
 * card count. Main keeps the earn-them rule (a band appears once the tower reaches it).
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
 * On a tower that stops inside a sky band (birds, clouds), the band's top is lowered to
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
 * The scene's framing for a tower of `towerCount` cards under a sky framed `skyCards` high
 * (§ "Framing" in the component). Pure, so the Mix / Review switch can plan its camera move
 * and drop against the scene it is ABOUT to refit to (`onModeTap`).
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
    // The sky framed above the platform: the tower's own top, or higher in a skill world.
    const skyMetrics = cardStackMetrics(skyCards);
    const skyTop = BOB_HEIGHT + FLOOR_Z + skyMetrics.bodyHeight + skyMetrics.topThickness;
    const sky = prism(proj, LAYOUT.card, FLOOR_Z, skyTop).bounds;
    const centre = proj.project(LAYOUT.platform.x + LAYOUT.platform.w / 2, LAYOUT.platform.y + LAYOUT.platform.d / 2, 0);
    const centreX = centre.x;
    const halfWidth = Math.max(centreX - slab.minX, slab.maxX - centreX) + UNIT * 0.8;
    const minY = Math.min(slab.minY, sky.minY) - UNIT * TOP_HEADROOM;
    const maxY = Math.max(slab.maxY, shadow.maxY) + UNIT * BOTTOM_MARGIN;
    const width = 2 * halfWidth;
    const height = maxY - minY;
    // The birds', clouds' and wind's skies: each band in world z around the tower, and
    // the screen width every crossing must run across.
    const towerTopZ = skyTop - BOB_HEIGHT;
    const screenSpan = { minX: centreX - halfWidth, maxX: centreX + halfWidth };
    const birdSky: BirdSky = { band: skyBand(BIRD_BAND_CARDS, towerTopZ), around: LAYOUT.card, screenSpan };
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
    const fallDistance = Math.max(0, (maxY - Math.min(slab.minY, tower.minY)) / UNIT) + FALL_CLEARANCE;
    return {
        viewBox: `${centreX - halfWidth} ${minY} ${width} ${height}`,
        aspectRatio: `${width} / ${height}`,
        birdSky,
        cloudSky,
        windSky,
        spaceBand,
        fallDistance,
        // Where a transition's card splat bursts from (CardSplat): the scene's bottom
        // edge, across the tower's screen-x span.
        splatFloor: { y: maxY, minX: tower.minX, maxX: tower.maxX },
        // The raw frame, and the tower axis' viewBox y at world z — for the Mix / Review
        // switch's camera move and drop (`onModeTap`).
        minY,
        width,
        height,
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

    // Each world's Mix / Review switch (docs/DECK_TOWER.md § "Mix / Review switch"). Page
    // state, so a world keeps its mode across world swipes for the visit.
    const modes: Record<TowerWorldId, ReturnType<typeof useStudyModeSwitch>> = {
        core: useStudyModeSwitch(),
        reading: useStudyModeSwitch(),
        writing: useStudyModeSwitch(),
    };

    // A world's two decks, read through its own bar: Learn Now = that bar's OFF-COOLDOWN
    // cards (the flp's own readiness rule, so the tower never shows a card the flp would not
    // deal), in the bands of the world's settled mode — all four in Mix, Comfortable +
    // Mastered in Review (towerModes.ts). Mastered = that bar's whole Mastered total,
    // cooling or not. Undefined until loaded, so no tower builds from a placeholder 0.
    const learnNowCount = (worldId: TowerWorldId, mode: TowerModeId): number | undefined =>
        readyCounts[worldId].loaded ? bandTotal(readyCounts[worldId].counts, TOWER_MODES[mode].bands) : undefined;
    const deckCountsFor = (worldId: TowerWorldId): Record<TowerDeckId, number | undefined> => ({
        "learn-now": learnNowCount(worldId, modes[worldId].towerMode),
        // The 'mastered' kind reads only `mastered.counts`; the band counts argument is unused.
        mastered: mastered.loaded ? builtinCollectionCount({ kind: "mastered", world: worldId }, readyCounts[worldId].counts, mastered.counts) ?? 0 : undefined,
    });

    // ── Worlds ────────────────────────────────────────────────────────────────────
    // The skill worlds follow the account's goals — the same gate as the fdp's Centers.
    const worldShown = (id: TowerWorldId) =>
        id === "core" || (id === "reading" ? user?.readingGoal === true : user?.writingGoal === true);
    const shownWorlds = WORLD_ORDER.filter(worldShown);
    const pan = useWorldPan();
    // The world on screen. One whose goal is switched off while it is up falls back to main.
    const worldId: TowerWorldId = shownWorlds.includes(pan.world) ? pan.world : "core";
    const world = TOWER_WORLDS[worldId];
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
    const towerCounts: Record<TowerWorldId, number | undefined> = {
        core: deckCountsFor("core")[swaps.core.towerDeck],
        reading: deckCountsFor("reading")[swaps.reading.towerDeck],
        writing: deckCountsFor("writing")[swaps.writing.towerDeck],
    };
    // A tower may grow once its counts are in and its swap's platform is not empty.
    const mayGrow = (id: TowerWorldId) => towerCounts[id] !== undefined && swaps[id].towerOnStage;
    // Every world keeps its tower built, on screen or not, so arriving shows it standing.
    // The main one builds up on page load; a skill world's appears at full height (no
    // build-up) and only grows after a deck swap there (`animate` = mid-swap). Once main's
    // Mix / Review switch has been used, a count change there no longer grows the tower
    // from nothing either: the switch animated the change itself.
    const progress: Record<TowerWorldId, number> = {
        core: useBuildProgress(mayGrow("core"), towerCounts.core ?? 0, swaps.core.busy || !modes.core.everSwitched),
        reading: useBuildProgress(mayGrow("reading"), towerCounts.reading ?? 0, swaps.reading.busy),
        writing: useBuildProgress(mayGrow("writing"), towerCounts.writing ?? 0, swaps.writing.busy),
    };

    // The stack is drawn: the old tower as it stood at the tap while it falls, nothing while
    // the platform is empty mid-swap, then the build-up (from 0 cards until counts arrive).
    const stackDrawn = swap.outgoing !== null || swap.towerOnStage;
    const stackProgress = swap.outgoing?.frozenProgress ?? progress[worldId];
    const towerCount = towerCounts[worldId] ?? 0;
    // This world's Mix / Review switch. While one plays, the scene is fitted to the MIX
    // tower (the taller): a collapse starts from it, and a drop needs its sky to fall through.
    const modeSwitch = modes[worldId];
    const mixCount = learnNowCount(worldId, "mix") ?? 0;
    // Cards standing on the tower. A Review → Mix drop counts from its IMPACT (not the
    // switch's end, IMPACT_MS later), so a Mix total crossing STARTLE_AT_CARDS startles the
    // pawn as the tower lands.
    const cardsOnTower = !stackDrawn ? 0 : modeSwitch.dropLanded ? mixCount : Math.round(towerCount * stackProgress);
    const fitCount = modeSwitch.busy ? mixCount : towerCount;

    const proj = useMemo(() => makeProjector(UNIT), []);

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
    // A skill world's sky is framed as if its tower reached SKILL_WORLD_SKY_CARDS.
    const alwaysHasSky = worldId !== "core";
    const skyCardsFor = (count: number) => (alwaysHasSky ? Math.max(count, SKILL_WORLD_SKY_CARDS) : count);
    const skyCards = skyCardsFor(fitCount);
    const scene = useMemo(() => fitScene(proj, fitCount, skyCards), [proj, fitCount, skyCards]);

    // The sky travellers circle the tower on screen. None start while the camera dashes
    // between worlds (the ones already out finish their crossing).
    const skyLive = !pan.busy;
    const birds = useBirdFlights({
        proj,
        active: skyLive && (alwaysHasSky || cardsOnTower >= BIRD_BAND_CARDS.from),
        sky: scene.birdSky,
        maxAirborne: BIRDS_AIRBORNE_MAX,
    });
    const cloudDrifts = useCloudDrifts({
        proj,
        active: skyLive && (alwaysHasSky || cardsOnTower >= CLOUD_BAND_CARDS.from),
        sky: scene.cloudSky,
        maxInSky: CLOUDS_IN_SKY_MAX,
    });
    const gusts = useWindGusts({
        proj,
        active: skyLive && (alwaysHasSky || cardsOnTower >= WIND_BAND_CARDS.from),
        sky: scene.windSky,
        maxGusts: WIND_GUSTS_MAX,
    });
    // Clouds can overlap each other (birds can't visibly: they are all one flat ink).
    const clouds = useMemo(() => sortCloudsBackToFront(cloudDrifts), [cloudDrifts]);

    // ── Scroll height, shared by every world ─────────────────────────────────────
    // The camera pans SIDEWAYS, so it keeps its height: arriving in a world opens at the
    // altitude the learner last scrolled to (`climb`, px above the bottom — the svg's
    // height differs per world, so a scrollTop would not carry over). A shorter tower clips
    // it at its top, but `climb` keeps the altitude asked for, so panning on to a taller
    // world climbs back to it. A refit WITHIN a world (its counts arriving, a deck swap's
    // refit) opens at the BOTTOM — the platform. Keyed on the world and the viewBox, which
    // only change with those, so a silent token refresh or the build-up never yanks it.
    const scrollerRef = useRef<HTMLDivElement>(null);
    // The title block, which pans and follows a held swipe along with the scene.
    const titleBlockRef = useRef<HTMLDivElement>(null);
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
    // A Mix / Review switch's refit (to the Mix frame as a drop starts, to the Review frame
    // as a collapse ends) keeps the altitude instead, like an arrival: the camera stays on
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
        if (swap.busy || pan.busy || modeSwitch.busy || !countsLoaded(worldId)) return;
        keepClimbFor.current = null;
        const el = scrollerRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        swap.toggle({ fallDistance: scene.fallDistance, progress: progress[worldId], cards: cardsOnTower });
    };

    // ── The Mix / Review switch (the world's platform wall) ──────────────────────
    // Only on the Learn Now deck, with the tower settled and nothing else moving.
    const onLearnNow = swap.titleDeck === "learn-now" && swap.towerDeck === "learn-now";
    const modeSwitchBusy = modeSwitch.busy || swap.busy || pan.busy || !countsLoaded(worldId) || progress[worldId] < 1;

    // ── The focus lever (docs/FOCUS_MODE.md § 5) ─────────────────────────────────
    // One per world, like the counts and the swaps, so each world's lever keeps its own
    // state across world swipes. Only the world on screen's lever is drawn; every world's
    // popup is mounted (at most one is ever open).
    const leverArgs = (id: TowerWorldId) => ({
        world: id,
        ready: readyCounts[id],
        learnNowShown: swaps[id].titleDeck === "learn-now" && swaps[id].towerDeck === "learn-now",
        busy: swaps[id].busy || pan.busy || modes[id].busy,
    });
    const focusLevers: Record<TowerWorldId, FocusLever> = {
        core: useFocusLever(leverArgs("core")),
        reading: useFocusLever(leverArgs("reading")),
        writing: useFocusLever(leverArgs("writing")),
    };
    // Where a Review → Mix drop's camera move ends (scrollTop), set at the tap.
    const cameraTarget = useRef(0);
    const onModeTap = () => {
        if (!onLearnNow || modeSwitchBusy) return;
        const counts = readyCounts[worldId].counts;
        const mixCards = bandTotal(counts, TOWER_MODES.mix.bands);
        const mixOnlyCards = bandTotal(counts, MIX_ONLY_BANDS);
        const reviewCards = mixCards - mixOnlyCards;
        const to = otherTowerMode(modeSwitch.mode);
        // The frame the switch refits to keeps the altitude (see `keepClimbFor`).
        const toScene = fitScene(proj, to === "mix" ? mixCards : reviewCards, skyCardsFor(to === "mix" ? mixCards : reviewCards));
        keepClimbFor.current = toScene.viewBox !== scene.viewBox ? toScene.viewBox : null;
        const el = scrollerRef.current;
        if (to === "review" || !el) {
            modeSwitch.toggle({ mixCards, mixOnlyCards });
            return;
        }
        // Review → Mix, planned against the MIX frame it is about to refit to. The svg is
        // pinned to the scroller's bottom and as wide as it, so its scale is fixed and its
        // top sits `svgTop` px down the scroll content (0 once it overflows).
        const scale = el.clientWidth / toScene.width;
        const svgH = toScene.height * scale;
        const svgTop = Math.max(0, el.clientHeight - svgH);
        const maxScroll = Math.max(0, svgH - el.clientHeight);
        // The camera: the landing (the Review tower's top) LANDING_ON_SCREEN down the screen.
        const landingZ = FLOOR_Z + reviewCards * CARD_THICKNESS;
        const landingPx = svgTop + (toScene.axisYAtZ(landingZ) - toScene.minY) * scale;
        const target = Math.min(maxScroll, Math.max(0, landingPx - el.clientHeight * LANDING_ON_SCREEN));
        const from = Math.min(maxScroll, Math.max(0, maxScroll - climb.current)); // where the kept altitude puts it
        const travel = Math.abs(target - from);
        cameraTarget.current = target;
        // The drop starts with its underside just over the screen's top edge (at the camera's
        // end), so the whole tower falls in from out of sight.
        const screenTopY = toScene.minY + (target - svgTop) / scale;
        const screenTopZ = (toScene.axisYAtZ(FLOOR_Z) - screenTopY) / UNIT;
        modeSwitch.toggle({
            mixCards,
            mixOnlyCards,
            dropLift: Math.max(DROP_MIN_LIFT, screenTopZ + DROP_CLEARANCE - landingZ),
            cameraMs: travel < 2 ? 0 : Math.min(CAMERA_MAX_MS, CAMERA_BASE_MS + travel * CAMERA_MS_PER_PX),
        });
    };
    // The camera move itself: scrollTop eased to the landing, written straight to the DOM
    // (marked as the page's own, so `climb` ignores it) and recorded as the new altitude.
    const cameraKey = modeSwitch.camera?.key;
    const cameraMs = modeSwitch.camera?.durationMs ?? 0;
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
    const panBlocked = pan.busy || swap.busy || modeSwitch.busy;
    const goTo = (to: TowerWorldId | undefined, carry?: PanCarry) => {
        if (to && !panBlocked) pan.go(to, carry);
    };
    /** The world a swipe in `direction` heads for (LEFT brings the right-hand one in). */
    const swipeTarget = (direction: SwipeDirection) => (direction === "left" ? rightWorld : leftWorld);
    // A horizontal swipe on the scene: LEFT brings the right-hand world in (the camera
    // moves right), RIGHT the left-hand one. Axis-locked, so a vertical drag still climbs
    // the tower. While held, the scene follows the finger a little — stiffly toward an
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
        // The scene's svg and the title block move together, as one camera.
        paint: (scroller, dx, commit) => {
            const movers = [scroller.querySelector<SVGSVGElement>(":scope > svg"), titleBlockRef.current].filter(
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

    const faceFor = (deck: TowerDeckId): PlateFace => ({ text: TOWER_DECKS[deck].label, band: TOWER_DECKS[deck].band });
    const splat = swap.splat;

    return (
        <MobileTabScreen title="Deck" scrollable={false} surfaceColor={pan.palette.sky} className="deck-tower-page">
            {/* Two layers:
                  - the SCROLLER (the scene) covers the WHOLE screen down to the footer bar —
                    header included — so a tall tower climbs over the header and off the top
                    of the screen;
                  - the title block stays in normal flow under the header, raised above the
                    scroller, and ignores pointer events so a drag on it still scrolls.
                ⚠️ The stage is deliberately NOT positioned. The scroller's containing block
                is then MobileTabScreen's ScreenRoot (position: relative, the full screen),
                which (a) puts its top at the top of the screen rather than under the
                header, and (b) escapes the clipping of MobileTabScreen's ScrollArea, which
                is overflow-hidden but unpositioned. Making the stage `position: relative`
                would trap the scene under the header again. The trade-off: the scroller
                sits over the header, so the header's own controls (the minute-points
                flame) are not tappable on this page. */}
            {/* `overflowX: clip` hides the title block while the pan has it off screen, with
                no scroll container (the stage is not positioned, so the absolute scroller and
                backdrop, which reach up over the header, are not clipped by it). */}
            <Box className="deck-tower-page__stage" sx={{ flex: 1, minHeight: 0, overflowX: "clip" }}>
                <Box
                    ref={titleBlockRef}
                    className="deck-tower-page__title-block"
                    sx={{
                        position: "relative",
                        zIndex: 2,
                        px: "20px",
                        pt: "4px",
                        pointerEvents: "none",
                        // It rides the camera with the scene: the pan's slide on `transform`
                        // (the title block spans the stage, so % = stage widths, as on the
                        // svg), a held swipe's follow on `translate` (worldSwipe's paint).
                        transform: pan.sceneShiftX !== 0 ? `translateX(${(pan.sceneShiftX * 100).toFixed(2)}%)` : undefined,
                    }}
                >
                    {/* The world's title ("Flashcards", "Reading Flashcards", "Writing
                        Flashcards"); it changes mid-pan, while no scene (or title) is on screen. The
                        deck shown is named by the plate and the top card. The app's
                        header-title voice (PageHeader's hub spec), in white so it reads on
                        the sky and on space — but at the page's own display size, 40px,
                        rather than the header's 24px: it is the scene's headline. */}
                    <Typography
                        className="deck-tower-page__title"
                        sx={{ ...pageHeaderTitleTypeSx("hub"), fontSize: 40, color: ISO.white }}
                    >
                        {world.title}
                    </Typography>
                </Box>

                {/* The sky behind the scene, in the world's colour (blending mid-pan), which
                    darkens into space as a tall tower is climbed (SPACE_BAND_CARDS). Same
                    box and z-index as the scroller but earlier in the DOM, so the scroller
                    paints over it. */}
                <SpaceBackdrop scrollerRef={scrollerRef} band={scene.spaceBand} palette={pan.palette} bottom={FOOTER_TOTAL_HEIGHT} />

                {/* The one scroll surface (vertical only — the app's opt-in scrolling, see
                    docs/UX_AND_NAVIGATION.md). It ends at the footer bar. The scene's
                    `marginTop: auto` pins it to the bottom, so a short tower sits on the
                    footer with sky above it; a tall one overflows and scrolls. (NOT
                    `justify-content: flex-end` — that overflows past the TOP edge, where a
                    scroll container cannot reach, and the tower's top would be lost.)
                    It is also the world-swipe surface: `touch-action: pan-y` leaves the
                    vertical scroll native and hands horizontal drags to `worldSwipe`. */}
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
                        bottom: FOOTER_TOTAL_HEIGHT,
                        overflowX: "hidden",
                        overflowY: "auto",
                        overscrollBehavior: "contain",
                        touchAction: "pan-y",
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
                        .deck-tower-page__falling .iso-pawn__decal-anchor { opacity: 0; transition: opacity 120ms ease-out; }
                    `}</style>
                    <IsoScene
                        proj={proj}
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
                                          collapse: modeSwitch.collapse,
                                          drop: modeSwitch.drop,
                                          dropFigure: mixCount,
                                      }
                                    : null
                            }
                            // Not while the count is loading: it reads as 0 then (towerCount's `?? 0`).
                            showImprint={towerCounts[worldId] !== undefined}
                            stackFalling={swap.outgoing !== null}
                            dropPx={(swap.outgoing?.drop ?? 0) * UNIT}
                            pawns={swap.pawns}
                            cardsOnTower={cardsOnTower}
                            swapOutgoing={swap.outgoing !== null}
                            plate={{
                                face: faceFor(swap.titleDeck),
                                ariaLabel: `Show ${TOWER_DECKS[otherTowerDeck(swap.titleDeck)].title}`,
                                onTap: onPlateTap,
                                busy: swap.busy || pan.busy || modeSwitch.busy,
                            }}
                            modeSwitch={{
                                mode: modeSwitch.mode,
                                dimmed: swap.titleDeck !== "learn-now",
                                busy: modeSwitchBusy,
                                ariaLabel:
                                    swap.titleDeck !== "learn-now"
                                        ? "Mix or Review: only for the Learn Now deck"
                                        : `Showing ${modeSwitch.mode === "mix" ? "Mix" : "Review"} cards. Switch to ${modeSwitch.mode === "mix" ? "Review" : "Mix"}`,
                                onTap: onModeTap,
                            }}
                            lever={focusLevers[worldId].lever}
                            behind={
                                <>
                                    {/* Clouds on the tower's BACK sides, behind it. They drift ~150 cards
                                        above the birds, so the two never overlap and their order is free. */}
                                    {clouds.filter((c) => c.side === "behind").map((c) => (
                                        <IsoCloud key={`cloud-${c.id}`} drift={c} />
                                    ))}
                                    {/* Wind on the tower's BACK sides, behind it. It blows ~50 cards above
                                        the clouds and far above the birds, so its order among them is free. */}
                                    {gusts.filter((g) => g.side === "behind").map((g) => (
                                        <IsoWind key={`wind-${g.id}`} gust={g} />
                                    ))}
                                    {/* Birds on the tower's BACK sides go behind it, so it hides them as
                                        they pass. (They ride the platform's bob — 0.35 units, lost in their
                                        own bounce — because the draw order puts them inside it.) */}
                                    {birds.filter((b) => b.side === "behind").map((b) => (
                                        <IsoBird key={`bird-${b.id}`} flight={b} />
                                    ))}
                                </>
                            }
                            front={
                                <>
                                    {/* Birds on the tower's FRONT sides, over it. They fly far above the
                                        pawn, so its depth slot never matters to them. */}
                                    {birds.filter((b) => b.side === "front").map((b) => (
                                        <IsoBird key={`bird-${b.id}`} flight={b} />
                                    ))}
                                    {/* Wind on the tower's FRONT sides, over it. */}
                                    {gusts.filter((g) => g.side === "front").map((g) => (
                                        <IsoWind key={`wind-${g.id}`} gust={g} />
                                    ))}
                                    {/* Clouds on the tower's FRONT sides, over it. */}
                                    {clouds.filter((c) => c.side === "front").map((c) => (
                                        <IsoCloud key={`cloud-${c.id}`} drift={c} />
                                    ))}
                                </>
                            }
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
                </Box>

                {/* The dash between worlds: streaks racing past, over the (empty) sky. */}
                {pan.busy && pan.direction !== 0 && (
                    <SpeedLines direction={pan.direction} strength={pan.speed} bottom={FOOTER_TOTAL_HEIGHT} />
                )}

                {/* The way to the neighbouring worlds. Hidden while the camera dashes or a
                    deck swap runs (neither swipe nor arrow works then). */}
                {leftWorld && (
                    <WorldIndicator side="left" name={TOWER_WORLDS[leftWorld].name} onTap={() => goTo(leftWorld)} hidden={panBlocked} />
                )}
                {rightWorld && (
                    <WorldIndicator side="right" name={TOWER_WORLDS[rightWorld].name} onTap={() => goTo(rightWorld)} hidden={panBlocked} />
                )}
            </Box>
            {focusLevers.core.dialog}
            {focusLevers.reading.dialog}
            {focusLevers.writing.dialog}
        </MobileTabScreen>
    );
};

export default DeckTowerPage;
