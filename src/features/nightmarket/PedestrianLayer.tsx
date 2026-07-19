import { useEffect, useState } from 'react';
import { Assets, Texture } from 'pixi.js';
import { isoToScreen, computePedestrianZ } from '../../engine/market/isometric';
import { PEDESTRIAN_SPRITE_PATHS } from '../../engine/market/tileRegistry';
import type { PedestrianDrawable } from '../../engine/market/pedestrianAgent';

/**
 * PedestrianLayer — renders the ambient pedestrians walking the recovered street graph
 * (docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md § "Pedestrian wiring", slice 2).
 *
 * LAYER: view. Deliberately PURE given `drawables`: it holds no simulation state. The FSM is
 * advanced by {@link ../../hooks/usePixiPedestrians} inside the scene's `useTick`, which then
 * passes this component the current-frame {@link PedestrianDrawable}s. Because the scene bumps
 * a frame counter each tick, this component re-renders every frame and reads fresh positions.
 *
 * `d.imagePath` already names the CURRENT walk-cycle frame (chosen by `computeDrawable` from
 * heading + progress), so this layer just looks the frame up in its preloaded texture cache
 * and emits one foot-anchored sprite per pedestrian, z-sorted by {@link computePedestrianZ}
 * so nearer walkers occlude farther ones and the terrain sorts around them.
 *
 * Sprites are emitted FLAT (direct children of the sortableChildren scene container) for a
 * single global z-sort with the terrain — same convention as the terrain layers.
 */
export default function PedestrianLayer({ drawables }: { drawables: PedestrianDrawable[] }) {
  // Preload every possible pedestrian frame once (idle + all directional walk frames) so any
  // `imagePath` a drawable reports resolves immediately. Nearest scaling keeps the pixel art
  // crisp under the integer camera zoom, matching the terrain/house layers.
  const [textures, setTextures] = useState<Map<string, Texture> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        PEDESTRIAN_SPRITE_PATHS.map(async (path) => {
          const tex = await Assets.load<Texture>(path);
          tex.source.scaleMode = 'nearest';
          return [path, tex] as const;
        }),
      );
      if (!cancelled) setTextures(new Map(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!textures) return null;

  return (
    <>
      {drawables.map((d) => {
        const texture = textures.get(d.imagePath);
        if (!texture) return null; // frame not in the preload set (shouldn't happen) — skip
        // Peds anchor at the southern (bottom) vertex of their current tile — same foot model
        // as the terrain sprites. d.isoX/d.isoY name the tile's SW corner.
        const { screenX, screenY } = isoToScreen(d.isoX, d.isoY);
        return (
          <pixiSprite
            key={d.id}
            texture={texture}
            x={screenX}
            y={screenY}
            scale={d.scale}
            anchor={{ x: 0.5, y: 1 }}
            zIndex={computePedestrianZ(d.isoX, d.isoY)}
            eventMode="none"
          />
        );
      })}
    </>
  );
}
