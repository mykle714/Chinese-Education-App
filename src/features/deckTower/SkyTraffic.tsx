import { memo, useLayoutEffect, useSyncExternalStore } from "react";
import {
    IsoCloud,
    IsoWind,
    sortCloudsBackToFront,
    useCloudDrifts,
    useWindGusts,
    type CloudSky,
    type Projector,
    type WindSky,
} from "./iso";
import type { SkyTrafficStore } from "./skyTrafficStore";

/**
 * SkyTraffic — the Deck Tower's clouds and wind, kept OUT of the page's render
 * (docs/DECK_TOWER.md § "The scene" → "Sky traffic").
 *
 * Why it exists: a gust starts every 1–4 s and a cloud every 4–14 s, and each start and end
 * is a React state change. Held in DeckTowerPage, every one re-rendered the whole page and
 * its scene (the platform, the stack, the pawn), which showed as a hitch every few seconds.
 *
 * The traffic is drawn in two places — the BEHIND layer (under the tower) and the FRONT
 * layer (over it), which DeckTowerPlatform slots into its draw order — but must come from
 * ONE scheduler, or the two halves would be two different skies. So:
 *   - `SkyTrafficSource` runs the schedulers (useCloudDrifts / useWindGusts) and renders
 *     nothing; it publishes the travellers into a small store.
 *   - `SkyTrafficLayer side=…` subscribes to that store and draws its side.
 * All three are memoised, so a crossing starting re-renders only the two layers, and a page
 * render re-renders none of them (their props are stable).
 *
 * Layer: page-private components (feature module `src/features/deckTower`).
 * Depends on: iso/useCloudDrifts.ts, iso/useWindGusts.ts, iso/IsoCloud.tsx, iso/IsoWind.tsx.
 * Depended on by: DeckTowerPage.tsx. Docs: docs/DECK_TOWER.md § "The scene".
 */

interface SkyTrafficSourceProps {
    store: SkyTrafficStore;
    /** Expected to be memoised (a new projector or sky restarts every slot). */
    proj: Projector;
    cloudSky: CloudSky;
    windSky: WindSky;
    cloudsActive: boolean;
    windActive: boolean;
    maxClouds: number;
    maxGusts: number;
}

/** Runs the schedulers and publishes their travellers; draws nothing. */
export const SkyTrafficSource = memo(function SkyTrafficSource({
    store,
    proj,
    cloudSky,
    windSky,
    cloudsActive,
    windActive,
    maxClouds,
    maxGusts,
}: SkyTrafficSourceProps) {
    const drifts = useCloudDrifts({ proj, active: cloudsActive, sky: cloudSky, maxInSky: maxClouds });
    const gusts = useWindGusts({ proj, active: windActive, sky: windSky, maxGusts });
    // A layout effect, so a crossing that starts is drawn in the same frame it is scheduled.
    useLayoutEffect(() => {
        store.set({ clouds: sortCloudsBackToFront(drifts), gusts });
    }, [store, drifts, gusts]);
    return null;
});

interface SkyTrafficLayerProps {
    store: SkyTrafficStore;
    side: "behind" | "front";
    /** The whole layer's opacity (the study dive fades the sky traffic out). */
    opacity: number;
}

/**
 * One side's clouds and wind. The wind blows ~50 cards above the clouds, so their order
 * among each other is free; behind the tower the wind is drawn over the clouds, in front
 * of it under them (as the page drew them before this was split out).
 */
export const SkyTrafficLayer = memo(function SkyTrafficLayer({ store, side, opacity }: SkyTrafficLayerProps) {
    const { clouds, gusts } = useSyncExternalStore(store.subscribe, store.get);
    const cloudEls = clouds.filter((c) => c.side === side).map((c) => <IsoCloud key={`cloud-${c.id}`} drift={c} />);
    const windEls = gusts.filter((g) => g.side === side).map((g) => <IsoWind key={`wind-${g.id}`} gust={g} />);
    return (
        <g className={`deck-tower-page__sky-${side}`} opacity={opacity < 1 ? opacity : undefined}>
            {side === "behind" ? cloudEls : windEls}
            {side === "behind" ? windEls : cloudEls}
        </g>
    );
});
