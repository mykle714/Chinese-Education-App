import { computePedestrianZ, isoToScreen, screenToCell } from '../../../engine/market/isometric';
import { cellKey } from '../../../engine/iw/sceneGraph';

/**
 * tapTarget — what a pointer is pointing AT (§ 14 Q18).
 *
 * LAYER: feature helper, pure. Deliberately NOT in `src/engine/iw/`: it is screen-space
 * arithmetic over the night market's isometric projection, and the iw engine modules are all
 * board-space. Deliberately not in the stage either — see below.
 *
 * ⚠️ **THE HOVER INDICATOR AND THE CLICK MUST NOT BE TWO ANSWERS.** An indicator that
 * highlights one cell while the click selects another is worse than no indicator at all: it
 * actively teaches the learner a wrong model of where their taps land. That is the whole
 * reason this is a pure function taking a point and returning a target, rather than a branch
 * inside a pointer handler — the stage calls it on `pointermove` to paint the highlight and on
 * `pointerup` to act, and there is no second implementation for the two to drift apart.
 *
 * ⚠️ **IT REPLACED PIXI'S PER-SPRITE HIT TEST, AND THAT WAS A BUG FIX, NOT A REFACTOR.** Each
 * body used to carry its own padded `hitArea` + `onPointerUp`. A body sprite is 48px tall and
 * foot-anchored, so its box reached 48px UP the screen — and up-screen is BACKWARD here,
 * because `screenY = -(isoX + isoY) · TILE_HEIGHT/2` puts a LARGER iso sum HIGHER on screen.
 * At `TILE_HEIGHT = 16` one step of `isoX + isoY` is **8** screen pixels, so a 48px box reaches
 * SIX cells back, not the three an earlier version of this comment claimed. Every tile, table
 * and counter standing behind a person was therefore inside that person's hit box, and tapping
 * one selected the person. The fix is the PRIORITY below plus {@link BODY_INK_HALF_WIDTH}, not
 * the removal of padding: the padding is Q18's near-miss tolerance and is load-bearing on a
 * phone.
 *
 * **The priority, highest first:**
 *
 * 1. **Whoever or whatever actually OCCUPIES the pointed-at cell.** An exact cell match is an
 *    unambiguous statement of intent and outranks any amount of sprite overlap.
 *    A body beats a place on the same cell — you talk to the person standing at the counter,
 *    not to the counter. In practice the collision is rare: § 3a makes a cell with blocking
 *    decor unwalkable, so nobody stands *on* a table.
 * 2. **A padded sprite box, but only over WALKABLE floor** — Q18's near-miss tolerance, for
 *    aiming at the body you can see rather than at the 16px diamond under its feet.
 *    Nearest-to-viewer wins when boxes overlap, matching what is drawn on top.
 *
 *    ⚠️ **THE WALKABILITY CONDITION IS THE WHOLE POINT OF RULE 2, NOT A DETAIL.** The learner
 *    is pointing at a pixel, and two things could be meant: the sprite drawn there, or the
 *    cell underneath. The tie-break is whether that cell is ITSELF a visible object. Under
 *    § 3a a cell is unwalkable exactly when it carries blocking decor — a table, a log, a
 *    counter — so unwalkable means "there is a thing here", and the learner meant the thing.
 *    Bare floor behind a character is not a thing anyone points at, so the character wins.
 *
 *    Without this, every table and log standing beside an NPC was swallowed by that NPC's
 *    box: the hover highlight jumped onto the person instead of appearing on the furniture,
 *    which is what made the bug visible. Note that `places` cannot cover this — it holds only
 *    places carrying an interaction script (`interactivePlaces`), and most furniture has none.
 *
 *    The accepted cost: an NPC standing directly in front of blocking decor cannot be selected
 *    by their head, only by their feet (rule 1) and by whatever part of them overhangs floor.
 *
 *    ⚠️ **AND THE BOX IS THE FIGURE, NOT THE FRAME** — see {@link BODY_INK_HALF_WIDTH}. A
 *    48×48 player frame is mostly transparent, so a rectangular box claimed floor the learner
 *    could plainly SEE, on both sides of the sprite and well above its head.
 * 3. **The tile itself** — walk there, or, when it is unwalkable, walk beside it, which
 *    `walkPlayerTo` already does over `approachCells`.
 *
 * Referenced by: src/features/immersiveworld/play/IWSceneStage.tsx;
 * docs/IMMERSIVE_WORLD.md § 14 Q18.
 */

