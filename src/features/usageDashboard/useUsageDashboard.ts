import { useEffect, useState } from "react";
import { useAuth } from "../../AuthContext";
import { fetchUsageDashboard, type UsageDashboard, type UsageWindowDays } from "../../api/usage";

/**
 * Loads the User Usage dashboard for one window (docs/USAGE_DASHBOARD.md).
 *
 * Keyed on `user?.id` + `isAdmin` + the window — NEVER on `token` (CLAUDE.md: a silent
 * token refresh must not reload a page). Does nothing for a non-admin, so the tester
 * dashboard never fires a request that is guaranteed to 403.
 *
 * The previous window's data stays on screen while the next one loads (`loading` is
 * true alongside the old `data`), so flipping the window switch dims rather than
 * collapses the section.
 */
export function useUsageDashboard(windowDays: UsageWindowDays) {
    const { user } = useAuth();
    const userId = user?.id;
    const isAdmin = !!user?.isAdmin;

    const [data, setData] = useState<UsageDashboard | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!userId || !isAdmin) return;
        // A slower response for a window the user has already switched away from must
        // not overwrite the newer one.
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetchUsageDashboard(windowDays)
            .then((next) => { if (!cancelled) setData(next); })
            .catch((err: unknown) => {
                if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load usage");
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [userId, isAdmin, windowDays]);

    return { data, loading, error };
}
