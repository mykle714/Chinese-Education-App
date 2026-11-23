import { Box } from "@mui/material";
import DismissCue from "../../../../components/hintBubble/DismissCue";
import { COLORS } from "../../../../theme";
import { SIZE, WEIGHT } from "../../../../theme/scale";
import { PAWN_BUBBLE_VARIANT, type PawnHint } from "./pawnHints";
import { splitHintKeywords, type HintBandName } from "./pawnHintLines";

/**
 * PawnHintBody — the inside of the hint pawn's speech bubble: the hint's line, its
 * kind-specific content, and the tap-to-dismiss cue (docs/HINT_PAWN.md § "The bubble" and
 * § "Bubble variants").
 *
 * The layout follows the hint's dialogue-box VARIANT (pawnHints.ts → `PAWN_BUBBLE_VARIANT`):
 *
 *   text   [ line, wrapping ............ ] [cue]     the cue beside the line, bottom-right
 *   cpcd   [ line, one line, never wraps ...... ]
 *          [ cpcd words, centred ....... ] [cue]     the cue takes width from the words row
 *
 * Kinds:
 *   wrong-streak  (text) the line only (a study tip, main + reading).
 *   deck-review   (text) the line only (every world; a review-heavy dive's first card).
 *
 * Every line goes through `HintLine`, which splits its markup
 * (pawnHintLines.ts → `splitHintKeywords`): a `{keyword}` naming an app button is drawn in
 * `COLORS.keywordInk` (Red Salmon), and a `[Band]` name in its band's ink (`BAND_INK`),
 * markup dropped. A line without markup renders as is.
 *
 * The cue is a soft introduction (`pawnDismissCue`, docs/SOFT_INTRODUCTION.md): HintPawn
 * passes `showDismissCue` from `useSoftIntro`. Graduated, the cue is not rendered at all, so
 * it takes no space — the text variant's line and the cpcd variant's words take its width.
 *
 * The cpcd variant has no kind today (the writing world's used-in hint, its one user, was
 * removed 2026-11-22); its layout stays for the next kind that lists words. A tap anywhere
 * on the bubble closes it (HintPawn.tsx, `onSelect` → `closedKey`).
 *
 * Layer: flp page presentation (client). Pure render of the hint it is given.
 *
 * Depended on by: hintPawn/HintPawn.tsx. Docs: docs/HINT_PAWN.md.
 */

/** This component's own padding on every side, px (MUI spacing 0.5). */
const ROOT_PAD = 4;
/**
 * HintBubbleSurface's body padding, px: 4 on the sides, 2 top/bottom. Mirrored here only so
 * the dismiss cue can land on `DISMISS_CUE_INSET` from the bubble's edge.
 */
const BUBBLE_BODY_PAD_X = 4;
const BUBBLE_BODY_PAD_Y = 2;
/**
 * The dismiss cue's distance from the bubble body's bottom and right edges, px — the same
 * on both (owner, 2026-11-08). The cue sits inside this component, so it subtracts the
 * surface's and this root's padding to land there (a negative margin pulls it into the root's
 * padding on the right).
 */
const DISMISS_CUE_INSET = 6;

/**
 * The cue for tap-to-dismiss (the whole bubble is the target). Shared by both variants;
 * the cue itself is the shared DismissCue (src/components/hintBubble/DismissCue.tsx), placed
 * here so it lands DISMISS_CUE_INSET from the bubble's edges.
 */
function PawnDismissCue() {
    return (
        <DismissCue
            className="pawn-hint-body__dismiss-cue"
            sx={{
                mr: `${DISMISS_CUE_INSET - BUBBLE_BODY_PAD_X - ROOT_PAD}px`,
                mb: `${DISMISS_CUE_INSET - BUBBLE_BODY_PAD_Y - ROOT_PAD}px`,
            }}
        />
    );
}

/**
 * Each nameable band's text colour (owner, 2026-11-21: the band names in the deck-review line
 * take their band's colour). Inks outside the ramp, since a ramp tier as text is too faint on
 * the white bubble — theme/colors.ts § "In-copy utcm band names".
 */
const BAND_INK: Record<HintBandName, string> = {
    Comfortable: COLORS.comfortableInk,
    Mastered: COLORS.masteredInk,
};

/**
 * A hint line with its `{keyword}` runs drawn in Red Salmon (`COLORS.keywordInk`) and its
 * `[Band]` runs in their band's ink (`BAND_INK`).
 */
function HintLine({ line }: { line: string }) {
    return (
        <>
            {splitHintKeywords(line).map((run, i) =>
                run.band ? (
                    <Box
                        key={i}
                        component="span"
                        className={`pawn-hint-body__band pawn-hint-body__band--${run.band.toLowerCase()}`}
                        sx={{ color: BAND_INK[run.band] }}
                    >
                        {run.text}
                    </Box>
                ) : run.keyword ? (
                    <Box key={i} component="span" className="pawn-hint-body__keyword" sx={{ color: COLORS.keywordInk }}>
                        {run.text}
                    </Box>
                ) : (
                    run.text
                ),
            )}
        </>
    );
}

/** The cpcd variant's content row, by kind (the row the dismiss cue shares). */
function CpcdRowContent({ hint }: { hint: PawnHint }) {
    // No cpcd kind exists today; a new one adds its case here.
    switch (hint.kind) {
        default:
            return null;
    }
}

export default function PawnHintBody({
    hint,
    line,
    showDismissCue,
}: {
    hint: PawnHint;
    line: string;
    /** The `pawnDismissCue` si's intro style: draw the "Tap / to / dismiss" cue. */
    showDismissCue: boolean;
}) {
    const variant = PAWN_BUBBLE_VARIANT[hint.kind];
    const lineSx = { fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface, lineHeight: 1.3 };

    return (
        <Box
            className={`pawn-hint-body pawn-hint-body--${variant}`}
            sx={{
                // Fills the bubble's content box (minHeight 0 lets it shrink to the bubble's
                // capped height), so the cue keeps its bottom-right spot when content clips.
                flex: "1 1 auto",
                minHeight: 0,
                alignSelf: "stretch",
                display: "flex",
                flexDirection: variant === "text" ? "row" : "column",
                alignItems: variant === "text" ? "stretch" : "flex-start",
                gap: 0.5,
                p: `${ROOT_PAD}px`,
            }}
        >
            {variant === "text" ? (
                <>
                    {/* The line wraps freely; anything past the bubble's cap clips here, not the cue. */}
                    <Box className="pawn-hint-body__line" sx={{ ...lineSx, flex: 1, minWidth: 0, overflow: "hidden" }}>
                        <HintLine line={line} />
                    </Box>
                    {showDismissCue && <PawnDismissCue />}
                </>
            ) : (
                <>
                    {/* ONE line, never wrapped (owner, 2026-11-08): a second line would push the
                        cpcd words off the bubble's bottom. Copy is kept under CPCD_LINE_MAX_CHARS;
                        the ellipsis only catches a narrower-than-planned screen. */}
                    <Box
                        className="pawn-hint-body__line"
                        sx={{ ...lineSx, alignSelf: "stretch", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                        <HintLine line={line} />
                    </Box>
                    <Box className="pawn-hint-body__cpcd-row" sx={{ alignSelf: "stretch", display: "flex", alignItems: "flex-end", gap: 0.75 }}>
                        <CpcdRowContent hint={hint} />
                        {showDismissCue && <PawnDismissCue />}
                    </Box>
                </>
            )}
        </Box>
    );
}
