import React, { useMemo } from "react";
import { Box } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { LentCardBadge } from "../../components/LentCardBadge";
import { resolveDisplayDefinition, resolveDisplayPronunciation, stripParentheses } from "../../utils/definitionUtils";
import type { Language } from "../../types";
import type { BoardCard, CardVisualState } from "./types";
import { COLORS } from "../../theme/colors";
import { GROUND_PRINT } from "../../theme/groundPaint";
import { useTowerWash } from "../../timeOfDay/useDayWash";
import {
    CARD_PANEL,
    CORRECT_CARD_PANEL,
    DEF_FONT_MAX_PX,
    DEF_FONT_MIN_PX,
    DEF_LEN_MAX,
    DEF_LEN_MIN,
    DEF_MAX_LINES,
    FADE_IN_DURATION_MS,
    POP_DURATION_MS,
    SELECTED_CARD_PANEL,
    WRONG_CARD_PANEL,
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
    const wash = useTowerWash();
    const isForeign = card.side === "foreign";
    // A LENT card is one the server borrowed the player into this run rather than one
    // they sorted (docs/PROVISIONAL_CARDS.md). Match Speed streams its buffer, so its
    // pre-round notice cannot name the borrowed words — the corner badge is the only
    // in-round tell.
    //
    // FOREIGN SIDE ONLY, and that is a correctness rule rather than a layout choice:
    // badging both faces of a lent pair would mark two cards on the board as belonging
    // together, letting the player match by badge instead of by reading — the same leak
    // the fixed card size exists to prevent. One badged column leaks nothing, because
    // every English card is unbadged whatever its partner is.
    const isLent = isForeign && card.entry.starterPackBucket === "provisional";

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

    // A white button at rest; a state replaces the white. Annotated `string` because COLORS is
    // `as const`.
    // A matched pair pops green on its way out; the board removes it once the pop
    // finishes. Overrides the selection styling it necessarily had a frame ago.
    let panel: string = CARD_PANEL;
    if (card.exiting || state === "partner-hint") panel = CORRECT_CARD_PANEL;
    else if (state === "wrong") panel = WRONG_CARD_PANEL;
    else if (state === "selected") panel = SELECTED_CARD_PANEL[card.side];

    return (
        // The fade-in lives on a WRAPPER, not on the card itself, and that split is
        // load-bearing. A CSS animation with `both` fill keeps overriding the
        // properties it animates for as long as the element lives — so a fade-in
        // declared on the card (animating opacity + transform) permanently beat the
        // card's own selection lift and exit pop, silently killing both. Wrapper animates arrival;
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
                px: "9px",
                boxSizing: "border-box",
                // Anchors the lent badge's absolute corner placement below. Harmless
                // on every other card — nothing else here is positioned.
                position: "relative",
                borderRadius: "14px",
                backgroundColor: wash(panel),
                // No border in any state: nothing can change the box, so a tap can never
                // re-wrap a three-line gloss under the finger; the outline is an inset
                // shadow for the same reason (CLAUDE.md § Buttons & cards, in paint).
                boxShadow: `inset 0 0 0 1px ${COLORS.border}`,
                color: COLORS.onSurface,
                cursor: "pointer",
                overflow: "hidden",
                // Transforms only: nothing here changes the cell's layout box.
                ...(card.exiting && { transform: "translateY(-12px) scale(1.06)" }),
                opacity: card.exiting ? 0 : 1,
                // Only colour eases on a live card: selection lands on pointerdown.
                transition: card.exiting
                    ? `transform ${POP_DURATION_MS}ms ease-out, opacity ${POP_DURATION_MS}ms ease-out, background-color 120ms linear`
                    : `background-color ${state === "wrong" ? WRONG_FEEDBACK_MS / 3 : 160}ms linear`,
                // `translate`, not `transform`: the exit pop owns `transform`, and this
                // card can be matched mid-shake.
                ...(state === "wrong" && {
                    animation: `match-speed-card-shake ${WRONG_FEEDBACK_MS}ms ease-out`,
                    "@keyframes match-speed-card-shake": {
                        "0%, 100%": { translate: "0" },
                        "20%": { translate: "-5px" },
                        "45%": { translate: "4px" },
                        "70%": { translate: "-2px" },
                    },
                    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                }),
                // Game surface: taps only, never scroll or text selection.
                touchAction: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
                WebkitTapHighlightColor: "transparent",
            }}
        >
            {isLent && <LentCardBadge className="match-speed__card-lent-badge" />}
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
                    characterColor={COLORS.onSurface}
                />
            ) : (
                <Box
                    className="match-speed__card-gloss"
                    sx={{
                        // Step 2 of the fit: scale by length. Step 3: clamp at
                        // DEF_MAX_LINES with an ellipsis, so even a gloss past the
                        // band's floor size cannot push the fixed row height.
                        ...GROUND_PRINT,
                        fontSize: `${fontSizeForGloss(gloss)}px`,
                        letterSpacing: "0.005em",
                        lineHeight: 1.3,
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
