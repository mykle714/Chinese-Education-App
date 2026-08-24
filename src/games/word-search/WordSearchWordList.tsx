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
 * meaning, hunt the Chinese), set as ONE INLINE RUN separated by middots.
 *
 * ── THE PILLS ARE GONE (2026-08-24) ──────────────────────────────────────────────────
 * This list was the design's `.chip`s — a solid ink pill per pending word, an outlined
 * struck-through one per found word. Ten black pills are the loudest thing on the screen,
 * and the screen's subject is the BOARD; the list is the reference you glance at between
 * traces. Set inline and small, it reads as a caption under the section header instead of
 * as a second board competing with the first.
 *
 * ⚠️ This reinstates a shape that was replaced once, so the reason it was replaced is
 * worth keeping: a middot run makes a multi-word gloss ("job interview") hard to tell
 * from two adjacent one-word ones. Two things answer that here — the separator is FAINT
 * and widely spaced (a 7px gap on each side against a 4px word space), and each gloss is
 * still its own element, so a found word strikes through exactly its own words and the
 * boundary becomes visible the moment anything is found. If it still reads ambiguously,
 * the next lever is `stripParentheses`-style trimming to a single word, not a return to
 * boxes.
 *
 * Two states, and only two:
 *   pending — full ink. Still the loud one relative to its neighbours: a pending gloss
 *             is the game's actual instruction ("go find this").
 *   found   — struck through and faded. A found word is not deleted: the list is also
 *             the record of what the run has covered, and the fade is what makes the
 *             remaining work countable at a glance.
 *
 * The HINTED word deliberately has NO state of its own. The `.hintbar` reveal already
 * names it, spelled out character by character, one row above — a third treatment would
 * say the same thing in a weaker way.
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
                // The gap IS the separator's breathing room: 7px on each side of a middot
                // against the ~4px of a word space, so the dot groups with neither gloss.
                alignItems: "baseline",
                gap: "0 7px",
                rowGap: "3px",
                padding: "9px 15px 0",
            }}
        >
            {words.map((w, i) => {
                // Keep each gloss short so the set tiles into a couple of rows: take the
                // lead sense (before the first comma/semicolon) after stripping parens.
                const gloss = stripParentheses(w.definition || "")
                    .split(/[,;]/)[0]
                    .trim();
                const isFound = found.has(w.entryKey);
                return (
                    // A fragment per word, so the separator is a SIBLING of the gloss
                    // rather than a child of it — a `::before` would be struck through
                    // along with the text it precedes.
                    <React.Fragment key={w.entryKey}>
                        {i > 0 && (
                            <Box
                                component="span"
                                className="word-search__word-list-sep"
                                // Decorative: the list is already a list to a screen
                                // reader by virtue of being separate elements.
                                aria-hidden
                                sx={{
                                    fontFamily: FONTS.sans,
                                    fontSize: 11,
                                    lineHeight: 1.3,
                                    color: COLORS.textFaint,
                                    userSelect: "none",
                                }}
                            >
                                ·
                            </Box>
                        )}
                        <Box
                            component="span"
                            className={`word-search__word-list-item${isFound ? " word-search__word-list-item--found" : " word-search__word-list-item--pending"}`}
                            sx={{
                                fontFamily: FONTS.sans,
                                fontSize: 11,
                                fontWeight: 500,
                                lineHeight: 1.3,
                                // Each gloss stays on ONE line even though the RUN wraps:
                                // a two-word gloss broken across rows is exactly the
                                // ambiguity the middot form is prone to.
                                whiteSpace: "nowrap",
                                maxWidth: "100%",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                color: isFound ? COLORS.textSecondary : COLORS.onSurface,
                                ...(isFound && {
                                    textDecoration: "line-through",
                                    opacity: 0.5,
                                }),
                                transition: "opacity 150ms linear, color 150ms linear",
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
