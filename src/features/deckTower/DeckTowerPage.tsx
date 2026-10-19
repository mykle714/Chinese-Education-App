import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import MobileTabScreen from "../../components/MobileTabScreen";
import { FOOTER_TOTAL_HEIGHT } from "../../components/MobileFooter";
import {
    BOB_HEIGHT,
    CARD_THICKNESS,
    ISO,
    IsoBird,
    IsoCardStack,
    IsoCloud,
    IsoFloorLabel,
    IsoPawn,
    IsoPlatform,
    RIM_WIDTH,
    IsoScene,
    IsoWind,
    boundsOf,
    depthRankAmong,
    insetRect,
    cardStackMetrics,
    makeProjector,
    prefersReducedMotion,
    prism,
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
    type IsoSurface,
    type PawnRoam,
    type WorldRect,
} from "./iso";
import { useCategoryCounts } from "../../hooks/useCategoryCounts";
import { builtinCollectionCount } from "../flashcards/builtinCollections";
import { LEARN_NOW_HUE } from "../../utils/categoryColors";
import { RAMP } from "../../theme/colors";
import type { MasteryBarId } from "../../../server/contracts/wire";
import { pageHeaderTitleTypeSx } from "../../components/PageHeader";
import SpaceBackdrop, { type SpaceBand } from "./SpaceBackdrop";

/**
 * /deck-tower — the learner's Learn Now deck drawn as a stack of cards standing on an
 * isometric platform (docs/DECK_TOWER.md), built from the iso art framework in ./iso
 * (docs/ISO_ART_FRAMEWORK.md).
 *
 * Layer: page (feature module `src/features/deckTower`). Reads ONE figure — the core
 * Learn Now count — through the existing `useCategoryCounts` hook, derived with the same
 * `builtinCollectionCount` the fdp's Learn Now tile uses, so the tower and the tile can
 * never disagree. No new endpoint.
 *
 * This file only LAYS OUT the scene: where each object sits, which surface it stands on,
 * and the viewBox. Every object draws itself, shadow included.
 *
 * The footer's Deck tab (it took Discover's slot 2026-10-17), so it renders in a
 * non-scrolling MobileTabScreen and ends with a FooterSpacer: the scene shrinks to fit
 * above the footer bar rather than sliding under it. Still experimental.
 */

/** Screen px per world unit before the viewBox scales the scene to the frame. */
const UNIT = 20;

/** The platform slab. Its top surface is the floor, z = 0. It floats (IsoLevitate). */
const PLATFORM: WorldRect = { x: 0, y: 0, w: 11, d: 11, r: 0.9 };
const PLATFORM_THICKNESS = 1.5;

/** The sky's ground plane, below the platform — it receives the platform's shadow. */
const GROUND: IsoSurface = { z: -PLATFORM_THICKNESS - 1.6, color: ISO.sky };
/** The platform's floor — the tower and the pawn stand on it. */
const FLOOR: IsoSurface = { z: 0, color: ISO.platform.top };

/** The card footprint — portrait, long side along world y. Centred on the platform. */
const CARD_W = 4.8;
const CARD_D = 6.6;
const CARD: WorldRect = {
    x: PLATFORM.x + (PLATFORM.w - CARD_W) / 2,
    y: PLATFORM.y + (PLATFORM.d - CARD_D) / 2,
    w: CARD_W,
    d: CARD_D,
    r: 0.45,
};

/**
 * The deck's name plate, printed on the floor in front of the tower (the strip between
 * the stack's front-left face and the platform edge), as wide as the card. It names the
 * deck while a tall tower's top card is scrolled off screen. It is part of the floor —
 * zero height, no shadow — so pawns can walk over it; draw it before anything standing
 * on the floor. The pawn is also handed a SHADED copy (its `decals`), so its shadow
 * darkens the label rather than painting floor-coloured shade over it.
 */
const DECK_LABEL = "LEARN NOW";
/**
 * The band the deck's name is printed on (top card and floor plate): Learn Now's hue, so the
 * tower carries the same colour as the fdp's Learn Now card. Its `mid` tier, not the
 * `surface` the fdp card uses — the pale surface washes out on the cream card face.
 * Keyed on LEARN_NOW_HUE, so it follows if Learn Now's colour ever changes.
 */
const DECK_BAND = RAMP[LEARN_NOW_HUE].mid;
const LABEL_PLATE: WorldRect = { x: CARD.x, y: CARD.y + CARD_D + 0.5, w: CARD_W, d: 1.1, r: 0.25 };

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

/** Where the pawn starts, front-right of the tower. From there it wanders (PAWN_ROAM). */
const PAWN_AT = { x: 9.55, y: 7.5 };

