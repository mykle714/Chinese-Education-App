import React from "react";
import { Box } from "@mui/material";
import { SIZE, WEIGHT } from "../../theme/scale";
import { stripParentheses } from "../../utils/definitionUtils";
import { HINT_ACCENT_COLOR } from "./constants";
import type { PlacedWord } from "./types";

interface WordSearchWordListProps {
    words: PlacedWord[];
    /** entryKeys already found (struck through). */
    found: Set<string>;
    /** entryKey of the word the active hint mask is for, or null. */
    hintedEntryKey: string | null;
}

/**
 * The prompt list at the top of the board: the 20 targets shown as their English
 * glosses (a recall drill — read the meaning, hunt the Chinese). Wraps into ~2
 * compact lines. Found glosses strike through + dim. The gloss matching the
 * active hint mask (`WordSearchHintRow`) is tinted `HINT_ACCENT_COLOR` so the
 * player can tell which English word the mask is spelling — see §5a.
 *
 * Typography matches the Bubble Match HUD "Lv 1 · Chill" label
 * (src/games/bubble-match/BubbleStage.tsx): SIZE.body, bold, #6b6b6b. See
 * docs/WORD_SEARCH_GAME.md §3.
 */
const WordSearchWordList: React.FC<WordSearchWordListProps> = ({ words, found, hintedEntryKey }) => {
    return (
        <Box
            className="word-search__word-list"
            sx={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "baseline",
                justifyContent: "center",
                columnGap: 1.25,
                rowGap: 0.25,
                px: 1.5,
                py: 0.75,
            }}
        >
            {words.map((w, i) => {
                // Keep each gloss short so they tile into ~1–2 lines: take the lead
                // sense (before the first comma/semicolon) after stripping parens.
                const gloss = stripParentheses(w.definition || "")
                    .split(/[,;]/)[0]
                    .trim();
                const isFound = found.has(w.entryKey);
                const isHinted = !isFound && w.entryKey === hintedEntryKey;
                return (
                    <React.Fragment key={w.entryKey}>
                        {/* Centered middot separating consecutive glosses (never
                            struck through — it's a divider, not a word). */}
                        {i > 0 && (
                            <Box
                                component="span"
                                aria-hidden
                                className="word-search__word-list-sep"
                                sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: "#c2c2c2", lineHeight: 1.25 }}
                            >
                                &middot;
                            </Box>
                        )}
                        <Box
                            component="span"
                            className={`word-search__word-list-item${isFound ? " word-search__word-list-item--found" : ""}${isHinted ? " word-search__word-list-item--hinted" : ""}`}
                            sx={{
                                fontSize: SIZE.body,
                                fontWeight: WEIGHT.bold,
                                color: isHinted ? HINT_ACCENT_COLOR : "#6b6b6b",
                                lineHeight: 1.25,
                                whiteSpace: "nowrap",
                                maxWidth: "100%",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                ...(isFound && {
                                    textDecoration: "line-through",
                                    opacity: 0.4,
                                }),
                            }}
                        >
                            {gloss || w.entryKey}
                        </Box>
                    </React.Fragment>
                );
            })}
        </Box>
    );
};

export default WordSearchWordList;
