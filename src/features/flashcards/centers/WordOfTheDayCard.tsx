import { useEffect, useState } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import Icon from "../../../components/Icon";
import { useAuth } from "../../../AuthContext";
import { useTTS } from "../../../hooks/useTTS";
import type { WordOfTheDay } from "../../../api/wordOfTheDay";
import { loadWordOfTheDay, peekWordOfTheDay } from "../centerPrefetch";
import { getToneColor } from "../../../utils/toneColors";
import type { VocabEntry } from "../../../types";
import { COLORS, RAMP, type RampHue } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * The "Word of the day" card at the top of both Mastery Centers (design frames r1 / w1,
 * docs/READING_WRITING_CENTERS.md § Phase 3).
 *
 *   ┌ Word of the day ───────────────────── 🔊 ┐
 *   │ ┌──────┐ xiū                              │
 *   │ │  休  │ to rest; to stop                 │
 *   │ │(grid)│ [亻] person · rén                │
 *   │ └──────┘ [木] tree · mù                   │
 *   │ ───────────────────────────────────────── │
 *   │ A person leaning against a tree — …       │
 *   └───────────────────────────────────────────┘
 *
 * GLOBAL: every learner gets the same character on the same local date
 * (`GET /api/dictionary/word-of-the-day`, WordOfTheDayService). The glyph sits on the
 * card face with a dashed 米-grid guide, always in the blue ramp's mark tier whichever
 * Center the card is on. The parts' tiles take the Center's tint tier, so the card still
 * belongs to whichever Center it is on.
 *
 * The body (parts + explanation) is null until the day's one model call succeeds; the
 * card then shows the character, pinyin and dd alone rather than an empty frame.
 *
 * Renders nothing while loading, on error, or for a non-zh learner (the word is a
 * Chinese character; Centers are reachable by URL for any account).
 *
 * Layer: feature component (src/features/flashcards/centers). Data via
 * `centerPrefetch.ts` → `src/api/wordOfTheDay.ts` (the fdp warms it on landing).
 */
interface WordOfTheDayCardProps {
    /** The Center's hue — the part tiles are drawn in it (the guide grid is always blue). */
    hue: RampHue;
}

/** The dashed 米-grid guide behind the glyph, stroked in the given colour. */
const guideGridSvg = (stroke: string) =>
    `url("data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>` +
        `<g stroke='${stroke}' stroke-opacity='.45' stroke-width='1' stroke-dasharray='3 3' fill='none'>` +
        `<path d='M50 0V100M0 50H100M0 0L100 100M100 0L0 100' vector-effect='non-scaling-stroke'/></g></svg>`
    )}")`;

/** Side of the glyph square — the detail column beside it is held to the same height. */
const GLYPH_SIZE = 104;

/**
 * How the parts list packs into the space left under the pinyin + dd lines.
 *
 * 1–2 parts: one per row, "gloss · pinyin". 3+ parts (the contract allows up to 5): a
 * two-column grid of "gloss" only — the per-part pinyin is dropped there for width. Three
 * grid rows (5 parts) need a smaller tile and tighter gap to stay inside the square.
 */
const partsLayout = (count: number) => {
    const twoColumn = count > 2;
    const rows = twoColumn ? Math.ceil(count / 2) : count;
    const tight = rows > 2;
    // Budget: GLYPH_SIZE (104) − pinyin + dd (2 × 18px line + 2px gap) − 2px column gap
    // − PARTS_GAP (8) = 56px for the parts. Two rows: 2 × 22 + 6 = 50. Three rows:
    // 3 × 17 + 2 × 2 = 55.
    return { twoColumn, tile: tight ? 17 : 22, gap: tight ? 2 : 6 };
};

/** Space between the pinyin + dd heading and the parts list. */
const PARTS_GAP = 8;

/** Single-line text that ends in an ellipsis rather than wrapping. */
const ONE_LINE = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as const;

