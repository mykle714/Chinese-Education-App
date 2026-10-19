import React from "react";
import type { Projector } from "./geometry";
import { IsoSceneContext } from "./sceneContext";

/**
 * IsoScene — the root of an iso drawing (docs/ISO_ART_FRAMEWORK.md § "The scene").
 *
 * One <svg> whose viewBox the caller fits to its content, plus the context that hands
 * `proj` to every iso component inside it. Objects are positioned in WORLD units only;
 * the projector turns them into screen px once, and the viewBox scales the result to
 * whatever box the scene is laid out in.
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
    children?: React.ReactNode;
}

const IsoScene: React.FC<IsoSceneProps> = ({ proj, viewBox, preserveAspectRatio = "xMidYMid meet", className, style, children }) => (
    <IsoSceneContext.Provider value={proj}>
        <svg className={className} viewBox={viewBox} preserveAspectRatio={preserveAspectRatio} style={style}>
            {children}
        </svg>
    </IsoSceneContext.Provider>
);

export default IsoScene;
