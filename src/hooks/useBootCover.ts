import { createContext, useContext, useLayoutEffect, type ReactNode, type Ref } from "react";

/**
 * THE BOOT COVER GATE — the app-opening animation's shared state (docs/LOGIN_REWORK.md § 1,
 * docs/LAUNCH_SCREEN.md).
 *
 * The cover (the pawn drop + circle, `src/features/deckTower/launch/LaunchScreen.tsx`) plays
 * on EVERY cold start (owner, 2026-11-13), BEFORE auth has resolved. It is mounted by the app
 * shell (`BootCoverSlot` in Layout), not by a page, so it can open onto whichever route the
 * launch resolves to underneath: td when signed in, `/login` when not.
 *
 * It opens once ALL of these hold (`BootCoverProvider` → `ready`):
 *   1. auth has settled (`useAuth().isLoading` is false);
 *   2. the CURRENT path's page has mounted (`BootRouteMounted`, rendered inside every route's
 *      Suspense, so it only commits once the lazy chunk has loaded). Keyed on the pathname so a
 *      redirect (`/` → `/login`, `/login` → `/`) cannot open the cover onto the blank frame of
 *      the destination's still-loading chunk using the previous route's signal;
 *   3. no page holds it (`useHoldBootCover`): td holds it until its weather and deck counts
 *      are in, so the circle never reveals the sky jumping colour.
 * LaunchScreen adds its own floor (one full drop) and ceiling (MAX_WAIT_MS), unchanged.
 *
 * The context + hooks live HERE, in a plain .ts module; the provider and the slot live in
 * src/components/bootCover/BootCover.tsx (the react-refresh split, as useHideFooter does).
 *
 * LAYER: shared UI state. No feature knowledge: the cover itself is handed in by the
 * composition root (App.tsx → `renderCover`), because it is drawn with the Deck Tower's iso kit
 * and `src/components/` may not import a feature (docs/FRONTEND_LAYERING.md).
 * Depended on by: src/components/bootCover/BootCover.tsx, src/App.tsx (`BootRouteMounted` via
 * the component file), src/features/deckTower/DeckTowerPage.tsx (`useBootCover`,
 * `useHoldBootCover`).
 */

/** `covering`: closed, before the exit. `opening`: the circle is growing. `done`: gone for this launch. */
export type BootPhase = "covering" | "opening" | "done";

/** What the cover component receives (the timing contract LaunchScreen already implements). */
export interface BootCoverRenderProps {
    /** The route underneath is ready to be seen. */
    ready: boolean;
    /** The exit is starting: the page underneath becomes visible. */
    onOpen: () => void;
    /** The exit has finished: unmount the cover. */
    onDone: () => void;
}

export interface BootCoverValue {
    phase: BootPhase;
    /** Gates 1–3 above, combined. */
    ready: boolean;
    /** Take a hold on the cover; call the returned function to release it (idempotent). */
    acquireHold: () => () => void;
    /** The page for `pathname` has committed (its lazy chunk loaded). */
    markRouteMounted: (pathname: string) => void;
    /** Phase transitions, called by the slot's cover. */
    open: () => void;
    done: () => void;
    /** The cover itself, from the composition root. */
    renderCover: (props: BootCoverRenderProps) => ReactNode;
    /**
     * The launch scene at rest (platform + pawn), for the login screen that continues the
     * launch sky (docs/LOGIN_REWORK.md Q12). From the composition root, like `renderCover`.
     */
    renderScene: (props: BootSceneRenderProps) => ReactNode;
}

/**
 * The launch scene at rest, laid out exactly as the cover leaves it: a full-box layer with the
 * pawn's feet at the same spot on screen (LaunchScreen.tsx → FEET_AT_SCREEN_Y), and `children`
 * placed in the region ABOVE the scene (the top of the box down to just over the pawn's head).
 * The region does not scroll; a caller that needs scrolling puts its own scroller in it.
 */
export interface BootSceneRenderProps {
    className?: string;
    children: ReactNode;
    /**
     * A zero-size marker at the centre of the platform's floor (where the pawn stands), for the
     * login screen's exit circle (src/pages/LoginPage.tsx). Stays null while the scene's chunk
     * is still loading (no scene drawn yet), so a caller must cope with that.
     */
    platformCentreRef?: Ref<HTMLDivElement>;
}

export const BootCoverContext = createContext<BootCoverValue>({
    // Outside the provider (tests, isolated mounts) there is no cover: everything is a no-op.
    phase: "done",
    ready: true,
    acquireHold: () => () => {},
    markRouteMounted: () => {},
    open: () => {},
    done: () => {},
    renderCover: () => null,
    renderScene: ({ children }) => children,
});

/**
 * Whether the boot cover is up. `up` covers the whole exit (hold your events until it is
 * false); `covering` is true only until the exit starts (snap anything the circle would
 * otherwise reveal mid-change).
 */
export function useBootCover(): { up: boolean; covering: boolean } {
    const { phase } = useContext(BootCoverContext);
    return { up: phase !== "done", covering: phase === "covering" };
}

/**
 * Keep the cover closed while `hold` is true. Ignored once the cover has started to open:
 * a page that mounts later (navigation, not the launch) can never bring it back.
 *
 * A LAYOUT effect, so a page's first hold is registered in the same commit as its
 * `BootRouteMounted` signal, before the provider can see "mounted, no holds" and open.
 */
export function useHoldBootCover(hold: boolean): void {
    const { phase, acquireHold } = useContext(BootCoverContext);
    const active = hold && phase === "covering";
    useLayoutEffect(() => {
        if (!active) return;
        return acquireHold();
    }, [active, acquireHold]);
}

/** The launch scene at rest, as a render function (outside the provider: just the children). */
export function useBootScene(): (props: BootSceneRenderProps) => ReactNode {
    return useContext(BootCoverContext).renderScene;
}
