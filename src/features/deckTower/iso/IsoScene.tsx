import React, { useMemo } from "react";
import type { Projector } from "./geometry";
import { IsoPaletteContext, IsoSceneContext, IsoWashContext } from "./sceneContext";
import { NO_WASH, washPalette, type IsoWash } from "./wash";

/**
 * IsoScene — the root of an iso drawing (docs/ISO_ART_FRAMEWORK.md § "The scene").
 *
 * One <svg> whose viewBox the caller fits to its content, plus the context that hands
 * `proj` to every iso component inside it. Objects are positioned in WORLD units only;
 * the projector turns them into screen px once, and the viewBox scales the result to
 * whatever box the scene is laid out in.
 *
 * `wash` lights the whole scene (wash.ts, docs/ISO_ART_FRAMEWORK.md § "Ambient wash"):
 * the scene provides `ISO` under it to every object (`useIsoPalette`). Colours the caller
 * passes to objects as props are the caller's to wash.
 */
interface IsoSceneProps {
    proj: Projector;
    /** Screen-px viewBox, usually fitted to the scene's settled bounds. */
    viewBox: string;
    /**
     * Where the viewBox sits in the svg's box when their aspect ratios differ — the SVG
     * `preserveAspectRatio` value. Default centres it; "xMidYMax meet" pins the scene to
     * the bottom of a tall box.
     */
    preserveAspectRatio?: string;
    className?: string;
    style?: React.CSSProperties;
    /** The ambient wash over every palette colour. Keep its identity stable between renders (it re-washes the palette when it changes). */
    wash?: IsoWash;
    children?: React.ReactNode;
}

const IsoScene: React.FC<IsoSceneProps> = ({ proj, viewBox, preserveAspectRatio = "xMidYMid meet", className, style, wash = NO_WASH, children }) => {
    const palette = useMemo(() => washPalette(wash), [wash]);
    return (
        <IsoSceneContext.Provider value={proj}>
            <IsoWashContext.Provider value={wash}>
                <IsoPaletteContext.Provider value={palette}>
                    <svg className={className} viewBox={viewBox} preserveAspectRatio={preserveAspectRatio} style={style}>
                        {children}
                    </svg>
                </IsoPaletteContext.Provider>
            </IsoWashContext.Provider>
        </IsoSceneContext.Provider>
    );
};

export default IsoScene;
