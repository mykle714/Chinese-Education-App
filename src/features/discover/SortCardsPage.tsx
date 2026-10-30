import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Box, Typography, ButtonBase, CircularProgress, Menu, MenuItem } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { styled, keyframes } from "@mui/material/styles";
import { useDrag } from "@use-gesture/react";
import { useSpring, animated } from "@react-spring/web";
import NodePage from "../../components/NodePage";
import { SLAB_FOOTER_TOTAL_CLEARANCE, SLAB_FOOTER_TOTAL_HEIGHT } from "../../components/MobileFooter";
import { setFooterCastShadow } from "../../components/footerCastShadow";
import FrequencyScoreDots from "../../components/FrequencyScoreDots";
import EipSheet from "../flashcards/FlashcardsLearnPage/EipSheet";
import SkippedCardsSheet from "./SkippedCardsSheet";
import SortBins, { type SortBinSpec } from "./SortBins";
import { sortLookAt, type SortLook } from "./sortTimeOfDay";
import { useDayClock } from "../../timeOfDay/useDayClock";
import { DIFFICULTY_LEVELS, MIN_DIFFICULTY_LEVEL, MAX_DIFFICULTY_LEVEL, difficultyLabel as levelLabelFor } from "./difficultyLevels";
import Icon from "../../components/Icon";
import { useLongPress } from "../../hooks/useLongPress";
import { useThemeColor } from "../../hooks/useThemeColor";
import HoldProgressRing from "../../components/HoldProgressRing";
import { quietHaptic } from "../../utils/haptic";
import { useEipTabs } from "../flashcards/FlashcardsLearnPage/useEipTabs";
import { fetchStarterPacks, fetchNextPack, sortCard, skipPack, undoSort } from "./starterPacksApi";
import { fetchProvisionalSortSet } from "../../api/provisional";
import ProvisionalSortDonePopup from "../../components/ProvisionalSortDonePopup";
import { originLabelFor } from "../../utils/originLabel";
import { lookupVocabEntry } from "../../api/dictionary";
import { stripParentheses } from "../../utils/definitionUtils";
import type { Language, DiscoverCard, SortPack } from "../../types";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useAuth } from "../../AuthContext";
import { useTTS } from "../../hooks/useTTS";
import AudioModeChip from "../../components/AudioModeChip";
import { useSoftIntro } from "../../softIntro/useSoftIntro";
import SoftIntroToggle from "../../softIntro/SoftIntroToggle";
import { COLORS } from "../../theme/colors";
import { shadeHex } from "../deckTower/iso";
import { INVALID_SHAKE_ANIMATION, INVALID_SHAKE_KEYFRAMES } from "../../theme/invalidShake";
import { FLP_CARD_PANEL_RADIUS_RATIO, FLP_CARD_STOCK_INSET_RATIO } from "../flashcards/constants";
import { LEARNING_COLORS, MASTERY_BAR_COLORS } from "../../utils/categoryColors";
import { FONTS } from "../../theme/fonts";
import { keycapPressSx } from "../../theme/keycapPress";
import { SIZE, WEIGHT, TRACKING } from "../../theme/scale";
import MiniCard from "../../components/MiniCard";
import { MINI_CARD_DIMENSIONS, MINI_CARD_RING, type MiniCardSize } from "../../components/miniCardFace";

// The on-deck unit is now a SORT PACK (docs/SORT_CARDS_REQUIREMENTS.md §4.5): up to 4
// draggable cards (no sentence band). The client holds a short FIFO queue of PACKS
// (target 2: on-deck + buffer). The server selects card CONTENT; the CLIENT owns
// adaptive LEVELING (docs §6) — see the autoLevelRef state below. Skip is a
// de-emphasized header button (not a drag target). Undo reverses one card action at a
// time (sort OR skip), one pack deep (MAX_CARDS_PER_PACK).

// A pack holds at most this many cards (mirrors server/scripts/validate-sort-packs.ts →
// MAX_CARDS_PER_PACK). Undo is exactly one full pack deep, so undoing can always walk
// back every card of the pack just finished.
const MAX_CARDS_PER_PACK = 4;
const UNDO_DEPTH = MAX_CARDS_PER_PACK;

// Manual HSK/difficulty dropdown levels: DIFFICULTY_LEVELS (./difficultyLevels.ts),
// shared with the expanded Quick Mark panel. `selectedLevel === null` is the dropdown's
// extra "auto" entry (the adaptive target the client tracks itself).

// Holding the Skip button this long opens the hidden skipped-cards sheet (§5.1a).
// Deliberately long: the gesture is undiscoverable by design, and a tap must never
// turn into one by accident.
const SKIP_HOLD_MS = 2000;
// The toolbar keycaps' height; all three (level pill · undo · skip) are fully rounded pills.
const TOOLBAR_KEY_HEIGHT_PX = 30;
// The Skip button's corner radius — shared by its sx and its hold ring, which must agree.
// Half its height: a full pill like the level pill and undo (was a 6px rounded rect until
// 2026-10-29, which read as out of style next to the pill).
const SKIP_BUTTON_RADIUS_PX = TOOLBAR_KEY_HEIGHT_PX / 2;

// A recorded card action, kept so Undo can reverse it and (if the pack has advanced)
// bring the pack back on deck. `pack` is the full pack the card belonged to.
interface UndoEntry {
    action: "sort" | "skip";
    cardId: number;
    bucket: string; // 'library' | 'already-learned' | 'skip'
    pack: SortPack;
}

// Single console-log shape for the whole sort flow, so a card entering the UI and a
// card arriving from the server read identically in the console. `event` names the
// moment ("card displayed" | "card queued"); the word1 is inlined into the label
// because that is what makes a line scannable, and the payload carries everything
// else about the card plus the pack it belongs to.
// The PACK's level and key are inlined into the label too, because adaptive leveling
// (§6) runs on `pack.level` — NOT on the card's own `difficulty`. An authored pack
// mixes card difficulties (e.g. level-5 pack:48 = 自由/自在 at difficulty 4 plus
// 自由自在 at 5), so reading per-card `difficulty` off these lines makes a correct
// level step look like a repeat. packKey also makes it obvious when N lines are one
// multi-card pack (one signal) rather than N packs.
// NOTE: entryKey IS word1 on DiscoverCard (src/types.ts) — relabelled here for clarity.
const logSortCard = (
    event: string,
    card: DiscoverCard,
    pack: SortPack,
    extra: Record<string, unknown> = {}
) => {
    console.log(`[sort-flow] ${event}: ${card.entryKey} [packLevel=${pack.level} ${pack.packKey}]`, {
        word1: card.entryKey,
        definition: card.definition,
        pronunciation: card.pronunciation,
        frequencyScore: card.frequencyScore,
        packLevel: pack.level, // the leveling signal's anchor (§6)
        cardDifficulty: card.difficulty, // the CARD's own band — not what leveling uses
        cardId: card.id,
        pack: { packKey: pack.packKey, packId: pack.packId, level: pack.level },
        ...extra,
        card,
    });
};

const ContentArea = styled(Box)({
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    overflow: "visible",
    // Containing block for this page's absolutely-positioned layers (the toolbar over
    // the bins), mirroring the flp's ContentArea.
    position: "relative",
    userSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "none",
});

// ── Tower Tier 2 layout (docs/SORT_CARDS_REQUIREMENTS.md § 4.5, § 4.9) ─────────────
// The page is a tier-2 ground under the Deck Tower (Claude Design "Tower Tier 2 - Time
// of Day", the "Sort ·" artboards): the two bins float as iso decks in the upper part
// (SortBins), the toolbar sits top-right over them, and the on-deck pack levitates in a
// row along the bottom, above the slab footer. Every colour comes from `SortLook`
// (sortTimeOfDay.ts), so the whole page follows the tower's clock.

// The bins' scene: absorbs the page's spare height (and gives it back on short screens).
const BinsArea = styled(Box)({
    flex: 1,
    minHeight: 0,
    width: "100%",
    position: "relative",
    display: "flex",
});

// Level pill · undo · skip, in a row along the top-right corner over the bins (the
// artboard's `.tb`). Absolutely placed so it never pushes the scene down.
const SortToolbar = styled(Box)({
    position: "absolute",
    top: 4,
    right: 14,
    zIndex: 2,
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
});

/** A keycap's lip, px — how far its face sinks when pressed. */
const KEYCAP_LIP_PX = 3;

/**
 * The keycap's lip under its face, then its cast shadow on the ground. `sunk` px pressed:
 * the lip shrinks by that much, and since the cast shadow stays put on the ground while
 * the key moves down, its offset from the key shrinks by the same amount.
 */
const keycapShadow = (look: SortLook, sunk: number) =>
    `0 ${KEYCAP_LIP_PX - sunk}px 0 ${look.keyWall}, 4px ${7 - sunk}px 0 ${look.groundShadow}`;

/**
 * A keycap on the ground (the artboard's `.kc` / `.pill.dd`): the look's key face on its
 * solid lip, casting the iso shadow down-right onto the ground. Keeps the app's
 * hairline outline (CLAUDE.md "Buttons & cards").
 */
const keycapSx = (look: SortLook) => {
    // The app's raised-key press (src/theme/keycapPress.ts): snaps down the lip's 3px
    // while held and snaps back on release — no press/pop transition.
    const press = keycapPressSx({
        restShadow: keycapShadow(look, 0),
        pressedShadow: keycapShadow(look, KEYCAP_LIP_PX),
        pressedY: KEYCAP_LIP_PX,
    });
    return {
        backgroundColor: look.keyFace,
        color: look.keyInk,
        border: `1px solid ${COLORS.border}`,
        fontFamily: FONTS.sans,
        fontSize: SIZE.body,
        fontWeight: WEIGHT.semibold,
        lineHeight: 1,
        boxSizing: "border-box" as const,
        ...press,
        // Skip's hold: useLongPress may swallow :active, so the hold sets this class to
        // keep the key sunk for the whole press.
        "&.sort-cards__keycap--pressed": press["&:active"],
    };
};

// The pack along the bottom. Transparent (the ground shows through — there is no white
// platform any more); its bottom padding lifts the row clear of the floating slab
// footer. The ScrollArea already reserves the SLAB's clearance, which the negative
// margin hands back so this padding alone measures from the frame's bottom edge.
/**
 * Gap between the on-deck row's action TARGETS and the top of the slab footer. Zero: the
 * 28px glyphs sit 4px inside their 36px targets, so they clear the slab by just that
 * (user requests 2026-10-29).
 */
const ON_DECK_FOOTER_GAP_PX = 0;
const OnDeckSection = styled(Box)({
    width: "100%",
    // Containing block for PackExitClip (the leaving-pack overlay). No z-index, so
    // this does not become a stacking context for the dragged card.
    position: "relative",
    flex: "0 0 auto",
    paddingTop: 8,
    // The row's action targets sit ON_DECK_FOOTER_GAP_PX from the slab footer's top edge.
    paddingBottom: `calc(${SLAB_FOOTER_TOTAL_HEIGHT} + ${ON_DECK_FOOTER_GAP_PX}px)`,
    // Hands back the ScrollArea's bottom reservation. scp is a SLAB route, so that is the
    // slab's clearance (MobileTabScreen → footerClearance), not the bar's: handing back
    // the bar's FOOTER_TOTAL_CLEARANCE (as this did until 2026-10-29) left ~22px of
    // phantom space under the row on a device with no bottom safe area.
    marginBottom: `calc(-1 * ${SLAB_FOOTER_TOTAL_CLEARANCE})`,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
});

// Holds the up-to-4 cards side by side; wraps only if even the compact face can't fit.
// `compact` (a pack laid out on compact MiniCards — see `dockCardSize`) also tightens the
// gap between slots, since a 4-card row is what needs the room. The artboard's 24 / 14.
const CARDS_ROW_GAP: Record<MiniCardSize, number> = { regular: 24, compact: 14 };
const CARDS_ROW_INLINE_PADDING = 8;
const CardsRow = styled(Box, {
    shouldForwardProp: (prop) => prop !== "compact",
})<{ compact?: boolean }>(({ compact }) => ({
    width: "100%",
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: CARDS_ROW_GAP[compact ? "compact" : "regular"],
    paddingInline: CARDS_ROW_INLINE_PADDING,
}));

