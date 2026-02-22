import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Typography, Chip, CircularProgress, Alert, Divider } from "@mui/material";
import { styled } from "@mui/material/styles";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import MobileFooter from "../components/MobileFooter";
import { API_BASE_URL } from "../constants";
import type { VocabEntry } from "../types";

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
            } catch (err: any) {
                setError(err.message || "Failed to load card");
            } finally {
                setLoading(false);
            }
        };

        if (id) fetchEntry();
    }, [id]);

    const hasBreakdown = entry?.breakdown && Object.keys(entry.breakdown).length > 0;
    const hasSynonyms = entry?.synonyms && entry.synonyms.length > 0;
    const hasExamples = entry?.exampleSentences && entry.exampleSentences.length > 0;
    const hasPartsOfSpeech = entry?.partsOfSpeech && entry.partsOfSpeech.length > 0;
    const hasRelatedWords = entry?.relatedWords && entry.relatedWords.length > 0;
    const hasExpansion = !!entry?.expansion;

    return (
        <Box sx={{ display: "flex", justifyContent: "center", padding: 2, minHeight: "100vh" }}>
            <IPhoneFrame>
                <Header>
                    <Toolbar>
                        <Box
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
                            <ArrowBackIosNewIcon sx={{ fontSize: 16 }} />
                            <Typography sx={{ fontSize: 14, fontFamily: '"Inter", sans-serif' }}>
                                Back
                            </Typography>
                        </Box>
                        <Typography
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

                <ContentArea>
                    {loading ? (
                        <Box sx={{ display: "flex", justifyContent: "center", pt: 6 }}>
                            <CircularProgress />
                        </Box>
                    ) : error ? (
                        <Alert severity="error">{error}</Alert>
                    ) : entry ? (
                        <>
                            {/* Hero Card */}
                            <HeroCard>
                                {/* Category + HSK badges row */}
                                <Box sx={{ display: "flex", justifyContent: "space-between", width: "100%", mb: 1 }}>
                                    {entry.category ? (
                                        <Chip
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
                                    ) : <Box />}
                                    {entry.hskLevelTag && (
                                        <Chip
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

                                <Divider sx={{ width: "60%", borderColor: COLORS.textSecondary, opacity: 0.3, my: 0.5 }} />

                                {/* Definition */}
                                <Typography
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

                            {/* Character Breakdown */}
                            {hasBreakdown && (
                                <SectionCard>
                                    <SectionLabel>Character Breakdown</SectionLabel>
                                    <Box sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                        {Object.entries(entry.breakdown!).map(([char, info]) => (
                                            <Box
                                                key={char}
                                                sx={{
                                                    display: "flex",
                                                    alignItems: "flex-start",
                                                    gap: "12px",
                                                    backgroundColor: COLORS.sectionCard,
                                                    borderRadius: "8px",
                                                    padding: "8px 12px",
                                                }}
                                            >
                                                <Typography
                                                    sx={{
                                                        fontSize: "1.75rem",
                                                        fontWeight: 700,
                                                        color: COLORS.onSurface,
                                                        lineHeight: 1,
                                                        minWidth: 36,
                                                        fontFamily: '"Noto Serif SC", "Inter", sans-serif',
                                                    }}
                                                >
                                                    {char}
                                                </Typography>
                                                <Box>
                                                    <Typography
                                                        sx={{
                                                            fontSize: "0.8rem",
                                                            color: COLORS.textSecondary,
                                                            fontStyle: "italic",
                                                            fontFamily: '"Inter", sans-serif',
                                                        }}
                                                    >
                                                        {info.pronunciation}
                                                    </Typography>
                                                    <Typography
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
                                        ))}
                                    </Box>
                                </SectionCard>
                            )}

                            {/* Parts of Speech */}
                            {hasPartsOfSpeech && (
                                <SectionCard>
                                    <SectionLabel>Parts of Speech</SectionLabel>
                                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                        {entry.partsOfSpeech!.map((pos) => (
                                            <Chip
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
                                <SectionCard>
                                    <SectionLabel>Extended Definition</SectionLabel>
                                    <Typography
                                        sx={{
                                            fontSize: "0.875rem",
                                            color: COLORS.onSurface,
                                            fontFamily: '"Inter", sans-serif',
                                            lineHeight: 1.6,
                                        }}
                                    >
                                        {entry.expansion}
                                    </Typography>
                                </SectionCard>
                            )}

                            {/* Synonyms */}
                            {hasSynonyms && (
                                <SectionCard>
                                    <SectionLabel>Synonyms</SectionLabel>
                                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                        {entry.synonyms!.map((syn) => (
                                            <Box
                                                key={syn}
                                                sx={{
                                                    backgroundColor: COLORS.sectionCard,
                                                    borderRadius: "8px",
                                                    padding: "4px 12px",
                                                }}
                                            >
                                                <Typography
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
                                <SectionCard>
                                    <SectionLabel>Example Sentences</SectionLabel>
                                    <Box sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                        {entry.exampleSentences!.map((ex, i) => (
                                            <Box
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
                                <SectionCard>
                                    <SectionLabel>Related Words</SectionLabel>
                                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                        {entry.relatedWords!.map((rel) => (
                                            <Box
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
                            <Box sx={{ height: 8 }} />
                        </>
                    ) : null}
                </ContentArea>

                <MobileFooter activePage="home" />
            </IPhoneFrame>
        </Box>
    );
};

export default VocabCardDetailPage;
