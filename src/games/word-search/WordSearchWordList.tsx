import React from "react";
import { Box } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { HINT_ACCENT_COLOR } from "./constants";
import { stripParentheses } from "../../utils/definitionUtils";
import type { PlacedWord } from "./types";

interface WordSearchWordListProps {
    words: PlacedWord[];
    /** entryKeys already found (struck through). */
    found: Set<string>;
    /** The entryKey the hint bar is currently spelling out, or null when no hint
     *  is active. Highlighted in the hint ink so the mask one row above is
     *  visibly attached to the gloss it belongs to. */
    hintEntryKey?: string | null;
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
 * A third state, added 2026-08-28: the HINTED word is tinted in `HINT_ACCENT_COLOR`, the
 * same ink the `.hintbar` lightbulb, charge dots and reveal mask use. It previously had no
 * state at all, on the theory that the reveal one row above already named it — but the
 * reveal names it in PINYIN (or in component glyphs), which is precisely the thing the
 * player cannot yet read, so nothing on screen connected the mask to the meaning it was
 * spelling. The tint is the connection, and it costs no layout: colour only, no weight or
 * size change, so the run's rhythm is unchanged. A hinted word that gets FOUND drops the
 * tint — found beats hinted, and the hint state is cleared at that moment anyway
 * (`WordSearchPage`'s `onFound`).
 *
 * Wraps freely; the row band it sits in is allowed to scroll if a long set overflows.
 * See docs/WORD_SEARCH_GAME.md §3.
 */
const WordSearchWordList: React.FC<WordSearchWordListProps> = ({ words, found, hintEntryKey = null }) => {
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
                // Found beats hinted: a struck-through gloss keeps the faded treatment
                // even if the hint row was still pointed at it when it was found.
                const isHinted = !isFound && w.entryKey === hintEntryKey;
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
                            className={`word-search__word-list-item${
                                isFound
                                    ? " word-search__word-list-item--found"
                                    : " word-search__word-list-item--pending"
                            }${isHinted ? " word-search__word-list-item--hinted" : ""}`}
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
                                color: isFound
                                    ? COLORS.textSecondary
                                    : isHinted
                                    ? HINT_ACCENT_COLOR
                                    : COLORS.onSurface,
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
