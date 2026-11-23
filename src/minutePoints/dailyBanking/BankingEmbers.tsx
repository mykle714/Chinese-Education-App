import { createPortal } from "react-dom";
import { Box } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";
import { useBankingAnchors, useBankingFrame } from "./DailyBankingContext";

/**
 * BankingEmbers — the small flames that fly from the header flame into the profile
 * picture during the td daily banking run (docs/DAILY_MINUTE_BANKING.md § 3 phase 1).
 *
 * A `position: fixed` layer PORTALED to <body>: the header row clips, and the path
 * runs between two controls, so the embers cannot live inside either one. Both ends
 * are re-read from the anchors' live rects on every frame, so any movement of the header
 * never leaves the stream aimed at a stale point.
 *
 * Draws nothing between runs. Pointer-transparent throughout.
 *
 * LAYER: client view. Frames from `DailyBankingContext`; all motion maths from
 * `bankingAnimation.ts` except the path shape (burst-then-home Bézier), which is pure geometry and lives here.
 */

/** Ember glyph size leaving the flame / arriving at the avatar, px. */
const EMBER_START_PX = 13;
const EMBER_END_PX = 8;
/**
 * Burst-then-home path (§ 3 phase 1). Each ember first shoots out of the flame in its own
 * direction — any of 360° — then bends round on a smooth curve into the avatar, like a
 * spark caught by a pull. `BURST_PX` is how far along its launch direction the curve's
 * first control point sits (min/max, picked per ember), so it sets how far the ember
 * travels outward before it turns.
 */
const BURST_PX = { min: 34, max: 64 };
/**
 * Where the second control point sits on the line from the burst point to the avatar,
 * 0 = at the burst point, 1 = on the avatar. Lower = a wider, lazier turn; higher = the
 * ember snaps onto the avatar sooner. Also sets the arrival speed (a cubic Bézier arrives
 * at 3 × |P3 − P2|), so the ember slots in fast but not instantly.
 */
const HOMING_SHARE = 0.55;
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

/**
 * Deterministic 0–1 noise from an ember id and a salt. The path is recomputed every frame
 * from `id` alone, so a `Math.random()` would make each ember jitter between directions;
 * a hash keeps one ember on one path for its whole flight while neighbours still differ.
 */
function emberNoise(id: number, salt: number): number {
    const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
}

/**
 * Time warp along the curve. The Bézier is already fast at both ends (the control points
 * sit far from the anchors), so a straight-linear parameter would read as constant hurry.
 * This holds a little speed back in the middle — the ember decelerates out of the burst,
 * hangs at the turn for a beat, then is pulled into the avatar. Its slope is
 * `1 + BURST_HANG · cos(2πt)`: (1 + h)× speed at both ends, (1 − h)× at the midpoint. It
 * stays monotonic (no backtracking) for any `BURST_HANG` < 1.
 */
const BURST_HANG = 0.35;
const burstThenHome = (t: number) => t + (BURST_HANG * Math.sin(2 * Math.PI * t)) / (2 * Math.PI);

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
                const t = burstThenHome(progress);
                // Cubic Bézier P0 → P3 (flame → avatar). P1 sits out along this ember's own
                // launch angle, so it LEAVES the flame heading that way — up, down, even
                // straight away from the avatar. P2 sits part-way from P1 to the avatar, so
                // the second half bends smoothly round and arrives on target. There is one
                // ember per minute drained; the per-id angle and burst length turn the
                // stream into a spray instead of one sprite on a rail.
                const angle = emberNoise(id, 1) * 2 * Math.PI;
                const burst = BURST_PX.min + (BURST_PX.max - BURST_PX.min) * emberNoise(id, 2);
                const p1x = from.x + Math.cos(angle) * burst;
                const p1y = from.y + Math.sin(angle) * burst;
                const p2x = p1x + (to.x - p1x) * HOMING_SHARE;
                const p2y = p1y + (to.y - p1y) * HOMING_SHARE;
                const u = 1 - t;
                const x = u * u * u * from.x + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * to.x;
                const y = u * u * u * from.y + 3 * u * u * t * p1y + 3 * u * t * t * p2y + t * t * t * to.y;
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
