import React, { useRef } from "react";
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
 *
 * `paused` FREEZES both where they are (`animation-play-state`), rather than stopping
 * them, so un-pausing carries on from the same frame with no jump. The bob is a screen-y
 * slide, which is only "up" under the fixed view: the Deck Tower pauses it while its
 * camera flies away from that view, and reads the frozen offset back
 * (`frozenBobOffsetPx`) to aim the camera at where the object actually stands
 * (docs/DECK_TOWER.md § "Studying the tower").
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
.iso-levitate--paused .iso-levitate__body, .iso-levitate--paused .iso-levitate__shadow { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
    .iso-levitate__body, .iso-levitate__shadow { animation: none; }
}
`;

interface IsoLevitateProps {
    /** The floating object's shadow — an IsoShadow cast at the object's resting height. */
    shadow: React.ReactNode;
    /** The floating object, and everything riding on it. */
    children?: React.ReactNode;
    /** Freeze the bob where it is (see the header). */
    paused?: boolean;
}

const IsoLevitate: React.FC<IsoLevitateProps> = ({ shadow, children, paused = false }) => {
    const proj = useIsoProjector();
    // The rise in px, from the scene's unit — but frozen with the bob: a moving camera
    // changes `unit` every frame, and the paused animation's offset is a share of this
    // var, so letting it follow would slide the frozen object off where it stopped.
    const bobPx = useRef(BOB_HEIGHT * proj.heightUnit);
    if (!paused) bobPx.current = BOB_HEIGHT * proj.heightUnit;
    return (
        <g className={paused ? "iso-levitate iso-levitate--paused" : "iso-levitate"}>
            <style>{LEVITATE_CSS}</style>
            <g className="iso-levitate__shadow">{shadow}</g>
            <g className="iso-levitate__body" style={{ "--iso-bob": `${bobPx.current}px` } as React.CSSProperties}>
                {children}
            </g>
        </g>
    );
};

export default IsoLevitate;
