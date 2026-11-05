/**
 * Memory Map's break-viewport estimate (docs/MEMORY_MAP_GAME.md § 2.4b).
 *
 * LAYER: client game logic, pure apart from reading the DOM's frame size.
 *
 * A map is packed for the FRAME it was first generated on (width ÷ height of that game
 * viewport, stored server-side, `users."memoryMapFrameAspect"`). The camera fits the
 * whole map to whatever screen it is opened on. A frame-mismatch check
 * (`isFrameMismatch`) that offered to regenerate the map for a very different screen
 * lived here until 2026-11-04; it went with the standalone route (Memory Map is
 * break-only now), along with `POST /api/memoryMap/regenerate`.
 *
 * Referenced by: src/games/flpBreak/memoryMapBreak.ts (`estimateBreakViewportAspect`);
 * docs/MEMORY_MAP_GAME.md.
 */

/**
 * Height of the chrome an flp break stacks above the map, px: the exit row's clearance
 * plus the one-row prompt bar (8px padding top and bottom around a 32px finder/Skip).
 * Only `estimateBreakViewportAspect` uses it, and only to a tolerance far looser than
 * a pixel.
 */
const BREAK_PROMPT_BAR_PX = 48;

/**
 * The game viewport an flp break is ABOUT to have, width ÷ height, before any of it is
 * mounted — for the break's prefetch (`MEMORY_MAP_BREAK.prefetch`), which loads the map
 * before the Stage exists and so cannot measure the real panel.
 *
 * A break's map panel is the app's whole screen (GameFrame drops its inset there) minus
 * the exit row and the prompt bar. The app's screen is the mobile demo frame on desktop
 * and the window on a phone. It only matters for a learner whose FIRST framed load is a
 * break (the server ignores the aspect once a frame is stored), so a rough estimate is
 * all that needs. Null when there is nothing to measure (no window).
 */
export function estimateBreakViewportAspect(exitClearancePx: number): number | null {
    if (typeof window === "undefined") return null;
    const shell = document.querySelector(".mobile-demo-frame");
    const rect = shell?.getBoundingClientRect();
    const width = rect && rect.width > 0 ? rect.width : window.innerWidth;
    const height = (rect && rect.height > 0 ? rect.height : window.innerHeight) - exitClearancePx - BREAK_PROMPT_BAR_PX;
    return width > 0 && height > 0 ? width / height : null;
}
