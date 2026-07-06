import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Box, TextField, InputAdornment, IconButton } from "@mui/material";
import { Search, Clear } from "@mui/icons-material";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import MiniVocabCardGrid from "../../components/MiniVocabCardGrid";
import { useAuth } from "../../AuthContext";
import { API_BASE_URL } from "../../constants";
import type { VocabEntry } from "../../types";
import { filterVocabEntries } from "../../utils/vocabSearch";
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
    const { token, isAuthenticated } = useAuth();
    const [entries, setEntries] = useState<VocabEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Client-side search over the loaded deck. Supports the same query formats as
    // the dictionary search bars (CJK / numbered pinyin / toneless pinyin / English)
    // via filterVocabEntries — no network round trip since the deck is in memory.
    const [searchInput, setSearchInput] = useState("");

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
    // Keyed on isAuthenticated — the stable auth-presence flag, not the `token`
    // string — so a silent refresh doesn't re-fetch mid-scroll. See CLAUDE.md
    // "Never reload on token refresh".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    // Stable tap handler so the memoized cards don't all re-render on parent renders.
    const handleCardClick = useCallback(
        (entry: VocabEntry) => slideNavigate(`/flashcards/card/${entry.id}`),
        [slideNavigate]
    );

    // Apply the search filter. Referentially stable while the query and deck are
    // unchanged, so MiniVocabCardGrid's reveal cascade isn't restarted each render.
    const filteredEntries = useMemo(
        () => filterVocabEntries(entries, searchInput),
        [entries, searchInput]
    );
    const isSearching = searchInput.trim().length > 0;

    return (
        // Back arrow slides right and returns to /decks (the previous history entry).
        <NodePage
            title="Mastered Cards"
            activePage="flashcards"
            onBack={() => navigate(-1)}
            contentClassName="mastered-cards-page-content"
            contentSx={{ alignItems: "center" }}
        >
            {/* Client-side search over the loaded deck. Sized to the 364px card grid
                so the input lines up over the cards below it. */}
            <Box className="mastered-cards-search" sx={{ width: 364, maxWidth: "100%", px: 3.5, pt: 1 }}>
                <TextField
                    className="mastered-cards-search__input"
                    fullWidth
                    size="small"
                    placeholder="Search mastered cards..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <Search />
                            </InputAdornment>
                        ),
                        endAdornment: searchInput && (
                            <InputAdornment position="end">
                                <IconButton
                                    aria-label="clear search"
                                    onClick={() => setSearchInput("")}
                                    edge="end"
                                    size="small"
                                >
                                    <Clear />
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />
            </Box>

            <MiniVocabCardGrid
                containerClassName="mastered-cards-preview"
                classPrefix="mastered-cards"
                loading={loading}
                error={error}
                entries={filteredEntries}
                emptyMessage={
                    isSearching
                        ? "No mastered cards match your search."
                        : "No mastered cards yet. Cards will appear here when you master them through study!"
                }
                onCardClick={handleCardClick}
            />
            <FooterSpacer />
        </NodePage>
    );
};

export default MasteredCardsPage;
