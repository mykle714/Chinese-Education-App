/**
 * bubbleDock — where a speech bubble is painted when its speaker leaves the screen.
 *
 * LAYER: view helper (pure). It takes this frame's geometry and returns this frame's
 * position; it owns no state, no DOM and no time, which is what makes the whole docking
 * behaviour testable without a canvas.
 *
 * ⚠️ **DOCKING IS A BLEND, NOT A SWITCH.** A bubble whose anchored rect is fully on screen is
 * drawn exactly over the head (`t = 0`) — the anchoring rule § 5.3a exists to protect. As the
 * speaker is panned/walked past an edge the rect starts to overhang, and the bubble slides
 * toward the top centre of the layer in proportion to HOW FAR it overhangs, reaching the dock
 * (`t = 1`) once the overhang passes {@link DOCK_RANGE_PX}. There is no frame at which the
 * bubble jumps: the overhang is a continuous function of the camera, so the position is too.
 *
 * ⚠️ …EXCEPT AT THE TOP, WHERE A CLAMP FINISHES THE JOB. See the note two paragraphs down.
 *
 * ⚠️ **THE TOP EDGE IS A HARD FLOOR ON TOP OF THE BLEND** (2026-09-09). Docking alone does
 * not keep a bubble on screen, because it moves in PROPORTION to the overhang: a speaker
 * standing high in the scene overhangs the top by a few dozen pixels, `t` comes out near
 * zero, and the bubble is left almost exactly where it was — with its top rows sliced off by
 * the layer's `overflow: hidden`. What gets sliced is the HEADER: the speaker's name and the
 * replay button sit above the speech, so the first thing lost is who is talking and the only
 * control on the bubble. See {@link bubbleTopFloor}.
 *
 * ⚠️ **THIS IS NOT THE EDGE CLAMP THAT WAS WITHDRAWN ON 2026-09-07**, and the difference is
 * the one that mattered. That clamp slid a bubble the minimum distance back inside the layer,
 * so it still LOOKED anchored while pointing at the wrong body — two speakers near one edge
 * got bubbles at the same nudged spot with nothing to say they had moved. Docking is the
 * opposite bargain: it takes the bubble somewhere it obviously does not belong (a fixed
 * ledge at the top of the screen, arrived at visibly, with each docked bubble in its own
 * slot), so the learner reads it as "this line is coming from off screen" rather than as an
 * attribution. Panning back brings it home continuously.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.3a.
 */

/** Gap kept between the docked ledge and the top/side edges of the bubble layer. */
export const DOCK_MARGIN_PX = 8;

/**
 * How far the anchored rect must overhang an edge before the bubble is fully docked. It is
 * the length of the blend, so it is also how much panning it takes to send a bubble away or
 * bring it back — short enough to feel like a consequence of the drag, long enough that a
 * bubble grazing the edge does not fly to the ledge.
 */
export const DOCK_RANGE_PX = 140;

/** Vertical gap between two bubbles that are docked at the same time. */
export const DOCK_STACK_GAP_PX = 6;

export interface BubbleDockInput {
  /** Where the bubble's BOTTOM CENTRE goes when it is anchored, in layer pixels. */
  anchor: { x: number; y: number };
  /** The bubble's own measured box. */
  size: { width: number; height: number };
  /** The bubble layer's box — the "screen" a bubble can go off the edge of. */
  layer: { width: number; height: number };
  /**
   * Height already claimed on the ledge by the bubbles docking above this one, gaps included.
   * Docked bubbles stack downward instead of piling on one another; without this, two
   * simultaneous off-screen speakers would be one unreadable bubble. It is measured rather
   * than assumed so a two-line bubble does not sit under a one-line one.
   */
  stackOffset: number;
}

/**
 * The bubble's TOP is never allowed above this, whatever the blend produced.
 *
 * ⚠️ **A VERTICAL CLAMP IS NOT THE LATERAL CLAMP THAT WAS WITHDRAWN**, and the asymmetry is
 * the whole reason this is safe. The withdrawn clamp moved a bubble SIDEWAYS, which is the
 * axis attribution lives on — nudging two bubbles in from one edge landed them on the same
 * spot over different speakers. This one moves a bubble DOWN and leaves `x` untouched, so it
 * still stands in the speaker's own column; all that changes is how much air is between the
 * line and the head, which says nothing about whose line it is.
 *
 * Expressed as a function of the bubble's own measured height because the bubble is painted
 * from its BOTTOM centre (`translate(-50%,-100%)`): "top at the margin" is "bottom at the
 * margin plus the height", and the height includes the header row.
 */
export function bubbleTopFloor(size: { height: number }): number {
  return DOCK_MARGIN_PX + size.height;
}

export interface BubbleDockResult {
  /** Bottom-centre position to paint at, in layer pixels. */
  x: number;
  y: number;
  /** 0 = fully anchored over the head, 1 = fully docked on the ledge. Drives styling too. */
  t: number;
}

/** Smoothstep, so the bubble eases off the head and onto the ledge rather than tracking linearly. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * How far, in pixels, the anchored bubble sticks out past the worst edge of the layer.
 * Zero while the whole bubble is on screen.
 */
export function bubbleOverhang(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  layer: { width: number; height: number },
): number {
  // The anchor is the bubble's bottom centre (the DOM layer applies translate(-50%,-100%)).
  const left = anchor.x - size.width / 2;
  const right = anchor.x + size.width / 2;
  const top = anchor.y - size.height;
  const bottom = anchor.y;
  return Math.max(
    0,
    DOCK_MARGIN_PX - top,
    DOCK_MARGIN_PX - left,
    right - (layer.width - DOCK_MARGIN_PX),
    bottom - (layer.height - DOCK_MARGIN_PX),
  );
}

export function bubbleDock({ anchor, size, layer, stackOffset }: BubbleDockInput): BubbleDockResult {
  // A layer that has not been measured yet (a first frame, or a hidden page) has no edges to
  // fall off, so the bubble stays exactly where the speaker is.
  if (layer.width <= 0 || layer.height <= 0) return { x: anchor.x, y: anchor.y, t: 0 };

  const overhang = bubbleOverhang(anchor, size, layer);
  const t = smoothstep(Math.min(1, overhang / DOCK_RANGE_PX));
  // No overhang at all means every edge already clears its margin, the top included, so
  // there is nothing for the floor below to catch.
  if (t === 0) return { x: anchor.x, y: anchor.y, t: 0 };

  const docked = {
    x: layer.width / 2,
    // Bottom-centre again: the slot's TOP is the margin plus everything stacked above it.
    y: DOCK_MARGIN_PX + stackOffset + size.height,
  };
  return {
    x: anchor.x + (docked.x - anchor.x) * t,
    // The floor is applied AFTER the blend, not folded into the anchor: partway through a
    // dock the blended y can still sit above the top edge (the blend is pulling the bubble
    // toward a ledge it has not reached yet), and it is the painted position that gets
    // clipped. Both terms are continuous in the camera and `max` of two continuous functions
    // is continuous, so this keeps the no-jump guarantee the docking blend exists for.
    y: Math.max(anchor.y + (docked.y - anchor.y) * t, bubbleTopFloor(size)),
    t,
  };
}
