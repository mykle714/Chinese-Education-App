import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Box, Typography, IconButton, Button, Chip, CircularProgress, Menu, MenuItem } from "@mui/material";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { styled } from "@mui/material/styles";
import UndoIcon from "@mui/icons-material/Undo";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { useDrag } from "@use-gesture/react";
import { useSpring, animated } from "@react-spring/web";
import NodePage from "../../components/NodePage";
import { FOOTER_CLEARANCE, FOOTER_TOTAL_CLEARANCE } from "../../components/MobileFooter";
import { SAFE_BOTTOM } from "../../theme/safeArea";
import ForeignText from "../../components/ForeignText";
import FrequencyScoreDots from "../../components/FrequencyScoreDots";
import SpeakerButton from "../../components/SpeakerButton";
import InfoCardSection from "../flashcards/FlashcardsLearnPage/InfoCardSection";
import EipTabStrip from "../flashcards/FlashcardsLearnPage/EipTabStrip";
import TooManyTabsSnackbar from "../flashcards/FlashcardsLearnPage/TooManyTabsSnackbar";
import { useEipTabs } from "../flashcards/FlashcardsLearnPage/useEipTabs";
import { API_BASE_URL } from "../../constants";
import { fetchStarterPacks, fetchNextPack, sortCard, skipPack, undoSort } from "./starterPacksApi";
import { fetchProvisionalSortSet } from "../../api/provisional";
import ProvisionalSortDonePopup from "../../components/ProvisionalSortDonePopup";
import { originLabelFor } from "../../utils/originLabel";
import { lookupVocabEntry } from "../../api/dictionary";
import { senseLabelForIndex, stripParentheses } from "../../utils/definitionUtils";
import { saveSelectedSense } from "../../utils/vocabApi";
import type { Language, DiscoverCard, SortPack } from "../../types";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useAuth } from "../../AuthContext";
import { useTTS } from "../../hooks/useTTS";
import AudioModeChip from "../../components/AudioModeChip";
import { useFlashcardLearnSettings } from "../../hooks/useFlashcardLearnSettings";
import { useCategoryCounts } from "../../hooks/useCategoryCounts";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING, TRACKING } from "../../theme/scale";
import { SHADOW } from "../../theme/shadows";

// The on-deck unit is now a SORT PACK (docs/SORT_CARDS_REQUIREMENTS.md §4.5): up to 3
// draggable cards (no sentence band). The client holds a short FIFO queue of PACKS
// (target 2: on-deck + buffer). The server selects card CONTENT; the CLIENT owns
// adaptive LEVELING (docs §6) — see the autoLevelRef state below. Skip is a
// de-emphasized header button (not a drag target). Undo reverses one card action at a
// time (sort OR skip), 3 deep.

const UNDO_DEPTH = 3;

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
    accentColor: string;
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
    // Containing block for the eip sheet host below (EipHost is absolutely
    // positioned against this box), mirroring the flp's ContentArea.
    position: "relative",
    userSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "none",
});

// Positioning host for the eip bottom sheet (docs/SORT_CARDS_REQUIREMENTS.md §4.7).
//
// ⚠️ SINCE 2026-08-30 THIS HOST NO LONGER SIZES OR POSITIONS THE SHEET. SheetPanel
// portals both its scrim and its sheet to the FRAME (so the sheet can grow to full
// height and merge into the page header — see docs/EIP_SHEET_GESTURES.md), which means
// it resolves `inset: 0` / `bottom: 0` / `parentElement.clientHeight` against the frame,
// not against this box. Everything below is kept because it documents why this element
// exists and what used to depend on it; the two notes marked VESTIGIAL are no longer
// load-bearing for the sheet.
//
// VESTIGIAL (was load-bearing before the sheet was portaled): ContentArea stops at MobileTabScreen's
// ScrollArea *content* box, which sits FOOTER_CLEARANCE (90px) above the
// screen bottom so page content clears the floating footer pill. A sheet pinned to
// ContentArea's bottom would therefore hover with a 90px band of page background
// beneath it. Stretching the host down through that reserved band pins the sheet flush
// to the real bottom edge; the ScrollArea's own `overflow: hidden` clips anything past
// it. This is the same trick OnDeckSection uses to paint the platform under the pill.
// The pill itself cannot be layered under the sheet (it is rendered at frame level by
// FooterPresenter, outside this page's DOM, so no z-index here reaches it) — instead the
// SheetPanel itself now slides it away for the sheet's lifetime (useHideFooter). The
// reserved band stays reserved either way, which is why this offset is unconditional.
//
// VESTIGIAL (same reason): the z-index. Every on-deck card carries `zIndex: 1000` (see
// CardShell's inline style — it lifts a card being dragged above its neighbours and the
// buckets), which beat SheetPanel's in-place scrim/sheet z-indexes of 10/11 outright:
// without this the cards painted straight through the open sheet. The portaled sheet
// carries SHEET_BASE_Z_INDEX (1201) at frame level and clears the cards on its own, so
// this stacking context now only orders this page's own info affordances.
const EIP_HOST_Z_INDEX = 1100; // > CardShell's 1000
const EipHost = styled(Box)({
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    // Negated clearance, INCLUDING the home-indicator inset the reservation now
    // carries (FOOTER_TOTAL_CLEARANCE) — a bare -90px would stop short of the real
    // bottom edge by the inset. `env()` cannot be negated in JS, so it is a calc.
    bottom: `calc(-${FOOTER_CLEARANCE}px - ${SAFE_BOTTOM})`,
    zIndex: EIP_HOST_Z_INDEX,
});