/**
 * Where the pawn may wander: the floor inside the platform's rim (IsoPlatform's
 * RIM_WIDTH), around the tower. usePawnMotion keeps the pawn's SHADOW inside it as well
 * as its feet, so the shadow never spills onto the bevel or off the platform's edge. The floor label is NOT an obstacle — it is part
 * of the floor, so the pawn walks over it. The obstacles are listed in
 * BACK-TO-FRONT draw order — the pawn reports how many of them it stands in front of,
 * and the scene draws it after that many (so it walks BEHIND the tower, not over it).
 */
const PAWN_ROAM: PawnRoam = { area: insetRect(PLATFORM, RIM_WIDTH), obstacles: [CARD] };

/**
 * The deck size, in cards ON the tower, at which the pawn is startled by how tall it has
 * grown: it leans back to look up, leaps away, a "!" pops over its head, it stares for a
 * few seconds and then goes back to wandering (IsoPawn `startled`).
 * Crossed during the build-up, so a bigger deck startles it partway up.
 */
const STARTLE_AT_CARDS = 50;

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
    return { zMin: FLOOR.z + (cards.from - 1) * CARD_THICKNESS, zMax: FLOOR.z + top };
}

/**
 * How fast the tower builds up, in cards per second. A CONSTANT cruising pace: the
 * build-up takes as long as the deck needs, rather than squeezing every deck into one
 * fixed duration — which made a big deck shoot up visibly faster than a small one.
 * Raised from 30 on 2026-10-17.
 */
const BUILD_CARDS_PER_SECOND = 40;

/**
 * The last this-many cards DECELERATE to a stop instead of arriving at full speed. The
 * whole deck decelerates when it is smaller than this. Raised from 40 on 2026-10-18 so
 * the slowdown reads as a deliberate braking rather than a brief stutter at the top.
 */
const BUILD_DECEL_CARDS = 60;

/**
 * The power of the settle phase's ease-out, 1 − (1 − u)^p. A higher power brakes
 * harder early and then crawls longer over the last few cards — the "lingering" feel.
 * Raised from 2 (quadratic) to 3 (cubic) on 2026-10-18.
 */
const BUILD_DECEL_POWER = 3;

/**
 * The build-up's timeline: cards on the tower `elapsedS` seconds in, for a deck of
 * `count`. Pure, so the hook below only has to drive the clock.
 *
 *   CRUISE  the first (count − K) cards at a steady BUILD_CARDS_PER_SECOND;
 *   SETTLE  the last K = min(count, BUILD_DECEL_CARDS) on a power-p ease-out
 *           (p = BUILD_DECEL_POWER).
 *
 * The settle phase is timed to START at the cruising speed: an ease-out
 * 1 − (1 − u)^p covering K cards in T seconds leaves at pK/T cards/s, so T = pK / speed.
 * The speed is therefore continuous where the phases meet — no lurch as the brakes come
 * on — and falls smoothly to zero on the last card. (For K = 60, p = 3 the settle takes
 * 4.5 s.)
 */
function buildTimeline(count: number): { durationS: number; cardsAt: (elapsedS: number) => number } {
    const v = BUILD_CARDS_PER_SECOND;
    const p = BUILD_DECEL_POWER;
    const settleCards = Math.min(count, BUILD_DECEL_CARDS);
    const cruiseCards = count - settleCards;
    const cruiseS = cruiseCards / v;
    const settleS = (p * settleCards) / v;
    return {
        durationS: cruiseS + settleS,
        cardsAt: (t) => {
            if (t <= cruiseS) return v * t;
            const u = Math.min(1, (t - cruiseS) / settleS);
            return cruiseCards + settleCards * (1 - (1 - u) ** p);
        },
    };
}

/**
 * Animates the build-up 0 → 1 (the fraction of the deck on the tower) along
 * `buildTimeline` once `ready` turns true. Snaps straight to 1 under
 * prefers-reduced-motion.
 */
