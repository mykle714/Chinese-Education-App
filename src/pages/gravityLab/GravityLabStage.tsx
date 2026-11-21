import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { BOB_HEIGHT, CARD_THICKNESS, IsoScene, boundsOf, cardStackMetrics, makeProjector, prism, projectOutline, roundedRectWorld, shadowFootprint } from "../../features/deckTower/iso";
import DeckTowerPlatform from "../../features/deckTower/DeckTowerPlatform";
import { useDeckSwap } from "../../features/deckTower/useDeckSwap";
import { useTowerResize } from "../../features/deckTower/useTowerResize";
import { useBuildProgress } from "../../features/deckTower/useBuildProgress";
import { GHOST_COLLAPSE, SKY_DROP } from "../../features/deckTower/towerResizes";
import { FLOOR_Z, PLATFORM_THICKNESS, TOWER_LAYOUT } from "../../features/deckTower/towerPlatforms";
import { TOWER_DECKS, otherTowerDeck, type TowerDeckId } from "../../features/deckTower/towerDecks";
import { TOWER_WORLDS } from "../../features/deckTower/towerWorlds";
import { COLORS } from "../../theme/colors";
import { CARD_SURFACE_RADIUS } from "../../theme/surfaces";

/**
 * GravityLabStage — /gravity-lab's stage: the REAL Deck Tower platform (DeckTowerPlatform),
 * deck swap (useDeckSwap → the trap door) and tower resizes (useTowerResize → ghost collapse
 * and sky drop), wired the way DeckTowerPage wires them, minus everything gravity does not
 * touch (weather, study, worlds, pans, fixtures, snow). The pawn is the real one too: press
 * the plate to launch it, tap it to poke-jump it, and every swap brings the next one in on
 * the sky fall.
 *
 * Layer: page view (dev lab). It owns its own card count; the page drives it through the
 * imperative handle (swap / shrink / grow) so the buttons live in the page's control bar.
 *
 * What it re-implements from DeckTowerPage, kept deliberately small (if td's wiring changes,
 * this is what to re-check — docs/GRAVITY_LAB.md § "The stage"):
 *   • the tower count under a swap/resize (`towerCountFor`, `swapDropPending`);
 *   • the swap's new tower arriving as a 0 → count SKY_DROP at the ready beat;
 *   • a FIXED iPhone 16 frame (393 × 852) with td's footer footprint, in place of `fitScene`
 *     (no refit, no weather bands, no camera, no scroll) — see FRAME and FOOTER.
 */

export interface GravityLabStageHandle {
    swap: () => void;
    shrink: (by: number) => void;
    grow: (by: number) => void;
}

interface GravityLabStageProps {
    /** Cards on the tower when the stage mounts (the page remounts the stage to change it). */
    initialCards: number;
    /** Lets the page grey out its buttons while something is playing. */
    onBusyChange?: (busy: boolean) => void;
}

/** Screen px per world unit — DeckTowerPage → UNIT, so the art is at its real scale. */
const UNIT = 20;
const LAYOUT = TOWER_LAYOUT;
/**
 * The stage is an iPhone 16's viewport, in CSS px (393 × 852 points), FIXED: it never resizes
 * with the tower (owner, 2026-11-20 — the earlier fit-to-tower frame jumped on every resize).
 */
const STAGE_PX = { width: 393, height: 852 } as const;
/**
 * td's slab footer on an iPhone 16 (components/MobileFooter.tsx): 16 px in from each side,
 * `max(26px, safe-area bottom)` = 34 px up from the bottom, a 64 px face on a 6 px lip. td's
 * scene ends where the footer's footprint begins (its footer spacer, SLAB_FOOTER_TOTAL_HEIGHT),
 * so FOOTER.total is the band under the scene. Mirrored by hand: re-check if the slab's metrics move.
 */
const FOOTER = { side: 16, bottom: 34, face: 64, lip: 6, total: 34 + 64 + 6 } as const;
/** Margin under the slab, in UNITs — DeckTowerPage → BOTTOM_MARGIN. */
const BOTTOM_MARGIN = 1.2;
/** Extra drop past the frame's bottom edge — DeckTowerPage → FALL_CLEARANCE. */
const FALL_CLEARANCE = 1;
/** A sky drop's underside starts this far over the frame's top edge, and never less than MIN_LIFT over its landing — DeckTowerPage → DROP_CLEARANCE / DROP_MIN_LIFT. */
const DROP_CLEARANCE = 1;
const DROP_MIN_LIFT = 8;

const proj = makeProjector(UNIT);

