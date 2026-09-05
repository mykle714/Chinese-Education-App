import { GameSurfaceContext, gameSurfaceSx } from "./gameSurface";
import LeafPage, { type LeafPageProps } from "../../components/LeafPage";
import { RAMP, type RampHue } from "../../theme/colors";
import { useThemeColor } from "../../hooks/useThemeColor";

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
 *
 * It also claims the BROWSER CHROME for the same hue — Android Chrome's toolbar and
 * the Safari-tab status strip, both painted from `<meta name="theme-color">`, which no
 * CSS inside the tree can reach. Doing it here rather than in each game means the two
 * colours are read from ONE `hue` and cannot drift. See src/hooks/useThemeColor.ts.
 *
 * In the iOS HOME-SCREEN app the status bar is not that surface: it is page pixels, so
 * the accent ground below paints it directly (`viewport-fit=cover` +
 * `apple-mobile-web-app-status-bar-style: black-translucent`, src/theme/safeArea.ts).
 */
export const GameSurfaceProvider: React.FC<{ hue: RampHue; children: React.ReactNode }> = ({ hue, children }) => {
    useThemeColor(RAMP[hue].ink);
    return <GameSurfaceContext.Provider value={hue}>{children}</GameSurfaceContext.Provider>;
};

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