function useBuildProgress(ready: boolean, count: number): number {
    const [progress, setProgress] = useState(0);
    useEffect(() => {
        if (!ready) return;
        if (prefersReducedMotion() || count <= 0) {
            setProgress(1);
            return;
        }
        const { durationS, cardsAt } = buildTimeline(count);
        let frame = 0;
        const start = performance.now();
        const tick = (now: number) => {
            const elapsedS = (now - start) / 1000;
            setProgress(Math.min(1, cardsAt(elapsedS) / count));
            if (elapsedS < durationS) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [ready, count]);
    return progress;
}

const DeckTowerPage: React.FC = () => {
    const { counts, ok } = useCategoryCounts("core");

    // Learn Now = every sorted card not yet Mastered on the core bar. Mastered counts are
    // not consulted for the 'learn-now' ref, so an empty record is passed for them.
    const learnNowCount = ok
        ? builtinCollectionCount({ kind: "learn-now", bar: "core" }, counts, {} as Record<MasteryBarId, number>) ?? 0
        : undefined;

    const progress = useBuildProgress(learnNowCount !== undefined, learnNowCount ?? 0);
    const [pawnDepthRank, setPawnDepthRank] = useState(() => depthRankAmong(PAWN_AT, PAWN_ROAM.obstacles));
    const proj = useMemo(() => makeProjector(UNIT), []);

    // ── Framing: a FIXED scale, and scrolling instead of zooming ─────────────────
    // The viewBox's WIDTH is the platform's (centred on the platform's own centre and
    // ignoring the shadow, which slides off down-right with the light), and the svg is
    // always the stage's full width — so the scale is fixed by the platform and never
    // changes with the deck size. Cards keep a fixed thickness too, so a big deck makes
    // a tower far taller than the screen; rather than zoom out to fit it, the viewBox
    // grows UPWARD to the settled tower's top (+ TOP_HEADROOM), the svg's height follows
    // (aspect-ratio = the viewBox's), and the stage scrolls.
    //
    // The bottom edge is the platform's SHADOW's lowest point plus BOTTOM_MARGIN: the
    // scroller clips at the footer bar, so anything below the svg would be cut off. The
    // svg is fitted to the SETTLED tower, so nothing reflows during the build-up.
    const scene = useMemo(() => {
        const metrics = cardStackMetrics(learnNowCount ?? 0);
        const slab = prism(proj, PLATFORM, -PLATFORM_THICKNESS, BOB_HEIGHT).bounds;
        const towerTop = BOB_HEIGHT + FLOOR.z + metrics.bodyHeight + metrics.topThickness;
        const tower = prism(proj, CARD, FLOOR.z, towerTop).bounds;
        const centreX = proj.project(PLATFORM.x + PLATFORM.w / 2, PLATFORM.y + PLATFORM.d / 2, 0).x;
        const halfWidth = Math.max(centreX - slab.minX, slab.maxX - centreX) + UNIT * 0.8;
        const minY = Math.min(slab.minY, tower.minY) - UNIT * TOP_HEADROOM;
        const shadow = boundsOf(
            projectOutline(proj, roundedRectWorld(shadowFootprint(PLATFORM, -PLATFORM_THICKNESS, GROUND)), GROUND.z)
        );
        const maxY = Math.max(slab.maxY, shadow.maxY) + UNIT * BOTTOM_MARGIN;
        const width = 2 * halfWidth;
        const height = maxY - minY;
        // The birds' and clouds' skies: each band in world z, and the screen width every
        // crossing must run across.
        const towerTopZ = towerTop - BOB_HEIGHT;
        const screenSpan = { minX: centreX - halfWidth, maxX: centreX + halfWidth };
        const birdSky: BirdSky = { band: skyBand(BIRD_BAND_CARDS, towerTopZ), around: CARD, screenSpan };
        const cloudSky: CloudSky = { band: skyBand(CLOUD_BAND_CARDS, towerTopZ), around: CARD, screenSpan };
        const windSky: WindSky = { band: skyBand(WIND_BAND_CARDS, towerTopZ), around: CARD, screenSpan };
        // The sky → space band, as viewBox y's on the tower's axis (card k's underside is
        // (k − 1) · CARD_THICKNESS up). The platform's bob is ignored — 0.35 units over a
        // ~76-unit blend.
        const axisY = (card: number) =>
            proj.project(CARD.x + CARD.w / 2, CARD.y + CARD.d / 2, FLOOR.z + (card - 1) * CARD_THICKNESS).y;
        const spaceBand: SpaceBand = {
            viewBoxMinY: minY,
            viewBoxWidth: width,
            yFrom: axisY(SPACE_BAND_CARDS.from),
            yTo: axisY(SPACE_BAND_CARDS.to),
        };
        return { viewBox: `${centreX - halfWidth} ${minY} ${width} ${height}`, aspectRatio: `${width} / ${height}`, birdSky, cloudSky, windSky, spaceBand };
    }, [proj, learnNowCount]);

    const cardsOnTower = Math.round((learnNowCount ?? 0) * progress);
    const birds = useBirdFlights({
        proj,
        active: cardsOnTower >= BIRD_BAND_CARDS.from,
        sky: scene.birdSky,
        maxAirborne: BIRDS_AIRBORNE_MAX,
    });
    const cloudDrifts = useCloudDrifts({
        proj,
        active: cardsOnTower >= CLOUD_BAND_CARDS.from,
        sky: scene.cloudSky,
        maxInSky: CLOUDS_IN_SKY_MAX,
    });
    const gusts = useWindGusts({
        proj,
        active: cardsOnTower >= WIND_BAND_CARDS.from,
        sky: scene.windSky,
        maxGusts: WIND_GUSTS_MAX,
    });
    // Clouds can overlap each other (birds can't visibly: they are all one flat ink).
    const clouds = useMemo(() => sortCloudsBackToFront(cloudDrifts), [cloudDrifts]);

    // Open at the BOTTOM — the platform — whenever the scene's height changes (the count
    // arriving). Keyed on the viewBox, which only changes with the count, so a silent
    // token refresh or the build-up animation never yanks the scroll position.
    const scrollerRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const el = scrollerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [scene.viewBox]);

    return (
        <MobileTabScreen title="Deck" scrollable={false} surfaceColor={ISO.sky} className="deck-tower-page">
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
            <Box className="deck-tower-page__stage" sx={{ flex: 1, minHeight: 0 }}>
                <Box
                    className="deck-tower-page__title-block"
                    sx={{ position: "relative", zIndex: 2, px: "20px", pt: "4px", pointerEvents: "none" }}
                >
                    {/* The app's header-title voice (PageHeader's hub spec), in white so it
                        reads on the sky and on space — but at the page's own display size,
                        40px, rather than the header's 24px: it is the scene's headline. */}
                    <Typography
                        className="deck-tower-page__title"
                        sx={{ ...pageHeaderTitleTypeSx("hub"), fontSize: 40, color: ISO.white }}
                    >
                        Learn Now
                    </Typography>
                </Box>

                {/* The sky behind the scene, which darkens into space as a tall tower is
                    climbed (SPACE_BAND_CARDS). Same box and z-index as the scroller but
                    earlier in the DOM, so the scroller paints over it. */}
                <SpaceBackdrop scrollerRef={scrollerRef} band={scene.spaceBand} bottom={FOOTER_TOTAL_HEIGHT} />

                {/* The one scroll surface (vertical only — the app's opt-in scrolling, see
                    docs/UX_AND_NAVIGATION.md). It ends at the footer bar. The scene's
                    `marginTop: auto` pins it to the bottom, so a short tower sits on the
                    footer with sky above it; a tall one overflows and scrolls. (NOT
                    `justify-content: flex-end` — that overflows past the TOP edge, where a
                    scroll container cannot reach, and the tower's top would be lost.) */}
                <Box
                    ref={scrollerRef}
                    className="deck-tower-page__scroller"
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
                    <IsoScene
                        proj={proj}
                        viewBox={scene.viewBox}
                        className="deck-tower-page__scene"
                        style={{ width: "100%", aspectRatio: scene.aspectRatio, flexShrink: 0, marginTop: "auto", display: "block", overflow: "visible" }}
                    >
                        <IsoPlatform rect={PLATFORM} thickness={PLATFORM_THICKNESS} ground={GROUND} floating>
                            {/* The floor label first, outside the depth sort: it is part of the
                                floor, so the stack and the pawn (walking over it) always cover it. */}
                            <IsoFloorLabel rect={LABEL_PLATE} surface={FLOOR} text={DECK_LABEL} bandColor={DECK_BAND} />
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
                            {/* Back to front: the stack, with the wandering pawn slotted in after
                                however many obstacles it stands in front of. Keyed, so moving the
                                pawn reorders it without remounting (its motion state lives on). */}
                            {(() => {
                                const pawn = (
                                    <IsoPawn
                                        key="pawn"
                                        at={PAWN_AT}
                                        surface={FLOOR}
                                        roam={PAWN_ROAM}
                                        startledBy={CARD}
                                        onDepthRankChange={setPawnDepthRank}
                                        startled={cardsOnTower >= STARTLE_AT_CARDS}
                                        decals={<IsoFloorLabel rect={LABEL_PLATE} surface={FLOOR} text={DECK_LABEL} bandColor={DECK_BAND} shaded />}
                                    />
                                );
                                const layers = [
                                    <IsoCardStack key="stack" rect={CARD} count={learnNowCount ?? 0} surface={FLOOR} progress={progress} label={DECK_LABEL} bandColor={DECK_BAND} />,
                                ];
                                layers.splice(pawnDepthRank, 0, pawn);
                                return layers;
                            })()}
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
                        </IsoPlatform>
                    </IsoScene>
                </Box>
            </Box>
        </MobileTabScreen>
    );
};

export default DeckTowerPage;
