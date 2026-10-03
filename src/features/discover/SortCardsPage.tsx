import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Box, Typography, IconButton, Button, ButtonBase, CircularProgress, Menu, MenuItem } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { styled, keyframes } from "@mui/material/styles";
import UndoIcon from "@mui/icons-material/Undo";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { useDrag } from "@use-gesture/react";
import { useSpring, animated, easings } from "@react-spring/web";
import NodePage from "../../components/NodePage";
import { FOOTER_CLEARANCE, FOOTER_TOTAL_CLEARANCE } from "../../components/MobileFooter";
import { SAFE_BOTTOM } from "../../theme/safeArea";
import FrequencyScoreDots from "../../components/FrequencyScoreDots";
import SpeakerButton from "../../components/SpeakerButton";
import EipSheet from "../flashcards/FlashcardsLearnPage/EipSheet";
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
import { useCategoryCounts } from "../../hooks/useCategoryCounts";
import { COLORS, RAMP, type RampHue } from "../../theme/colors";
import { LEARN_NOW_HUE, LEARN_NOW_COLORS, MASTERY_BAR_HUES, MASTERY_BAR_COLORS } from "../../utils/categoryColors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING, TRACKING } from "../../theme/scale";
import { SHADOW } from "../../theme/shadows";
import MiniCard from "../../components/MiniCard";
import { MINI_CARD_DIMENSIONS, MINI_CARD_RADIUS, type MiniCardSize } from "../../components/miniCardFace";

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

// Manual HSK/difficulty dropdown levels — mirrors the server's generalized 1..6
// difficulty scale (StarterPacksService._levelConfig, migration 79) for every
// language. `null` is the "auto" entry (the adaptive target the client tracks itself).
const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5, 6];
const MIN_DIFFICULTY_LEVEL = DIFFICULTY_LEVELS[0];
const MAX_DIFFICULTY_LEVEL = DIFFICULTY_LEVELS[DIFFICULTY_LEVELS.length - 1];

// Drag destinations (Skip is intentionally NOT here — §5.1).
interface BucketZone {
    id: "library" | "already-learned";
    label: string;
    mainColor: string;
}

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
    // Containing block for this page's absolutely-positioned layers, mirroring the
    // flp's ContentArea. (The eip sheet no longer needs it — SheetPanel portals to the
    // frame.)
    position: "relative",
    userSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "none",
});

// The two destination buckets, laid out evenly across the top. A definite height lets
// each bucket resolve its `height: 100%` while keeping the card aspect ratio (below).
// The buckets' card-like proportion. The on-deck cards themselves are MiniCards
// (MINI_CARD_DIMENSIONS, 92×132 — or 78×112 compact — a near-identical 0.70 ratio); the buckets
// are deliberately larger drop targets and keep their own size.
const CARD_ASPECT = "136 / 200";

const BUCKET_GAP = "36px"; // healthy fixed breathing room between the two buckets
const BUCKET_EDGE_PADDING = "28px"; // healthy fixed breathing room between each bucket and the screen edge

const BucketsContainer = styled(Box)({
    width: "100%",
    flex: 1, // absorb the page's spare vertical space (and yield it back on short screens)
    minHeight: 0,
    containerType: "size", // establishes cqw/cqh for the buckets' "contain" sizing (below) —
    // reflects THIS element's content box, so the horizontal padding below is already
    // excluded from cqw and the bucket-width formula needs no further adjustment for it.
    paddingTop: 16,
    paddingBottom: 20,
    paddingLeft: BUCKET_EDGE_PADDING,
    paddingRight: BUCKET_EDGE_PADDING,
    display: "flex",
    flexDirection: "row",
    gap: BUCKET_GAP, // enforced minimum between the two buckets; space-evenly grows it further when there's room
    justifyContent: "space-evenly", // even spacing before / between / after the two buckets
    alignItems: "center",
});

const Bucket = styled(Box, {
    shouldForwardProp: (prop) => !["mainColor", "highlight"].includes(prop as string),
})<{ mainColor: string; highlight?: boolean }>(
    ({ mainColor, highlight }) => ({
        // Card-shaped drop targets that keep the 136:200 card aspect ratio in EVERY
        // regime. Width is the smallest of: half the container width (minus half the
        // gap), the full container height mapped back through the ratio (a true
        // "contain" fit), and a hard cap so the buckets never balloon on wide/tall
        // screens. Height then follows from aspect-ratio. Uses the container query
        // units established by BucketsContainer's `containerType: size`.
        // Safe direction for aspect-ratio: the width is definite and the height
        // is derived from it (the reverse is what breaks in iOS Safari).
        aspectRatio: CARD_ASPECT,
        width: "min(calc(50cqw - 18px), calc(100cqh * 136 / 200), 190px)",
        minWidth: 0,
        // Label breathing room. border-box so it sits INSIDE the computed width rather
        // than growing the bucket past its card-ratio fit.
        padding: 16,
        boxSizing: "border-box",
        // One solid fill of the collection's ramp SURFACE tier — no band, no tint inner
        // panel (the old 14px SURFACE band around a TINT panel was dropped 2026-09-28).
        backgroundColor: mainColor,
        borderRadius: 12,
        // Pressed INTO the page, not raised off it: the CardCrater's inward top shadow
        // scaled up for a bucket that is ~2× a MiniCard, so a bucket reads as a well a
        // card drops into (docs/SORT_CARDS_REQUIREMENTS.md §4.5). The recess
        // is drawn only along the top edge, so the other three sides get their edge from
        // the app's standard hairline — the same `1px solid COLORS.border` edge
        // CARD_SURFACE puts on every card (src/theme/surfaces.ts). Replaced the dashed
        // grey drop-zone outline 2026-09-28.
        boxShadow: SHADOW.recessedDeep,
        border: `1px solid ${COLORS.border}`,
        // Resting opacity was 0.23, which washed both buckets out to near-invisible;
        // 0.6 keeps the "inactive until you drag over it" read while letting the
        // collection hue actually register. The active drop target goes fully opaque.
        // The bucket does NOT change size on hover (it used to scale to 1.05): the
        // "you're over a drop target" cue now lives on the HELD card — see
        // DraggableCard's over-bucket wash, modelled on Bubble Match.
        opacity: highlight ? 1 : 0.6,
        transition: "opacity 0.2s ease-in-out",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        "& .bucket-text": {
            // bodyLg (16px, was caption 12px): the label is the drop target's only
            // text and is read mid-drag, at a glance.
            fontSize: SIZE.bodyLg,
            fontWeight: WEIGHT.regular,
            lineHeight: LEADING.tight,
            textAlign: "center",
            color: COLORS.onSurface,
            fontFamily: FONTS.sans,
            letterSpacing: TRACKING.caps,
        },
    })
);

// The up-to-3 draggable cards, presented on a raised "platform". Shrinks to fit its
// contents (does NOT flex-fill the remaining space); it sits at the bottom because
// BucketsContainer above it flex-fills. Extra bottom padding lifts the card row clear
// of the floating footer pill. The platform look (rounded top, top-edge highlight, and
// a soft drop shadow beneath) reads as a surface the cards physically rest on — the
// per-card frequency meter + speaker button live in a header band along its top.
const OnDeckSection = styled(Box)({
    width: "100%",
    // Containing block for PackExitClip (the leaving-pack overlay). No z-index, so
    // this does not become a stacking context for the dragged card.
    position: "relative",
    flex: "0 0 auto",
    // 4px (was 12px) — the OnDeckToolbar row below now supplies most of the top inset.
    paddingTop: "4px",
    // Extend the white platform down through the footer-clearance zone the
    // MobileTabScreen ScrollArea reserves (paddingBottom: FOOTER_CLEARANCE),
    // so the floating footer hovers over the on-deck white rather than a seam of
    // page background. The negative margin cancels the padding in layout, keeping
    // the platform's vertical footprint unchanged — it only paints the spacer.
    paddingBottom: FOOTER_TOTAL_CLEARANCE,
    marginBottom: `calc(-${FOOTER_CLEARANCE}px - ${SAFE_BOTTOM})`,
    // Rounded top corners on a plain white slab.
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    background: COLORS.white,
    // A hairline highlight along the very top edge + a broad shadow cast downward sell
    // the "platform floating above the page" depth cue.
    boxShadow: [
        "inset 0 2px 0 rgba(255, 255, 255, 0.7)",
        SHADOW.peekUp,
    ].join(", "),
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
});

