import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import NodePage from "../../components/NodePage";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import MiniVocabCardGrid from "../../components/MiniVocabCardGrid";
import { useAuth } from "../../AuthContext";
import { API_BASE_URL } from "../../constants";
import type { VocabEntry } from "../../types";
import { usePageTitle } from "../../hooks/usePageTitle";

// Dedicated page for the user's full Mastered deck. Linked from /flashcards/decks,
// where the inline preview used to be. Kept separate because a mastered deck can be
// large (hundreds of cards on real accounts) and rendering it inline on /decks was a
// primary source of the mobile tap-latency lag. Phone-frame sizing comes from
// MobileDemoFrame via Layout.tsx (this route is registered in MOBILE_DEMO_PATHS).
//
// This is a NODE PAGE (see docs/LEAF_NODE_PAGES.md): it keeps the footer and uses
// the LEFT back arrow + horizontal slide. NodePage (built on MobileTabScreen)
// supplies the scroll container, floating footer, and edge fade, so this page only
// owns data fetching + the card grid.
const MasteredCardsPage: React.FC = () => {
    usePageTitle("Mastered Cards");
    const navigate = useNavigate();
    // Card Detail (leaf) slides over this page; keep Mastered held beneath.
    const slideNavigate = useSlideNavigate();
    const { token } = useAuth();
    const [entries, setEntries] = useState<VocabEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Fetch the full mastered library deck from the OnDeck service.
    useEffect(() => {
        const fetchMasteredCards = async () => {
            try {
                setLoading(true);
                setError(null);

                const response = await fetch(`${API_BASE_URL}/api/onDeck/mastered-library-cards`, {
                    credentials: "include",
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (!response.ok) {
                    throw new Error("Failed to fetch mastered cards");
                }

                const data = await response.json();
                setEntries(Array.isArray(data) ? data : []);
            } catch (err: unknown) {
                console.error("Error fetching mastered cards:", err);
                setError(err instanceof Error ? err.message : "Failed to load mastered cards");
            } finally {
                setLoading(false);
            }
        };

        if (token) {
            fetchMasteredCards();
        }
    }, [token]);

    // Stable tap handler so the memoized cards don't all re-render on parent renders.
    const handleCardClick = useCallback(
        (entry: VocabEntry) => slideNavigate(`/flashcards/card/${entry.id}`),
        [slideNavigate]
    );

    return (
        // Back arrow slides right and returns to /decks (the previous history entry).
        <NodePage
            title="Mastered Cards"
            activePage="flashcards"
            onBack={() => navigate(-1)}
            contentClassName="mastered-cards-page-content"
            contentSx={{ alignItems: "center" }}
        >
            <MiniVocabCardGrid
                containerClassName="mastered-cards-preview"
                classPrefix="mastered-cards"
                loading={loading}
                error={error}
                entries={entries}
                emptyMessage="No mastered cards yet. Cards will appear here when you master them through study!"
                onCardClick={handleCardClick}
            />
        </NodePage>
    );
};

export default MasteredCardsPage;
