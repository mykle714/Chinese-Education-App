import { useCallback, useMemo, useState, type ReactNode } from "react";
import { FooterVisibilityContext } from "../hooks/useHideFooter";

/**
 * Provider for the footer-suppression context. The context, the hooks, and the full
 * rationale live in src/hooks/useHideFooter.ts; only the component is here, so this
 * file stays a clean react-refresh boundary.
 *
 * Mounted once, in MobileDemoFrame, wrapping BOTH the routed pages (which take
 * suppression holds via useHideFooter) and FooterPresenter (which reads them).
 */
export function FooterVisibilityProvider({ children }: { children: ReactNode }) {
    const [holds, setHolds] = useState(0);

    const acquire = useCallback(() => {
        setHolds((n) => n + 1);
        // `released` guards against a double-release (e.g. React StrictMode running an
        // effect's cleanup twice) dropping the count below the real number of holds.
        let released = false;
        return () => {
            if (released) return;
            released = true;
            setHolds((n) => Math.max(0, n - 1));
        };
    }, []);

    const value = useMemo(() => ({ suppressed: holds > 0, acquire }), [holds, acquire]);

    return <FooterVisibilityContext.Provider value={value}>{children}</FooterVisibilityContext.Provider>;
}
