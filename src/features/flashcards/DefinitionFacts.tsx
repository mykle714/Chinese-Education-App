import { Box, Typography, useTheme } from "@mui/material";
import { CommonalityMeter, DifficultyMeter } from "../../components/ScoreMeters";
import { AiGeneratedBadge } from "../../components/AiGeneratedBadge";
import { aiGeneratedCardSx, aiGeneratedSurfaceSx, aiGeneratedTagPositionSx } from "../../theme/aiGeneratedStyling";
import MetaChipLabel from "./MetaChipLabel";
import { resolveCommonality } from "../../utils/definitionUtils";
import { WEIGHT } from "../../theme/scale";
import type { VocabEntry } from "../../types";
import { useEipColors } from "./FlashcardsLearnPage/useEipPalette";

/**
 * `DefinitionFacts` — the design's `.dfx` (artboards 20 and 20b): the three measured
 * facts about a word, under its definition paragraph.
 *
 * ── One component, because there were two identical copies ────────────────────
 * This block existed VERBATIM in two places — the eip's definition tab
 * (`InfoCardTabContent`) and the cdp's Definition box (`VocabCardDetailBody`) — at
 * ~90 lines each, down to the same comments. They had to agree, because the eip and
 * the cdp show the same word and a learner moves between them in one breath, and
 * "they happen to be the same" is not agreement. Both now render this.
 *
 * ── What the redesign changed about it ────────────────────────────────────────
 * The old strip was a row of CENTRED chips: `Difficulty` and `Commonality` side by
 * side, `Parts of Speech` on a full-width line below as a comma-joined string. Three
 * problems the design fixes:
 *
 *   • Centred values in a left-aligned reading column read as a caption to the
 *     paragraph rather than as facts of their own. `.dfx` left-aligns everything and
 *     puts each value under a mono overline, like every other section in the app.
 *   • "noun, verb, adjective, complement" as a comma-joined string read as prose.
 *     Split into separate terms delimited by a faint middle dot, each POS reads as a
 *     tag. (Per-POS sense counts used to sit beside each term; dropped
 *     2026-10-10 by request.)
 *   • Commonality and difficulty are the two measures words get COMPARED by, so they
 *     share a two-column row with a rule between them, not a centred huddle.
 *
 * ── Provenance: per-field, or one grouped block ───────────────────────────────
 * Every value here is machine-written until a validator approves it
 * (docs/DATA_VALIDATION_SYSTEM.md), and each carries its own approval flag. Two
 * renderings, and which one applies is a rule rather than a prop:
 *
 *   • ALL of them unapproved (and, when the host says so, the paragraph too) → ONE
 *     grouped AI block in the est's AI-card look (ExampleSentenceList, since
 *     2026-11-07): the eip card fill in a single 1px orange ring, no tint, and a single
 *     "AI" tag hanging off its bottom-right edge (artboard 20b's grouping). Four separate orange boxes stacked inside one panel is
 *     noise that stops meaning anything.
 *   • ANY of them human-approved → the per-field boxes, so the approved value is
 *     visibly NOT flagged. Losing that distinction is the one thing the grouped
 *     treatment must never do.
 *
 * `MetaChipLabel` is preserved on every field either way: it is what gives a validator
 * account its inline Approve / Flag pair, and it must stay attached to the specific
 * field being judged.
 *
 * Referenced by docs/DATA_VALIDATION_SYSTEM.md, docs/DEFINITION_CLUSTERS.md,
 * docs/DEFINITION_MAPPING.md and docs/SHELF_REDESIGN.md (artboards 20 / 20b).
 */

export interface DefinitionFactsProps {
    entry: VocabEntry;
    /**
     * The sense the host surface is showing (index into `sortedSenseClusters`).
     * Commonality follows it: a polyseme's word-level score contradicts the definition
     * printed right above it. See docs/DEFINITION_CLUSTERS.md.
     */
    selectedSenseIndex?: number;
    /**
     * The definition paragraph, when the host wants it INSIDE this block so the ONE
     * grouped AI treatment can cover the paragraph and the facts together (artboard
     * 20b). Omit to render facts only — the host then keeps its own paragraph above.
     *
     * A RENDER FUNCTION rather than a node, because whether the block is grouped is
     * decided here (it depends on every field's approval flag, which the host would
     * have to re-derive) and the host needs the answer: a paragraph renderer that draws
     * its own AI border must turn that off when it is about to be wrapped in one, or
     * the panel shows two orange boxes and two sparkle badges for one claim.
     */
    paragraph?: (state: { grouped: boolean }) => React.ReactNode;
    /**
     * Whether that paragraph is human-approved. Only consulted when `paragraph` is
     * given; it is one more input to the all-unapproved test above.
     */
    paragraphApproved?: boolean;
    /** Class-name prefix for the validator overlays, per host surface. */
    classPrefix: string;
    className?: string;
}

