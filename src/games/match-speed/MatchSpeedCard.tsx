import React, { useMemo } from "react";
import { Box, useTheme } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { resolveDisplayDefinition, resolveDisplayPronunciation, stripParentheses } from "../../utils/definitionUtils";
import type { Language } from "../../types";
import type { BoardCard, CardVisualState } from "./types";
import {
    CORRECT_CARD_BG,
    CORRECT_CARD_BORDER,
    DEF_FONT_MAX_PX,
    DEF_FONT_MIN_PX,
    DEF_LEN_MAX,
    DEF_LEN_MIN,
    DEF_MAX_LINES,
    ENGLISH_CARD_BG,
    ENGLISH_CARD_BORDER,
    FADE_IN_DURATION_MS,
    FOREIGN_CARD_BG,
    FOREIGN_CARD_BORDER,
    POP_DURATION_MS,
    SELECTED_BORDER,
    WRONG_CARD_BG,
    WRONG_FEEDBACK_MS,
} from "./constants";

interface MatchSpeedCardProps {
    card: BoardCard;
    /** Visual state resolved by the board (selection / wrong flash / partner hint). */
    state: CardVisualState;
    /** Language of the run, so ForeignText picks cpcd vs plain Latin text. */
    language: Language;
    showPinyin: boolean;
    showPinyinColor: boolean;
    /** `eventTimeStamp` is the raw pointer event's `timeStamp`, forwarded so the
     *  board can measure how long the tap waited for the main thread before its
     *  handler ran (see reportTap in src/utils/perfDiagnostics.ts). */
    onTap: (card: BoardCard, eventTimeStamp: number) => void;
}

/**
 * Interpolate the gloss font size down as the (parenthetical-stripped) definition
 * gets longer, clamped at both ends of the DEF_LEN band. Same length→size idea
 * Bubble Match applies to bubble radius, but spent on font size here because the
 * cell itself must not change size (see below).
 */
function fontSizeForGloss(gloss: string): number {
    const span = DEF_LEN_MAX - DEF_LEN_MIN;
    const t = Math.min(1, Math.max(0, (gloss.length - DEF_LEN_MIN) / span));
    return DEF_FONT_MAX_PX - t * (DEF_FONT_MAX_PX - DEF_FONT_MIN_PX);
}

/**
 * One Match Speed card — a foreign word (left column) or its English gloss
 * (right column).
 *
 * Layer: presentational. It owns no state and decides nothing about the game; the
 * board resolves `state` and handles every consequence of `onTap`.
 *
 * CARD SIZE IS FIXED BY THE PARENT at a 2.4:1 (CARD_ASPECT) rectangle, identical for
 * all ten cards. That is a CORRECTNESS requirement, not a style preference: if a
 * long definition made its card taller, size would leak which pair is which and the
 * player could match by silhouette instead of by reading. So this card never grows
 * — a long gloss is absorbed by strip → scale → clamp (see below), never by the
 * cell.
 *
 * MEMOIZED, AND THAT IS AN INPUT-LATENCY REQUIREMENT, NOT A MICRO-OPTIMISATION.
 * Every selection change calls `setSelectedId` on the board, which re-renders the
 * board — and without `React.memo` that re-rendered ALL TWELVE cards, each one
 * re-running `resolveDisplayDefinition`, a full cpcd character+pinyin render, and
 * MUI/emotion serialization of two large `sx` objects. That is one blocking task
 * on the main thread, sitting directly between the player's tap and their next
 * tap. It never *blocked* input (nothing here does), but a tap that lands during
 * it waits — which is exactly what "the animation locked me out" feels like, and
 * why the lockout only ever showed up for taps in SEPARATE React batches (two
 * fingers in one batch never wait for a render; a follow-up tap does).
 *
 * With the memo, a selection change re-renders the 1–2 cards whose `state`
 * actually changed. This depends on the board keeping `onTap` referentially
 * stable — MatchSpeedBoard routes its volatile props through refs for exactly
 * that reason. Do not pass an inline arrow as `onTap`; it silently defeats this.
 *
 * See docs/MATCH_SPEED_GAME.md § Rendering a card and § Selection is never locked.
 */
