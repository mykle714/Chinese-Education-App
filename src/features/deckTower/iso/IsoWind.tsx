import React, { useEffect, useMemo, useRef } from "react";
import { toOpenPath } from "./geometry";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import type { WindGust } from "./useWindGusts";

/**
 * IsoWind — one wind gust sweeping past the tower: straight streaks, the main one ending in a
 * curl (docs/ISO_ART_FRAMEWORK.md § "IsoWind").
 *
 * Each strand is projected from the gust's vertical plane (useWindGusts) into ONE open
 * path, drawn as a flat round-capped stroke in `ISO.wind` at WIND_OPACITY. No fill, no
 * three-tone shading: a gust is air, not a solid, so it is the kit's one stroke-only
 * object.
 *
 * Its own requestAnimationFrame loop plays each strand as a moving visible window along
 * the path — the head draws on, then the tail follows and erases it — using
 * `pathLength = 1` so the dash maths is in fractions of the strand. The whole gust also
 * slides `drift` world units along its travel (a projected world delta, as for the
 * cloud).
 *
 * No shadow, like the cloud. Mounted per gust (keyed on `gust.id`) and
 * unmounted when its time is up, so it never resets.
 */
interface IsoWindProps {
    gust: WindGust;
}

/** The streaks' opacity over the sky — softer than a cloud's solid white. */
const WIND_OPACITY = 0.7;
/** Stroke width, world units. */
const STROKE_WIDTH = 0.2;
/**
 * The visible window over a strand's play time p (0–1): the head sweeps to the end over
 * the first HEAD_SPAN, the tail starts after TAIL_FROM and catches up at p = 1. The two
 * overlap, so the whole streak is briefly visible before it erases.
 */
const HEAD_SPAN = 0.6;
const TAIL_FROM = 0.4;
/** Below this visible fraction the strand is hidden (a round cap would leave a dot). */
const MIN_VISIBLE = 0.002;

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
const easeInOutQuad = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const IsoWind: React.FC<IsoWindProps> = ({ gust }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const groupRef = useRef<SVGGElement>(null);
    const strandRefs = useRef<(SVGPathElement | null)[]>([]);

    // Strands projected from the gust's plane: (s, h) → world (origin + dir·s, z + h).
    const { paths, dx, dy } = useMemo(() => {
        const { origin, dir, z } = gust;
        const at = (s: number, h: number) => proj.project(origin.x + dir.x * s, origin.y + dir.y * s, z + h);
        const zero = proj.project(0, 0, 0);
        const slid = proj.project(dir.x * gust.drift, dir.y * gust.drift, 0);
        return {
            paths: gust.strands.map((st) => toOpenPath(st.pts.map((p) => at(p.s, p.h)))),
            dx: slid.x - zero.x,
            dy: slid.y - zero.y,
        };
    }, [proj, gust]);

    useEffect(() => {
        const t0 = performance.now();
        let frame = 0;
        const tick = (now: number) => {
            const elapsed = now - t0;
            const life = Math.min(1, elapsed / gust.durationMs);
            // CSS px on SVG elements are user units, so these are scene units.
            if (groupRef.current) groupRef.current.style.transform = `translate(${dx * life}px, ${dy * life}px)`;
            gust.strands.forEach((st, i) => {
                const el = strandRefs.current[i];
                if (!el) return;
                const p = clamp01((elapsed - st.delayMs) / st.drawMs);
                const head = easeOutCubic(clamp01(p / HEAD_SPAN));
                const tail = easeInOutQuad(clamp01((p - TAIL_FROM) / (1 - TAIL_FROM)));
                const visible = head - tail;
                // One dash [tail, head) and a gap longer than the path, so it never repeats.
                el.style.strokeDasharray = `${Math.max(0, visible)} 2`;
                el.style.strokeDashoffset = String(-tail);
                el.style.visibility = visible > MIN_VISIBLE ? "visible" : "hidden";
            });
            if (life < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [gust, dx, dy]);

    return (
        <g className="iso-wind" ref={groupRef} opacity={WIND_OPACITY}>
            {paths.map((d, i) => (
                <path
                    key={i}
                    ref={(el) => {
                        strandRefs.current[i] = el;
                    }}
                    className={i === 0 ? "iso-wind__strand iso-wind__strand--curl" : "iso-wind__strand"}
                    d={d}
                    pathLength={1}
                    fill="none"
                    stroke={palette.wind}
                    strokeWidth={STROKE_WIDTH * proj.unit}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    // Hidden until the first frame sets its window.
                    style={{ visibility: "hidden" }}
                />
            ))}
        </g>
    );
};

export default IsoWind;