export const DefinitionFacts: React.FC<DefinitionFactsProps> = ({
    entry,
    selectedSenseIndex,
    paragraph,
    paragraphApproved,
    classPrefix,
    className,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const colors = useEipColors();

    const commonality = resolveCommonality(entry, selectedSenseIndex);
    const posList = entry.partsOfSpeech ?? [];

    const hasPos = posList.length > 0;
    // Held as a local so TypeScript narrows it for the meter below; `hasCommonality`
    // alone does not carry the narrowing across the JSX boundary.
    const commonalityScore = commonality.score;
    const hasCommonality = commonalityScore != null;
    // Difficulty renders as a bare 6-unit meter in every language — no "HSK N" naming.
    // Held as a local for the same narrowing reason as `commonalityScore`.
    const difficultyScore = entry.difficulty;
    const hasDifficulty = difficultyScore != null;
    if (!hasPos && !hasCommonality && !hasDifficulty && !paragraph) return null;


    // The grouped-AI test: every provenance-bearing value PRESENT in the block is
    // unapproved. A field that isn't rendered can't vote — otherwise a word with only
    // an approved difficulty would still take the grouped treatment on the strength of
    // two absent fields.
    const votes: boolean[] = [
        ...(paragraph ? [paragraphApproved === true] : []),
        ...(hasPos ? [entry.partsOfSpeechApproved === true] : []),
        ...(hasCommonality ? [commonality.approved] : []),
        ...(hasDifficulty ? [entry.difficultyApproved === true] : []),
    ];
    const grouped = votes.length > 0 && votes.every((approved) => !approved);

    /** Per-field AI box, used only when the block is NOT grouped. */
    const fieldSx = (approved: boolean | undefined) =>
        grouped || approved ? {} : { ...aiGeneratedSurfaceSx, borderRadius: "8px", padding: "4px 8px" };

    // One neutral hairline in both renderings. (The grouped box's rules used to take the
    // AI hue so they wouldn't cut its orange tint in half; the est-style card it became on
    // 2026-11-07 has no tint, so the plain border reads cleanest.)
    const rule = `1px solid ${fc.border}`;
    // The ungrouped block is separated from whatever is above it by a hairline on its
    // FIRST FACT rather than on the container, so a paragraph handed in sits above that
    // line (artboard 20) instead of inside the fenced region (artboard 20b\'s box).
    const topRule = grouped ? undefined : rule;

    return (
        <Box
            className={`${classPrefix}__definition-facts${grouped ? ` ${classPrefix}__definition-facts--ai-generated` : ""} ${className ?? ""}`}
            sx={{
                marginTop: "13px",
                // Grouped → the est's AI card (ExampleSentenceList): the eip card fill in a
                // 1px AI-orange ring, no tint, with the corner tag below (2026-11-07).
                ...(grouped ? aiGeneratedCardSx(colors.card) : {}),
            }}
        >
            {grouped && (
                <AiGeneratedBadge
                    label="AI"
                    className={`${classPrefix}__definition-facts-badge`}
                    variant="tag"
                    face={colors.card}
                    ink={colors.ink}
                    sx={aiGeneratedTagPositionSx}
                />
            )}

            {/* The paragraph, when the host handed it in. Inside the grouped box it is
                covered by the one badge above; the host's own AI treatment is skipped. */}
            {paragraph && (
                <Box className={`${classPrefix}__definition-facts-paragraph`} sx={{ marginBottom: "13px" }}>
                    {paragraph({ grouped })}
                </Box>
            )}

            {hasPos && (
                <Box
                    className={`${classPrefix}__definition-facts-pos`}
                    sx={{
                        padding: "10px 0 11px",
                        borderTop: topRule,
                        borderBottom: rule,
                        ...fieldSx(entry.partsOfSpeechApproved),
                        position: "relative",
                    }}
                >
                    <MetaChipLabel
                        label="Parts of Speech"
                        field="partsOfSpeech"
                        word1={entry.entryKey}
                        language={entry.language}
                        approved={entry.partsOfSpeechApproved}
                        classPrefix={classPrefix}
                    />
                    {/* `.pos` (Tower Tier 2, 2026-10-29): each part of speech is an
                        outlined pill — 13px semibold in a 1px ring, 9px radius —
                        replacing the terms-joined-by-a-middle-dot line. Not tappable, so
                        the ring is the eip palette's `line` (its card-outline token, the
                        same ring BreakdownRow / ExampleSentenceList use), not the button
                        outline. NOT `edge`: that is the raised keys' drop lip, which on
                        the dark palette is a near-black #121822 that vanishes on the slate
                        shelf; `line` flips to a light hairline with the rest of the dark ink. */}
                    <Box
                        className={`${classPrefix}__definition-facts-pos-list`}
                        sx={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "7px" }}
                    >
                        {posList.map((pos) => (
                            <Typography
                                component="b"
                                key={pos}
                                className={`${classPrefix}__definition-facts-pos-term`}
                                sx={{
                                    fontSize: 13,
                                    fontWeight: WEIGHT.semibold,
                                    lineHeight: 1.3,
                                    padding: "4px 10px",
                                    borderRadius: "9px",
                                    boxShadow: `inset 0 0 0 1px ${colors.line}`,
                                    color: fc.onSurface,
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {pos}
                            </Typography>
                        ))}
                    </Box>
                </Box>
            )}

            {/* The two measures a learner compares words by, side by side with a rule
                between them — they are peers, and both are read off the same word. */}
            {(hasCommonality || hasDifficulty) && (
                <Box
                    className={`${classPrefix}__definition-facts-measures`}
                    // Two equal columns even when only one is present, so a word missing
                    // its difficulty does not print a lone half-width commonality that
                    // reads as a rendering bug.
                    sx={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        // Only when the POS row is absent — otherwise its own bottom rule
                        // already separates the two.
                        borderTop: hasPos ? undefined : topRule,
                    }}
                >
                    {hasCommonality && (
                        <Box
                            className={`${classPrefix}__definition-facts-commonality`}
                            sx={{ padding: "10px 0 2px", position: "relative", ...fieldSx(commonality.approved) }}
                        >
                            {/* A per-sense score validates the CLUSTER ('senseFrequencyScore'
                                + senseLabel, migration 139); the entry-level fallback
                                validates the det column. */}
                            <MetaChipLabel
                                label="Commonality"
                                field={commonality.senseLabel ? "senseFrequencyScore" : "frequencyScore"}
                                word1={entry.entryKey}
                                language={entry.language}
                                senseLabel={commonality.senseLabel}
                                approved={commonality.approved}
                                classPrefix={classPrefix}
                            />
                            <Box sx={{ display: "flex", alignItems: "center", gap: "9px", marginTop: "8px" }}>
                                {/* Filled and empty circles both in ink2 (the old `.dots` look);
                                    icons only, no "n/5" readout (2026-11-07). */}
                                <CommonalityMeter
                                    className={`${classPrefix}__commonality-meter`}
                                    // 12px (≈10px shapes): a notch above the 10px default, since
                                    // this is the meters' primary surface and no number rides beside them.
                                    unitSize={12}
                                    score={commonalityScore}
                                    filledColor={colors.ink2}
                                    emptyColor={colors.ink2}
                                />
                            </Box>
                        </Box>
                    )}
                    {hasDifficulty && (
                        <Box
                            className={`${classPrefix}__definition-facts-difficulty`}
                            sx={{
                                padding: "10px 0 2px",
                                position: "relative",
                                // The dividing rule belongs to the SECOND column, so it is
                                // absent when difficulty is the only measure present.
                                ...(hasCommonality ? { borderLeft: rule, paddingLeft: "15px" } : {}),
                                ...fieldSx(entry.difficultyApproved),
                            }}
                        >
                            <MetaChipLabel
                                label="Difficulty"
                                field="difficulty"
                                word1={entry.entryKey}
                                language={entry.language}
                                approved={entry.difficultyApproved}
                                classPrefix={classPrefix}
                            />
                            <Box sx={{ display: "flex", alignItems: "center", gap: "9px", marginTop: "8px" }}>
                                {/* Six triangles, same ink as the commonality meter beside it.
                                    No "HSK n" label: the level is an AI estimate, not an
                                    HSK-list lookup (removed 2026-11-07). */}
                                <DifficultyMeter
                                    className={`${classPrefix}__difficulty-meter`}
                                    unitSize={12}
                                    score={difficultyScore}
                                    filledColor={colors.ink2}
                                    emptyColor={colors.ink2}
                                />
                            </Box>
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
};

export default DefinitionFacts;
