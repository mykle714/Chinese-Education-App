import React, { useRef, useState } from "react";
import {
    CARD_THICKNESS,
    ISO,
    IsoCardImprint,
    IsoCardRuns,
    IsoCardStack,
    IsoFloorLabel,
    IsoLever,
    IsoPawn,
    IsoPlatform,
    IsoSmokePuff,
    IsoWallSlider,
    RAISED_HEIGHT,
    depthRankAmong,
    flatPath,
    frontContour,
    insetRect,
    leverFootprint,
    IsoShadow,
    shadowLandTiming,
    toOpenPath,
    type PawnStep,
} from "./iso";
import { useIsoProjector } from "./iso/sceneContext";
import { PLATFORM_THICKNESS, TOWER_LAYOUT as layout } from "./towerPlatforms";
import type { TowerWorld } from "./towerWorlds";
import type { SwapPawn } from "./useDeckSwap";
import { usePlatePress } from "./usePlatePress";
import { TOWER_MODES, type TowerModeId } from "./towerModes";
import { IMPACT_MS, type ModeSwitchCollapse, type ModeSwitchDrop } from "./useStudyModeSwitch";

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
 *             IsoPawn `steps`, and sink with it when it is pressed);
 *   fittings  the Mix / Review switch on the front-left wall (IsoWallSlider; it swings
 *             with the trap door too);
 *   children  `behind` (sky travellers on the tower's back sides) → the stack and the
 *             pawns, each pawn slotted in front of every obstacle before the first one it
 *             stands behind (`depthRankAmong`)
 *             → `front`.
 *
 * The stack's layer is one of (docs/DECK_TOWER.md § "Mix / Review switch"):
 *   - the settled tower (IsoCardStack);
 *   - a Mix → Review COLLAPSE (IsoCardRuns), cards ghosting out and the rest settling;
 *   - the Review tower with a Review → Mix DROP on top: the Unfamiliar + Target tower
 *     falling onto it (CSS free fall), with the landing's smoke ring around the join
 *     (IsoSmokePuff, its back half under the drop and its front half over it) and the
 *     whole loaded platform sinking under the blow (`PLATFORM_SINK_CSS`).
 */

/** World units the platform sinks when a dropped tower lands on it. */
const IMPACT_SINK = 0.55;
/** The landing's blow: down fast, back up past rest, a small settle. Fits inside IMPACT_MS. */
const PLATFORM_SINK_CSS = `
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
function dropShadowStyle(drop: ModeSwitchDrop): React.CSSProperties {
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
     * Mix → Review collapse; `drop` stands a Review → Mix drop on top of it, whose top card
     * names `dropFigure` (the Mix total it makes).
     */
    stack: {
        count: number;
        progress: number;
        label: string;
        bandColor: string;
        collapse?: ModeSwitchCollapse | null;
        drop?: ModeSwitchDrop | null;
        dropFigure?: number;
    } | null;
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
    };
    /** The Mix / Review switch on the front-left wall. */
    modeSwitch: {
        mode: TowerModeId;
        /** Not in use (the Mastered deck is up): greyed out, and taps are ignored. */
        dimmed: boolean;
        /** Taps are ignored for now (a switch, swap or pan is running, or the tower is still building). */
        busy: boolean;
        ariaLabel: string;
        onTap: () => void;
    };
    /**
     * The focus lever in the back-right corner (IsoLever, docs/FOCUS_MODE.md § 5): its
     * animated numbers (useLeverMotion) and its tap. Fully sunk with its hatch shut, it
     * draws as a seamed floor tile and takes no taps.
     */
    lever: {
        pull: number;
        sink: number;
        hatch: number;
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
    modeSwitch,
    lever,
    behind,
    front,
}) => {
    const proj = useIsoProjector();
    const floor = world.floor;
    // Each pawn's depth slot among the obstacles, by pawn key (mid-swap there are two).
    const [pawnDepthRanks, setPawnDepthRanks] = useState<Record<number, number>>({});
    // A pawn reports its depth slot under its own key; keys of pawns no longer drawn are
    // dropped as the next report comes in, so the record never outgrows two entries.
    const livePawnKeys = useRef<number[]>([]);
    livePawnKeys.current = pawns.map((p) => p.key);
    const reportRank = (key: number) => (rank: number) =>
        setPawnDepthRanks((ranks) => {
            const next: Record<number, number> = {};
            for (const k of livePawnKeys.current) if (k in ranks) next[k] = ranks[k];
            next[key] = rank;
            return next;
        });

    // Things falling with the old tower: dropped straight down the screen, with their floor
    // shadows faded out (DeckTowerPage's `.deck-tower-page__falling` rule).
    const fallSx = (falling: boolean) =>
        falling && dropPx > 0
            ? { className: "deck-tower-page__falling", transform: `translate(0 ${dropPx.toFixed(2)})` }
            : { className: "deck-tower-page__standing" };

    // The plate is a push button: raised at rest, flush while held, and the deck switch
    // fires on RELEASE — its face cuts straight to the other deck as it pops back up.
    const platePress = usePlatePress({ enabled: !plate.busy, onRelease: plate.onTap });
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
                bandColor={plate.face.band}
                raised={platePress.raised}
            />
        </g>
    );
    // The same plate as a pawn's shadow darkens it — at the same height, so the shaded
    // copy lines up with the slab it covers.
    const plateShade = (
        <IsoFloorLabel
            rect={layout.labelPlate}
            surface={floor}
            text={plate.face.text}
            bandColor={plate.face.band}
            shaded
            raised={platePress.raised}
        />
    );

    // The plate as a step the pawns walk up onto, at its live height (sinking when pressed,
    // springing back past RAISED_HEIGHT as it pops up).
    const plateStep: PawnStep[] = [{ rect: layout.labelPlate, height: Math.max(0, platePress.raised) * RAISED_HEIGHT }];

    const renderPawn = (p: SwapPawn) => (
        <g key={`pawn-${p.key}`} {...fallSx(p.outgoing)}>
            <IsoPawn
                at={layout.pawnAt}
                surface={floor}
                roam={layout.roam}
                startledBy={layout.card}
                alarmed={p.alarmed}
                onDepthRankChange={reportRank(p.key)}
                // The incoming pawn is only startled by the NEW tower: never while the old
                // one is still on screen (it is in the air then anyway).
                startled={(p.outgoing || !swapOutgoing) && cardsOnTower >= STARTLE_AT_CARDS}
                decals={plateShade}
                steps={plateStep}
                entrance={p.entrance}
            />
        </g>
    );

    // Back to front: the stack, with each pawn slotted in just before the first obstacle it
    // stands behind (`depthRankAmong`). Keyed, so moving a pawn reorders it without remounting (its
    // motion state lives on) — and the fall wrapper is part of the keyed element, so
    // starting to fall does not remount it either.
    const layers: React.ReactElement[] = [];
    // A Review → Mix drop lands on the Review tower's top (the floor when it has none).
    const drop = stack?.drop ?? null;
    const landingZ = drop ? floor.z + drop.baseCards * CARD_THICKNESS : 0;
    if (stack) {
        layers.push(
            <g key="stack" {...fallSx(stackFalling)}>
                {stack.collapse ? (
                    <IsoCardRuns
                        key={`collapse-${stack.collapse.key}`}
                        rect={layout.card}
                        surface={floor}
                        plan={stack.collapse.plan}
                        label={stack.label}
                        bandColor={stack.bandColor}
                        figure={stack.collapse.figure}
                    />
                ) : (
                    <IsoCardStack
                        rect={layout.card}
                        count={stack.count}
                        surface={floor}
                        progress={stack.progress}
                        label={stack.label}
                        bandColor={stack.bandColor}
                    />
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
                                surface={{ z: landingZ, color: ISO.card.top }}
                                label={stack.label}
                                bandColor={stack.bandColor}
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
                                    stroke={ISO.cardSeam}
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
    // The stack's slot is held even when there is no tower, so each layer's index stays
    // the index of its obstacle in `layout.roam.obstacles` (the pawn splices in by rank).
    if (!stack) layers.push(<g key="stack" />);
    // The lever: obstacle 1, in front of the tower's right-hand face.
    const leverTappable = !lever.busy && lever.sink < 0.05;
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
            <IsoLever at={layout.leverAt} surface={floor} pull={lever.pull} sink={lever.sink} hatch={lever.hatch} />
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
    // Insert from the deepest slot down, so earlier splices don't shift later ones.
    const placed = pawns
        .map((p) => ({ p, rank: Math.min(layers.length, pawnDepthRanks[p.key] ?? fallbackRank) }))
        .sort((a, b) => b.rank - a.rank);
    for (const { p, rank } of placed) layers.splice(rank, 0, renderPawn(p));

    // The Mix / Review switch: a tap (or Enter / Space) flips it. A plain click handler is
    // enough — unlike the plate it has no press travel to show; the knob slides instead.
    const switchActive = !modeSwitch.dimmed && !modeSwitch.busy;
    const onSwitchKey = (e: React.KeyboardEvent<SVGGElement>) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (switchActive) modeSwitch.onTap();
    };
    const switchFitting = (
        <g
            className="deck-tower-page__mode-switch"
            role="switch"
            aria-checked={modeSwitch.mode === "review"}
            aria-disabled={modeSwitch.dimmed}
            aria-label={modeSwitch.ariaLabel}
            tabIndex={modeSwitch.dimmed ? -1 : 0}
            onClick={() => switchActive && modeSwitch.onTap()}
            onKeyDown={onSwitchKey}
            style={{ cursor: switchActive ? "pointer" : "default", outline: "none" }}
        >
            <IsoWallSlider
                layout={layout.modeSwitch}
                wallTone={world.platform.material.left}
                position={modeSwitch.mode === "review" ? 1 : 0}
                label={TOWER_MODES[modeSwitch.mode].label}
                labelColor={TOWER_MODES[modeSwitch.mode].band}
                dimmed={modeSwitch.dimmed}
            />
        </g>
    );

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
                        {plateButton}
                    </>
                }
                fittings={switchFitting}
                bodyStyle={sinkStyle}
            >
                {behind}
                {layers}
                {front}
            </IsoPlatform>
        </g>
    );
};

export default DeckTowerPlatform;