/**
 * The face size a pack of `cardCount` cards is laid out on, given the row's width
 * (docs/SORT_CARDS_REQUIREMENTS.md §4.5 "Compact dock"). Fit-to-width, not a per-count
 * rule: the pack stays on regular 92px cards whenever the whole row fits across at that
 * size, and drops to the compact 78px face only when it doesn't — in practice a 4-card
 * pack on a phone. A 1–3-card pack always fits, so never shrinks.
 * An unmeasured row (`dockWidth` null — the first commit only) reads as regular.
 */
function dockCardSize(cardCount: number, dockWidth: number | null): MiniCardSize {
    if (dockWidth == null || cardCount <= 1) return "regular";
    const regularRowWidth = cardCount * MINI_CARD_DIMENSIONS.regular.width + (cardCount - 1) * CARDS_ROW_GAP.regular;
    return regularRowWidth <= dockWidth - 2 * CARDS_ROW_INLINE_PADDING ? "regular" : "compact";
}

// One on-deck slot: a vertical column holding the card's tier tag stacked above the
// draggable card, with the card's action icons below it. The slot — not the card — owns
// the width budget; its width is the card's fixed face (regular or compact, CardWell) or
// the tier tag, whichever is wider.
const CardSlot = styled(Box)({
    flex: "0 0 auto",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
});

// Spacing inside a slot. Below the card it is just enough to clear the card's 2px wall
// and its ≈ 7px cast shadow (CARD_WALL_Y + cardCastShadow) at the top of the levitation;
// the glyphs' own 4px inset in their 36px targets adds the rest (tightened from 24,
// user request 2026-10-29).
const SLOT_HEADER_GAP_PX = 12;
const SLOT_ACTIONS_GAP_PX = 12;

// How a CardSlot arrives on deck (docs/SORT_CARDS_REQUIREMENTS.md §4.1
// "Pack entrance"):
//   - "dock": a pack landing on deck (first load, level switch, or the next pack
//     replacing a finished/skipped one) — the whole slot rises from the bottom edge
//     of the screen, the pack's slots staggered in a random order.
//   - "rise": a card re-shown by Undo inside the on-deck pack — the small 24px
//     rise + fade, so Undo reads as "put back", not as new content arriving.
//   - "return": the PREVIOUS pack brought back on deck by Undo — the pack exit played
//     backwards: its cards slide back in from the left, labels fading in once they
//     arrive, after the on-deck pack has slid back out to the right (UNDO_EXIT).
type SlotEntrance = "dock" | "rise" | "return";

// Per-slot stagger step for the "dock" entrance. The pack's slots get the delays
// 0, STEP, 2·STEP, … (one per card) in slot order, leftmost first (see `dockDelays` in SortCardsPage).
const DOCK_STAGGER_STEP_MS = 60;

// Silence between consecutive words in the pack autoplay (docs/AUDIO_PLAYBACK.md
// "A manual press ends an autoplay sequence").
const AUTOPLAY_GAP_MS = 600;

// The pack CONVEYOR (docs §4.1, sideways since 2026-10-29 — it used to rise from below
// the screen): each card slides in from past the screen's right edge, and its info labels
// (tier tag + dots above, action glyphs below) fade in once it has arrived; the leaving
// pack's cards slide off to the left while their labels fade out in place. Every card
// travels the same 100vw, so they move at one speed, like things on one belt.
const DOCK_SLIDE_MS = 520;
const LABEL_FADE_MS = 220;
const dockInKeyframes = keyframes`
    from { transform: translateX(100vw); }
    to   { transform: translateX(0); }
`;
const labelFadeInKeyframes = keyframes`
    from { opacity: 0; }
    to   { opacity: 1; }
`;
/** The info labels of a slot: the tier tag row above the card and the action row below. */
const SLOT_LABELS = "& .sort-cards__card-deck-header, & .sort-cards__card-actions";
const riseInKeyframes = keyframes`
    from { transform: translateY(24px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
`;

/**
 * A CardSlot (tier tag + card + action row) that plays its entrance once, on mount.
 * "dock" (a new pack): the card's well slides in from the right, then the labels fade in
 * (see dockInKeyframes). "rise" (Undo re-showing a card): the whole slot rises in.
 * "return" (Undo bringing back the previous pack): the pack exit backwards, from the left.
 * DraggableCard's own spring is left purely for dragging.
 *
 * Deliberately a CSS animation, NOT a react-spring spring: useSpring's function form
 * keeps its initial values queued and replays them on later starts/re-renders, and this
 * page re-renders constantly (TTS speakingKey, drag highlight) — an off-screen initial
 * `y` kept getting re-applied and the cards never showed. CSS has no such lifecycle.
 *
 * `animation-fill-mode: backwards` applies the start frame during the stagger delay and
 * then drops the transform entirely at rest. That matters: any transform, even
 * translateX(0), makes its element a stacking context, which would trap DraggableCard's
 * zIndex: 1000 inside it — a card dragged across a later sibling slot (or up to the
 * bins) would then paint UNDER it.
 */
function EnteringCardSlot({ entrance, delayMs, children }: {
    entrance: SlotEntrance;
    delayMs: number;
    children: React.ReactNode;
}) {
    const motion = entrance === "dock"
        ? {
            "& .sort-cards__card-well": {
                animation: `${dockInKeyframes} ${DOCK_SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1) ${delayMs}ms backwards`,
            },
            [SLOT_LABELS]: {
                animation: `${labelFadeInKeyframes} ${LABEL_FADE_MS}ms ease-out ${delayMs + DOCK_SLIDE_MS * 0.7}ms backwards`,
            },
        }
        : entrance === "return"
        ? {
            // The exit's ease-in, mirrored: the cards come in fast and settle.
            "& .sort-cards__card-well": {
                animation: `${packReturnKeyframes} ${PACK_EXIT_MS}ms cubic-bezier(0.2, 0.75, 0.45, 1) ${delayMs}ms backwards`,
            },
            [SLOT_LABELS]: {
                animation: `${labelFadeInKeyframes} ${LABEL_FADE_MS}ms ease-out ${delayMs + PACK_EXIT_MS * 0.7}ms backwards`,
            },
        }
        : { animation: `${riseInKeyframes} 320ms ease-out backwards` };

    return (
        <CardSlot
            className="sort-cards__card-slot"
            sx={{
                ...motion,
                "@media (prefers-reduced-motion: reduce)": { animation: "none", "& *": { animation: "none" } },
            }}
        >
            {children}
        </CardSlot>
    );
}

// Below each card: its two actions (play audio, open the eip) as bare 28px glyphs on the
// ground (the artboard's `.tier .ti`) — no keycap. The row stays rendered under a sorted
// card's empty well, so a sorted-away slot keeps its full height.
const CardActionRow = styled(Box)({
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
});

// One action glyph's hit target: 36px round, the glyph centred, no chrome.
const CardActionButton = styled(ButtonBase)({
    width: 36,
    height: 36,
    borderRadius: "50%",
});

// Above each card: its commonality tier tag — the tier label over the 5-dot frequency
// meter (frequencyScore). Fixed height so cards with no score keep their faces aligned
// with neighbours that do. Sits on the ground, not on the draggable card, so it stays
// put while the card is dragged away. Ink comes from the look (renderSlotBody).
const CardDeckHeader = styled(Box)({
    minHeight: 48,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
});

// User-facing name for each 1–5 frequencyScore tier, shown above that card's meter.
// Display copy only, deliberately separate from the backfill's FREQUENCY_SCORE_LABELS
// (server/scripts/backfill/shared/lib/frequencyLabels.js): those feed the Spanish
// scoring prompt and are too long for a ~100px card slot. Sort page only for now —
// the eip/cdp meters still read "Commonality". See docs/SORT_CARDS_REQUIREMENTS.md.
// Every multi-word label carries an explicit "\n" so it always stacks on two lines
// (rendered via `white-space: pre`); single-word labels stay on one line.
const COMMONALITY_TIER_LABELS: Record<number, string> = {
    5: "Used all\nthe time",
    4: "Common",
    3: "Used\nsometimes",
    2: "Uncommon",
    1: "Rarely\nused",
};

// Two lines at the tag's size: the tallest a tier label can be.
const TIER_LABEL_LINE_HEIGHT = 1.15;
const TIER_LABEL_BOX_HEIGHT = `calc(2 * ${TIER_LABEL_LINE_HEIGHT} * ${SIZE.body})`;

// One card's tier label. Sentence case (not the app's uppercase overline) because
// "USED ALL THE TIME" in tracked caps is far wider than the slot. Multi-word labels
// break on their embedded "\n", so the box ALWAYS reserves two lines and bottom-aligns
// its text: a one-line label and a two-line label then leave every card's meter row on
// the same baseline, and every card face at the same height.
const CommonalityTierLabel = styled(Typography)({
    height: TIER_LABEL_BOX_HEIGHT,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    textAlign: "center",
    fontSize: SIZE.body,
    fontWeight: WEIGHT.semibold,
    lineHeight: TIER_LABEL_LINE_HEIGHT,
    whiteSpace: "pre",
});

// The level pill's soft-introduction caption (si `sortDifficultyCaption`,
// docs/SOFT_INTRODUCTION.md): "DIFFICULTY" under the pill for a learner's first visits,
// then gone. Ink on the ground, so it takes the look's soft ink.
// 9px — two steps below the type scale's smallest (SIZE.micro, 11px) and below the shelf
// overline (components/primitives/Label → `Label`, 10px); no token this small exists —
// it matches the Settings page's 9px uppercase tags (made smaller twice by user request
// 2026-10-29: 11 → 10 → 9).
const LevelCaption = styled(Typography)({
    fontFamily: FONTS.label,
    fontSize: 9,
    fontWeight: WEIGHT.bold,
    letterSpacing: TRACKING.caps,
    textTransform: "uppercase",
    lineHeight: 1,
    whiteSpace: "nowrap",
    textAlign: "center",
    marginTop: 9,
});

// The on-deck card IS the app's mini preview card (src/components/MiniCard.tsx) — the
// same 92×132 tile, contents and hairline ring as MiniVocabCard / QuickMarkCard /
// ChallengeWordCard — wrapped in `animated()` so the drag spring can drive its
// transform. It carries no mastery strip (MiniCard omits it unless given a bar): these
// are words being triaged, not the learner's cards.
const AnimatedMiniCard = animated(MiniCard);

// The card's resting place inside a slot: a fixed box the size of the card's face
// (92×132 regular / 78×112 compact — MINI_CARD_DIMENSIONS) the DraggableCard sits in.
// A card sorted/skipped this session is no longer rendered, leaving the well empty
// (the artboard draws no crater) — keeping the slot's tag + action row around it,
// rather than swapping the whole slot out, keeps neighbours from re-centering AND gives
// the exit animation something to carry off (docs/SORT_CARDS_REQUIREMENTS.md §4.1
// "Pack exit", §4.5).
// Deliberately no z-index / transform: a stacking context here would trap
// DraggableCard's zIndex: 1000 and let a dragged card slide under its neighbours.
const CardWell = styled(Box, {
    shouldForwardProp: (prop) => prop !== "cardSize",
})<{ cardSize: MiniCardSize }>(({ cardSize }) => ({
    position: "relative",
    width: MINI_CARD_DIMENSIONS[cardSize].width,
    height: MINI_CARD_DIMENSIONS[cardSize].height,
}));

// Holds the leaving pack over the on-deck row (docs §4.1 "Pack exit"): its cards slide
// off to the left and its labels fade out in place. Covers the whole OnDeckSection and
// clips ONLY the leaving overlay — the section itself stays overflow-visible so a
// dragged card can still travel up to the bins.
const PackExitClip = styled(Box)({
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    pointerEvents: "none",
});

// The leaving cards travel the same 100vw the arriving ones do, the other way (the belt
// runs right → left); the labels fade out over the first part of it.
const packExitKeyframes = keyframes`
    from { transform: translateX(0); }
    to   { transform: translateX(-100vw); }
`;
const labelFadeOutKeyframes = keyframes`
    from { opacity: 1; }
    to   { opacity: 0; }
`;
const PACK_EXIT_MS = 420;
// Undo bringing back the previous pack plays the conveyor BACKWARDS (docs §4.1 "Undo
// across packs"): the on-deck pack's dock-in reversed — labels fade out, then each card
// slides back off to the right, rightmost first (the last in is the first out) — and
// then the previous pack's exit reversed (packReturnKeyframes, EnteringCardSlot "return").
const packReturnKeyframes = keyframes`
    from { transform: translateX(-100vw); }
    to   { transform: translateX(0); }
`;
const packUnDockKeyframes = keyframes`
    from { transform: translateX(0); }
    to   { transform: translateX(100vw); }
`;
/** The un-dock's total length for a pack of `cardCount`: the stagger plus one slide. */
const undoExitMs = (cardCount: number) => Math.max(cardCount - 1, 0) * DOCK_STAGGER_STEP_MS + DOCK_SLIDE_MS;

