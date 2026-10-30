import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import { CARD_THICKNESS, IsoCard, IsoScene, makeCameraProjector, type CameraView, type IsoWash, type WorldRect } from "./iso";
import type { StudyFrame } from "./towerCamera";
import type { TowerDeck } from "./towerDecks";
import { SHADOW } from "../../theme/shadows";

/**
 * TowerCoverCard — the tower's top COUNT card ("N cards") as its own layer, so it can be
 * slid off the deck once the study camera is down on it, and slid back on before the camera
 * climbs out (docs/DECK_TOWER.md § "Studying the tower" → "The count card").
 *
 * Why a separate layer: the session's flashcards are DOM, laid over the scene svg, so a
 * card drawn IN the scene could only ever pass under them. This draws the same IsoCard
 * (same rect, same print, same height) in a small svg of its own over the session, through
 * the camera's on-the-card view — at e = 1 the camera looks straight down at the face, so
 * this copy covers the scene's top card to the pixel and the swap is invisible. Its screen
 * box is the session's card frame (FlpTowerHost `cardFrameRef`), which is exactly where the
 * camera lands the face.
 *
 *   lifting    slides off to the right the moment the camera lands (the motion of taking
 *              the top card off a deck), uncovering the session's first card. No rest on
 *              the deck first: the dive's own ease-out already settles the camera, and a
 *              beat on top of it read as a stall.
 *   returning  slides back on from the right and settles; the scene's own top card takes
 *              over as the camera starts to climb.
 *
 * Layer: feature view (src/features/deckTower). Rendered by DeckTowerPage while
 * useTowerStudy reports a `cover`.
 */

/** The slide off, and the slide back on. */
export const COVER_LIFT_MS = 340;
export const COVER_RETURN_MS = 280;

/**
 * The count card's drop shadow grows in over this long as it lifts (with the slide, from
 * its first frame), and shrinks
 * away over the whole COVER_RETURN_MS as it settles back on. It must start and end at
 * nothing: the scene's top card it is handed over from and back to casts no shadow on the
 * card under it, so a shadow there from the first frame snapped a halo on around the card.
 */
const COVER_SHADOW_IN_MS = 320;
const COVER_SHADOW = `drop-shadow(${SHADOW.lifted})`;
/** The same filter function with nothing in it, so `filter` interpolates (one shadow → one shadow). */
const NO_COVER_SHADOW = "drop-shadow(0 0 0 transparent)";

/** Where the slide off ends: well past the screen's right edge, turned like a card thrown aside. */
const OFF_DECK = "translate(130vw, -6%) rotate(22deg)";

export interface TowerCover {
    mode: "lifting" | "returning";
    /** The session's card frame on screen (client px) — where the face lies at e = 1. */
    box: { left: number; top: number; width: number; height: number };
    /** The same frame in the scene's viewBox units (the camera's `StudyFrame`). */
    frame: StudyFrame;
    /** The camera on the card (e = 1), its screen point on the frame's centre (no bob). */
    view: CameraView;
    /** The tower's footprint, and the world z of its top face. */
    card: WorldRect;
    topZ: number;
    /** The count printed on it (the tower's). */
    count: number;
}

/**
 * `wash` is the page scene's time-of-day wash (timeOfDay.ts): this copy must be lit the
 * same as the scene's top card it stands in for, or the swap would show.
 */
const TowerCoverCard: React.FC<{ cover: TowerCover; deck: TowerDeck; wash: IsoWash }> = ({ cover, deck, wash }) => {
    const { mode, box, frame, view, card, topZ, count } = cover;
    const proj = useMemo(() => makeCameraProjector(view), [view]);

    // The layer fills the same containing block as the study layer; `box` is in client px,
    // so place the card at it relative to this layer's own origin (measured before paint).
    const layerRef = useRef<HTMLDivElement>(null);
    const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
    useLayoutEffect(() => {
        const r = layerRef.current?.getBoundingClientRect();
        if (r) setOrigin({ x: r.left, y: r.top });
    }, [box]);

    const lifting = mode === "lifting";
    return (
        <Box ref={layerRef} className="deck-tower-cover-card-layer" sx={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none", overflow: "hidden" }}>
            {origin && (
                <Box
                    className={`deck-tower-cover-card deck-tower-cover-card--${mode}`}
                    sx={{
                        position: "absolute",
                        left: box.left - origin.x,
                        top: box.top - origin.y,
                        width: box.width,
                        height: box.height,
                        // Held off the card under it while it moves: the shadow grows as it
                        // lifts and shrinks as it lands (COVER_SHADOW_IN_MS). (`drop-shadow()`
                        // takes the same offset / blur / colour list as box-shadow.)
                        animation: lifting
                            ? `deckTowerCoverLift ${COVER_LIFT_MS}ms cubic-bezier(0.3, 0, 0.6, 0.6) both, deckTowerCoverShadowIn ${COVER_SHADOW_IN_MS}ms ease-out both`
                            : `deckTowerCoverReturn ${COVER_RETURN_MS}ms cubic-bezier(0.25, 0.6, 0.4, 1) both, deckTowerCoverShadowOut ${COVER_RETURN_MS}ms ease-in both`,
                        "@keyframes deckTowerCoverShadowIn": {
                            "0%": { filter: NO_COVER_SHADOW },
                            "100%": { filter: COVER_SHADOW },
                        },
                        "@keyframes deckTowerCoverShadowOut": {
                            "0%": { filter: COVER_SHADOW },
                            "100%": { filter: NO_COVER_SHADOW },
                        },
                        "@keyframes deckTowerCoverLift": {
                            "0%": { transform: "none" },
                            "100%": { transform: OFF_DECK },
                        },
                        "@keyframes deckTowerCoverReturn": {
                            "0%": { transform: OFF_DECK },
                            "100%": { transform: "none" },
                        },
                    }}
                >
                    <IsoScene
                        wash={wash}
                        proj={proj}
                        viewBox={`${frame.left} ${frame.top} ${frame.width} ${frame.height}`}
                        className="deck-tower-cover-card__scene"
                        style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
                    >
                        {/* The scene's top card exactly (IsoCardStack's top: one card thick, its
                            face at the tower's top), with the stack's print and head band. */}
                        <IsoCard
                            rect={card}
                            z={topZ - CARD_THICKNESS}
                            thickness={CARD_THICKNESS}
                            label={deck.label}
                            bandColor={wash(deck.band)}
                            figure={String(count)}
                            caption={count === 1 ? "card" : "cards"}
                        />
                    </IsoScene>
                </Box>
            )}
        </Box>
    );
};

export default TowerCoverCard;
