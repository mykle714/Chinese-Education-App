import React from "react";
import { Box, Typography } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";

// The specimen surfaces for the font lab. Split out of FontLabPage.tsx so the page
// file stays about STATE (which candidates, loading, pinning, layout) and this one is
// purely what gets drawn.
//
// SHAPE: a flat list of specimens, each rendering ONE cell. FontLabPage draws them as
// a grid — one ROW per specimen, one COLUMN per selected face — so the same surface in
// up to four typefaces sits on a shared baseline. That row alignment is the whole point
// of the compare view, and it is why nothing here sets its own vertical rhythm or
// wraps itself in a card: the grid owns the frame.
//
// No specimen names a font family. Each cell inherits `--cjk-font` from its column,
// which `FONTS.cjk` resolves through (src/theme/fonts.ts) — so these are the REAL
// components (ForeignText → CPCDRow) reading the REAL token, not mock markup.
//
// Every surface mirrors a real app screen at its real size. A face that looks good at
// hero size and falls apart at SIZE.caption is the failure mode a naive specimen sheet
// hides. See src/features/flashcards/card/CardFace.tsx (card front),
// src/features/reader/TextArea.tsx (running text) and
// src/features/studyChallenge/ChallengeHistoryPage.tsx (the xs metadata line).

/** Sample vocabulary, chosen for a spread of stroke counts and tone colors. */
const WORDS: ReadonlyArray<{ word: string; pinyin: string; gloss: string }> = [
    { word: "你好", pinyin: "nǐ hǎo", gloss: "hello" },
    { word: "学习", pinyin: "xué xí", gloss: "to study" },
    { word: "图书馆", pinyin: "tú shū guǎn", gloss: "library" },
    { word: "慢慢", pinyin: "màn màn", gloss: "slowly" },
    { word: "谢谢", pinyin: "xiè xie", gloss: "thanks" },
];

/** A paragraph of running text, the hardest test for a display-intent face. */
const PARAGRAPH = "昨天晚上我们在图书馆里一起学习中文，直到很晚才回家。路上下着小雨，街边的灯把水面照得很亮。";

/**
 * Characters whose PRINT form (hei/song) and HANDWRITTEN model form (kai) differ in
 * ways a learner is graded on — the 亽 vs ⺈ top of 令, the direction of the top stroke
 * in 骨, the counter in 直, the crossing order in 女. If the app is teaching writing
 * (docs/PRACTICE_WRITING.md), which form the reading UI shows is a pedagogical
 * decision, not only an aesthetic one.
 */
const STROKE_FORM_CHECK = "令直骨女心必长门关我";

/** High-stroke-count characters — the legibility floor as size drops. */
const COMPLEXITY_CHECK = "齉龘矗蘸攥蠡鬻纛饕餮鑫";

/** One comparable surface: a grid row in the compare view. */
export interface Specimen {
    /** Stable key. */
    id: string;
    /** Row label. */
    title: string;
    /** What to look for in this row — shown under the label, not per column. */
    hint: string;
    /** The cell. Renders inside a column that has `--cjk-font` set. */
    Render: React.FC;
}

export const SPECIMENS: readonly Specimen[] = [
    {
        id: "hero",
        title: "Hero headword",
        hint: "Card-detail page / flashcard front, xl with tone-colored pinyin. Every face flatters itself at this size.",
        Render: () => (
            <Box sx={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
                <ForeignText language="zh" size="xl" text="爱好" pronunciation="ài hào" />
            </Box>
        ),
    },
    {
        id: "card-front",
        title: "Card front",
        hint: "CardFace at md on the beige card ground — the most-seen surface in the app.",
        Render: () => (
            <Box
                sx={{
                    background: COLORS.cardFace,
                    borderRadius: "12px",
                    padding: "22px 12px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "8px",
                }}
            >
                <ForeignText language="zh" size="md" justifyContent="center" text="图书馆" pronunciation="tú shū guǎn" />
                <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.bodyLg, color: COLORS.textSecondary }}>
                    library
                </Typography>
            </Box>
        ),
    },
    {
        id: "word-list",
        title: "Word list",
        hint: "sm rows — decks, search results, game answers. Check the pinyin stays centered over its character.",
        Render: () => (
            <Box sx={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                {WORDS.map(({ word, pinyin, gloss }) => (
                    <Box key={word} sx={{ display: "flex", alignItems: "flex-end", gap: "12px" }}>
                        <ForeignText language="zh" size="sm" text={word} pronunciation={pinyin} />
                        <Typography
                            sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.textSecondary, paddingBottom: "2px" }}
                        >
                            {gloss}
                        </Typography>
                    </Box>
                ))}
            </Box>
        ),
    },
    {
        id: "running-text",
        title: "Running text",
        hint: "Reader paragraph at bodyLg. Display faces fail here first — look for even color and a steady line rhythm.",
        Render: () => (
            <Typography
                className="font-lab__paragraph"
                sx={{ fontFamily: FONTS.cjk, fontSize: SIZE.bodyLg, lineHeight: LEADING.relaxed, color: COLORS.onSurface }}
            >
                {PARAGRAPH}
            </Typography>
        ),
    },
    {
        id: "small-scale",
        title: "Small scale",
        hint: "caption then micro — challenge history lines, badges, metadata. The legibility floor.",
        Render: () => (
            <>
                <Typography sx={{ fontFamily: FONTS.cjk, fontSize: SIZE.caption, color: COLORS.textSecondary, marginBottom: "6px" }}>
                    {PARAGRAPH}
                </Typography>
                <Typography sx={{ fontFamily: FONTS.cjk, fontSize: SIZE.micro, color: COLORS.textFaint }}>
                    {PARAGRAPH}
                </Typography>
            </>
        ),
    },
    {
        id: "stroke-forms",
        title: "Stroke forms",
        hint: "Print vs handwritten model shapes. A kai face shows the forms the writing drill teaches; hei/song do not.",
        Render: () => (
            <Typography
                sx={{
                    fontFamily: FONTS.cjk,
                    fontSize: SIZE.display,
                    lineHeight: 1.35,
                    color: COLORS.onSurface,
                    letterSpacing: "0.05em",
                }}
            >
                {STROKE_FORM_CHECK}
            </Typography>
        ),
    },
    {
        id: "density",
        title: "Density",
        hint: "High-stroke-count characters at subtitle / body / caption — where strokes merge into a blur.",
        Render: () => (
            <>
                {[SIZE.subtitle, SIZE.body, SIZE.caption].map((size) => (
                    <Typography key={size} sx={{ fontFamily: FONTS.cjk, fontSize: size, lineHeight: 1.5, color: COLORS.onSurface }}>
                        {COMPLEXITY_CHECK}
                    </Typography>
                ))}
            </>
        ),
    },
    {
        id: "weights",
        title: "Weights",
        hint: "Regular vs bold. index.css sets font-synthesis: none, so a single-weight face renders these IDENTICALLY — that is the tell.",
        Render: () => (
            <Box sx={{ display: "flex", gap: "20px", alignItems: "baseline", flexWrap: "wrap" }}>
                <Typography sx={{ fontFamily: FONTS.cjk, fontSize: SIZE.heading, fontWeight: WEIGHT.regular }}>学习中文</Typography>
                <Typography sx={{ fontFamily: FONTS.cjk, fontSize: SIZE.heading, fontWeight: WEIGHT.bold }}>学习中文</Typography>
            </Box>
        ),
    },
];