// The "SORTED" head band across the top of a card already in the user's library — the
// Deck Tower card's head band (IsoCard `iso-card__band` + `iso-card__label`, the
// "LEARNING" / "MASTERED" strip) on this HTML card (user request 2026-10-29; it was a
// diagonal "sorted!" stamp across the centre, then a pill at the top). Every measure is
// IsoCard's world-unit value over the tower card's width (CARD_W 4.8), so the band sits
// in the panel's top exactly as it does on a tower card:
//   inset FACE_PAD 0.34 (= FLP_CARD_STOCK_INSET_RATIO), depth BAND_DEPTH 1.05, corner
//   PANEL_RADIUS 0.24 (= FLP_CARD_PANEL_RADIUS_RATIO), label 0.53 bold caps tracked 0.055.
// Its fill is the sorted stock's wall grey (a tower band is its deck's ramp hue; a
// sorted card has no deck hue, and the wall grey is the darkest tone already on it).
// Docs: docs/SORT_CARDS_REQUIREMENTS.md § 4.5 "Already-sorted cards are locked".
const TOWER_CARD_W = 4.8;
const SORTED_BAND_DEPTH_RATIO = 1.05 / TOWER_CARD_W;
const SORTED_BAND_FONT_RATIO = 0.53 / TOWER_CARD_W;
const SORTED_BAND_TRACKING_EM = 0.055 / 0.53;
const sortedBandSx = (size: MiniCardSize) => {
    const width = MINI_CARD_DIMENSIONS[size].width;
    const inset = width * FLP_CARD_STOCK_INSET_RATIO;
    return {
        position: "absolute",
        top: `${inset}px`,
        left: `${inset}px`,
        right: `${inset}px`,
        height: `${width * SORTED_BAND_DEPTH_RATIO}px`,
        borderRadius: `${width * FLP_CARD_PANEL_RADIUS_RATIO}px`,
        // Above MiniCard's print layers (zIndex 1), level with its corner overlays.
        zIndex: 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        backgroundColor: SORTED_STOCK.wall,
        color: COLORS.onSurface,
        fontFamily: FONTS.cjk,
        fontSize: `${width * SORTED_BAND_FONT_RATIO}px`,
        fontWeight: WEIGHT.bold,
        letterSpacing: `${SORTED_BAND_TRACKING_EM}em`,
        lineHeight: 1,
    } as const;
};

// The picked-up card's lift — the same value as Bubble Match's SCALE_HELD
// (src/games/bubbles/constants.ts), and like it applied ONCE at pickup and held for the
// whole drag: being over a bin does not change the card at all — the bin itself grows
// (SortBins → ACTIVE_SCALE). The card is never washed or dimmed while held (user request
// 2026-10-29; it used to take Bubble Match's scrim wash over a bin).
// Kept local rather than imported: features/ must not reach into games/.
// No tilt while held: the artboard's `.held` rotate(-5deg) was dropped by user request
// (2026-10-29) — the lift and its growing shadow are the whole pickup.
const HELD_CARD_SCALE = 1.12;

// A card's solid wall — the card stock's thickness, seen below AND to the right of its
// face, as the bins' iso cards show their front and right walls. The artboard drew only a 6px bottom lip
// (`0 6px 0 --cardR`); by user request (2026-10-29) the wall shows on the right too and
// is as thick as a Deck Tower card: `CARD_THICKNESS` (deckTower/iso/cardStackMetrics.ts,
// 0.12 world units) at the tower scene's ~16.5px per unit ≈ 2px. A literal, not derived:
// the tower scene scales to fit its screen, so it has no fixed px-per-unit to import.
// box-shadow cannot slant, so the wall is the face's outline stepped along the extrusion
// vector (CARD_WALL_X, CARD_WALL_Y), one copy per px.
// The SORTED (already-in-library) card is the same stock in greys — see SORTED_STOCK.
const CARD_WALL_X = 2;
const CARD_WALL_Y = 2;
const CARD_WALL_STEPS = 2;
const cardWall = (color: string) =>
    Array.from({ length: CARD_WALL_STEPS }, (_, i) => {
        const k = (i + 1) / CARD_WALL_STEPS;
        return `${(CARD_WALL_X * k).toFixed(2)}px ${(CARD_WALL_Y * k).toFixed(2)}px 0 ${color}`;
    }).join(", ");
const CARD_LIP = cardWall(COLORS.cardWall);

/**
 * An already-sorted card: the card stock's three tones translated into greys, keeping the
 * stock's light rim → deeper panel → deeper-still wall order, so the wall reads as the
 * card's own edge. (The wall used to be the SAME grey as the face, `COLORS.header`, and
 * a wall the face's colour reads as a second card stacked behind — user report 2026-10-29.)
 * The wall is the panel darkened one iso step, exactly how `COLORS.cardWall` is derived
 * from `cardBeige` (`shadeHex(…, 0.07)`); rim and panel are framework greys.
 */
const SORTED_STOCK = {
    rim: COLORS.header,
    panel: COLORS.card,
    wall: shadeHex(COLORS.card, 0.07),
} as const;
const SORTED_CARD_LIP = cardWall(SORTED_STOCK.wall);
/** How faint a sorted card's print (icon, word, definition) is, under its grayscale. */
const SORTED_PRINT_OPACITY = 0.4;

/**
 * The Deck Tower's CARD STOCK on a sort card (docs/TOWER_STYLE_SHIFT.md § "Card stock";
 * user request 2026-10-29), so the cards on deck look like the tower's own:
 *   - the face is the cream rim (`COLORS.cardFace`, passed as MiniCard `background`)
 *     with the beige printed panel inset in it — `FLP_CARD_STOCK_INSET_RATIO` of the
 *     card's width in from every edge, corners `FLP_CARD_PANEL_RADIUS_RATIO` — the same
 *     ratios CardFaceSide `towerStock` paints the tower-hosted flp's faces with;
 *   - the wall (CARD_LIP), and a flat CAST SHADOW on the ground (`cardCastShadow`) in the
 *     look's `groundShadow` — the iso shadow rule the tower and this page's floating
 *     platforms use. (`SHADOW.lifted`, the tower's held-card shadow, was tried
 *     2026-10-29: a soft 12%-ink blur, invisible on the tinted grounds.)
 * The panel is a `::before`, so it paints FIRST: MiniCard's icon layer, icon and text
 * all sit over it. Unlike the tower's stock it keeps the hairline ring (CLAUDE.md
 * "Buttons & cards").
 */
/**
 * The cast shadow scales with the wall, on both axes: it reaches CARD_SHADOW_PER_WALL ×
 * the wall's own extrusion right and down — the artboard's ratio (a 14px shadow drop
 * under a 6px lip), applied to the 2 × 2px wall, so ≈ 4.7px each way.
 */
const CARD_SHADOW_PER_WALL = 14 / 6;
/**
 * A held card is lifted further off the ground, so its shadow falls further away: at
 * full lift (`lift` = 1) the cast shadow's offset is HELD_SHADOW_GROWTH × its resting
 * offset. DraggableCard springs `lift` 0 → 1 on pickup and back to 0 on a miss.
 */
const HELD_SHADOW_GROWTH = 2.5;
const cardCastShadow = (groundShadow: string, lift = 0) => {
    const reach = CARD_SHADOW_PER_WALL * (1 + (HELD_SHADOW_GROWTH - 1) * lift);
    return `${(CARD_WALL_X * reach).toFixed(2)}px ${(CARD_WALL_Y * reach).toFixed(2)}px 0 ${groundShadow}`;
};
/**
 * The stock's whole box-shadow: hairline ring, wall, cast shadow (at `lift`). A sorted
 * card is GROUNDED — it stands on the ground rather than floating over it, so it casts no
 * shadow (its wall meets the ground) and never lifts.
 */
const cardStockShadow = (sorted: boolean, groundShadow: string, lift = 0) =>
    sorted
        ? `${MINI_CARD_RING}, ${SORTED_CARD_LIP}`
        : `${MINI_CARD_RING}, ${CARD_LIP}, ${cardCastShadow(groundShadow, lift)}`;
const sortCardStockSx = (size: MiniCardSize, sorted: boolean, groundShadow: string) => {
    const width = MINI_CARD_DIMENSIONS[size].width;
    return {
        boxShadow: cardStockShadow(sorted, groundShadow),
        "&::before": {
            content: '""',
            position: "absolute",
            inset: `${width * FLP_CARD_STOCK_INSET_RATIO}px`,
            borderRadius: `${width * FLP_CARD_PANEL_RADIUS_RATIO}px`,
            backgroundColor: sorted ? SORTED_STOCK.panel : COLORS.cardBeige,
            pointerEvents: "none",
        },
    } as const;
};

// Resting cards levitate: a 3px rise and fall (the artboard's `lev`), each slot a
// different phase so the pack never moves in lockstep. Driven by the CSS `translate`
// property, which composes with the drag spring's `transform` rather than fighting it.
const CARD_LEVITATE_MS = 4200;
const cardLevitateKeyframes = keyframes`
    0%, 100% { translate: 0 0; }
    50%      { translate: 0 -3px; }
`;
const LEVITATE_PHASES_MS = [0, -1100, -2300, -3100];

// DESKTOP HOVER (user request 2026-10-29): a mouse resting on a live card stops its
// levitation and raises it like the selected card in a hand of cards — up HOVER_RAISE_PX,
// its cast shadow reaching HOVER_LIFT of the way to a held card's (so the shadow falls
// further away as the card rises, by the same rule as a pickup). Mouse only: a touch has
// no hover, and a press there is already the start of a drag.
const HOVER_RAISE_PX = 10;
const HOVER_LIFT = 0.5;
const HOVER_RAISE_MS = 180;

/**
 * One draggable (or locked) card within the on-deck pack. Owns its own drag spring so
 * the pack's cards move independently. On drop into a bucket it hands off to `onDrop`
 * (the page sorts it; the card vanishes and the bin sets a new top card on its deck); locked cards (already in the library) show a "sorted!" watermark and don't
 * drag.
 */
