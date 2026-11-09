import { Box } from "@mui/material";
import TouchAppOutlinedIcon from "@mui/icons-material/TouchAppOutlined";
import ForeignText from "../../../../components/ForeignText";
import { COLORS } from "../../../../theme";
import { SIZE, WEIGHT } from "../../../../theme/scale";
import { PAWN_BUBBLE_VARIANT, type PawnHint, type UsedInPawnHint } from "./pawnHints";
import { splitHintKeywords } from "./pawnHintLines";

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
 *   used-in       (cpcd) up to 2 words side by side, each its word (the card's character
 *                 masked as ? unless the level previews it) with pinyin over it, and its dd
 *                 under it, truncated with an ellipsis. The cpcd is size "xs" (owner,
 *                 2026-11-08), one step below the card-edge bubbles' "sm".
 *   wrong-streak  (text) the line only (a study tip, main + reading).
 *
 * Every line goes through `HintLine`, which splits its `{keyword}` markup
 * (pawnHintLines.ts → `splitHintKeywords`): a word naming an app button is drawn in
 * `COLORS.keywordInk` (Red Salmon), braces dropped. A line without braces renders as is.
 *
 * The cue is a soft introduction (`pawnDismissCue`, docs/SOFT_INTRODUCTION.md): HintPawn
 * passes `showDismissCue` from `useSoftIntro`. Graduated, the cue is not rendered at all, so
 * it takes no space — the text variant's line and the cpcd variant's words take its width.
 *
 * No word opens on its own: the eip is gated until submit on the writing flp. A tap anywhere
 * on the bubble closes it instead (HintPawn.tsx, `onSelect` → `closedKey`).
 *
 * Layer: flp page presentation (client). Pure render of the hint it is given.
 *
 * Depended on by: hintPawn/HintPawn.tsx. Docs: docs/HINT_PAWN.md.
 */

/** Widest one used-in word's column may grow before its dd truncates, px. */
const WORD_COLUMN_MAX = 112;

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
 * The dismiss cue's text size: 10px, ONE STEP BELOW the type scale's smallest token
 * (`SIZE.micro`, 11px) — owner asked for it smaller still (2026-11-08). A local value, not
 * a token; a few other spots inline 10px too (e.g. card/SensePicker.tsx).
 */
const DISMISS_CUE_FONT_SIZE = "0.625rem";

/** The cue for tap-to-dismiss (the whole bubble is the target). Shared by both variants. */
function DismissCue() {
    return (
        // Three short right-aligned lines, a tapping hand beside the middle "to" (owner, 2026-11-08).
        <Box
            className="pawn-hint-body__dismiss-cue"
            sx={{
                flexShrink: 0,
                alignSelf: "flex-end",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                mr: `${DISMISS_CUE_INSET - BUBBLE_BODY_PAD_X - ROOT_PAD}px`,
                mb: `${DISMISS_CUE_INSET - BUBBLE_BODY_PAD_Y - ROOT_PAD}px`,
                fontSize: DISMISS_CUE_FONT_SIZE,
                fontWeight: WEIGHT.semibold,
                lineHeight: 1.1,
                color: COLORS.textSecondary,
            }}
        >
            <span className="pawn-hint-body__dismiss-line">Tap</span>
            <Box component="span" className="pawn-hint-body__dismiss-line" sx={{ display: "flex", alignItems: "center", gap: "2px" }}>
                <TouchAppOutlinedIcon className="pawn-hint-body__dismiss-icon" sx={{ fontSize: 12 }} />
                to
            </Box>
            <span className="pawn-hint-body__dismiss-line">dismiss</span>
        </Box>
    );
}

/** A hint line with its `{keyword}` runs drawn in Red Salmon (`COLORS.keywordInk`). */
function HintLine({ line }: { line: string }) {
    return (
        <>
            {splitHintKeywords(line).map((run, i) =>
                run.keyword ? (
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

/** The used-in kind's words: up to 2 xs cpcds with their dd, centred in the row's free width. */
function UsedInWords({ hint }: { hint: UsedInPawnHint }) {
    return (
        <Box
            className="pawn-hint-body__used-in"
            sx={{ flex: 1, minWidth: 0, display: "flex", gap: 1.5, alignItems: "flex-start", justifyContent: "center" }}
        >
            {hint.items.map((item) => (
                <Box
                    key={item.entryKey}
                    className="pawn-hint-body__used-in-word"
                    sx={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: WORD_COLUMN_MAX, minWidth: 0 }}
                >
                    <ForeignText
                        className="pawn-hint-body__used-in-text"
                        language="zh"
                        text={item.entryKey}
                        maskChar={hint.maskChar}
                        pronunciation={item.pronunciation}
                        showPinyin={!!item.pronunciation}
                        size="xs"
                    />
                    {item.definition && (
                        <Box
                            className="pawn-hint-body__used-in-definition"
                            sx={{
                                maxWidth: "100%",
                                px: 0.25,
                                fontSize: SIZE.caption,
                                color: COLORS.textSecondary,
                                lineHeight: 1.3,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                        >
                            {item.definition}
                        </Box>
                    )}
                </Box>
            ))}
        </Box>
    );
}

/** The cpcd variant's content row, by kind (the row the dismiss cue shares). */
function CpcdRowContent({ hint }: { hint: PawnHint }) {
    switch (hint.kind) {
        case "used-in":
            return <UsedInWords hint={hint} />;
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
                    {showDismissCue && <DismissCue />}
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
                        {showDismissCue && <DismissCue />}
                    </Box>
                </>
            )}
        </Box>
    );
}
