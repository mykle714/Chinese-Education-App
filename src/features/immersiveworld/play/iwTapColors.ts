/**
 * iwTapColors — the play surface's two feedback colours, in both forms the surface needs them
 * (a Pixi number for the canvas, a CSS string for the DOM around it).
 *
 * LAYER: feature constants. One module so the canvas and the DOM cannot drift apart: the blue
 * that outlines what a tap selected is, deliberately, the same blue as the Continue bar and the
 * ring around whoever you are addressing — "blue" on this surface means "this is the thing that
 * is live right now", whether it is a person, a table, a square of floor or the next line.
 *
 * Referenced by: src/features/immersiveworld/play/IWSceneStage.tsx,
 * src/features/immersiveworld/play/IWTapFeedback.tsx,
 * src/features/immersiveworld/play/IWComposer.tsx (the Continue bar);
 * docs/IMMERSIVE_WORLD.md § 5.3d, § 14 Q18.
 */

/** The selection blue — tap outlines, the empty-tile highlight, the addressee ring, Continue. */
export const IW_SELECT_BLUE_CSS = '#8FD6FF';
export const IW_SELECT_BLUE = 0x8fd6ff;

/**
 * The tap ripple — a pale, greyed yellow, deliberately NOT the selection blue. The ripple
 * says "your finger landed here" and fires on every tap, including one that selects nothing;
 * the blue says "and this is what it picked". Two meanings, two colours.
 */
export const IW_TAP_RIPPLE = 0xf2edd9;
