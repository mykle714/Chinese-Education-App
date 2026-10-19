import React, { useEffect, useRef } from "react";
import { ISO } from "./palette";
import { useIsoProjector } from "./sceneContext";
import type { BirdFlight } from "./useBirdFlights";

/**
 * IsoBird — one bird crossing the sky, in the pawn's featureless ink style
 * (docs/ISO_ART_FRAMEWORK.md § "IsoBird").
 *
 * Like the pawn's body it is a SCREEN-space silhouette — an oval body, a ball head, a
 * stub tail and two wings — drawn at the projected start of its flight (`flight.from` at
 * `flight.z`). It faces its screen direction of travel (mirrored when it flies left) and
 * tips a little along the path's 2:1 slope.
 *
 * Its own requestAnimationFrame loop writes three transforms through refs, so the page
 * never re-renders for it:
 *   - travel  slides it along the flight line (the projection is affine, so a projected
 *             world delta moves the drawn bird exactly as redrawing it there would);
 *   - bounce  lifts it on each downstroke (wings down = highest), plus a slow undulation;
 *   - wings   flaps both wings by squashing them about the shoulder from spread-up
 *             (scale 1) through flat to swept-down (scale −0.7) — the flip through zero
 *             reads as the wings swinging past the body.
 *
 * No shadow: at the band's height (≈40+ world units up) the light rule would throw it far
 * off the platform into empty sky. The one object in the kit that casts none.
 *
 * Mounted per flight by the caller (keyed on `flight.id`) and unmounted when the flight's
 * time is up (useBirdFlights), so it never needs to reset.
 */
interface IsoBirdProps {
    flight: BirdFlight;
}

/** Bounce per wingbeat, and the slow undulation over the flight, in world units. */
const FLAP_BOUNCE = 0.28;
const DRIFT = 0.3;
const DRIFT_HZ = 0.15;
/** How much of the path's screen slope (≈26.6°) the body tips along. */
const TILT_FRACTION = 0.35;
/** Wing scale at the bottom of the downstroke (1 = spread up, −1 = mirrored down). */
const WING_DOWN = -0.7;

/** Local shapes, in world units, facing +x (screen right), y down. */
const SHOULDER = { x: -0.04, y: -0.12 };
/** One wing, rooted at the shoulder, pointing up and back; mirrored for the other one. */
const WING_PATH = "M 0.06 0.02 Q -0.18 -0.5 -0.64 -0.6 Q -0.38 -0.2 -0.16 0.06 Z";
const TAIL_PATH = "M -0.28 -0.04 L -0.56 -0.2 L -0.5 0.06 Z";

const wingTransform = (scaleY: number) => `translate(${SHOULDER.x} ${SHOULDER.y}) scale(1 ${scaleY.toFixed(3)})`;
const wingScale = (phase: number) => {
    // cos φ: 1 → spread up, −1 → swept down; mapped onto [WING_DOWN, 1].
    const c = Math.cos(phase);
    return WING_DOWN + ((1 - WING_DOWN) * (1 + c)) / 2;
};

const IsoBird: React.FC<IsoBirdProps> = ({ flight }) => {
    const proj = useIsoProjector();
    const u = proj.unit;
    const travelRef = useRef<SVGGElement>(null);
    const bounceRef = useRef<SVGGElement>(null);
    const wingsRef = useRef<SVGGElement>(null);

    const start = proj.project(flight.from.x, flight.from.y, flight.z);
    const end = proj.project(flight.to.x, flight.to.y, flight.z);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    // Face the way it flies; tip the nose down a fraction of the descent (up on a climb).
    const mirror = dx < 0 ? "scale(-1 1)" : "";
    const tiltDeg = (TILT_FRACTION * Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI;

    useEffect(() => {
        const t0 = performance.now();
        let frame = 0;
        const tick = (now: number) => {
            const t = Math.min(1, (now - t0) / flight.durationMs);
            const seconds = (now - t0) / 1000;
            const phase = flight.flapPhase + seconds * flight.flapHz * 2 * Math.PI;
            // Highest at the bottom of the downstroke: (1 − cos φ)/2 peaks where the wings do.
            const lift = FLAP_BOUNCE * ((1 - Math.cos(phase)) / 2) + DRIFT * Math.sin(seconds * DRIFT_HZ * 2 * Math.PI);
            // CSS px on SVG elements are user units, so these are scene units.
            if (travelRef.current) travelRef.current.style.transform = `translate(${dx * t}px, ${dy * t}px)`;
            if (bounceRef.current) bounceRef.current.style.transform = `translateY(${-lift * u}px)`;
            if (wingsRef.current) wingsRef.current.setAttribute("transform", wingTransform(wingScale(phase)));
            if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [flight, dx, dy, u]);

    return (
        <g className="iso-bird">
            <g className="iso-bird__travel" ref={travelRef}>
                <g className="iso-bird__bounce" ref={bounceRef}>
                    {/* Local frame: world units, facing +x, centred on the body. */}
                    <g className="iso-bird__shape" transform={`translate(${start.x} ${start.y}) ${mirror} rotate(${tiltDeg.toFixed(2)}) scale(${u})`}>
                        <g className="iso-bird__wings" ref={wingsRef} transform={wingTransform(wingScale(flight.flapPhase))}>
                            {/* A thin same-colour stroke rounds the wing tips (the style has no sharp points). */}
                            <path className="iso-bird__wing" d={WING_PATH} fill={ISO.ink} stroke={ISO.ink} strokeWidth={0.08} strokeLinejoin="round" />
                            <path className="iso-bird__wing" d={WING_PATH} transform="scale(-1 1)" fill={ISO.ink} stroke={ISO.ink} strokeWidth={0.08} strokeLinejoin="round" />
                        </g>
                        <path className="iso-bird__tail" d={TAIL_PATH} fill={ISO.ink} stroke={ISO.ink} strokeWidth={0.08} strokeLinejoin="round" />
                        <ellipse className="iso-bird__body" cx={0} cy={0} rx={0.38} ry={0.24} fill={ISO.ink} />
                        <circle className="iso-bird__head" cx={0.34} cy={-0.16} r={0.2} fill={ISO.ink} />
                    </g>
                </g>
            </g>
        </g>
    );
};

export default IsoBird;
