import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Box } from "@mui/material";
import { styled } from "@mui/material/styles";
import PageHeader from "../components/PageHeader";
import MobileFooter from "../components/MobileFooter";
import MiniVocabCardGrid from "../components/MiniVocabCardGrid";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../constants";
import type { VocabEntry } from "../types";
import { usePageTitle } from "../hooks/usePageTitle";

// Dedicated page for the user's full Mastered deck. Linked from /flashcards/decks,
// where the inline preview used to be. Kept separate because a mastered deck can be
// large (hundreds of cards on real accounts) and rendering it inline on /decks was a
// primary source of the mobile tap-latency lag. Phone-frame sizing comes from
// MobileDemoFrame via Layout.tsx (this route is registered in MOBILE_DEMO_PATHS).
const ContentArea = styled(Box)(() => ({
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
}));

const MasteredCardsPage: React.FC = () => {
    usePageTitle("Mastered Cards");
    const navigate = useNavigate();
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
        (entry: VocabEntry) => navigate(`/flashcards/card/${entry.id}`),
        [navigate]
    );

    return (
        <>
            {/* Back arrow returns to /decks (PageHeader defaults onBack to navigate(-1)). */}
            <PageHeader title="Mastered Cards" />

            <ContentArea className="mastered-cards-page-content">
                <MiniVocabCardGrid
                    containerClassName="mastered-cards-preview"
                    classPrefix="mastered-cards"
                    loading={loading}
                    error={error}
                    entries={entries}
                    emptyMessage="No mastered cards yet. Cards will appear here when you master them through study!"
                    onCardClick={handleCardClick}
                />
            </ContentArea>

            <MobileFooter activePage="home" />
        </>
    );
};

export default MasteredCardsPage;
