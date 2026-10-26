import { dimetricView, type CameraView, type WorldRect } from "./iso";

/**
 * towerCamera.ts — the Deck Tower's study camera: the two ends of the dive from the
 * tower view onto the top card, and the blend between them (docs/DECK_TOWER.md
 * § "Studying the tower").
 *
 * Layer: page logic (feature module `src/features/deckTower`). Pure: no React, no DOM —
 * the page measures the flp card's slot and hands it in as a `StudyFrame`.
 *
 *   e = 0   the fixed dimetric view the page always draws (iso/camera.ts → `dimetricView`),
 *           so the dive starts on exactly the frame on screen — whatever the scroll.
 *   e = 1   straight down onto the tower's top face, HEAD-ON: the camera stands over the
 *           card's centre, so everything under the top card recedes toward that centre and
 *           hides behind it (no wall shows), while the larger platform still shows round
 *           it. The face fills `frame` exactly — the flp card laid over it then covers it
 *           to the pixel.
 *
 * Between them: yaw, pitch and the z foreshortening blend linearly, the scale
 * geometrically (it changes several-fold, and a linear blend would rush the start), the
 * perspective in by e² (none at the start, so the first frames stay the flat iso view),
 * and the target and its screen point linearly.
 *
 * Depended on by: useTowerStudy.ts. Depends on: iso/camera.ts.
 */

/** Where the top card's face must land at e = 1, in the scene's viewBox px. */
export interface StudyFrame {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * The camera's distance above the top face at e = 1, in world units (iso/camera.ts →
 * `perspective` = 1 / this). 14 units is a little under twice the platform's width: the
 * platform still reads as a platform from up there, but a tower dropping in from the sky
 * swells past the camera.
 */
export const STUDY_CAMERA_HEIGHT = 14;

/** The dive's ease (cubic in-out) — `e` as a function of the dive's 0 → 1 clock. */
export function easeDive(u: number): number {
    const t = Math.min(1, Math.max(0, u));
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The camera at dive position `e` (0 = the tower view, 1 = on the card), looking down onto
 * a top face at world height `topZ`.
 *
 * `bobY` is the platform's frozen bob (iso/levitation.ts → `frozenBobOffsetPx`): the whole
 * loaded platform is drawn shifted that far up the screen, so the e = 1 end aims that much
 * lower to land the face on `frame`. It plays no part at e = 0, where the shift is simply
 * part of the picture.
 */
export function studyCameraView(e: number, args: { unit: number; card: WorldRect; topZ: number; frame: StudyFrame; bobY: number }): CameraView {
    const { unit, card, topZ, frame, bobY } = args;
    const cx = card.x + card.w / 2;
    const cy = card.y + card.d / 2;
    const from = dimetricView(unit, { x: cx, y: cy, z: 0 });
    const toScale = frame.width / card.w;
    const to: CameraView = {
        yaw: 0,
        pitch: 0,
        zScale: 1,
        scale: toScale,
        perspective: 1 / STUDY_CAMERA_HEIGHT,
        target: { x: cx, y: cy, z: topZ },
        screen: { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 - bobY },
    };
    const t = Math.min(1, Math.max(0, e));
    return {
        yaw: lerp(from.yaw, to.yaw, t),
        pitch: lerp(from.pitch, to.pitch, t),
        zScale: lerp(from.zScale, to.zScale, t),
        scale: from.scale * Math.pow(to.scale / from.scale, t),
        perspective: to.perspective * t * t,
        target: {
            x: cx,
            y: cy,
            z: lerp(from.target.z, to.target.z, t),
        },
        screen: { x: lerp(from.screen.x, to.screen.x, t), y: lerp(from.screen.y, to.screen.y, t) },
    };
}
