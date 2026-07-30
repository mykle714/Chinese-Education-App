/**
 * Layer translucency — how much a building's sub-layers ghost out as the camera zooms IN.
 *
 * LAYER: pure engine. A table + one pure function of (slot, zoom) → alpha. No React, no Pixi,
 * no assets, so both the view components ({@link ../../features/nightmarket/HouseStripSprites})
 * and any future stand renderer can depend on it.
 *
 * WHY. Zoomed out, a building reads as a silhouette and its shell should be solid. Zoomed in, the
 * player is inspecting the stall's contents, and an opaque roof/sign is exactly what is in the way.
 * So the OUTERMOST layers ghost first, peeling the building open from the top down as the camera
 * closes in, while the layers you actually came to look at (the merchant, the goods, the interior
 * back wall) stay fully opaque at every zoom.
 *
 * THE LAYER VOCABULARY IS {@link RenderSlot} — the set already used by
 * {@link ./nightMarketRegistry StandLayer.slot}. No parallel enum: a layered asset declares each
 * sub-image's slot once, and that single declaration drives BOTH its depth ordering
 * (`RENDER_SLOT_Z`) and its fade behaviour (this file). Slot order is back-to-front
 * (background → entity → foreground → overlay), so "outermost fades first" is simply
 * "later slots get lower thresholds".
 *
 * ⚠ THRESHOLDS ARE ABSOLUTE ZOOM VALUES, NOT MULTIPLES OF A SURFACE'S DEFAULT FRAMING. The two
 * camera hosts have different ladders — nmp ({@link ../../features/nightmarket/MarketEngineViewer})
 * runs 0.5–8 with a default of 1×; nms ({@link ../../features/nightmarket/TemplateSandboxViewer})
 * runs 1–10 with a default of 3×. A single absolute table therefore behaves DIFFERENTLY on the two
 * surfaces: on nmp the shell is solid at the default view and peels as you push in, whereas on nms
 * the default 3× view already sits at the `overlay` threshold, so signage starts partly ghosted.
 * That is a deliberate, accepted trade (one table, no per-surface bias constants to keep in sync) —
 * if the nms default view later wants a solid shell, raise its thresholds here rather than adding a
 * per-surface offset.
 *
 * Referenced by / referenced in:
 *   - src/features/nightmarket/HouseStripSprites.tsx (the only current consumer)
 *   - src/features/nightmarket/CameraZoomContext.tsx (supplies the live `zoom` argument)
 *   - docs/NIGHT_MARKET_FEATURE.md § "Layer translucency (zoom-peel)"
 */

import type { RenderSlot } from './nightMarketRegistry';

/** Fade curve for one render slot. */
export interface SlotFade {
  /** Zoom at which this slot STARTS ghosting. At or below it the layer is fully opaque. */
  fadeAt: number;
  /** Zoom span over which the ramp completes; at `fadeAt + window` the layer sits at `minAlpha`. */
  window: number;
  /** Residual alpha the layer settles at. >0 keeps the structure legible rather than deleting it. */
  minAlpha: number;
}

/**
 * Residual alpha shared by every fading slot: ghosted-but-legible. A fully transparent shell
 * (0) reads as a missing wall rather than a see-through one, and the isometric silhouette is
 * what makes the building recognisable at a glance.
 */
export const GHOST_ALPHA = 0.25;

/**
 * Per-slot fade table. `null` = this slot NEVER fades.
 *
 * - `overlay` (tall signs, floating effects) — the outermost thing between the camera and the
 *   stall, and the first to get in the way. Fades earliest.
 * - `foreground` (counters, ROOFS) — the shell proper. Fades one step later, so a zoom-in reads
 *   as "sign clears, then roof clears" rather than the whole building dissolving at once.
 * - `entity` (humans, merchants) and `background` (shadows, floor details, BACK walls) — the
 *   contents. Never fade: these are what peeling the shell is meant to reveal.
 */
export const SLOT_FADE: Record<RenderSlot, SlotFade | null> = {
  background: null,
  entity: null,
  foreground: { fadeAt: 4, window: 1, minAlpha: GHOST_ALPHA },
  overlay: { fadeAt: 3, window: 1, minAlpha: GHOST_ALPHA },
};

/**
 * Smoothstep easing on [0, 1] — eases in AND out, so the ramp has no visible corner at either
 * threshold end.
 *
 * This IS effectively a per-frame animation now: since the cameras went continuous
 * ({@link ../../hooks/useCameraControls} — zoom is any float while a gesture is live, and only
 * settles onto a ladder rung at rest) a pinch walks the ramp smoothly rather than stepping through
 * a handful of notches. The eased curve is what keeps a roof from appearing to "pop" as it clears.
 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Alpha for a layer in `slot` at camera `zoom`. Returns 1 for non-fading slots, for zooms at or
 * below the slot's threshold, and for any non-finite zoom (defensive: a camera host that has not
 * measured yet must not flash a ghosted building).
 */
export function alphaForSlot(slot: RenderSlot, zoom: number): number {
  const fade = SLOT_FADE[slot];
  if (!fade || !Number.isFinite(zoom)) return 1;
  if (zoom <= fade.fadeAt) return 1;
  // `window <= 0` degenerates to a hard snap at the threshold rather than dividing by zero.
  if (fade.window <= 0 || zoom >= fade.fadeAt + fade.window) return fade.minAlpha;
  const t = smoothstep((zoom - fade.fadeAt) / fade.window);
  return 1 + (fade.minAlpha - 1) * t;
}

/** True if any layer in `slot` is at all translucent at `zoom`. Handy for cheap render skips. */
export function isSlotGhosted(slot: RenderSlot, zoom: number): boolean {
  return alphaForSlot(slot, zoom) < 1;
}
