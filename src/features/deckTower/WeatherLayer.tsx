import React, { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { ISO } from "./iso";
import { RAIN_ALPHA, RAIN_LEAN, RAIN_STROKE_PX, SNOW_ALPHA, SNOW_R, SNOW_SPEED, SNOW_SWAY, SNOW_SWAY_RATE, type WeatherEffect } from "./towerWeather";

/**
 * WeatherLayer — rain, snow and lightning over the Deck Tower's sky
 * (docs/DECK_TOWER.md § "Weather").
 *
 * Layer: page-private component (feature module `src/features/deckTower`). Mounted inside
 * SpaceBackdrop, over the star field and shooting stars and BEHIND the scene's svg, so
 * the tower, platform and cards stay crisp in front of the weather and nothing over the
 * scene (the flp session, the footer) is touched. Being behind, its rain disappears behind
 * the tower and the platform; the drops that fall IN FRONT of them and splash on the
 * platform are PlatformRain's, drawn inside the scene.
 *
 * How it draws (flat, like the rest of the iso style — no gradients or glows):
 *   - RAIN and SNOW: one <canvas>, one rAF loop, particles recycled top → bottom. Counts
 *     scale with the sky's AREA (`WeatherEffect` densities are per 100k px²) so a tablet
 *     is not sparse. The canvas is backed at ≤ 2× devicePixelRatio. The loop only runs
 *     while there are particles to draw; rAF itself pauses in a hidden tab.
 *   - FOG is NOT drawn here: it lies over the platform in iso space (iso/IsoFog.tsx, mounted
 *     by DeckTowerPlatform), so the tower and pawn stand in it rather than in front of it.
 *   - LIGHTNING: a flat white flash over the whole layer, re-mounted per `flashId` so its
 *     CSS animation restarts. The CLOCK is not here: useLightningFlashes (the page) owns it,
 *     because a flash may also strike the platform (DeckTowerPage → `strikePlatform`).
 *   - `prefers-reduced-motion`: no particles and no flashes.
 *
 * ⚡ No React state per frame: the loop writes straight to the canvas. State changes
 * only when a lightning flash fires.
 *
 * `rootRef` lets SpaceBackdrop fade the whole layer out as a tall tower climbs into
 * space (weather belongs to the sky, not to orbit) with a direct style write.
 *
 * Depends on: iso/palette.ts (`ISO.rain/snow/lightning`), towerWeather.ts
 * (`WeatherEffect`, `RAIN_LEAN`/`RAIN_ALPHA`/`RAIN_STROKE_PX`). Depended on by: SpaceBackdrop.tsx.
 */

interface WeatherLayerProps {
    effect: WeatherEffect;
    /** SpaceBackdrop writes this element's opacity (altitude fade). */
    rootRef?: React.RefObject<HTMLDivElement | null>;
    /** Bumps per lightning flash (useLightningFlashes); 0 = none yet. */
    flashId?: number;
}

// The snowflake's look (SNOW_ALPHA / SNOW_R / SNOW_SPEED / SNOW_SWAY) is shared with
// iso/IsoSnow, the flakes falling in front of the platform (towerWeather.ts).
/** Backing-store cap, so a 3× phone doesn't triple the fill cost of a decorative layer. */
const MAX_DPR = 2;

const between = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** One recycled particle. Rain uses x/y/speed; snow adds radius and a sway phase. */
interface Particle {
    x: number;
    y: number;
    speed: number;
    r: number;
    phase: number;
}

/** A double-strike flash: bright, dip, a second weaker strike, gone. */
const flash = keyframes`
    0%   { opacity: 0; }
    8%   { opacity: 0.5; }
    22%  { opacity: 0.08; }
    34%  { opacity: 0.32; }
    100% { opacity: 0; }
`;

const WeatherLayer: React.FC<WeatherLayerProps> = ({ effect, rootRef, flashId = 0 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const reducedMotion = prefersReducedMotion();
    const { rainDensity, rainSpeed, rainLength, snowDensity } = effect;
    // The flash count when this layer mounted: an old flash must not replay because the
    // layer (re)mounted, e.g. on a tester's weather pin.
    const mountFlashId = useRef(flashId);

    // ── Rain + snow: one canvas loop ─────────────────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx || reducedMotion || (rainDensity <= 0 && snowDensity <= 0)) {
            ctx?.clearRect(0, 0, canvas?.width ?? 0, canvas?.height ?? 0);
            return;
        }

        let width = 0;
        let height = 0;
        let rain: Particle[] = [];
        let snow: Particle[] = [];

        // (Re)size the backing store and repopulate to the new area's particle count.
        const fit = () => {
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
            width = rect.width;
            height = rect.height;
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const area = (width * height) / 100_000;
            rain = Array.from({ length: Math.round(rainDensity * area) }, () => ({
                x: Math.random() * (width + height * RAIN_LEAN) - height * RAIN_LEAN,
                y: Math.random() * height,
                speed: rainSpeed * (0.8 + Math.random() * 0.4),
                r: 0,
                phase: 0,
            }));
            snow = Array.from({ length: Math.round(snowDensity * area) }, () => ({
                x: Math.random() * width,
                y: Math.random() * height,
                speed: between(SNOW_SPEED),
                r: between(SNOW_R),
                phase: Math.random() * Math.PI * 2,
            }));
        };
        fit();
        const resizeObserver = new ResizeObserver(fit);
        resizeObserver.observe(canvas);

        let frame = 0;
        let last = performance.now();
        const tick = (now: number) => {
            // Clamp the step: returning to a backgrounded tab must not teleport every drop.
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            ctx.clearRect(0, 0, width, height);

            if (rain.length) {
                ctx.strokeStyle = ISO.rain;
                ctx.globalAlpha = RAIN_ALPHA;
                ctx.lineWidth = RAIN_STROKE_PX;
                ctx.lineCap = "round";
                ctx.beginPath();
                for (const p of rain) {
                    p.y += p.speed * dt;
                    p.x += p.speed * RAIN_LEAN * dt;
                    if (p.y - rainLength > height) {
                        // Recycle above the top, shifted left so the lean keeps it on screen.
                        p.y = -Math.random() * rainLength * 2;
                        p.x = Math.random() * (width + height * RAIN_LEAN) - height * RAIN_LEAN;
                    }
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p.x - rainLength * RAIN_LEAN, p.y - rainLength);
                }
                ctx.stroke();
            }

            if (snow.length) {
                ctx.fillStyle = ISO.snow;
                ctx.globalAlpha = SNOW_ALPHA;
                ctx.beginPath();
                for (const p of snow) {
                    p.y += p.speed * dt;
                    p.phase += dt * SNOW_SWAY_RATE;
                    if (p.y - p.r > height) {
                        p.y = -p.r;
                        p.x = Math.random() * width;
                    }
                    const x = p.x + Math.sin(p.phase) * SNOW_SWAY;
                    ctx.moveTo(x + p.r, p.y);
                    ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
                }
                ctx.fill();
            }

            ctx.globalAlpha = 1;
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(frame);
            resizeObserver.disconnect();
            ctx.clearRect(0, 0, width, height);
        };
    }, [rainDensity, rainSpeed, rainLength, snowDensity, reducedMotion]);

    return (
        <Box ref={rootRef} className="weather-layer" sx={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
            <canvas ref={canvasRef} className="weather-layer__particles" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
            {/* Re-mounted per flash (keyed), so its CSS animation restarts. Not gated on
                `lightning`: a tester's forced strike flashes in any weather. */}
            {flashId !== mountFlashId.current && !reducedMotion && (
                <Box
                    key={flashId}
                    className="weather-layer__lightning"
                    sx={{ position: "absolute", inset: 0, backgroundColor: ISO.lightning, opacity: 0, animation: `${flash} 600ms ease-out forwards` }}
                />
            )}
        </Box>
    );
};

export default WeatherLayer;
