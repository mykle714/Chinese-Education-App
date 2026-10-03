import { useEffect, useState } from "react";
import { Box, IconButton } from "@mui/material";
import Icon from "../../../components/Icon";
import { useAuth } from "../../../AuthContext";
import { useTTS } from "../../../hooks/useTTS";
import { fetchWordOfTheDay, localDayKey, type WordOfTheDay } from "../../../api/wordOfTheDay";
import { getToneColor } from "../../../utils/toneColors";
import type { VocabEntry } from "../../../types";
import { COLORS, RAMP, type RampHue } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT, TRACKING } from "../../../theme/scale";

/**
 * The "Word of the day" card at the top of both Mastery Centers (design frames r1 / w1,
 * docs/READING_WRITING_CENTERS.md § Phase 3).
 *
 *   ┌ WORD OF THE DAY ───────────────────── 🔊 ┐
 *   │ ┌──────┐ xiū                              │
 *   │ │  休  │ to rest; to stop                 │
 *   │ │(grid)│ [亻] person · rén   RADICAL      │
 *   │ └──────┘ [木] tree · mù                   │
 *   │ ───────────────────────────────────────── │
 *   │ A person leaning against a tree — …       │
 *   └───────────────────────────────────────────┘
 *
 * GLOBAL: every learner gets the same character on the same local date
 * (`GET /api/dictionary/word-of-the-day`, WordOfTheDayService). The glyph sits on the
 * card face with a dashed 米-grid guide in the Center's hue — the same guide the
 * Practice Writing panel draws — and the parts' tiles and the radical tag take that
 * hue's tint / mid tiers, so the card belongs to whichever Center it is on.
 *
 * The body (parts + explanation) is null until the day's one model call succeeds; the
 * card then shows the character, pinyin and dd alone rather than an empty frame.
 *
 * Renders nothing while loading, on error, or for a non-zh learner (the word is a
 * Chinese character; Centers are reachable by URL for any account).
 *
 * Layer: feature component (src/features/flashcards/centers). Data via
 * `src/api/wordOfTheDay.ts`.
 */
interface WordOfTheDayCardProps {
    /** The Center's hue — the guide grid, part tiles and radical tag are drawn in it. */
    hue: RampHue;
}

/** The dashed 米-grid guide behind the glyph, stroked in the Center's mark tier. */
const guideGridSvg = (stroke: string) =>
    `url("data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>` +
        `<g stroke='${stroke}' stroke-opacity='.45' stroke-width='1' stroke-dasharray='3 3' fill='none'>` +
        `<path d='M50 0V100M0 50H100M0 0L100 100M100 0L0 100' vector-effect='non-scaling-stroke'/></g></svg>`
    )}")`;

const WordOfTheDayCard: React.FC<WordOfTheDayCardProps> = ({ hue }) => {
    const { user, isAuthenticated } = useAuth();
    const tts = useTTS();
    const [word, setWord] = useState<WordOfTheDay | null>(null);
    const language = user?.selectedLanguage;

    // Keyed on isAuthenticated, not the token: a silent refresh must not refetch
    // (CLAUDE.md "Never reload/reset a page on a silent token refresh").
    useEffect(() => {
        if (!isAuthenticated || language !== "zh") return;
        let cancelled = false;
        fetchWordOfTheDay(localDayKey())
            .then((w) => { if (!cancelled) setWord(w); })
            .catch((err) => console.error("[WordOfTheDay] fetch failed:", err));
        return () => { cancelled = true; };
    }, [isAuthenticated, language]);

    if (!word || language !== "zh") return null;
    const ramp = RAMP[hue];
    const parts = word.content?.parts ?? [];

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
                <Box component="span" sx={{ fontFamily: FONTS.label, fontSize: 10, letterSpacing: TRACKING.caps, textTransform: "uppercase", color: COLORS.iconColor }}>
                    Word of the day
                </Box>
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

            <Box className="word-of-the-day__main" sx={{ display: "flex", gap: "14px", alignItems: "stretch" }}>
                <Box
                    className="word-of-the-day__glyph"
                    sx={{
                        position: "relative",
                        width: 104,
                        minHeight: 104,
                        flexShrink: 0,
                        borderRadius: "14px",
                        backgroundColor: COLORS.cardFace,
                        border: `1px solid ${COLORS.rowBorder}`,
                        backgroundImage: guideGridSvg(ramp.mark),
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

                <Box className="word-of-the-day__detail" sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                    {word.pronunciation && (
                        <Box component="span" sx={{ fontFamily: FONTS.sans, fontSize: 15, fontWeight: WEIGHT.semibold, color: getToneColor(word.pronunciation) }}>
                            {word.pronunciation}
                        </Box>
                    )}
                    <Box component="span" sx={{ fontFamily: FONTS.sans, fontSize: 15, fontWeight: WEIGHT.semibold, letterSpacing: "-0.015em", color: COLORS.onSurface }}>
                        {word.dd}
                    </Box>
                    {parts.length > 0 && (
                        <Box className="word-of-the-day__parts" sx={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "9px" }}>
                            {parts.map((part, i) => (
                                <Box key={`${part.char}-${i}`} className="word-of-the-day__part" sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <Box
                                        component="span"
                                        sx={{
                                            width: 28, height: 28, flexShrink: 0, borderRadius: "8px",
                                            backgroundColor: ramp.tint, border: `1px solid ${COLORS.rowBorder}`,
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            // Component glyphs (亻, ⺮ …) need the component subset font
                                            // where Noto Sans SC lacks them — FONTS.hanziComponents.
                                            fontFamily: FONTS.hanziComponents, fontSize: 16, fontWeight: WEIGHT.bold, color: COLORS.onSurface,
                                        }}
                                    >
                                        {part.char}
                                    </Box>
                                    <Box component="span" sx={{ flex: 1, minWidth: 0, fontFamily: FONTS.sans, fontSize: 12, lineHeight: 1.25, color: COLORS.iconColor }}>
                                        <Box component="b" sx={{ color: COLORS.onSurface, fontWeight: WEIGHT.semibold }}>{part.gloss}</Box>
                                        {" · "}{part.pinyin}
                                    </Box>
                                    {part.isRadical && (
                                        <Box component="span" className="word-of-the-day__radical" sx={{ fontFamily: FONTS.label, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", backgroundColor: ramp.mid, borderRadius: "5px", padding: "2px 5px", color: COLORS.onSurface }}>
                                            radical
                                        </Box>
                                    )}
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
