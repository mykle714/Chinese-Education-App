import { Box, Typography, Chip, useTheme } from "@mui/material";
import { styled } from "@mui/material/styles";
import { resolveLongDefinitionForSense, stripParentheses } from "../../utils/definitionUtils";
import type { VocabEntry } from "../../types";
import ForeignText from "../../components/ForeignText";
import MetaChipLabel from "./MetaChipLabel";
import LongDefinitionDisplay from "../../components/LongDefinitionDisplay";
import { aiGeneratedSurfaceSx } from "../../theme/aiGeneratedStyling";
import { AiGeneratedBadge } from "../../components/AiGeneratedBadge";
import { getBreakdownItems } from "../../utils/breakdownUtils";
import { getCategoryColor } from "../../utils/categoryColors";
import { SIZE, WEIGHT, TRACKING } from "../../theme/scale";
import InfoCardBlockButton from "./FlashcardsLearnPage/InfoCardBlockButton";
import UsedInPaginatedList from "./UsedInPaginatedList";
import { MetadataChipRow } from "./FlashcardsLearnPage/styled";
import { FC_FONT } from "./constants";
import ExampleSentenceList from "./ExampleSentenceList";

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
                    color: "white",
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

    // Difficulty is part of the meta strip now, so an entry with only a difficulty
    // still warrants the Definition box.
    const hasDefinitionBox = !!(longDefinition || longDefinitionParts?.length || (entry.partsOfSpeech?.length ?? 0) > 0 || entry.frequencyScore != null || entry.difficulty != null);
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
                    {/* Meta strip — Difficulty + Parts of Speech + Commonality (frequencyScore),
                        the same three chips the eip's definition tab shows (InfoCardPanelBody).
                        Each chip is INDEPENDENTLY validatable (migration 132): it carries its own
                        approval flag, its own AI-generated treatment, and — for validator accounts
                        — its own inline Approve/Flag pair (docs/DATA_VALIDATION_SYSTEM.md). */}
                    {(entry.difficulty != null || (entry.partsOfSpeech?.length ?? 0) > 0 || entry.frequencyScore != null) && (
                        <Box
                            className="vocab-card-detail__definition-meta-strip"
                            sx={{
                                // Two stacked rows: Difficulty + Commonality share a centered
                                // top row, Parts of Speech gets a full-width row below them
                                // (its value can be long, so it needs the whole line).
                                display: "flex",
                                flexDirection: "column",
                                gap: "10px",
                                padding: "10px 0 0",
                                borderTop: `1px solid ${fc.border}`,
                            }}
                        >
                          {/* Top row renders only when it has a chip — otherwise its empty
                              box would still contribute the column gap above the POS row. */}
                          {(entry.difficulty != null || entry.frequencyScore != null) && (
                          <Box
                            className="vocab-card-detail__definition-meta-row"
                            sx={{ display: "flex", gap: "18px", alignItems: "center", justifyContent: "center" }}
                          >
                            {entry.difficulty != null && (
                                // Difficulty is AI-classified (backfill-hsk-level.js), so it carries the
                                // AI-generated box (no badge — a small value chip) until a validator
                                // approves the 'difficulty' field. The label is language-neutral
                                // ("Difficulty"); only the VALUE names the scale, reading "HSK N" for zh
                                // (whose 1–6 integers ARE HSK levels) and a bare N elsewhere.
                                <Box
                                    className={`vocab-card-detail__level-chip${entry.difficultyApproved ? "" : " vocab-card-detail__level-chip--ai-generated"}`}
                                    sx={{
                                        // position:relative anchors MetaChipLabel's absolutely-positioned
                                        // validator overlay to THIS chip's corner.
                                        position: "relative",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "3px",
                                        ...(entry.difficultyApproved ? {} : { ...aiGeneratedSurfaceSx, borderRadius: "8px", padding: "4px 8px" }),
                                    }}
                                >
                                    <MetaChipLabel label="Difficulty" field="difficulty" word1={entry.entryKey} language={entry.language} approved={entry.difficultyApproved} classPrefix="vocab-card-detail" />
                                    <Typography sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: fc.onSurface, fontFamily: FC_FONT, whiteSpace: "nowrap" }}>
                                        {entry.language === 'zh' ? `HSK ${entry.difficulty}` : entry.difficulty}
                                    </Typography>
                                </Box>
                            )}
                            {entry.frequencyScore != null && (
                                <Box
                                    className={`vocab-card-detail__frequency-meta${entry.frequencyScoreApproved ? "" : " vocab-card-detail__frequency-meta--ai-generated"}`}
                                    sx={{
                                        // position:relative anchors MetaChipLabel's absolutely-positioned
                                        // validator overlay to THIS chip's corner.
                                        position: "relative",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "3px",
                                        // frequencyScore is AI-scored (backfill-frequency-score.js), so it
                                        // carries the AI-generated box until the 'frequencyScore' field is
                                        // human-approved.
                                        ...(entry.frequencyScoreApproved ? {} : { ...aiGeneratedSurfaceSx, borderRadius: "8px", padding: "4px 8px" }),
                                    }}
                                >
                                    <MetaChipLabel label="Commonality" field="frequencyScore" word1={entry.entryKey} language={entry.language} approved={entry.frequencyScoreApproved} classPrefix="vocab-card-detail" />
                                    <Box sx={{ display: "flex", alignItems: "center", gap: "5px", height: 19 }}>
                                        <Box sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                            {[1, 2, 3, 4, 5].map((level) => {
                                                const filled = level <= entry.frequencyScore!;
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
                                            {entry.frequencyScore}/5
                                        </Typography>
                                    </Box>
                                </Box>
                            )}
                          </Box>
                          )}
                          {/* Parts of Speech — its own full-width row under the pair above. */}
                          {(entry.partsOfSpeech?.length ?? 0) > 0 && (
                            <Box
                                className={entry.partsOfSpeechApproved ? "vocab-card-detail__pos-chip" : "vocab-card-detail__pos-chip vocab-card-detail__pos-chip--ai-generated"}
                                sx={{
                                    // position:relative anchors MetaChipLabel's absolutely-positioned
                                    // validator overlay to THIS chip's corner.
                                    position: "relative",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    gap: "3px",
                                    // Spans the strip's full width — the value (a comma-joined POS
                                    // list) is the longest of the three metas.
                                    width: "100%",
                                    // Carries the shared AI-generated box (no badge — just the orange
                                    // border/tint) until the 'partsOfSpeech' field is human-approved.
                                    // Its own field since migration 132, so definitions churn no
                                    // longer clears it (docs/DATA_VALIDATION_SYSTEM.md).
                                    ...(entry.partsOfSpeechApproved ? {} : { ...aiGeneratedSurfaceSx, borderRadius: "8px", padding: "4px 8px" }),
                                }}
                            >
                                <MetaChipLabel label="Parts of Speech" field="partsOfSpeech" word1={entry.entryKey} language={entry.language} approved={entry.partsOfSpeechApproved} classPrefix="vocab-card-detail" />
                                <Typography sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: fc.onSurface, fontFamily: FC_FONT, textAlign: "center" }}>
                                    {entry.partsOfSpeech!.join(', ')}
                                </Typography>
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
                            // Extra inset layer + centered grid — same treatment as
                            // the eip breakdown tab (InfoCardPanelBody): the block
                            // buttons flex to fill the padded container.
                            <Box
                                className="vocab-card-detail__breakdown-list"
                                sx={{ display: "flex", justifyContent: "center", padding: "16px" }}
                            >
                                {/* Equal auto-fit tracks — identical button size,
                                    left-to-right then top-down (see the matching
                                    grid in InfoCardPanelBody). */}
                                <Box
                                    className="vocab-card-detail__breakdown-grid"
                                    sx={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(auto-fit, minmax(min(116px, 100%), 1fr))",
                                        gap: "10px",
                                        width: "100%",
                                    }}
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
