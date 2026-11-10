import React, { useMemo, useRef, useState } from "react";
import type { SnowComponent } from "./towerSnow";
import {
    CARD_THICKNESS,
    IsoCardImprint,
    IsoCardRuns,
    IsoCardStack,
    IsoFloorLabel,
    IsoFloorPrint,
    IsoFog,
    IsoRain,
    IsoSnow,
    IsoFloorSnow,
    IsoSnowSkirt,
    FLOOR_SNOW_DEPTH,
    SNOW_CAP_DEPTH,
    useSnowTrailRecorder,
    type SnowWalker,
    IsoBurnMark,
    IsoLightningBolt,
    IsoLever,
    IsoPaperStack,
    IsoPawn,
    IsoPlatform,
    IsoSmokePuff,
    IsoSortPlatform,
    RAISED_HEIGHT,
    SORT_PLATFORM_JUMP,
    sortPlatformTopZ,
    SLAB_THICKNESS,
    backToFront,
    depthRankAmong,
    flatPath,
    frontContour,
    insetRect,
    leverFootprint,
    IsoShadow,
    shadowTone,
    paperStackHeight,
    prism,
    shadowLandTiming,
    toOpenPath,
    type IsoRainFall,
    type IsoSnowFall,
    type SnowCover,
    type SnowTrail,
    type IsoSurface,
    type FogCloud,
    type PawnEntranceFrame,
    type PawnStep,
    type WorldRect,
} from "./iso";
import { useIsoPalette, useIsoProjector, useIsoWash } from "./iso/sceneContext";
import { PLATFORM_THICKNESS, TOWER_LAYOUT as layout } from "./towerPlatforms";
import type { PlateWallSteps } from "./towerDecks";
import type { TowerWorld } from "./towerWorlds";
import type { ScreenPoint } from "../../utils/pageTransition";
import type { PlatformLightning } from "./towerLightning";
import type { SwapPawn } from "./useDeckSwap";
import { usePlatePress } from "./usePlatePress";
import { IMPACT_MS, type TowerDrop } from "./towerResizes";
import { CATEGORY_COLORS } from "../../utils/categoryColors";
import { COLORS } from "../../theme/colors";
import type { TowerCollapse } from "./useTowerResize";
import { useSoftIntro } from "../../softIntro/useSoftIntro";

/**
 * DeckTowerPlatform — the Deck Tower's floating platform with everything on it: its
 * tower, its pawn(s) and its floor plate, in one world's colours (docs/DECK_TOWER.md
 * § "Worlds").
 *
 * Layer: page view (feature module `src/features/deckTower`). DeckTowerPage renders one,
 * for the world on screen (towerWorlds.ts), and drives it from that world's own swap
 * (useDeckSwap.ts). The page keys it by world, so arriving in another world mounts a
 * fresh platform (and pawn). It owns only its pawns' depth slots; every number it draws
 * is handed in.
 *
 * The home screen renders the same component (home/HomeScene.tsx, docs/HOME_SCREEN.md
 * § "The platform") with no deck, no plate and no lever — the pawn alone.
 *
 * Draw order inside the platform (IsoPlatform):
 *   decals    the cards' imprint under the stack ("0 cards", IsoCardImprint — drawn
 *             whenever the count has loaded, so whatever clears the floor finds it
 *             already there; `showImprint`), lightning's burn marks, the corner
 *             fixture's si floor print (IsoFloorPrint, `fixturePrint` — intro state only), then
 *             the floor plate (part of the floor, slightly raised as a push button —
 *             usePlatePress.ts — so it swings with the trap door; pawns step up onto it,
 *             IsoPawn `steps`, and sink with it when it is pressed);
 *   children  `behind` (sky travellers on the tower's back sides) → the stack, the
 *             focus lever and a corner fixture — the notebook's paper stack (writing
 *             world) or the mini sort platform (main world)
 *             (obstacles 0–2, in the CAMERA's back-to-front order —
 *             `backToFront`: the listed order under the fixed view, the tower last once
 *             the study camera is over it), and the pawns, each pawn
 *             slotted in front of every obstacle before the first one it stands behind
 *             (`depthRankAmong`, against that same order)
 *             → `front`.
 *
 * The stack's layer is one of (docs/DECK_TOWER.md § "Tower resizes" — towerResizes.ts is
 * the library; each of its animations has a branch here):
 *   - the settled tower (IsoCardStack);
 *   - a GHOST COLLAPSE shrink (IsoCardRuns), cards ghosting out and the rest settling;
 *   - the standing tower with a SKY DROP grow on top: a tower of the new cards
 *     falling onto it (CSS free fall), with the landing's smoke ring around the join
 *     (IsoSmokePuff, its back half under the drop and its front half over it) and the
 *     whole loaded platform sinking under the blow (`PLATFORM_SINK_CSS`).
 *
 * Settled snow (`snow`, docs/TOWER_SNOW.md): each object draws its own (the top card, the
 * lever's ball, the corner fixture's top); the floor's sheet and the pawn's trail are a
 * floor decal over the imprint, the burns, the si print AND the plate (buried; pressing it
 * brushes a hole over it — `plateDrift` — and until then the trail ploughs through its drift
 * too, the pawn sinking in it as on the floor), sliding off the trap door as it swings
 * (`floorSlide`). While it lies (`snowLying`) the tower and corner fixtures are banked in
 * at their base (IsoSnowSkirt), the pawns wade sunk in with no shadow (IsoPawn `snowDepth`), and shadows
 * fall on the snow's top (`shadowReceiverFor`, `shadowGround`).
 */

/** World units the platform sinks when a dropped tower lands on it. */
const IMPACT_SINK = 0.55;
/** The landing's blow: down fast, back up past rest, a small settle. Fits inside IMPACT_MS. */
const PLATFORM_SINK_CSS = `
.deck-tower-page__kept-deck .iso-card-stack__shadow { opacity: var(--platform-fade); }
@keyframes deck-tower-platform-sink {
    0% { transform: translateY(0); }
    16% { transform: translateY(var(--sink)); }
    46% { transform: translateY(calc(-0.28 * var(--sink))); }
    72% { transform: translateY(calc(0.08 * var(--sink))); }
    100% { transform: translateY(0); }
}
/* y = x²: free fall from rest (the same curve IsoCardRuns' runs fall on). */
@keyframes deck-tower-drop-fall { from { transform: translateY(calc(-1 * var(--lift))); } to { transform: translateY(0); } }
@keyframes deck-tower-drop-shadow-in { from { opacity: 0; } to { opacity: 1; } }
`;
const FREE_FALL = "cubic-bezier(0.333, 0, 0.667, 0.333)";

