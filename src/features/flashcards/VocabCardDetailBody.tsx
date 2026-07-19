import { Box, Typography, Chip, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import { stripParentheses } from "../../utils/definitionUtils";
import type { VocabEntry } from "../../types";
import ForeignText from "../../components/ForeignText";
import LongDefinitionDisplay from "../../components/LongDefinitionDisplay";
import { aiGeneratedSurfaceSx, aiGeneratedTextColor } from "../../theme/aiGeneratedStyling";
import { AiGeneratedBadge } from "../../components/AiGeneratedBadge";
import { getBreakdownItems } from "../../utils/breakdownUtils";
import { getCategoryColor } from "../../utils/categoryColors";
import { SIZE, WEIGHT, TRACKING } from "../../theme/scale";
import InfoCardBlockButton from "./FlashcardsLearnPage/InfoCardBlockButton";
import UsedInPaginatedList from "./UsedInPaginatedList";
import { HskPill, MetadataChipRow } from "./FlashcardsLearnPage/styled";
import { FC_FONT } from "./FlashcardsLearnPage/constants";
import ExampleSentenceList from "./ExampleSentenceList";

// Presentational sections shared by both card-detail surfaces (see
// docs/LEAF_NODE_PAGES.md classification): the editable saved-card page
// (VocabCardDetailPage) and the read-only dictionary card-detail page
// (DictionaryCardDetailPage). The hero card + edit toolbar differ per surface and
// stay in each page; everything BELOW the hero (badges + the four info boxes) is
// identical and lives here so a change to, say, the examples box shows on both.
//
// Drill-in wiring: when `onWordOpen` is provided (the dictionary surface),
// breakdown/used-in rows and example-sentence segments become tappable links to
// the card detail of that word — the same drill-in the eip offers, except it
// opens the cdp instead of a nested eip tab. Omitted on the saved-card page, so
// those rows stay passive there (unchanged behavior).

// Info section card — same flashcard-palette tokens as the eip (fc.background +
// fc.cardShadowSubtle) so these boxes read as one visual system and stay
// theme-reactive.
export const SectionCard = styled(Box)(({ theme }) => ({
    backgroundColor: theme.palette.flashcard.background,
    borderRadius: "16px",
    boxShadow: theme.palette.flashcard.cardShadowSubtle,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
}));

export const SectionLabel = styled(Typography)(({ theme }) => ({
    fontSize: SIZE.micro,
    fontWeight: WEIGHT.bold,
    color: theme.palette.flashcard.textSecondary,
    letterSpacing: TRACKING.caps,
    textTransform: "uppercase",
    fontFamily: FC_FONT,
}));

// Badge pills — category (color-coded) plus a single level pill. The level pill
// reads "HSK N" for zh (whose 1–6 difficulty integers ARE HSK levels) and
// generically "Level N" for other languages sharing the same 1–6 scale.
export const VocabCardBadges: React.FC<{ entry: VocabEntry }> = ({ entry }) => {
    if (!(entry.category || entry.difficulty)) return null;
    return (
        <MetadataChipRow className="vocab-card-detail__badges-row" sx={{ justifyContent: "flex-start", marginBottom: 0 }}>
            {entry.category && (
                <Chip
                    className="vocab-card-detail__category-chip"
                    label={entry.category}
                    size="small"
                    sx={{
                        backgroundColor: getCategoryColor(entry.category),
                        color: "white",
                        fontSize: SIZE.micro,
                        fontWeight: WEIGHT.bold,
                        fontFamily: FC_FONT,
                        height: 22,
                    }}
                />
            )}
            {entry.difficulty != null && (
                // HSK/difficulty is AI-classified (backfill-hsk-level.js) with no validation
                // field to ever approve it, so it always carries the AI-generated treatment —
                // override the pill's default solid fill with the shared orange outline.
                <HskPill
                    className="vocab-card-detail__level-pill vocab-card-detail__level-pill--ai-generated"
                    sx={{ ...aiGeneratedSurfaceSx, color: aiGeneratedTextColor }}
                >
                    {entry.language === 'zh' ? `HSK ${entry.difficulty}` : `Level ${entry.difficulty}`}
                </HskPill>
            )}
        </MetadataChipRow>
    );
};

interface VocabCardSectionsProps {
    entry: VocabEntry;
    showPinyin: boolean;
    showPinyinColor: boolean;
    // When set, breakdown/used-in rows and example segments drill into the card
    // detail of the tapped word. Omit to keep them passive (saved-card page).
    onWordOpen?: (word: string) => void;
    // TTS for the example-sentence speaker buttons. Omit to hide audio (e.g.
    // narration disabled in settings). Threaded straight to ExampleSentenceList.
    onSpeakSentence?: (text: string, pronunciation?: string) => void;
    speakingKey?: string | null;
}

export const VocabCardSections: React.FC<VocabCardSectionsProps> = ({
    entry,
    showPinyin,
    showPinyinColor,
    onWordOpen,
    onSpeakSentence,
    speakingKey,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    const isSingleChar = [...entry.entryKey].length === 1;
    // For single-char zh, the breakdown box is replaced by a "Used In" list (mirrors
    // the eip's breakdown/used-in tab — see OnDeckVocabService.enrichWithUsedIn).
    const hasUsedIn = isSingleChar && !!entry.usedIn && entry.usedIn.length > 0;
    const hasBreakdown = !isSingleChar && !!entry.breakdown && Object.keys(entry.breakdown).length > 0;
    const hasBreakdownBox = isSingleChar ? hasUsedIn : hasBreakdown;
    const breakdownItems = getBreakdownItems(entry);

    const hasDefinitionBox = !!(entry.longDefinition || entry.longDefinitionParts?.length || (entry.partsOfSpeech?.length ?? 0) > 0 || entry.vernacularScore != null);
    const hasExamples = entry.exampleSentences && entry.exampleSentences.length > 0;
    const hasSynonyms = entry.synonyms && entry.synonyms.length > 0;
    const hasRelatedWords = entry.relatedWords && entry.relatedWords.length > 0;
    const hasSynonymsOrRelated = hasSynonyms || hasRelatedWords;

    return (
        <>
            {/* Definition — mirrors the eip's "definition" tab: long definition +
                parts-of-speech/vernacular meta strip. */}
            {hasDefinitionBox && (
                <SectionCard className="vocab-card-detail__definition">
                    <SectionLabel>Definition</SectionLabel>
                    {(entry.longDefinition || entry.longDefinitionParts?.length) && (
                        <LongDefinitionDisplay
                            className="vocab-card-detail__long-definition-text"
                            longDefinition={entry.longDefinition}
                            longDefinitionParts={entry.longDefinitionParts}
                            showPinyin={showPinyin}
                            showPinyinColor={showPinyinColor}
                            aiGenerated={!entry.definitionsApproved}
                            word1={entry.entryKey}
                            language={entry.language}
                            sx={{ fontSize: SIZE.body, color: fc.onSurface, fontFamily: FC_FONT, lineHeight: 1.6 }}
                        />
                    )}
                    {/* HSK/Level lives in the top pill list, so this strip covers only Type + Vernacular. */}
                    {((entry.partsOfSpeech?.length ?? 0) > 0 || entry.vernacularScore != null) && (
                        <Box
                            className="vocab-card-detail__definition-meta-strip"
                            sx={{
                                display: "flex",
                                gap: "18px",
                                alignItems: "center",
                                padding: "10px 0 0",
                                borderTop: `1px solid ${fc.border}`,
                            }}
                        >
                            {(entry.partsOfSpeech?.length ?? 0) > 0 && (
                                <Box
                                    className={entry.definitionsApproved ? undefined : "vocab-card-detail__pos-chip--ai-generated"}
                                    sx={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "3px",
                                        // "Type" chip carries the shared AI-generated box (no badge —
                                        // just the orange border/tint) when the definitions bundle
                                        // hasn't been human-approved (docs/DATA_VALIDATION_SYSTEM.md).
                                        ...(entry.definitionsApproved ? {} : { ...aiGeneratedSurfaceSx, borderRadius: "8px", padding: "4px 8px" }),
                                    }}
                                >
                                    <SectionLabel>Type</SectionLabel>
                                    <Typography sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: fc.onSurface, fontFamily: FC_FONT }}>
                                        {entry.partsOfSpeech!.join(', ')}
                                    </Typography>
                                </Box>
                            )}
                            {entry.vernacularScore != null && (
                                <Box
                                    className="vocab-card-detail__vernacular-meta vocab-card-detail__vernacular-meta--ai-generated"
                                    sx={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "3px",
                                        // vernacularScore is AI-scored (backfill-vernacular-score.js) with
                                        // no validation field, so it always carries the AI-generated box
                                        // (no badge — a small value chip, like the Type chip above).
                                        ...aiGeneratedSurfaceSx,
                                        borderRadius: "8px",
                                        padding: "4px 8px",
                                    }}
                                >
                                    <SectionLabel>Commonality</SectionLabel>
                                    <Box sx={{ display: "flex", alignItems: "center", gap: "5px", height: 19 }}>
                                        <Box sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                            {[1, 2, 3, 4, 5].map((level) => {
                                                const filled = level <= entry.vernacularScore!;
                                                return (
                                                    <Box
                                                        key={level}
                                                        sx={{
                                                            width: 8,
                                                            height: 8,
                                                            borderRadius: "50%",
                                                            background: filled ? fc.onSurface : "transparent",
                                                            border: `1.5px solid ${filled ? fc.onSurface : fc.border}`,
                                                        }}
                                                    />
                                                );
                                            })}
                                        </Box>
                                        <Typography sx={{ fontSize: SIZE.micro, fontWeight: WEIGHT.bold, color: fc.onSurface, lineHeight: 1 }}>
                                            {entry.vernacularScore}/5
                                        </Typography>
                                    </Box>
                                </Box>
                            )}
                        </Box>
                    )}
                </SectionCard>
            )}

            {/* Character Breakdown / Used In — mirrors the eip's "breakdown" tab
                (per-character rows for multi-char entries, or "Used In" for single-char zh). */}
            {hasBreakdownBox && (
                <SectionCard className="vocab-card-detail__breakdown">
                    <SectionLabel className="vocab-card-detail__section-label">
                        {isSingleChar ? "Used In" : "Character Breakdown"}
                    </SectionLabel>
                    {(isSingleChar ? hasUsedIn : hasBreakdown) && (
                        isSingleChar ? (
                            <Box className="vocab-card-detail__breakdown-list">
                                {/* Infinite-scroll list: seeds from the card's ≤4 preview,
                                    pages the rest via /api/dictionary/used-in. */}
                                <UsedInPaginatedList
                                    character={entry.entryKey}
                                    language={entry.language ?? 'zh'}
                                    initialItems={entry.usedIn ?? []}
                                    showPinyin={showPinyin}
                                    showPinyinColor={showPinyinColor}
                                    onItemClick={onWordOpen ? (item) => onWordOpen(item.entryKey) : undefined}
                                    rowClassName="vocab-card-detail__used-in-row"
                                />
                            </Box>
                        ) : (
                            <Box
                                className="vocab-card-detail__breakdown-list"
                                sx={{ display: "flex", flexWrap: "wrap", gap: "10px" }}
                            >
                                {breakdownItems.map((item) => (
                                    <InfoCardBlockButton
                                        key={item.character}
                                        className="vocab-card-detail__breakdown-row"
                                        character={item.character}
                                        pinyin={item.pinyin}
                                        definition={item.definition}
                                        showPinyin={showPinyin}
                                        showPinyinColor={showPinyinColor}
                                        onClick={onWordOpen ? () => onWordOpen(item.character) : undefined}
                                    />
                                ))}
                            </Box>
                        )
                    )}
                </SectionCard>
            )}

            {/* Example Sentences — same shared est renderer as the eip's Examples tab. */}
            {hasExamples && (
                <SectionCard className="vocab-card-detail__examples">
                    <SectionLabel className="vocab-card-detail__section-label">Example Sentences</SectionLabel>
                    <ExampleSentenceList
                        sentences={entry.exampleSentences!}
                        vocabWord={entry.entryKey}
                        language={entry.language}
                        showPinyin={showPinyin}
                        showPinyinColor={showPinyinColor}
                        // Denser than the eip because the cdp stacks several info boxes.
                        compact
                        onSegmentOpen={onWordOpen}
                        onSpeakSentence={onSpeakSentence}
                        speakingKey={speakingKey}
                    />
                </SectionCard>
            )}

            {/* Synonyms & Related Words — not part of the eip's tabs, so this one box
                holds both, kept at the very bottom. */}
            {hasSynonymsOrRelated && (
                <SectionCard className="vocab-card-detail__synonyms-related">
                    {hasSynonyms && (
                        <>
                            {/* Synonyms are AI-enriched with no validation field, so the whole
                                list always carries the AI-generated treatment: one badge for the
                                section, and each chip gets the shared orange box. */}
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                <SectionLabel className="vocab-card-detail__section-label">Synonyms</SectionLabel>
                                <AiGeneratedBadge className="vocab-card-detail__synonyms-ai-badge" label="AI GENERATED" />
                            </Box>
                            <Box className="vocab-card-detail__synonyms-list" sx={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                {entry.synonyms!.map((syn) => {
                                    const meta = entry.synonymsMetadata?.[syn];
                                    return (
                                        <Box
                                            className="vocab-card-detail__synonym-item vocab-card-detail__synonym-item--ai-generated"
                                            key={syn}
                                            sx={{
                                                ...aiGeneratedSurfaceSx,
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
                                                <Typography sx={{ fontSize: SIZE.caption, color: fc.textSecondary, fontFamily: FC_FONT, fontStyle: "italic" }}>
                                                    {stripParentheses(meta.definition)}
                                                </Typography>
                                            )}
                                        </Box>
                                    );
                                })}
                            </Box>
                        </>
                    )}
                    {hasRelatedWords && (
                        <>
                            <SectionLabel className="vocab-card-detail__section-label" sx={hasSynonyms ? { mt: 1 } : undefined}>Related Words</SectionLabel>
                            <Box className="vocab-card-detail__related-words-list" sx={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                {entry.relatedWords!.map((rel) => (
                                    <Box
                                        className="vocab-card-detail__related-word-item"
                                        key={rel.id}
                                        sx={{
                                            backgroundColor: fc.subtleBg,
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
                                            <Typography sx={{ fontSize: SIZE.caption, color: fc.textSecondary, fontFamily: FC_FONT, fontStyle: "italic" }}>
                                                {stripParentheses(rel.definition)}
                                            </Typography>
                                        )}
                                    </Box>
                                ))}
                            </Box>
                        </>
                    )}
                </SectionCard>
            )}
        </>
    );
};