/**
 * The stage's ONE framing — a fixed camera, independent of the tower, laid out the way td lays
 * itself out on an iPhone 16:
 *   • horizontally, td's framing (DeckTowerPage → `fitScene`: the slab plus 0.8 units each
 *     side) filling the phone's width, so the art is at td's scale;
 *   • the scene's bottom edge is td's (`fitScene` → `maxY`: the slab or its ground shadow,
 *     whichever is lower, plus BOTTOM_MARGIN), and it sits FOOTER.total px above the screen's
 *     bottom, on top of the footer's footprint, as in td;
 *   • the viewBox runs on up to the screen's top edge.
 * A tower taller than the frame runs off the top, as td's does before you scroll. Not
 * mirrored: td's header and top safe area (both cover the top, so they only add margin), the
 * scroll, weather bands and camera.
 */
const FRAME = (() => {
    const slab = prism(proj, LAYOUT.platform, -PLATFORM_THICKNESS, BOB_HEIGHT).bounds;
    const ground = TOWER_WORLDS.core.ground;
    const shadow = boundsOf(projectOutline(proj, roundedRectWorld(shadowFootprint(LAYOUT.platform, -PLATFORM_THICKNESS, ground)), ground.z));
    const centre = proj.project(LAYOUT.platform.x + LAYOUT.platform.w / 2, LAYOUT.platform.y + LAYOUT.platform.d / 2, 0);
    const halfWidth = Math.max(centre.x - slab.minX, slab.maxX - centre.x) + UNIT * 0.8;
    const width = 2 * halfWidth;
    /** Screen px per viewBox unit: td's svg is the screen's width. */
    const scale = STAGE_PX.width / width;
    /** The scene's bottom edge (td's `maxY`): the top of the footer's footprint. */
    const maxY = Math.max(slab.maxY, shadow.maxY) + UNIT * BOTTOM_MARGIN;
    const bottom = maxY + FOOTER.total / scale;
    const height = STAGE_PX.height / scale;
    const minY = bottom - height;
    // The tower's axis at world z, as a viewBox y (for the sky drop's lift).
    const axisYAtZ = (z: number) => proj.project(LAYOUT.card.x + LAYOUT.card.w / 2, LAYOUT.card.y + LAYOUT.card.d / 2, z).y;
    return { slab, minY, maxY, axisYAtZ, viewBox: `${centre.x - halfWidth} ${minY} ${width} ${height}` };
})();

/** As DeckTowerPage measures it: world units from a `cards` tower's top (or the slab's back corner) to below the frame. */
function fallDistanceFor(cards: number): number {
    const metrics = cardStackMetrics(cards);
    const tower = prism(proj, LAYOUT.card, FLOOR_Z, BOB_HEIGHT + FLOOR_Z + metrics.bodyHeight + metrics.topThickness).bounds;
    return Math.max(0, (FRAME.maxY - Math.min(FRAME.slab.minY, tower.minY)) / proj.heightUnit) + FALL_CLEARANCE;
}

/** World units from a landing at `landingZ` up past the frame's top edge (a sky drop's lift). */
function skyAboveFrom(landingZ: number): number {
    return Math.max(DROP_MIN_LIFT, (FRAME.axisYAtZ(FLOOR_Z) - FRAME.minY) / proj.heightUnit + DROP_CLEARANCE - landingZ);
}

