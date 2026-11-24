import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { COLORS } from "../theme/colors";
import { dialogContainer } from "./overlayHost";

/**
 * PawnLoader — the Deck Tower's generic "something is loading" mark: a white disc in the
 * middle of the screen with the pawn standing in its centre, and a black runner line with
 * a fading tail circling the disc's rim (docs/DECK_TOWER.md § "Loading feedback").
 *
 * Layer: shared presentational UI (`src/components/`). Used by every surface that waits:
 * the Deck Tower, the study session, Add Cards, the Writing Notebook and the route-chunk
 * fallback (App.tsx), so it lives here, not in a feature (docs/FRONTEND_LAYERING.md § "The rule").
 *
 * ── Drawing ──────────────────────────────────────────────────────────────────
 *   disc    a white circle (COLORS.white) with the app's hairline outline (COLORS.border),
 *           so it still reads on the paler skies (the writing world's pink, a white fog).
 *   pawn    the IsoPawn at rest, in ink, scaled to 46% of the disc and centred on
 *           its own bounding box — the same figure as the tower's pawns, without a scene or
 *           shadow. It is a SNAPSHOT (PAWN_BODY_PATH / PAWN_HEAD below), not drawn live:
 *           `components/` may not import the tower's iso kit, and the loader's pawn never
 *           moves. See PAWN_BODY_PATH for how to regenerate it.
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
 * whether taps should do anything while it is up.
 *
 * ── Centring ─────────────────────────────────────────────────────────────────
 * It portals into the phone frame (`dialogContainer()`, src/components/overlayHost.ts) and
 * pins itself `position: absolute; inset: 0` there — the same host and pinning every dim
 * and MUI Dialog uses — so it centres on the SCREEN: the full-bleed frame on mobile, the
 * 402px phone card on desktop. Portalling to `document.body` with `position: fixed` (the
 * first version) centred it on the desktop browser window instead, off the phone card.
 * Hosting at the frame also keeps transformed page ancestors (td's scroll-away header, the
 * tower scroller) from capturing it. Outside any frame (the plain shell) the host is
 * `body`, where it falls back to `position: fixed`.
 *
 * Depends on: components/overlayHost.ts (`dialogContainer`), theme/colors.ts; the pawn
 * snapshot mirrors src/features/deckTower/iso/pawnFigure.ts (`pawnFigure`, `REST_POSE`).
 * Callers: DeckTowerPage, FlashcardsLearnPage, AddCardsPage, App.tsx (`renderRoute`),
 * WritingNotebookPage (the last-word lookup), NotebookGrid (the "Next empty" lookup),
 * the study session's own waits (GameBreakArea, useWritingFlashcard, and
 * ProvisionalSortOffer's `showLoader` — all gated on FlashcardsLearnPage's `loaderAllowed`),
 * LoaderPreviewChip's preview. Docs: docs/DECK_TOWER.md § "Loading feedback".
 */

/** The disc's diameter, CSS px. */
const DISC_PX = 72;
/** The runner line's thickness, CSS px; it rides just inside the disc's rim. */
const RUNNER_PX = 3;
/** The share of the runner's ring the fading tail covers before the head (0–1). */
const TAIL_SHARE = 0.4;
/** One full lap of the runner. */
const RUNNER_TURN_MS = 1000;
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
 * The resting pawn's outline in the pawn svg's 100 × 100 box centred on (0, 0), already
 * scaled to 46% of the disc's height and centred on its own bounding box (head top at
 * y = −23, feet at y = +23): the capsule body, and the head circle.
 *
 * A SNAPSHOT of `pawnFigure(makeProjector(1), { x: 0, y: 0, z: 0 }, REST_POSE)`
 * (src/features/deckTower/iso/pawnFigure.ts), taken 2026-11-23. To regenerate after the
 * pawn's proportions change: run that call, scale every coordinate by
 * 46 / figureHeight (figureHeight = −(head.cy − head.r)), shift y by figureHeight / 2
 * before scaling, and round to 2 dp.
 */
const PAWN_BODY_PATH = "M 8.59 14.87 L 8.59 -0.13 A 8.59 8.59 0 0 0 -8.59 -0.13 L -8.59 14.87 A 8.59 8.59 0 1 0 8.59 14.87 Z";
const PAWN_HEAD = { cx: 0, cy: -13.31, r: 9.69 } as const;

export interface PawnLoaderProps {
    /** Hold the loader back this long before showing it; 0 shows it at once. */
    delayMs?: number;
    /** What the loader is waiting for, for screen readers. */
    label?: string;
    /** The overlay's stacking order (it is centred on the screen, portalled to the phone frame). */
    zIndex?: number;
}

/**
 * The default show delay. 800 ms (user decision 2026-11-23; first built at 400 ms): long
 * enough that an ordinary fetch never flashes the loader, short of DelayedCircularProgress's 1 s.
 */
const DEFAULT_DELAY_MS = 800;

const PawnLoader: React.FC<PawnLoaderProps> = ({ delayMs = DEFAULT_DELAY_MS, label = "Loading", zIndex = 1300 }) => {
    const [visible, setVisible] = useState(delayMs <= 0);
    useEffect(() => {
        if (delayMs <= 0) return;
        const t = window.setTimeout(() => setVisible(true), delayMs);
        return () => window.clearTimeout(t);
    }, [delayMs]);

    if (!visible) return null;
    // The phone frame when one is on screen (absolute fills it), else body (fixed fills the viewport).
    const host = dialogContainer();
    return createPortal(
        <Box
            className="pawn-loader"
            role="status"
            aria-live="polite"
            aria-label={label}
            sx={{
                position: host === document.body ? "fixed" : "absolute",
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
                    <path className="pawn-loader__pawn-body" d={PAWN_BODY_PATH} fill={COLORS.onSurface} />
                    <circle className="pawn-loader__pawn-head" cx={PAWN_HEAD.cx} cy={PAWN_HEAD.cy} r={PAWN_HEAD.r} fill={COLORS.onSurface} />
                </svg>
            </Box>
        </Box>,
        host
    );
};

export default PawnLoader;