/** One body, as this resolver needs it: where its feet are and how big its sprite is. */
export interface TapBody {
  id: string;
  isoX: number;
  isoY: number;
  /** Texture size in world pixels. Zero when the texture has not loaded — then box 2 is skipped. */
  spriteWidth: number;
  spriteHeight: number;
}

export type IWTapTarget =
  | { kind: 'body'; id: string; col: number; row: number }
  | { kind: 'place'; tag: string; col: number; row: number }
  | { kind: 'cell'; col: number; row: number };

export interface ResolveTapOptions {
  boardWidth: number;
  boardHeight: number;
  bodies: readonly TapBody[];
  places: readonly { tag: string; cell: string }[];
  /** The learner's own body. Never a target — you do not tap yourself. */
  playerId: string;
  /** How far outside a sprite still counts as aiming at it. */
  padPx: number;
  /**
   * `SceneGraph.walkable` — the § 3a walkable set, verbatim, so this shares one definition of
   * "there is a thing on this cell" with pathfinding rather than re-deriving it from decor.
   * See rule 2 in the header for why the near-miss box is conditioned on it.
   */
  walkable: ReadonlySet<string>;
}

/**
 * Resolve a point in BOARD-LOCAL pixels (pan and zoom already removed) to what it selects.
 *
 * Returns `null` when the point is off the board AND lands on no body — a body's head may
 * legitimately overhang the top edge, and it stays selectable there. The caller should treat
 * `null` as "no target" rather than as a miss to be corrected.
 */
export function resolveTapTarget(
  local: { x: number; y: number },
  o: ResolveTapOptions,
): IWTapTarget | null {
  const cell = screenToCell(local.x, local.y, o.boardWidth, o.boardHeight);
  const others = o.bodies.filter(b => b.id !== o.playerId);

  // A body standing on the BACK ROW draws its head off the top of the board — six rows of
  // overhang at 48px (see the header) — so most of the figure projects onto no cell at all.
  // Without this, the companion in "Get Dinner" (row 11 of 12) was selectable only by the
  // 16px diamond under his feet, and pointing anywhere at his body did nothing whatsoever:
  // no hover, no click, no feedback. Off the board is "no cell", not "no target".
  if (!cell) return nearestBodyHit(local, others, o.padPx);

  // ── 1. Exact occupancy ──────────────────────────────────────────────────────────────────
  // Rounded because a walking body sits between cells for most of a step; the cell it is
  // rendered closest to is the one the learner sees it standing on.
  const standingHere = others
    .filter(b => Math.round(b.isoX) === cell.col && Math.round(b.isoY) === cell.row)
    .sort(byNearestToViewer)[0];
  if (standingHere) return { kind: 'body', id: standingHere.id, ...cell };

  const key = cellKey(cell.col, cell.row);
  const place = o.places.find(p => p.cell === key);
  if (place) return { kind: 'place', tag: place.tag, ...cell };

  // ── 2. Padded sprite box (Q18's near-miss tolerance), over bare floor only ──────────────
  if (!o.walkable.has(key)) return { kind: 'cell', ...cell };

  // ── 3. The tile ─────────────────────────────────────────────────────────────────────────
  return nearestBodyHit(local, others, o.padPx) ?? { kind: 'cell', ...cell };
}

/**
 * The frontmost body whose figure the point lands on, or `null` if it lands on none.
 *
 * Nearest-to-viewer wins when figures overlap, matching what is drawn on top — the one thing
 * the learner can actually see.
 */
