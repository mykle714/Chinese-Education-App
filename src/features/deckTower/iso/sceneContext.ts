/**
 * sceneContext.ts — hands the scene's projector to every iso component under an
 * IsoScene, so objects take world positions only and never a `proj` prop
 * (docs/ISO_ART_FRAMEWORK.md § "The scene").
 *
 * Kept out of IsoScene.tsx so that file exports only a component (react-refresh).
 */
import { createContext, useContext } from "react";
import type { Projector } from "./geometry";

export const IsoSceneContext = createContext<Projector | null>(null);

/** The enclosing IsoScene's projector. Throws outside one — an iso object needs a scene. */
export function useIsoProjector(): Projector {
    const proj = useContext(IsoSceneContext);
    if (!proj) throw new Error("Iso components must be rendered inside an <IsoScene>.");
    return proj;
}
