/**
 * sceneContext.ts — hands the scene's projector to every iso component under an
 * IsoScene, so objects take world positions only and never a `proj` prop
 * (docs/ISO_ART_FRAMEWORK.md § "The scene").
 *
 * Kept out of IsoScene.tsx so that file exports only a component (react-refresh).
 */
import { createContext, useContext } from "react";
import type { Hinge, Projector } from "./geometry";
import { ISO } from "./palette";
import { NO_WASH, type IsoPalette, type IsoWash } from "./wash";

export const IsoSceneContext = createContext<Projector | null>(null);

/** The enclosing IsoScene's projector. Throws outside one — an iso object needs a scene. */
export function useIsoProjector(): Projector {
    const proj = useContext(IsoSceneContext);
    if (!proj) throw new Error("Iso components must be rendered inside an <IsoScene>.");
    return proj;
}

/**
 * The open trap door a platform's DECALS are printed on, or null while it is shut.
 * IsoPlatform provides it around its `decals`, which it draws inside one
 * `hingedPlaneTransform` — exact for flat prints only. A decal with HEIGHT (IsoFloorLabel's
 * raised plate) reads it to undo that transform and draw itself in true 3-D on the door.
 */
export const IsoDeckHingeContext = createContext<Hinge | null>(null);

/**
 * The scene's palette: `ISO` under the scene's ambient wash (IsoScene `wash`, wash.ts).
 * Every object reads its colour constants through `useIsoPalette()` rather than `ISO`,
 * so a time-of-day light reaches all of them. Outside a washed scene it is plain `ISO`.
 */
export const IsoPaletteContext = createContext<IsoPalette>(ISO);

export function useIsoPalette(): IsoPalette {
    return useContext(IsoPaletteContext);
}

/**
 * The scene's ambient wash itself, for a component that passes its OWN colours (a deck's
 * band, a world's platform) down to objects: it washes them with this first. Outside a
 * washed scene it is the identity.
 */
export const IsoWashContext = createContext<IsoWash>(NO_WASH);

export function useIsoWash(): IsoWash {
    return useContext(IsoWashContext);
}