const GravityLabStage = forwardRef<GravityLabStageHandle, GravityLabStageProps>(({ initialCards, onBusyChange }, ref) => {
    const world = TOWER_WORLDS.core;
    const [cards, setCards] = useState(initialCards);
    const swap = useDeckSwap();
    const resize = useTowerResize();
    const summitSpot = useRef<{ x: number; y: number } | null>(null);

    // ── The tower count, as DeckTowerPage → `towerCountFor` derives it ─────────────
    // Mid-swap, from the old tower clearing until its sky drop is planned, the platform is empty.
    const swapDropPending = swap.busy && swap.outgoing === null && resize.toCards === null;
    const towerCount = swapDropPending ? 0 : (resize.heldCards ?? cards);
    const progress = useBuildProgress(swap.towerOnStage, towerCount, false);
    const stackDrawn = swap.outgoing !== null || swap.towerOnStage;
    const stackProgress = swap.outgoing?.frozenProgress ?? progress;
    const cardsOnTower = !stackDrawn ? 0 : resize.dropLanded && resize.toCards !== null ? resize.toCards : Math.round(towerCount * stackProgress);

    const busy = swap.busy || resize.busy;
    const busyRef = useRef(busy);
    busyRef.current = busy;
    useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

    // ── A swap's new tower: DeckTowerPage → `startSwapDrop` ─────────────────────────
    // At the ready beat the new deck's tower falls in from above the frame onto the bare floor.
    const swapReadyKey = swap.busy && swap.towerOnStage && swapDropPending ? swap.towerDeck : null;
    useLayoutEffect(() => {
        if (swapReadyKey === null) return;
        resize.play(SKY_DROP.plan({ fromCards: 0, toCards: cards, skyAbove: skyAboveFrom(FLOOR_Z), cameraMs: 0 }));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per swap's ready beat
    }, [swapReadyKey]);

    useImperativeHandle(ref, () => ({
        swap: () => {
            if (busyRef.current) return;
            swap.toggle({ fallDistance: fallDistanceFor(towerCount), progress: stackProgress });
        },
        shrink: (by) => {
            // Always leaves at least one card, so something is left to fall (a collapse that
            // ghosts every card has no runs and so no fall to judge).
            if (busyRef.current || cards <= 1) return;
            const toCards = Math.max(1, cards - by);
            resize.play(GHOST_COLLAPSE.plan({ fromCards: cards, toCards }));
            setCards(toCards);
        },
        grow: (by) => {
            if (busyRef.current) return;
            const toCards = cards + by;
            const landingZ = FLOOR_Z + cards * CARD_THICKNESS;
            resize.play(SKY_DROP.plan({ fromCards: cards, toCards, skyAbove: skyAboveFrom(landingZ), cameraMs: 0 }));
            setCards(toCards);
        },
    }));

    const faceFor = (deck: TowerDeckId) => ({ text: TOWER_DECKS[deck].label, band: TOWER_DECKS[deck].band, wallSteps: TOWER_DECKS[deck].plateWallSteps });

    return (
        <Box
            className="gravity-lab-stage"
            sx={{
                // The frame clips: a falling tower leaves the stage at its bottom edge, the way
                // td's tower leaves the screen.
                position: "relative",
                overflow: "hidden",
                background: world.sky,
                borderRadius: "14px",
                border: `1px solid ${COLORS.border}`,
                // Fixed iPhone 16 viewport (STAGE_PX); the border sits outside it.
                boxSizing: "content-box",
                width: `${STAGE_PX.width}px`,
                height: `${STAGE_PX.height}px`,
                flexShrink: 0,
                marginInline: "auto",
                touchAction: "none",
            }}
        >
            <IsoScene proj={proj} viewBox={FRAME.viewBox} className="gravity-lab-stage__scene" style={{ width: "100%", height: "100%", display: "block" }}>
                <DeckTowerPlatform
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
                              }
                            : null
                    }
                    showImprint
                    stackFalling={swap.outgoing !== null}
                    dropPx={(swap.outgoing?.drop ?? 0) * proj.heightUnit}
                    pawns={swap.pawns}
                    cardsOnTower={cardsOnTower}
                    towerCountKnown
                    summitCards={resize.toCards !== null ? Math.min(cardsOnTower, resize.toCards) : cardsOnTower}
                    summitHeld={false}
                    summitSpot={summitSpot}
                    swapOutgoing={swap.outgoing !== null}
                    plate={{
                        face: faceFor(swap.titleDeck),
                        ariaLabel: `Show ${TOWER_DECKS[otherTowerDeck(swap.titleDeck)].title}`,
                        onTap: () => {
                            if (!busyRef.current) swap.toggle({ fallDistance: fallDistanceFor(towerCount), progress: stackProgress });
                        },
                        busy,
                    }}
                />
            </IsoScene>
            {/* td's slab footer, as a stand-in: it only marks the space the real one takes (no tabs). */}
            <Box
                className="gravity-lab-stage__footer"
                aria-hidden
                sx={{
                    position: "absolute",
                    left: FOOTER.side,
                    right: FOOTER.side,
                    bottom: FOOTER.bottom,
                    height: FOOTER.face + FOOTER.lip,
                    borderRadius: `${CARD_SURFACE_RADIUS}px`,
                    background: COLORS.cardWall,
                    pointerEvents: "none",
                }}
            >
                <Box
                    className="gravity-lab-stage__footer-face"
                    sx={{ height: FOOTER.face, borderRadius: "inherit", background: COLORS.cardFace, border: `1px solid ${COLORS.border}`, boxSizing: "border-box" }}
                />
            </Box>
        </Box>
    );
});

GravityLabStage.displayName = "GravityLabStage";

export default GravityLabStage;
