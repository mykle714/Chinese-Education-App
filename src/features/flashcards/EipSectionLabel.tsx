import React from "react";
import { Typography, useTheme } from "@mui/material";
import { SIZE, WEIGHT, TRACKING } from "../../theme/scale";
import { FC_FONT } from "./constants";

/**
 * EipSectionLabel — the ONE section-title style of the word panels (eip Definition tab and
 * the cdp body, which share DefinitionFacts): small bold uppercase caption in the palette's
 * muted ink. Every title in the tab uses it, so they cannot drift apart (owner's call
 * 2026-11-07):
 *   • "Other Translations" — EipSenseList
 *   • "Parts of Speech" / "Commonality" / "Difficulty" — MetaChipLabel (DefinitionFacts)
 *   • "Synonyms" / "Related Words" — InfoCardTabContent's `renderLabel` for SynonymsRelatedSection
 *
 * Mirrors the `.shelfhd` caption's size/weight/tracking (`Label`) rather than inventing
 * another label treatment, but is set in the page-header title face (FONTS.sans), not
 * Label's Public Sans. ⚠️ That departs from src/theme/fonts.ts, which names FONTS.label for
 * section labels.
 *
 * Extracted from SynonymsRelatedSection.tsx (2026-11-07) once it had three hosts.
 * Layer: feature component (src/features/flashcards).
 * Docs: docs/SHELF_REDESIGN.md (eip sense list), docs/DATA_VALIDATION_SYSTEM.md (meta-chip captions).
 */
const EipSectionLabel: React.FC<{ children: React.ReactNode; className: string }> = ({ children, className }) => {
    const theme = useTheme();
    return (
        <Typography
            className={className}
            sx={{
                fontSize: SIZE.micro,
                fontWeight: WEIGHT.bold,
                color: theme.palette.flashcard.textSecondary,
                letterSpacing: TRACKING.caps,
                textTransform: "uppercase",
                // FC_FONT = FONTS.sans — the token PageHeader's title uses.
                fontFamily: FC_FONT,
            }}
        >
            {children}
        </Typography>
    );
};

export default EipSectionLabel;
