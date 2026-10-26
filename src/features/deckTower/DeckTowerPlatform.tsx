import React, { useRef, useState } from "react";
import {
    CARD_THICKNESS,
    IsoCardImprint,
    IsoCardRuns,
    IsoCardStack,
    IsoFloorLabel,
    IsoFloorRecess,
    IsoLever,
    IsoPawn,
    IsoPlatform,
    IsoSmokePuff,
    RAISED_HEIGHT,
    depthRankAmong,
    flatPath,
    frontContour,
    insetRect,
    leverFootprint,
    IsoShadow,
    shadowLandTiming,
    toOpenPath,
    type PawnEntranceFrame,
    type PawnStep,
} from "./iso";
import { useIsoPalette, useIsoProjector, useIsoWash } from "./iso/sceneContext";
import { PLATFORM_THICKNESS, TOWER_LAYOUT as layout } from "./towerPlatforms";
import type { TowerWorld } from "./towerWorlds";
import type { SwapPawn } from "./useDeckSwap";
import { usePlatePress } from "./usePlatePress";
import { usePlateRecess } from "./usePlateRecess";
import { IMPACT_MS, type TowerDrop } from "./towerResizes";
import type { TowerCollapse } from "./useTowerResize";
import type { StudyDrop } from "./useTowerStudy";

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
 * Draw order inside the platform (IsoPlatform):
 *   decals    the cards' imprint under the stack ("0 cards", IsoCardImprint — drawn
 *             whenever the count has loaded, so whatever clears the floor finds it
 *             already there; `showImprint`), then
 *             the floor plate (part of the floor, slightly raised as a push button —
 *             usePlatePress.ts — so it swings with the trap door; pawns step up onto it,
 *             IsoPawn `steps`, and sink with it when it is pressed). While the tower is
 *             studied it is STOWED (usePlateRecess.ts): it recedes into the platform, the
 *             hole is filled with floor, and the climb out reverses it — drawn by
 *             IsoFloorRecess, with any pawn on it riding it down (IsoPawn `opening`);
 *   children  `behind` (sky travellers on the tower's back sides) → the stack and the
 *             focus lever (obstacles 0–1), and the pawns, each pawn
 *             slotted in front of every obstacle before the first one it stands behind
 *             (`depthRankAmong`)
 *             → `front`.
 *
 * The stack's layer is one of (docs/DECK_TOWER.md § "Tower resizes" — towerResizes.ts is
 * the library; each of its animations has a branch here):
 *   - the settled tower (IsoCardStack);
 *   - a GHOST COLLAPSE shrink (IsoCardRuns), cards ghosting out and the rest settling;
 *   - the standing tower with a SKY DROP grow on top: a tower of the new cards
 *     falling onto it (CSS free fall), with the landing's smoke ring around the join
 *     (IsoSmokePuff, its back half under the drop and its front half over it) and the
 *     whole loaded platform sinking under the blow (`PLATFORM_SINK_CSS`);
 *   - while the tower is being STUDIED (useTowerStudy.ts), a spawn's sky drop re-drawn
 *     for the study camera (`studyDrop`): the falling stack is drawn at the height the
 *     page hands in every frame — re-projected, not slid, because seen from straight
 *     above a fall is a shrink — with the same smoke ring on landing. The platform's sink
 *     is the camera's job there (a bump of its height), so none is drawn here.
 */

