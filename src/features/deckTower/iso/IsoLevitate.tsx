import React from "react";
import { useIsoProjector } from "./sceneContext";
import { BOB_HEIGHT, BOB_PERIOD_MS } from "./levitation";

/**
 * IsoLevitate — makes an object float (docs/ISO_ART_FRAMEWORK.md § "Levitation").
 *
 * Renders the object's `shadow` where it is (on the ground below), then the object's
 * drawing (`children`) in a group that bobs up and down. The two run separate CSS
 * animations with the SAME duration, easing and start (both mount together), so they
 * stay in lockstep without a shared clock: as the object rises the shadow shrinks toward
 * its centre and fades, and as it sinks the shadow grows back.
 *
 * `--iso-bob` is the rise in screen px, set inline because it depends on the scene's
 * unit. Both animations stop under prefers-reduced-motion, leaving the object still at
 * its lowest point — where its shadow was computed.
 */
const LEVITATE_CSS = `
@keyframes iso-levitate-bob { from { transform: translateY(0); } to { transform: translateY(calc(-1 * var(--iso-bob))); } }
@keyframes iso-levitate-shadow { from { transform: scale(1); opacity: 1; } to { transform: scale(0.92); opacity: 0.6; } }
.iso-levitate__body { animation: iso-levitate-bob ${BOB_PERIOD_MS / 2}ms ease-in-out infinite alternate; }
.iso-levitate__shadow {
    transform-box: fill-box;
    transform-origin: center;
    animation: iso-levitate-shadow ${BOB_PERIOD_MS / 2}ms ease-in-out infinite alternate;
}
@media (prefers-reduced-motion: reduce) {
    .iso-levitate__body, .iso-levitate__shadow { animation: none; }
}
`;

interface IsoLevitateProps {
    /** The floating object's shadow — an IsoShadow cast at the object's resting height. */
    shadow: React.ReactNode;
    /** The floating object, and everything riding on it. */
    children?: React.ReactNode;
}

const IsoLevitate: React.FC<IsoLevitateProps> = ({ shadow, children }) => {
    const proj = useIsoProjector();
    return (
        <g className="iso-levitate">
            <style>{LEVITATE_CSS}</style>
            <g className="iso-levitate__shadow">{shadow}</g>
            <g className="iso-levitate__body" style={{ "--iso-bob": `${BOB_HEIGHT * proj.unit}px` } as React.CSSProperties}>
                {children}
            </g>
        </g>
    );
};

export default IsoLevitate;
