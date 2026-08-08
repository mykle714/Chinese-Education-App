import { useState, useEffect } from "react";
import { useAuth } from "../AuthContext";
import { fetchVelocity, type VelocityResponse } from "../api/velocity";

interface VelocityResult {
    /** Band-steps climbed in the last 7 days for the account's selected language. */
    velocity: number;
    /** Window length in days, from the server (7) — so copy never hard-codes it. */
    windowDays: number;
    /** Per-language breakdown; languages with zero promotions are absent. */
    byLanguage: Record<string, number>;
    /** False until the first fetch settles, so the caller can reserve space. */
    loaded: boolean;
}

/**
 * Fetches the account's velocity — how many utcm band-steps were climbed in the
 * sliding 7-day window (docs/VELOCITY.md). Used by the Account page.
 *
 * Re-fetches when the SELECTED LANGUAGE changes (the headline number is
 * per-language), never on a token refresh — see CLAUDE.md "Never reload on token
 * refresh"; fetchVelocity resolves its own auth header at call time.
 */
export function useVelocity(): VelocityResult {
    const { isAuthenticated, user } = useAuth();
    const selectedLanguage = user?.selectedLanguage;
    const [data, setData] = useState<VelocityResponse | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!isAuthenticated) return;
        // Guards against a late response from a previous language overwriting a
        // newer one after a language switch.
        let cancelled = false;
        (async () => {
            try {
                const result = await fetchVelocity(selectedLanguage);
                if (!cancelled) setData(result);
            } catch (err) {
                console.error("Error fetching velocity:", err);
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isAuthenticated, selectedLanguage]);

    return {
        velocity: data?.velocity ?? 0,
        windowDays: data?.windowDays ?? 7,
        byLanguage: data?.byLanguage ?? {},
        loaded,
    };
}
