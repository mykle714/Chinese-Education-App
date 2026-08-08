import { useCallback, useEffect, useRef, useState } from 'react';
import { Assets, Graphics, Rectangle, Texture } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
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
 *
 * TAPPABLE (nmp only): when `onPedTap` is supplied the sprites become hit-testable and a tap locks
 * the camera onto that walker — see docs/NIGHT_MARKET_FEATURE.md § "Pedestrian camera lock". The
 * locked ped gets a ground ring so the selection is legible while the camera is chasing it. Without
 * the callback (any other surface) the sprites stay `eventMode="none"` and cost nothing.
 */

/**
 * Pointer slop, in screen px, that still counts as a tap rather than a pan. Pixi emits
 * `pointertap` for a down/up pair on the same sprite however far the pointer travelled between
 * them, so a drag that happens to start and end on the same walker would otherwise read as a tap.
 */
const TAP_SLOP_PX = 8;

/**
 * Padding (in sprite-local px) around a ped's texture bounds for hit-testing. The farm-pack
 * characters are ~16×32 source px, which at the 1× camera rung is a punishingly small finger
 * target — this grows the tap area without touching what is drawn.
 */
const PED_HIT_PAD_PX = 6;

// Selection ring — a warm translucent ellipse at the locked ped's feet. Sized to sit inside a
// 32×16 tile diamond so it reads as standing ON the tile, not covering it.
const RING_RADIUS_X = 9;
const RING_RADIUS_Y = 4.5;
const RING_LIFT_PX = 2; // nudge up off the exact foot point so the sprite's feet sit inside it
const RING_COLOR = 0xffe1a3; // lantern-warm, matching the night market palette

export interface PedestrianLayerProps {
  drawables: PedestrianDrawable[];
  /**
   * Tap handler. Supplying it makes every ped hit-testable; omit it to keep the layer inert.
   * Called with the tapped ped's id, only for genuine taps (see {@link TAP_SLOP_PX}).
   */
  onPedTap?: (id: string) => void;
  /** Id of the ped the camera is currently locked onto — gets the ground ring. */
  lockedPedId?: string | null;
}

export default function PedestrianLayer({ drawables, onPedTap, lockedPedId }: PedestrianLayerProps) {
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

  // Padded hit rectangles, one per preloaded frame. Built once with the textures rather than per
  // frame, since every ped re-renders 60×/sec and the boxes never change.
  // A foot-anchored sprite's local origin IS its anchor point, so its texture occupies
  // x ∈ [−w/2, w/2] and y ∈ [−h, 0]; the pad grows that box on all four sides.
  const hitAreas = useRef(new Map<string, Rectangle>()).current;
  if (textures) {
    for (const [path, tex] of textures) {
      if (hitAreas.has(path)) continue;
      const w = tex.width;
      const h = tex.height;
      hitAreas.set(
        path,
        new Rectangle(-w / 2 - PED_HIT_PAD_PX, -h - PED_HIT_PAD_PX, w + PED_HIT_PAD_PX * 2, h + PED_HIT_PAD_PX * 2),
      );
    }
  }

  // Where the pointer went down, so `pointertap` can reject a drag that merely started and ended on
  // the same walker. One shared ref: only one pointer can be pressing a given ped at a time.
  const pointerDown = useRef({ x: 0, y: 0 }).current;
  const handlePointerDown = useCallback((e: FederatedPointerEvent) => {
    pointerDown.x = e.global.x;
    pointerDown.y = e.global.y;
  }, [pointerDown]);

  // Selection ring, drawn in the graphics' OWN local space and positioned via x/y, so this callback
  // stays identity-stable and Pixi never re-runs the path while the ped walks.
  const drawRing = useCallback((g: Graphics) => {
    g.clear();
    g.ellipse(0, -RING_LIFT_PX, RING_RADIUS_X, RING_RADIUS_Y);
    g.fill({ color: RING_COLOR, alpha: 0.22 });
    g.stroke({ color: RING_COLOR, width: 1, alpha: 0.75 });
  }, []);

  if (!textures) return null;

  const lockedDrawable = lockedPedId ? drawables.find((d) => d.id === lockedPedId) : undefined;
  const lockedFoot = lockedDrawable ? isoToScreen(lockedDrawable.isoX, lockedDrawable.isoY) : null;

  return (
    <>
      {/* Ground ring under the locked ped. One z-step below the ped itself so the walker always
          stands on top of its own marker. */}
      {lockedDrawable && lockedFoot && (
        <pixiGraphics
          draw={drawRing}
          x={lockedFoot.screenX}
          y={lockedFoot.screenY}
          zIndex={computePedestrianZ(lockedDrawable.isoX, lockedDrawable.isoY) - 1}
          eventMode="none"
        />
      )}
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
            eventMode={onPedTap ? 'static' : 'none'}
            cursor={onPedTap ? 'pointer' : undefined}
            hitArea={onPedTap ? hitAreas.get(d.imagePath) : undefined}
            onPointerDown={onPedTap ? handlePointerDown : undefined}
            onPointerTap={
              onPedTap
                ? (e: FederatedPointerEvent) => {
                    const moved = Math.hypot(e.global.x - pointerDown.x, e.global.y - pointerDown.y);
                    if (moved <= TAP_SLOP_PX) onPedTap(d.id);
                  }
                : undefined
            }
          />
        );
      })}
    </>
  );
}