/** A drop onto the bare floor: its shadow fades in from the impact (cardCollapse.ts → `shadowLandTiming`). */
function dropShadowStyle(drop: TowerDrop): React.CSSProperties {
    const t = shadowLandTiming(drop.fallMs);
    return { animation: `deck-tower-drop-shadow-in ${t.durationMs.toFixed(0)}ms ease-out ${t.delayMs.toFixed(0)}ms both` };
}

/**
 * The deck size, in cards ON the tower, at which a pawn is startled by how tall its
 * tower has grown: it leans back to look up, leaps away, a "!" pops over its head, it
 * stares for a few seconds and then goes back to wandering (IsoPawn `startled`).
 * Crossed during the build-up, so a bigger deck startles it partway up. Only a GROW
 * past it counts (a swap's build-up, a resize's sky drop): a tower that loads in already
 * past it is the pawn's baseline (`towerCountKnown`).
 */
const STARTLE_AT_CARDS = 50;

/**
 * The corner fixtures' soft-introduction floor prints (IsoFloorPrint; docs/DECK_TOWER.md
 * § "Corner fixture labels", docs/SOFT_INTRODUCTION.md § 2): what each print says, and the
 * type both share. White (washed for the time of day). Two lines at 0.7 units, turned to
 * read along world −y (`run="-y"` — up-right on screen, toward the fixture) and set flush
 * to their end, which is anchored a gap off the fixture's front-left face (`anchor="end"`).
 * Row 2 ends with an arrow that, reading in the run's direction, points straight at the
 * fixture. The two prints set it differently: the sort print's arrow is part of row 2
 * ("CARDS →" ends flush with "ADD MORE"); the notebook's hangs past row 2's end, outside
 * the edge (IsoFloorPrint `tail`), so its last letters line up (WRITING's G, NOTEBOOK's K). towerPlatforms.ts → `labelUnder` places the
 * block from the same line count, size and pitch (`FIXTURE_LABEL_LINES`,
 * `FIXTURE_PRINT_FONT_SIZE`); keep them in step.
 */
const FIXTURE_PRINT = {
    // The arrow is part of row 2 here, so "CARDS →" ends flush with "ADD MORE".
    sortBin: { lines: ["ADD MORE", "CARDS →"], tail: undefined },
    // Hung past row 2 (IsoFloorPrint `tail`), so NOTEBOOK's K lines up with WRITING's G.
    notebook: { lines: ["WRITING", "NOTEBOOK"], tail: "→" },
    fontSize: 0.7,
    letterSpacing: 0.04,
} as const;


export interface PlateFace {
    text: string;
    band: string;
    /** Deeper wall shading for a band whose default walls read too faint (towerDecks.ts → `plateWallSteps`). */
    wallSteps?: PlateWallSteps;
}

