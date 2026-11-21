import type { ReactNode } from "react";
import { ButtonBase } from "@mui/material";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { WEIGHT } from "../theme/scale";
import { keycapPressSx } from "../theme/keycapPress";
import { roundedEdgeRimLightTop } from "../theme/roundedEdge";
import { useEipColors } from "../features/flashcards/FlashcardsLearnPage/useEipPalette";
import { EIP_ADD_KEY_SIZES, type EipAddKeySize } from "../features/flashcards/FlashcardsLearnPage/eipAddKeySizes";

/**
 * ReaderMoreInfoKey — the Reader dictionary keycap's "More Info" button (opens the word's
 * eip). Built as the Add key beside it (EipAddKey; owner's calls 2026-11-17), shape
 * included — its rounded rectangle (`radius`), not the flp More Info's capsule, and no ↑
 * arrow (there is no sheet edge below it to point at): the eip palette's `face` on an `edge` lip, the app's 1px
 * outline ring, the hairline rounded edge, the same lip / lift / sink per size
 * (`EIP_ADD_KEY_SIZES`, the Add key's resting "Add" state) and its label type (FONTS.sans,
 * semibold, sentence case) in `ink`. `useEipColors` gives the light palette outside an
 * eip provider.
 *
 * Two sizes, as EipAddKey: `regular` side by side; `compact` when the keycap stacks the
 * pair under a long headword (VocabDisplayCard `renderHeaderActions`). Each is fixed to
 * the Add key's width at that size.
 *
 * The key itself is `ReaderKeycapButton` (exported below) — the generic labelled keycap; the
 * rdb sentence face's Explain key (ReaderSentenceFace) is the same button with an AI sparkle
 * in front of its label, so the two can never drift apart.
 *
 * Layer: shared component (src/reading — the reading engine shared by the Reader and cyoa, docs/CYOA_FEATURE.md § 4). Depended on by ReaderDocumentPage,
 * ReaderSentenceFace (`ReaderKeycapButton`).
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Look (Keycap word actions), § "Sentence Explain".
 */

// Vertical padding only: at both sizes the key is the Add key's fixed width
// (EIP_ADD_KEY_SIZES `width`: 92 / 80; owner's call 2026-11-17) with its label centred,
// so the pair reads as one set side by side and one column stacked.
const PADDING = { regular: "6px 0", compact: "4px 0" } as const;

interface ReaderKeycapButtonProps {
    label: string;
    onClick: () => void;
    size?: EipAddKeySize;
    // Descriptive class for this key (e.g. "reader-more-info-key"); the size modifier is added.
    className: string;
    ariaLabel?: string;
    // Drawn before the label (the Explain key's AI sparkle). Size it to `EIP_ADD_KEY_SIZES[size].icon`.
    startIcon?: ReactNode;
    disabled?: boolean;
}

/**
 * The generic Reader keycap button: the recipe described above, with any label. Fixed to the
 * Add key's width at its size so a row or column of keys reads as one set.
 */
export function ReaderKeycapButton({ label, onClick, size = "regular", className, ariaLabel, startIcon, disabled = false }: ReaderKeycapButtonProps) {
    const k = EIP_ADD_KEY_SIZES[size];
    const colors = useEipColors();
    // EipAddKey's shadow stack, resting "Add" state: outline ring, rim light under it, the
    // lip. No fillet — an outlined key skips it (see EipAddKey; designGuidelines.md
    // § "The rounded edge").
    const ring = `inset 0 0 0 1px ${colors.dark ? "rgba(255, 255, 255, 0.12)" : COLORS.border}`;
    const rim = roundedEdgeRimLightTop(colors.face, 1);
    return (
        <ButtonBase
            className={`${className} ${className}--${size}`}
            aria-label={ariaLabel ?? label}
            onClick={onClick}
            disabled={disabled}
            disableRipple
            sx={{
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: startIcon ? "4px" : 0,
                flexShrink: 0,
                width: k.width,
                padding: PADDING[size],
                // The Add key's corner radius at this size, not the flp's capsule.
                borderRadius: `${k.radius}px`,
                whiteSpace: "nowrap",
                backgroundColor: colors.face,
                color: colors.ink,
                fontFamily: FONTS.sans,
                fontSize: k.fontSize,
                fontWeight: WEIGHT.semibold,
                // The Add key's line box: its 18px / 14px icon sets that key's height, so
                // match it here for equal key heights.
                minHeight: `calc(${k.icon}px + ${PADDING[size].split(" ")[0]} * 2)`,
                ...keycapPressSx({
                    restShadow: `${ring}, ${rim}, 0 ${k.lipAdd}px 0 ${colors.edge}`,
                    pressedShadow: `${ring}, ${rim}`,
                    restY: k.restAddY,
                    pressedY: k.sink,
                }),
            }}
        >
            {startIcon}
            {label}
        </ButtonBase>
    );
}

interface ReaderMoreInfoKeyProps {
    onClick: () => void;
    size?: EipAddKeySize;
}

export default function ReaderMoreInfoKey({ onClick, size = "regular" }: ReaderMoreInfoKeyProps) {
    return (
        <ReaderKeycapButton
            className="reader-more-info-key"
            label="More Info"
            ariaLabel="Open extra info"
            onClick={onClick}
            size={size}
        />
    );
}
