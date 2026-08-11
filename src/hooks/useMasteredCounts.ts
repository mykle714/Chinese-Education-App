import { useState, useEffect } from "react";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../constants";
import type { MasteryBarId } from "../utils/masteryCompute";

/**
 * How many cards the learner has mastered in EACH mastery bar (core / reading /
 * writing) — the figures on the fdp's up-to-three Mastered collection rows.
 * See docs/MASTERY_REWORK.md § "Three bars".
 *
 * Kept apart from `useCategoryCounts`, which answers a different question: that hook
 * returns the four BANDS of the core bar, this one returns the Mastered count of each
 * BAR. One endpoint each, so neither response has to be disambiguated by key name.
 *
 * All three counts are fetched regardless of the account's goals; the page decides
 * which rows to render. That way toggling a goal reveals a row that already has its
 * number rather than triggering a refetch.
 */
export function useMasteredCounts(): {
    counts: Record<MasteryBarId, number>;
    loaded: boolean;
} {
    const { token, isAuthenticated } = useAuth();
    const [counts, setCounts] = useState<Record<MasteryBarId, number>>({
        core: 0,
        reading: 0,
        writing: 0,
    });
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!token) return;
        (async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/onDeck/masteredCounts`, {
                    credentials: "include",
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data && typeof data === "object") {
                        setCounts({
                            core: Number(data.core) || 0,
                            reading: Number(data.reading) || 0,
                            writing: Number(data.writing) || 0,
                        });
                    }
                }
            } catch (err) {
                console.error("Error fetching mastered counts:", err);
            } finally {
                setLoaded(true);
            }
        })();
    // isAuthenticated not `token`: a silent refresh must not re-fetch counts.
    // See CLAUDE.md "Never reload on token refresh".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    return { counts, loaded };
}
