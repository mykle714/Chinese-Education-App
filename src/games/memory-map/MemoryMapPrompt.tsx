import React from "react";
import { Box, IconButton, Typography } from "@mui/material";
import SkipNextRoundedIcon from "@mui/icons-material/SkipNextRounded";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { getToneColor } from "../../utils/toneColors";
import { MAX_TRIES } from "./constants";
import type { PromptPhase } from "./types";

/**
 * The in-game prompt bar — ONE COMPACT ROW above the map
 * (docs/MEMORY_MAP_GAME.md § 3.1, § 6).
 *
 * It used to be four stacked rows — gloss, a standing hint line, the spoiler and the try
 * pips — which cost roughly a fifth of a phone screen before the map got any. On a game
 * whose whole subject is a board you have to search, that vertical budget belongs to the
 * board. The hint line ("Find this word on your map") is gone entirely: the red-prompt
 * state (below) already carried the only message that ever changed.
 *
 * It stays an IN-GAME bar rather than being folded into the page header. An earlier
 * revision did fold it in, which bought a little more space at the cost of the page
 * title and of putting the question in amongst the chrome — the question deserves its
 * own line, it just does not deserve four.
 *
 * The row is: gloss · pronunciation · skip · try pips. The gloss is the only element allowed to
 * shrink, so a long definition ellipsizes rather than pushing the pinyin or the pips off
 * the end.
 *
 * ── THE RED GLOSS IS THE ENTIRE FIND-THE-FAILED-WORD AFFORDANCE ──────────────
 * On the third miss the gloss itself turns red (Q17). That is deliberately all the help
 * there is: no camera ease toward the target, no edge arrow, no directional hint.
 * Searching IS the game — what the red does is tell the player to stop recalling and
 * start looking for the pulsing word, so they are not still trying to answer a question
 * that is already over.
 */

interface MemoryMapPromptProps {
    /** The dd, already sense-resolved server-side. */
    definition: string | null;
    phase: PromptPhase;
    /** Tries burned on this prompt so far, for the remaining-tries pips. */
    triesUsed: number;
    /** The target's pronunciation, shown beside the gloss. */
    pronunciation: string | null;
    onSkip: () => void;
    canSkip: boolean;
}

/**
 * Pronunciation split into syllables, each in its own tone colour.
 *
 * `getToneColor` reads the tone off ONE syllable's diacritic, so the string has to be
 * split before it can be coloured — colouring the whole string would paint every
 * syllable with the first one's tone. Syllables are space-separated throughout the app
 * (the same convention cpcd zips against characters positionally).
 *
 * Plain `Typography`, NOT `ForeignText`: a romanization is Latin text describing the
 * word, not the word itself, and routing it through the foreign-script container (by
 * claiming a Latin-script language to reach its plain-text branch) would be lying to it
 * about what it is rendering. The tone colours are shared with cpcd via `toneColors`,
 * so the two agree without either owning the other.
 */
const TonedPronunciation: React.FC<{ pronunciation: string }> = ({ pronunciation }) => (
    <Box
        className="memory-map-prompt__pronunciation"
        sx={{ display: "flex", gap: "8px", flexShrink: 0 }}
    >
        {pronunciation.split(/\s+/).filter(Boolean).map((syllable, i) => (
            <Typography
                key={`${syllable}-${i}`}
                component="span"
                className="memory-map-prompt__syllable"
                sx={{
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.caption,
                    fontWeight: WEIGHT.semibold,
                    color: getToneColor(syllable),
                    whiteSpace: "nowrap",
                }}
            >
                {syllable}
            </Typography>
        ))}
    </Box>
);

const MemoryMapPrompt: React.FC<MemoryMapPromptProps> = ({
    definition,
    phase,
    triesUsed,
    pronunciation,
    onSkip,
    canSkip,
}) => {
    const failed = phase === "failed";

    return (
        <Box
            className={`memory-map-prompt memory-map-prompt--${phase}`}
            sx={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: "8px",
                // ONE ROW. This used to be four stacked ones — gloss, a standing hint
                // line, the spoiler and the try pips — which cost close to a fifth of a
                // phone screen before the map got any. The padding is deliberately tight
                // for the same reason: every row of chrome is a row the board loses.
                padding: "8px 16px",
                backgroundColor: COLORS.header,
                borderBottom: `1px solid ${COLORS.rowBorder}`,
            }}
        >
            <Typography
                className="memory-map-prompt__gloss"
                sx={{
                    // flex:1 + minWidth:0 is what lets the gloss ellipsize instead of
                    // shoving the spoiler and the pips off the end of the row.
                    flex: 1,
                    minWidth: 0,
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.bodyLg,
                    fontWeight: WEIGHT.bold,
                    // The one piece of feedback the failed state gives (see docblock).
                    color: failed ? COLORS.dangerInk : COLORS.onSurface,
                    transition: "color 0.25s ease",
                    // Long glosses truncate rather than wrapping the bar to two lines and
                    // undoing the space this layout exists to reclaim.
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}
            >
                {/* NO PLACEHOLDER GLYPH when there is no prompt.
                    This was an em dash, which on a Chinese map reads as 一 — the player
                    sees a character in the question slot and starts hunting for it. Any
                    dash, hyphen or bullet has the same problem against CJK script, so the
                    empty state is genuinely empty; the row keeps its height from the skip
                    button and the pips. It should also be unreachable now: a null target
                    while playing was the symptom of the stranded-cursor bug that
                    `nextPromptIndex` fixes. */}
                {definition ?? ""}
            </Typography>

            {/* ── PRONUNCIATION ───────────────────────────────────────────────────
                Shown outright, beside the gloss.

                It sat behind a "Show pinyin" spoiler at first, on the reasoning that a
                reading drill which printed the pronunciation is really a matching drill.
                That was overruled: the pinyin is now always visible, so the prompt gives
                MEANING and SOUND and the player's job is to find the characters that
                carry them. That is a character-recognition task rather than a
                cold-reading one — a deliberate softening, not an oversight. */}
            {pronunciation && <TonedPronunciation pronunciation={pronunciation} />}

            {/* ── SKIP ────────────────────────────────────────────────────────────
                Sends the word to the back of the queue, to come back later with a fresh
                three tries and no mark written.

                In the FAILED state it means something different — it accepts the red and
                moves on — because the outcome is already decided by then and requeuing
                would let a player dodge every negative mark. The icon stays put either
                way; only the label changes, since "move past this word" describes both. */}
            <IconButton
                className="memory-map-prompt__skip"
                size="small"
                onClick={onSkip}
                disabled={!canSkip}
                aria-label={failed ? "Give up on this word" : "Skip this word for now"}
                sx={{ padding: "8px", color: COLORS.textSecondary, flexShrink: 0 }}
            >
                <SkipNextRoundedIcon sx={{ fontSize: 24 }} />
            </IconButton>

            {/* Tries remaining. Kept beside the gloss rather than in the right-hand
                control cluster: it belongs to the QUESTION, not to the page. */}
            <Box
                className="memory-map-prompt__tries"
                sx={{ display: "flex", gap: "8px", flexShrink: 0 }}
            >
                {Array.from({ length: MAX_TRIES }, (_, i) => (
                    <Box
                        key={i}
                        className={`memory-map-prompt__try memory-map-prompt__try--${i < triesUsed ? "spent" : "left"}`}
                        sx={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: i < triesUsed ? COLORS.dangerInk : COLORS.card,
                            transition: "background-color 0.2s ease",
                        }}
                    />
                ))}
            </Box>
        </Box>
    );
};

export default MemoryMapPrompt;
