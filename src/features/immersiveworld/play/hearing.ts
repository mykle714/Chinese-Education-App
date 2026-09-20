import { cellKey, chebyshev, type SceneCell } from '../../../engine/iw/sceneGraph';
import { IW_TALK_RADIUS, type IWFacing, type IWVolume } from '../../../../server/contracts/iw';

/**
 * iw hearing — who can hear a line at a given volume (§ 4c).
 *
 * LAYER: feature (pure). No React, no clock, no model — but NOT `src/engine`, and the reason
 * is worth stating because the deleted version DID live there. This module reads `IWVolume`
 * and `IW_TALK_RADIUS` out of `server/contracts/iw`, because the volume is a wire field the
 * server renders into layer 3; the engine is forbidden to import anything outside itself
 * (`enginePurity.test.ts` enforces it) and would have to keep a second copy of the ladder to
 * stay there. So it sits beside `addressee.ts` instead, which is its true sibling anyway: both
 * are pure decisions about WHO, owned by the play surface, built on engine geometry.
 *
 * `useIWSceneRuntime` is the only caller; it uses this to bound BOTH the addressee candidates
 * (§ 4.2) and what each NPC remembers (§ 5.5's `heard`).
 *
 * ⚠️ **THIS FILE EXISTED BEFORE, WAS DELETED ON 2026-09-07, AND IS BACK THE SAME DAY —
 * SMALLER, AND DRIVEN BY THE LEARNER RATHER THAN BY THE ROOM.** The version § 4 withdrew
 * modelled earshot automatically: three radii, a line-of-sight walk, occluders counted along
 * it, a `busy`/`muffled` state nothing ever set. It was removed because it never gated
 * MEMORY, because its failures were invisible, and because a one-room stall has no distance
 * worth simulating.
 *
 * The rebuild keeps the finding and changes the mechanism. A volume is now something the
 * learner PICKS in the composer, so:
 *
 * - It gates memory too. `contextFor` filters each NPC's transcript by what that NPC could
 *   hear, which is what makes a whisper mean anything at all. A gate on replies alone is
 *   theatre: the NPC across the room still knew.
 * - Its failure is legible. "Nobody is close enough to hear a whisper" is a sentence about a
 *   control the learner just used, not about geometry they cannot see.
 * - **Occlusion is gone for good.** `cellsOnLine`, `countOccluders`, `OCCLUSION_PENALTY` and
 *   `MAX_OCCLUDERS` are not coming back. A learner cannot be told why a noodle stall counted
 *   as a wall, and a rule nobody can explain is a rule that reads as a bug.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 4c, § 4.2, § 9a.
 */

/** Which way each facing steps, in board coordinates. Mirrors `facesToward`'s quadrant test. */
const FACING_STEP: Record<IWFacing, readonly [number, number]> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

/**
 * The one cell a whisper reaches — directly in front of the speaker.
 *
 * ⚠️ **A CELL, NOT A RADIUS, AND THAT IS THE WHOLE DESIGN OF THE WHISPER.** "Within one tile"
 * would be eight cells and would quietly include the person standing behind you; this is the
 * square the avatar is looking at and nothing else. It makes the whisper the one volume with
 * a *physical* prerequisite — you have to have walked over and turned to face them — which is
 * exactly the act the game already uses to mean "I am talking to you" (§ 4.2's `focused`).
 */
export function whisperCell(from: SceneCell, facing: IWFacing): string {
  const [dc, dr] = FACING_STEP[facing];
  return cellKey(from.col + dc, from.row + dr);
}

/** One body's position, as much of it as hearing cares about. */
export interface HearingListener {
  id: string;
  cell: SceneCell;
}

/**
 * Can `listener` hear something said from `from` at `volume`?
 *
 * The three rules, and each is a sentence a learner could be told:
 *
 * | Volume | Reaches |
 * |---|---|
 * | `whisper` | the single cell the speaker is facing |
 * | `talk` | anybody within {@link IW_TALK_RADIUS} cells — how the scene behaved before volumes existed |
 * | `shout` | everybody in the scene, however far, however placed |
 */
export function hears(
  volume: IWVolume,
  from: SceneCell,
  facing: IWFacing,
  listener: SceneCell,
): boolean {
  if (volume === 'shout') return true;
  if (volume === 'whisper') return whisperCell(from, facing) === cellKey(listener.col, listener.row);
  return chebyshev(from, listener) <= IW_TALK_RADIUS;
}

/**
 * Everyone who can hear one line, in board order.
 *
 * Returns ids rather than bodies because both callers want a SET: the addressee router is
 * offered this list, and the transcript stores it beside the line so `contextFor` can decide,
 * turns later, whether a given NPC was there for it.
 */
export function audibleListeners(
  volume: IWVolume,
  from: SceneCell,
  facing: IWFacing,
  listeners: readonly HearingListener[],
): string[] {
  return listeners.filter(l => hears(volume, from, facing, l.cell)).map(l => l.id);
}