function nearestBodyHit(
  local: { x: number; y: number },
  bodies: readonly TapBody[],
  padPx: number,
): IWTapTarget | null {
  const hit = bodies
    // A body whose texture has not loaded has no figure to test against; it is still
    // selectable by rule 1, which needs no picture.
    .filter(b => b.spriteWidth > 0 && b.spriteHeight > 0 && withinSpriteInk(local, b, padPx))
    .sort(byNearestToViewer)[0];
  return hit ? { kind: 'body', id: hit.id, col: Math.round(hit.isoX), row: Math.round(hit.isoY) } : null;
}

/**
 * The figure's half-width at eight heights, bottom (feet) to top (crown), as a fraction of the
 * frame's width.
 *
 * ⚠️ **MEASURED FROM THE PACK'S OWN ALPHA, NOT GUESSED** — the same discipline
 * `freeFarmTileset`'s skirt constants use, and for the same reason: these are ART FACTS, and
 * re-cropping or replacing the player sprites means re-measuring them. The numbers are the
 * union over all 64 idle+walking frames of `src/assets/free-assets/free-farm-assets/Player/`,
 * so every direction and every step of the walk cycle is inside the profile.
 *
 * ⚠️ **WHY A PROFILE AND NOT A RECTANGLE.** A 48×48 frame holds a figure whose legs are only
 * ~22px across; the frame rectangle was nearly three times too wide down there. That matters
 * far more here than in a top-down game, because up-screen is BACKWARD: at the shoulders the
 * box is eating cells three rows behind the body, and at the crown, six. The concrete symptom
 * (2026-09-07) was that the seat ACROSS THE TABLE from the companion could not be tapped or
 * even hovered — it sits 32px to the side of him, inside a ±32px rectangle, but 21px outside
 * the figure that is actually drawn there. The learner could see the seat perfectly well and
 * point right at it, and the resolver answered "the companion".
 *
 * The taper is what preserves the OTHER half of Q18: a tap on a head still selects the person,
 * because the profile is generous where the head really is and narrow where it is not.
 *
 * Re-measure with:
 *   python3 -c "import glob;from PIL import Image;..."  # per-row alpha union over the frames
 */
const BODY_INK_HALF_WIDTH = [0.17, 0.23, 0.23, 0.34, 0.42, 0.42, 0.34, 0.11];

/**
 * Is the point inside this body's padded FIGURE?
 *
 * Anchored like the sprite (`anchor={{x:0.5,y:1}}`): `dy` runs from 0 at the foot to
 * `-spriteHeight` at the top of the frame. The height picks a band of
 * {@link BODY_INK_HALF_WIDTH}, and `padPx` — Q18's near-miss tolerance, load-bearing on a
 * phone — grows that band on every side.
 *
 * It must stay a function of what `IWSceneStage` DRAWS, because a hit shape that does not
 * match the picture is the same lie the hover indicator exists to prevent.
 */
function withinSpriteInk(local: { x: number; y: number }, body: TapBody, padPx: number): boolean {
  const foot = isoToScreen(body.isoX, body.isoY);
  const dx = local.x - foot.screenX;
  const dy = local.y - foot.screenY;
  if (dy > padPx || dy < -body.spriteHeight - padPx) return false;

  // Clamped rather than extended, so the pad below the feet and above the crown reuses the end
  // bands instead of running off the array.
  const height = Math.min(Math.max(-dy / body.spriteHeight, 0), 0.999);
  const band = BODY_INK_HALF_WIDTH[Math.floor(height * BODY_INK_HALF_WIDTH.length)];
  return Math.abs(dx) <= band * body.spriteWidth + padPx;
}

/**
 * Sort comparator: the body drawn ON TOP comes first.
 *
 * Reuses the renderer's own depth function rather than re-deriving one, so "the one I can see"
 * and "the one I hit" are decided by the same number.
 */
function byNearestToViewer(a: TapBody, b: TapBody): number {
  return computePedestrianZ(b.isoX, b.isoY) - computePedestrianZ(a.isoX, a.isoY);
}
