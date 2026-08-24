import { Box, Typography, Chip, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import { resolveCommonality, resolveLongDefinitionForSense, stripParentheses } from "../../utils/definitionUtils";
import type { VocabEntry } from "../../types";
import ForeignText from "../../components/ForeignText";
import LongDefinitionDisplay from "../../components/LongDefinitionDisplay";
import { aiGeneratedSurfaceSx } from "../../theme/aiGeneratedStyling";
import { AiGeneratedBadge } from "../../components/AiGeneratedBadge";
import { getBreakdownItems } from "../../utils/breakdownUtils";
import { getCategoryColor } from "../../utils/categoryColors";
import { SIZE, WEIGHT, TRACKING } from "../../theme/scale";
import BreakdownRow from "./BreakdownRow";
import DefinitionFacts from "./DefinitionFacts";
import UsedInPaginatedList from "./UsedInPaginatedList";
import { MetadataChipRow } from "./FlashcardsLearnPage/styled";
import { FC_FONT } from "./constants";
import ExampleSentenceList from "./ExampleSentenceList";
import { COLORS } from "../../theme/colors";

// Presentational sections shared by both card-detail surfaces (see
// docs/LEAF_NODE_PAGES.md classification): the editable saved-card page
// (VocabCardDetailPage) and the read-only dictionary card-detail page
// (DictionaryCardDetailPage). The hero card + edit toolbar differ per surface and
// stay in each page; everything BELOW the hero (badges + the four info boxes) is
// identical and lives here so a change to, say, the examples box shows on both.
//
// Drill-in wiring: when `onWordOpen` is provided, breakdown blocks, used-in rows
// and example-sentence segments become tappable links to the card detail of that
// word — the same drill-in the eip offers, except it opens the cdp instead of a
// nested eip tab. Both surfaces pass it; they differ only in WHERE it lands:
//   • dictionary cdp → always `/dictionary/card/:word` (stay read-only)
//   • saved-card cdp → the learner's saved card if one exists, else the dictionary
//     cdp (see src/hooks/useOpenWordCard.ts)

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

// Badge pills — category only (color-coded). Difficulty used to sit here as a second
// pill, but it now lives in the Definition box's meta strip alongside Parts of Speech
// + Commonality, matching the eip's definition tab (InfoCardPanelBody).
export const VocabCardBadges: React.FC<{ entry: VocabEntry }> = ({ entry }) => {
    if (!entry.category) return null;
    return (
        <MetadataChipRow className="vocab-card-detail__badges-row" sx={{ justifyContent: "flex-start", marginBottom: 0 }}>
            <Chip
                className="vocab-card-detail__category-chip"
                label={entry.category}
                size="small"
                sx={{
                    backgroundColor: getCategoryColor(entry.category),
                    // Ink + the ramp's inset ring: the category colors are PASTELS
                    // post-redesign (docs/SHELF_REDESIGN.md, D2), so white text is
                    // unreadable and an unringed fill is invisible on the card.
                    color: COLORS.onSurface,
                    boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
                    fontSize: SIZE.micro,
                    fontWeight: WEIGHT.bold,
                    fontFamily: FC_FONT,
                    height: 22,
                }}
            />
        </MetadataChipRow>
    );
};

interface VocabCardSectionsProps {
    entry: VocabEntry;
    showPinyin: boolean;
    showPinyinColor: boolean;
    // The sense the card is currently showing (index into sortedSenseClusters), owned by
    // the host page's sense picker. The Definition box renders THAT sense's long definition
    // — see resolveLongDefinitionForSense. Omit to fall back to the entry's persisted
    // `selectedSense` / the default sense.
    selectedSenseIndex?: number;
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
    selectedSenseIndex,
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

    // The long definition is stored per sense (zh) — render the one the card is on, in
    // lockstep with the sense picker above it. See docs/DEFINITION_CLUSTERS.md.
    const { longDefinition, longDefinitionParts } = resolveLongDefinitionForSense(entry, selectedSenseIndex);

    // Commonality follows the SAME sense as the long definition above — on a polyseme the
    // entry-level score would contradict the meaning printed beside it. Falls back to the
    // entry-level score on unclustered words. See docs/DEFINITION_CLUSTERS.md.
    const commonality = resolveCommonality(entry, selectedSenseIndex);

    // Difficulty is part of the meta strip now, so an entry with only a difficulty
    // still warrants the Definition box.
    const hasDefinitionBox = !!(longDefinition || longDefinitionParts?.length || (entry.partsOfSpeech?.length ?? 0) > 0 || commonality.score != null || entry.difficulty != null);
    const hasExamples = entry.exampleSentences && entry.exampleSentences.length > 0;
    const hasSynonyms = entry.synonyms && entry.synonyms.length > 0;
    const hasRelatedWords = entry.relatedWords && entry.relatedWords.length > 0;
    const hasSynonymsOrRelated = hasSynonyms || hasRelatedWords;

    return (
        <>
            {/* Definition — mirrors the eip's "definition" tab: long definition +
                parts-of-speech/frequency meta strip. */}
            {hasDefinitionBox && (
                <SectionCard className="vocab-card-detail__definition">
                    <SectionLabel>Definition</SectionLabel>
                    {(longDefinition || longDefinitionParts?.length) && (
                        <LongDefinitionDisplay
                            className="vocab-card-detail__long-definition-text"
                            longDefinition={longDefinition}
                            longDefinitionParts={longDefinitionParts}
                            showPinyin={showPinyin}
                            showPinyinColor={showPinyinColor}
                            aiGenerated={!entry.definitionsApproved}
                            word1={entry.entryKey}
                            language={entry.language}
                            sx={{ fontSize: SIZE.body, color: fc.onSurface, fontFamily: FC_FONT, lineHeight: 1.6 }}
                        />
                    )}
                    {/* The three measured facts (DefinitionFacts / `.dfx`) — ONE shared
                        component with the eip's definition tab. This was ~90 lines of
                        centred chips, duplicated verbatim between the two surfaces down
                        to the comments; each field keeps its own validator Approve/Flag
                        pair and its own AI-provenance treatment. */}
                    <DefinitionFacts
                        entry={entry}
                        selectedSenseIndex={selectedSenseIndex}
                        classPrefix="vocab-card-detail"
                    />
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
                                    pages the rest via /api/dictionary/usedIn. */}
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
                            // One `.bkr` row per component character, in the word's own
                            // order — the SAME component the eip breakdown tab renders
                            // (BreakdownRow). Both surfaces used to carry their own copy
                            // of a 1:1 block-button grid.
                            //
                            // Negative side margin cancels the SectionCard's padding so
                            // each row's hairline runs the full width of the box, which is
                            // what makes the rows read as one word taken apart rather than
                            // as a stack of inset cards.
                            <Box
                                className="vocab-card-detail__breakdown-list"
                                sx={{ margin: "0 -16px" }}
                            >
                                {breakdownItems.map((item) => (
                                    <BreakdownRow
                                        key={item.character}
                                        className="vocab-card-detail__breakdown-row"
                                        character={item.character}
                                        pinyin={item.pinyin}
                                        definition={item.definition}
                                        language={entry.language}
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
