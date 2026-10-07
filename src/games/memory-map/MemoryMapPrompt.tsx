import React from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import SpeakerButton from "../../components/SpeakerButton";
import { COLORS, RAMP } from "../../theme/colors";
import { useGameSurfaceHue } from "../shared/gameSurface";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import TonedPronunciation from "../../components/TonedPronunciation";
import type { PromptPhase } from "./types";

/**
 * The in-game prompt bar — ONE COMPACT ROW above the map
 * (docs/MEMORY_MAP_GAME.md § 3.1, § 6).
 *
 * It used to be four stacked rows — gloss, a standing hint line, the spoiler and the try
 * pips — which cost roughly a fifth of a phone screen before the map got any. On a game
 * whose whole subject is a board you have to search, that vertical budget belongs to the
 * board. The hint line ("Find this word on your map") is gone entirely.
 *
 * It stays an IN-GAME bar rather than being folded into the page header. An earlier
 * revision did fold it in, which bought a little more space at the cost of the page
 * title and of putting the question in amongst the chrome — the question deserves its
 * own line, it just does not deserve four.
 *
 * The row is: gloss · pronunciation · speaker · Skip. The gloss is the only element
 * allowed to shrink, so a long definition ellipsizes rather than pushing the pinyin,
 * the speaker or the Skip button off the end.
 *
 * ── NO TRY PIPS, NO RED BAR (owner, 2026-10-06) ──────────────────────────────
 * The bar used to end in three try pips, and on the third miss its fill turned red (Q17)
 * to send the player looking for the failed word. Both are gone: the bar never changes
 * colour and shows no try count. The failed target's red PULSE on the map
 * (MemoryMapWord.tsx) is now the whole find-the-failed-word affordance — still no camera
 * ease, no edge arrow, no directional hint, because searching IS the game. The phase
 * still reaches the bar, but only to relabel the skip button.
 */

interface MemoryMapPromptProps {
    /** The dd, already sense-resolved server-side. */
    definition: string | null;
    /** Only relabels the skip button (skip vs. give up); the bar itself never changes. */
    phase: PromptPhase;
    /** The target's pronunciation, shown beside the gloss. */
    pronunciation: string | null;
    /** Replays the target's word — MANUAL narration, so it speaks even when muted. */
    onSpeak: () => void;
    /** True while that replay is loading or playing (the speaker's spinner). */
    speaking: boolean;
    onSkip: () => void;
    canSkip: boolean;
}

const MemoryMapPrompt: React.FC<MemoryMapPromptProps> = ({
    definition,
    phase,
    pronunciation,
    onSpeak,
    speaking,
    onSkip,
    canSkip,
}) => {
    const failed = phase === "failed";
    // The game's hue, from the GameSurfaceProvider the page mounts (null off-surface).
    const hue = useGameSurfaceHue();

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
                // The in-game strip's house treatment, matching `GameHud`
                // (src/games/shared/GameFrame.tsx): the game hue's near-white TINT with a
                // full-ink hairline under it, so it reads as the same band of chrome as
                // every other game's HUD. Follows `GAME_HUE` (blue) automatically. One
                // fill in every phase — the failed-state red is gone (see docblock).
                backgroundColor: hue ? RAMP[hue].tint : COLORS.header,
                borderBottom: `1px solid ${hue ? COLORS.onSurface : COLORS.rowBorder}`,
            }}
        >
            <Typography
                className="memory-map-prompt__gloss"
                sx={{
                    // flex:1 + minWidth:0 is what lets the gloss ellipsize instead of
                    // shoving the pinyin and the skip button off the end of the row.
                    flex: 1,
                    minWidth: 0,
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.bodyLg,
                    fontWeight: WEIGHT.bold,
                    // Ink in every state.
                    color: COLORS.onSurface,
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
                    button. It should also be unreachable now: a null target
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
            {pronunciation && (
                <TonedPronunciation
                    pronunciation={pronunciation}
                    className="memory-map-prompt__pronunciation"
                    fontSize={SIZE.body}
                    sx={{ flexWrap: "nowrap", flexShrink: 0 }}
                />
            )}

            {/* ── SPEAKER ─────────────────────────────────────────────────────────
                Replays the target's word (§ 3.1a). The prompt also autoplays it when it
                appears, but autoplay is muted by the header chip; this is the manual
                path, which speaks in every mode (docs/AUDIO_PLAYBACK.md § 4) — the
                learner's one way to hear the word on demand. Shown only with a word. */}
            {definition !== null && <SpeakerButton onClick={onSpeak} isLoading={speaking} />}

            {/* ── SKIP ────────────────────────────────────────────────────────────
                Sends the word to the back of the queue, to come back later with a fresh
                three tries and no mark written.

                In the FAILED state it means something different — it accepts the red and
                moves on — because the outcome is already decided by then and requeuing
                would let a player dodge every negative mark. The word "Skip" stays put
                either way; only the aria-label changes, since "move past this word"
                describes both.

                A WORDED button since 2026-10-06 (owner; it was a skip-next icon, which
                read as "next track" rather than as an action on the question). An
                outlined pill per the house rule for tappable buttons (CLAUDE.md §
                Buttons & cards: 1px `COLORS.border`). */}
            <ButtonBase
                className="memory-map-prompt__skip"
                onClick={onSkip}
                disabled={!canSkip}
                aria-label={failed ? "Give up on this word" : "Skip this word for now"}
                sx={{
                    flexShrink: 0,
                    // Compact (owner, 2026-10-06: "a little smaller"; was 8px 16px at
                    // body size). Kept on the chrome's 8px grid (§ 14.5b), so the step
                    // down is the side padding and the type, not an off-grid 4/12.
                    padding: "8px",
                    borderRadius: "999px",
                    backgroundColor: COLORS.white,
                    border: `1px solid ${COLORS.border}`,
                    fontFamily: FONTS.sans,
                    fontSize: SIZE.caption,
                    fontWeight: WEIGHT.bold,
                    lineHeight: 1,
                    color: COLORS.onSurface,
                    "&.Mui-disabled": { opacity: 0.4 },
                }}
            >
                Skip
            </ButtonBase>
        </Box>
    );
};

export default MemoryMapPrompt;