// memo is load-bearing, not just a perf tweak: while a card is being dragged, the
// parent SortCardsPage re-renders on unrelated state — most notably `tts.speakingKey`
// flipping on every autoplay narration start/stop (read for the speaker button's
// isLoading), and `highlightedBucket` on every drag-move. Re-rendering a card mid-drag
// interrupts its live use-gesture gesture: the handler fires the release path with the
// pointer not over a bucket, so the card snaps back to its tray origin WHILE the finger
// is still down (the "snaps back a second or two into audio" bug). All props below are
// referentially stable across those re-renders, so memo lets the dragged card skip them
// entirely and keeps its gesture intact.
const DraggableCard = memo(function DraggableCard({ card, size, locked, sorted, groundShadow, levitatePhaseMs = 0, settleIn = false, onCheckCollision, onHighlight, onDrop, onFirstDrag }: {
    card: DiscoverCard;
    /** The pack's face size (see dockCardSize). Held/fall lift is relative to it. */
    size: MiniCardSize;
    /** Not draggable (an already-sorted card, or any card in the leaving overlay). */
    locked: boolean;
    /**
     * Already in the user's library: drawn greyed and GROUNDED (no levitation, no cast
     * shadow) with the "sorted!" tag. Separate from `locked` so a live card sliding out
     * in the leaving overlay keeps its normal look.
     */
    sorted: boolean;
    /** The look's `groundShadow` — the card's cast shadow on the ground. */
    groundShadow: string;
    /** The look's shadow tone on the ground, for the card's cast shadow (changes with the hour only). */
    /** This slot's phase in the resting levitation (LEVITATE_PHASES_MS); 0 for none. */
    levitatePhaseMs?: number;
    /** Read at mount only: pop the card back into its crater (Undo re-showing it). */
    settleIn?: boolean;
    onCheckCollision: (clientX: number, clientY: number) => string | null;
    onHighlight: (bucketId: string | null) => void;
    /**
     * Dropped on a bucket: the page sorts the card (`handleSortCard`), which unmounts it.
     */
    onDrop: (cardId: number, bucketId: string) => void;
    onFirstDrag: () => void;
}) {
    // Pack arrivals are animated by the enclosing EnteringCardSlot (the whole slot
    // slides in), so this spring normally only moves for drag / drop. The one entrance
    // it owns is `settleIn`: Undo re-showing a card inside a slot that never left, where
    // the card pops back into the crater it left behind.
    // `lift` (0 resting → 1 held) drives the cast shadow's reach (HELD_SHADOW_GROWTH).
    const [{ x, y, scale, opacity, lift }, api] = useSpring(() => ({ x: 0, y: 0, scale: 1, opacity: 1, lift: 0 }));
    // Desktop hover raise (HOVER_RAISE_PX). `hovered` drives the raise; the ref lets a
    // missed drop settle back to the hover lift rather than the ground. `wasHovered`
    // makes the levitation restart from rest after a hover (see the sx `animation`).
    const [hovered, setHovered] = useState(false);
    const [wasHovered, setWasHovered] = useState(false);
    const hoveredRef = useRef(false);
    const canHover = !locked && !sorted;
    const handlePointerEnter = (e: React.PointerEvent) => {
        if (!canHover || e.pointerType !== "mouse") return;
        hoveredRef.current = true;
        setHovered(true);
        setWasHovered(true);
        api.start({ lift: HOVER_LIFT, config: { tension: 400, friction: 30 } });
    };
    const handlePointerLeave = (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse" || !hoveredRef.current) return;
        hoveredRef.current = false;
        setHovered(false);
        api.start({ lift: 0, config: { tension: 400, friction: 30 } });
    };
    useEffect(() => {
        if (!settleIn) return;
        api.set({ x: 0, y: 0, scale: 0.9, opacity: 0 });
        api.start({ scale: 1, opacity: 1, config: { tension: 280, friction: 26 } });
    // Mount-only by design: a later settleIn change must not replay the pop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api]);

    // A drag attempted on a SORTED card plays the app's invalid-operation shake
    // (theme/invalidShake). Each attempt bumps the nonce, and the effect restarts the CSS
    // animation in place: an inline `animation: none`, a forced reflow, then clearing it
    // hands the class's animation back from its first frame.
    // NOT by re-keying the card (as it did at first): remounting the element in the
    // middle of a gesture strands use-gesture's drag state on the removed node — its
    // pointerup never arrives — so every later attempt never got a `first` and the shake
    // played only once.
    const [shakeNonce, setShakeNonce] = useState(0);
    const cardElRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = cardElRef.current;
        if (shakeNonce === 0 || !el) return;
        el.style.animation = "none";
        void el.offsetWidth;
        el.style.animation = "";
    }, [shakeNonce]);

    const bind = useDrag(
        ({ first, tap, down, movement: [mx, my], xy: [px, py] }) => {
            if (locked) {
                // A sorted card refuses both a drag (`first`, once past filterTaps'
                // threshold) and a tap on the card itself (`tap`, on release) — user
                // request 2026-10-29. Its audio/info buttons sit outside the card, so
                // tapping them never shakes. A tap reports at most one of the two flags.
                if (sorted && (first || tap)) setShakeNonce((n) => n + 1);
                return;
            }
            if (first) onFirstDrag();
            if (down) {
                // Held: track the finger/cursor 1:1 (immediate) at the one pickup lift. The
                // card itself never changes over a bucket; the page grows the target bin
                // (onHighlight → activeBinId). Re-issuing the same target every move is a
                // no-op for a spring already there.
                const overBucket = onCheckCollision(px, py);
                api.start({ x: mx, y: my, scale: HELD_CARD_SCALE, immediate: true });
                // The shadow eases out from under the card as it rises (not a snap).
                api.start({ lift: 1, config: { tension: 400, friction: 30 } });
                onHighlight(overBucket);
                return;
            }
            // Released.
            const bucketId = onCheckCollision(px, py);
            if (bucketId) {
                // Successful drop: hand off to the page. It resolves the card at once —
                // this card unmounts (despawns) where it was let go, leaving its crater,
                // and a completed pack can start sliding out THIS frame. The only motion
                // is the bin's own: its count ticks and it sets the new top card down on
                // its deck (SortBins `sort-bins__placed`). There is no fall to the bin
                // (removed by user request 2026-10-29). Deliberately never springs x/y back to the tray origin — that made the
                // card visibly fly home as it committed (the old "snap-back" bug).
                onHighlight(null);
                onDrop(card.id, bucketId);
            } else {
                // Missed the buckets: spring back to the resting tray slot, clean.
                onHighlight(null);
                api.start({ x: 0, y: 0, scale: 1, lift: hoveredRef.current ? HOVER_LIFT : 0 });
            }
        },
        { filterTaps: true }
    );

    return (
        <AnimatedMiniCard
            ref={cardElRef}
            className={hovered ? "sort-cards__flash-card sort-cards__flash-card--hovered" : "sort-cards__flash-card"}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
            // Sorted cards bind too, only to catch a drag attempt and shake.
            {...(locked && !sorted ? {} : bind())}
            // boxShadow rides the spring (inline, so it wins over the sx one below).
            style={{ x, y, scale, opacity, zIndex: 1000, boxShadow: lift.to((l) => cardStockShadow(sorted, groundShadow, l)) }}
            size={size}
            language={card.language}
            entryKey={card.entryKey}
            pronunciation={card.pronunciation}
            definition={stripParentheses(card.definition ?? "")}
            iconId={card.iconId}
            // Sorted cards are the same raised stock in greys (SORTED_STOCK), standing on
            // the ground instead of floating; their print is washed out and the "sorted!"
            // head band (sortedBandSx) carries the meaning. The grayscale sits on the PRINT only —
            // a filter on the card would also grey its stock and shadow.
            background={sorted ? SORTED_STOCK.rim : COLORS.cardFace}
            sx={{
                cursor: locked ? "not-allowed" : "grab",
                "&:active": { cursor: locked ? "not-allowed" : "grabbing" },
                touchAction: "none",
                ...(sorted && {
                    "& .mini-card__icon-slot, & .mini-card__key-wrapper, & .mini-card__definition": {
                        filter: "grayscale(1)",
                        opacity: SORTED_PRINT_OPACITY,
                    },
                }),
                // The tower's card stock: rim + panel, wall, lifted shadow (replacing
                // MiniCard's soft raised shadow).
                ...sortCardStockSx(size, sorted, groundShadow),
                // A transformed, positioned card: content-visibility would let the browser
                // skip painting it mid-drag at the screen edge.
                contentVisibility: "visible",
                // Only floating cards levitate; a sorted card rests on the ground, and
                // shakes on a drag attempt (never on mount: nonce 0).
                // Hovered (desktop): the bob stops and the card eases up into its raise —
                // the transition starts from wherever the bob had it. Un-hovered, it eases
                // back to rest, and the bob resumes FROM rest once it is there (a positive
                // delay of HOVER_RAISE_MS rather than the slot's phase, which would jump).
                animation: sorted
                    ? (shakeNonce > 0 ? INVALID_SHAKE_ANIMATION : "none")
                    : hovered
                        ? "none"
                        : `${cardLevitateKeyframes} ${CARD_LEVITATE_MS}ms ease-in-out ${wasHovered ? HOVER_RAISE_MS : levitatePhaseMs}ms infinite`,
                translate: hovered ? `0 -${HOVER_RAISE_PX}px` : "0 0",
                transition: `translate ${HOVER_RAISE_MS}ms ease-out`,
                ...(sorted && INVALID_SHAKE_KEYFRAMES),
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            }}
        >
            {sorted && (
                <Box className="sort-cards__sorted-band" sx={sortedBandSx(size)}>
                    SORTED
                </Box>
            )}
        </AnimatedMiniCard>
    );
});

