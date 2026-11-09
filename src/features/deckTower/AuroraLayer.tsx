import React, { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { AURORA_BAND, AURORA_COLORS } from "./towerAurora";

/**
 * AuroraLayer — the reading world's rare aurora: slow green curtains with orchid tips,
 * swaying over the night sky (docs/DECK_TOWER.md § "Time of day" → "Aurora").
 *
 * Layer: page-private component (feature module `src/features/deckTower`), mounted inside
 * SpaceBackdrop between the star field and the shooting stars, so the scene and meteors
 * pass in front of it and the stars show through it. Drawn in SCREEN space on one canvas.
 *
 * How it is drawn (ported from the 2026-11-08 explorer, "Curtains" style):
 *   - Three overlapping FOLDS, each a wavy baseline swaying on two sines.
 *   - Each fold is many thin vertical STRIPS, each a stretched copy of ONE pre-rendered
 *     gradient sprite (pnk tips → grnSky base, a quick fall-off under the base). No blur
 *     or filter: the SVG-filter wash was cut 2026-10-30 for lag, so this keeps a frame to a
 *     few hundred `drawImage`s.
 *   - Per strip: RAYS (fine striations that shimmer) × an ENVELOPE (brightness rolling
 *     along the fold), so it never reads as a uniform stripe. Strips add ('lighter').
 *   - It FILLS THE SKY within a band of the screen's height (`AURORA_BAND`, towerAurora.ts:
 *     fractions of the backdrop's height from its top — the backdrop is the full screen).
 *     Each fold's base sways near the band's bottom and its rays reach toward the band's
 *     top; nothing is drawn outside the band. Horizontal geometry (the sway's wavelength,
 *     the rays' spacing) is in a 400-unit-wide logical frame scaled to the canvas width.
 *
 * Cost control: ~30 fps (`FRAME_MS`); the loop runs only while `strength` > 0 and the tab
 * is visible; DPR capped at `MAX_DPR` (the aurora is soft — extra pixels buy nothing).
 * Under `prefers-reduced-motion` it draws one still frame.
 *
 * `strength` (0–1) arrives per frame mid-pan (the world pan's palette blend). It is read
 * through a ref so the loop never restarts for it. SpaceBackdrop fades `rootRef` out on
 * the climb into space.
 *
 * Depends on: towerAurora.ts. Depended on by: SpaceBackdrop.tsx.
 */

/** Logical width the geometry is written in (scaled to the canvas width). */
const LOGICAL_W = 400;
/** Strip pitch, logical units (each strip is drawn 1 unit wider, so neighbours overlap). */
const STRIP_STEP = 2.5;
/** Overall brightness at strength 1 (the explorer's intensity 75%). */
const INTENSITY = 0.75;
/** Animation speed (the explorer's speed 50%: 0.15 + 0.5 × 1.2). */
const TIME_SCALE = 0.75;
const FRAME_MS = 33;
const MAX_DPR = 1.5;

/**
 * The three folds. `amp` (sway) and `lift` (how far its resting base sits above the band's
 * bottom) are fractions of the band's height; `reach` is how much of the room between its
 * base and the band's top its rays fill; `scale` its brightness.
 */
const FOLDS = [
    { phase: 0.0, amp: 0.05, freq: 0.012, lift: 0.1, reach: 1.0, scale: 1.0 },
    { phase: 2.1, amp: 0.035, freq: 0.019, lift: 0.22, reach: 0.85, scale: 0.7 },
    { phase: 4.3, amp: 0.06, freq: 0.008, lift: 0.12, reach: 0.6, scale: 0.5 },
] as const;

function rgba(hex: string, a: number): string {
    const n = parseInt(hex.replace("#", ""), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** The one vertical gradient every strip is a stretched copy of (top = tips, bottom = base). */
function makeSprite(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = 256;
    const ctx = c.getContext("2d");
    if (!ctx) return c;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    const { base, fringe } = AURORA_COLORS;
    g.addColorStop(0, rgba(fringe, 0));
    g.addColorStop(0.3, rgba(fringe, 0.35));
    g.addColorStop(0.62, rgba(base, 0.55));
    g.addColorStop(0.92, rgba(base, 1));
    g.addColorStop(1, rgba(base, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2, 256);
    return c;
}

function drawFrame(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, strength: number, seconds: number) {
    const { width, height } = ctx.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const a = INTENSITY * strength;
    if (a <= 0.001 || width === 0) return;
    // x in logical units (scaled by width), y in canvas pixels (the band is screen-relative).
    const sc = width / LOGICAL_W;
    ctx.setTransform(sc, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    const bandTop = height * AURORA_BAND.top;
    const bandBottom = height * AURORA_BAND.bottom;
    const bandH = bandBottom - bandTop;
    const t = seconds * TIME_SCALE;
    for (const f of FOLDS) {
        for (let x = -10; x < LOGICAL_W + 10; x += STRIP_STEP) {
            // The sway (two sines, ±1.5 amp), kept inside the band.
            const sway = Math.sin(x * f.freq + t * 0.6 + f.phase) + 0.5 * Math.sin(x * f.freq * 2.3 - t * 0.9 + f.phase * 1.7);
            const y0 = Math.min(bandBottom, bandBottom - bandH * f.lift + bandH * f.amp * sway);
            const ray = 0.55 + 0.45 * Math.sin(x * 0.23 + t * 1.4 + f.phase) * Math.sin(x * 0.051 - t * 0.55);
            const envelope = Math.max(0, 0.45 + 0.55 * Math.sin(x * 0.007 + t * 0.25 + f.phase));
            const alpha = a * ray * envelope * f.scale * 0.42;
            if (alpha <= 0.002) continue;
            ctx.globalAlpha = Math.min(1, alpha);
            // The strip runs from its base (y0) up toward the band's top, never past it. The
            // sprite's bright base sits 8% from its bottom; its last 8% is the fall-off.
            const h = (y0 - bandTop) * f.reach * (0.8 + 0.2 * Math.sin(x * 0.031 + t * 0.7 + f.phase));
            if (h <= 1) continue;
            ctx.drawImage(sprite, x, y0 - h, STRIP_STEP + 1, h);
        }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
}

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

interface AuroraLayerProps {
    /** 0 = none (the loop stops), 1 = full: night's share in the aurora world, blended mid-pan. */
    strength: number;
    /** SpaceBackdrop writes the climb fade onto this element's opacity. */
    rootRef?: React.RefObject<HTMLDivElement | null>;
}

const AuroraLayer: React.FC<AuroraLayerProps> = ({ strength, rootRef }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const strengthRef = useRef(strength);
    strengthRef.current = strength;
    const visible = strength > 0;

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx || !visible) return;
        const sprite = makeSprite();
        // `clock` advances only while frames are drawn, so a hidden tab resumes where it was.
        // A random start, so two visits don't open on the same fold.
        let clock = Math.random() * 100;
        // Keep the backing store matched to the box (rotation, the footer's height changing).
        const resize = () => {
            const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
            const r = canvas.getBoundingClientRect();
            canvas.width = Math.max(1, Math.round(r.width * dpr));
            canvas.height = Math.max(1, Math.round(r.height * dpr));
        };
        resize();
        const observer = new ResizeObserver(() => {
            resize();
            drawFrame(ctx, sprite, strengthRef.current, clock);
        });
        observer.observe(canvas);

        if (prefersReducedMotion()) {
            drawFrame(ctx, sprite, strengthRef.current, clock);
            // Still frame, but a mid-pan strength change must still repaint it.
            const id = window.setInterval(() => drawFrame(ctx, sprite, strengthRef.current, clock), 250);
            return () => {
                window.clearInterval(id);
                observer.disconnect();
            };
        }
        let raf = 0;
        let last = performance.now();
        let lastDraw = 0;
        const tick = (now: number) => {
            raf = requestAnimationFrame(tick);
            if (document.visibilityState !== "visible") {
                last = now;
                return;
            }
            clock += Math.min(0.1, (now - last) / 1000);
            last = now;
            if (now - lastDraw < FRAME_MS) return;
            lastDraw = now;
            drawFrame(ctx, sprite, strengthRef.current, clock);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        };
    }, [visible]);

    return (
        <Box ref={rootRef} className="deck-tower-page__aurora" sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <canvas ref={canvasRef} className="deck-tower-page__aurora-canvas" style={{ display: "block", width: "100%", height: "100%" }} />
        </Box>
    );
};

export default AuroraLayer;
