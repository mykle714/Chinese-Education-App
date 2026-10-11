import { createPortal } from "react-dom";
import { Box } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { useBankingAnchors, useBankingFrame } from "./DailyBankingContext";

/**
 * BankingEmbers — the small flames that fly from the header flame into the profile
 * picture during the hp daily banking run (docs/DAILY_MINUTE_BANKING.md § 3 phase 2).
 *
 * A `position: fixed` layer PORTALED to <body>: the header row clips, and the path
 * crosses the Settings gear, so the embers cannot live inside either control. Both ends
 * are re-read from the anchors' live rects on every frame, so a scroll (the hp header
 * scrolls away) or the flame's own swell never leaves the stream aimed at a stale point.
 *
 * Draws nothing between runs. Pointer-transparent throughout.
 *
 * LAYER: client view. Frames from `DailyBankingContext`; all motion maths from
 * `bankingAnimation.ts` except the path shape, which is pure geometry and lives here.
 */

/** Ember glyph size leaving the flame / arriving at the avatar, px. */
const EMBER_START_PX = 13;
const EMBER_END_PX = 8;
/** How far the arc rises above the straight line between the two anchors, px. */
const ARC_LIFT_PX = 26;
/** Above MUI modals (1300) so a sheet opening mid-run cannot hide the stream. */
const EMBER_Z_INDEX = 1400;

/** Centre of an element's box in viewport coords, or null if it is not mounted. */
function centerOf(el: HTMLElement | null): { x: number; y: number } | null {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Static ember box styles — the moving parts are applied per frame via `style`. */
const emberSx = {
    position: "absolute",
    left: 0,
    top: 0,
    width: EMBER_START_PX,
    height: EMBER_START_PX,
    lineHeight: 0,
    willChange: "transform, opacity",
} as const;

const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function BankingEmbers() {
    const frame = useBankingFrame();
    const anchors = useBankingAnchors();
    if (!frame || !anchors || frame.embers.length === 0) return null;

    // Launch from the GLYPH, not the whole badge (which includes the count to its right).
    const flameEl = anchors.flame.current;
    const from = centerOf(flameEl?.querySelector<HTMLElement>(".fire-count__flame") ?? flameEl);
    const to = centerOf(anchors.avatar.current);
    if (!from || !to) return null;

    return createPortal(
        <Box
            className="banking-embers"
            aria-hidden
            sx={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: EMBER_Z_INDEX }}
        >
            {frame.embers.map(({ id, progress }) => {
                const t = easeInOutQuad(progress);
                // Quadratic Bézier through a lifted midpoint. Alternate embers lift a
                // little more or less so the stream reads as several flames, not one
                // repeated sprite on a rail. There is one ember per minute drained.
                const lift = ARC_LIFT_PX * (id % 2 === 0 ? 1 : 0.6);
                const cx = (from.x + to.x) / 2;
                const cy = Math.min(from.y, to.y) - lift;
                const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * cx + t * t * to.x;
                const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * cy + t * t * to.y;
                // Shrinks toward the avatar. Drawn as a transform on a FIXED-size glyph,
                // and every per-frame value goes in `style`, never `sx`: emotion mints a
                // new CSS class for each distinct sx value, and with one ember per minute
                // drained that would be hundreds of classes a second.
                const scale = (EMBER_START_PX + (EMBER_END_PX - EMBER_START_PX) * t) / EMBER_START_PX;
                // Fade in over the first 10% and out over the last 15%, so an ember
                // neither pops into existence on the flame nor sits on the avatar.
                const opacity = Math.min(1, progress / 0.1, (1 - progress) / 0.15);
                return (
                    <Box
                        key={id}
                        className="banking-embers__ember"
                        sx={emberSx}
                        style={{
                            transform: `translate(${x - EMBER_START_PX / 2}px, ${y - EMBER_START_PX / 2}px) scale(${scale})`,
                            opacity,
                        }}
                    >
                        <Icon name="local_fire_department" size={EMBER_START_PX} color={COLORS.fireActive} fill={1} />
                    </Box>
                );
            })}
        </Box>,
        document.body
    );
}

export default BankingEmbers;
