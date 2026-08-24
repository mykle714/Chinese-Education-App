import { useMemo } from "react";
import { Box, Typography, useTheme } from "@mui/material";
import FrequencyScoreDots from "../../components/FrequencyScoreDots";
import { AiGeneratedBadge } from "../../components/AiGeneratedBadge";
import { aiGeneratedSurfaceSx } from "../../theme/aiGeneratedStyling";
import MetaChipLabel from "./MetaChipLabel";
import { resolveCommonality } from "../../utils/definitionUtils";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import type { VocabEntry } from "../../types";

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
 *   • "noun, verb, adjective, complement" as prose says nothing about SHAPE. Split
 *     into terms, each carrying how many of the word's senses sit under it, the same
 *     line answers "which of these is this word mostly?" — which is the question a
 *     learner looking at a four-POS word actually has.
 *   • Commonality and difficulty are the two measures words get COMPARED by, so they
 *     share a two-column row with a rule between them, not a centred huddle.
 *
 * ── Provenance: per-field, or one grouped block ───────────────────────────────
 * Every value here is machine-written until a validator approves it
 * (docs/DATA_VALIDATION_SYSTEM.md), and each carries its own approval flag. Two
 * renderings, and which one applies is a rule rather than a prop:
 *
 *   • ALL of them unapproved (and, when the host says so, the paragraph too) → ONE
 *     grouped AI block: a single orange hairline, a single 8% tint, a single sparkle
 *     badge (artboard 20b). Four separate orange boxes stacked inside one panel is
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

/**
 * How many of the word's senses list each part of speech.
 *
 * The POS LIST comes from the entry-level `partsOfSpeech` column, because that is the
 * validatable field — a count derived from clusters cannot be approved or flagged. The
 * COUNTS come from `definitionClusters`. An entry with no clusters gets the list with
 * no counts rather than a fabricated "1" each: one sense per POS is a claim, and on an
 * unclustered word nobody has made it.
 */
function senseCountsByPos(entry: VocabEntry): Map<string, number> {
    const counts = new Map<string, number>();
    for (const cluster of entry.definitionClusters ?? []) {
        for (const pos of cluster.pos ?? []) {
            counts.set(pos, (counts.get(pos) ?? 0) + 1);
        }
    }
    return counts;
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

    const commonality = resolveCommonality(entry, selectedSenseIndex);
    const posList = entry.partsOfSpeech ?? [];
    const posCounts = useMemo(() => senseCountsByPos(entry), [entry]);

    const hasPos = posList.length > 0;
    // Held as a local so TypeScript narrows it for the meter below; `hasCommonality`
    // alone does not carry the narrowing across the JSX boundary.
    const commonalityScore = commonality.score;
    const hasCommonality = commonalityScore != null;
    // Difficulty's LABEL is language-neutral; only the value names the scale, reading
    // "HSK N" for zh (whose 1–6 integers ARE HSK levels) and a bare N elsewhere.
    const hasDifficulty = entry.difficulty != null;
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

    // Rules INSIDE the grouped box take the AI hue; a neutral hairline would cut the
    // orange tint in half.
    const rule = grouped ? "1px solid rgba(255,158,90,0.35)" : `1px solid ${fc.border}`;
    // The ungrouped block is separated from whatever is above it by a hairline on its
    // FIRST FACT rather than on the container, so a paragraph handed in sits above that
    // line (artboard 20) instead of inside the fenced region (artboard 20b\'s box).
    const topRule = grouped ? undefined : rule;

    return (
        <Box
            className={`${classPrefix}__definition-facts${grouped ? ` ${classPrefix}__definition-facts--ai-generated` : ""} ${className ?? ""}`}
            sx={{
                marginTop: "13px",
                ...(grouped
                    ? { ...aiGeneratedSurfaceSx, borderRadius: "12px", padding: "12px 14px 10px" }
                    : {}),
            }}
        >
            {grouped && (
                <AiGeneratedBadge
                    label="AI GENERATED"
                    className={`${classPrefix}__definition-facts-badge`}
                    sx={{ marginBottom: "9px" }}
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
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: "5px 16px", marginTop: "8px" }}>
                        {posList.map((pos) => {
                            const senses = posCounts.get(pos);
                            return (
                                <Typography
                                    component="b"
                                    key={pos}
                                    className={`${classPrefix}__definition-facts-pos-term`}
                                    sx={{ fontSize: 12.5, fontWeight: WEIGHT.semibold, letterSpacing: "-0.012em", color: fc.onSurface }}
                                >
                                    {pos}
                                    {senses !== undefined && (
                                        <Typography
                                            component="em"
                                            sx={{
                                                fontStyle: "normal",
                                                fontFamily: FONTS.mono,
                                                fontSize: 9,
                                                letterSpacing: "0.06em",
                                                color: COLORS.textFaint,
                                                marginLeft: "5px",
                                            }}
                                        >
                                            {senses}
                                        </Typography>
                                    )}
                                </Typography>
                            );
                        })}
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
                                <FrequencyScoreDots
                                    score={commonalityScore}
                                    filledColor={fc.onSurface}
                                    emptyBorderColor={fc.border}
                                />
                                <Typography
                                    component="em"
                                    sx={{ fontStyle: "normal", fontSize: 12.5, fontWeight: WEIGHT.semibold, color: fc.onSurface, letterSpacing: "-0.01em" }}
                                >
                                    {commonalityScore}/5
                                </Typography>
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
                                <Typography
                                    component="em"
                                    sx={{ fontStyle: "normal", fontSize: 12.5, fontWeight: WEIGHT.semibold, color: fc.onSurface, letterSpacing: "-0.01em" }}
                                >
                                    {entry.language === "zh" ? `HSK ${entry.difficulty}` : entry.difficulty}
                                </Typography>
                            </Box>
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
};

export default DefinitionFacts;
