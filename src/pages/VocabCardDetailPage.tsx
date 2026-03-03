import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Typography, Chip, CircularProgress, Alert, Divider } from "@mui/material";
import { styled } from "@mui/material/styles";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import MobileFooter from "../components/MobileFooter";
import { API_BASE_URL } from "../constants";
import type { VocabEntry, DictionaryEntry } from "../types";
import CharacterPinyinColorDisplay from "../components/CharacterPinyinColorDisplay";

// Design tokens
const COLORS = {
    background: "#F9F7F2",
    header: "#D7D7D4",
    card: "#D6CCC2",
    infoCard: "#F5EBE0",
    sectionCard: "#EDE7DC",
    onSurface: "#1D1B20",
    textSecondary: "#625F63",
    border: "#625F63",
    categoryUnfamiliar: "#EF476F",
    categoryTarget: "#FF8E47",
    categoryComfortable: "#05C793",
    categoryMastered: "#779BE7",
};

const IPhoneFrame = styled(Box)(() => ({
    backgroundColor: COLORS.background,
    borderRadius: "20px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    maxWidth: 393,
    minWidth: 393,
    width: "100%",
    margin: "0 auto",
    minHeight: "852px",
    height: "100vh",
    maxHeight: "932px",
}));

const Header = styled(Box)(() => ({
    backgroundColor: COLORS.header,
    minHeight: 96,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    flexShrink: 0,
}));

const Toolbar = styled(Box)(() => ({
    display: "flex",
    alignItems: "center",
    padding: "0 16px",
    height: 47,
    position: "relative",
}));

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
    fontSize: "0.7rem",
    fontWeight: 700,
    color: COLORS.textSecondary,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontFamily: '"Inter", sans-serif',
}));

const getCategoryColor = (category?: string) => {
    switch (category) {
        case "Unfamiliar": return COLORS.categoryUnfamiliar;
        case "Target": return COLORS.categoryTarget;
        case "Comfortable": return COLORS.categoryComfortable;
        case "Mastered": return COLORS.categoryMastered;
        default: return COLORS.textSecondary;
    }
};

const VocabCardDetailPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [entry, setEntry] = useState<VocabEntry | null>(null);
    const [dictEntry, setDictEntry] = useState<DictionaryEntry | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
            } catch (err: any) {
                setError(err.message || "Failed to load card");
            } finally {
                setLoading(false);
            }
        };

        if (id) fetchEntry();
    }, [id]);

    const hasShortDef = !!dictEntry?.shortDefinition;
    const hasLongDef = !!dictEntry?.longDefinition;
    const hasBreakdown = entry?.breakdown && Object.keys(entry.breakdown).length > 0;
    const hasSynonyms = entry?.synonyms && entry.synonyms.length > 0;
    const hasExamples = entry?.exampleSentences && entry.exampleSentences.length > 0;
    const hasPartsOfSpeech = entry?.partsOfSpeech && entry.partsOfSpeech.length > 0;
    const hasRelatedWords = entry?.relatedWords && entry.relatedWords.length > 0;
    const hasExpansion = !!entry?.expansion;

    return (
        <Box className="vocab-card-detail__page-wrapper" sx={{ display: "flex", justifyContent: "center", padding: 2, minHeight: "100vh" }}>
            <IPhoneFrame className="vocab-card-detail__frame">
                <Header className="vocab-card-detail__header">
                    <Toolbar className="vocab-card-detail__toolbar">
                        <Box
                            className="vocab-card-detail__back-button"
                            onClick={() => navigate(-1)}
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                cursor: "pointer",
                                color: COLORS.onSurface,
                                "&:hover": { opacity: 0.7 },
                            }}
                        >
                            <ArrowBackIosNewIcon className="vocab-card-detail__back-icon" sx={{ fontSize: 16 }} />
                            <Typography className="vocab-card-detail__back-text" sx={{ fontSize: 14, fontFamily: '"Inter", sans-serif' }}>
                                Back
                            </Typography>
                        </Box>
                        <Typography
                            className="vocab-card-detail__title"
                            sx={{
                                fontSize: 16,
                                fontWeight: 400,
                                color: COLORS.onSurface,
                                fontFamily: '"Inter", sans-serif',
                                position: "absolute",
                                left: "50%",
                                transform: "translateX(-50%)",
                            }}
                        >
                            Card Detail
                        </Typography>
                    </Toolbar>
                </Header>

                <ContentArea className="vocab-card-detail__content">
                    {loading ? (
                        <Box className="vocab-card-detail__loading" sx={{ display: "flex", justifyContent: "center", pt: 6 }}>
                            <CircularProgress className="vocab-card-detail__spinner" />
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
                                                fontSize: "0.7rem",
                                                fontWeight: 700,
                                                height: 22,
                                            }}
                                        />
                                    ) : <Box className="vocab-card-detail__badge-placeholder" />}
                                    {entry.hskLevelTag && (
                                        <Chip
                                            className="vocab-card-detail__hsk-chip"
                                            label={entry.hskLevelTag}
                                            size="small"
                                            sx={{
                                                backgroundColor: COLORS.categoryMastered,
                                                color: "white",
                                                fontSize: "0.7rem",
                                                fontWeight: 700,
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
                                        fontWeight: 700,
                                        color: COLORS.onSurface,
                                        lineHeight: 1,
                                        textAlign: "center",
                                        fontFamily: '"Noto Serif SC", "Inter", sans-serif',
                                    }}
                                >
                                    {entry.entryKey}
                                </Typography>

                                {/* Pronunciation */}
                                {entry.pronunciation && (
                                    <Typography
                                        className="vocab-card-detail__pronunciation"
                                        sx={{
                                            fontSize: "1rem",
                                            color: COLORS.textSecondary,
                                            fontStyle: "italic",
                                            textAlign: "center",
                                            fontFamily: '"Inter", sans-serif',
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
                                        fontSize: "0.95rem",
                                        color: COLORS.onSurface,
                                        textAlign: "center",
                                        fontFamily: '"Inter", sans-serif',
                                        lineHeight: 1.5,
                                    }}
                                >
                                    {entry.entryValue}
                                </Typography>
                            </HeroCard>

                            {/* Dictionary Definition */}
                            {(hasShortDef || hasLongDef) && (
                                <SectionCard className="vocab-card-detail__dict-definition">
                                    <SectionLabel>Dictionary Definition</SectionLabel>
                                    {hasShortDef && (
                                        <Typography sx={{ fontSize: '1rem', fontWeight: 600, color: COLORS.onSurface, fontFamily: '"Inter", sans-serif' }}>
                                            {dictEntry!.shortDefinition}
                                        </Typography>
                                    )}
                                    {hasLongDef && (
                                        <Typography sx={{ fontSize: '0.875rem', color: COLORS.textSecondary, fontFamily: '"Inter", sans-serif', lineHeight: 1.5 }}>
                                            {dictEntry!.longDefinition}
                                        </Typography>
                                    )}
                                </SectionCard>
                            )}

                            {/* Character Breakdown */}
                            {hasBreakdown && (
                                <SectionCard className="vocab-card-detail__breakdown">
                                    <SectionLabel className="vocab-card-detail__section-label">Character Breakdown</SectionLabel>
                                    <Box className="vocab-card-detail__breakdown-list" sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                        {[...entry.entryKey].filter(char => entry.breakdown![char]).map(char => {
                                            const info = entry.breakdown![char];
                                            return (
                                            <Box
                                                className="vocab-card-detail__breakdown-item"
                                                key={char}
                                                sx={{
                                                    display: "flex",
                                                    alignItems: "flex-start",
                                                    gap: "12px",
                                                    backgroundColor: COLORS.sectionCard,
                                                    borderRadius: "8px",
                                                    padding: "6px 10px",
                                                }}
                                            >
                                                <CharacterPinyinColorDisplay
                                                    character={char}
                                                    pinyin={info.pronunciation}
                                                    size="md"
                                                    useToneColor={true}
                                                    showPinyin={true}
                                                />
                                                <Box className="vocab-card-detail__breakdown-info">
                                                    <Typography
                                                        className="vocab-card-detail__breakdown-def"
                                                        sx={{
                                                            fontSize: "0.875rem",
                                                            color: COLORS.onSurface,
                                                            fontFamily: '"Inter", sans-serif',
                                                        }}
                                                    >
                                                        {info.definition}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                            );
                                        })}
                                    </Box>
                                </SectionCard>
                            )}

                            {/* Parts of Speech */}
                            {hasPartsOfSpeech && (
                                <SectionCard className="vocab-card-detail__pos">
                                    <SectionLabel className="vocab-card-detail__section-label">Parts of Speech</SectionLabel>
                                    <Box className="vocab-card-detail__pos-list" sx={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                        {entry.partsOfSpeech!.map((pos) => (
                                            <Chip
                                                className="vocab-card-detail__pos-chip"
                                                key={pos}
                                                label={pos}
                                                size="small"
                                                sx={{
                                                    backgroundColor: COLORS.sectionCard,
                                                    color: COLORS.onSurface,
                                                    fontSize: "0.8rem",
                                                    fontFamily: '"Inter", sans-serif',
                                                    height: 26,
                                                }}
                                            />
                                        ))}
                                    </Box>
                                </SectionCard>
                            )}

                            {/* Expansion */}
                            {hasExpansion && (
                                <SectionCard className="vocab-card-detail__expansion">
                                    <SectionLabel className="vocab-card-detail__section-label">Extended Definition</SectionLabel>
                                    <Box className="vocab-card-detail__expansion-chars" sx={{ display: 'flex', flexDirection: 'row', gap: 1.5, flexWrap: 'wrap' }}>
                                        {[...entry.expansion!].map((char, i) => (
                                            <CharacterPinyinColorDisplay
                                                key={i}
                                                character={char}
                                                pinyin={entry.expansionMetadata?.[char]?.pronunciation ?? ''}
                                                showPinyin={!!entry.expansionMetadata?.[char]?.pronunciation}
                                                size="md"
                                                useToneColor={true}
                                            />
                                        ))}
                                    </Box>
                                </SectionCard>
                            )}

                            {/* Synonyms */}
                            {hasSynonyms && (
                                <SectionCard className="vocab-card-detail__synonyms">
                                    <SectionLabel className="vocab-card-detail__section-label">Synonyms</SectionLabel>
                                    <Box className="vocab-card-detail__synonyms-list" sx={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                        {entry.synonyms!.map((syn) => (
                                            <Box
                                                className="vocab-card-detail__synonym-item"
                                                key={syn}
                                                sx={{
                                                    backgroundColor: COLORS.sectionCard,
                                                    borderRadius: "8px",
                                                    padding: "4px 12px",
                                                }}
                                            >
                                                <Typography
                                                    className="vocab-card-detail__synonym-text"
                                                    sx={{
                                                        fontSize: "1rem",
                                                        fontWeight: 600,
                                                        color: COLORS.onSurface,
                                                        fontFamily: '"Noto Serif SC", "Inter", sans-serif',
                                                    }}
                                                >
                                                    {syn}
                                                </Typography>
                                            </Box>
                                        ))}
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
                                                <Typography
                                                    className="vocab-card-detail__example-chinese"
                                                    sx={{
                                                        fontSize: "1rem",
                                                        fontWeight: 500,
                                                        color: COLORS.onSurface,
                                                        fontFamily: '"Noto Serif SC", "Inter", sans-serif',
                                                        lineHeight: 1.4,
                                                    }}
                                                >
                                                    {ex.chinese}
                                                </Typography>
                                                <Typography
                                                    className="vocab-card-detail__example-english"
                                                    sx={{
                                                        fontSize: "0.8rem",
                                                        color: COLORS.textSecondary,
                                                        fontFamily: '"Inter", sans-serif',
                                                        fontStyle: "italic",
                                                        lineHeight: 1.4,
                                                    }}
                                                >
                                                    {ex.english}
                                                </Typography>
                                                {ex.usage && (
                                                    <Typography
                                                        className="vocab-card-detail__example-usage"
                                                        sx={{
                                                            fontSize: "0.72rem",
                                                            color: COLORS.textSecondary,
                                                            fontFamily: '"Inter", sans-serif',
                                                            opacity: 0.7,
                                                        }}
                                                    >
                                                        {ex.usage}
                                                    </Typography>
                                                )}
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
                                        {entry.relatedWords!.map((rel) => (
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
                                                <Typography
                                                    className="vocab-card-detail__related-word-key"
                                                    sx={{
                                                        fontSize: "1rem",
                                                        fontWeight: 600,
                                                        color: COLORS.onSurface,
                                                        fontFamily: '"Noto Serif SC", "Inter", sans-serif',
                                                    }}
                                                >
                                                    {rel.entryKey}
                                                </Typography>
                                                {rel.sharedCharacters.length > 0 && (
                                                    <Typography
                                                        className="vocab-card-detail__related-word-shared"
                                                        sx={{
                                                            fontSize: "0.65rem",
                                                            color: COLORS.textSecondary,
                                                            fontFamily: '"Inter", sans-serif',
                                                        }}
                                                    >
                                                        shares {rel.sharedCharacters.join(", ")}
                                                    </Typography>
                                                )}
                                            </Box>
                                        ))}
                                    </Box>
                                </SectionCard>
                            )}

                            {/* Bottom padding */}
                            <Box className="vocab-card-detail__bottom-padding" sx={{ height: 8 }} />
                        </>
                    ) : null}
                </ContentArea>

                <MobileFooter activePage="home" />
            </IPhoneFrame>
        </Box>
    );
};

export default VocabCardDetailPage;