// The two destination buckets, laid out evenly across the top. A definite height lets
// each bucket resolve its `height: 100%` while keeping the card aspect ratio (below).
// The one card geometry used by the on-deck cards, their placeholders and the buckets.
// Width is stated explicitly (not left to `aspect-ratio`) because iOS Safari won't infer
// it in a content-sized flex column — see CardShell.
const CARD_ASPECT = "136 / 200";
const CARD_HEIGHT = 150;
const CARD_WIDTH = Math.round((CARD_HEIGHT * 136) / 200); // 102

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

const Bucket = styled(Box)<{ mainColor: string; accentColor: string; highlight?: boolean }>(
    ({ mainColor, accentColor, highlight }) => ({
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
        padding: 8,
        backgroundColor: mainColor,
        borderRadius: 12,
        // The ramp's ring in addition to the drop shadow: post-redesign `mainColor` is a
        // pastel (~1.15:1 on paper) AND this tile renders at 0.23 opacity when it is not
        // the active drop target, so without an edge it disappears entirely.
        // ⚠️ Even with the ring, 0.23 may now be too faint — check on a device.
        boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}, ${SHADOW.raised}`,
        opacity: highlight ? 0.9 : 0.23,
        transition: "opacity 0.2s ease-in-out, transform 0.2s ease-in-out",
        transform: highlight ? "scale(1.05)" : "scale(1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        "& .bucket-inner": {
            width: "100%",
            height: "100%",
            backgroundColor: accentColor,
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 8,
        },
        "& .bucket-text": {
            fontSize: SIZE.caption,
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
    flex: "0 0 auto",
    paddingTop: "12px",
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
    background: "#FFFFFF",
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

// Holds the up-to-3 cards side by side; wraps on very narrow frames.
const CardsRow = styled(Box)({
    width: "100%",
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingInline: 8,
});

// One on-deck slot: a vertical column holding the card's "commonality" header band
// stacked above the draggable card, with the play-audio button below it. The slot — not
// the card — owns the width budget so three fit across; the card sizes itself off its
// aspect ratio inside it.
const CardSlot = styled(Box)({
    flex: "0 0 auto",
    maxWidth: "31%",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
});

// Footer band below each card: the per-card actions (play audio, open the eip). Both
// buttons are MUI `size="small"` IconButtons (32px hit target), which is the height
// CardSlotPlaceholder mirrors so a sorted-away slot stays exactly as tall as a live one.
const CardActionRow = styled(Box)({
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
});

// Header band above each card: the "Commonality" caption over the 5-dot register meter
// (frequencyScore) with an "x/5" readout beside it. Fixed minHeight so cards with no
// score keep their card faces aligned with neighbors that do. Sits on the platform
// surface, not on the draggable card, so it stays put while the card is dragged away.
const CardDeckHeader = styled(Box)({
    position: "relative",
    minHeight: 40,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
});

// The "Commonality" caption. Absolutely positioned across the top of the header
// band so it floats *above* the score display group rather than participating in
// the flex flow — this keeps every card's meter at the same height instead of
// pushing the labelled (middle) card's meter down. Rendered only once, over the
// middle card, but spans the header so it reads as a caption for the whole row.
const CommonalityLabel = styled(Typography)({
    position: "absolute",
    top: 0,
    left: "50%",
    transform: "translateX(-50%)",
    fontSize: SIZE.micro,
    fontWeight: WEIGHT.semibold,
    letterSpacing: TRACKING.caps,
    textTransform: "uppercase",
    color: COLORS.textSecondary,
    lineHeight: 1,
    whiteSpace: "nowrap",
});

// One card's score display: the 5-dot register meter + "x/5" readout on a row.
// Each card wraps its own so all three align on a shared baseline (bottom of the
// header band), independent of whether the floating label is present above them.
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
// two destinations the user is dragging into. The two figures sit in OPPOSITE corners of
// the level bar (Mastered left, Learn Now right) rather than as one cluster, so each
// reads as its own standing total instead of the pair reading as a ratio.
// Deliberately NOT in the NodePage header — that row is already full (autoplay / skip /
// undo / fire badge), so the level bar's two ends are the nearest free top corners.
// Absolutely positioned so the level chip stays centered in the bar regardless of how
// wide either number grows.
const SortTallyCorner = styled(Box)<{ side: "left" | "right" }>(({ side }) => ({
    position: "absolute",
    [side]: 12,
    top: "50%",
    transform: "translateY(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: side === "left" ? "flex-start" : "flex-end",
    gap: 1,
    pointerEvents: "none", // purely informational — never intercepts a drag
}));

// The number, tinted with its bucket's SEMANTIC INK. The bucket TILES fill with the
// matching utcm pastels (COLORS.redMain === CATEGORY_COLORS.Unfamiliar,
// COLORS.blueMain === CATEGORY_COLORS.Mastered), so the tally, the drop buckets and
// the decks page still speak one color language for the same two states — the tally
// just uses the readable member of the pair, since it is text on paper.
const SortTallyValue = styled(Typography)({
    fontSize: SIZE.caption,
    fontWeight: WEIGHT.bold,
    lineHeight: 1,
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

const AnimatedBox = animated(Box);

const CardShell = styled(AnimatedBox)<{ locked?: boolean }>(({ locked, theme }) => ({
    position: "relative",
    // BOTH dimensions are stated explicitly rather than letting `aspect-ratio`
    // derive the width from the height. iOS Safari does not resolve an
    // aspect-ratio-implied *width* for a flex item in a column flex container
    // whose cross-axis is content-sized (CardSlot: `flex: 0 0 auto` +
    // `align-items: center`); it falls back to the content's min-content width,
    // which the wrapping definition text lets collapse far below the true card
    // width — the card rendered tall and skinny on prod mobile. Deriving the
    // height from a definite width (what the buckets above do) is fine in
    // Safari; deriving the width is not.
    height: CARD_HEIGHT,
    width: CARD_WIDTH,
    aspectRatio: CARD_ASPECT, // kept as documentation / belt-and-braces
    flex: "0 0 auto",
    maxHeight: "100%",
    // A flex item's default min-width is "auto" (its max-content size), which can
    // stop the definition text below from wrapping at all. minWidth: 0 lets the
    // card actually hold to its fixed size and forces long definitions to wrap
    // instead of pushing the card wider.
    minWidth: 0,
    // Locked (already-sorted) cards sink toward the page background instead of
    // sitting on the card surface color, reinforcing "not draggable".
    // The unlocked fill is the THEME's card face — the same source every other card
    // surface reads (MiniVocabCard, CardFace, QuickMarkCard). A fixed token here would
    // make the one card a learner actually drags the only card in the app still grey.
    backgroundColor: locked ? COLORS.header : theme.palette.flashcard.flashCard,
    borderRadius: 12,
    // A dropped shadow reads as "raised"; a locked card instead gets a soft
    // inward shadow so it reads as recessed/pressed-into-the-background.
    boxShadow: locked
        // No design equivalent for "recessed" — the artboards never draw a pressed-in
        // card — so this stays hand-authored, but re-inked to the shadow hue so it does
        // not sit next to the tokens as the one pure-black shadow left on the page.
        ? "inset 0 2px 5px rgba(20, 18, 26, 0.22)"
        : SHADOW.raised,
    padding: 10,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    cursor: locked ? "not-allowed" : "grab",
    touchAction: "none",
    opacity: locked ? 0.5 : 1,
    filter: locked ? "grayscale(0.85)" : "none",
    "&:active": { cursor: locked ? "not-allowed" : "grabbing" },
}));

// Occupies the exact footprint of a full slot (header band + card) that has been sorted
// away this session, so the remaining on-deck cards keep their positions instead of the
// flex row re-centering (docs/SORT_CARDS_REQUIREMENTS.md §4.5). Invisible +
// non-interactive; the inner boxes mirror CardDeckHeader's minHeight + the card's fixed
// height so the placeholder is exactly as tall as a live slot.
const CardSlotPlaceholder = styled(Box)({
    flex: "0 0 auto",
    maxWidth: "31%",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    visibility: "hidden",
    pointerEvents: "none",
});

// Diagonal "sorted!" watermark over a card already in the user's library.
const SortedWatermark = styled(Box)({
    position: "absolute",
    inset: 0,
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

/**
 * One draggable (or locked) card within the on-deck pack. Owns its own drag spring so
 * the three cards move independently. On drop into a bucket it animates out and calls
 * `onSort`; locked cards (already in the library) show a "sorted!" watermark and don't
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
const DraggableCard = memo(function DraggableCard({ card, locked, onCheckCollision, onHighlight, onSort, onFirstDrag }: {
    card: DiscoverCard;
    locked: boolean;
    onCheckCollision: (clientX: number, clientY: number) => string | null;
    onHighlight: (bucketId: string | null) => void;
    onSort: (cardId: number, bucketId: string) => void;
    onFirstDrag: () => void;
}) {
    const [{ x, y, scale, opacity }, api] = useSpring(() => ({ x: 0, y: 0, scale: 1, opacity: 1 }));

    // Entrance: slide up + fade in when the card first mounts (new pack / brought back).
    useEffect(() => {
        api.set({ x: 0, y: 24, scale: 1, opacity: 0 });
        api.start({ y: 0, opacity: 1, config: { tension: 280, friction: 26 } });
    }, [api]);

    const bind = useDrag(
        ({ first, down, movement: [mx, my], xy: [px, py] }) => {
            if (locked) return;
            if (first) onFirstDrag();
            if (down) {
                // Held: track the finger/cursor 1:1 and highlight the hovered bucket.
                api.start({ x: mx, y: my, scale: 1.1, immediate: true });
                onHighlight(onCheckCollision(px, py));
                return;
            }
            // Released.
            onHighlight(null);
            const bucketId = onCheckCollision(px, py);
            if (bucketId) {
                // Successful drop: animate OUT from where it was released (fade + shrink
                // in place). Deliberately do NOT also spring x/y back to the tray origin
                // — doing so made the card visibly fly back to its starting slot as it
                // committed (the "snap-back" bug), a race that was only ever hidden by
                // how fast the card then unmounts into its placeholder. When the last
                // card of a pack is sorted, advancePack's queue churn can delay that
                // unmount enough for the snap to become visible.
                api.start({ scale: 0.8, opacity: 0, config: { tension: 150, friction: 35 } });
                onSort(card.id, bucketId);
            } else {
                // Missed the buckets: spring back to the resting tray slot.
                api.start({ x: 0, y: 0, scale: 1 });
            }
        },
        { filterTaps: true }
    );

    return (
        <CardShell
            className="sort-cards__flash-card"
            locked={locked}
            {...(locked ? {} : bind())}
            style={{ x, y, scale, opacity, zIndex: 1000 }}
        >
            <Box className="sort-cards__card-icon-slot" sx={{ width: 44, height: 44, flex: "0 0 auto" }}>
                {card.iconId && (
                    <Box
                        component="img"
                        className="sort-cards__card-icon"
                        src={`${API_BASE_URL}/api/icons8/${encodeURIComponent(card.iconId)}/image`}
                        alt=""
                        draggable={false}
                        sx={{ width: 44, height: 44, objectFit: "contain", pointerEvents: "none" }}
                    />
                )}
            </Box>
            <Box className="sort-cards__card-key-group" sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <ForeignText size="sm" className="sort-cards__card-key" text={card.entryKey} pronunciation={card.pronunciation} />
            </Box>
            <Typography
                className="sort-cards__card-value"
                sx={{
                    fontSize: SIZE.micro,
                    fontWeight: WEIGHT.regular,
                    textAlign: "center",
                    width: "100%",
                    // 2-line cap via an explicit line-height + maxHeight, NOT
                    // `-webkit-box`/`WebkitLineClamp`: some browsers resolve that
                    // combo's computed `display` to `flow-root` instead of
                    // `-webkit-box`, which silently disables the clamp and collapses
                    // the box to a single line's height — clipping the second line
                    // with no ellipsis. lineHeight + maxHeight clips the same way but
                    // works everywhere since it never depends on that mechanism.
                    lineHeight: 1.3,
                    maxHeight: "2.6em",
                    overflow: "hidden",
                    whiteSpace: "normal",
                    overflowWrap: "break-word",
                    wordBreak: "break-word",
                    // CardShell is a fixed-height (150px) column flex container whose
                    // total content can exceed that height. Because this element has
                    // overflow: hidden, its flexbox "automatic minimum size" collapses
                    // to 0 (spec behavior), so without flexShrink: 0 the browser was
                    // squeezing it down to whatever space was left (~1 line) instead
                    // of honoring maxHeight above.
                    flexShrink: 0,
                }}
            >
                {stripParentheses(card.definition)}
            </Typography>
            {locked && (
                <SortedWatermark className="sort-cards__sorted-watermark">
                    <span>sorted!</span>
                </SortedWatermark>
            )}
        </CardShell>
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
    const { settings: learnSettings } = useFlashcardLearnSettings();
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
    const eipStripRef = useRef<HTMLDivElement | null>(null);
    const eip = useEipTabs({ stripRef: eipStripRef, language });
    const [eipOpen, setEipOpen] = useState(false);
    // entryKey whose lookup is in flight, so only the tapped card's info button
    // shows a spinner. Also gates re-taps on that same card.
    const [eipLoadingKey, setEipLoadingKey] = useState<string | null>(null);
    // NOTE: the footer pill is no longer suppressed here. SheetPanel takes the hold
    // itself for the lifetime of every modal sheet (see useHideFooter there), because a
    // sheet can now grow to cover the whole screen and the pill would float over it on
    // every host, not just this one.

    const bucketRefs = useRef<Map<string, HTMLElement>>(new Map());
    // Bucket geometry snapshotted at drag START — before any bucket is highlighted.
    // The highlight and drop hit-tests both read from THIS (not live
    // getBoundingClientRect), so they share one identical threshold. A highlighted
    // bucket scales to 1.05 (see the `Bucket` styled component), which would otherwise
    // inflate its live rect and make the drop zone ~5% larger than the highlight zone.
    const bucketRectsRef = useRef<Map<string, DOMRect>>(new Map());

    const buckets = useMemo<BucketZone[]>(() => [
        { id: "library", label: "Add to\nLearn Now", mainColor: COLORS.redMain, accentColor: COLORS.redAccent },
        { id: "already-learned", label: "Already Learned", mainColor: COLORS.blueMain, accentColor: COLORS.blueAccent },
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
    const doneForCurrent = currentPack ? done[currentPack.packKey] : undefined;

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
    const adjustTally = useCallback((bucket: string, direction: 1 | -1) => {
        if (bucket === "library") setTallyDelta((d) => ({ ...d, learnNow: d.learnNow + direction }));
        else if (bucket === "already-learned") setTallyDelta((d) => ({ ...d, mastered: d.mastered + direction }));
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

    // Snapshot every bucket's rect at drag start, while all buckets are still at their
    // resting (unscaled) size. Both the highlight and the drop test read these frozen
    // rects, so the highlighted bucket's 1.05 scale can never make one threshold differ
    // from the other.
    const snapshotBucketRects = useCallback(() => {
        const rects = new Map<string, DOMRect>();
        for (const [id, el] of bucketRefs.current) {
            if (el) rects.set(id, el.getBoundingClientRect());
        }
        bucketRectsRef.current = rects;
    }, []);

    // Collision test: is the pointer over a bucket? Uses the drag-start snapshot (above)
    // so highlight and drop hit-test against the exact same, scale-independent geometry.
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

    // Tap-to-play for a single card's header speaker button. Unlocks audio on the
    // gesture (mobile) then narrates just that card's word. Independent of the
    // pack-level autoplay effect — this is an on-demand replay.
    const handlePlayCardAudio = useCallback(
        (card: DiscoverCard) => {
            unlockAudio();
            void ttsRef.current.speakSentence(card.entryKey, card.pronunciation ?? undefined);
        },
        [unlockAudio]
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

    // Closing drops every tab as well, so reopening on another card starts clean rather
    // than resuming the previous card's drill-in stack.
    const handleCloseEip = useCallback(() => {
        setEipOpen(false);
        eip.clear();
    }, [eip]);

    // Autoplay: narrate every card in the on-deck pack, left to right, once per
    // pack (keyed on packKey so it fires exactly once when a pack lands on-deck,
    // not on every re-render). Cards already resolved/locked are still narrated —
    // this is about hearing the pack's words, not just the still-sortable ones.
    // Cancelled (and any in-flight utterance stopped) if the pack changes; turning
    // audio off mid-sequence stops the utterance via useTTS, which cancels on the
    // on → off edge for every surface at once.
    //
    // `tts.autoplay` is deliberately NOT a dep. It used to be, and the off → on edge
    // then replayed the whole on-deck pack the moment the learner tapped the header
    // audio chip. Changing a setting is not a request to hear the pack again; the
    // per-card speaker button is. The guard below reads the flag as it stood when
    // the pack landed, which is the only moment auto-narration is meant to start.
    useEffect(() => {
        if (!currentPack) return;
        if (!tts.autoplay) return;
        let cancelled = false;
        (async () => {
            for (const card of currentPack.cards) {
                if (cancelled) return;
                await tts.autoSpeakSentence(card.entryKey, card.pronunciation ?? undefined);
            }
        })();
        return () => {
            cancelled = true;
            tts.cancel();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPack?.packKey]);

    // Advance past a completed pack: drop the head and refill the tail with one pack,
    // excluding the packKeys we still hold so the replacement is never a duplicate.
    // Called only after the completing card's own /sort call has resolved (see
    // handleSortCard) — calling it any earlier lets /next-pack race ahead of the
    // server-side markPackSeen and re-serve the pack that's still finishing.
    const advancePack = useCallback(async (completedKey: string, attempt = 0) => {
        const rest = queue.filter((p) => p.packKey !== completedKey);
        setQueue(rest);

        // Set mode never replenishes — the set is fixed. Emptying the queue IS the exit
        // condition, but the navigation itself lives in the effect below so that every
        // path that empties the queue (sort, skip, or a set that came back already done)
        // closes the page, not just this one.
        if (setMode) return;

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
            if (attempt < 1) setTimeout(() => advancePack(completedKey, attempt + 1), 800);
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

        try {
            await sortCard({
                cardId,
                bucket: bucketId,
                language: language as Language,
                packId: pack.packId,
                lastInPack,
            });
            // Only request the replacement pack once the server has recorded this sort
            // (and, for a pack-completing sort, marked the pack seen) — requesting it
            // any earlier lets /next-pack race ahead and re-serve the completing pack.
            if (lastInPack) advancePack(pack.packKey);
        } catch (error) {
            console.error("Error sorting card:", error);
            // Set mode has no replenish request to race, so a failed POST must not pin
            // the queue: the card is already resolved optimistically and locked, and
            // leaving the pack in place would strand the set one card short of its exit.
            if (lastInPack && setMode) advancePack(pack.packKey);
        }
    }, [currentPack, pushUndo, markResolved, adjustTally, isPackComplete, selectedLevel, applyPackSignal, advancePack, setMode, language]);

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
                    {/* Skip — de-emphasized (§5.1): a small header action, not a drag bucket.
                        Defers every remaining unsorted card in the on-deck pack. */}
                    <Button
                        className="sort-cards__skip-button"
                        variant="text"
                        size="small"
                        onClick={handleSkipPack}
                        sx={{
                            minWidth: "unset", px: 1, py: 0.25, height: "30px",
                            fontSize: SIZE.micro, textTransform: "lowercase", lineHeight: LEADING.normal,
                            borderRadius: "6px", color: COLORS.onSurface,
                        }}
                    >
                        skip
                    </Button>
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
                sx={{ position: "relative", display: "flex", justifyContent: "center", alignItems: "center", minHeight: 40, px: 2, py: 0.5 }}
            >
                {levelLabel && (
                    <Chip
                        className="sort-cards__level-chip"
                        label={
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
                                {levelLabel}
                                <KeyboardArrowDownIcon className="sort-cards__level-chip-arrow" sx={{ fontSize: "1rem" }} />
                            </Box>
                        }
                        size="small"
                        onClick={(e) => setLevelMenuAnchor(e.currentTarget)}
                        sx={{
                            backgroundColor: COLORS.infoInk, color: "white", fontSize: SIZE.micro, fontWeight: WEIGHT.bold,
                            letterSpacing: TRACKING.caps, cursor: "pointer",
                        }}
                    />
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

                {/* Running library tally, split across the bar's two corners. Rendered
                    only once the baseline counts have arrived, so the user never sees a
                    "0" that then jumps to its real value. Each figure is tinted with its
                    own bucket's color. */}
                {countsLoaded && (
                    <>
                        <SortTallyCorner
                            className="sort-cards__tally sort-cards__tally--learn-now"
                            side="left"
                        >
                            <SortTallyValue className="sort-cards__tally-value" sx={{ color: COLORS.dangerInk }}>
                                {learnNowCount}
                            </SortTallyValue>
                            <SortTallyLabel className="sort-cards__tally-label">Learn Now</SortTallyLabel>
                        </SortTallyCorner>
                        <SortTallyCorner
                            className="sort-cards__tally sort-cards__tally--mastered"
                            side="right"
                        >
                            <SortTallyValue className="sort-cards__tally-value" sx={{ color: COLORS.infoInk }}>
                                {masteredCount}
                            </SortTallyValue>
                            <SortTallyLabel className="sort-cards__tally-label">Mastered</SortTallyLabel>
                        </SortTallyCorner>
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
                            accentColor={bucket.accentColor}
                            highlight={highlightedBucket === bucket.id}
                        >
                            <div className="bucket-inner">
                                <div className="bucket-text">{bucket.label}</div>
                            </div>
                        </Bucket>
                    ))}
                </BucketsContainer>

                {/* On-deck: up to 3 draggable cards (tray shrinks to fit). A card the
                    user resolved this session leaves an invisible placeholder in its
                    slot so the other cards don't reposition. */}
                <OnDeckSection className="sort-cards__on-deck">
                    <CardsRow className="sort-cards__cards-row">
                        {currentPack.cards.map((card, cardIndex) => {
                            // The "Commonality" caption renders only above the middle
                            // on-deck card (each card still shows its own meter).
                            const isMiddleCard =
                                cardIndex === Math.floor(currentPack.cards.length / 2);
                            // Resolved this session (sorted/skipped) but not pre-sorted:
                            // hold the whole slot (header band + card) with a placeholder
                            // instead of a live card so neighbors don't reposition.
                            if (!card.sorted && doneForCurrent?.has(card.id)) {
                                return (
                                    <CardSlotPlaceholder
                                        key={`${currentPack.packKey}:${card.id}`}
                                        className="sort-cards__card-placeholder"
                                        aria-hidden
                                    >
                                        <CardDeckHeader />
                                        <Box sx={{ width: CARD_WIDTH, height: CARD_HEIGHT }} />
                                        {/* Mirrors the live slot's action-row footer height
                                            (both buttons are 32px `size="small"`). */}
                                        <Box sx={{ height: 32 }} />
                                    </CardSlotPlaceholder>
                                );
                            }
                            return (
                                <CardSlot
                                    key={`${currentPack.packKey}:${card.id}`}
                                    className="sort-cards__card-slot"
                                >
                                    {/* Header band: "Commonality" caption over the 5-dot
                                        frequency meter (frequencyScore, 1 = almost never
                                        spoken … 5 = constant in daily speech) + an x/5
                                        readout. NOT a register scale — that was the
                                        pre-migration-122 `vernacularScore` meaning; see
                                        docs/DEFINITION_MAPPING.md. Lives on the platform,
                                        not the card, so it stays put while the card is
                                        dragged into a bucket. */}
                                    <CardDeckHeader className="sort-cards__card-deck-header">
                                        {card.frequencyScore != null && (
                                            <>
                                                {isMiddleCard && (
                                                    <CommonalityLabel className="sort-cards__commonality-label">
                                                        Commonality
                                                    </CommonalityLabel>
                                                )}
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
                                    <DraggableCard
                                        card={card}
                                        locked={!!card.sorted}
                                        onCheckCollision={checkBucketCollision}
                                        onHighlight={setHighlightedBucket}
                                        onSort={handleSortCard}
                                        onFirstDrag={handleCardPickup}
                                    />
                                    {/* Per-card actions below the card: play audio (docs
                                        §4.5) and open the eip (docs §4.7). */}
                                    <CardActionRow className="sort-cards__card-actions">
                                        <SpeakerButton
                                            onClick={() => handlePlayCardAudio(card)}
                                            isLoading={tts.speakingKey === card.entryKey}
                                        />
                                        <IconButton
                                            className="sort-cards__card-info-button"
                                            size="small"
                                            aria-label={`More info about ${card.entryKey}`}
                                            onClick={() => handleOpenCardInfo(card)}
                                            disabled={eipLoadingKey !== null}
                                            sx={{
                                                color: COLORS.textSecondary,
                                                "&:hover": { color: COLORS.onSurface },
                                            }}
                                        >
                                            {eipLoadingKey === card.entryKey ? (
                                                // A plain (not Delayed) CircularProgress:
                                                // this is button-action feedback for a tap
                                                // and must appear instantly — see the
                                                // DelayedCircularProgress docblock. Sized to
                                                // sit inside the 32px hit target so the row's
                                                // height never changes mid-lookup.
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
                                </CardSlot>
                            );
                        })}
                    </CardsRow>
                </OnDeckSection>

                {/* eip bottom sheet. Only mounted while open so the open animation
                    replays on every reopen (same rule as the flp). The scrim inside
                    SheetPanel covers the buckets and the on-deck cards, so no card can
                    be dragged while the panel is up — reading about a word and sorting
                    it are deliberately separate modes. */}
                {eipOpen && (() => {
                    // The active tab owns the panel's entry/breakdown/sub-tab. The root
                    // tab is always seeded before eipOpen flips true, so `active` is
                    // present; the nulls below are a paint-safety net only.
                    const active = eip.activeTab;
                    const compareTab = active?.kind === "compare" ? active : null;
                    return (
                        <EipHost className="sort-cards__eip-host">
                            <InfoCardSection
                                currentEntry={active?.kind === "entry" ? active.entry : null}
                                selectedTab={active?.kind === "entry" ? active.selectedSubTab : 0}
                                onTabChange={eip.setActiveSubTab}
                                breakdownItems={active?.kind === "entry" ? active.breakdownItems : []}
                                showPinyin={learnSettings.showPinyin}
                                showPinyinColor={learnSettings.showPinyinColor}
                                // scp has no card faces, so there is no "flipped" state to
                                // mirror — the panel always renders its front-facing layout.
                                isFlipped={false}
                                onClose={handleCloseEip}
                                onBreakdownItemClick={(item) => eip.openForEntryKey(item.character)}
                                onUsedInItemClick={(item) => eip.openForEntryKey(item.entryKey)}
                                onExampleSegmentClick={(segment) => eip.openForEntryKey(segment)}
                                depth={0}
                                onSpeak={tts.speak}
                                onSpeakSentence={tts.speakSentence}
                                speakingKey={tts.speakingKey}
                                // NOTE: no `onAddToLibrary` — the "+" header button stays
                                // hidden here on purpose. On scp, adding to Learn Now IS the
                                // drag gesture the whole page is built around, and a second,
                                // differently-shaped way to do it inside the panel would
                                // compete with it. (Drilled-in words can still be added from
                                // the flp, which is where that affordance lives.)
                                selectedSenseIndex={active?.kind === "entry" ? active.selectedSenseIndex : 0}
                                // A pick in the eip header mirrors the flp/cdp pickers: the tab
                                // records it (so the panel re-renders at once) and the chosen
                                // cluster's LABEL is persisted for saved cards. scp has no card
                                // face holding an optimistic override, so the PATCH is
                                // fire-and-forget — the tab's own index is what the panel renders
                                // from. Un-sorted/dictionary words carry no vet row (id 0), so
                                // their pick simply stays local to the tab.
                                onSelectSense={(index) => {
                                    eip.setActiveSenseIndex(index);
                                    const entry = active?.kind === "entry" ? active.entry : null;
                                    if (entry?.id) {
                                        saveSelectedSense(entry.id, senseLabelForIndex(entry, index))
                                            .catch((err) => console.error("Failed to save selected sense:", err));
                                    }
                                }}
                                compareTab={compareTab}
                                onSetCompareSlot={eip.setCompareSlot}
                                onCompareResult={eip.setCompareResult}
                                entryTabId={eip.activeTab?.id}
                                entryTabIndex={eip.activeIndex}
                                tabStrip={
                                    <EipTabStrip
                                        tabs={eip.tabs}
                                        activeIndex={eip.activeIndex}
                                        onSelect={eip.setActive}
                                        isTabbedMode={eip.isTabbedMode}
                                        stripRef={eipStripRef}
                                    />
                                }
                                // ✕ = close the showing word; false means "that was the
                                // last one" and SheetPanel dismisses (see the flp's copy).
                                onCloseX={() => {
                                    // The LAST word does not close its tab — it returns false and
                                    // lets SheetPanel play the dismiss, and the host's onClose
                                    // clears the trail once the sheet is gone. Closing the tab here
                                    // instead would empty the panel's body for the whole 220ms
                                    // slide-out, so the sheet would leave showing nothing.
                                    if (eip.tabs.length <= 1) return false;
                                    eip.closeActiveTab();
                                    return true;
                                }}
                                showMinutePoints
                            />
                        </EipHost>
                    );
                })()}
            </ContentArea>
            <TooManyTabsSnackbar signal={eip.overflowSignal} />
        </NodePage>
    );
};

export default SortCardsPage;