// A slim right-aligned row along the platform's top edge holding the Skip action
// (docs/SORT_CARDS_REQUIREMENTS.md §5.1). In the flow rather than absolutely positioned:
// the per-card header bands (CardDeckHeader) fill the platform's top strip, so an overlay
// in the corner would sit on the right-hand card's two-line tier label.
const OnDeckToolbar = styled(Box)({
    width: "100%",
    display: "flex",
    justifyContent: "flex-end",
    paddingInline: 8,
});

// Holds the up-to-4 cards side by side; wraps only if even the compact face can't fit.
// `compact` (a pack laid out on compact MiniCards — see `dockCardSize`) also tightens the
// gap between slots, since a 4-card row is what needs the room.
const CARDS_ROW_GAP: Record<MiniCardSize, number> = { regular: 10, compact: 6 };
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
 * The face size a pack of `cardCount` cards is laid out on, given the platform's width
 * (docs/SORT_CARDS_REQUIREMENTS.md §4.5 "Compact dock"). Fit-to-width, not a per-count
 * rule: the pack stays on regular 92px cards whenever the whole row fits across at that
 * size, and drops to the compact 78px face only when it doesn't — in practice a 4-card
 * pack on a phone narrower than ~430px. A 1–3-card pack always fits, so never shrinks.
 * An unmeasured platform (`dockWidth` null — the first commit only) reads as regular.
 */
function dockCardSize(cardCount: number, dockWidth: number | null): MiniCardSize {
    if (dockWidth == null || cardCount <= 1) return "regular";
    const regularRowWidth = cardCount * MINI_CARD_DIMENSIONS.regular.width + (cardCount - 1) * CARDS_ROW_GAP.regular;
    return regularRowWidth <= dockWidth - 2 * CARDS_ROW_INLINE_PADDING ? "regular" : "compact";
}

// One on-deck slot: a vertical column holding the card's "commonality" header band
// stacked above the draggable card, with the play-audio button below it. The slot — not
// the card — owns the width budget; its width is the card's fixed face (regular or
// compact, CardWell) or the header band, whichever is wider. The 31% cap only ever
// bites the header band on a very narrow frame — a card face never shrinks below its
// footprint (four compact slots are chosen by `dockCardSize` precisely so they fit).
const CardSlot = styled(Box)({
    flex: "0 0 auto",
    maxWidth: "31%",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
});

// How a CardSlot arrives on the platform (docs/SORT_CARDS_REQUIREMENTS.md §4.1
// "Pack entrance"):
//   - "dock": a pack landing on deck (first load, level switch, or the next pack
//     replacing a finished/skipped one) — the whole slot rises from the bottom edge
//     of the screen, the pack's slots staggered in a random order.
//   - "rise": a slot re-appearing because of Undo (a card re-shown inside the
//     on-deck pack, or a pack brought back from off-deck) — the small 24px
//     rise + fade, so Undo reads as "put back", not as new content arriving.
type SlotEntrance = "dock" | "rise";

// Per-slot stagger step for the "dock" entrance. The pack's slots get the delays
// 0, STEP, 2·STEP, … (one per card) in a shuffled order (see `dockDelays` in SortCardsPage).
const DOCK_STAGGER_STEP_MS = 60;

// Silence between consecutive words in the pack autoplay (docs/AUDIO_PLAYBACK.md
// "A manual press ends an autoplay sequence").
const AUTOPLAY_GAP_MS = 600;

// The travel distance is a CSS variable set per slot at mount (see EnteringCardSlot);
// the 100vh fallback only matters if the measurement never lands.
const dockInKeyframes = keyframes`
    from { transform: translateY(var(--sort-cards-dock-travel, 100vh)); }
    to   { transform: translateY(0); }
`;
const riseInKeyframes = keyframes`
    from { transform: translateY(24px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
`;

/**
 * A CardSlot (header band + card + action row) that plays its entrance once, on mount.
 * The whole slot moves so the header band and buttons travel with the card —
 * DraggableCard's own spring is left purely for dragging.
 *
 * Deliberately a CSS animation, NOT a react-spring spring: useSpring's function form
 * keeps its initial values queued and replays them on later starts/re-renders, and this
 * page re-renders constantly (TTS speakingKey, drag highlight) — an off-screen initial
 * `y` kept getting re-applied and the cards never showed. CSS has no such lifecycle.
 *
 * `animation-fill-mode: backwards` applies the start frame during the stagger delay and
 * then drops the transform entirely at rest. That matters: any transform, even
 * translateY(0), makes the slot a stacking context, which would trap DraggableCard's
 * zIndex: 1000 inside it — a card dragged across a later sibling slot (or up to the
 * buckets) would then paint UNDER it.
 */
