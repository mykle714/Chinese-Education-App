import React from "react";
import { useIsoPalette } from "./iso";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";

/**
 * TapToStartHint — "Tap to Start" painted on the Deck Tower's sky, with a thick arrow
 * pointing down at the Learning tower (docs/DECK_TOWER.md § "Tap to Start").
 *
 * Layer: page-private component (feature module `src/features/deckTower`). Flat white
 * paint, not an iso object — but drawn INSIDE the scene's svg (IsoScene), in its viewBox
 * px, so it is fixed to the platform: it scrolls with the scene and rides the world pan
 * and a held swipe along with it, at no cost of its own.
 *
 * Its height is FIXED, not tied to the live tower: the page points it at where the top of
 * a TAP_HINT_FIT_CARDS tower stands (DeckTowerPage `hintFit`), whatever the deck size — a
 * short tower leaves sky under the arrow, a tall one rises in front and covers it. On a
 * short tower the words stand above the svg's top edge; the scene svg is
 * `overflow: visible`, so they still paint.
 *
 * It is the scene's FIRST child, so everything else (the tower) paints over it. It
 * ignores pointer events: the tap is the STACK's (DeckTowerPlatform `stack.onTap`),
 * never the hint's.
 *
 * Its look is the app's "ground paint"; HTML drawn the same way reads theme/groundPaint.ts
 * (Match Speed). Retune the two together.
 *
 * Depends on: iso (`useIsoPalette().white`), theme/fonts + theme/scale.
 * Depended on by: DeckTowerPage.tsx. Docs: docs/DECK_TOWER.md § "Tap to Start".
 */

/** Gap between the arrow's tip and the fit tower's top, in viewBox px. */
const TIP_GAP = 10;
/** The arrow, in viewBox px: a thick shaft under a solid, wider head. */
const SHAFT_LENGTH = 26;
const SHAFT_WIDTH = 9;
const HEAD_LENGTH = 22;
const HEAD_WIDTH = 34;
/** The words, in viewBox px (≈ screen px on a phone: the viewBox is ~400 wide). */
const FONT_SIZE = 26;
/** Between the words' baseline and the shaft's top. */
const TEXT_GAP = 10;

interface TapToStartHintProps {
    /** viewBox x of the tower's axis (the platform's centre) — the arrow's line. */
    centreX: number;
    /** viewBox y of the fit tower's top — the arrow points here. */
    tipY: number;
    /** Shown (fades in/out — Learning only, and not mid-swap). */
    visible: boolean;
}

const TapToStartHint: React.FC<TapToStartHintProps> = ({ centreX, tipY, visible }) => {
    // White under the scene's time-of-day wash, like everything else painted on the sky.
    const palette = useIsoPalette();
    // Stacked upward from the tip: head, shaft, gap, words.
    const tip = tipY - TIP_GAP;
    const headBase = tip - HEAD_LENGTH;
    const shaftTop = headBase - SHAFT_LENGTH;
    const baseline = shaftTop - TEXT_GAP;
    // One closed outline: shaft and head as a single filled shape.
    const arrow = [
        `M ${centreX - SHAFT_WIDTH / 2} ${shaftTop}`,
        `L ${centreX + SHAFT_WIDTH / 2} ${shaftTop}`,
        `L ${centreX + SHAFT_WIDTH / 2} ${headBase}`,
        `L ${centreX + HEAD_WIDTH / 2} ${headBase}`,
        `L ${centreX} ${tip}`,
        `L ${centreX - HEAD_WIDTH / 2} ${headBase}`,
        `L ${centreX - SHAFT_WIDTH / 2} ${headBase}`,
        "Z",
    ].join(" ");
    return (
        <g
            className="deck-tower-page__tap-hint"
            aria-hidden
            style={{ pointerEvents: "none", opacity: visible ? 1 : 0, transition: "opacity 220ms ease-out" }}
        >
            <text
                className="deck-tower-page__tap-hint-text"
                x={centreX}
                y={baseline}
                textAnchor="middle"
                fill={palette.white}
                fontFamily={FONTS.cjk}
                fontWeight={WEIGHT.bold}
                fontSize={FONT_SIZE}
            >
                Tap to Start
            </text>
            {/* Rounded joins soften the head's corners without thinning it. */}
            <path
                className="deck-tower-page__tap-hint-arrow"
                d={arrow}
                fill={palette.white}
                stroke={palette.white}
                strokeWidth={3}
                strokeLinejoin="round"
            />
        </g>
    );
};

export default TapToStartHint;
