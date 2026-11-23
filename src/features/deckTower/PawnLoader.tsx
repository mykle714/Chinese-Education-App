import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { COLORS } from "../../theme/colors";
import { makeProjector } from "./iso";
import { pawnFigure, REST_POSE } from "./iso/pawnFigure";

/**
 * PawnLoader — the Deck Tower's generic "something is loading" mark: a white disc in the
 * middle of the screen with the pawn standing in its centre, and a black runner line with
 * a fading tail circling the disc's rim (docs/DECK_TOWER.md § "Loading feedback").
 *
 * Layer: presentational UI (feature module `src/features/deckTower`). It lives here, not in
 * `src/components/`, because it draws the pawn through the iso kit's `pawnFigure`, and
 * `components/` may never import from `features/` (docs/FRONTEND_LAYERING.md). Moving it
 * to `components/` means moving `pawnFigure` (pure geometry) out of the feature first.
 *
 * ── Drawing ──────────────────────────────────────────────────────────────────
 *   disc    a white circle (COLORS.white) with the app's hairline outline (COLORS.border),
 *           so it still reads on the paler skies (the writing world's pink, a white fog).
 *   pawn    the IsoPawn at rest (`pawnFigure` + REST_POSE, under the fixed 2:1 projector),
 *           in ink, scaled to PAWN_SHARE of the disc and centred on its own bounding box —
 *           the same figure as the tower's pawns, without a scene or shadow.
 *   runner  a ring on the disc's rim filled with a conic gradient (transparent → ink) and
 *           masked down to a RUNNER_PX band, so the line is solid at its head and fades out
 *           over its tail; a round ink dot caps the head. The whole ring turns once per
 *           RUNNER_TURN_MS. The CSS mask is sent with its `-webkit-` twin for iOS WebKit
 *           (the Capacitor shell).
 *
 * ── Timing ───────────────────────────────────────────────────────────────────
 * Nothing is drawn for the first `delayMs` (as DelayedCircularProgress does), so a fast
 * load never flashes the loader; past it, the loader fades in over FADE_IN_MS. Keep the
 * runner spinning under prefers-reduced-motion: it is the only signal that work is still
 * going on (an essential animation), and a turn of a thin line is a small motion.
 *
 * The overlay is `pointer-events: none`: it never blocks the scene under it. Callers decide
 * whether taps should do anything while it is up. It is portalled to `document.body`, so a
 * transformed ancestor (td's scroll-away header, the tower scroller) cannot turn its
 * `position: fixed` into "fixed to that ancestor" and pull it off the screen's centre.
 *
 * Depends on: iso/pawnFigure.ts (`pawnFigure`, `REST_POSE`), iso/geometry.ts
 * (`makeProjector`), theme/colors.ts. Docs: docs/DECK_TOWER.md § "Loading feedback".
 */

/** The disc's diameter, CSS px. */
const DISC_PX = 72;
/** The runner line's thickness, CSS px; it rides just inside the disc's rim. */
const RUNNER_PX = 3;
/** The share of the runner's ring the fading tail covers before the head (0–1). */
const TAIL_SHARE = 0.4;
/** One full lap of the runner. */
const RUNNER_TURN_MS = 1000;
/** The pawn's height as a share of the disc's diameter. */
const PAWN_SHARE = 0.46;
/** The fade-in once the delay has passed. */
const FADE_IN_MS = 180;

const spin = keyframes`
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
`;
const fadeIn = keyframes`
    from { opacity: 0; }
    to   { opacity: 1; }
`;

/** The ring mask: only the outer RUNNER_PX of the disc shows the gradient. */
const RING_MASK = `radial-gradient(farthest-side, transparent calc(100% - ${RUNNER_PX}px), #000 calc(100% - ${RUNNER_PX}px))`;

/**
 * The resting pawn's outline in a 100 × 100 box centred on (0, 0): its body path and head,
 * plus the transform that scales and centres the figure (built once — it never moves).
 */