interface DeckTowerPlatformProps {
    /** The world it stands in: its platform, floor and ground colours. */
    world: TowerWorld;
    /** IsoPlatform `hingeAngle` (the trap door). 0 = shut. */
    hingeAngle: number;
    /**
     * The tower, or null while this platform has none. `collapse` replaces it with a
     * ghost-collapse shrink; `drop` stands a sky-drop grow on top of it, whose top card
     * names `dropFigure` (the total it makes).
     */
    stack: {
        count: number;
        progress: number;
        /** The top card's head band: the standing deck's plate label and colour (towerDecks.ts). */
        label: string;
        bandColor: string;
        collapse?: TowerCollapse | null;
        drop?: TowerDrop | null;
        dropFigure?: number;
        /**
         * Tapping the tower starts studying it (DeckTowerPage `onStackTap` → the world's
         * flp). Undefined while it may not be tapped — not Learning, or a swap / pan /
         * resize is running: no pointer cursor, not focusable.
         */
        onTap?: () => void;
        /** The top card's print opacity (IsoCard `printOpacity`) — 0 while the study camera is down on the card (TowerCoverCard has the print then). */
        printOpacity?: number;
    } | null;
    /** Freeze the platform's bob (IsoPlatform `bobPaused`) — while the study camera is away from the fixed view. */
    bobPaused?: boolean;
    /**
     * The whole platform's and everything on it's opacity, fading on the study camera's
     * dive and climb (useTowerStudy `platformOpacity`; docs/DECK_TOWER.md § "Studying the
     * tower" → "The platform fades"). Default 1.
     */
    fadeOpacity?: number;
    /**
     * Keep the deck — the tower of cards — out of the fade: it stays at full opacity in its
     * own slot of the draw order while every other layer fades on its own (IsoPlatform
     * `fadeChildren={false}`), only its floor shadow fading with the floor. The study dive
     * still lands on the count card, which still slides off and back on over the session's
     * own fades (DeckTowerPage).
     */
    keepDeck?: boolean;
    /**
     * Draw the cards' imprint (IsoCardImprint) under the stack. False while the deck's count
     * is still loading: it reads as 0 then, and "0 cards" would be a lie.
     */
    showImprint: boolean;
    /** The stack is falling with the trap door. */
    stackFalling: boolean;
    /** How far the falling things have dropped, in viewBox px (world −z is screen +y). */
    dropPx: number;
    /** Every pawn to draw. */
    pawns: SwapPawn[];
    /** Cards standing on this tower right now: the startle threshold reads it. */
    cardsOnTower: number;
    /**
     * `cardsOnTower` is a real figure, not the `0` it reads while the deck count loads. Until
     * then the pawn's startle is held unknown (IsoPawn `startled={null}`), so a tower that
     * loads in already past STARTLE_AT_CARDS does not count as having grown past it.
     */
    towerCountKnown: boolean;
    /**
     * The cards a pawn up on the tower stands on: `cardsOnTower`, or a shrink's lower figure
     * from its start, so it falls through the cards leaving rather than hovering over them.
     */
    summitCards: number;
    /** A study has the tower: a pawn on its top stands still, to be carried off on the count card. */
    summitHeld: boolean;
    /** Kept at where the pawn stands on the tower's top (null when it is not there). */
    summitSpot: React.MutableRefObject<{ x: number; y: number } | null>;
    /** A swap's old towers are still on screen: an INCOMING pawn is not startled by them. */
    swapOutgoing: boolean;
    /**
     * The deck plate on the floor. Undefined: none — the home screen's platform
     * (home/HomeScene.tsx) carries no deck, so it has no plate to name one.
     */
    plate?: {
        /** The deck it names. Switching decks swaps it in one frame — a hard cut, no animation. */
        face: PlateFace;
        ariaLabel: string;
        /** Fired when the pressed plate is RELEASED (usePlatePress). */
        onTap: () => void;
        /** Fired as a press goes down (the page brushes the snow off the plate). */
        onPress?: () => void;
        /** Taps are ignored (a swap is running): no pointer cursor, and it will not press. */
        busy: boolean;
    };
    /**
     * The focus lever in the floor's left corner (IsoLever, docs/FOCUS_MODE.md § 5): its
     * animated numbers (useLeverMotion) and its tap. Fully sunk with its hatch shut, it
     * draws nothing — the floor is flush — and takes no taps. Undefined: no lever at all
     * (the home screen's platform); its obstacle slot is still held, like the stack's.
     */
    lever?: {
        pull: number;
        sink: number;
        hatch: number;
        /** A sky-fall entrance (useLeverMotion `skyFall`): "waiting" draws nothing yet. */
        skyFall: PawnEntranceFrame | "waiting" | null;
        ariaLabel: string;
        onTap: () => void;
        /** Taps are ignored (a popup is up, a swap is running, or it is sinking). */
        busy: boolean;
    };
    /**
     * The Writing Notebook's paper stack in the floor's right corner (writing world, while
     * the Learning tower is drawn; docs/DECK_TOWER.md § "The notebook stack"). It moves
     * with the tower: it falls with it on the trap door (`stackFalling`) and builds up with
     * it (`progress`, the tower's own). Tapping it opens the notebook. Undefined: none, and
     * the pawn roams the platform without it.
     */
    notebook?: {
        sheets: number;
        /** The tower's build-up (its `stack.progress`, frozen while it falls). */
        progress: number;
        ariaLabel: string;
        /** `at` is the stack's centre on screen (viewport px): the circle transition grows from it. */
        onTap: (at: ScreenPoint) => void;
        /** Taps are ignored (a swap, pan, resize or study is running). */
        busy: boolean;
    };
    /**
     * The mini sort platform in the floor's right corner (main world, while the Learning
     * tower is drawn; docs/DECK_TOWER.md § "The sort platform") — acp's four bins in
     * miniature (one slab lying flat on the floor, a band colour per quadrant), and its button. It moves with the tower like the notebook stack does.
     * `hopping`: it jumps every 2 s, the "cards low — go sort" call. Never passed together
     * with `notebook` (they take the same corner, on different worlds).
     */
    sortBin?: {
        /** The tower's build-up (its `stack.progress`, frozen while it falls). */
        progress: number;
        hopping: boolean;
        ariaLabel: string;
        /** `at` is the platform's centre on screen (viewport px): the circle transition grows from it. */
        onTap: (at: ScreenPoint) => void;
        /** Taps are ignored (a swap, pan, resize or study is running). */
        busy: boolean;
    };
    /** Drawn before the tower (sky travellers on its back sides). */
    behind?: React.ReactNode;
    /**
     * The drifting clouds' shadows on one surface (SkyTraffic.tsx → `SkyTrafficCloudShadows`).
     * Called twice: for the floor (clipped to the platform's top, drawn as the last floor
     * decal, so it shades the print and the plate but sits under everything standing on
     * the floor) and for the ground (unclipped, under the platform's own shadow and slab).
     * Undefined: no cloud shadows.
     */
    cloudShadows?: (on: { receiver: IsoSurface; clip?: WorldRect }) => React.ReactNode;
    /** Drawn after everything (sky travellers on its front sides). */
    front?: React.ReactNode;
    /**
     * Fog rolling through (IsoFog): its opacity per height level — the weather's `WeatherEffect.fog`
     * (towerWeather.ts) — and the field the page planned across the screen
     * (iso/fogClouds.ts → `planFogClouds`). Undefined: none.
     */
    fog?: { opacity: number; clouds: FogCloud[] };
    /**
     * Rain falling in front of the tower and splashing on the floor and the tower's top
     * (IsoRain) — the weather's rain in iso space; the sky's own rain is WeatherLayer's,
     * behind the scene. Undefined: none (no rain, or a study session is up).
     */
    rain?: IsoRainFall;
    /** The highest viewBox y that rain starts from (IsoRain `ceilingY`). */
    rainCeilingY?: number;
    /**
     * This world's lightning strikes (towerLightning.ts): the burn marks on its floor, the
     * bolt coming down now, and which pawns are crispy / being shocked. The page keeps it,
     * so it survives this component remounting on a pan.
     */
    lightning?: PlatformLightning;
    /**
     * Snow falling in front of everything on the floor and settling there (IsoSnow) — the
     * weather's snow in iso space; the sky's own snow is WeatherLayer's. Undefined: none.
     */
    snowFall?: IsoSnowFall;
    /**
     * Snow lying on this platform (useTowerSnow, docs/TOWER_SNOW.md). Each cover is present
     * only while that component is snowy (or brushing off). Undefined: none (the home screen).
     */
    snow?: {
        covers: Partial<Record<SnowComponent, SnowCover>>;
        /** The `towerSnowCover` si has graduated: snow covers the "0 cards" imprint too. The fixtures' si prints, the plate and the top card are always fully covered. */
        coverText: boolean;
        /** The floor's footprints (the page keeps the store, so they outlast a pan). */
        trail: SnowTrail;
        /** The tower's top's footprints, through its cap. */
        towerTrail: SnowTrail;
        /** A deck swap is running: the floor's snow slides off the opening trap door, and stays gone until it ends. */
        swapping: boolean;
    };
}

/** The snow drift over the plate, and its hole once pressed (IsoFloorSnow `drift`): the plate and a small margin round it. */
const PLATE_DRIFT_RECT = insetRect(layout.labelPlate, -0.12);

/** The door angle by which the floor's snow has slid wholly off (the trap door opens to 86°). */
const SNOW_SLID_OFF_ANGLE = (75 * Math.PI) / 180;

const noop = () => {};

