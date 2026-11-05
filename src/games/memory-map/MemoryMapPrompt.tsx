import React, { useMemo } from "react";
import { Box, ButtonBase, InputBase } from "@mui/material";
import SpeakerButton from "../../components/SpeakerButton";
import SwipeableTwoLineText, { type TwoLineSegment } from "../../components/SwipeableTwoLineText";
import { buildSenseSegments } from "../../components/senseListSegments";
import {
    DEFINITION_LIST_SEPARATOR,
    resolveSelectedSenseIndex,
    sortedSenseClusters,
} from "../../utils/definitionUtils";
import type { VocabEntry } from "../../types";
import type { MemoryMapWord } from "../../api/memoryMap";
import Icon from "../../components/Icon";
import { KEEP_OPEN_VALUE, LOCKED_SOURCE_ATTRIBUTE, OPT_OUT_ATTRIBUTE } from "../../features/beginnerKeyboard/eligibility";
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
 * Two parts (2026-11-04):
 *   • the CONTROLS ROW — pronunciation · speaker · word finder (§ 3.7) · Skip — on the
 *     in-game strip's tint with its hairline;
 *   • the GLOSS below it, centered, on the map's own WATER with no line under it, so it
 *     reads as the top of the map panel rather than as more chrome. It shows the dd the
 *     way the eip header does ("dd in eip logic", owner): a multi-sense word lists EVERY
 *     sense's dd, `·`-separated, the learner's chosen sense underlined and the default
 *     starred (`buildSenseSegments`, shared with EipEntryHeader); a single-sense word shows
 *     its plain dd. At most two lines, swiped sideways when two are not enough
 *     (`SwipeableTwoLineText`).
 *
 * The gloss block is a FIXED two lines high, whatever the prompt. That costs the map
 * those two lines on every prompt, but it keeps the map's viewport — and therefore the
 * fitted size of every word and the frame the map was packed for (§ 2.4b) — the same
 * from one prompt to the next; a block that grew and shrank with the gloss would rescale
 * the whole map each time.
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
    /** The dd, already sense-resolved server-side — shown alone for a single-sense word. */
    definition: string | null;
    /**
     * The target's sense clusters and the learner's pick (`MemoryMapWord`): a word with
     * ≥2 displayable senses shows the whole sense list instead of the lone dd.
     */
    definitionClusters: MemoryMapWord["definitionClusters"];
    selectedSense: string | null;
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
    /** The word finder's text (§ 3.7). Owned by the Stage, which clears it per prompt. */
    finderQuery: string;
    onFinderChange: (query: string) => void;
}

/**
 * Width of the word finder field, px. Room for the search glyph plus about three
 * characters at body size — most map words are one to three characters, and a longer
 * query scrolls inside the field. On the 8px grid like the rest of the chrome (§ 14.5b).
 */
const FINDER_WIDTH_PX = 96;

/** Gloss type: the prompt's question, so bold body-large, at this line height. */
const GLOSS_LINE_HEIGHT = 1.25;
const GLOSS_FONT_PX = 16; // SIZE.bodyLg

/**
 * The gloss block's fixed height, px: two lines of the gloss plus 8px above and below
 * (the chrome's 8px grid, § 14.5b). Fixed so the map viewport never changes per prompt.
 */
const GLOSS_BLOCK_PX = Math.ceil(2 * GLOSS_FONT_PX * GLOSS_LINE_HEIGHT) + 16;

