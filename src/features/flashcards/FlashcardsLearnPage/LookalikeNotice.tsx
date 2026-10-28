import { Box } from "@mui/material";
import GlyphSvg from "../../../components/handwriting/GlyphSvg";
import type { LookalikeChar, LookalikeMatch } from "../../../components/handwriting/lookalikes";
import TonedPronunciation from "../../../components/TonedPronunciation";
import { COLORS, FONTS } from "../../../theme";
import { LEADING, SIZE } from "../../../theme/scale";

/**
 * LookalikeNotice — the writing flp back face's explanation of a look-alike miss
 * (docs/WRITING_PRACTICE_REWORK.md § 3c). The learner wrote `match.target`; the
 * recognizer read it as `match.recognized`, a listed look-alike (lookalikes.ts). Shown
 * side by side as printed corpus glyphs — the same stroke shapes Snap paints, so the
 * proportions the tell talks about are exact — with the target's tell underneath, in a
 * centred column narrower than the pair (`tellWidth`, ~60% of the card).
 *
 *     [末] mò        vs        [未] wèi
 *                              yours looks like
 *        末 has two horizontals, and the
 *      top one is longer instead of shorter
 *
 * Sits in the 2×2 block's empty second row, which only 1–2 character words have
 * (WritingCardFace). Its box is its content's height, capped at one cell (`height`): the
 * face measures nothing — its flex layout moves the cells up only by however much this
 * box overlaps the space under a centred row. Not tappable: a tap falls through to the
 * card and dismisses it, like the rest of the back face.
 *
 * Layer: flp presentation (client). Referenced by: WritingCardFace.tsx.
 */
export default function LookalikeNotice({ match, width, height, tellWidth, delayMs = 0 }: {
    match: LookalikeMatch;
    /** px — the 2×2 block's width, and one cell's height (the glyph scale and height cap). */
    width: number;
    height: number;
    /** The tell text's column width, px — centred under the pair. */
    tellWidth: number;
    /** Hold the fade-in this long — the card flip, so it lands on a visible face. */
    delayMs?: number;
}) {
    // Glyphs take a bit under half the slot; the tell line(s) take the rest.
    const glyphPx = Math.round(height * 0.44);
    return (
        <Box
            className="lookalike-notice"
            sx={{
                width,
                maxHeight: height,
                display: "flex",
                flexDirection: "column",
                gap: 0.75,
                boxSizing: "border-box",
                // Fades in with the verdict stamps, once the flip has finished.
                animation: `lookalikeNoticeIn 240ms ease-out ${delayMs}ms both`,
                "@keyframes lookalikeNoticeIn": { from: { opacity: 0 }, to: { opacity: 1 } },
            }}
        >
            <Box className="lookalike-notice__pair" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <LookalikeGlyph item={match.target} color={COLORS.onSurface} glyphPx={glyphPx} />
                <Box className="lookalike-notice__vs" sx={{ fontFamily: FONTS.mono, fontSize: SIZE.caption, color: COLORS.textFaint }}>
                    vs
                </Box>
                <LookalikeGlyph item={match.recognized} label="yours looks like" color={COLORS.textFaint} glyphPx={glyphPx} />
            </Box>
            <Box
                className="lookalike-notice__tell"
                sx={{
                    width: tellWidth,
                    maxWidth: "100%",
                    alignSelf: "center",
                    textAlign: "center",
                    fontSize: SIZE.caption,
                    lineHeight: LEADING.normal,
                    color: COLORS.textSecondary,
                    display: "-webkit-box",
                    // The narrow column wraps the longest tells (壬, 矢) to three lines.
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                }}
            >
                {/* "<char> <predicate>" — the tell is written to follow its character. */}
                <Box component="span" className="lookalike-notice__tell-char" sx={{ fontFamily: FONTS.cjk, color: COLORS.onSurface }}>
                    {match.target.char}
                </Box>
                {" "}
                {match.target.tell}
            </Box>
        </Box>
    );
}

/** One side of the pair: the printed glyph, then its pinyin over an optional mono label. */
function LookalikeGlyph({ item, label, color, glyphPx }: {
    item: LookalikeChar;
    label?: string;
    color: string;
    glyphPx: number;
}) {
    return (
        <Box className="lookalike-notice__side" sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
            <GlyphSvg className="lookalike-notice__glyph" character={item.char} size={glyphPx} color={color} />
            <Box className="lookalike-notice__side-text" sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.25 }}>
                <TonedPronunciation className="lookalike-notice__pinyin" pronunciation={item.pinyin} fontSize={SIZE.body} />
                {label && (
                    <Box className="lookalike-notice__label" sx={{ fontFamily: FONTS.mono, fontSize: SIZE.micro, color: COLORS.textFaint, whiteSpace: "nowrap" }}>
                        {label}
                    </Box>
                )}
            </Box>
        </Box>
    );
}
