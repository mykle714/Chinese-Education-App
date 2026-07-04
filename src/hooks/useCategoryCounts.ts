import { useState, useEffect } from "react";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../constants";

interface CategoryCountsResult {
    // Per-category library card counts, keyed by category label
    // (Unfamiliar / Target / Comfortable / Mastered).
    counts: Record<string, number>;
    // Whether the counts have finished loading. Consumers that gate behavior on a
    // minimum card total should fail open until this is true, so a slow fetch never
    // blocks a user who actually has plenty of cards.
    loaded: boolean;
}

/**
 * Fetches the user's per-category flashcard library counts from the OnDeck service.
 * Shared by the /decks page (navigation guard) and the Account page (display stats).
 */
export function useCategoryCounts(): CategoryCountsResult {
    const { token, isAuthenticated } = useAuth();
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!token) return;
        (async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/onDeck/category-counts`, {
                    credentials: "include",
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (response.ok) {
                    const data = await response.json();
                    setCounts(data && typeof data === "object" ? data : {});
                }
            } catch (err) {
                console.error("Error fetching category counts:", err);
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
