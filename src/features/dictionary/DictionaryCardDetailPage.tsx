import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Alert, Snackbar, IconButton } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import { apiGet } from "../../api/http";
import { addToLibrary } from "../../utils/vocabApi";
import type { DictionaryEntry, VocabEntry, Language } from "../../types";
import { useAuth } from "../../AuthContext";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useTTS } from "../../hooks/useTTS";
import { COLORS } from "../../theme/colors";
import { CardFaceSide, ChineseBlock, EnglishBlock } from "../../features/flashcards/FlashcardsLearnPage/FlashCardSection";
import { CARD_BASE_WIDTH, CARD_BASE_HEIGHT } from "../../features/flashcards/constants";
import { dictionaryEntryToVocabEntry } from "../../utils/dictEntryAdapter";
import { resolveSelectedSenseIndex } from "../../utils/definitionUtils";
import { VocabCardBadges, VocabCardSections } from "../../features/flashcards/VocabCardDetailBody";
import WordToolsRail from "../../components/WordToolsRail";

// READ-ONLY dictionary card detail (cdp) — the page a dictionary result opens into
// (instead of the eip popup). It's a NODE page (keeps the footer; see
// docs/LEAF_NODE_PAGES.md) reached from the Dictionary node, so the Home tab stays
// active. Keyed by :word (not a vet id) because a searched word usually isn't one
// of the user's saved cards — it fetches the det row via /api/dictionary/lookup and
// adapts it to the VocabEntry shape the card sections consume.
//
// Read-only means: NO edit toolbar / delete, and the hero always renders the det's
// representative icon in BASIC layout (never the advanced iconLayout editor). The
// only write affordance is "+ to Learn Now" for discoverable entries (the word-tools
// rail's Practice Writing drill records no mark here — there is no vet row to mark).
//
// Drill-ins: breakdown/used-in rows and example-sentence segments open the cdp of
// the tapped word — the same drill-in the eip offers, except it navigates here
// instead of opening a nested eip tab. This recursion keeps every linked page
// read-only.

