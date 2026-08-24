import { Box, Typography, useTheme } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { AiGeneratedBadge } from "../../components/AiGeneratedBadge";
import { aiGeneratedSurfaceSx } from "../../theme/aiGeneratedStyling";
import { stripParentheses } from "../../utils/definitionUtils";
// `hasSynonymsOrRelated` — the gate both hosts use — lives in definitionUtils, not here:
// they call it before deciding whether to draw a container at all.
import { SIZE, WEIGHT, TRACKING } from "../../theme/scale";
import { FC_FONT } from "./constants";
import type { VocabEntry } from "../../types";

/**
 * Synonyms + Related Words, as one block of content.
 *
 * ── Why this is its own module ────────────────────────────────────────────────
 * These two lists are the ONLY part of the card-detail content that the eip has no
 * tab for (TAB_LABELS is definition/examples/breakdown). When the cdp's sheet body
 * was swapped from `VocabCardSections` to the eip proper (`InfoCardSection`), they
 * needed to live inside the eip's DEFINITION tab — while the read-only dictionary cdp
 * still renders them as its own `SectionCard`. One component, two hosts, so the chips
 * cannot drift apart the way the breakdown grid did before `BreakdownRow`.
 *
 * It renders CONTENT ONLY — no card, no padding of its own. Each host supplies its own
 * container: `VocabCardSections` wraps it in a `SectionCard`, the eip definition tab
 * renders it under `DefinitionFacts` (see InfoCardTabContent).
 *
 * Provenance: synonyms are AI-enriched with no validation field of their own, so the
 * whole list always carries the AI treatment — one badge for the list, plus the shared
 * orange surface on each chip. Related words come from the det and carry none.
 *
 * Referenced by docs/VOCAB_ENRICHMENT_IMPLEMENTATION.md (synonyms enrichment) and
 * docs/LEAF_NODE_PAGES.md (cdp content inventory).
 */

interface SynonymsRelatedSectionProps {
    entry: VocabEntry;
    /**
     * Prefix for the BEM-ish class names, so each host keeps its own selectors
     * (`vocab-card-detail__synonyms-list` vs `mobile-demo__synonyms-list`).
     */
    classPrefix: string;
    /** Rendered above each list. Hosts differ in label styling, so they supply it. */
    renderLabel: (text: string, extra?: React.ReactNode) => React.ReactNode;
}

export const SynonymsRelatedSection: React.FC<SynonymsRelatedSectionProps> = ({
    entry,
    classPrefix,
    renderLabel,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    const hasSynonyms = !!entry.synonyms?.length;
    const hasRelatedWords = !!entry.relatedWords?.length;

    return (
        <>
            {hasSynonyms && (
                <>
                    {renderLabel(
                        "Synonyms",
                        <AiGeneratedBadge className={`${classPrefix}__synonyms-ai-badge`} label="AI GENERATED" />
                    )}
                    <Box className={`${classPrefix}__synonyms-list`} sx={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        {entry.synonyms!.map((syn) => {
                            const meta = entry.synonymsMetadata?.[syn];
                            return (
                                <Box
                                    className={`${classPrefix}__synonym-item ${classPrefix}__synonym-item--ai-generated`}
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
                    {renderLabel("Related Words")}
                    <Box className={`${classPrefix}__related-words-list`} sx={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        {entry.relatedWords!.map((rel) => (
                            <Box
                                className={`${classPrefix}__related-word-item`}
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
        </>
    );
};

/**
 * The section's own heading style INSIDE the eip definition tab. The eip has no
 * `SectionLabel` of its own (its tabs are titled by the strip), so this mirrors the
 * `.shelfhd` caption weight used by InfoCardTabContent's TabCaption rather than
 * inventing a third label treatment.
 */
export const EipSectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const theme = useTheme();
    return (
        <Typography
            className="mobile-demo-synonyms-label"
            sx={{
                fontSize: SIZE.micro,
                fontWeight: WEIGHT.bold,
                color: theme.palette.flashcard.textSecondary,
                letterSpacing: TRACKING.caps,
                textTransform: "uppercase",
                fontFamily: FC_FONT,
            }}
        >
            {children}
        </Typography>
    );
};

export default SynonymsRelatedSection;
