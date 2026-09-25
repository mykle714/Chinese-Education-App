import type { BoardFloor } from '../../engine/market/farmTerrain';

/**
 * The ground painted behind a WOOD board — the "void" around the deck. The Pixi canvas is
 * transparent (`backgroundAlpha={0}`), so the host element's own background IS this void.
 * A wood floor replaces the dirt slab and leaves the deck with no plateau body, so it needs a
 * dark ground to read as a lit platform rather than planks lying on the app's light paper.
 *
 * A warm charcoal rather than pure black: dark enough that the deck still reads as lit, light
 * enough that the page doesn't feel like a hole. Owned here so the editor and the play stage
 * cannot drift apart (they did once — see docs/IMMERSIVE_WORLD.md § "Wood mode paints the map
 * column dark").
 *
 * Used by: `IWSceneMapPanel` (editor), `play/IWSceneStage.tsx` (runtime).
 */
export const IW_WOOD_VOID_BG = '#48454F';

/** The host background for a board with the given floor: dark void for wood, page ground for dirt. */
export function iwBoardVoidBg(floorKind: BoardFloor['kind']): string {
  return floorKind === 'wood' ? IW_WOOD_VOID_BG : 'transparent';
}