const DictionaryCardDetailPage: React.FC = () => {
    usePageTitle("Dictionary");
    const { word } = useParams<{ word: string }>();
    const navigate = useNavigate();
    const slideNavigate = useSlideNavigate();
    const { user } = useAuth();
    const { settings } = useFlashcardLearnSettings();
    const { showPinyinColor } = settings;
    // cdp always shows pinyin regardless of the flp pinyin toggle — pinyin is
    // core reference info on the detail page, so we ignore settings.showPinyin here.
    const showPinyin = true;
    const tts = useTTS();

    const [entry, setEntry] = useState<VocabEntry | null>(null);
    // No narration on landing — same rule as the saved-card cdp (VocabCardDetailPage):
    // a detail page is read, not played at. The hero card's speaker button is the only
    // way a word is spoken here.
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Which definitionClusters sense EnglishBlock shows on the hero card.
    const [selectedSenseIndex, setSelectedSenseIndex] = useState(0);

    const userLanguage = (user?.selectedLanguage || 'zh') as Language;

    useEffect(() => {
        if (!word) return;
        let cancelled = false;
        const fetchEntry = async () => {
            try {
                setLoading(true);
                setError(null);
                setSelectedSenseIndex(0);
                const dictData = await apiGet<DictionaryEntry>(
                    `/api/dictionary/lookup/${encodeURIComponent(word)}`
                );
                if (cancelled) return;
                const adapted = dictionaryEntryToVocabEntry(dictData);
                setEntry(adapted);
                // Seed the hero card from the requester's SAVED pick for this word when the
                // lookup carried one (they have it as a flashcard) - so the dictionary page and
                // their card agree. Falls back to the default/starred sense otherwise. The
                // picker here stays local-only: this page has no vet row to write when the word
                // is not in their library. See docs/DEFINITION_CLUSTERS.md.
                setSelectedSenseIndex(resolveSelectedSenseIndex(adapted));
            } catch (err: unknown) {
                if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load word");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        fetchEntry();
        return () => { cancelled = true; };
        // Keyed on `word` only. This effect used to list `token`, so every ~15-minute
        // silent refresh re-ran it — refetching the entry AND resetting
        // selectedSenseIndex to 0, discarding the sense the reader had picked.
        // See CLAUDE.md "Never reload on token refresh".
    }, [word]);

    // Drill-in: open the cdp of a linked word (breakdown/used-in/example segment).
    // Same slide as the Dictionary → cdp navigation (node-in-from-right).
    const handleWordOpen = useCallback((target: string) => {
        slideNavigate(`/dictionary/card/${encodeURIComponent(target)}`);
    }, [slideNavigate]);

    // "+ to Learn Now" — the only write action on this read-only page. Mirrors the
    // former dictionary-eip header button; shown only for discoverable entries.
    const [addToLibSnack, setAddToLibSnack] = useState<string | null>(null);
    const handleAddToLibrary = useCallback(async () => {
        if (!entry) return;
        try {
            const data = await addToLibrary(entry.entryKey, userLanguage);
            setAddToLibSnack(data.status === 'already-in-library' ? 'Already in Learn Now' : 'Added to Learn Now');
        } catch (err) {
            console.error('Failed to add to library:', err);
            setAddToLibSnack('Failed to add to Learn Now');
        }
        // No `token` dep: addToLibrary reads the header at call time.
    }, [entry, userLanguage]);

    return (
        <NodePage
            title="Card Detail"
            onBack={() => navigate(-1)}
            // Matches the vet Card Detail page, which the design draws at 18px — the
            // two are the same surface and must not disagree on their title size.
            headerSize="dense"
            surfaceColor={COLORS.yellowAccent}
            // No top edge-fade: the hero card shouldn't dissolve at the top.
            topFade={false}
            headerExtraActions={entry?.discoverable ? (
                <IconButton
                    className="dictionary-card-detail__add-to-library-button"
                    aria-label="Add to Learn Now"
                    onClick={handleAddToLibrary}
                >
                    <AddIcon />
                </IconButton>
            ) : undefined}
        >
            <Box
                className="dictionary-card-detail__content"
                sx={{ display: "flex", flexDirection: "column", padding: "16px", gap: "12px" }}
            >
                {loading ? (
                    <Box className="dictionary-card-detail__loading" sx={{ display: "flex", justifyContent: "center", pt: 6 }}>
                        <DelayedCircularProgress />
                    </Box>
                ) : error ? (
                    <Alert className="dictionary-card-detail__error-alert" severity="error">{error}</Alert>
                ) : entry ? (
                    <>
                        <VocabCardBadges entry={entry} />

                        {/* WORD TOOLS — `Write it`, on its own rail above the card and
                            outside its boundary; the sole Practice Writing entry point for
                            this page now that the on-card button is gone (see
                            docs/PRACTICE_WRITING.md). `onCompare` is omitted because this
                            read-only page has nowhere to load a comparison into, so the
                            rail self-hides the Compare pill — and hides itself entirely for
                            a non-zh / >4-character word, which has no writing drill. The
                            adapted det entry has no vet row, so the rail passes no
                            vocabEntryId and the drill records no writing mark. */}
                        <WordToolsRail
                            className="dictionary-card-detail__word-tools"
                            entry={entry}
                        />

                        {/* Hero card — read-only: always the det's representative icon in
                            BASIC layout (iconLayout/textLayout null, advanced off). */}
                        <Box
                            className="dictionary-card-detail__hero-card"
                            sx={{
                                aspectRatio: `${CARD_BASE_WIDTH} / ${CARD_BASE_HEIGHT}`,
                                width: "100%",
                                maxWidth: CARD_BASE_WIDTH,
                                mx: "auto",
                                mt: "16px",
                                mb: "40px",
                                position: "relative",
                            }}
                        >
                            <CardFaceSide
                                rotated={false}
                                contentGap={2}
                                contentClassName="dictionary-card-detail__side-two"
                                iconId={entry.iconId}
                                showIcon
                                iconLayout={null}
                                textLayout={null}
                                isUsingAdvancedLayout={false}
                                cardColor={null}
                                textBlocks={{
                                    foreign: (
                                        <ChineseBlock
                                            entry={entry}
                                            showPinyin={showPinyin}
                                            showPinyinColor={showPinyinColor}
                                            onSpeak={tts.speak}
                                            speakingKey={tts.speakingKey}
                                            inlineActions
                                            selectedSenseIndex={selectedSenseIndex}
                                        />
                                    ),
                                    english: (
                                        <EnglishBlock
                                            entry={entry}
                                            selectedSenseIndex={selectedSenseIndex}
                                            onSelectSense={setSelectedSenseIndex}
                                        />
                                    ),
                                }}
                            />
                        </Box>

                        {/* Info boxes — breakdown/used-in rows + example segments drill into
                            the cdp of the tapped word via handleWordOpen. */}
                        <VocabCardSections
                            entry={entry}
                            showPinyin={showPinyin}
                            showPinyinColor={showPinyinColor}
                            // Keeps the Definition box's long definition on the same sense
                            // as the picker above (per-sense longDefinition).
                            selectedSenseIndex={selectedSenseIndex}
                            onWordOpen={handleWordOpen}
                            onSpeakSentence={tts.speakSentence}
                            speakingKey={tts.speakingKey}
                        />

                        <FooterSpacer />
                    </>
                ) : null}
            </Box>

            <Snackbar
                className="dictionary-card-detail__add-to-library-snackbar"
                open={addToLibSnack !== null}
                autoHideDuration={2500}
                onClose={() => setAddToLibSnack(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert
                    severity={addToLibSnack === 'Failed to add to Learn Now' ? 'error' : 'success'}
                    variant="filled"
                    onClose={() => setAddToLibSnack(null)}
                >
                    {addToLibSnack}
                </Alert>
            </Snackbar>
        </NodePage>
    );
};

export default DictionaryCardDetailPage;