function usePawnGlyph() {
    return useMemo(() => {
        // Feet at the projector's origin; unit 1 (any unit works, the figure is scaled below).
        const fig = pawnFigure(makeProjector(1), { x: 0, y: 0, z: 0 }, REST_POSE);
        // At rest the figure is upright and centred on x = 0: it runs from the head's top
        // down to the feet (y = 0), where the body's bottom sphere touches.
        const top = fig.head.cy - fig.head.r;
        const height = -top;
        const scale = (100 * PAWN_SHARE) / height;
        // Centre the figure's box (top … 0) on the disc's centre.
        const transform = `scale(${scale}) translate(0 ${height / 2})`;
        return { fig, transform };
    }, []);
}

export interface PawnLoaderProps {
    /** Hold the loader back this long before showing it; 0 shows it at once. */
    delayMs?: number;
    /** What the loader is waiting for, for screen readers. */
    label?: string;
    /** The overlay's stacking order (it is fixed, centred on the viewport, portalled to body). */
    zIndex?: number;
}

const PawnLoader: React.FC<PawnLoaderProps> = ({ delayMs = 400, label = "Loading", zIndex = 1300 }) => {
    const [visible, setVisible] = useState(delayMs <= 0);
    useEffect(() => {
        if (delayMs <= 0) return;
        const t = window.setTimeout(() => setVisible(true), delayMs);
        return () => window.clearTimeout(t);
    }, [delayMs]);
    const { fig, transform } = usePawnGlyph();

    if (!visible) return null;
    return createPortal(
        <Box
            className="pawn-loader"
            role="status"
            aria-live="polite"
            aria-label={label}
            sx={{
                position: "fixed",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                zIndex,
                animation: `${fadeIn} ${FADE_IN_MS}ms ease-out both`,
            }}
        >
            <Box
                className="pawn-loader__disc"
                sx={{
                    position: "relative",
                    width: DISC_PX,
                    height: DISC_PX,
                    borderRadius: "50%",
                    backgroundColor: COLORS.white,
                    border: `1px solid ${COLORS.border}`,
                    boxSizing: "border-box",
                }}
            >
                {/* The runner: the conic gradient's last TAIL_SHARE ramps up to ink at 0°,
                    where the dot caps it; the rest of the ring is clear. */}
                <Box
                    className="pawn-loader__runner"
                    aria-hidden
                    sx={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: "50%",
                        background: `conic-gradient(from 0deg, transparent 0turn ${1 - TAIL_SHARE}turn, ${COLORS.onSurface} 1turn)`,
                        WebkitMask: RING_MASK,
                        mask: RING_MASK,
                        animation: `${spin} ${RUNNER_TURN_MS}ms linear infinite`,
                    }}
                >
                    {/* The head's round cap, at 12 o'clock — where the gradient reaches full ink. */}
                    <Box
                        className="pawn-loader__runner-head"
                        sx={{
                            position: "absolute",
                            top: 0,
                            left: "50%",
                            width: RUNNER_PX,
                            height: RUNNER_PX,
                            marginLeft: `${-RUNNER_PX / 2}px`,
                            borderRadius: "50%",
                            backgroundColor: COLORS.onSurface,
                        }}
                    />
                </Box>
                <svg
                    className="pawn-loader__pawn"
                    aria-hidden
                    viewBox="-50 -50 100 100"
                    width={DISC_PX}
                    height={DISC_PX}
                    style={{ position: "absolute", inset: 0, display: "block" }}
                >
                    <g transform={transform}>
                        <path className="pawn-loader__pawn-body" d={fig.bodyPath} fill={COLORS.onSurface} />
                        <circle className="pawn-loader__pawn-head" cx={fig.head.cx} cy={fig.head.cy} r={fig.head.r} fill={COLORS.onSurface} />
                    </g>
                </svg>
            </Box>
        </Box>,
        document.body
    );
};

export default PawnLoader;
