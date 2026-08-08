import { Box, Typography, useTheme } from "@mui/material";
import ValidateFlagButtons from "../../components/ValidateFlagButtons";
import { SIZE, WEIGHT, TRACKING } from "../../theme/scale";
import { FC_FONT } from "./constants";
import type { Language, ValidationField } from "../../types";

interface MetaChipLabelProps {
    // User-facing caption, e.g. "Difficulty" / "Parts of Speech" / "Commonality".
    label: string;
    // The validation field this chip's value comes from — decides what an
    // Approve/Flag here records (docs/DATA_VALIDATION_SYSTEM.md).
    field: ValidationField;
    // Headword + language identifying the det row. `language` is absent on
    // det-fallback entries; without it there is no row to validate, so the
    // buttons are omitted and only the caption renders.
    word1: string;
    language?: Language;
    // For a per-sense chip (Commonality on a clustered word), the sense cluster the
    // displayed value belongs to — threaded straight to ValidateFlagButtons, which needs
    // it to address the right `validations` row (migration 139). Omit on entry-level chips.
    senseLabel?: string | null;
    // This chip's read-path approval flag. Passed straight through as
    // ValidateFlagButtons' pre-fetch fallback so an already-approved chip
    // doesn't flash empty outline buttons on mount.
    approved?: boolean;
    // BEM-ish prefix for the emitted class names, so the cdp and eip strips stay
    // distinguishable in the DOM (e.g. "vocab-card-detail" / "mobile-demo").
    classPrefix: string;
}

/**
 * Caption for one definition meta-strip chip: the uppercase label, plus — for
 * validator accounts only — that chip's Approve/Flag pair
 * (docs/DATA_VALIDATION_SYSTEM.md). `ValidateFlagButtons` renders nothing for
 * everyone else, so non-validators see exactly the caption they always saw.
 *
 * ⚠️ The buttons are an ABSOLUTELY-POSITIONED OVERLAY in the chip's top-right
 * corner, deliberately out of flow and with no surface of their own — exactly how the
 * est cards corner their validate/speaker buttons (ExampleSentenceList). They must
 * never change the chip's measured size or displace its text: the three chips sit in
 * a tight horizontal strip, and letting a validator-only control widen, heighten, or
 * reflow them would give validators a different layout from every other user. Hence
 * the fragment (no wrapper box to grow) and the `position: relative` each parent chip
 * carries.
 *
 * Shared by the two meta strips — the cdp's (VocabCardDetailBody) and the eip's
 * (InfoCardPanelBody) — which render the same three chips (Difficulty / Parts of
 * Speech / Commonality) and must not drift apart. It is deliberately a MODULE-level
 * component: declaring it inside either parent's render body would make it a new
 * component type on every render, remounting ValidateFlagButtons and re-firing its
 * status fetch each time.
 */
export default function MetaChipLabel({ label, field, word1, language, senseLabel, approved, classPrefix }: MetaChipLabelProps) {
    const theme = useTheme();
    return (
        <>
            <Typography
                className={`${classPrefix}__meta-chip-label`}
                sx={{
                    fontSize: SIZE.micro,
                    fontWeight: WEIGHT.bold,
                    color: theme.palette.flashcard.textSecondary,
                    letterSpacing: TRACKING.caps,
                    textTransform: "uppercase",
                    fontFamily: FC_FONT,
                }}
            >
                {label}
            </Typography>
            {language && (
                <Box
                    className={`${classPrefix}__validate-${field}`}
                    sx={{ position: "absolute", top: 0, right: 0, zIndex: 2, display: "flex" }}
                >
                    <ValidateFlagButtons
                        word1={word1}
                        language={language}
                        field={field}
                        senseLabel={senseLabel}
                        alreadyApproved={approved}
                        dense
                    />
                </Box>
            )}
        </>
    );
}
