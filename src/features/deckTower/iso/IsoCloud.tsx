import React, { useEffect, useMemo, useRef } from "react";
import IsoSolid from "./IsoSolid";
import { prism } from "./geometry";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import { prefersReducedMotion } from "./skyTraffic";
import type { CloudDrift } from "./useCloudDrifts";

/**
 * IsoCloud — one cloud drifting past the tower (docs/ISO_ART_FRAMEWORK.md § "IsoCloud").
 *
 * A cluster of low PILL prisms (a rounded rect whose radius is half its short side) — a
 * raised crown over a few base lobes — each painted with IsoSolid in the cloud material:
 * a white top and two shaded walls, the same three-tone rule as every other solid, so
 * it reads as a chunky toy cloud rather than a flat sticker. The puffs come pre-sorted
 * back-to-front (useCloudDrifts → orientPuffs), so the painter's order is just theirs.
 *
 * It is drawn ONCE at its starting position and slid by its own
 * requestAnimationFrame loop: the projection is affine, so translating by a projected
 * world delta moves the drawing exactly as redrawing it there would. It also fades in
 * over FADE_MS, which matters for a slot's opener — it appears partway across the screen.
 *
 * No shadow: at 90+ world units up the light rule would throw it far off
 * the platform into empty sky.
 *
 * Under prefers-reduced-motion it is drawn fully opaque where it starts and never moves.
 *
 * Mounted per drift by the caller (keyed on `drift.id`) and unmounted when the drift's
 * time is up, so it never needs to reset.
 */
interface IsoCloudProps {
    drift: CloudDrift;
}

const FADE_MS = 1600;

const IsoCloud: React.FC<IsoCloudProps> = ({ drift }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const groupRef = useRef<SVGGElement>(null);
    const reduced = prefersReducedMotion();

    // Where this drift begins (startT of the way along the whole crossing), and the
    // screen delta to where the crossing ends.
    const { puffs, dx, dy } = useMemo(() => {
        const { from, to, startT, z } = drift;
        const ox = from.x + (to.x - from.x) * startT;
        const oy = from.y + (to.y - from.y) * startT;
        const start = proj.project(ox, oy, z);
        const end = proj.project(to.x, to.y, z);
        return {
            puffs: drift.puffs.map((p) => {
                const rect = { x: ox + p.x, y: oy + p.y, w: p.w, d: p.d, r: Math.min(p.w, p.d) / 2 };
                return prism(proj, rect, z + p.z, z + p.z + p.h);
            }),
            dx: end.x - start.x,
            dy: end.y - start.y,
        };
    }, [proj, drift]);

    useEffect(() => {
        if (reduced) return;
        const t0 = performance.now();
        let frame = 0;
        const tick = (now: number) => {
            const elapsed = now - t0;
            const t = Math.min(1, elapsed / drift.durationMs);
            const el = groupRef.current;
            if (el) {
                // CSS px on SVG elements are user units, so these are scene units.
                el.style.transform = `translate(${dx * t}px, ${dy * t}px)`;
                el.style.opacity = String(Math.min(1, elapsed / FADE_MS));
            }
            if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [drift.durationMs, dx, dy, reduced]);

    return (
        <g className="iso-cloud" ref={groupRef} style={{ opacity: reduced ? 1 : 0 }}>
            {puffs.map((geometry, i) => (
                <IsoSolid key={i} geometry={geometry} material={palette.cloud} className="iso-cloud__puff" />
            ))}
        </g>
    );
};

export default IsoCloud;
