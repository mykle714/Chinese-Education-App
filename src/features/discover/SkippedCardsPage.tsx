import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Button, Dialog, DialogTitle, DialogActions } from "@mui/material";
import NodePage from "../../components/NodePage";
import MiniVocabCardGrid from "../../components/MiniVocabCardGrid";
import { useAuth } from "../../AuthContext";
import { fetchSkippedCards, recycleSkips, sortCard } from "./starterPacksApi";
import type { Language, DiscoverCard, VocabEntry } from "../../types";
import { usePageTitle } from "../../hooks/usePageTitle";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";

// Skipped Cards page (docs/SORT_CARDS_REQUIREMENTS.md §7): a Mastered-style list of the
// words the user has skipped in Sort Cards. Reached from the Discover hub. Tapping a
// card opens an action popup (Cancel / Already Learned / Learn Now) that sorts it into
// the library (removing it from the skipped list). A header "Recycle all" button
// returns every skipped card to the sort supply at once.
//
// The skipped endpoint returns DiscoverCard[] (det-derived, not vet rows). VocabEntry
// only requires id + entryKey, so a DiscoverCard renders in MiniVocabCard as a plain
// card (no advanced layout / category chip).

const SkippedCardsPage: React.FC = () => {
    usePageTitle("Skipped Cards");
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();
    const { language } = useParams<{ language: Language }>();

    const [cards, setCards] = useState<DiscoverCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // The card whose action popup is open (null = closed).
    const [selected, setSelected] = useState<DiscoverCard | null>(null);

    useEffect(() => {
        const fetchSkipped = async () => {
            try {
                setLoading(true);
                setError(null);
                setCards(await fetchSkippedCards(language as Language));
            } catch (err: unknown) {
                console.error("Error fetching skipped cards:", err);
                setError(err instanceof Error ? err.message : "Failed to load skipped cards");
            } finally {
                setLoading(false);
            }
        };
        if (language && isAuthenticated) fetchSkipped();
    // isAuthenticated not `token`: a silent refresh must not re-fetch mid-scroll.
    // See CLAUDE.md "Never reload on token refresh". (The effect now satisfies the
    // exhaustive-deps rule on its own — the API client reads the token at call time.)
    }, [language, isAuthenticated]);

    // MiniVocabCardGrid takes VocabEntry[]; a DiscoverCard supplies id + entryKey +
    // definition + pronunciation, which is all the mini card needs. Referentially
    // stable per `cards` so the grid's incremental reveal doesn't thrash.
    const entries = useMemo(() => cards as unknown as VocabEntry[], [cards]);

    const handleCardClick = useCallback((entry: VocabEntry) => {
        const card = cards.find((c) => c.id === entry.id);
        if (card) setSelected(card);
    }, [cards]);

    // Sort the popped card into a bucket (legacy-shaped /sort with packId:null → the
    // service persists the vet row AND clears the discover_skips row). Then drop it
    // from the local list so the page stays truthful (§7).
    const handleSort = useCallback(async (bucket: "library" | "already-learned") => {
        const card = selected;
        setSelected(null);
        if (!card) return;
        setCards((prev) => prev.filter((c) => c.id !== card.id));
        try {
            await sortCard({ cardId: card.id, bucket, language: language as Language, packId: null });
        } catch (err) {
            console.error("Error sorting skipped card:", err);
        }
    }, [selected, language]);

    const handleRecycleAll = useCallback(async () => {
        setCards([]);
        try {
            await recycleSkips(language as Language);
        } catch (err) {
            console.error("Error recycling skips:", err);
        }
    }, [language]);

    return (
        <NodePage
            title="Skipped Cards"
            activePage="discover"
            onBack={() => navigate("/discover")}
            contentClassName="skipped-cards-page-content"
            contentSx={{ alignItems: "center" }}
        >
            {cards.length > 0 && (
                <Box className="skipped-cards__actions" sx={{ width: "100%", display: "flex", justifyContent: "flex-end", px: 2, pt: 1 }}>
                    <Button
                        className="skipped-cards__recycle-all"
                        variant="text"
                        size="small"
                        onClick={handleRecycleAll}
                        sx={{ fontSize: SIZE.micro, fontWeight: WEIGHT.bold, color: COLORS.hskChip, textTransform: "none" }}
                    >
                        Recycle all
                    </Button>
                </Box>
            )}

            <MiniVocabCardGrid
                containerClassName="skipped-cards-preview"
                classPrefix="skipped-cards"
                loading={loading}
                error={error}
                entries={entries}
                emptyMessage="No skipped cards. Words you skip in Sort Cards will appear here."
                onCardClick={handleCardClick}
            />

            {/* Tap-a-card action popup (§7): Cancel / Already Learned / Learn Now. */}
            <Dialog
                className="skipped-cards__popup"
                open={selected !== null}
                onClose={() => setSelected(null)}
            >
                <DialogTitle className="skipped-cards__popup-title" sx={{ fontSize: SIZE.body }}>
                    {selected?.entryKey}
                </DialogTitle>
                <DialogActions className="skipped-cards__popup-actions" sx={{ flexDirection: "column", alignItems: "stretch", gap: 1, px: 2, pb: 2 }}>
                    <Button className="skipped-cards__popup-learn-now" variant="contained" onClick={() => handleSort("library")}>
                        Mark as Learn Now
                    </Button>
                    <Button className="skipped-cards__popup-already-learned" variant="outlined" onClick={() => handleSort("already-learned")}>
                        Mark as Already Learned
                    </Button>
                    <Button className="skipped-cards__popup-cancel" variant="text" onClick={() => setSelected(null)}>
                        Cancel
                    </Button>
                </DialogActions>
            </Dialog>
        </NodePage>
    );
};

export default SkippedCardsPage;
