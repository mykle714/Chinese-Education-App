import { memo } from "react";
import { animated, useSpring } from "@react-spring/web";
import { useDrag } from "@use-gesture/react";
import { COLORS } from "../../theme/colors";
import TileFace from "./TileFace";
import { HELD_TILE_SCALE, TILE_RADIUS_PX, tileStockShadow } from "./sentenceTilesStyles";

/**
 * DraggableRackTile — one rack tile, picked up and dropped onto the board
 * (docs/SENTENCE_TILES_GAME.md § "Pages" → "Placing tiles").
 *
 * The gesture is the add-cards page's (acp, features/discover/AddCardsPage.tsx → DraggableCard):
 *   - pickup: the tile scales to HELD_TILE_SCALE once and its cast shadow eases out from under
 *     it (`lift` 0 → 1) — no tilt, no wash;
 *   - held: it tracks the finger 1:1 (`immediate`), and the board lights the square under it
 *     (`onHover` → SentenceTilesBoard's handle — kept in the BOARD's state so the page, and
 *     this tile, never re-render mid-drag);
 *   - release over a free square: `onDrop` places it and the tile unmounts where it was let
 *     go (no fly-home); anywhere else it springs back to its rack slot.
 * A tap (no movement past use-gesture's threshold) is `onTap` — select / inspect / exchange pick.
 *
 * memo is load-bearing (the same reason as acp's DraggableCard): a page re-render on an
 * unrelated state change mid-drag must not hand the live gesture new props. Every prop the
 * page passes is a stable callback or a primitive.
 *
 * Layer: feature component. Depended on by SentenceTilesGamePage.tsx.
 */

interface DraggableRackTileProps {
    tileId: number;
    word: string;
    sizePx: number;
    face?: string;
    selected?: boolean;
    /** False while exchanging or off-turn: taps still work, drags do not. */
    draggable: boolean;
    onTap: (tileId: number, word: string) => void;
    /** Pointer moved while held: the board lights the free square under it, if any. */
    onHover: (clientX: number, clientY: number) => void;
    /** Released: place the tile at the square under the pointer. Returns false when it can't land there. */
    onDrop: (tileId: number, clientX: number, clientY: number) => boolean;
}

const SPRING = { tension: 400, friction: 30 };

function DraggableRackTile({ tileId, word, sizePx, face = COLORS.cardFace, selected, draggable, onTap, onHover, onDrop }: DraggableRackTileProps) {
    const [{ x, y, scale, lift }, api] = useSpring(() => ({ x: 0, y: 0, scale: 1, lift: 0 }));

    const bind = useDrag(
        ({ tap, down, movement: [mx, my], xy: [px, py] }) => {
            if (tap) { onTap(tileId, word); return; }
            if (!draggable) return;
            if (down) {
                api.start({ x: mx, y: my, scale: HELD_TILE_SCALE, immediate: true });
                api.start({ lift: 1, config: SPRING });
                onHover(px, py);
                return;
            }
            // Released. A landed drop unmounts this tile (the page moves it to the board), so
            // its spring is deliberately left where it was let go.
            if (!onDrop(tileId, px, py)) api.start({ x: 0, y: 0, scale: 1, lift: 0, config: SPRING });
        },
        { filterTaps: true },
    );

    return (
        <animated.div
            {...bind()}
            className="sentence-tiles-rack__tile"
            role="button"
            aria-label={word}
            style={{
                x,
                y,
                scale,
                position: "relative",
                zIndex: 10,
                borderRadius: TILE_RADIUS_PX,
                boxShadow: lift.to((l) => tileStockShadow(face, l)),
                touchAction: "none",
                cursor: draggable ? "grab" : "pointer",
            }}
        >
            <TileFace word={word} sizePx={sizePx} face={face} selected={selected} stock="none" />
        </animated.div>
    );
}

export default memo(DraggableRackTile);