const MemoryMapPrompt: React.FC<MemoryMapPromptProps> = ({
    definition,
    definitionClusters,
    selectedSense,
    phase,
    pronunciation,
    onSpeak,
    speaking,
    onSkip,
    canSkip,
    finderQuery,
    onFinderChange,
}) => {
    const failed = phase === "failed";
    // The game's hue, from the GameSurfaceContext the break frame provides (null off-surface).
    const hue = useGameSurfaceHue();

    // The eip header's dd logic (EipEntryHeader): the sense list for a word with a real
    // choice of sense, else the plain dd as one segment. Memoized — SwipeableTwoLineText
    // re-measures whenever its segments change identity.
    const glossSegments = useMemo<TwoLineSegment[]>(() => {
        // The wire's cluster type and the client's VocabEntry one are the same shape under
        // two declarations; the resolvers only read glosses, sense, pos and frequencyScore.
        const entry = { definitionClusters, selectedSense } as unknown as Pick<
            VocabEntry,
            "definitionClusters" | "selectedSense"
        >;
        const senses = sortedSenseClusters(entry);
        if (senses) return buildSenseSegments(senses, resolveSelectedSenseIndex(entry), "memory-map-prompt__sense");
        return definition ? [{ text: definition }] : [];
    }, [definition, definitionClusters, selectedSense]);

    return (
        <Box className={`memory-map-prompt memory-map-prompt--${phase}`} sx={{ flexShrink: 0 }}>
        <Box
            className="memory-map-prompt__controls"
            sx={{
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

            {/* Pushes the finder and Skip to the far edge now the gloss has its own block. */}
            <Box className="memory-map-prompt__spacer" sx={{ flex: 1, minWidth: 0 }} />

            {/* ── WORD FINDER (§ 3.7) ─────────────────────────────────────────────
                Whatever the learner writes here dims every map word that does not
                contain it (whole words, substring — MemoryMapWorld), so the words that
                do stand out.

                HANDWRITING ONLY. The field is locked to the beginner keyboard
                (`data-beginner-keyboard-lock="ours"`, BEGINNER_KEYBOARD.md § 6z-3b): the
                switch bar shows no ā / ABC, and `inputMode="none"` keeps the OS keyboard
                from flashing up before the bk takes over. That lock is what makes the
                finder fair in a reading game — if the learner can BUILD the characters
                component by component, they can already read them. Typed pinyin would
                turn it into a lookup that answers the prompt.

                The whole finder is a `keep` region, so tapping its clear button does not
                dismiss the keyboard mid-search. Tapping the map does dismiss it — the
                query stays, so the matches stay lit. */}
            <Box
                className="memory-map-prompt__finder"
                {...{ [OPT_OUT_ATTRIBUTE]: KEEP_OPEN_VALUE }}
                sx={{
                    flexShrink: 0,
                    width: FINDER_WIDTH_PX,
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "0 8px",
                    height: 32,
                    borderRadius: "999px",
                    backgroundColor: COLORS.white,
                    // The house outline for a tappable control (CLAUDE.md § Buttons & cards).
                    border: `1px solid ${COLORS.border}`,
                }}
            >
                <Icon name="search" size={16} color={COLORS.iconColor} />
                <InputBase
                    className="memory-map-prompt__finder-input"
                    value={finderQuery}
                    onChange={(event) => onFinderChange(event.target.value)}
                    inputProps={{
                        "aria-label": "Find a word on the map by writing it",
                        inputMode: "none",
                        [LOCKED_SOURCE_ATTRIBUTE]: "ours",
                        // Text the learner wrote with the handwriting keyboard is CJK;
                        // autocorrect / capitalisation have nothing to offer it.
                        autoComplete: "off",
                        autoCorrect: "off",
                        autoCapitalize: "off",
                        spellCheck: false,
                    }}
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        fontFamily: FONTS.cjk,
                        fontSize: SIZE.body,
                        color: COLORS.onSurface,
                        "& input": { padding: 0 },
                    }}
                />
                {finderQuery !== "" && (
                    <ButtonBase
                        className="memory-map-prompt__finder-clear"
                        onClick={() => onFinderChange("")}
                        aria-label="Clear the word finder"
                        // Keep the caret in the field so the next stroke still lands there.
                        onMouseDown={(event) => event.preventDefault()}
                        sx={{ flexShrink: 0, borderRadius: "999px" }}
                    >
                        <Icon name="close" size={16} color={COLORS.iconColor} />
                    </ButtonBase>
                )}
            </Box>

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

        {/* ── THE GLOSS ───────────────────────────────────────────────────────────
            On the map's water, no line between it and the map (owner, 2026-11-04). Fixed
            two-line height (see docblock). Centered while it fits; start-first and
            swipeable once two lines overflow.

            NO PLACEHOLDER GLYPH when there is no prompt (§ 14.9): an em dash on a Chinese
            map reads as 一, so the empty state is genuinely empty — the block keeps its
            height from its own fixed size. */}
        <Box
            className="memory-map-prompt__gloss"
            sx={{
                height: GLOSS_BLOCK_PX,
                display: "flex",
                alignItems: "center",
                padding: "8px 16px",
                boxSizing: "border-box",
                // The map's water (MemoryMapWorld), so the gloss reads as part of the map panel.
                backgroundColor: COLORS.blueAccent,
            }}
        >
            {glossSegments.length > 0 && (
                <SwipeableTwoLineText
                    className="memory-map-prompt__gloss-text"
                    segments={glossSegments}
                    separator={DEFINITION_LIST_SEPARATOR}
                    align="center"
                    // Sideways only: nothing on this page scrolls vertically.
                    touchAction="pan-x"
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        fontFamily: FONTS.sans,
                        fontSize: `${GLOSS_FONT_PX}px`,
                        fontWeight: WEIGHT.bold,
                        lineHeight: GLOSS_LINE_HEIGHT,
                        color: COLORS.onSurface,
                        // The learner's chosen sense — underlined like the eip header's, in
                        // the muted ink so the mark stays quieter than the gloss itself.
                        "& .memory-map-prompt__sense--selected": {
                            textDecorationLine: "underline",
                            textDecorationColor: COLORS.textSecondary,
                            textDecorationThickness: "1.5px",
                            textUnderlineOffset: "2px",
                        },
                    }}
                />
            )}
        </Box>
        </Box>
    );
};

export default MemoryMapPrompt;