function EnteringCardSlot({ entrance, delayMs, children }: {
    entrance: SlotEntrance;
    delayMs: number;
    children: React.ReactNode;
}) {
    const slotRef = useRef<HTMLDivElement>(null);

    // Layout effect so the measured distance is in place before the first paint.
    // Measured off the CardsRow parent (never animated), so the slot's own start-frame
    // transform can't skew it. Travel = row top → bottom of the viewport, i.e. the slot
    // starts just below the screen edge.
    useLayoutEffect(() => {
        if (entrance !== "dock") return;
        const slot = slotRef.current;
        const rowTop = slot?.parentElement?.getBoundingClientRect().top;
        if (!slot || rowTop == null) return;
        slot.style.setProperty("--sort-cards-dock-travel", `${Math.max(0, window.innerHeight - rowTop)}px`);
    // Entrance is read once at mount by design — a later prop change must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const animation = entrance === "dock"
        ? `${dockInKeyframes} 520ms cubic-bezier(0.22, 1, 0.36, 1) ${delayMs}ms backwards`
        : `${riseInKeyframes} 320ms ease-out backwards`;

    return (
        <CardSlot
            ref={slotRef}
            className="sort-cards__card-slot"
            sx={{
                animation,
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            }}
        >
            {children}
        </CardSlot>
    );
}

// Footer band below each card: the per-card actions (play audio, open the eip). Both
// buttons are MUI `size="small"` IconButtons (32px hit target). The row stays rendered
// under a sorted card's crater, so a sorted-away slot keeps its full height.
const CardActionRow = styled(Box)({
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
});

// Header band above each card: the card's own commonality tier label (e.g. "Used
// sometimes") over the 5-dot frequency meter (frequencyScore) with an "x/5" readout
// beside it. Fixed minHeight so cards with no score keep their card faces aligned with
// neighbors that do. Sits on the platform surface, not on the draggable card, so it
// stays put while the card is dragged away.
const CardDeckHeader = styled(Box)({
    minHeight: 40,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 3,
});

// User-facing name for each 1–5 frequencyScore tier, shown above that card's meter.
// Display copy only, deliberately separate from the backfill's FREQUENCY_SCORE_LABELS
// (server/scripts/backfill/shared/lib/frequencyLabels.js): those feed the Spanish
// scoring prompt and are too long for a ~100px card slot. Sort page only for now —
// the eip/cdp meters still read "Commonality". See docs/SORT_CARDS_REQUIREMENTS.md.
// Every multi-word label carries an explicit "\n" so it always stacks on two lines
// (rendered via `white-space: pre-line`); single-word labels stay on one line.
const COMMONALITY_TIER_LABELS: Record<number, string> = {
    5: "Used all\nthe time",
    4: "Common",
    3: "Used\nsometimes",
    2: "Uncommon",
    1: "Rarely\nused",
};

// Two micro-size lines: the tallest a tier label can wrap to inside a ~31%-wide slot.
const TIER_LABEL_LINE_HEIGHT = 1.15;
const TIER_LABEL_BOX_HEIGHT = `calc(2 * ${TIER_LABEL_LINE_HEIGHT} * ${SIZE.micro})`;

// One card's tier label. Sentence case (not the app's uppercase overline) because
// "USED ALL THE TIME" in tracked caps is ~145px — wider than the slot. Multi-word
// labels break on their embedded "\n" (`pre-line`), so the box ALWAYS reserves two
// lines and bottom-aligns its text: a one-line label and a two-line label then leave
// every card's meter row on the same baseline, and every card face at the same height.
const CommonalityTierLabel = styled(Typography)({
    height: TIER_LABEL_BOX_HEIGHT,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    textAlign: "center",
    fontSize: SIZE.micro,
    fontWeight: WEIGHT.semibold,
    color: COLORS.textSecondary,
    lineHeight: TIER_LABEL_LINE_HEIGHT,
    whiteSpace: "pre-line",
});

// One card's score display: the 5-dot frequency meter + "x/5" readout on a row.
// Each card wraps its own so every card in the pack aligns on a shared baseline (bottom of the
// header band, under each card's fixed-height tier label).
const CommonalityMeterRow = styled(Box)({
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
});

// The "x/5" numeric readout beside the dots.
const CommonalityScoreValue = styled(Typography)({
    fontSize: SIZE.micro,
    fontWeight: WEIGHT.bold,
    color: COLORS.onSurface,
    lineHeight: 1,
});

// One end of the running library tally: how many cards the account holds in each of the
// two destinations the user is dragging into. The two figures sit at OPPOSITE ends of
// the level bar (Learn Now left, Mastered right) with the difficulty dropdown between
// them, rather than as one cluster, so each reads as its own standing total instead of
// the pair reading as a ratio.
// Deliberately NOT in the NodePage header — that row is already full (audio chip /
// undo / fire badge), so the level bar is the nearest free row.
// Placed by grid column (see the level bar's three equal `1fr` tracks): left tally in
// column 1, right tally in column 3. Explicit placement keeps the dropdown in column 2
// even before the counts load (the tallies are not rendered until then).
const SortTallyColumn = styled(Box, {
    shouldForwardProp: (prop) => prop !== "side",
})<{ side: "left" | "right" }>(({ side }) => ({
    gridColumn: side === "left" ? 1 : 3,
    gridRow: 1,
    display: "flex",
    flexDirection: "column",
    // Pill centred over its caption, matching the difficulty dropdown in column 2 so
    // all three level-bar elements share one pill → caption layout.
    alignItems: "center",
    // 4px between pill and caption; the old 1px let the pill's border touch the
    // caps-height of the label.
    gap: 4,
    pointerEvents: "none", // purely informational — never intercepts a drag
}));

// The number, painted as a small pill in the SAME hue as its fdp filter tile
// (features/flashcards/LibraryDuo.tsx): Learn Now = LEARN_NOW_HUE's surface, Mastered =
// the core bar's MASTERY_BAR_HUES surface. Like the tile, the fill carries the colour and
// the figure stays ink on a hairline border — the ramp surfaces are pastel, so tinting
// the TEXT itself would be unreadable on paper. Taking the hue KEY (not a hex) means a
// future re-hue of either fdp tile carries over here with no edit.
// The pill SHAPE shared by the two tally figures and the difficulty dropdown, so the
// three level-bar controls read as one family: ink figure on a hairline border, fully
// rounded. Only the fill differs — a tally takes its bucket's ramp surface, the
// dropdown stays white (it is a control, not one of the two destinations).
const LEVEL_BAR_PILL_SHAPE = {
    fontSize: SIZE.body,
    fontWeight: WEIGHT.bold,
    lineHeight: 1,
    color: COLORS.onSurface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 999,
    padding: "3px 9px",
    boxSizing: "border-box",
} as const;

// The tally pill's "gulp" when a dropped card lands in its bucket: it swells wide and
// squat as if swallowing the card, then wobbles back to size (a damped squash-and-
// stretch). Played by remounting the pill (a `key` bump) — see SortTallyValue's `gulp`.
const TALLY_GULP_MS = 480;
const tallyGulpKeyframes = keyframes`
    0%   { transform: scale(1, 1); }
    30%  { transform: scale(1.32, 1.14); }
    55%  { transform: scale(0.94, 1.04); }
    75%  { transform: scale(1.05, 0.98); }
    100% { transform: scale(1, 1); }
`;

const SortTallyValue = styled(Typography, {
    shouldForwardProp: (prop) => prop !== "hue" && prop !== "gulp",
})<{ hue: RampHue; gulp?: boolean }>(({ hue, gulp }) => ({
    ...(gulp && {
        animation: `${tallyGulpKeyframes} ${TALLY_GULP_MS}ms ease-out`,
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
    }),
    ...LEVEL_BAR_PILL_SHAPE,
    backgroundColor: RAMP[hue].surface,
    // A floor so a one-digit count is a short pill rather than a lopsided circle,
    // and the figure centred within it as the count grows.
    minWidth: 30,
    textAlign: "center",
    // Tabular figures so a count ticking 99 → 100 does not re-space the digits.
    fontVariantNumeric: "tabular-nums",
}));

// The difficulty dropdown trigger ("Auto" / "HSK 3" + a down arrow), drawn in the
// tally pills' shape. A real <button> (ButtonBase) rather than a Chip so it keeps
// keyboard focus + ripple without MUI Chip's own height/padding fighting the pill.
const SortLevelDropdown = styled(ButtonBase)({
    ...LEVEL_BAR_PILL_SHAPE,
    backgroundColor: COLORS.white,
    // Pull the right padding in: the arrow glyph carries its own side bearing, so the
    // symmetric 9px would leave the pill visibly heavier on the arrow side.
    paddingRight: 4,
    gap: 1,
    fontFamily: "inherit",
});

const SortTallyLabel = styled(Typography)({
    fontSize: SIZE.micro,
    fontWeight: WEIGHT.semibold,
    letterSpacing: TRACKING.caps,
    textTransform: "uppercase",
    color: COLORS.textSecondary,
    lineHeight: 1,
    whiteSpace: "nowrap",
});

// The on-deck card IS the app's mini preview card (src/components/MiniCard.tsx) — the
// same 92×132 tile, contents and hairline ring as MiniVocabCard / QuickMarkCard /
// ChallengeWordCard — wrapped in `animated()` so the drag spring can drive its
// transform. It carries no mastery strip (MiniCard omits it unless given a bar): these
// are words being triaged, not the learner's cards. It used to be its own 102×150
// flex-column card and had drifted from the others in size, radius, icon and outline.
const AnimatedMiniCard = animated(MiniCard);

// The card's resting place inside a slot: a fixed box the size of the card's face
// (92×132 regular / 78×112 compact — MINI_CARD_DIMENSIONS) the DraggableCard sits in,
// with a CardCrater painted underneath it. The crater is only seen when the card is
// not there — while it is being dragged (the card moves by transform, so the well it
// left is revealed) and once it has been sorted/skipped this session (the card is no
// longer rendered). Keeping the slot's header band + action row around a crater, rather
// than swapping the whole slot for an invisible placeholder, keeps neighbours from
// re-centering AND gives the exit animation something to carry off
// (docs/SORT_CARDS_REQUIREMENTS.md §4.1 "Pack exit", §4.5).
// Deliberately no z-index / transform: a stacking context here would trap
// DraggableCard's zIndex: 1000 and let a dragged card slide under its neighbours.
const CardWell = styled(Box, {
    shouldForwardProp: (prop) => prop !== "cardSize",
})<{ cardSize: MiniCardSize }>(({ cardSize }) => ({
    position: "relative",
    width: MINI_CARD_DIMENSIONS[cardSize].width,
    height: MINI_CARD_DIMENSIONS[cardSize].height,
}));

// The recessed "crater" — the old already-sorted card look (grey fill + inward top
// shadow), now meaning "a card was here".
const CardCrater = styled(Box)({
    position: "absolute",
    inset: 0,
    borderRadius: MINI_CARD_RADIUS,
    background: COLORS.header,
    boxShadow: SHADOW.recessed,
});

// Clips the leaving pack at the platform's top edge (docs §4.1 "Pack exit"): the old
// slots slide up and vanish as they cross it. Covers the whole OnDeckSection and clips
// ONLY the leaving overlay — the platform itself stays overflow-visible so a dragged
// card can still travel up to the buckets.
const PackExitClip = styled(Box)({
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    pointerEvents: "none",
});

// Travel = the row's top offset inside the platform + the row's own height, so the
// row's bottom edge ends exactly at the clip's top edge. Set per exit as a CSS var.
const packExitKeyframes = keyframes`
    from { transform: translateY(0); }
    to   { transform: translateY(calc(-1 * var(--sort-cards-exit-travel, 400px))); }
`;
const PACK_EXIT_MS = 420;

// Diagonal "sorted!" watermark over a card already in the user's library.
const SortedWatermark = styled(Box)({
    position: "absolute",
    inset: 0,
    // Above MiniCard's text layers (zIndex 1), level with its corner overlays.
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    "& span": {
        transform: "rotate(-20deg)",
        fontSize: SIZE.caption,
        fontWeight: WEIGHT.bold,
        letterSpacing: TRACKING.caps,
        textTransform: "uppercase",
        color: COLORS.dangerInk,
        border: `2px solid ${COLORS.dangerInk}`,
        borderRadius: 6,
        padding: "2px 8px",
        opacity: 0.85,
    },
});

// The picked-up card's lift — the same value as Bubble Match's SCALE_HELD
// (src/games/bubbles/constants.ts), and like it applied ONCE at pickup and held for the
// whole drag: being over a bucket does not change the card's size, only its wash (below).
// Kept local rather than imported: features/ must not reach into games/.
const HELD_CARD_SCALE = 1.12;

// The "over a drop target" cue on the held card: a `COLORS.scrim` wash over the whole
// face — the same overlay Bubble Match draws on a held/hovered bubble (Bubble →
// `.bubble__dim`). A pure overlay, so the card's own colours still read underneath.
// An animated.div whose opacity is driven by the card's spring (`wash` 0→1), NOT by
// React state: DraggableCard must never re-render mid-drag (see its memo note).
// The drop "fall": a released card glides to the bucket's centre while shrinking and
// fading, as if it dropped into the recessed well. Position eases OUT (it homes in on
// the centre quickly), scale and opacity ease IN (they accelerate, like something
// falling away from you), so the card is already centred when it visibly vanishes.
const DROP_FALL_MS = 340;
const DROP_FALL_END_SCALE = 0.15;
const dropFallConfig = (key: string) =>
    key === "x" || key === "y"
        ? { duration: DROP_FALL_MS, easing: easings.easeOutCubic }
        : { duration: DROP_FALL_MS, easing: easings.easeInCubic };

const OverBucketWash = styled(animated.div)({
    position: "absolute",
    inset: 0,
    // Above MiniCard's text layers (1) and corner overlays / watermark (2).
    zIndex: 3,
    borderRadius: MINI_CARD_RADIUS,
    backgroundColor: COLORS.scrim,
    pointerEvents: "none",
});

/**
 * One draggable (or locked) card within the on-deck pack. Owns its own drag spring so
 * the pack's cards move independently. On drop into a bucket it hands off to `onDrop`
 * (the page sorts it and draws the fall — FallingCardGhost); locked cards (already in the library) show a "sorted!" watermark and don't
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
const DraggableCard = memo(function DraggableCard({ card, size, locked, settleIn = false, onCheckCollision, onHighlight, onDrop, onFirstDrag }: {
    card: DiscoverCard;
    /** The pack's face size (see dockCardSize). Held/fall lift is relative to it. */
    size: MiniCardSize;
    locked: boolean;
    /** Read at mount only: pop the card back into its crater (Undo re-showing it). */
    settleIn?: boolean;
    onCheckCollision: (clientX: number, clientY: number) => string | null;
    onHighlight: (bucketId: string | null) => void;
    /**
     * Dropped on a bucket. `cardRect` is where the card was let go — the fall's start —
     * and `size` its face size, so the fall ghost is drawn at the same footprint.
     */
    onDrop: (card: DiscoverCard, bucketId: string, cardRect: DOMRect | undefined, size: MiniCardSize) => void;
    onFirstDrag: () => void;
}) {
    // Pack arrivals are animated by the enclosing EnteringCardSlot (the whole slot
    // slides in), so this spring normally only moves for drag / drop. The one entrance
    // it owns is `settleIn`: Undo re-showing a card inside a slot that never left, where
    // the card pops back into the crater it left behind.
    const cardRef = useRef<HTMLDivElement>(null);
    const [{ x, y, scale, opacity, wash }, api] = useSpring(() => ({ x: 0, y: 0, scale: 1, opacity: 1, wash: 0 }));
    useEffect(() => {
        if (!settleIn) return;
        api.set({ x: 0, y: 0, scale: 0.9, opacity: 0 });
        api.start({ scale: 1, opacity: 1, config: { tension: 280, friction: 26 } });
    // Mount-only by design: a later settleIn change must not replay the pop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api]);

    const bind = useDrag(
        ({ first, down, movement: [mx, my], xy: [px, py] }) => {
            if (locked) return;
            if (first) onFirstDrag();
            if (down) {
                // Held: track the finger/cursor 1:1 (immediate) at the one pickup lift, and
                // ease the scrim wash in or out as the card crosses a bucket — the wash is
                // the only "over a drop target" cue (Bubble Match's hover wash, moved onto
                // the held object). Re-issuing the same target every move is a no-op for a
                // spring already there.
                const overBucket = onCheckCollision(px, py);
                api.start({ x: mx, y: my, scale: HELD_CARD_SCALE, immediate: true });
                api.start({ wash: overBucket ? 1 : 0, config: { tension: 400, friction: 30 } });
                onHighlight(overBucket);
                return;
            }
            // Released.
            const bucketId = onCheckCollision(px, py);
            if (bucketId) {
                // Successful drop: hand off to the page. It resolves the card at once
                // (this card unmounts, leaving its crater, and a completed pack can start
                // sliding out THIS frame) and draws the fall into the bucket on a
                // FallingCardGhost in a page-level layer, which outlives both this card
                // and the slot it sat in. Measured here, while the card is still on screen.
                // Deliberately never springs x/y back to the tray origin — that made the
                // card visibly fly home as it committed (the old "snap-back" bug).
                onHighlight(null);
                onDrop(card, bucketId, cardRef.current?.getBoundingClientRect(), size);
            } else {
                // Missed the buckets: spring back to the resting tray slot, clean.
                onHighlight(null);
                api.start({ x: 0, y: 0, scale: 1, wash: 0 });
            }
        },
        { filterTaps: true }
    );

    return (
        <AnimatedMiniCard
            className="sort-cards__flash-card"
            ref={cardRef}
            {...(locked ? {} : bind())}
            style={{ x, y, scale, opacity, zIndex: 1000 }}
            size={size}
            language={card.language}
            entryKey={card.entryKey}
            pronunciation={card.pronunciation}
            definition={stripParentheses(card.definition ?? "")}
            iconId={card.iconId}
            // Locked (already-sorted) cards are GREY but otherwise the same raised tile —
            // grey fill + grayscale filter + the watermark carry "already sorted"; the
            // ring and shadow stay so the card still sits on the platform like its
            // neighbours rather than looking pressed in.
            background={locked ? COLORS.header : undefined}
            sx={{
                cursor: locked ? "not-allowed" : "grab",
                "&:active": { cursor: locked ? "not-allowed" : "grabbing" },
                touchAction: "none",
                filter: locked ? "grayscale(0.85)" : "none",
            }}
        >
            {locked && (
                <SortedWatermark className="sort-cards__sorted-watermark">
                    <span>sorted!</span>
                </SortedWatermark>
            )}
            {!locked && <OverBucketWash className="sort-cards__over-bucket-wash" style={{ opacity: wash }} />}
        </AnimatedMiniCard>
    );
});

/** One dropped card mid-fall: where it was let go and the bucket it is falling into. */
interface FallingCard {
    fallId: number;
    card: DiscoverCard;
    /** The dropped card's face size, so the ghost matches it exactly. */
    size: MiniCardSize;
    bucketId: string;
    from: { cx: number; cy: number };
    to: { cx: number; cy: number };
}

/**
 * The drop "fall", drawn by a stand-in for the dropped card. The real DraggableCard is
 * resolved (and unmounted) the instant it is released, so the fall cannot live inside
 * its pack slot: when the last card of a pack is dropped, that slot starts sliding out
 * through the platform's clip in the same frame (docs §4.1 "Pack exit"), and the fall
 * has to play IN PARALLEL with it. So the ghost is portalled to <body>, fixed-positioned
 * in viewport coordinates, and owned by the page — nothing about the pack's lifecycle
 * can cut it off.
 *
 * It starts exactly as the held card looked on release (centre, HELD_CARD_SCALE, wash
 * on) and falls to the bucket's centre with dropFallConfig; `onLanded` fires when it
 * arrives, which is when the tally ticks and gulps. Unmounted early (Undo pulling the
 * card back mid-fall), it never reports a landing.
 */
// memo is load-bearing, for the same reason as DraggableCard's: react-spring v10's
// `useSpring(() => initial)` re-applies `initial` on EVERY render (useSprings' layout
// effect calls `ctrl.start(initial)` because `ref.add` never sets `ctrl.ref`). A drop
// re-renders the page several times at once (resolve, tally, pack exit), and each one
// used to snap the ghost back to its start pose, cancelling the fall — whose cancelled
// promise then reported a "landing" and removed the ghost almost instantly. Both props
// are referentially stable (`fall` lives unchanged in state, `onLanded` is a
// useCallback), so memo keeps the ghost from ever re-rendering mid-fall.
const FallingCardGhost = memo(function FallingCardGhost({ fall, onLanded }: { fall: FallingCard; onLanded: (fall: FallingCard) => void }) {
    const [{ x, y, scale, opacity }, api] = useSpring(() => ({ x: fall.from.cx, y: fall.from.cy, scale: HELD_CARD_SCALE, opacity: 1 }));
    useEffect(() => {
        // `alive` guards StrictMode's mount→cleanup→mount and an early unmount: a
        // stopped animation still settles its promises, and must not count as landing.
        let alive = true;
        Promise.all(api.start({ x: fall.to.cx, y: fall.to.cy, scale: DROP_FALL_END_SCALE, opacity: 0, config: dropFallConfig }))
            .then(() => { if (alive) onLanded(fall); });
        return () => {
            alive = false;
            api.stop();
        };
    // Mount-only: a fall is fixed once it starts; `onLanded` is a stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api]);
    const { card } = fall;
    const face = MINI_CARD_DIMENSIONS[fall.size];
    return createPortal(
        <AnimatedMiniCard
            className="sort-cards__falling-card"
            aria-hidden
            // x/y are the card's CENTRE in viewport px; the negative margins put the box's
            // centre there, and the default centre transform-origin keeps it there as the
            // card shrinks.
            style={{ x, y, scale, opacity }}
            size={fall.size}
            language={card.language}
            entryKey={card.entryKey}
            pronunciation={card.pronunciation}
            definition={stripParentheses(card.definition ?? "")}
            iconId={card.iconId}
            sx={{
                position: "fixed",
                left: 0,
                top: 0,
                marginLeft: `${-face.width / 2}px`,
                marginTop: `${-face.height / 2}px`,
                // Level with the held DraggableCard it replaces.
                zIndex: 1000,
                pointerEvents: "none",
            }}
        >
            {/* It was over a bucket when let go, so it falls washed. */}
            <OverBucketWash className="sort-cards__over-bucket-wash" style={{ opacity: 1 }} />
        </AnimatedMiniCard>,
        document.body,
    );
});

const SortCardsPage: React.FC = () => {
    usePageTitle("Discover");
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();
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
    // The pack most recently put back on deck by Undo. Its slots (re)mount with the
    // small "rise" entrance instead of the "dock" slide-up from the screen bottom —
    // see EnteringCardSlot. Only ever compared against the on-deck packKey, so it is
    // harmless for it to linger once that pack has moved on.
    const [undoRestoredPackKey, setUndoRestoredPackKey] = useState<string | null>(null);
    // The pack that just advanced off deck, rendered in PackExitClip while it slides up
    // and out through the platform's top edge (docs §4.1 "Pack exit"). `rowTop` /
    // `rowHeight` are the live row's box inside the platform, measured at advance time
    // (the overlay sits exactly there, and travels rowTop + rowHeight to clear the top);
    // `exitId` keys the overlay so two quick advances restart the animation instead of
    // reusing a finished one.
    const [leavingPack, setLeavingPack] = useState<{ pack: SortPack; rowTop: number; rowHeight: number; exitId: number } | null>(null);
    const exitIdRef = useRef(0);
    // The live CardsRow, measured when a pack leaves so the exit overlay can sit in the
    // exact same spot and know how far it has to travel to clear the platform top.
    const cardsRowRef = useRef<HTMLDivElement>(null);
    // The on-deck platform's width, which decides whether a pack fits across on regular
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

    // Library tally (top-right of the level bar). The server-side truth is fetched once
    // on mount; sorts made during THIS session are layered on top as a delta rather than
    // refetched, so the numbers move the instant a card lands in a bucket and move back
    // when Undo reverses it.
    //
    // Why a delta and not a refetch: /api/onDeck/categoryCounts is a whole-library
    // aggregate, so re-hitting it per card would be a request per drop for a number that
    // only ever changes by one. The delta is exact because the pack supply query excludes
    // any word the user already has a vet row for (StarterPacksService._fetchSupplyRows'
    // NOT EXISTS clause) — every sortable on-deck card is therefore a brand-new library
    // row, never a re-categorization of one already counted in the fetched baseline.
    const { counts: categoryCounts, loaded: countsLoaded } = useCategoryCounts();
    const [tallyDelta, setTallyDelta] = useState({ learnNow: 0, mastered: 0 });
    // How many cards each tally pill has "swallowed" this session. Used as the pill's
    // React `key`, so every landing remounts it and restarts its gulp animation; 0 means
    // no sort yet, so the pill does not gulp on first render. Only sorts bump it — an
    // Undo takes a card back out and should not look like the pill ate one.
    const [tallyGulps, setTallyGulps] = useState({ learnNow: 0, mastered: 0 });
    // Dropped cards still falling into their bucket (FallingCardGhost). A card is sorted
    // the moment it is released, but its tally credit waits for the landing, so the
    // count ticks (and gulps) as the card disappears into the well rather than before.
    // `pendingLandingsRef` holds cardId → bucket for every sort whose credit is still
    // owed; Undo consults it so a card pulled back mid-fall is never credited OR debited.
    const [fallingCards, setFallingCards] = useState<FallingCard[]>([]);
    const fallIdRef = useRef(0);
    const pendingLandingsRef = useRef<Map<number, string>>(new Map());

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
    // NOTE: the footer pill is no longer suppressed here. SheetPanel takes the hold
    // itself for the lifetime of every modal sheet (see useHideFooter there), because a
    // sheet can now grow to cover the whole screen and the pill would float over it on
    // every host, not just this one.

    const bucketRefs = useRef<Map<string, HTMLElement>>(new Map());
    // Bucket geometry snapshotted at drag START. The highlight and drop hit-tests both
    // read from THIS (not live getBoundingClientRect), so they share one identical
    // threshold and a drag-move costs no layout read. (It also guarded against the
    // highlighted bucket's old 1.05 scale inflating its live rect; buckets no longer
    // scale, but the snapshot stays for the shared threshold and the cheaper move.)
    const bucketRectsRef = useRef<Map<string, DOMRect>>(new Map());

    const buckets = useMemo<BucketZone[]>(() => [
        // Coloured as the COLLECTION each bucket feeds, exactly as the fdp's filter tiles
        // (LibraryDuo) paint those collections: LEARN_NOW_COLORS for Learn Now and the
        // core bar's MASTERY_BAR_COLORS for Mastered (the SURFACE tier). The
        // level-bar tally above uses the same hues, so a bucket, its running count and
        // the fdp tile it fills are one colour. (Previously the band pair —
        // BAND_COLORS.Unfamiliar / .Mastered — which made Learn Now red here but yellow
        // on the fdp.)
        { id: "library", label: "Learn Now", mainColor: LEARN_NOW_COLORS.main },
        { id: "already-learned", label: "Already Learned", mainColor: MASTERY_BAR_COLORS.core.main },
    ], []);

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
            setUndoRestoredPackKey(null);
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
    // each on-deck card gets one of 0, STEP, 2·STEP, … ms in a random order, drawn once per
    // pack landing (keyed on packKey) so a re-render never reshuffles a pack mid-flight.
    const dockDelays = useMemo(() => {
        const delays: Record<number, number> = {};
        if (!currentPack) return delays;
        const steps = currentPack.cards.map((_, i) => i * DOCK_STAGGER_STEP_MS);
        // Fisher–Yates shuffle.
        for (let i = steps.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [steps[i], steps[j]] = [steps[j], steps[i]];
        }
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
    const difficultyLabel = useCallback(
        (lvl: number) => (language === "zh" ? `HSK ${lvl}` : `Level ${lvl}`),
        [language]
    );
    // The chip shows the bare label once the user has pinned a specific difficulty via
    // the dropdown, or just "Auto" — the adaptive target moves per-pack and fluctuates
    // too much to show live (docs §6), so it is never rendered as a number.
    const levelLabel = selectedLevel != null ? difficultyLabel(selectedLevel) : "Auto";

    // The two tally figures, kept DISJOINT so they read as the two drop buckets.
    // Both drop targets persist as starterPackBucket = 'library' (see
    // StarterPacksService.sortCard) — what separates them is that "Already Learned"
    // also writes a perfect 8/8 typed history, which resolves the row's utcm category
    // to Mastered. So "Learn Now" here means the still-being-learned part of the
    // library (everything except Mastered), not the library total the decks page shows.
    const learnNowCount = useMemo(
        () =>
            (categoryCounts["Unfamiliar"] ?? 0) +
            (categoryCounts["Target"] ?? 0) +
            (categoryCounts["Comfortable"] ?? 0) +
            tallyDelta.learnNow,
        [categoryCounts, tallyDelta.learnNow]
    );
    const masteredCount = (categoryCounts["Mastered"] ?? 0) + tallyDelta.mastered;

    // Apply one card's effect on the tally. `direction` is +1 for a sort, -1 for an undo.
    // A skip touches neither bucket (it never creates a vet row).
    // A sort also makes the receiving pill gulp (tallyGulps). For a dropped card this
    // runs when its fall lands (handleFallLanded), not at release.
    const adjustTally = useCallback((bucket: string, direction: 1 | -1) => {
        const key = bucket === "library" ? "learnNow" : bucket === "already-learned" ? "mastered" : null;
        if (!key) return;
        setTallyDelta((d) => ({ ...d, [key]: d[key] + direction }));
        if (direction === 1) setTallyGulps((g) => ({ ...g, [key]: g[key] + 1 }));
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
        for (const [id, el] of bucketRefs.current) {
            if (el) rects.set(id, el.getBoundingClientRect());
        }
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
        // slide up through the platform top; its replacement then slides in from below
        // once the exit is done (see dockDelays).
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
            setLeavingPack({ pack: leaving, rowTop: row.offsetTop, rowHeight: row.offsetHeight, exitId: exitIdRef.current });
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
    // app entirely, so fall back to the recorded origin, then to the discover hub.
    const exitToOrigin = useCallback(() => {
        const idx = (window.history.state as { idx?: number } | null)?.idx;
        if (idx == null || idx > 0) navigate(-1);
        else navigate(originPath ?? "/discover");
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
    // — no streaks, no thresholds: ANY "Add to Learn Now" card means the level was too
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

    // `deferTally`: the card is falling into its bucket (FallingCardGhost) and the tally
    // is credited when it lands (handleFallLanded) rather than here.
    const handleSortCard = useCallback(async (cardId: number, bucketId: string, deferTally = false) => {
        const pack = currentPack;
        if (!pack) return;
        pushUndo({ action: "sort", cardId, bucket: bucketId, pack });
        markResolved(pack.packKey, [cardId]);
        if (!deferTally) adjustTally(bucketId, 1);
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

    // A card let go over a bucket: sort it now, and (motion permitting) launch its fall
    // from where it was released to the bucket's centre. Both centres are read from
    // rects — the card's live one and the bucket's drag-start snapshot — and a centre is
    // unaffected by the held card's scale, so the ghost starts exactly on top of it.
    const handleCardDrop = useCallback((card: DiscoverCard, bucketId: string, cardRect: DOMRect | undefined, size: MiniCardSize) => {
        const bucket = bucketRectsRef.current.get(bucketId);
        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
        const falls = !!bucket && !!cardRect && !reducedMotion;
        if (falls) {
            fallIdRef.current += 1;
            pendingLandingsRef.current.set(card.id, bucketId);
            setFallingCards((prev) => [...prev, {
                fallId: fallIdRef.current,
                card,
                size,
                bucketId,
                from: { cx: cardRect.left + cardRect.width / 2, cy: cardRect.top + cardRect.height / 2 },
                to: { cx: bucket.left + bucket.width / 2, cy: bucket.top + bucket.height / 2 },
            }]);
        }
        void handleSortCard(card.id, bucketId, falls);
    }, [handleSortCard]);

    // The fall reached the bucket: retire the ghost and pay the tally credit it owed
    // (skipped if an Undo already took the card back out).
    const handleFallLanded = useCallback((fall: FallingCard) => {
        setFallingCards((prev) => prev.filter((f) => f.fallId !== fall.fallId));
        const owedBucket = pendingLandingsRef.current.get(fall.card.id);
        if (owedBucket === undefined) return;
        pendingLandingsRef.current.delete(fall.card.id);
        adjustTally(owedBucket, 1);
    }, [adjustTally]);

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
        // Covers both undo shapes: a card re-shown inside the on-deck pack, and a pack
        // brought back from off-deck — either way its slots "rise" rather than "dock".
        setUndoRestoredPackKey(entry.pack.packKey);
        // A pack still sliding out must not also be back on deck.
        setLeavingPack((prev) => (prev?.pack.packKey === entry.pack.packKey ? null : prev));
        // Give the tally back the card this action added (no-op for a skip) — unless the
        // card is still falling, in which case it was never credited: cancel the owed
        // credit and pull the ghost instead (it unmounts without reporting a landing).
        if (pendingLandingsRef.current.has(entry.cardId)) {
            pendingLandingsRef.current.delete(entry.cardId);
            setFallingCards((prev) => prev.filter((f) => f.card.id !== entry.cardId));
        } else {
            adjustTally(entry.bucket, -1);
        }
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
    }, [undoStack, unmarkResolved, adjustTally, language]);

    if (loading) {
        return (
            <NodePage title="Sort Cards" onBack={() => navigate("/discover")} scrollable={false}>
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
            <NodePage title="Sort Cards" onBack={exitToOrigin} scrollable={false}>
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
            <NodePage title="Sort Cards" onBack={() => navigate("/discover")} scrollable={false}>
                <ContentArea className="sort-cards__content">
                    <Box className="sort-cards__no-cards-error" sx={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
                        {exhausted
                            ? <Typography className="sort-cards__no-cards-error-text">Error: no cards found</Typography>
                            : <DelayedCircularProgress className="sort-cards__spinner" />}
                    </Box>
                </ContentArea>
            </NodePage>
        );
    }

    // One slot's contents: the Commonality header band, the card in its well, and the
    // per-card action row. Shared by the live row and the leaving-pack overlay so the
    // exiting slots are pixel-identical to the ones they replace. In the overlay
    // (`leaving`) nothing is interactive — PackExitClip is pointer-events: none — and no
    // live DraggableCard is ever mounted for an unsorted card (there are none by then:
    // a pack only advances once every card is resolved).
    const renderSlotBody = (card: DiscoverCard, pack: SortPack, leaving: boolean) => {
        // Resolved this session (sorted/skipped) and not pre-sorted: the card is gone,
        // its crater stays. Pre-sorted (locked) cards stay in place, greyed.
        const resolvedHere = !card.sorted && done[pack.packKey]?.has(card.id) === true;
        // Per PACK, not per page: a leaving 4-card pack keeps the compact face it was
        // shown at while the 3-card pack replacing it rises in at regular size.
        const cardSize = dockCardSize(pack.cards.length, dockWidth);
        return (
            <>
                {/* Header band: this card's tier label over the 5-dot frequency meter
                    (frequencyScore, 1 = almost never spoken … 5 = constant in daily
                    speech) + an x/5 readout. NOT a register scale — that was the
                    pre-migration-122 `vernacularScore` meaning; see
                    docs/DEFINITION_MAPPING.md. Lives on the platform, not the card, so it
                    stays put while the card is dragged into a bucket. */}
                <CardDeckHeader className="sort-cards__card-deck-header">
                    {card.frequencyScore != null && (
                        <>
                            <CommonalityTierLabel className="sort-cards__commonality-tier-label">
                                {COMMONALITY_TIER_LABELS[card.frequencyScore] ?? ""}
                            </CommonalityTierLabel>
                            <CommonalityMeterRow className="sort-cards__commonality-meter">
                                <FrequencyScoreDots
                                    className="sort-cards__card-frequency-dots"
                                    score={card.frequencyScore}
                                    dotSize={7}
                                    gap={3}
                                />
                                <CommonalityScoreValue className="sort-cards__commonality-value">
                                    {card.frequencyScore}/5
                                </CommonalityScoreValue>
                            </CommonalityMeterRow>
                        </>
                    )}
                </CardDeckHeader>
                <CardWell className="sort-cards__card-well" cardSize={cardSize}>
                    <CardCrater className="sort-cards__card-crater" aria-hidden />
                    {!resolvedHere && (
                        <DraggableCard
                            card={card}
                            size={cardSize}
                            locked={leaving || !!card.sorted}
                            // Undo re-showing a card in a slot that never left.
                            settleIn={!leaving && undoRestoredPackKey === pack.packKey}
                            onCheckCollision={checkBucketCollision}
                            onHighlight={setHighlightedBucket}
                            onDrop={handleCardDrop}
                            onFirstDrag={handleCardPickup}
                        />
                    )}
                </CardWell>
                {/* Per-card actions below the card: play audio (docs §4.5) and open the
                    eip (docs §4.7). They stay live over a crater, so a word that was
                    just sorted can still be heard / looked up until its pack leaves. */}
                <CardActionRow className="sort-cards__card-actions">
                    <SpeakerButton
                        onClick={() => handlePlayCardAudio(card)}
                        isLoading={!leaving && tts.speakingKey === card.entryKey}
                    />
                    <IconButton
                        className="sort-cards__card-info-button"
                        size="small"
                        aria-label={`More info about ${card.entryKey}`}
                        onClick={() => handleOpenCardInfo(card)}
                        disabled={!leaving && eipLoadingKey !== null}
                        sx={{
                            color: COLORS.textSecondary,
                            "&:hover": { color: COLORS.onSurface },
                        }}
                    >
                        {!leaving && eipLoadingKey === card.entryKey ? (
                            // A plain (not Delayed) CircularProgress: this is button-action
                            // feedback for a tap and must appear instantly — see the
                            // DelayedCircularProgress docblock. Sized to sit inside the
                            // 32px hit target so the row's height never changes mid-lookup.
                            <CircularProgress
                                className="sort-cards__card-info-spinner"
                                size={18}
                                thickness={4}
                            />
                        ) : (
                            <InfoOutlinedIcon
                                className="sort-cards__card-info-icon"
                                fontSize="small"
                            />
                        )}
                    </IconButton>
                </CardActionRow>
            </>
        );
    };

    return (
        <NodePage
            title="Sort Cards"
            onBack={() => navigate("/discover")}
            scrollable={false}
            headerExtraActions={
                <>
                    {/* The APP-WIDE narration audio mode, not a page-local pref. One
                        tap cycles off → passthrough → media; the same setting has its
                        explained three-option form on /settings. Was a bespoke MUI
                        Button styled inline here; it is now the shared chip, so scp
                        matches the flp and game headers exactly. */}
                    <AudioModeChip className="sort-cards__audio-chip" />
                    <IconButton
                        className="sort-cards__undo-button"
                        onClick={handleUndo}
                        size="small"
                        disabled={undoStack.length === 0}
                        sx={{ color: COLORS.onSurface }}
                    >
                        <UndoIcon className="sort-cards__undo-icon" />
                    </IconButton>
                </>
            }
        >
            <Box
                className="sort-cards__level-bar"
                // Three EQUAL columns (Learn Now | Difficulty | Mastered), each element
                // centred in its own column, so the three pills are evenly distributed
                // across the bar and none shifts when a tally's digit count grows.
                sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", justifyItems: "center", alignItems: "center", minHeight: 40, px: 2, py: 0.5 }}
            >
                {levelLabel && (
                    // Caption stacked BELOW the dropdown pill, mirroring the tally columns
                    // (pill → caption) so all three level-bar elements share one layout
                    // and one type treatment (SortTallyLabel). Middle grid column.
                    <Box
                        className="sort-cards__level-control"
                        sx={{ gridColumn: 2, gridRow: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}
                    >
                        <SortLevelDropdown
                            className="sort-cards__level-dropdown"
                            onClick={(e) => setLevelMenuAnchor(e.currentTarget)}
                            aria-haspopup="menu"
                            aria-expanded={Boolean(levelMenuAnchor)}
                        >
                            {levelLabel}
                            <KeyboardArrowDownIcon className="sort-cards__level-dropdown-arrow" sx={{ fontSize: "1.125rem", my: "-3px" }} />
                        </SortLevelDropdown>
                        <SortTallyLabel className="sort-cards__level-caption">Difficulty</SortTallyLabel>
                    </Box>
                )}
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

                {/* Running library tally, in the bar's outer grid columns. Rendered
                    only once the baseline counts have arrived, so the user never sees a
                    "0" that then jumps to its real value. Each figure is tinted with its
                    own bucket's fdp filter-tile hue. */}
                {countsLoaded && (
                    <>
                        <SortTallyColumn
                            className="sort-cards__tally sort-cards__tally--learn-now"
                            side="left"
                        >
                            <SortTallyValue
                                className="sort-cards__tally-value"
                                key={tallyGulps.learnNow}
                                gulp={tallyGulps.learnNow > 0}
                                hue={LEARN_NOW_HUE}
                            >
                                {learnNowCount}
                            </SortTallyValue>
                            <SortTallyLabel className="sort-cards__tally-label">Learn Now</SortTallyLabel>
                        </SortTallyColumn>
                        <SortTallyColumn
                            className="sort-cards__tally sort-cards__tally--mastered"
                            side="right"
                        >
                            <SortTallyValue
                                className="sort-cards__tally-value"
                                key={tallyGulps.mastered}
                                gulp={tallyGulps.mastered > 0}
                                hue={MASTERY_BAR_HUES.core}
                            >
                                {masteredCount}
                            </SortTallyValue>
                            <SortTallyLabel className="sort-cards__tally-label">Mastered</SortTallyLabel>
                        </SortTallyColumn>
                    </>
                )}
            </Box>

            <ContentArea className="sort-cards__content">
                {/* Destination buckets */}
                <BucketsContainer className="sort-cards__buckets-container">
                    {buckets.map((bucket) => (
                        <Bucket
                            className="sort-cards__bucket"
                            key={bucket.id}
                            ref={(el: HTMLElement | null) => {
                                if (el) bucketRefs.current.set(bucket.id, el);
                                else bucketRefs.current.delete(bucket.id);
                            }}
                            mainColor={bucket.mainColor}
                            // Lit while a card is held over it AND while one is still
                            // falling into it, so the card visibly sinks into a lit well.
                            highlight={highlightedBucket === bucket.id || fallingCards.some((f) => f.bucketId === bucket.id)}
                        >
                            <div className="bucket-text">{bucket.label}</div>
                        </Bucket>
                    ))}
                </BucketsContainer>

                {/* Dropped cards falling into their buckets — portalled to <body>, so
                    where they sit in this tree does not matter (see FallingCardGhost). */}
                {fallingCards.map((fall) => (
                    <FallingCardGhost key={fall.fallId} fall={fall} onLanded={handleFallLanded} />
                ))}

                {/* On-deck: up to 4 draggable cards (compact faces when 4 won't fit). A card the
                    user resolved this session leaves an invisible placeholder in its
                    slot so the other cards don't reposition. */}
                <OnDeckSection ref={onDeckSectionRef} className="sort-cards__on-deck">
                    {/* Skip — de-emphasized (§5.1): a small action in the platform's
                        top-right corner, not a drag bucket. Defers every remaining
                        unsorted card in the on-deck pack. Lives on the platform (not in
                        the NodePage header) so it reads as acting on THESE cards. */}
                    <OnDeckToolbar className="sort-cards__on-deck-toolbar">
                        <Button
                            className="sort-cards__skip-button"
                            variant="text"
                            size="small"
                            onClick={handleSkipPack}
                            sx={{
                                minWidth: "unset", px: 1, py: 0.25, height: "24px",
                                fontSize: SIZE.micro, textTransform: "lowercase", lineHeight: LEADING.normal,
                                borderRadius: "6px", color: COLORS.onSurface,
                            }}
                        >
                            skip
                        </Button>
                    </OnDeckToolbar>
                    <CardsRow
                        ref={cardsRowRef}
                        className="sort-cards__cards-row"
                        compact={dockCardSize(currentPack.cards.length, dockWidth) === "compact"}
                    >
                        {currentPack.cards.map((card) => (
                            // Keyed on pack + card, and the SAME element whether the card
                            // is live or has left a crater — sorting a card must not
                            // remount the slot (that would replay its entrance).
                            <EnteringCardSlot
                                key={`${currentPack.packKey}:${card.id}`}
                                entrance={undoRestoredPackKey === currentPack.packKey ? "rise" : "dock"}
                                delayMs={dockDelays[card.id] ?? 0}
                            >
                                {renderSlotBody(card, currentPack, false)}
                            </EnteringCardSlot>
                        ))}
                    </CardsRow>
                    {/* Pack exit (docs §4.1): the previous pack's slots — craters, locked
                        cards, header bands, action rows — slide up and are clipped away
                        at the platform's top edge; the new pack rises in after. */}
                    {leavingPack && (
                        <PackExitClip className="sort-cards__pack-exit-clip" aria-hidden>
                            <CardsRow
                                key={leavingPack.exitId}
                                className="sort-cards__cards-row sort-cards__cards-row--leaving"
                                compact={dockCardSize(leavingPack.pack.cards.length, dockWidth) === "compact"}
                                onAnimationEnd={(e) => {
                                    // animationend bubbles; only the row's own exit counts.
                                    if (e.target === e.currentTarget) setLeavingPack(null);
                                }}
                                sx={{
                                    position: "absolute",
                                    left: 0,
                                    top: `${leavingPack.rowTop}px`,
                                    "--sort-cards-exit-travel": `${leavingPack.rowTop + leavingPack.rowHeight}px`,
                                    // Ease-in: the old pack accelerates away; the new one
                                    // then (ease-out, EnteringCardSlot) decelerates into place.
                                    animation: `${packExitKeyframes} ${PACK_EXIT_MS}ms cubic-bezier(0.55, 0, 0.8, 0.25) forwards`,
                                }}
                            >
                                {leavingPack.pack.cards.map((card) => (
                                    <CardSlot key={card.id} className="sort-cards__card-slot sort-cards__card-slot--leaving">
                                        {renderSlotBody(card, leavingPack.pack, true)}
                                    </CardSlot>
                                ))}
                            </CardsRow>
                        </PackExitClip>
                    )}
                </OnDeckSection>

                {/* eip bottom sheet. Only mounted while open so the open animation
                    replays on every reopen (same rule as the flp). The scrim inside
                    SheetPanel covers the buckets and the on-deck cards, so no card can
                    be dragged while the panel is up — reading about a word and sorting
                    it are deliberately separate modes. */}
                <EipSheet
                    eip={eip}
                    open={eipOpen}
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
