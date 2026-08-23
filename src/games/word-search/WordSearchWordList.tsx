import React from "react";
import { Box } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { stripParentheses } from "../../utils/definitionUtils";
import type { PlacedWord } from "./types";

interface WordSearchWordListProps {
    words: PlacedWord[];
    /** entryKeys already found (struck through). */
    found: Set<string>;
}

/**
 * The prompt list: the run's targets as their English glosses (a recall drill — read the
 * meaning, hunt the Chinese), drawn as the design's `.chip`s
 * (docs/SHELF_REDESIGN.md § 13, class `.chips`).
 *
 * WHY CHIPS AND NOT THE OLD MIDDOT LIST. The glosses used to run together as one
 * centre-justified paragraph separated by `·`, which made a multi-word gloss ("job
 * interview") hard to tell from two adjacent one-word ones. An outlined chip gives every
 * target its own boundary, so the count on the HUD and the things on screen agree.
 *
 * Two states, and only two:
 *   pending — `.chip.on`, the solid ink pill. This is the LOUD state on purpose: a
 *             pending chip is the game's actual instruction ("go find this"), and it
 *             should be the first thing the eye lands on when it leaves the board.
 *   found   — struck through and faded to the resting outline. A found word is not
 *             deleted: the list is also the record of what the run has covered, and
 *             the fade is what makes the remaining work countable at a glance.
 *
 * The HINTED word deliberately has NO chip state of its own. The `.hintbar` reveal
 * already names it, spelled out character by character, one row above — a third chip
 * treatment would say the same thing in a weaker way, and it would have to be
 * distinguishable from black-pill-pending, which is the strongest ink the row has.
 *
 * Wraps freely; the row band it sits in is allowed to scroll if a long set overflows.
 * See docs/WORD_SEARCH_GAME.md §3.
 */
const WordSearchWordList: React.FC<WordSearchWordListProps> = ({ words, found }) => {
    return (
        <Box
            className="word-search__word-list"
            sx={{
                display: "flex",
                flexWrap: "wrap",
                gap: "7px",
                padding: "9px 15px 0",
            }}
        >
            {words.map((w) => {
                // Keep each gloss short so the set tiles into a couple of rows: take the
                // lead sense (before the first comma/semicolon) after stripping parens.
                const gloss = stripParentheses(w.definition || "")
                    .split(/[,;]/)[0]
                    .trim();
                const isFound = found.has(w.entryKey);
                return (
                    <Box
                        component="span"
                        key={w.entryKey}
                        className={`word-search__word-list-item${isFound ? " word-search__word-list-item--found" : " word-search__word-list-item--pending"}`}
                        sx={{
                            fontFamily: FONTS.sans,
                            fontSize: 12,
                            fontWeight: 500,
                            lineHeight: 1.25,
                            whiteSpace: "nowrap",
                            maxWidth: "100%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            borderRadius: "999px",
                            padding: "7px 12px",
                            border: `1px solid ${isFound ? COLORS.border : COLORS.onSurface}`,
                            backgroundColor: isFound ? "transparent" : COLORS.onSurface,
                            color: isFound ? COLORS.iconColor : COLORS.white,
                            ...(isFound && {
                                textDecoration: "line-through",
                                opacity: 0.45,
                            }),
                            transition: "opacity 150ms linear, background-color 150ms linear, color 150ms linear, border-color 150ms linear",
                        }}
                    >
                        {gloss || w.entryKey}
                    </Box>
                );
            })}
        </Box>
    );
};

export default WordSearchWordList;
