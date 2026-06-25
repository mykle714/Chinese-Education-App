import { useState, useEffect } from "react";
import { stripParentheses } from "../utils/definitionUtils";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Typography, Chip, Button, Alert, Divider } from "@mui/material";
import DelayedCircularProgress from "../components/DelayedCircularProgress";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { styled } from "@mui/material/styles";
import LeafPage from "../components/LeafPage";
import { API_BASE_URL } from "../constants";
import type { VocabEntry, DictionaryEntry } from "../types";
import ForeignText from "../components/ForeignText";
import PosBadge from "../components/PosBadge";
import SegmentedSentenceDisplay from "../components/SegmentedSentenceDisplay";
import PracticeWritingButton from "../components/handwriting/PracticeWritingButton";
import { clearWritingDraft } from "../components/handwriting/writingDraftStore";
import { getBreakdownItems } from "../utils/breakdownUtils";
import { usePageTitle } from "../hooks/usePageTitle";
import { getCategoryColor } from "../utils/categoryColors";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT, LEADING, TRACKING } from "../theme/scale";

// Phone-frame sizing comes from MobileDemoFrame via Layout.tsx
const ContentArea = styled(Box)(() => ({
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    padding: "16px",
    gap: "12px",
}));

// The giant "card" hero section
const HeroCard = styled(Box)(() => ({
    backgroundColor: COLORS.card,
    borderRadius: "16px",
    boxShadow: "2px 6px 12px rgba(0, 0, 0, 0.18)",
    padding: "24px 20px 20px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
}));

// Action bar pinned to the bottom of the leaf page. Card Detail is a LEAF PAGE
// (see docs/LEAF_NODE_PAGES.md): no footer, so the action bar is the page's
// bottom edge with no extra footer-clearance reservation.
const ActionBar = styled(Box)(() => ({
    display: 'flex',
    gap: '12px',
    padding: '12px 16px',
    backgroundColor: COLORS.background,
    borderTop: `1px solid rgba(92,92,102, 0.2)`,
    flexShrink: 0,
}));

// Info section card
const SectionCard = styled(Box)(() => ({
    backgroundColor: COLORS.infoCard,
    borderRadius: "12px",
    boxShadow: "1px 3px 6px rgba(0, 0, 0, 0.1)",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
}));

const SectionLabel = styled(Typography)(() => ({
    fontSize: SIZE.micro,
    fontWeight: WEIGHT.bold,
    color: COLORS.textSecondary,
    letterSpacing: TRACKING.caps,
    textTransform: "uppercase",
    fontFamily: FONTS.sans,
}));

// Category color mapping lives in src/utils/categoryColors (shared with
// MiniVocabCard and the flashcard-learn back-of-card chip).

