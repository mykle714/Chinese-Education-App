import { COLORS } from "./colors";
import { FONTS } from "./fonts";
import { WEIGHT } from "./scale";

/**
 * groundPaint — flat paint on the ground: the Deck Tower's "Tap to Start" look as HTML
 * (src/features/deckTower/TapToStartHint.tsx). White, with no plate, wall or shadow, so it
 * reads as painted straight on the sky. Buttons are not paint: they stay white with the app's
 * outline, so they are what stands up off the ground. Regular weight, unlike
 * the hint: a whole board of text in bold was too heavy. Run the colour through the surface's
 * wash (src/timeOfDay/wash.ts), as the tower does.
 *
 * Depended on by: games/shared/GameFrame.tsx (`tone="ground"`), games/match-speed/*.
 * Docs: docs/TOWER_STYLE_SHIFT.md § "Ground paint", docs/MATCH_SPEED_GAME.md § Rendering a card.
 */
export const GROUND_PAINT = COLORS.white;

/** The hint's typeface, in regular weight. */
export const GROUND_PRINT = { fontFamily: FONTS.cjk, fontWeight: WEIGHT.regular } as const;

/** Paint at its faintest: a track under a fill. Must stay readable as white on the sky. */
export const GROUND_PAINT_FAINT = "rgba(255, 255, 255, 0.3)";
