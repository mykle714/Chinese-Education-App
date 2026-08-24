import { GameSurfaceContext, gameSurfaceSx } from "./gameSurface";
import LeafPage, { type LeafPageProps } from "../../components/LeafPage";
import type { RampHue } from "../../theme/colors";

/**
 * The two COMPONENTS of the per-game accent surface (docs/SHELF_REDESIGN.md § A6b).
 * The mechanism itself — the context, the hook, `gameSurfaceSx` and its tokens — is in
 * the sibling `gameSurface.ts`; read that file's header first.
 */

/**
 * Declares "everything below me is on `hue`'s accent ground".
 *
 * Wrap the WHOLE page, not just the frame: the end-of-run popups and the paused
 * overlay are siblings of the panel, and they are on the accent ground too.
 */
export const GameSurfaceProvider: React.FC<{ hue: RampHue; children: React.ReactNode }> = ({ hue, children }) => (
    <GameSurfaceContext.Provider value={hue}>{children}</GameSurfaceContext.Provider>
);

/**
 * `LeafPage` for a GAME: the accent ground, the header-ink flips it forces, and the
 * context the panel's own parts read — all from one `hue`.
 *
 * Every game page uses this instead of `LeafPage` directly, so "this game is teal"
 * is stated once per page and cannot be stated inconsistently (a ground painted from
 * one hue with a HUD tinted from another would typecheck perfectly).
 *
 * Props are annotated directly rather than through `React.FC` because `LeafPageProps`
 * allows a RENDER-PROP `children` (the sideways-stage form Speed Reading needs) and
 * `React.FC` would silently narrow it back to `ReactNode`.
 */
export const GameLeafPage = ({ hue, ...leafProps }: LeafPageProps & { hue: RampHue }) => (
    <GameSurfaceProvider hue={hue}>
        <LeafPage {...leafProps} surfaceSx={gameSurfaceSx(hue)} />
    </GameSurfaceProvider>
);