const VocabCardDetailPage: React.FC = () => {
    usePageTitle("Card");
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [entry, setEntry] = useState<VocabEntry | null>(null);
    const [dictEntry, setDictEntry] = useState<DictionaryEntry | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => {
        const fetchEntry = async () => {
            try {
                setLoading(true);
                const response = await fetch(`${API_BASE_URL}/api/vocabEntries/${id}`, {
                    credentials: "include",
                });
                if (!response.ok) {
                    throw new Error("Failed to fetch card");
                }
                const data = await response.json();
                setEntry(data);
                const dictRes = await fetch(`${API_BASE_URL}/api/dictionary/lookup/${encodeURIComponent(data.entryKey)}`, {
                    credentials: "include",
                });
                if (dictRes.ok) {
                    const dictData = await dictRes.json();
                    setDictEntry(dictData);
                }
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "Failed to load card");
            } finally {
                setLoading(false);
            }
        };

        if (id) fetchEntry();
    }, [id]);

    // Hard-clear the preserved writing-practice draft when leaving the cdp.
    // (docs/HANDWRITING_RECOGNITION.md "Canvas / state lifecycle")
    useEffect(() => {
        return () => clearWritingDraft();
    }, []);

    // Hard-deletes the VocabEntry and returns to the decks page
    const handleDelete = async () => {
        if (!entry) return;
        try {
            setActionLoading(true);
            const response = await fetch(`${API_BASE_URL}/api/vocabEntries/${entry.id}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!response.ok) throw new Error('Failed to delete card');
            navigate('/flashcards/decks', { state: { refresh: Date.now() } });
        } catch (err) {
            console.error('Error deleting card:', err);
            setActionLoading(false);
        }
    };

    const hasShortDef = !!dictEntry?.shortDefinition;
    const isSingleChar = !!entry && [...entry.entryKey].length === 1;
    // For single-char zh, the breakdown section is replaced by a "Used In" list. See OnDeckVocabService.enrichWithUsedIn.
    const hasUsedIn = isSingleChar && !!entry?.usedIn && entry.usedIn.length > 0;
    const hasBreakdown = !isSingleChar && entry?.breakdown && Object.keys(entry.breakdown).length > 0;
    const hasSynonyms = entry?.synonyms && entry.synonyms.length > 0;
    const hasExamples = entry?.exampleSentences && entry.exampleSentences.length > 0;
    const hasRelatedWords = entry?.relatedWords && entry.relatedWords.length > 0;
    const hasExpansion = !!entry?.expansion;

    return (
        // Card Detail is a LEAF PAGE: no footer, DOWN back arrow (returns to the
        // previous screen), slides up on enter / down on exit.
        <LeafPage title="Card Detail" onBack={() => navigate(-1)}>
                <ContentArea className="vocab-card-detail__content">
                    {loading ? (
                        <Box className="vocab-card-detail__loading" sx={{ display: "flex", justifyContent: "center", pt: 6 }}>
                            <DelayedCircularProgress className="vocab-card-detail__spinner" />
                        </Box>
                    ) : error ? (
                        <Alert className="vocab-card-detail__error-alert" severity="error">{error}</Alert>
                    ) : entry ? (
                        <>
                            {/* Hero Card */}
                            <HeroCard className="vocab-card-detail__hero-card">
                                {/* Category + HSK badges row */}
                                <Box className="vocab-card-detail__badges-row" sx={{ display: "flex", justifyContent: "space-between", width: "100%", mb: 1 }}>
                                    {entry.category ? (
                                        <Chip
                                            className="vocab-card-detail__category-chip"
                                            label={entry.category}
                                            size="small"
                                            sx={{
                                                backgroundColor: getCategoryColor(entry.category),
                                                color: "white",
                                                fontSize: SIZE.micro,
                                                fontWeight: WEIGHT.bold,
                                                height: 22,
                                            }}
                                        />
                                    ) : <Box className="vocab-card-detail__badge-placeholder" />}
                                    {/* HSK chip: only for zh, whose 1–6 difficulty integers ARE HSK
                                        levels; es uses the same scale but it is not an HSK label. */}
                                    {entry.language === 'zh' && entry.difficulty && (
                                        <Chip
                                            className="vocab-card-detail__hsk-chip"
                                            label={`HSK${entry.difficulty}`}
                                            size="small"
                                            sx={{
                                                backgroundColor: COLORS.hskChip,
                                                color: "white",
                                                fontSize: SIZE.micro,
                                                fontWeight: WEIGHT.bold,
                                                height: 22,
                                            }}
                                        />
                                    )}
                                </Box>

                                {/* Main word */}
                                <Typography
                                    className="vocab-card-detail__main-word"
                                    sx={{
                                        fontSize: entry.entryKey.length > 4 ? "3rem" : "4rem",
                                        fontWeight: WEIGHT.bold,
                                        color: COLORS.onSurface,
                                        lineHeight: LEADING.none,
                                        textAlign: "center",
                                        fontFamily: FONTS.serif,
                                    }}
                                >
                                    {entry.entryKey}
                                    {/* "(v)"/"(n)" badge for Spanish words with multiple discoverable POS */}
                                    <PosBadge pos={entry.pos} hasMultiplePos={entry.hasMultiplePos} />
                                </Typography>

                                {/* Pronunciation */}
                                {entry.pronunciation && (
                                    <Typography
                                        className="vocab-card-detail__pronunciation"
                                        sx={{
                                            fontSize: SIZE.bodyLg,
                                            color: COLORS.textSecondary,
                                            fontStyle: "italic",
                                            textAlign: "center",
                                            fontFamily: FONTS.sans,
                                        }}
                                    >
                                        {entry.pronunciation}
                                    </Typography>
                                )}

                                <Divider className="vocab-card-detail__hero-divider" sx={{ width: "60%", borderColor: COLORS.textSecondary, opacity: 0.3, my: 0.5 }} />

                                {/* Definition */}
                                <Typography
                                    className="vocab-card-detail__definition"
                                    sx={{
                                        fontSize: SIZE.bodyLg,
                                        color: COLORS.onSurface,
                                        textAlign: "center",
                                        fontFamily: FONTS.sans,
                                        lineHeight: LEADING.normal,
                                    }}
                                >
                                    {stripParentheses(entry.definition ?? '')}
                                </Typography>

                                {/* Writing practice entry point (Chinese only — renders null otherwise) */}
                                <Box sx={{ mt: 1.5 }}>
                                    <PracticeWritingButton character={entry.entryKey} language={entry.language} />
                                </Box>
                            </HeroCard>

                            {/* Dictionary Definition */}
                            {hasShortDef && (
                                <SectionCard className="vocab-card-detail__dict-definition">
                                    <SectionLabel>Dictionary Definition</SectionLabel>
                                    <Typography sx={{ fontSize: SIZE.bodyLg, fontWeight: WEIGHT.semibold, color: COLORS.onSurface, fontFamily: FONTS.sans }}>
                                        {stripParentheses(dictEntry!.shortDefinition!)}
                                    </Typography>
                                </SectionCard>
                            )}

                            {/* Used In (single-char zh only) — replaces Character Breakdown for single-character entries */}
                            {hasUsedIn && (
                                <SectionCard className="vocab-card-detail__used-in">
                                    <SectionLabel className="vocab-card-detail__section-label">Used In</SectionLabel>
                                    <Box className="vocab-card-detail__used-in-list" sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                        {entry!.usedIn!.map((item) => (
                                            <Box
                                                className="vocab-card-detail__used-in-item"
                                                key={`${item.vocabEntryId ?? 'det'}-${item.entryKey}`}
                                                sx={{
                                                    display: "flex",
                                                    alignItems: "flex-start",
                                                    gap: "12px",
                                                    backgroundColor: COLORS.sectionCard,
                                                    borderRadius: "8px",
                                                    padding: "6px 10px",
                                                }}
                                            >
                                                {/* One cpcd per character so each pinyin syllable in a multi-char
                                                    used-in entry (e.g. 朋友 → péng yǒu) gets its own tone color. */}
                                                <ForeignText
                                                    size="md"
                                                    flexWrap="nowrap"
                                                    compact
                                                    text={item.entryKey}
                                                    pronunciation={item.pronunciation ?? undefined}
                                                />
                                                <Box className="vocab-card-detail__used-in-info">
                                                    <Typography
                                                        className="vocab-card-detail__used-in-def"
                                                        sx={{
                                                            fontSize: SIZE.body,
                                                            color: COLORS.onSurface,
                                                            fontFamily: FONTS.sans,
                                                        }}
                                                    >
                                                        {stripParentheses(item.definition ?? "")}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                        ))}
                                    </Box>
                                </SectionCard>
                            )}

                            {/* Character Breakdown */}
                            {hasBreakdown && (
                                <SectionCard className="vocab-card-detail__breakdown">
                                    <SectionLabel className="vocab-card-detail__section-label">Character Breakdown</SectionLabel>
                                    <Box className="vocab-card-detail__breakdown-list" sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                        {/* Per-character pinyin is derived from the headword pronunciation
                                            (the breakdown map stores definitions only), shared with the EIC
                                            breakdown tab via getBreakdownItems. */}
                                        {getBreakdownItems(entry).map(item => (
                                            <Box
                                                className="vocab-card-detail__breakdown-item"
                                                key={item.character}
                                                sx={{
                                                    display: "flex",
                                                    alignItems: "flex-start",
                                                    gap: "12px",
                                                    backgroundColor: COLORS.sectionCard,
                                                    borderRadius: "8px",
                                                    padding: "6px 10px",
                                                }}
                                            >
                                                <ForeignText
                                                    size="md"
                                                    compact
                                                    text={item.character}
                                                    pronunciation={item.pinyin || undefined}
                                                />
                                                <Box className="vocab-card-detail__breakdown-info">
                                                    <Typography
                                                        className="vocab-card-detail__breakdown-def"
                                                        sx={{
                                                            fontSize: SIZE.body,
                                                            color: COLORS.onSurface,
                                                            fontFamily: FONTS.sans,
                                                        }}
                                                    >
                                                        {stripParentheses(item.definition)}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                        ))}
                                    </Box>
                                </SectionCard>
                            )}

                            {/* Expansion */}
                            {hasExpansion && (
                                <SectionCard className="vocab-card-detail__expansion">
                                    <SectionLabel className="vocab-card-detail__section-label">Extended Definition</SectionLabel>
                                    <SegmentedSentenceDisplay
                                        sentence={{
                                            foreignText: entry.expansion!,
                                        }}
                                        size="md"
                                        compact
                                        flexWrap="wrap"
                                        className="vocab-card-detail__expansion-chars"
                                    />
                                    {/* Literal English translation of the expansion */}
                                    {entry.expansionLiteralTranslation && (
                                        <Typography sx={{
                                            fontSize: SIZE.body,
                                            color: COLORS.textSecondary,
                                            fontFamily: FONTS.sans,
                                            mt: 0.5,
                                            lineHeight: LEADING.normal,
                                            wordBreak: 'break-word',
                                        }}>
                                            {stripParentheses(entry.expansionLiteralTranslation)}
                                        </Typography>
                                    )}
                                </SectionCard>
                            )}

                            {/* Synonyms */}
                            {hasSynonyms && (
                                <SectionCard className="vocab-card-detail__synonyms">
                                    <SectionLabel className="vocab-card-detail__section-label">Synonyms</SectionLabel>
                                    <Box className="vocab-card-detail__synonyms-list" sx={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                        {entry.synonyms!.map((syn) => {
                                            const meta = entry.synonymsMetadata?.[syn];
                                            return (
                                                <Box
                                                    className="vocab-card-detail__synonym-item"
                                                    key={syn}
                                                    sx={{
                                                        backgroundColor: COLORS.sectionCard,
                                                        borderRadius: "8px",
                                                        padding: "6px 12px",
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        alignItems: "center",
                                                        gap: "2px",
                                                    }}
                                                >
                                                    <ForeignText
                                                        size="md"
                                                        compact
                                                        text={syn}
                                                        pronunciation={meta?.pronunciation}
                                                    />
                                                    {meta?.definition && (
                                                        <Typography sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, fontFamily: FONTS.sans, fontStyle: "italic" }}>
                                                            {stripParentheses(meta.definition)}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                </SectionCard>
                            )}

                            {/* Example Sentences */}
                            {hasExamples && (
                                <SectionCard className="vocab-card-detail__examples">
                                    <SectionLabel className="vocab-card-detail__section-label">Example Sentences</SectionLabel>
                                    <Box className="vocab-card-detail__examples-list" sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                        {entry.exampleSentences!.map((ex, i) => (
                                            <Box
                                                className="vocab-card-detail__example-item"
                                                key={i}
                                                sx={{
                                                    backgroundColor: COLORS.sectionCard,
                                                    borderRadius: "8px",
                                                    padding: "10px 12px",
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    gap: "4px",
                                                }}
                                            >
                                                <SegmentedSentenceDisplay
                                                    sentence={ex}
                                                    size="sm"
                                                    compact
                                                    flexWrap="wrap"
                                                    className="vocab-card-detail__example-chinese"
                                                    selectable
                                                />
                                                <Typography
                                                    className="vocab-card-detail__example-english"
                                                    sx={{
                                                        fontSize: SIZE.body,
                                                        color: COLORS.textSecondary,
                                                        fontFamily: FONTS.sans,
                                                        fontStyle: "italic",
                                                        lineHeight: LEADING.normal,
                                                    }}
                                                >
                                                    {ex.english}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                </SectionCard>
                            )}

                            {/* Related Words */}
                            {hasRelatedWords && (
                                <SectionCard className="vocab-card-detail__related-words">
                                    <SectionLabel className="vocab-card-detail__section-label">Related Words</SectionLabel>
                                    <Box className="vocab-card-detail__related-words-list" sx={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                        {entry.relatedWords!.map((rel) => {
                                            return (
                                                <Box
                                                    className="vocab-card-detail__related-word-item"
                                                    key={rel.id}
                                                    sx={{
                                                        backgroundColor: COLORS.sectionCard,
                                                        borderRadius: "8px",
                                                        padding: "6px 12px",
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        alignItems: "center",
                                                        gap: "2px",
                                                    }}
                                                >
                                                    <ForeignText
                                                        size="md"
                                                        compact
                                                        text={rel.entryKey}
                                                        pronunciation={rel.pronunciation}
                                                    />
                                                    {rel.definition && (
                                                        <Typography sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, fontFamily: FONTS.sans, fontStyle: "italic" }}>
                                                            {stripParentheses(rel.definition)}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                </SectionCard>
                            )}

                            {/* Bottom padding */}
                            <Box className="vocab-card-detail__bottom-padding" sx={{ height: 8 }} />
                        </>
                    ) : null}
                </ContentArea>

                {/* Action bar — only visible when a card is loaded */}
                {entry && (
                    <ActionBar className="vocab-card-detail__action-bar">
                        {/* Delete button: always shown */}
                        <Button
                            className="vocab-card-detail__delete-button"
                            variant="contained"
                            startIcon={<DeleteOutlineIcon />}
                            disabled={actionLoading}
                            onClick={handleDelete}
                            sx={{
                                flex: 1,
                                backgroundColor: '#ef5350',
                                textTransform: 'none',
                                fontFamily: FONTS.sans,
                                fontWeight: WEIGHT.semibold,
                                fontSize: SIZE.body,
                                '&:hover': { backgroundColor: '#d32f2f' },
                                '&.Mui-disabled': { backgroundColor: '#ef535088' },
                            }}
                        >
                            Delete Card
                        </Button>
                    </ActionBar>
                )}
        </LeafPage>
    );
};

export default VocabCardDetailPage;