/** World units the platform sinks when a dropped tower lands on it. */
const IMPACT_SINK = 0.55;
/** The landing's blow: down fast, back up past rest, a small settle. Fits inside IMPACT_MS. */
const PLATFORM_SINK_CSS = `
.deck-tower-page__kept-deck .iso-card-stack__shadow { opacity: var(--platform-fade); transition: var(--platform-fade-transition); }
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
 * Crossed during the build-up, so a bigger deck startles it partway up.
 */
const STARTLE_AT_CARDS = 50;

/** The platform's fade when the toggle flips while the camera is down (`fadeEased`). */
const PLATFORM_FADE_MS = 360;

export interface PlateFace {
    text: string;
    band: string;
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
    /** A spawn's sky drop while the tower is studied (see the header), or null. */
    studyDrop?: StudyDrop | null;
    /** Freeze the platform's bob (IsoPlatform `bobPaused`) — while the study camera is away from the fixed view. */
    bobPaused?: boolean;
    /**
     * The whole platform's and everything on it's opacity — the study header's "hide the
     * platform" toggle, fading on the camera's dive and climb (useTowerStudy
     * `platformOpacity`; docs/DECK_TOWER.md § "Studying the tower" → "Hiding the platform").
     * Default 1.
     */
    fadeOpacity?: number;
    /** Ease `fadeOpacity`'s changes over PLATFORM_FADE_MS (useTowerStudy `platformFadeEased`). */
    fadeEased?: boolean;
    /**
     * Keep the deck — the tower of cards — out of the fade: it is drawn over the faded
     * platform at full opacity (IsoPlatform `overlay`), only its floor shadow fading with
     * the floor. The study dive still lands on the count card, which still slides off and
     * back on over the session's own fades (DeckTowerPage, "hide the platform" toggle).
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
    /** A swap's old towers are still on screen: an INCOMING pawn is not startled by them. */
    swapOutgoing: boolean;
    plate: {
        /** The deck it names. Switching decks swaps it in one frame — a hard cut, no animation. */
        face: PlateFace;
        ariaLabel: string;
        /** Fired when the pressed plate is RELEASED (usePlatePress). */
        onTap: () => void;
        /** Taps are ignored (a swap is running): no pointer cursor, and it will not press. */
        busy: boolean;
        /**
         * Sunk out of the floor, the hole filled flush (usePlateRecess) — while the study
         * camera dives, studies and covers. Turning it on or off plays the recess.
         */
        stowed: boolean;
        /** A change of `stowed` jumps instead of playing the recess (usePlateRecess `instant`). */
        stowInstantly?: boolean;
    };
    /**
     * The focus lever in the floor's left corner (IsoLever, docs/FOCUS_MODE.md § 5): its
     * animated numbers (useLeverMotion) and its tap. Fully sunk with its hatch shut, it
     * draws nothing — the floor is flush — and takes no taps.
     */
    lever: {
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
    /** Drawn before the tower (sky travellers on its back sides). */
    behind?: React.ReactNode;
    /** Drawn after everything (sky travellers on its front sides). */
    front?: React.ReactNode;
}

const DeckTowerPlatform: React.FC<DeckTowerPlatformProps> = ({
    world,
    hingeAngle,
    stack,
    showImprint,
    stackFalling,
    dropPx,
    pawns,
    cardsOnTower,
    swapOutgoing,
    plate,
    lever,
    behind,
    front,
    studyDrop = null,
    bobPaused = false,
    fadeOpacity = 1,
    fadeEased = false,
    keepDeck = false,
}) => {
    const proj = useIsoProjector();
    // The world arrives already lit for the time of day (timeOfDay.ts `litWorld`); the
    // decks' band colours and the card stock are washed here, under the scene's wash.
    const palette = useIsoPalette();
    const wash = useIsoWash();
    const plateBand = wash(plate.face.band);
    const stackBand = stack ? wash(stack.bandColor) : undefined;
    const floor = world.floor;
    const pawnKey = (p: SwapPawn) => String(p.key);

    // Each pawn's depth slot among the obstacles, by pawn key (mid-swap there are two).
    const [pawnDepthRanks, setPawnDepthRanks] = useState<Record<string, number>>({});
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

    // The plate is a push button: raised at rest, flush while held, and the deck switch
    // fires on RELEASE — its face cuts straight to the other deck as it pops back up.
    const recess = usePlateRecess(plate.stowed, plate.stowInstantly);
    // The plate as the button it normally is: standing at rest, not stowed.
    const plateUp = recess.atRest && recess.plug === "plate";
    const platePress = usePlatePress({ enabled: !plate.busy && plateUp, onRelease: plate.onTap });
    const plateButton = (
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
                surface={floor}
                text={plate.face.text}
                bandColor={plateBand}
                raised={platePress.raised}
            />
        </g>
    );
    // Mid-recess: the plate (or the floor plug that replaces it) moving in its own hole. A
    // plate plug stands on its base; on the button's spring past rest its base stays on the
    // floor and the slab grows, as usePlatePress's `raised` > 1 does.
    const plateBase = Math.min(0, recess.top - RAISED_HEIGHT);
    const plateRecess = (
        <IsoFloorRecess
            className="deck-tower-page__plate-recess"
            rect={layout.labelPlate}
            surface={floor}
            // Lined with the platform's own wall tones: the hole is cut into the platform.
            inside={world.platform.material}
            plugTop={recess.top}
            plugBase={plateBase}
            floorPlug={recess.plug === "floor"}
        >
            {(standZ) => (
                <IsoFloorLabel
                    rect={layout.labelPlate}
                    surface={{ ...floor, z: standZ }}
                    text={plate.face.text}
                    bandColor={plateBand}
                    raised={(recess.top - plateBase) / RAISED_HEIGHT}
                />
            )}
        </IsoFloorRecess>
    );
    // Stowed and settled, the floor is flush: nothing is drawn.
    const plateDecal = plateUp ? plateButton : recess.atRest ? null : plateRecess;

    // The same plate as a pawn's shadow darkens it — at the same height, so the shaded
    // copy lines up with the slab it covers. Only while it stands as the button: a pawn's
    // shadow over the moving recess just falls at the pawn's own height for that second.
    const plateShade = !plateUp ? undefined : (
        <IsoFloorLabel
            rect={layout.labelPlate}
            surface={floor}
            text={plate.face.text}
            bandColor={plateBand}
            shaded
            raised={platePress.raised}
        />
    );

    // The plate as a step the pawns walk up onto, at its live height (sinking when pressed,
    // springing back past RAISED_HEIGHT as it pops up). Mid-recess it is the plug's top,
    // below the floor while sunk, so a pawn on it rides it down into the hole and back up
    // with the floor plug (it launches off the rise, like off a released press). Stowed, the
    // floor is flush: no step.
    const plateStep: PawnStep[] = plateUp
        ? [{ rect: layout.labelPlate, height: Math.max(0, platePress.raised) * RAISED_HEIGHT }]
        : recess.atRest
          ? []
          : [{ rect: layout.labelPlate, height: recess.top }];

    const renderPawn = (p: SwapPawn) => (
        <g key={`pawn-${pawnKey(p)}`} className={p.outgoing && dropPx > 0 ? "deck-tower-page__falling" : "deck-tower-page__standing"}>
            <IsoPawn
                at={layout.pawnAt}
                surface={floor}
                roam={layout.roam}
                startledBy={layout.card}
                // The trap door's drop, in world units: the old pawn falls with it on its own,
                // out of the air if the plate just launched it.
                floorDrop={p.outgoing ? dropPx / proj.unit : 0}
                onDepthRankChange={reportRank(pawnKey(p))}
                // The incoming pawn is only startled by the NEW tower: never while the old
                // one is still on screen (it is in the air then anyway).
                startled={(p.outgoing || !swapOutgoing) && cardsOnTower >= STARTLE_AT_CARDS}
                decals={plateShade}
                steps={plateStep}
                opening={recess.atRest ? undefined : layout.labelPlate}
                entrance={p.entrance}
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
    // The tower's element, kept aside when `keepDeck` draws it over the fade instead.
    let deckEl: React.ReactElement | null = null;
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
                        surface={floor}
                        plan={stack.collapse.plan}
                        label={stack.label}
                        bandColor={stackBand}
                        figure={stack.collapse.figure}
                    />
                ) : (
                    <IsoCardStack
                        rect={layout.card}
                        count={stack.count}
                        surface={floor}
                        progress={stack.progress}
                        label={stack.label}
                        bandColor={stackBand}
                        printOpacity={stack.printOpacity}
                    />
                )}
                {studyDrop && (
                    <g className="deck-tower-page__study-drop">
                        {studyDrop.landedKey !== null && (
                            <IsoSmokePuff key={`study-smoke-behind-${studyDrop.landedKey}`} rect={layout.card} z={floor.z} side="behind" />
                        )}
                        {studyDrop.baseZ !== null && (
                            // In the air: no floor shadow (the falling class hides it).
                            <g className="deck-tower-page__falling deck-tower-page__study-drop-stack">
                                <IsoCardStack
                                    rect={layout.card}
                                    count={studyDrop.cards}
                                    surface={{ z: studyDrop.baseZ, color: palette.card.top }}
                                    label={stack.label}
                                    bandColor={stackBand}
                                />
                            </g>
                        )}
                        {studyDrop.landedKey !== null && (
                            <IsoSmokePuff key={`study-smoke-front-${studyDrop.landedKey}`} rect={layout.card} z={floor.z} side="front" />
                        )}
                    </g>
                )}
                {drop && (
                    // Keyed per drop, so its CSS fall (and the puffs' delays) start on mount.
                    <g key={`drop-${drop.key}`} className="deck-tower-page__mode-drop">
                        {drop.baseCards === 0 && (
                            // Onto the bare floor (the Review tower had no cards): the falling
                            // stack's own shadow is hidden while it is in the air, so its floor
                            // shadow is drawn here, still, and fades in from the impact (not
                            // before: until then it would sit over the "0 cards" imprint).
                            <g className="deck-tower-page__mode-drop-shadow" style={dropShadowStyle(drop)}>
                                <IsoShadow footprint={layout.card} casterZ={floor.z} receiver={floor} />
                            </g>
                        )}
                        <IsoSmokePuff rect={layout.card} z={landingZ} side="behind" delayMs={drop.fallMs} />
                        {/* The falling class hides its floor shadow: it is in the air. */}
                        <g
                            className="deck-tower-page__falling deck-tower-page__mode-drop-stack"
                            style={
                                {
                                    "--lift": `${(drop.lift * proj.unit).toFixed(2)}px`,
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
    // The stack's slot is held even when there is no tower (or it is kept over the fade),
    // so each layer's index stays the index of its obstacle in `layout.roam.obstacles`
    // (the pawn splices in by rank).
    layers.push(deckEl && !keepDeck ? deckEl : <g key="stack" />);
    // The lever: obstacle 1, in front of the tower's front-left face.
    const leverTappable = !lever.busy && lever.sink < 0.05 && lever.skyFall === null;
    const onLeverKey = (e: React.KeyboardEvent<SVGGElement>) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (leverTappable) lever.onTap();
    };
    layers.push(
        <g
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
                        surface={floor}
                        inside={world.platform.material}
                        pull={lever.pull}
                        sink={lever.sink}
                        hatch={lever.hatch}
                        air={lever.skyFall ?? undefined}
                        knob={world.leverKnob}
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

    const fallbackRank = depthRankAmong(layout.pawnAt, layout.roam.obstacles);
    // Insert from the deepest slot down, so earlier splices don't shift later ones. The sort
    // is stable, and each splice at a slot lands BEFORE what an earlier one put there.
    const placed = pawns
        .map((p) => ({ rank: Math.min(layers.length, pawnDepthRanks[pawnKey(p)] ?? fallbackRank), node: renderPawn(p) }))
        .sort((a, b) => b.rank - a.rank);
    for (const { rank, node } of placed) layers.splice(rank, 0, node);

    // The "hide the platform" fade: everything but the kept deck (IsoPlatform `overlay`). The
    // deck's floor shadow is the floor's, so it takes the same fade (`--platform-fade`,
    // PLATFORM_SINK_CSS's kept-deck rule).
    const fadeTransition = fadeEased ? `opacity ${PLATFORM_FADE_MS}ms ease-in-out` : undefined;
    const fadeStyle: React.CSSProperties = { opacity: fadeOpacity, transition: fadeTransition };
    const deckOverlay =
        keepDeck && deckEl ? (
            <g
                className="deck-tower-page__kept-deck"
                style={{ "--platform-fade": fadeOpacity, "--platform-fade-transition": fadeTransition ?? "none" } as React.CSSProperties}
            >
                {deckEl}
            </g>
        ) : null;

    // A landing drop sinks the platform and everything on it, on top of its bob.
    const sinkStyle = drop
        ? ({
              "--sink": `${(IMPACT_SINK * proj.unit).toFixed(2)}px`,
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
                        {showImprint && <IsoCardImprint rect={layout.card} surface={floor} />}
                        {plateDecal}
                    </>
                }
                bodyStyle={sinkStyle}
                bobPaused={bobPaused}
                fadeStyle={fadeOpacity < 1 || fadeEased ? fadeStyle : undefined}
                overlay={deckOverlay}
            >
                {behind}
                {layers}
                {front}
            </IsoPlatform>
        </g>
    );
};

export default DeckTowerPlatform;
