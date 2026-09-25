import { furnitureAt, type FurniturePlacement } from '../../../engine/market/furniture';
import { isBlockingDecorUrl } from '../../../engine/market/farmTerrain';
import { cellKey } from '../../../engine/iw/sceneGraph';
import type { IWTapTarget } from './tapTarget';

/**
 * tapHighlight — WHICH THING a tap lights up, and how the tap feedback fades over time.
 *
 * LAYER: feature helper, pure. The stage draws the answer (`IWTapFeedback.tsx`); nothing here
 * touches Pixi.
 *
 * ⚠️ **THIS IS A PRESENTATION QUESTION ON TOP OF `resolveTapTarget`, NOT A SECOND HIT TEST.**
 * `tapTarget.ts` decides what a tap SELECTS (body / place / cell) and the stage acts on exactly
 * that. This module only asks, of the cell that answer already landed on, "what is drawn
 * there?" — so the outline can never disagree with the action, which is the same promise the
 * hover indicator keeps (see `tapTarget.ts`'s header).
 *
 * **The rule, highest first:**
 * 1. A **body** target outlines that person.
 * 2. Otherwise, **furniture** whose footprint covers the cell outlines the whole piece — an
 *    author's table spans several cells and a tap on any of them means the table.
 * 3. Otherwise, a **blocking decor** sprite on the cell (a prop, a tree —
 *    `isBlockingDecorUrl`) outlines that sprite. FLUSH decor (grass tufts, dirt details) is
 *    ground, not an object, so a cell carrying only that counts as empty.
 * 4. Otherwise the cell is **empty floor**, and its diamond is highlighted instead.
 *
 * Places (`kind: 'place'`) fall through rules 2–4 like a cell: a place is a TAG on a cell, not a
 * sprite, so what gets outlined is whatever the author stood there — or the square itself when
 * the place is a spriteless spot on the floor.
 *
 * Referenced by: src/features/immersiveworld/play/IWSceneStage.tsx,
 * src/features/immersiveworld/play/IWTapFeedback.tsx; docs/IMMERSIVE_WORLD.md § 14 Q18.
 */

export type IWTapHighlight =
  | { kind: 'body'; id: string }
  | { kind: 'furniture'; placement: FurniturePlacement }
  | { kind: 'decor'; col: number; row: number; url: string }
  | { kind: 'cell'; col: number; row: number };

/** How long the ripple runs. Short: it acknowledges the touch, it is not a state. */
export const TAP_RIPPLE_MS = 600;
/** How long the blue highlight stays up — long enough to find it again after looking away. */
export const TAP_HIGHLIGHT_MS = 2000;
/** The tail of {@link TAP_HIGHLIGHT_MS} spent fading out, so it leaves rather than blinks off. */
const TAP_HIGHLIGHT_FADE_MS = 400;

/** Resolve a tap target to the thing its highlight should be drawn on. */
export function resolveTapHighlight(
  target: IWTapTarget,
  furniture: readonly FurniturePlacement[],
  decor: ReadonlyMap<string, string>,
): IWTapHighlight {
  if (target.kind === 'body') return { kind: 'body', id: target.id };

  const { col, row } = target;
  const piece = furnitureAt(furniture, col, row);
  if (piece) return { kind: 'furniture', placement: piece };

  const url = decor.get(cellKey(col, row));
  if (url && isBlockingDecorUrl(url)) return { kind: 'decor', col, row, url };

  return { kind: 'cell', col, row };
}

/** Highlight opacity `elapsedMs` after the tap: held at full, then a linear fade to 0. */
export function tapHighlightAlpha(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= TAP_HIGHLIGHT_MS) return 0;
  const fadeStart = TAP_HIGHLIGHT_MS - TAP_HIGHLIGHT_FADE_MS;
  return elapsedMs <= fadeStart ? 1 : 1 - (elapsedMs - fadeStart) / TAP_HIGHLIGHT_FADE_MS;
}

/** One ring of the ripple at an instant: its radius (screen px) and stroke. */
export interface RippleRing {
  radius: number;
  alpha: number;
  width: number;
}

/**
 * Two rings, the second a fainter echo trailing the first, like a sound wave's crest and echo.
 * Kept CALM on purpose (2026-09-24): low opacity, hairline strokes, a short travel and a gentle
 * ease — it acknowledges a touch, and anything louder competes with the blue highlight, which
 * is the part that actually carries information.
 */
const RIPPLE_RINGS = [
  { delayMs: 0, peakAlpha: 0.55 },
  { delayMs: 200, peakAlpha: 0.3 },
];
const RIPPLE_START_RADIUS_PX = 4;
const RIPPLE_END_RADIUS_PX = 22;

/**
 * The ripple's rings `elapsedMs` after the tap — empty once it has finished.
 *
 * In SCREEN pixels, not world pixels: a touch acknowledgement should be finger-sized at every
 * zoom, whereas the highlight belongs to the world and scales with it.
 */
export function tapRippleRings(elapsedMs: number): RippleRing[] {
  const rings: RippleRing[] = [];
  const ringLife = TAP_RIPPLE_MS - RIPPLE_RINGS[RIPPLE_RINGS.length - 1].delayMs;
  for (const { delayMs, peakAlpha } of RIPPLE_RINGS) {
    const t = (elapsedMs - delayMs) / ringLife;
    if (t < 0 || t >= 1) continue;
    // Sine ease-out: it drifts outward rather than bursting (a cubic ease threw most of the
    // travel into the first few frames, which read as a pop).
    const eased = Math.sin((t * Math.PI) / 2);
    rings.push({
      radius: RIPPLE_START_RADIUS_PX + (RIPPLE_END_RADIUS_PX - RIPPLE_START_RADIUS_PX) * eased,
      // Fades in over the first 15% instead of starting at full, then out — no hard onset.
      alpha: peakAlpha * Math.min(1, t / 0.15) * (1 - t),
      width: 1.5 - 0.75 * t,
    });
  }
  return rings;
}