const WordOfTheDayCard: React.FC<WordOfTheDayCardProps> = ({ hue }) => {
    const { user, isAuthenticated } = useAuth();
    const tts = useTTS();
    // Seeded from the fdp's prefetch (centerPrefetch) when it has already landed, so the
    // card is there on the Center's first frame instead of popping in.
    const [word, setWord] = useState<WordOfTheDay | null>(() => peekWordOfTheDay());
    const language = user?.selectedLanguage;

    // Keyed on isAuthenticated, not the token: a silent refresh must not refetch
    // (CLAUDE.md "Never reload/reset a page on a silent token refresh").
    useEffect(() => {
        if (!isAuthenticated || language !== "zh") return;
        let cancelled = false;
        // Joins the fdp's request if it is still in flight; a no-op re-read if it landed.
        loadWordOfTheDay()
            .then((w) => { if (!cancelled) setWord(w); })
            .catch((err) => console.error("[WordOfTheDay] fetch failed:", err));
        return () => { cancelled = true; };
    }, [isAuthenticated, language]);

    if (!word || language !== "zh") return null;
    const ramp = RAMP[hue];
    const parts = word.content?.parts ?? [];
    const layout = partsLayout(parts.length);

    return (
        <Box
            className="word-of-the-day"
            sx={{
                alignSelf: "stretch",
                margin: "14px 22px 0",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                backgroundColor: COLORS.white,
                border: `1px solid ${COLORS.rowBorder}`,
                borderRadius: "18px",
                padding: "14px 15px 15px",
                boxShadow: `0 1px 3px ${COLORS.rowBorder}`,
            }}
        >
            <Box className="word-of-the-day__top" sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {/* Same type as MasteryWindow's `mastery-window__track-label` heading. */}
                <Typography component="b" className="word-of-the-day__title" sx={{ fontSize: 14.5, fontWeight: WEIGHT.bold, letterSpacing: "-0.012em" }}>
                    Word of the day
                </Typography>
                <IconButton
                    className="word-of-the-day__speak"
                    size="small"
                    aria-label={`Play ${word.word}`}
                    // A minimal card-shaped entry: speak() reads entryKey + pronunciation.
                    onClick={() => { void tts.speak({ id: word.detId, entryKey: word.word, pronunciation: word.pronunciation } as VocabEntry); }}
                    sx={{ p: 0.25, color: COLORS.iconColor }}
                >
                    <Icon name="volume_up" size={18} />
                </IconButton>
            </Box>

            <Box className="word-of-the-day__main" sx={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                <Box
                    className="word-of-the-day__glyph"
                    sx={{
                        position: "relative",
                        // Fixed square. The detail column is held to the same height, so the
                        // two always line up top and bottom.
                        width: GLYPH_SIZE,
                        height: GLYPH_SIZE,
                        flexShrink: 0,
                        borderRadius: "14px",
                        backgroundColor: COLORS.cardFace,
                        border: `1px solid ${COLORS.rowBorder}`,
                        backgroundImage: guideGridSvg(RAMP.blu.mark),
                        backgroundSize: "100% 100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: FONTS.cjk,
                        fontSize: 68,
                        fontWeight: WEIGHT.bold,
                        lineHeight: 1,
                        color: COLORS.onSurface,
                    }}
                >
                    {word.word}
                </Box>

                {/* Exactly GLYPH_SIZE tall, its content kept together as one block and centred
                    against the square — a short block (1–2 parts) gets even space above and
                    below instead of a hole in the middle. The dd clamps to one line when parts
                    are shown, three when the body is null. */}
                <Box className="word-of-the-day__detail" sx={{ flex: 1, minWidth: 0, height: GLYPH_SIZE, display: "flex", flexDirection: "column", justifyContent: "center", gap: "2px", overflow: "hidden" }}>
                    {word.pronunciation && (
                        <Box component="span" className="word-of-the-day__pinyin" sx={{ ...ONE_LINE, fontFamily: FONTS.sans, fontSize: 15, lineHeight: 1.2, fontWeight: WEIGHT.semibold, color: getToneColor(word.pronunciation) }}>
                            {word.pronunciation}
                        </Box>
                    )}
                    <Box
                        component="span"
                        className="word-of-the-day__dd"
                        sx={{
                            fontFamily: FONTS.sans, fontSize: 15, lineHeight: 1.2, fontWeight: WEIGHT.semibold, letterSpacing: "-0.015em", color: COLORS.onSurface,
                            display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: parts.length > 0 ? 1 : 3, overflow: "hidden",
                        }}
                    >
                        {word.dd}
                    </Box>
                    {parts.length > 0 && (
                        <Box
                            className="word-of-the-day__parts"
                            sx={{
                                // Separates the parts from the pinyin + dd heading above them.
                                marginTop: `${PARTS_GAP}px`,
                                display: "grid",
                                gridTemplateColumns: layout.twoColumn ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)",
                                gap: `${layout.gap}px 8px`,
                            }}
                        >
                            {parts.map((part, i) => (
                                <Box key={`${part.char}-${i}`} className="word-of-the-day__part" sx={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                                    <Box
                                        component="span"
                                        className="word-of-the-day__part-tile"
                                        sx={{
                                            width: layout.tile, height: layout.tile, flexShrink: 0, borderRadius: "6px",
                                            backgroundColor: ramp.tint, border: `1px solid ${COLORS.rowBorder}`,
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            // Component glyphs (亻, ⺮ …) need the component subset font
                                            // where Noto Sans SC lacks them — FONTS.hanziComponents.
                                            fontFamily: FONTS.hanziComponents, fontSize: Math.round(layout.tile * 0.65), fontWeight: WEIGHT.bold, color: COLORS.onSurface,
                                        }}
                                    >
                                        {part.char}
                                    </Box>
                                    <Box component="span" className="word-of-the-day__part-label" sx={{ ...ONE_LINE, flex: 1, minWidth: 0, fontFamily: FONTS.sans, fontSize: 12, lineHeight: 1.2, color: COLORS.iconColor }}>
                                        <Box component="b" sx={{ color: COLORS.onSurface, fontWeight: WEIGHT.semibold }}>{part.gloss}</Box>
                                        {!layout.twoColumn && <>{" · "}{part.pinyin}</>}
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    )}
                </Box>
            </Box>

            {word.content?.explanation && (
                <Box
                    className="word-of-the-day__why"
                    sx={{ fontFamily: FONTS.sans, fontSize: 12.5, lineHeight: 1.45, color: COLORS.iconColor, borderTop: `1px solid ${COLORS.rowBorder}`, paddingTop: "10px", textWrap: "pretty" }}
                >
                    {word.content.explanation}
                </Box>
            )}
        </Box>
    );
};

export default WordOfTheDayCard;
