import { useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Box } from "@mui/material";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../AuthContext";
import { BootCoverContext, type BootCoverRenderProps, type BootPhase, type BootSceneRenderProps } from "../../hooks/useBootCover";
import { useHideFooter } from "../../hooks/useHideFooter";

/**
 * The boot cover's provider, slot and route-mounted signal. The gate's rules and rationale
 * live in src/hooks/useBootCover.ts; only components are here (react-refresh boundary).
 *
 * Layer: shared UI (app shell). Mounted by App.tsx (provider, inside AuthProvider and the
 * router) and Layout.tsx (the slot, in BOTH shells).
 * Docs: docs/LOGIN_REWORK.md § 1, docs/LAUNCH_SCREEN.md.
 */

/** Above the frame's footer pill (FooterPresenter, z 100) and every page's own layers. */
const BOOT_COVER_Z = 200;

interface BootCoverProviderProps {
    children: ReactNode;
    /** The cover to draw (App.tsx passes the Deck Tower's LaunchScreen). */
    renderCover: (props: BootCoverRenderProps) => ReactNode;
    /** The launch scene at rest, for the login screen (App.tsx passes BootSceneStill). */
    renderScene: (props: BootSceneRenderProps) => ReactNode;
}

export function BootCoverProvider({ children, renderCover, renderScene }: BootCoverProviderProps) {
    const { isLoading } = useAuth();
    const { pathname } = useLocation();
    // Every cold start begins covered (owner, 2026-11-13: "every cold start", deep links too).
    const [phase, setPhase] = useState<BootPhase>("covering");
    const [holds, setHolds] = useState(0);
    const [mountedPath, setMountedPath] = useState<string | null>(null);

    // A count, not a boolean, for the same reason as useHideFooter: a page swapping in can
    // acquire before the old one's cleanup runs.
    const acquireHold = useCallback(() => {
        setHolds((n) => n + 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            setHolds((n) => Math.max(0, n - 1));
        };
    }, []);
    const markRouteMounted = useCallback((path: string) => setMountedPath(path), []);
    const open = useCallback(() => setPhase((p) => (p === "covering" ? "opening" : p)), []);
    const done = useCallback(() => setPhase("done"), []);

    const ready = !isLoading && mountedPath === pathname && holds === 0;

    const value = useMemo(
        () => ({ phase, ready, acquireHold, markRouteMounted, open, done, renderCover, renderScene }),
        [phase, ready, acquireHold, markRouteMounted, open, done, renderCover, renderScene],
    );
    return <BootCoverContext.Provider value={value}>{children}</BootCoverContext.Provider>;
}

/**
 * Rendered as a sibling of every route's page INSIDE its Suspense boundary (App.tsx →
 * `renderRoute`), so it commits only once the page's lazy chunk has loaded. Renders nothing.
 */
export function BootRouteMounted() {
    const { markRouteMounted, phase } = useContext(BootCoverContext);
    const { pathname } = useLocation();
    useLayoutEffect(() => {
        if (phase === "done") return;
        markRouteMounted(pathname);
    }, [pathname, phase, markRouteMounted]);
    return null;
}

interface BootCoverSlotProps {
    /**
     * `frame`: inside MobileDemoFrame (the phone card on desktop), filling it.
     * `window`: the plain shell, filling the window.
     */
    placement: "frame" | "window";
}

/**
 * Where the cover is drawn. Layout mounts one in each shell. A launch that moves between
 * shells while covered (only a signed-out deep link into a plain-shell page, redirected to
 * the frame's `/login`) remounts the cover and restarts its drop: accepted, it is rare.
 */
export function BootCoverSlot({ placement }: BootCoverSlotProps) {
    const { phase, ready, open, done, renderCover } = useContext(BootCoverContext);
    const up = phase !== "done";
    // The footer pill stays away under the cover and slides in once it has gone. A no-op in
    // the plain shell (no FooterVisibilityProvider there).
    useHideFooter(up);
    if (!up) return null;
    return (
        <Box
            className="boot-cover-slot"
            sx={{ position: placement === "frame" ? "absolute" : "fixed", inset: 0, zIndex: BOOT_COVER_Z }}
        >
            {renderCover({ ready, onOpen: open, onDone: done })}
        </Box>
    );
}