const SortCardsPage: React.FC = () => {
    usePageTitle("Discover");
    const navigate = useNavigate();
    const { isAuthenticated, user } = useAuth();
    const { language } = useParams<{ language: Language }>();
    const [searchParams] = useSearchParams();

    // SET MODE (docs/PROVISIONAL_CARDS.md § Sorting what you played).
    //
    // Normally this page pulls an open-ended supply of packs centered on the learner's
    // level, and never ends. `?set=provisional` instead hands it a FIXED set: the
    // temporary cards a game just lent the player, offered once so they can decide
    // which to keep. `words` narrows that to the cards ONE round used; omitting it
    // offers every temporary card they still hold.
    //
    // Two behavioural differences follow, both handled below: the queue is never
    // replenished, and the page CLOSES itself once the last card of the set is sorted
    // (a fixed set that ran out is "done", not "exhausted the dictionary").
    const setMode = searchParams.get("set") === "provisional";
    const setWords = useMemo(() => {
        const raw = searchParams.get("words") ?? "";
        return raw.split(",").map((word) => word.trim()).filter((word) => word.length > 0);
    // Read once per distinct query string; the list is a stable input to the fetch below.
    }, [searchParams]);
    const tts = useTTS();
    // The eip renders pinyin per the SAME saved preference the flp uses, so a learner who
    // turned pinyin off there doesn't get it back here. scp deliberately exposes no toggle
    // of its own — the panel is a read-only detour, not a second settings surface.
    // `useTTS` returns a NEW object identity every time its internal `speakingKey` state
    // flips — which happens on every autoplay narration start/stop. Depending on `tts`
    // directly in the callbacks below would therefore re-create them on each narration
    // event, changing the props handed to (memoized) DraggableCards and forcing them to
    // re-render mid-drag — which cancels the live drag gesture and snaps the held card
    // back to its tray origin (the "snaps back a second into audio" bug). Reading tts
    // through a ref keeps these callbacks referentially stable so the dragged card stays
    // inert while audio plays.
    const ttsRef = useRef(tts);
    ttsRef.current = tts;

    // FIFO queue of PACKS. queue[0] is the on-deck pack; the rest is the buffer.
    const [queue, setQueue] = useState<SortPack[]>([]);

    // The pack most recently put back on deck by Undo, and how its slots (re)mount
    // instead of the "dock" slide-in: "rise" for a card re-shown in the on-deck pack,
    // "return" (after `delayMs`, the un-dock) for the previous pack brought back — see
    // EnteringCardSlot. Only ever compared against the on-deck packKey, so it is harmless
    // for it to linger once that pack has moved on.
    const [undoRestore, setUndoRestore] = useState<{ packKey: string; entrance: "rise" | "return"; delayMs: number } | null>(null);
    const undoRestoredPackKey = undoRestore?.packKey ?? null;
    // The pack that just advanced off deck, rendered in PackExitClip while its cards slide
    // off to the left and its labels fade (docs §4.1 "Pack exit"). `rowTop` is the live
    // row's top inside the section, measured at advance time (the overlay sits exactly
    // there); `exitId` keys the overlay so two quick advances restart the animation instead of
    // reusing a finished one. `direction` "left" is the forward conveyor; "right" is
    // Undo's un-dock (the on-deck pack sliding back out the way it came, `durationMs`
    // long — see undoExitMs).
    const [leavingPack, setLeavingPack] = useState<{ pack: SortPack; rowTop: number; exitId: number; direction: "left" | "right"; durationMs: number } | null>(null);
    // The leaving pack's overlay is dropped once its exit has played. A timer rather than
    // animationend: the exit is several animations (each card, each label row), none of
    // which is "the" end. Keyed on exitId so a new exit restarts it.
    useEffect(() => {
        if (!leavingPack) return;
        const timer = window.setTimeout(() => setLeavingPack(null), leavingPack.durationMs);
        return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leavingPack?.exitId]);
    const exitIdRef = useRef(0);
    // The live CardsRow, measured when a pack leaves so the exit overlay can sit in the
    // exact same spot and know how far it has to travel to clear the section's top.
    const cardsRowRef = useRef<HTMLDivElement>(null);
    // The on-deck row's width, which decides whether a pack fits across on regular
    // MiniCards or needs the compact face (dockCardSize). A callback ref, not a ref +
    // effect: the platform only mounts once the first pack arrives (the page shows a
    // spinner before that), so an effect keyed on mount would miss it. The first width
    // is read synchronously in the commit, so a 4-card pack is laid out compact before
    // its first paint rather than flashing at the regular size.
    const [dockWidth, setDockWidth] = useState<number | null>(null);
    const dockResizeObserverRef = useRef<ResizeObserver | null>(null);
    const onDeckSectionRef = useCallback((el: HTMLDivElement | null) => {
        dockResizeObserverRef.current?.disconnect();
        dockResizeObserverRef.current = null;
        if (!el) return;
        setDockWidth(el.clientWidth);
        const observer = new ResizeObserver(([entry]) => {
            if (entry) setDockWidth(entry.contentRect.width);
        });
        observer.observe(el);
        dockResizeObserverRef.current = observer;
    }, []);
    // Cards resolved (sorted or skipped) this session, per packKey → set of cardIds.
    // Drives which cards are still draggable; survives advancing so Undo can restore.
    // `doneRef` is the authoritative copy read by handlers (so rapid successive sorts
    // don't race on a stale `done` closure); `done` state exists only to trigger renders.
    const [done, setDone] = useState<Record<string, Set<number>>>({});
    const doneRef = useRef<Record<string, Set<number>>>({});
    const [exhausted, setExhausted] = useState(false);
    const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [highlightedBucket, setHighlightedBucket] = useState<string | null>(null);
    // Manual HSK/difficulty override from the level dropdown; null = "auto" (the
    // client-tracked adaptive target below). Not persisted — reverts to auto on
    // reload, matching the request-scoped nature of a "show me level N" session.
    const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
    const [levelMenuAnchor, setLevelMenuAnchor] = useState<HTMLElement | null>(null);

    // Session counts — how many cards the learner has sorted into each bin on THIS visit,
    // printed on the bins' decks (SortBins), one deck layer per card. Start at 0 on every
    // visit; Undo takes a card back off. Deliberately not the account's library totals
    // (the pre-2026-10-29 tally pills): the decks grow as the learner works, which is the
    // point of drawing them as decks.
    const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({ library: 0, "already-learned": 0 });

    // Adaptive leveling state (docs/SORT_CARDS_REQUIREMENTS.md §6): the CLIENT is the
    // sole owner of the auto target level once seeded. Refs (not state) because they
    // must be read synchronously by advancePack right after a signal updates them — no
    // re-render round-trip, and the number is never displayed (fluctuates too much to
    // show live — the chip just reads "Auto").
    //   - autoLevelRef: the current auto target; null until the first (cold-start)
    //     server response seeds it.
    //   - packBucketsRef: which bucket each card in a pack was actually sorted into
    //     THIS session, so a completing pack's signal can be derived (a pack counts as
    //     ONE signal no matter how many of its cards were sorted — §6).
    const autoLevelRef = useRef<number | null>(null);
    const packBucketsRef = useRef<Record<string, Record<number, string>>>({});

    // ---- eip (extra info panel) -------------------------------------------
    // The same sheet the flp opens, mounted here so a learner can inspect a card
    // BEFORE deciding which bucket it belongs in (docs/SORT_CARDS_REQUIREMENTS.md §4.7).
    // useEipTabs owns tab state + the drill-in lookups; `language` is the ROUTE's
    // language, not the account's, because scp can show either.
    const eip = useEipTabs({ language });
    const [eipOpen, setEipOpen] = useState(false);
    // entryKey whose lookup is in flight, so only the tapped card's info button
    // shows a spinner. Also gates re-taps on that same card.
    const [eipLoadingKey, setEipLoadingKey] = useState<string | null>(null);
    // NOTE: the footer pill is not suppressed here. SheetPanel hosts every modal sheet at
    // the phone frame above the bar (its scrim dims it, the sheet covers it), because a
    // sheet can now grow to cover the whole screen and the pill would float over it on
    // every host, not just this one.

    // Each bin's hit area (its SVG group) — registered by SortBins.
    const binRefs = useRef<Map<string, Element>>(new Map());
    const registerBin = useCallback((id: string, el: Element | null) => {
        if (el) binRefs.current.set(id, el);
        else binRefs.current.delete(id);
    }, []);
    // Bin geometry snapshotted at drag START. The highlight and drop hit-tests both read
    // from THIS (not live getBoundingClientRect), so they share one identical threshold
    // and a drag-move costs no layout read. (The bins bob a few px; a snapshot taken
    // mid-bob is well inside that tolerance.)
    const bucketRectsRef = useRef<Map<string, DOMRect>>(new Map());

    // The two bins, coloured as the COLLECTION each one feeds, exactly as the fdp's
    // filter tiles (LibraryDuo) paint those collections: LEARNING_COLORS for Learning and
    // the core bar's MASTERY_BAR_COLORS for Mastered (the ramp SURFACE tier). Ids are the
    // sort API's bucket wire values.
    const bins = useMemo<readonly [SortBinSpec, SortBinSpec]>(() => [
        // Bin names are the learner's own verdict on the card, not the collection names
        // ("Learning" / "Already Learned") — user-chosen copy, 2026-10-29.
        { id: "library", label: "To Learn", color: LEARNING_COLORS.main },
        { id: "already-learned", label: "Already Know", color: MASTERY_BAR_COLORS.core.main },
    ], []);

    // ---- Time of day (docs/SORT_CARDS_REQUIREMENTS.md § 4.9) ---------------
    // The app's shared day clock — the one the Deck Tower and the eip read, with the
    // feature-tester pin set from the tower's TimeOfDayToggle — so scp always shows the
    // hour the tower does.
    const { time: dayTime } = useDayClock(user?.isFeatureTester === true);
    const look = useMemo(() => sortLookAt(dayTime), [dayTime]);
    // The status-bar band and the home-screen app's glyph scheme follow the ground.
    useThemeColor(look.ground);
    // The slab footer casts its shadow onto this page's ground.
    useEffect(() => {
        setFooterCastShadow(look.groundShadow);
        return () => setFooterCastShadow(null);
    }, [look.groundShadow]);

    // The level pill's "Difficulty" caption, shown for a learner's first visits only.
    const difficultyCaption = useSoftIntro("sortDifficultyCaption");

    // Pack queue: (re)fetched on mount AND whenever the level dropdown changes — a
    // level switch is allowed to replace the on-deck pack (docs/SORT_CARDS_REQUIREMENTS.md
    // §6.5), so it re-runs the same initial-fill fetch rather than patching the
    // existing queue. Auto's request level is whatever the client is already tracking
    // (autoLevelRef) — null only on the very first call this session, which asks the
    // server for a cold-start seed.
    useEffect(() => {
        const fetchPacks = async () => {
            setLoading(true);
            // A level switch starts a fresh on-deck session: undo history and resolved
            // markers from the previous level/queue no longer refer to anything the new
            // queue holds, so carrying them over would let Undo resurrect a stale pack.
            doneRef.current = {};
            setDone({});
            setUndoStack([]);
            packBucketsRef.current = {};
            setUndoRestore(null);
            setLeavingPack(null);
            try {
                // Set mode short-circuits the level-based supply entirely: the set is
                // whatever the server still holds as provisional for this user. Each
                // card becomes its own pack-of-1 (the same `single:<cardId>` shape the
                // fallback supply uses), so the existing pack machinery — drag, undo,
                // resolved markers — works unchanged, and every card is offered.
                if (setMode) {
                    const { cards } = await fetchProvisionalSortSet(language as Language, setWords);
                    setQueue(cards.map((card) => ({
                        packKey: `single:${card.id}`,
                        packId: null,
                        level: card.difficulty ?? 1,
                        cards: [card],
                    })));
                    // Nothing to exhaust — a fixed set either has cards or is already done.
                    setExhausted(false);
                    return;
                }

                const requestLevel = selectedLevel != null ? selectedLevel : autoLevelRef.current;
                const data = await fetchStarterPacks(
                    language as Language,
                    requestLevel,
                    selectedLevel != null,
                );
                setQueue(data.packs);
                setExhausted(data.exhausted);
                // Only auto ever needs to learn the level from the server — the
                // cold-start seed. A manual pin's level is already known locally
                // (selectedLevel), and re-echoes of an already-tracked auto level
                // are harmless no-ops.
                if (selectedLevel == null && typeof data.level === "number") autoLevelRef.current = data.level;
            } catch (error) {
                console.error("Error fetching packs:", error);
            } finally {
                setLoading(false);
            }
        };
        if (language) fetchPacks();
    // isAuthenticated not `token`: a silent refresh must not restart the sort
    // session (wiping undo history + resolved markers). See CLAUDE.md "Never
    // reload on token refresh". (The effect now satisfies the exhaustive-deps rule on
    // its own — starterPacksApi reads the token at call time.)
    }, [language, isAuthenticated, selectedLevel, setMode, setWords]);

    const currentPack = queue[0];
    // "dock" entrance stagger (docs/SORT_CARDS_REQUIREMENTS.md §4.1 "Pack entrance"):
    // each on-deck card gets 0, STEP, 2·STEP, … ms in slot order, fixed once per pack
    // landing (keyed on packKey).
    const dockDelays = useMemo(() => {
        const delays: Record<number, number> = {};
        if (!currentPack) return delays;
        // In slot order, leftmost first: the cards come in off the belt one behind another.
        const steps = currentPack.cards.map((_, i) => i * DOCK_STAGGER_STEP_MS);
        // Exit first, then enter (docs §4.1): when this pack replaced one that is now
        // sliding out, hold the whole entrance until the exit has finished. advancePack
        // sets leavingPack in the same batch as the queue change, so it is already set on
        // the render that lands this pack. The slots sit below the screen meanwhile
        // (EnteringCardSlot's `backwards` fill applies the start frame during the delay).
        const afterExitMs = leavingPack ? PACK_EXIT_MS : 0;
        currentPack.cards.forEach((card, i) => { delays[card.id] = afterExitMs + steps[i]; });
        return delays;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPack?.packKey]);

    // Difficulty label for a bare level number ("HSK 3" for zh, "Level 3" otherwise).
    const difficultyLabel = useCallback((lvl: number) => levelLabelFor(language, lvl), [language]);
    // The chip shows the bare label once the user has pinned a specific difficulty via
    // the dropdown, or just "Auto" — the adaptive target moves per-pack and fluctuates
    // too much to show live (docs §6), so it is never rendered as a number.
    const levelLabel = selectedLevel != null ? difficultyLabel(selectedLevel) : "Auto";

    // Apply one card's effect on its bin's session count. `direction` is +1 for a sort,
    // -1 for an undo. A skip touches neither bin (it never creates a vet row).
    const adjustTally = useCallback((bucket: string, direction: 1 | -1) => {
        if (bucket !== "library" && bucket !== "already-learned") return;
        setSessionCounts((c) => ({ ...c, [bucket]: Math.max(0, (c[bucket] ?? 0) + direction) }));
    }, []);

    // Log every card that lands on-deck (i.e. becomes a live, visible slot). One log
    // per card, keyed on the pack — a pack arriving on-deck emits one of these per card
    // it carries. See logSortCard for the payload shape.
    useEffect(() => {
        if (!currentPack) return;
        for (const card of currentPack.cards) {
            logSortCard("card displayed", card, currentPack, {
                estimatedLevel: autoLevelRef.current,
                // Pre-sorted cards render locked (greyed, undraggable) rather than
                // sortable, so the log distinguishes them from live slots.
                locked: !!card.sorted,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPack?.packKey]);

    // Snapshot every bucket's rect at drag start. Both the highlight and the drop test
    // read these frozen rects, so the two thresholds can never differ.
    const snapshotBucketRects = useCallback(() => {
        const rects = new Map<string, DOMRect>();
        for (const [id, el] of binRefs.current) rects.set(id, el.getBoundingClientRect());
        bucketRectsRef.current = rects;
    }, []);

    // Collision test: is the pointer over a bucket? Uses the drag-start snapshot (above)
    // so highlight and drop hit-test against the exact same geometry.
    const checkBucketCollision = useCallback((clientX: number, clientY: number): string | null => {
        for (const [id, r] of bucketRectsRef.current) {
            if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return id;
        }
        return null;
    }, []);

    // Prime the audio sinks from this gesture. Deliberately NOT guarded by a
    // "did it once" ref: `CloudTTSProvider.unlock()` is repeatable and cheap by
    // design (one `ctx.state` read when there is nothing to do), and it is the
    // only way to recover a context the OS suspended mid-session. A local latch
    // here would spend that recovery on the first drag of the session and leave
    // narration dead until reload — the exact bug fixed on 2026-08-28.
    const unlockAudio = useCallback(() => {
        ttsRef.current.unlockAudio();
    }, []);

    // Fires when a card is first picked up (drag start). Unlocks audio (mobile requires
    // a user gesture) and freezes the current bucket geometry so the highlight and drop
    // hit-tests share one threshold. Narration itself is handled by the pack-level
    // autoplay effect below, not per-pickup.
    const handleCardPickup = useCallback(() => {
        unlockAudio();
        snapshotBucketRects();
    }, [unlockAudio, snapshotBucketRects]);

    // The live pack-autoplay run (see the autoplay effect below), or null when none is
    // in progress. A mutable token rather than the effect's closure-local flag, so a
    // MANUAL narration can end the sequence without waiting for the pack to change.
    const packAutoplayRunRef = useRef<{ stopped: boolean } | null>(null);

    // End the pack-autoplay sequence, if one is running. Called before every manual
    // narration on this page: otherwise the manual press cancels the word autoplay is
    // on, that word's promise resolves, and the loop's NEXT autoSpeakSentence cancels
    // the word the learner just asked for — cutting their replay off after a syllable.
    // A deliberate press is taken as "I've got it from here", so the rest of the
    // pack is not resumed afterwards.
    const stopPackAutoplay = useCallback(() => {
        if (packAutoplayRunRef.current) packAutoplayRunRef.current.stopped = true;
    }, []);

    // Tap-to-play for a single card's header speaker button. Unlocks audio on the
    // gesture (mobile) then narrates just that card's word. An on-demand replay that
    // ends any pack autoplay still in progress (stopPackAutoplay).
    const handlePlayCardAudio = useCallback(
        (card: DiscoverCard) => {
            unlockAudio();
            stopPackAutoplay();
            void ttsRef.current.speakSentence(card.entryKey, card.pronunciation ?? undefined);
        },
        [unlockAudio, stopPackAutoplay]
    );

    // The eip's speaker buttons, wrapped for the same reason as handlePlayCardAudio:
    // the panel can be opened while the pack is still being narrated. Read through
    // ttsRef so the identities stay stable across narration-driven re-renders.
    const handleEipSpeak = useCallback(
        (...args: Parameters<typeof tts.speak>) => {
            stopPackAutoplay();
            return ttsRef.current.speak(...args);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [stopPackAutoplay]
    );
    const handleEipSpeakSentence = useCallback(
        (...args: Parameters<typeof tts.speakSentence>) => {
            stopPackAutoplay();
            return ttsRef.current.speakSentence(...args);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [stopPackAutoplay]
    );

    // Open the eip for one on-deck card. A DiscoverCard is NOT a VocabEntry — it carries
    // none of the clustered senses, extended definition, approval flags or "used in" list
    // the panel renders — so the word is looked up in det first and adapted, exactly as
    // the flp's drill-in taps do. The result seeds the panel's ROOT tab (openForRoot), so
    // the tab strip stays hidden until the user actually drills into a breakdown
    // character or example segment.
    //
    // Failure (no det row / offline) deliberately does nothing visible beyond clearing the
    // spinner: this is an optional detour off the sort flow, and a blocking error dialog
    // would be a heavier interruption than the information was worth.
    const handleOpenCardInfo = useCallback(
        async (card: DiscoverCard) => {
            if (eipLoadingKey) return; // one lookup at a time
            setEipLoadingKey(card.entryKey);
            try {
                const entry = await lookupVocabEntry(card.entryKey, language);
                eip.openForRoot(entry);
                setEipOpen(true);
            } catch (error) {
                console.error(`Failed to open the info panel for "${card.entryKey}":`, error);
            } finally {
                setEipLoadingKey(null);
            }
        },
        [eipLoadingKey, language, eip]
    );

    // ---- hidden skipped-cards sheet (§5.1a) -------------------------------
    // Holding Skip for SKIP_HOLD_MS opens it (with a quiet buzz where the device supports
    // one); a shorter tap still skips the pack. useLongPress swallows the click that
    // follows a fired hold, so a hold never ALSO skips. Nothing at rest hints that the
    // hold exists; only once a press is under way does the button's outline trace
    // (HoldProgressRing — the same timer as the sheet's hold-to-recycle cards).
    const [skippedSheetOpen, setSkippedSheetOpen] = useState(false);
    const skipPress = useLongPress({
        delayMs: SKIP_HOLD_MS,
        onLongPress: () => {
            quietHaptic();
            stopPackAutoplay();
            setSkippedSheetOpen(true);
        },
        onTap: () => { void handleSkipPack(); },
    });
    const handleCloseSkippedSheet = useCallback(() => setSkippedSheetOpen(false), []);

    // Closing KEEPS the tabs (2026-09-06): the trail belongs to the card, so reopening the
    // panel on the same card resumes the drill-in chain where the learner left it. Opening
    // it on a DIFFERENT card is what starts clean — `openForRoot` reseeds whenever the root
    // word changes — and leaving the page unmounts the hook, which drops everything.
    const handleCloseEip = useCallback(() => {
        setEipOpen(false);
    }, []);

    // Autoplay: narrate every card in the on-deck pack, left to right, once per
    // pack (keyed on packKey so it fires exactly once when a pack lands on-deck,
    // not on every re-render). Cards already resolved/locked are still narrated —
    // this is about hearing the pack's words, not just the still-sortable ones.
    // Cancelled (and any in-flight utterance stopped) if the pack changes; turning
    // audio off mid-sequence stops the utterance via useTTS, which cancels on the
    // on → off edge for every surface at once. A manual speaker press (card or eip)
    // ends the run too, via packAutoplayRunRef — see stopPackAutoplay.
    //
    // `tts.autoplay` is deliberately NOT a dep. It used to be, and the off → on edge
    // then replayed the whole on-deck pack the moment the learner tapped the header
    // audio chip. Changing a setting is not a request to hear the pack again; the
    // per-card speaker button is. The guard below reads the flag as it stood when
    // the pack landed, which is the only moment auto-narration is meant to start.
    useEffect(() => {
        if (!currentPack) return;
        if (!tts.autoplay) return;
        const run = { stopped: false };
        packAutoplayRunRef.current = run;
        (async () => {
            for (const [i, card] of currentPack.cards.entries()) {
                // A beat of silence between words so they don't run together — the
                // learner hears three separate words, not one phrase. Checked again
                // after the wait: the run may have been stopped during it.
                if (i > 0) await new Promise((resolve) => setTimeout(resolve, AUTOPLAY_GAP_MS));
                if (run.stopped) return;
                await tts.autoSpeakSentence(card.entryKey, card.pronunciation ?? undefined);
            }
            if (packAutoplayRunRef.current === run) packAutoplayRunRef.current = null;
        })();
        return () => {
            run.stopped = true;
            if (packAutoplayRunRef.current === run) packAutoplayRunRef.current = null;
            tts.cancel();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPack?.packKey]);

    // Advance past a completed pack: drop the head and refill the tail with one pack,
    // excluding the packKeys we still hold so the replacement is never a duplicate.
    // Called only after the completing card's own /sort call has resolved (see
    // handleSortCard) — calling it any earlier lets /next-pack race ahead of the
    // server-side markPackSeen and re-serve the pack that's still finishing.
    // `afterSorted` is the completing card's sort POST, when there is one. The pack's
    // visual exit starts IMMEDIATELY (it plays alongside the dropped card's fall), but
    // the replenish request waits for that POST: requesting /next-pack before the
    // server has recorded the completing sort (and marked the pack seen) lets it race
    // ahead and re-serve the very pack that just left.
    const advancePack = useCallback(async (completedKey: string, { afterSorted, attempt = 0 }: { afterSorted?: Promise<unknown>; attempt?: number } = {}) => {
        const rest = queue.filter((p) => p.packKey !== completedKey);

        // Pack exit (docs §4.1): hand the on-deck pack to the leaving overlay so it can
        // slide off to the left; its replacement then slides in from the right once the
        // exit is done (see dockDelays).
        // Only when a replacement is ALREADY buffered — with an empty buffer the page
        // drops to its spinner branch (no platform, no overlay), and a leaving pack kept
        // in state would then play its exit late, once the fetched pack arrived. Retries
        // (attempt > 0) never re-trigger it: the pack already left on the first call.
        const leaving = queue[0];
        const row = cardsRowRef.current;
        // Reduced motion: no exit at all (the new pack also appears without its slide).
        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
        if (attempt === 0 && !reducedMotion && leaving?.packKey === completedKey && rest.length > 0 && row) {
            exitIdRef.current += 1;
            setLeavingPack({ pack: leaving, rowTop: row.offsetTop, exitId: exitIdRef.current, direction: "left", durationMs: PACK_EXIT_MS });
        }
        setQueue(rest);

        // Set mode never replenishes — the set is fixed. Emptying the queue IS the exit
        // condition, but the navigation itself lives in the effect below so that every
        // path that empties the queue (sort, skip, or a set that came back already done)
        // closes the page, not just this one.
        if (setMode) return;

        // A failed sort still releases the replenish: the pack has already left, and
        // holding the refill would strand the queue one pack short.
        if (afterSorted) await afterSorted.catch(() => undefined);

        try {
            // Reads autoLevelRef fresh (not a stale closure) — handleSortCard updates it
            // synchronously from the completing pack's signal BEFORE calling advancePack,
            // so a downgrade/upgrade is reflected in THIS replenish request already
            // (docs §6: "set to sortPackLevel±1", never a stale increment).
            const requestLevel = selectedLevel != null ? selectedLevel : autoLevelRef.current;
            const data = await fetchNextPack({
                language: language as Language,
                excludePackKeys: rest.map((p) => p.packKey),
                level: requestLevel,
                manual: selectedLevel != null,
            });
            setExhausted(data.exhausted);
            if (data.nextPack) {
                const next = data.nextPack;
                setQueue((prev) => (prev.some((p) => p.packKey === next.packKey) ? prev : [...prev, next]));
                // Log every card the replenish call brought back, one line each — the
                // mirror of the "card displayed" logs these same cards will emit once
                // this pack reaches the head of the queue. Dedup is tested against
                // `rest` (not inside the setQueue updater, which runs later and may be
                // re-invoked by StrictMode) — it is the same list the updater compares.
                if (!rest.some((p) => p.packKey === next.packKey)) {
                    for (const card of next.cards) {
                        logSortCard("card queued", card, next, {
                            requestedLevel: requestLevel,
                            servedLevel: data.level,
                            replacedPackKey: completedKey,
                        });
                    }
                }
            }
        } catch (error) {
            console.error("Error fetching next pack:", error);
            // The completed pack was already dropped above, so a swallowed failure here
            // permanently strands the queue at one slot short. One retry covers
            // transient network blips instead of leaving the user with an empty queue.
            if (attempt < 1) setTimeout(() => advancePack(completedKey, { attempt: attempt + 1 }), 800);
        }
    }, [queue, language, selectedLevel, setMode]);

    // SET MODE EXIT.
    //
    // A fixed set is DONE the moment its queue empties — there is nothing to replenish
    // and nothing left to decide, so the page must not strand the user on an empty sort
    // board (which renders as a permanent spinner: the empty-queue branch below only
    // shows a message when `exhausted`, and a fixed set never is).
    //
    // How it ends depends on whether the learner actually did anything:
    //  • they sorted/skipped at least one card → stop on ProvisionalSortDonePopup and let
    //    them choose the exit (back to the game/flp that offered the set, or Home). An
    //    instant route change here read as "the last card just vanished".
    //  • the set came back already empty (every card sorted in another tab) → there is
    //    nothing to confirm, so leave silently the way this page always did.
    //
    // Driven off state rather than fired inline from the sorting handler so that EVERY
    // way of emptying the queue is covered: the last card sorted, the last card skipped,
    // a failed sort POST, or an empty set. `exitedRef` makes it settle exactly once — the
    // effect can re-run before the route change commits, and a second navigate(-1) would
    // pop an extra history entry.
    const [setModeDone, setSetModeDone] = useState(false);
    // Where the offer was accepted from, recorded by ProvisionalSortOffer as `?from=`.
    const originPath = searchParams.get("from");
    // Total cards resolved in this pass (sorted or skipped) — also the popup's summary.
    const resolvedCount = useMemo(
        () => Object.values(done).reduce((total, ids) => total + ids.size, 0),
        [done]
    );
    // Leave for the page that opened the offer. `history.state.idx === 0` means this page
    // IS the first entry — deep-linked or reloaded — where navigate(-1) would leave the
    // app entirely, so fall back to the recorded origin, then to Home.
    const exitToOrigin = useCallback(() => {
        const idx = (window.history.state as { idx?: number } | null)?.idx;
        if (idx == null || idx > 0) navigate(-1);
        else navigate(originPath ?? "/");
    }, [navigate, originPath]);
    const exitedRef = useRef(false);
    useEffect(() => {
        if (!setMode || loading || queue.length > 0 || exitedRef.current) return;
        exitedRef.current = true;
        if (resolvedCount > 0) setSetModeDone(true);
        else exitToOrigin();
    }, [setMode, loading, queue.length, resolvedCount, exitToOrigin]);

    // doneRef helpers — the authoritative resolved-card store. Mutations mirror into
    // `done` state to re-render. Reading from the ref (not the `done` closure) is what
    // makes rapid successive sorts race-free.
    const markResolved = useCallback((packKey: string, cardIds: number[]) => {
        const set = new Set(doneRef.current[packKey] ?? []);
        cardIds.forEach((id) => set.add(id));
        doneRef.current = { ...doneRef.current, [packKey]: set };
        setDone(doneRef.current);
    }, []);
    const unmarkResolved = useCallback((packKey: string, cardId: number) => {
        const set = new Set(doneRef.current[packKey] ?? []);
        set.delete(cardId);
        doneRef.current = { ...doneRef.current, [packKey]: set };
        setDone(doneRef.current);
    }, []);
    const isResolved = useCallback((packKey: string, cardId: number) => doneRef.current[packKey]?.has(cardId) === true, []);
    // A pack is complete when every card is either pre-sorted (locked) or resolved now.
    const isPackComplete = useCallback(
        (pack: SortPack) => pack.cards.every((c) => c.sorted || isResolved(pack.packKey, c.id)),
        [isResolved]
    );

    const pushUndo = useCallback((entry: UndoEntry) => {
        setUndoStack((prev) => [...prev, entry].slice(-UNDO_DEPTH));
    }, []);

    // Sort one card into a bucket (per-card POST). Optimistic: resolve locally first,
    // then decide (from the ref) whether that completed the pack.
    // A completing pack contributes exactly ONE adaptive-leveling signal, derived from
    // every bucket sorted into it this session (docs §6). The rule is deliberately naive
    // — no streaks, no thresholds: ANY "Add to Learning" card means the level was too
    // hard (target − 1), and a pack sorted entirely as "Already Learned" means it was too
    // easy (target + 1). Anchored on the completing pack's OWN level (not the running
    // auto target), since the target may already have drifted from an earlier in-flight
    // signal — this is exactly why the update is "set to packLevel±1", never "increment
    // the target".
    const applyPackSignal = useCallback((pack: SortPack) => {
        const outcomes = Object.values(packBucketsRef.current[pack.packKey] ?? {});
        if (outcomes.includes("library")) {
            autoLevelRef.current = Math.max(MIN_DIFFICULTY_LEVEL, pack.level - 1);
        } else if (outcomes.includes("already-learned")) {
            autoLevelRef.current = Math.min(MAX_DIFFICULTY_LEVEL, pack.level + 1);
        }
        // A pack with no library/already-learned outcomes (fully skipped) carries no
        // signal at all — nothing to do (§5.1).
    }, []);

    const handleSortCard = useCallback(async (cardId: number, bucketId: string) => {
        const pack = currentPack;
        if (!pack) return;
        pushUndo({ action: "sort", cardId, bucket: bucketId, pack });
        markResolved(pack.packKey, [cardId]);
        adjustTally(bucketId, 1);
        packBucketsRef.current = {
            ...packBucketsRef.current,
            [pack.packKey]: { ...(packBucketsRef.current[pack.packKey] ?? {}), [cardId]: bucketId },
        };
        const lastInPack = isPackComplete(pack);

        // Update the auto target (if active) as soon as the pack completes, BEFORE the
        // network round-trip — advancePack must see the new target immediately so the
        // very next replenish request already reflects it (only the pack already queued
        // behind this one lags by one card, per docs §6).
        if (lastInPack && selectedLevel == null) applyPackSignal(pack);

        const sorted = sortCard({
            cardId,
            bucket: bucketId,
            language: language as Language,
            packId: pack.packId,
            lastInPack,
        });
        // The completing drop starts the pack exit NOW, in parallel with its fall; only
        // the replenish request inside advancePack waits for this POST (see there).
        if (lastInPack) advancePack(pack.packKey, { afterSorted: sorted });
        try {
            await sorted;
        } catch (error) {
            console.error("Error sorting card:", error);
        }
    }, [currentPack, pushUndo, markResolved, adjustTally, isPackComplete, selectedLevel, applyPackSignal, advancePack, language]);

    // Skip the whole on-deck pack: defer every remaining unsorted card at once.
    const handleSkipPack = useCallback(async () => {
        const pack = currentPack;
        if (!pack) return;
        const toSkip = pack.cards.filter((c) => !c.sorted && !isResolved(pack.packKey, c.id));
        if (toSkip.length === 0) return;

        // Enqueue one undo action per skipped card (Undo reverses them one at a time).
        for (const c of toSkip) pushUndo({ action: "skip", cardId: c.id, bucket: "skip", pack });
        markResolved(pack.packKey, toSkip.map((c) => c.id));

        try {
            await skipPack({
                cardIds: toSkip.map((c) => c.id),
                language: language as Language,
                packId: pack.packId,
            });
            // Only now that the server has recorded the skip is it safe to request the
            // replacement pack — same race as handleSortCard's advancePack call.
            advancePack(pack.packKey);
        } catch (error) {
            console.error("Error skipping pack:", error);
        }
    }, [currentPack, isResolved, pushUndo, markResolved, advancePack, language]);

    // Undo the most recent card action (sort or skip). Un-resolves the card and, if its
    // pack has advanced off-deck, brings the pack back on deck.
    const handleUndo = useCallback(async () => {
        const entry = undoStack[undoStack.length - 1];
        if (!entry) return;
        setUndoStack((prev) => prev.slice(0, -1));

        unmarkResolved(entry.pack.packKey, entry.cardId);
        // Two undo shapes. A card re-shown inside the on-deck pack "rises" back into its
        // slot. Undo reaching back into the PREVIOUS pack plays the conveyor backwards
        // (docs §4.1 "Undo across packs"): the on-deck pack un-docks to the right, then the
        // previous pack "returns" from the left. Reduced motion, or no row to measure:
        // just swap (the "rise" path, itself motionless under reduced motion).
        const onDeck = currentPack;
        const row = cardsRowRef.current;
        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
        if (onDeck && onDeck.packKey !== entry.pack.packKey && row && !reducedMotion) {
            const durationMs = undoExitMs(onDeck.cards.length);
            exitIdRef.current += 1;
            setLeavingPack({ pack: onDeck, rowTop: row.offsetTop, exitId: exitIdRef.current, direction: "right", durationMs });
            setUndoRestore({ packKey: entry.pack.packKey, entrance: "return", delayMs: durationMs });
        } else {
            setUndoRestore({ packKey: entry.pack.packKey, entrance: "rise", delayMs: 0 });
            // A pack still sliding out must not also be back on deck.
            setLeavingPack((prev) => (prev?.pack.packKey === entry.pack.packKey ? null : prev));
        }
        // Give the tally back the card this action added (no-op for a skip).
        adjustTally(entry.bucket, -1);
        // Bring the undone pack back to the FRONT so it is on deck again. It may already
        // be the head (undoing a card within the on-deck pack — leave the queue as-is),
        // or it may still be sitting in the buffer (the server can re-serve a just-sorted
        // pack when the pool is small); in the latter case we must MOVE it to the front,
        // not skip it because it happens to exist somewhere in the queue.
        setQueue((prev) => {
            if (prev[0]?.packKey === entry.pack.packKey) return prev;
            const without = prev.filter((p) => p.packKey !== entry.pack.packKey);
            return [entry.pack, ...without];
        });
        setExhausted(false);

        try {
            await undoSort({
                cardId: entry.cardId,
                bucket: entry.bucket,
                language: language as Language,
                packId: entry.pack.packId,
            });
        } catch (error) {
            console.error("Error undoing action:", error);
        }
    }, [undoStack, currentPack, unmarkResolved, adjustTally, language]);

    // Every branch paints the same ground and header ink, so the page never flashes the
    // app's paper between the spinner and the board.
    const groundChrome = { surfaceColor: look.ground, headerTitleColor: look.ink, scrollable: false } as const;

    if (loading) {
        return (
            <NodePage title="Sort Cards" onBack={() => navigate("/")} {...groundChrome}>
                <Box className="sort-cards__loading-wrapper" sx={{ display: "flex", flex: 1, justifyContent: "center", alignItems: "center" }}>
                    <DelayedCircularProgress className="sort-cards__spinner" />
                </Box>
            </NodePage>
        );
    }

    // Set mode finished: the board is empty on purpose, so the page holds still behind
    // the completion popup rather than falling through to the spinner branch below.
    if (setModeDone) {
        return (
            <NodePage title="Sort Cards" onBack={exitToOrigin} {...groundChrome}>
                <ContentArea className="sort-cards__content sort-cards__content--set-complete">
                    <ProvisionalSortDonePopup
                        sortedCount={resolvedCount}
                        originLabel={originLabelFor(originPath)}
                        onBack={exitToOrigin}
                        onHome={() => navigate("/")}
                    />
                </ContentArea>
            </NodePage>
        );
    }

    if (!currentPack) {
        return (
            <NodePage title="Sort Cards" onBack={() => navigate("/")} {...groundChrome}>
                <ContentArea className="sort-cards__content">
                    <Box className="sort-cards__no-cards-error" sx={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
                        {exhausted
                            ? <Typography className="sort-cards__no-cards-error-text" sx={{ color: look.ink }}>Error: no cards found</Typography>
                            : <DelayedCircularProgress className="sort-cards__spinner" />}
                    </Box>
                </ContentArea>
            </NodePage>
        );
    }

    // The bin a held card is over grows (SortBins → ACTIVE_SCALE); it settles back the
    // moment the card is let go, as the card despawns and the bin's place animation plays.
    const activeBinId = highlightedBucket;

    // One slot's contents: the tier tag, the card in its well, and the per-card action
    // row. Shared by the live row and the leaving-pack overlay so the exiting slots are
    // pixel-identical to the ones they replace. In the overlay (`leaving`) nothing is
    // interactive — PackExitClip is pointer-events: none — and no live DraggableCard is
    // ever mounted for an unsorted card (there are none by then: a pack only advances
    // once every card is resolved).
    const renderSlotBody = (card: DiscoverCard, pack: SortPack, leaving: boolean, slotIndex: number) => {
        // Resolved this session (sorted/skipped) and not pre-sorted: the card is gone,
        // its well left empty. Pre-sorted (locked) cards stay in place, greyed.
        const resolvedHere = !card.sorted && done[pack.packKey]?.has(card.id) === true;
        // Per PACK, not per page: a leaving 4-card pack keeps the compact face it was
        // shown at while the 3-card pack replacing it rises in at regular size.
        const cardSize = dockCardSize(pack.cards.length, dockWidth);
        const infoLoading = !leaving && eipLoadingKey === card.entryKey;
        return (
            <>
                {/* Tier tag: this card's tier label over the 5-dot frequency meter
                    (frequencyScore, 1 = almost never spoken … 5 = constant in daily
                    speech). NOT a register scale — that was the pre-migration-122
                    `vernacularScore` meaning; see docs/DEFINITION_MAPPING.md. Lives on the
                    ground, not the card, so it stays put while the card is dragged. */}
                <CardDeckHeader className="sort-cards__card-deck-header" sx={{ mb: `${SLOT_HEADER_GAP_PX}px` }}>
                    {card.frequencyScore != null && (
                        <>
                            <CommonalityTierLabel className="sort-cards__commonality-tier-label" sx={{ color: look.inkSoft }}>
                                {COMMONALITY_TIER_LABELS[card.frequencyScore] ?? ""}
                            </CommonalityTierLabel>
                            <FrequencyScoreDots
                                className="sort-cards__card-frequency-dots"
                                score={card.frequencyScore}
                                dotSize={8}
                                gap={4}
                                filledColor={look.inkSoft}
                                emptyBorderColor={look.inkSoft}
                            />
                        </>
                    )}
                </CardDeckHeader>
                <CardWell className="sort-cards__card-well" cardSize={cardSize}>
                    {!resolvedHere && (
                        <DraggableCard
                            card={card}
                            size={cardSize}
                            locked={leaving || !!card.sorted}
                            sorted={!!card.sorted}
                            groundShadow={look.groundShadow}
                            levitatePhaseMs={leaving ? 0 : LEVITATE_PHASES_MS[slotIndex % LEVITATE_PHASES_MS.length]}
                            // Undo re-showing a card in a slot that never left.
                            settleIn={!leaving && undoRestore?.entrance === "rise" && undoRestoredPackKey === pack.packKey}
                            onCheckCollision={checkBucketCollision}
                            onHighlight={setHighlightedBucket}
                            onDrop={handleSortCard}
                            onFirstDrag={handleCardPickup}
                        />
                    )}
                </CardWell>
                {/* Per-card actions below the card: play audio (docs §4.5) and open the
                    eip (docs §4.7). They stay live under an emptied well, so a word that
                    was just sorted can still be heard / looked up until its pack leaves. */}
                <CardActionRow className="sort-cards__card-actions" sx={{ mt: `${SLOT_ACTIONS_GAP_PX}px` }}>
                    <CardActionButton
                        className="sort-cards__card-audio-button"
                        aria-label={`Play ${card.entryKey}`}
                        onClick={() => handlePlayCardAudio(card)}
                    >
                        {!leaving && tts.speakingKey === card.entryKey ? (
                            // Plain (not Delayed): tap feedback must appear at once.
                            <CircularProgress className="sort-cards__card-audio-spinner" size={20} thickness={4} sx={{ color: look.inkSoft }} />
                        ) : (
                            <Icon name="volume_up" size={28} color={look.inkSoft} />
                        )}
                    </CardActionButton>
                    <CardActionButton
                        className="sort-cards__card-info-button"
                        aria-label={`More info about ${card.entryKey}`}
                        onClick={() => handleOpenCardInfo(card)}
                        disabled={!leaving && eipLoadingKey !== null}
                    >
                        {infoLoading ? (
                            // Sized inside the 36px target so the row never changes height
                            // mid-lookup. Plain (not Delayed): tap feedback.
                            <CircularProgress className="sort-cards__card-info-spinner" size={20} thickness={4} sx={{ color: look.inkSoft }} />
                        ) : (
                            <Icon name="info" size={28} color={look.inkSoft} />
                        )}
                    </CardActionButton>
                </CardActionRow>
            </>
        );
    };

    return (
        <NodePage
            title="Sort Cards"
            onBack={() => navigate("/")}
            {...groundChrome}
            headerExtraActions={
                <>
                    {/* Feature testers only: flip every si (the Difficulty caption here)
                        between its two styles (docs/SOFT_INTRODUCTION.md § 5). */}
                    <SoftIntroToggle />
                    {/* The APP-WIDE narration audio mode, not a page-local pref. One
                        tap cycles off → passthrough → media; the same setting has its
                        explained three-option form on /settings. Drawn in the Deck Tower
                        study header's `outlined` skin, in the ground's ink. */}
                    <AudioModeChip className="sort-cards__audio-chip" outlined ink={look.ink} />
                </>
            }
        >
            <ContentArea className="sort-cards__content">
                {/* The two bins: iso decks on floating platforms, growing one layer per
                    card sorted into them this session (SortBins). */}
                <BinsArea className="sort-cards__bins-area">
                    <SortBins
                        className="sort-cards__bins"
                        bins={bins}
                        counts={sessionCounts}
                        activeBinId={activeBinId}
                        look={look}
                        registerBin={registerBin}
                    />

                    {/* Level pill · undo · skip — top-right over the bins (the artboard's
                        `.tb`). Skip is de-emphasized (§5.1): a small keycap, not a drag
                        bin; it defers every remaining unsorted card of the pack on deck. */}
                    <SortToolbar className="sort-cards__toolbar">
                        <Box className="sort-cards__level-control" sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                            <ButtonBase
                                className="sort-cards__level-dropdown"
                                onClick={(e) => setLevelMenuAnchor(e.currentTarget)}
                                aria-haspopup="menu"
                                aria-expanded={Boolean(levelMenuAnchor)}
                                sx={{ ...keycapSx(look), fontWeight: WEIGHT.bold, borderRadius: 999, height: TOOLBAR_KEY_HEIGHT_PX, pl: "10px", pr: "4px", gap: "1px" }}
                            >
                                {levelLabel}
                                <Icon name="keyboard_arrow_down" size={18} color={look.keyInk} />
                            </ButtonBase>
                            {/* si `sortDifficultyCaption`: names the pill for a learner's
                                first 7 visits over 7 days, then retires. */}
                            {difficultyCaption === "intro" && (
                                <LevelCaption className="sort-cards__level-caption" sx={{ color: look.inkSoft }}>
                                    Difficulty
                                </LevelCaption>
                            )}
                        </Box>
                        <ButtonBase
                            className="sort-cards__undo-button"
                            onClick={handleUndo}
                            disabled={undoStack.length === 0}
                            aria-label="Undo"
                            sx={{ ...keycapSx(look), borderRadius: 999, height: TOOLBAR_KEY_HEIGHT_PX, px: "12px", "&.Mui-disabled": { opacity: 0.45 } }}
                        >
                            <Icon name="undo" size={18} color={look.keyInk} />
                        </ButtonBase>
                        <ButtonBase
                            // Tap = skip the pack; hold = the hidden skipped-cards sheet.
                            {...skipPress.handlers}
                            // Stays sunk for the whole hold, not just while :active holds.
                            className={`sort-cards__skip-button${skipPress.pressing ? " sort-cards__keycap--pressed" : ""}`}
                            sx={{ ...keycapSx(look), borderRadius: `${SKIP_BUTTON_RADIUS_PX}px`, height: TOOLBAR_KEY_HEIGHT_PX, px: "12px", position: "relative" }}
                        >
                            skip
                            {/* Hold timer: traces the button's outline over SKIP_HOLD_MS.
                                Mounted per press so each press starts from zero. */}
                            {skipPress.pressing && (
                                <HoldProgressRing
                                    className="sort-cards__skip-hold-ring"
                                    durationMs={SKIP_HOLD_MS}
                                    radius={SKIP_BUTTON_RADIUS_PX}
                                    strokeWidth={2}
                                />
                            )}
                        </ButtonBase>
                    </SortToolbar>
                    <Menu
                        className="sort-cards__level-menu"
                        anchorEl={levelMenuAnchor}
                        open={Boolean(levelMenuAnchor)}
                        onClose={() => setLevelMenuAnchor(null)}
                    >
                        <MenuItem
                            className="sort-cards__level-menu-item"
                            selected={selectedLevel == null}
                            onClick={() => { setSelectedLevel(null); setLevelMenuAnchor(null); }}
                        >
                            Auto
                        </MenuItem>
                        {DIFFICULTY_LEVELS.map((lvl) => (
                            <MenuItem
                                className="sort-cards__level-menu-item"
                                key={lvl}
                                selected={selectedLevel === lvl}
                                onClick={() => { setSelectedLevel(lvl); setLevelMenuAnchor(null); }}
                            >
                                {difficultyLabel(lvl)}
                            </MenuItem>
                        ))}
                    </Menu>
                </BinsArea>

                {/* On-deck: up to 4 levitating cards (compact faces when 4 won't fit). A
                    card the user resolved this session leaves an empty well in its slot so
                    the other cards don't reposition. */}
                <OnDeckSection ref={onDeckSectionRef} className="sort-cards__on-deck">
                    <CardsRow
                        ref={cardsRowRef}
                        className="sort-cards__cards-row"
                        compact={dockCardSize(currentPack.cards.length, dockWidth) === "compact"}
                    >
                        {currentPack.cards.map((card, slotIndex) => (
                            // Keyed on pack + card, and the SAME element whether the card
                            // is live or has left its well — sorting a card must not
                            // remount the slot (that would replay its entrance).
                            <EnteringCardSlot
                                key={`${currentPack.packKey}:${card.id}`}
                                entrance={undoRestore && undoRestoredPackKey === currentPack.packKey ? undoRestore.entrance : "dock"}
                                delayMs={undoRestore && undoRestoredPackKey === currentPack.packKey ? undoRestore.delayMs : dockDelays[card.id] ?? 0}
                            >
                                {renderSlotBody(card, currentPack, false, slotIndex)}
                            </EnteringCardSlot>
                        ))}
                    </CardsRow>
                    {/* Pack exit (docs §4.1): the previous pack's slots — empty wells,
                        locked cards, tier tags, action rows — slide off to the left (or, for
                        Undo's un-dock, back out to the right) and are clipped at the
                        section's edge; the next pack slides in after. */}
                    {leavingPack && (
                        <PackExitClip className="sort-cards__pack-exit-clip" aria-hidden>
                            <CardsRow
                                key={leavingPack.exitId}
                                className="sort-cards__cards-row sort-cards__cards-row--leaving"
                                compact={dockCardSize(leavingPack.pack.cards.length, dockWidth) === "compact"}
                                sx={{
                                    position: "absolute",
                                    left: 0,
                                    top: `${leavingPack.rowTop}px`,
                                    // Ease-in: the old cards accelerate away; the new ones
                                    // then (ease-out, EnteringCardSlot) decelerate into place.
                                    // The "right" un-dock's wells animate per slot (below).
                                    ...(leavingPack.direction === "left" && {
                                        "& .sort-cards__card-well": {
                                            animation: `${packExitKeyframes} ${PACK_EXIT_MS}ms cubic-bezier(0.55, 0, 0.8, 0.25) forwards`,
                                        },
                                    }),
                                    [SLOT_LABELS]: {
                                        animation: `${labelFadeOutKeyframes} ${LABEL_FADE_MS}ms ease-out forwards`,
                                    },
                                }}
                            >
                                {leavingPack.pack.cards.map((card, slotIndex) => (
                                    <CardSlot
                                        key={card.id}
                                        className="sort-cards__card-slot sort-cards__card-slot--leaving"
                                        // Un-dock: the dock-in backwards — the dock's ease-out
                                        // curve mirrored into an ease-in, rightmost card first.
                                        sx={leavingPack.direction === "right" ? {
                                            "& .sort-cards__card-well": {
                                                animation: `${packUnDockKeyframes} ${DOCK_SLIDE_MS}ms cubic-bezier(0.64, 0, 0.78, 0) ${(leavingPack.pack.cards.length - 1 - slotIndex) * DOCK_STAGGER_STEP_MS}ms both`,
                                            },
                                        } : undefined}
                                    >
                                        {renderSlotBody(card, leavingPack.pack, true, slotIndex)}
                                    </CardSlot>
                                ))}
                            </CardsRow>
                        </PackExitClip>
                    )}
                </OnDeckSection>

                {/* Hidden skipped-cards sheet (§5.1a) — opened only by holding Skip.
                    Mounted only while open, so each open re-fetches the list. Rendered
                    BEFORE the eip so the eip (opened by tapping a card in it) portals
                    after it and, at depth 1, stacks on top. */}
                {skippedSheetOpen && (
                    <SkippedCardsSheet
                        language={language as Language}
                        onOpenInfo={handleOpenCardInfo}
                        onClose={handleCloseSkippedSheet}
                    />
                )}

                {/* eip bottom sheet. Only mounted while open so the open animation
                    replays on every reopen (same rule as the flp). The scrim inside
                    SheetPanel covers the bins and the on-deck cards, so no card can
                    be dragged while the panel is up — reading about a word and sorting
                    it are deliberately separate modes. */}
                <EipSheet
                    eip={eip}
                    open={eipOpen}
                    depth={skippedSheetOpen ? 1 : 0}
                    onClose={handleCloseEip}
                    // Wrapped: a speaker tap in the panel stops the pack's narration first.
                    onSpeak={handleEipSpeak}
                    onSpeakSentence={handleEipSpeakSentence}
                    speakingKey={tts.speakingKey}
                />
            </ContentArea>
        </NodePage>
    );
};

export default SortCardsPage;
