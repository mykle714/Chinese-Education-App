import { COLORS } from "../../theme/colors";

/**
 * The boot cover's sky colour (main's day sky, from the colour framework), painted by the
 * main chunk while the cover's scene chunk loads (App.tsx → `renderBootCover`). It must equal
 * `launchLook().world.sky` (src/features/deckTower/launch/launchLook.ts) so nothing visibly
 * changes when the scene lands. Guarded by
 * src/features/deckTower/launch/__tests__/launchLook.test.ts.
 *
 * Layer: shared UI constant. Docs: docs/LOGIN_REWORK.md § 1, docs/LAUNCH_SCREEN.md § Colour.
 */
export const BOOT_COVER_GROUND = COLORS.bluMk;