const MatchSpeedCard: React.FC<MatchSpeedCardProps> = ({
    card,
    state,
    language,
    showPinyin,
    showPinyinColor,
    onTap,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const isForeign = card.side === "foreign";

    // The gloss MUST come from resolveDisplayDefinition — never entry.definition or
    // definitions[0] — so the game shows the same sense the player learned the word
    // from on their flashcard. The pool payload carries definitionClusters +
    // selectedSense precisely so this resolves client-side. Showing a different
    // gloss reads as the game not knowing their word. See GAMES_FEATURE.md
    // § Sense correctness.
    //
    // Then strip parentheticals ("(literary)"-style asides) BEFORE sizing, which
    // buys room for the part of the gloss that actually distinguishes it.
    const gloss = useMemo(
        () => (isForeign ? "" : stripParentheses(resolveDisplayDefinition(card.entry))),
        [isForeign, card.entry]
    );

    // Resting surface per column, overridden by the transient states below.
    let background = isForeign ? FOREIGN_CARD_BG : ENGLISH_CARD_BG;
    let borderColor = isForeign ? FOREIGN_CARD_BORDER : ENGLISH_CARD_BORDER;
    let textColor = fc.onSurface;

    if (state === "wrong") {
        background = WRONG_CARD_BG;
        borderColor = WRONG_CARD_BG;
        textColor = "#FFFFFF";
    } else if (state === "partner-hint") {
        // Cleanup-mode "here's your partner" hint — deliberately the same light
        // green as a correct match, so the two games teach one visual vocabulary.
        background = CORRECT_CARD_BG;
        borderColor = CORRECT_CARD_BORDER;
    } else if (state === "selected") {
        borderColor = SELECTED_BORDER;
    }

    // A matched pair pops green on its way out; the board removes it once the pop
    // finishes. Overrides the selection styling it necessarily had a frame ago.
    if (card.exiting) {
        background = CORRECT_CARD_BG;
        borderColor = CORRECT_CARD_BORDER;
    }

    return (
        // The fade-in lives on a WRAPPER, not on the card itself, and that split is
        // load-bearing. A CSS animation with `both` fill keeps overriding the
        // properties it animates for as long as the element lives — so a fade-in
        // declared on the card (animating opacity + transform) permanently beat the
        // card's own `transform: scale(1.04)` selection lift and its `scale(1.14)`
        // + `opacity: 0` exit pop, silently killing both. Wrapper animates arrival;
        // the card animates state. Neither touches the other's properties.
        <Box
            className="match-speed__card-enter"
            sx={{
                height: "100%",
                width: "100%",
                // Fade in on arrival, delayed by this card's random stagger so a
                // batch of refilled cards doesn't appear as one block. Keyed off the
                // card id by the parent's React key, so it runs exactly once.
                animation: `match-speed-fade-in ${FADE_IN_DURATION_MS}ms ease-out ${card.fadeDelayMs}ms both`,
                "@keyframes match-speed-fade-in": {
                    from: { opacity: 0, transform: "scale(0.88)" },
                    to: { opacity: 1, transform: "scale(1)" },
                },
                // A popping card stops taking taps the instant it is matched, so a
                // fast player's next tap falls through instead of being swallowed by
                // a card that is already on its way out.
                pointerEvents: card.exiting ? "none" : "auto",
            }}
        >
        <Box
            className={[
                "match-speed__card",
                `match-speed__card--${card.side}`,
                `match-speed__card--${state}`,
                card.exiting ? "match-speed__card--exiting" : "",
            ]
                .filter(Boolean)
                .join(" ")}
            // SELECTION FIRES ON pointerdown, NOT click — deliberately.
            //
            // `click` is synthesized only if the browser decides the gesture earned
            // one, and anything that calls preventDefault() on the underlying
            // touchend silently destroys it. The app-wide double-tap-zoom guard in
            // useBlockZoom does exactly that for any tap it judges non-interactive,
            // and a foreign card fails that judgement (CPCDRow renders its
            // characters with `cursor: default` unless they are individually
            // interactive). The result was a speed game whose taps vanished
            // precisely when the player tapped fastest — every tap inside the 300ms
            // double-tap window was eaten, with no TAP ever reaching handleTap.
            //
            // pointerdown cannot be suppressed that way, and it is also simply the
            // right event here: this is a reaction-time game, so a selection should
            // land the instant the finger does, not on release.
            // MULTI-TOUCH IS ALLOWED: `e.isPrimary` is deliberately NOT checked, so
            // a two-finger grab (foreign word + its gloss pressed together) lands
            // both selections and resolves as one match attempt. The board is what
            // makes that safe — it reads selection and slots from refs, so the
            // second finger sees the first finger's effect even though React has
            // not re-rendered between the two events. Do not add an `isPrimary`
            // guard back without also re-reading MatchSpeedBoard's selectedIdRef.
            onPointerDown={(e) => {
                // Left button only. On touch/pen `button` is 0 for the contact
                // itself, so this rejects nothing but secondary MOUSE buttons.
                if (e.button !== 0) return;
                onTap(card, e.timeStamp);
            }}
            sx={{
                height: "100%",
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                px: 1,
                boxSizing: "border-box",
                borderRadius: "14px",
                backgroundColor: background,
                // Border width is constant across states so selecting a card can
                // never reflow its own text (a 2px→3px swap would re-wrap a
                // 3-line gloss mid-tap).
                border: `3px solid ${borderColor}`,
                color: textColor,
                cursor: "pointer",
                overflow: "hidden",
                // Selected cards lift; exiting cards pop out. Both are transforms
                // only — nothing here changes the cell's layout box.
                transform: card.exiting
                    ? "scale(1.14)"
                    : state === "selected"
                      ? "scale(1.04)"
                      : "scale(1)",
                opacity: card.exiting ? 0 : 1,
                boxShadow: state === "selected" ? "0 4px 12px rgba(61,107,214,0.35)" : "none",
                transition: card.exiting
                    ? `transform ${POP_DURATION_MS}ms ease-out, opacity ${POP_DURATION_MS}ms ease-out, background-color 120ms linear`
                    : `transform 140ms ease-out, box-shadow 140ms ease-out, background-color ${
                          state === "wrong" ? WRONG_FEEDBACK_MS / 3 : 160
                      }ms linear, border-color 160ms linear`,
                // Game surface: taps only, never scroll or text selection.
                touchAction: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
                WebkitTapHighlightColor: "transparent",
            }}
        >
            {isForeign ? (
                // ForeignText is the public container — never CPCDRow/CPCDBlock
                // directly. It picks cpcd vs plain text from the language, so this
                // card is language-agnostic.
                <ForeignText
                    className="match-speed__card-word"
                    language={language}
                    size="sm"
                    justifyContent="center"
                    text={card.entry.entryKey}
                    // Sense-resolved for the same reason the gloss is: the two faces of one pair
                    // must describe the SAME sense (see the gloss comment above).
                    pronunciation={resolveDisplayPronunciation(card.entry)}
                    showPinyin={showPinyin}
                    useToneColor={showPinyinColor}
                    pinyinShift
                />
            ) : (
                <Box
                    className="match-speed__card-gloss"
                    sx={{
                        // Step 2 of the fit: scale by length. Step 3: clamp at
                        // DEF_MAX_LINES with an ellipsis, so even a gloss past the
                        // band's floor size cannot push the fixed row height.
                        fontSize: `${fontSizeForGloss(gloss)}px`,
                        lineHeight: 1.25,
                        textAlign: "center",
                        display: "-webkit-box",
                        WebkitLineClamp: DEF_MAX_LINES,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                    }}
                >
                    {gloss}
                </Box>
            )}
        </Box>
        </Box>
    );
};

// Default shallow prop comparison is exactly right here: `card` is a stable
// object identity for as long as the card is unchanged (the board replaces the
// slot object when it flips `exiting`), `state` is a string, and the rest are
// scalars plus the deliberately-stable `onTap`.
export default React.memo(MatchSpeedCard);