const DeckTowerPlatform: React.FC<DeckTowerPlatformProps> = ({
    world,
    hingeAngle,
    stack,
    showImprint,
    stackFalling,
    dropPx,
    pawns,
    cardsOnTower,
    towerCountKnown,
    summitCards,
    summitHeld,
    summitSpot,
    swapOutgoing,
    plate,
    lever,
    notebook,
    sortBin,
    behind,
    cloudShadows,
    front,
    fog,
    rain,
    rainCeilingY,
    lightning,
    snowFall,
    snow,
    bobPaused = false,
    fadeOpacity = 1,
    keepDeck = false,
}) => {
    const proj = useIsoProjector();
    // The world arrives already lit for the time of day (timeOfDay.ts `litWorld`); the
    // decks' band colours and the card stock are washed here, under the scene's wash.
    const palette = useIsoPalette();
    const wash = useIsoWash();
    const plateBand = plate ? wash(plate.face.band) : undefined;
    const stackBand = stack ? wash(stack.bandColor) : undefined;
    const floor = world.floor;
    // ── Snow (docs/TOWER_SNOW.md) ──
    const covers = snow?.covers ?? {};
    const floorSnow = covers.floor;
    // Until the `towerSnowCover` si graduates, the "0 cards" imprint is printed OVER the
    // floor's snow, so an empty tower still says so. Nothing else shows through: the corner
    // fixtures' si prints, the plate and the top card are always buried.
    const coverText = snow?.coverText ?? false;
    const textOverSnow = floorSnow !== undefined && !coverText;
    // The plate lies UNDER the floor's snow, buried (the sheet is deeper than the plate
    // stands). Pressing it brushes the snow over it off (`covers.plate` shedding), and the
    // sheet keeps a hole over it from then until the trap door clears the floor.
    const plateCover = covers.plate;
    const plateBuried = floorSnow !== undefined && plateCover !== undefined && !plateCover.shed;
    // Everything standing on a snowy floor casts its shadow onto snow.
    const ground: IsoSurface = floorSnow ? { ...floor, color: palette.snow } : floor;
    // The snow's top, where the imprint printed over it (si intro) lies — FLOOR_SNOW_DEPTH up.
    const snowTop: IsoSurface = { ...ground, z: floor.z + FLOOR_SNOW_DEPTH };
    // The floor's snow sliding off the opening trap door: the widest the door has swung during
    // this swap, so it never slides back on as the door closes (the page clears it when the
    // swap ends). A ref written in render: idempotent, it only ever ratchets up within a swap.
    const slideMax = useRef(0);
    if (!snow?.swapping) slideMax.current = 0;
    else slideMax.current = Math.max(slideMax.current, Math.min(1, hingeAngle / SNOW_SLID_OFF_ANGLE));
    const floorSlide = slideMax.current;
    // The floor's snow lying (not sliding off a trap door): what stands in it is banked in
    // (IsoSnowSkirt), the pawns wade sunk in with no shadow (IsoPawn `snowDepth`), and other shadows fall on its top.
    const snowLying = floorSnow !== undefined && floorSlide <= 0;
    // Where an object of this height casts its shadow: on the snow's top while it stands out
    // of the snow, nowhere while it is buried in it, and on the floor without snow.
    const shadowReceiverFor = (height: number): IsoSurface | null | undefined => (!snowLying ? undefined : height > FLOOR_SNOW_DEPTH ? snowTop : null);
    // The floor's own receiver for everything else (cloud shade, a sky drop's shadow).
    const shadowGround = snowLying ? snowTop : ground;
    // The sort platform is thinner than the floor's snow: in snow it is as deep as the snow,
    // so its top lies flush with the snow's — the snow meets it at its outer edge (the skirt
    // reaches exactly to its top outline), not partway up its top. It casts no shadow then
    // (`shadowReceiverFor`: not taller than the snow). Any floor snow, sliding or not, so it
    // does not jump as the sheet slides off a trap door it is falling with.
    const sortThickness = floorSnow ? Math.max(SLAB_THICKNESS, FLOOR_SNOW_DEPTH) : SLAB_THICKNESS;
    // A corner fixture is an obstacle only where it stands: the pawn walks round the
    // notebook stack on the writing world and the sort platform on main, and has that
    // corner to itself elsewhere.
    const roam = notebook ? layout.notebookRoam : sortBin ? layout.sortBinRoam : layout.roam;

    // The corner fixtures' si (docs/SOFT_INTRODUCTION.md): a floor print naming each one
    // until the learner has met it 70 times over 14 days. A visit counts only while that
    // fixture is actually drawn (`enabled`), so the main world cannot graduate the
    // notebook's print, nor a Review-deck visit (no fixture) either.
    const sortIntro = useSoftIntro("towerSortLabel", { enabled: sortBin !== undefined });
    const notebookIntro = useSoftIntro("towerNotebookLabel", { enabled: notebook !== undefined });
    // The print rides its fixture: shown only while the fixture is, fading in with its
    // build-up (the fixture's `progress`). On the trap door it swings away with the floor.
    const fixturePrint =
        sortBin && sortIntro === "intro"
            ? { at: layout.sortBinLabelAt, ...FIXTURE_PRINT.sortBin, progress: sortBin.progress }
            : notebook && notebookIntro === "intro"
              ? { at: layout.notebookLabelAt, ...FIXTURE_PRINT.notebook, progress: notebook.progress }
              : null;
    // The print, lit or SHADED. A pawn's shadow is an opaque floor-tone patch, so like the
    // plate (`floorDecalsShaded`) the print is drawn again in its shaded tone inside the shadow
    // (IsoPawn `decals`) — otherwise the shadow paints over the letters it crosses.
    // The print lies on the floor UNDER any snow, even during the snow si (owner's call
    // 2026-11-09: only the "0 cards" imprint shows through): the lit print is drawn under the
    // sheet, so it shows again as the sheet slides off a trap door; its shaded copy (drawn
    // over everything, inside the pawn's shadow) only on a snowless floor.
    const fixturePrintInk = wash(COLORS.white);
    const renderFixturePrint = (shaded: boolean) =>
        (!shaded || !floorSnow) &&
        fixturePrint && (
            <IsoFloorPrint
                at={fixturePrint.at}
                lines={fixturePrint.lines}
                surface={floor}
                fontSize={FIXTURE_PRINT.fontSize}
                run="-y"
                anchor="end"
                align="right"
                tail={fixturePrint.tail}
                letterSpacing={FIXTURE_PRINT.letterSpacing}
                color={shaded ? shadowTone(fixturePrintInk) : fixturePrintInk}
                opacity={Math.min(1, Math.max(0, fixturePrint.progress))}
            />
        );
    const pawnKey = (p: SwapPawn) => String(p.key);

    // Each pawn's depth slot among the obstacles, by pawn key (mid-swap there are two).
    const [pawnDepthRanks, setPawnDepthRanks] = useState<Record<string, number>>({});
    // The pawn on the tower's top, by key. It keeps out of the study fade (see `wrapped`).
    const [summitPawn, setSummitPawn] = useState<string | null>(null);
    // A pawn reports its depth slot under its own key; keys of pawns no longer drawn are
    // dropped as the next report comes in, so the record never outgrows two entries.
    const livePawnKeys = useRef<string[]>([]);
    livePawnKeys.current = pawns.map(pawnKey);
    const reportRank = (key: string) => (rank: number) =>
        setPawnDepthRanks((ranks) => {
            const next: Record<string, number> = {};
            for (const k of livePawnKeys.current) if (k in ranks) next[k] = ranks[k];
            next[key] = rank;
            return next;
        });

    // Things falling with the old tower: dropped straight down the screen, with their floor
    // shadows faded out (DeckTowerPage's `.deck-tower-page__falling` rule). Pawns take only
    // the class (their shadow fade): they follow the drop themselves (IsoPawn `floorDrop`).
    const fallSx = (falling: boolean) =>
        falling && dropPx > 0
            ? { className: "deck-tower-page__falling", transform: `translate(0 ${dropPx.toFixed(2)})` }
            : { className: "deck-tower-page__standing" };

    // The cards' imprint ("0 cards"). Over the snow (si intro) it is printed on the sheet.
    const imprint = showImprint ? <IsoCardImprint rect={layout.card} surface={textOverSnow ? snowTop : floor} /> : null;
    // The walkers the snow's trails follow (snowChannel.ts): each live (not falling) pawn's
    // ground point on the floor, and the one summit spot on the tower's top. Recorded only
    // while that snow lies.
    // Each pawn's airborne flag (IsoPawn `airborne`), by key: the trails skip a pawn in the air.
    // Refs kept for the platform's life; keys of pawns gone are dropped as the pawns change.
    const airborneRefs = useRef(new Map<string, React.MutableRefObject<boolean>>());
    const airborneFor = (key: string) => {
        let r = airborneRefs.current.get(key);
        if (!r) {
            r = { current: false };
            airborneRefs.current.set(key, r);
        }
        return r;
    };
    for (const k of [...airborneRefs.current.keys()]) if (!pawns.some((p) => String(p.key) === k)) airborneRefs.current.delete(k);
    const livePawns = pawns.filter((p) => !p.outgoing);
    const trailWalkers: SnowWalker[] = lightning
        ? livePawns.map((p) => ({ key: String(p.key), spot: lightning.pawnSpot(p.key), airborne: airborneFor(String(p.key)) }))
        : [];
    useSnowTrailRecorder(snow?.trail, trailWalkers, snowLying);
    const towerSnowLying = covers.tower !== undefined && !covers.tower.shed;
    // The summit spot is the live (incoming) pawn's (`summitSpot` is passed to it alone).
    const summitPawnKey = livePawns.length ? String(livePawns[0].key) : undefined;
    const summitWalkers: SnowWalker[] = summitPawnKey ? [{ key: "summit", spot: summitSpot, airborne: airborneFor(summitPawnKey) }] : [];
    useSnowTrailRecorder(snow?.towerTrail, summitWalkers, towerSnowLying);

    // The plate is a push button: raised at rest, flush while held, and the deck switch
    // fires on RELEASE — its face cuts straight to the other deck as it pops back up.
    // (Called unconditionally — a hook — and simply never pressed when there is no plate.)
    const platePress = usePlatePress({ enabled: plate !== undefined && !plate.busy, onRelease: plate?.onTap ?? noop, onPress: plate?.onPress });
    // The plate's snow stands proud of the sheet by the plate's own live height (a drift),
    // offset from the floor's snow as the plate is from the floor.
    const plateDrift = plate && floorSnow ? { rect: PLATE_DRIFT_RECT, rise: Math.max(0, platePress.raised) * RAISED_HEIGHT, cover: plateCover } : undefined;
    const plateButton = plate && (
        <g
            className="deck-tower-page__plate-button"
            role="button"
            tabIndex={0}
            aria-label={plate.ariaLabel}
            {...platePress.handlers}
            style={{ cursor: plate.busy ? "default" : "pointer", outline: "none" }}
        >
            <path className="deck-tower-page__plate-hit" d={flatPath(proj, layout.labelPlateHit, floor.z)} fill="transparent" />
            <IsoFloorLabel
                rect={layout.labelPlate}
                surface={ground}
                text={plate.face.text}
                bandColor={plateBand}
                wallSteps={plate.face.wallSteps}
                raised={platePress.raised}
            />
        </g>
    );
    // The floor decals as a pawn's shadow darkens them: the corner fixture's si print, then
    // the plate at the same height, so the shaded copy lines up with the slab it covers.
    // Same paint order as the lit decals (print under plate).
    const floorDecalsShaded = (
        <>
            {renderFixturePrint(true)}
            {/* Not while it is buried: the shadow then falls on the snow over it. */}
            {plate && !plateBuried && (
                <IsoFloorLabel
                    rect={layout.labelPlate}
                    surface={ground}
                    text={plate.face.text}
                    bandColor={plateBand}
                    wallSteps={plate.face.wallSteps}
                    shaded
                    raised={platePress.raised}
                />
            )}
        </>
    );

    // The plate as a step the pawns walk up onto, at its live height (sinking when pressed,
    // springing back past RAISED_HEIGHT as it pops up).
    // And the tower's top as the summit (usePawnMotion's SUMMIT), at its live height. With
    // no cards left it closes, so a pawn never stays inside the tower's footprint (not
    // during a study: the pawn is away on the count card, and comes back with it).
    // With no plate its step is flush with the floor (height 0), which is no step at all.
    const pawnSteps: PawnStep[] = [
        // Bare once pressed clear (its hole in the floor's snow): the pawn stands on it unsunk.
        // Until then the floor's snow, lifted with it (its drift).
        { rect: layout.labelPlate, height: plate ? Math.max(0, platePress.raised) * RAISED_HEIGHT : 0, snowDepth: plateBuried ? undefined : 0 },
        {
            rect: layout.card,
            height: summitCards * CARD_THICKNESS,
            // The top card's cap: the pawn wades through it up there too.
            snowDepth: towerSnowLying ? SNOW_CAP_DEPTH : 0,
            summit: { closed: !summitHeld && summitCards === 0, held: summitHeld },
        },
    ];

    const renderPawn = (p: SwapPawn) => (
        <g key={`pawn-${pawnKey(p)}`} className={p.outgoing && dropPx > 0 ? "deck-tower-page__falling" : "deck-tower-page__standing"}>
            <IsoPawn
                at={layout.pawnAt}
                surface={ground}
                snowDepth={snowLying ? FLOOR_SNOW_DEPTH : undefined}
                roam={roam}
                startledBy={layout.card}
                // The trap door's drop, in world units: the old pawn falls with it on its own,
                // out of the air if the plate just launched it.
                floorDrop={p.outgoing ? dropPx / proj.heightUnit : 0}
                onDepthRankChange={reportRank(pawnKey(p))}
                // The incoming pawn is only startled by the NEW tower: never while the old
                // one is still on screen (it is in the air then anyway). Unknown (null) while
                // the count loads, so loading in past the threshold is a baseline, not a grow.
                startled={towerCountKnown ? (p.outgoing || !swapOutgoing) && cardsOnTower >= STARTLE_AT_CARDS : null}
                decals={floorDecalsShaded}
                steps={pawnSteps}
                entrance={p.entrance}
                tappable={!p.outgoing}
                onSummitChange={(on) => setSummitPawn((k) => (on ? pawnKey(p) : k === pawnKey(p) ? null : k))}
                summitSpot={p.outgoing ? undefined : summitSpot}
                // Lightning (towerLightning.ts): an outgoing pawn is falling, never struck.
                floorSpot={p.outgoing ? undefined : lightning?.pawnSpot(p.key)}
                airborne={p.outgoing ? undefined : airborneFor(pawnKey(p))}
                shockId={lightning?.shockIds[p.key]}
                crispy={lightning?.crispyPawns.includes(p.key) ?? false}
            />
        </g>
    );

    // Back to front: the stack, with each pawn slotted in just before the first obstacle it
    // stands behind (`depthRankAmong`). Keyed, so moving a pawn reorders it without remounting (its
    // motion state lives on) — and the fall wrapper is part of the keyed element, so
    // starting to fall does not remount it either.
    const layers: React.ReactElement[] = [];
    // A sky drop lands on the standing tower's top (the floor when it has none).
    const drop = stack?.drop ?? null;
    const landingZ = drop ? floor.z + drop.baseCards * CARD_THICKNESS : 0;
    // The tower's element (its layer's slot is held by a placeholder when there is none).
    let deckEl: React.ReactElement | null = null;
    // The standing tower's height (the snow banks round its base up to its top at most).
    const towerHeight = stack ? Math.round(stack.count * stack.progress) * CARD_THICKNESS : 0;
    if (stack) {
        deckEl = (
            <g
                key="stack"
                {...fallSx(stackFalling)}
                role={stack.onTap ? "button" : undefined}
                aria-label={stack.onTap ? "Start studying" : undefined}
                tabIndex={stack.onTap ? 0 : undefined}
                onClick={stack.onTap}
                onKeyDown={(e) => {
                    if (!stack.onTap || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    stack.onTap();
                }}
                style={{ cursor: stack.onTap ? "pointer" : undefined, outline: "none" }}
            >
                {stack.collapse ? (
                    <IsoCardRuns
                        key={`collapse-${stack.collapse.key}`}
                        rect={layout.card}
                        surface={ground}
                        plan={stack.collapse.plan}
                        label={stack.label}
                        bandColor={stackBand}
                        figure={stack.collapse.figure}
                    />
                ) : (
                    <IsoCardStack
                        rect={layout.card}
                        count={stack.count}
                        surface={ground}
                        shadowReceiver={shadowReceiverFor(towerHeight)}
                        progress={stack.progress}
                        label={stack.label}
                        bandColor={stackBand}
                        printOpacity={stack.printOpacity}
                        // Not during a ghost collapse (IsoCardRuns has no snow; it is back on the
                        // settled tower after), nor while the count card is its own layer (the
                        // page passes no cover then — the snow rides TowerCoverCard).
                        snow={covers.tower}
                        snowTrail={snow?.towerTrail}
                    />
                )}
                {snowLying && <IsoSnowSkirt rect={layout.card} z={floor.z} height={towerHeight} shadow />}
                {drop && (
                    // Keyed per drop, so its CSS fall (and the puffs' delays) start on mount.
                    <g key={`drop-${drop.key}`} className="deck-tower-page__mode-drop">
                        {drop.baseCards === 0 && (
                            // Onto the bare floor (the Review tower had no cards): the falling
                            // stack's own shadow is hidden while it is in the air, so its floor
                            // shadow is drawn here, still, and fades in from the impact (not
                            // before: until then it would sit over the "0 cards" imprint).
                            <g className="deck-tower-page__mode-drop-shadow" style={dropShadowStyle(drop)}>
                                <IsoShadow footprint={layout.card} casterZ={floor.z} receiver={shadowGround} />
                            </g>
                        )}
                        <IsoSmokePuff rect={layout.card} z={landingZ} side="behind" delayMs={drop.fallMs} />
                        {/* The falling class hides its floor shadow: it is in the air. */}
                        <g
                            className="deck-tower-page__falling deck-tower-page__mode-drop-stack"
                            style={
                                {
                                    "--lift": `${(drop.lift * proj.heightUnit).toFixed(2)}px`,
                                    animation: `deck-tower-drop-fall ${drop.fallMs.toFixed(0)}ms ${FREE_FALL} both`,
                                } as React.CSSProperties
                            }
                        >
                            <IsoCardStack
                                rect={layout.card}
                                count={drop.cards}
                                surface={{ z: landingZ, color: palette.card.top }}
                                label={stack.label}
                                bandColor={stackBand}
                                figure={stack.dropFigure}
                            />
                            {/* The seam under its bottom card: IsoCardStack draws none at its own
                                base (that edge is normally the floor), but here it meets the
                                Review tower's top card — the settled Mix tower has a seam there. */}
                            {drop.baseCards > 0 && (
                                <path
                                    className="deck-tower-page__mode-drop-seam"
                                    d={toOpenPath(frontContour(proj, layout.card, landingZ))}
                                    fill="none"
                                    stroke={palette.cardSeam}
                                    strokeWidth={1}
                                    strokeLinecap="round"
                                />
                            )}
                        </g>
                        <IsoSmokePuff rect={layout.card} z={landingZ} side="front" delayMs={drop.fallMs} />
                    </g>
                )}
            </g>
        );
    }
    // The stack's slot is held even when there is no tower, so each layer's index stays the
    // index of its obstacle in `layout.roam.obstacles` (the pawn splices in by rank).
    layers.push(deckEl ?? <g key="stack" />);
    // The lever: obstacle 1, in front of the tower's front-left face. With none, its slot is
    // held by a placeholder (the stack's rule above).
    const leverTappable = lever !== undefined && !lever.busy && lever.sink < 0.05 && lever.skyFall === null;
    const onLeverKey = (e: React.KeyboardEvent<SVGGElement>) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (leverTappable) lever.onTap();
    };
    layers.push(
        !lever ? <g key="lever" /> : <g
            key="lever"
            className="deck-tower-page__lever"
            role="button"
            aria-label={lever.ariaLabel}
            aria-hidden={lever.sink >= 0.999}
            tabIndex={leverTappable ? 0 : -1}
            onClick={() => leverTappable && lever.onTap()}
            onKeyDown={onLeverKey}
            style={{ cursor: leverTappable ? "pointer" : "default", outline: "none" }}
        >
            {/* It falls with the old tower when a trap-door swap leaves Learning; arriving,
                it drops in from the sky instead, and must not ride the old tower's fall
                (DeckTowerPage → `leverArgs`). */}
            {lever.skyFall !== "waiting" && (
                <g {...fallSx(stackFalling && lever.skyFall === null)}>
                    <IsoLever
                        at={layout.leverAt}
                        surface={ground}
                        inside={world.platform.material}
                        pull={lever.pull}
                        sink={lever.sink}
                        hatch={lever.hatch}
                        air={lever.skyFall ?? undefined}
                        knob={world.leverKnob}
                        snow={covers.lever}
                    />
                </g>
            )}
            {/* A generous tap target over the standing lever (the stick is only a few px wide). */}
            {leverTappable && (
                <path
                    className="deck-tower-page__lever-hit"
                    d={flatPath(proj, insetRect(leverFootprint(layout.leverAt), -0.6), floor.z + 1.2)}
                    fill="transparent"
                />
            )}
        </g>
    );

    // A corner fixture as a button: obstacle 2. Its art rides `fallSx` — the trap door's
    // fall, which also hides its shadow (the same DeckTowerPage rule as the tower's). A tap
    // reports the art's centre on screen (`artSelector`), not the grown tap target's, so
    // the circle transition grows from the object itself.
    const cornerButton = (fixture: {
        key: string;
        ariaLabel: string;
        tappable: boolean;
        onTap: (at: ScreenPoint) => void;
        artSelector: string;
        hitPath: string;
        art: React.ReactNode;
    }) => {
        const open = (target: Element) => {
            const r = (target.querySelector(fixture.artSelector) ?? target).getBoundingClientRect();
            fixture.onTap({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        };
        return (
            <g
                key={fixture.key}
                className={`deck-tower-page__${fixture.key}`}
                role="button"
                aria-label={fixture.ariaLabel}
                tabIndex={fixture.tappable ? 0 : -1}
                onClick={(e) => fixture.tappable && open(e.currentTarget)}
                onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    if (fixture.tappable) open(e.currentTarget);
                }}
                style={{ cursor: fixture.tappable ? "pointer" : "default", outline: "none" }}
            >
                <g {...fallSx(stackFalling)}>{fixture.art}</g>
                {fixture.tappable && !stackFalling && (
                    <path className={`deck-tower-page__${fixture.key}-hit`} d={fixture.hitPath} fill="transparent" />
                )}
            </g>
        );
    };

    // The notebook's paper stack (writing world, Learning only). It builds up with the
    // tower (`progress`). Its tap target is generous: one sheet is only ~1px thick and
    // ~40px across.
    if (notebook) {
        const notebookTopZ = floor.z + paperStackHeight(notebook.sheets, notebook.progress);
        layers.push(
            cornerButton({
                key: "notebook",
                ariaLabel: notebook.ariaLabel,
                tappable: !notebook.busy,
                onTap: notebook.onTap,
                artSelector: ".iso-paper-stack",
                hitPath: prism(proj, insetRect(layout.notebook, -0.4), floor.z, notebookTopZ + 0.4).hull,
                art: (
                    <>
                        <IsoPaperStack
                            rect={layout.notebook}
                            sheets={notebook.sheets}
                            progress={notebook.progress}
                            surface={ground}
                            shadowReceiver={shadowReceiverFor(notebookTopZ - floor.z)}
                            snow={covers.notebook}
                        />
                        {snowLying && <IsoSnowSkirt rect={layout.notebook} z={floor.z} height={notebookTopZ - floor.z} shadow casterHeight={notebookTopZ - floor.z} />}
                    </>
                ),
            }),
        );
    }
    // The mini sort platform (main world, Learning only): acp's four bins in miniature,
    // lying flat on the floor — one slab, its quadrants in the four bands' colours (acp's
    // platforms: CATEGORY_COLORS, the band SURFACE tier), washed for the time of day. Its tap target
    // covers it from the floor to the top of its jump, so a hopping platform is still
    // easy to catch.
    if (sortBin) {
        const sortQuadrantColors = [
            wash(CATEGORY_COLORS.Unfamiliar),
            wash(CATEGORY_COLORS.Target),
            wash(CATEGORY_COLORS.Comfortable),
            wash(CATEGORY_COLORS.Mastered),
        ] as const;
        const sortTopZ = sortPlatformTopZ(floor.z, sortBin.progress, sortThickness);
        layers.push(
            cornerButton({
                key: "sort-bin",
                ariaLabel: sortBin.ariaLabel,
                tappable: !sortBin.busy,
                onTap: sortBin.onTap,
                artSelector: ".iso-sort-platform__body",
                hitPath: prism(
                    proj,
                    insetRect(layout.sortBin, -0.3),
                    floor.z,
                    sortTopZ + (sortBin.hopping ? SORT_PLATFORM_JUMP : 0) + 0.3,
                ).hull,
                art: (
                    <>
                        <IsoSortPlatform
                            rect={layout.sortBin}
                            surface={ground}
                            shadowReceiver={shadowReceiverFor(sortTopZ - floor.z)}
                            quadrantColors={sortQuadrantColors}
                            thickness={sortThickness}
                            // Its walls hidden under the lying snow (no skirt: it paints over the
                            // walls, but their anti-aliased edges still showed through).
                            buriedTo={snowLying ? snowTop.z : undefined}
                            progress={sortBin.progress}
                            // Not while it falls with the trap door: it leaves the floor still.
                            hopping={sortBin.hopping && !stackFalling}
                            paused={bobPaused}
                            snow={covers.sortBin}
                        />
                    </>
                ),
            }),
        );
    }

    // The obstacles' layers in the CAMERA's back-to-front order: under the fixed view the
    // listed order, but as the study camera tips over the tower its top comes to hide the
    // lever in front of it, so the tower draws last (usePawnMotion.ts → `backToFront`; the
    // pawns rank themselves against this same order).
    const obstacleOrder = backToFront(roam.obstacles, proj);
    const ordered = obstacleOrder.map((i) => layers[i]);
    layers.splice(0, layers.length, ...ordered);
    const fallbackRank = depthRankAmong(
        layout.pawnAt,
        obstacleOrder.map((i) => roam.obstacles[i]),
        proj,
    );
    // Insert from the deepest slot down, so earlier splices don't shift later ones. The sort
    // is stable, and each splice at a slot lands BEFORE what an earlier one put there.
    const placed = pawns
        .map((p) => ({ rank: Math.min(layers.length, pawnDepthRanks[pawnKey(p)] ?? fallbackRank), node: renderPawn(p) }))
        .sort((a, b) => b.rank - a.rank);
    for (const { rank, node } of placed) layers.splice(rank, 0, node);

    // The study fade: everything but the kept deck. Normally IsoPlatform fades the floor and
    // everything on it as one group. With `keepDeck` the deck must stay opaque, which a faded
    // group cannot allow, so IsoPlatform leaves its children alone (`fadeChildren`) and each
    // layer here takes the fade itself — all but the deck, whose floor shadow alone fades,
    // being the floor's (`--platform-fade`, PLATFORM_SINK_CSS's kept-deck rule). The deck
    // keeps its slot in the draw order: lifting it out over the faded layers (as it once
    // was) drew it over the pawn and the lever in front of it.
    const fadeStyle: React.CSSProperties = { opacity: fadeOpacity };
    const fading = fadeOpacity < 1;
    const layerFade = keepDeck && fading ? fadeStyle : undefined;
    const keptDeckStyle = {
        "--platform-fade": fadeOpacity,
    } as React.CSSProperties;
    // Every layer is wrapped the same way whatever the mode, so a session starting or ending
    // re-styles the wrappers without remounting what is inside (the pawn's motion state).
    const wrapped = layers.map((el) => {
        const isDeck = el.key === "stack";
        // The pawn on the deck stays with the deck. Once the camera is down (fade 0) the
        // count card has its copy of it (TowerCoverCard), so the fade hides this one.
        const pawnKeptUp = el.key === `pawn-${summitPawn}` && fadeOpacity > 0;
        return (
            <g
                key={el.key ?? undefined}
                className={isDeck && keepDeck ? "deck-tower-page__layer deck-tower-page__kept-deck" : "deck-tower-page__layer"}
                style={isDeck ? (keepDeck ? keptDeckStyle : undefined) : pawnKeptUp ? undefined : layerFade}
            >
                {el}
            </g>
        );
    });

    // The fog's piercer: the standing tower, up to its current top. Not while it falls with
    // the trap door (it is leaving the floor), and none for an empty floor. Memoised on the
    // numbers, so IsoFog's sheet geometry only rebuilds when the tower's height changes.
    // The corner fixture (notebook stack or sort platform) pierces it too, by the same
    // rules — the sort platform as a solid up to its slab's top.
    const towerTopZ = stack && !stackFalling && cardsOnTower > 0 ? floor.z + cardsOnTower * CARD_THICKNESS : null;
    const notebookPierceZ = notebook && !stackFalling ? floor.z + paperStackHeight(notebook.sheets, notebook.progress) : null;
    const sortPierceZ = sortBin && !stackFalling ? sortPlatformTopZ(floor.z, sortBin.progress, sortThickness) : null;
    const fogPiercers = useMemo(() => {
        const out = towerTopZ === null ? [] : [{ rect: layout.card, zTop: towerTopZ }];
        if (notebookPierceZ !== null) out.push({ rect: layout.notebook, zTop: notebookPierceZ });
        if (sortPierceZ !== null) out.push({ rect: layout.sortBin, zTop: sortPierceZ });
        return out;
    }, [towerTopZ, notebookPierceZ, sortPierceZ]);
    // The same standing solids are the rain's: drops land on their tops and the floor
    // behind them is never rained on (IsoRain → "Which landing points"). Same shape.
    const rainSolids = fogPiercers;

    // A landing drop sinks the platform and everything on it, on top of its bob.
    const sinkStyle = drop
        ? ({
              "--sink": `${(IMPACT_SINK * proj.heightUnit).toFixed(2)}px`,
              animation: `deck-tower-platform-sink ${IMPACT_MS}ms ease-out ${drop.fallMs.toFixed(0)}ms both`,
          } as React.CSSProperties)
        : undefined;

    return (
        <g className={`deck-tower-page__platform deck-tower-page__platform--${world.id}`}>
            <style>{PLATFORM_SINK_CSS}</style>
            <IsoPlatform
                rect={layout.platform}
                thickness={PLATFORM_THICKNESS}
                ground={world.ground}
                tone={world.platform}
                floating
                hingeAngle={hingeAngle}
                decals={
                    <>
                        {!textOverSnow && imprint}
                        {/* Lightning's scorches: floor decals, under everything standing on it. */}
                        {lightning?.burns.map((b) => <IsoBurnMark key={`burn-${b.id}`} at={b.at} z={floor.z} seed={b.id} />)}
                        {renderFixturePrint(false)}
                        {/* The plate, under the floor's snow when there is any (its press handlers
                            still take taps: the snow lets pointer events through). */}
                        {plateButton}
                        {/* The floor's snow and the channel ploughed through it, sliding off the opening
                            trap door, with the plate's hole once it is pressed; then (si intro) the
                            text printed over it. */}
                        {floorSnow && (
                            <IsoFloorSnow rect={layout.platform} z={floor.z} slide={floorSlide} trail={snow?.trail} drift={plateDrift} />
                        )}
                        {textOverSnow && imprint}
                        {/* Passing cloud shade, over the print and the plate (a glaze, so both
                            still read) and under everything standing on the floor. */}
                        {cloudShadows?.({ receiver: shadowGround, clip: layout.platform })}
                    </>
                }
                groundDecals={cloudShadows?.({ receiver: world.ground })}
                bodyStyle={sinkStyle}
                bobPaused={bobPaused}
                fadeStyle={fading ? fadeStyle : undefined}
                fadeChildren={!keepDeck}
            >
                <g className="deck-tower-page__layer deck-tower-page__layer--behind" style={layerFade}>
                    {behind}
                </g>
                {wrapped}
                {/* Fog over everything standing on the floor and the sky either side, with the standing tower cut out
                    of every sheet it rises above (IsoFog → "Depth"); under the front sky
                    travellers, which fly far above it. */}
                {fog && fog.opacity > 0 && (
                    <g className="deck-tower-page__layer deck-tower-page__layer--fog" style={layerFade}>
                        <IsoFog clouds={fog.clouds} opacity={fog.opacity} piercers={fogPiercers} />
                    </g>
                )}
                {/* Rain in front of everything standing on the floor, splashing on the floor
                    and the tower's top; under the front sky travellers. */}
                {rain && (
                    <g className="deck-tower-page__layer deck-tower-page__layer--rain" style={layerFade}>
                        <IsoRain rect={layout.platform} floorZ={floor.z} fall={rain} solids={rainSolids} ceilingY={rainCeilingY} />
                    </g>
                )}
                {/* Snow in front of everything standing on the floor, settling on the floor
                    and the solids' tops (IsoSnow); under the front sky travellers. */}
                {snowFall && (
                    <g className="deck-tower-page__layer deck-tower-page__layer--snow" style={layerFade}>
                        <IsoSnow rect={layout.platform} floorZ={floor.z} fall={snowFall} solids={rainSolids} ceilingY={rainCeilingY} />
                    </g>
                )}
                {/* A lightning bolt coming down onto the floor, over everything on it. */}
                {lightning?.bolt && (
                    <g className="deck-tower-page__layer deck-tower-page__layer--lightning" style={layerFade}>
                        <IsoLightningBolt key={`bolt-${lightning.bolt.id}`} at={lightning.bolt.at} z={floor.z} seed={lightning.bolt.id} onDone={lightning.onBoltDone} />
                    </g>
                )}
                <g className="deck-tower-page__layer deck-tower-page__layer--front" style={layerFade}>
                    {front}
                </g>
            </IsoPlatform>
        </g>
    );
};

export default DeckTowerPlatform;
