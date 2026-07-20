import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Typography, IconButton, Button, Chip, Menu, MenuItem } from "@mui/material";
import DelayedCircularProgress from "../components/DelayedCircularProgress";
import { styled } from "@mui/material/styles";
import UndoIcon from "@mui/icons-material/Undo";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { useDrag } from "@use-gesture/react";
import { useSpring, animated } from "@react-spring/web";
import NodePage from "../components/NodePage";
import MinutePointsFireBadge from "../minutePoints/MinutePointsFireBadge";
import { FLOATING_FOOTER_CLEARANCE } from "../components/MobileFooter";
import ForeignText from "../components/ForeignText";
import PosBadge from "../components/PosBadge";
import VernacularScoreDots from "../components/VernacularScoreDots";
import SpeakerButton from "../components/SpeakerButton";
import { API_BASE_URL } from "../constants";
import { stripParentheses } from "../utils/definitionUtils";
import type { Language, DiscoverCard, SortPack, DiscoverFetchResponse, DiscoverNextPackResponse } from "../types";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuth } from "../AuthContext";
import { useTTS } from "../hooks/useTTS";
import { useDiscoverSettings } from "../hooks/useDiscoverSettings";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE, WEIGHT, LEADING, TRACKING } from "../theme/scale";

// The on-deck unit is now a SORT PACK (docs/SORT_CARDS_REQUIREMENTS.md §4.5): up to 3
// draggable cards (no sentence band). The client holds a short FIFO queue of PACKS
// (target 2: on-deck + buffer). The server selects card CONTENT; the CLIENT owns
// adaptive LEVELING (docs §6, rewritten) — see the autoLevelRef/levelStreakRef state
// below. Skip is a de-emphasized header button (not a drag target). Undo reverses one
// card action at a time (sort OR skip), 3 deep.

const UNDO_DEPTH = 3;

// Manual HSK/difficulty dropdown levels — mirrors the server's generalized 1..6
// difficulty scale (StarterPacksService._levelConfig, migration 79) for every
// language. `null` is the "auto" entry (the adaptive target the client tracks itself).
const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5, 6];
const MIN_DIFFICULTY_LEVEL = DIFFICULTY_LEVELS[0];
const MAX_DIFFICULTY_LEVEL = DIFFICULTY_LEVELS[DIFFICULTY_LEVELS.length - 1];
// How many consecutive "Already Learned"-only SortPacks at a level are required before
// the auto target moves up a level (docs §6, rewritten).
const ALREADY_LEARNED_STREAK_TO_UPGRADE = 2;
// How many "Add to Learn Now" sorts WITHIN a single pack are required before the auto
// target drops a level. Unlike the upgrade streak this is counted inside one pack (no
// streak across packs), so the downgrade still reacts within a single pack — it just
// tolerates one unknown word before concluding the level is too hard.
const LIBRARY_SORTS_TO_DOWNGRADE = 2;

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

const ContentArea = styled(Box)({
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    overflow: "visible",
    userSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "none",
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
        boxShadow: "1px 4px 4px rgba(0, 0, 0, 0.25)",
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
// per-card vernacular meter + speaker button live in a header band along its top.
const OnDeckSection = styled(Box)({
    width: "100%",
    flex: "0 0 auto",
    paddingTop: "12px",
    // Extend the white platform down through the footer-clearance zone the
    // MobileTabScreen ScrollArea reserves (paddingBottom: FLOATING_FOOTER_CLEARANCE),
    // so the floating footer hovers over the on-deck white rather than a seam of
    // page background. The negative margin cancels the padding in layout, keeping
    // the platform's vertical footprint unchanged — it only paints the spacer.
    paddingBottom: FLOATING_FOOTER_CLEARANCE,
    marginBottom: -FLOATING_FOOTER_CLEARANCE,
    // Rounded top corners on a plain white slab.
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    background: "#FFFFFF",
    // A hairline highlight along the very top edge + a broad shadow cast downward sell
    // the "platform floating above the page" depth cue.
    boxShadow: [
        "inset 0 2px 0 rgba(255, 255, 255, 0.7)",
        "0 -6px 16px rgba(0, 0, 0, 0.14)",
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

// Header band above each card: the "Commonality" caption over the 5-dot register meter
// (vernacularScore) with an "x/5" readout beside it. Fixed minHeight so cards with no
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

const AnimatedBox = animated(Box);

const CardShell = styled(AnimatedBox)<{ locked?: boolean }>(({ locked }) => ({
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
    backgroundColor: locked ? COLORS.header : COLORS.card,
    borderRadius: 12,
    // A dropped shadow reads as "raised"; a locked card instead gets a soft
    // inward shadow so it reads as recessed/pressed-into-the-background.
    boxShadow: locked
        ? "inset 0 2px 5px rgba(0, 0, 0, 0.22)"
        : "2px 4px 4px rgba(0, 0, 0, 0.25)",
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
        color: COLORS.redMain,
        border: `2px solid ${COLORS.redMain}`,
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

    const valueRef = useRef<HTMLElement | null>(null);
    useEffect(() => {
        const el = valueRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        console.log("[sort-cards] definition geometry v2", {
            entryKey: card.entryKey,
            definition: card.definition,
            elRect: { width: rect.width, height: rect.height },
            scrollWidth: el.scrollWidth,
            scrollHeight: el.scrollHeight,
            clientWidth: el.clientWidth,
            clientHeight: el.clientHeight,
            computed: { display: cs.display, whiteSpace: cs.whiteSpace, lineHeight: cs.lineHeight, maxHeight: cs.maxHeight, overflow: cs.overflow, fontSize: cs.fontSize, width: cs.width },
        });
    }, [card.entryKey, card.definition]);

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
                <PosBadge pos={card.pos} hasMultiplePos={card.hasMultiplePos} />
            </Box>
            <Typography
                ref={valueRef}
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
    const { token, isAuthenticated } = useAuth();
    const { language } = useParams<{ language: Language }>();
    const tts = useTTS();
    const { settings: discoverSettings, update: updateDiscoverSettings } = useDiscoverSettings();
    const audioUnlockedRef = useRef(false);
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

    // Adaptive leveling state (docs/SORT_CARDS_REQUIREMENTS.md §6, rewritten): the
    // CLIENT is the sole owner of the auto target level once seeded. Refs (not state)
    // because they must be read synchronously by advancePack right after a signal
    // updates them — no re-render round-trip, and the number is never displayed
    // (fluctuates too much to show live — the chip just reads "Auto").
    //   - autoLevelRef: the current auto target; null until the first (cold-start)
    //     server response seeds it.
    //   - levelStreakRef: per-level count of consecutive "Already Learned"-only packs
    //     seen at that level, toward the 2-pack upgrade threshold.
    //   - packBucketsRef: which bucket each card in a pack was actually sorted into
    //     THIS session, so a completing pack's signal can be derived (a pack counts as
    //     ONE signal no matter how many of its cards were sorted — §6).
    const autoLevelRef = useRef<number | null>(null);
    const levelStreakRef = useRef<Record<number, number>>({});
    const packBucketsRef = useRef<Record<string, Record<number, string>>>({});

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

    const authHeaders = useMemo(
        () => ({ "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }),
        [token]
    );

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
                // Build the URL as a plain relative template string (NOT `new URL(...)`):
                // in the prod build API_BASE_URL is "" (relative), and `new URL("/api/...")`
                // with no base THROWS "Invalid URL" — which fell into the catch below and
                // left the page spinning forever (loading=false, no pack, not exhausted).
                // The sibling starter-packs calls already use this relative style.
                // requestLevel/selectedLevel are bare 1..6 integers, so no query-encoding
                // is needed.
                const requestLevel = selectedLevel != null ? selectedLevel : autoLevelRef.current;
                const params: string[] = [];
                if (requestLevel != null) params.push(`level=${requestLevel}`);
                if (selectedLevel != null) params.push("mode=manual");
                const qs = params.length ? `?${params.join("&")}` : "";
                const response = await fetch(`${API_BASE_URL}/api/starter-packs/${language}${qs}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    credentials: "include",
                });
                if (response.ok) {
                    const data: DiscoverFetchResponse = await response.json();
                    setQueue(data.packs);
                    setExhausted(data.exhausted);
                    // Only auto ever needs to learn the level from the server — the
                    // cold-start seed. A manual pin's level is already known locally
                    // (selectedLevel), and re-echoes of an already-tracked auto level
                    // are harmless no-ops.
                    if (selectedLevel == null && typeof data.level === "number") autoLevelRef.current = data.level;
                } else {
                    console.error("Failed to fetch starter packs");
                }
            } catch (error) {
                console.error("Error fetching packs:", error);
            } finally {
                setLoading(false);
            }
        };
        if (language) fetchPacks();
    // isAuthenticated not `token`: a silent refresh must not restart the sort
    // session (wiping undo history + resolved markers). See CLAUDE.md "Never
    // reload on token refresh".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language, isAuthenticated, selectedLevel]);

    const currentPack = queue[0];
    const doneForCurrent = currentPack ? done[currentPack.packKey] : undefined;

    // Difficulty label for a bare level number ("HSK 3" for zh, "Level 3" otherwise).
    const difficultyLabel = useCallback(
        (lvl: number) => (language === "zh" ? `HSK ${lvl}` : `Level ${lvl}`),
        [language]
    );
    // The chip shows the bare label once the user has pinned a specific difficulty via
    // the dropdown, or just "Auto" — the adaptive target moves per-pack and fluctuates
    // too much to show live (docs §6, rewritten), so it is never rendered as a number.
    const levelLabel = selectedLevel != null ? difficultyLabel(selectedLevel) : "Auto";

    // Log every time a new sort pack lands on-deck (queue[0] changes).
    useEffect(() => {
        if (!currentPack) return;
        console.log("[sort-flow] pack on-deck", {
            sortPack: currentPack,
            estimatedLevel: autoLevelRef.current,
        });
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

    const unlockAudioOnce = useCallback(() => {
        if (!audioUnlockedRef.current) {
            audioUnlockedRef.current = true;
            ttsRef.current.unlockAudio();
        }
    }, []);

    // Fires when a card is first picked up (drag start). Unlocks audio (mobile requires
    // a user gesture) and freezes the current bucket geometry so the highlight and drop
    // hit-tests share one threshold. Narration itself is handled by the pack-level
    // autoplay effect below, not per-pickup.
    const handleCardPickup = useCallback(() => {
        unlockAudioOnce();
        snapshotBucketRects();
    }, [unlockAudioOnce, snapshotBucketRects]);

    // Tap-to-play for a single card's header speaker button. Unlocks audio on the
    // gesture (mobile) then narrates just that card's word. Independent of the
    // pack-level autoplay effect — this is an on-demand replay.
    const handlePlayCardAudio = useCallback(
        (card: DiscoverCard) => {
            unlockAudioOnce();
            void ttsRef.current.speakSentence(card.entryKey, card.pronunciation ?? undefined);
        },
        [unlockAudioOnce]
    );

    // Autoplay: narrate every card in the on-deck pack, left to right, once per
    // pack (keyed on packKey so it fires exactly once when a pack lands on-deck,
    // not on every re-render). Cards already resolved/locked are still narrated —
    // this is about hearing the pack's words, not just the still-sortable ones.
    // Cancelled (and any in-flight utterance stopped) if the pack changes or
    // autoplay/TTS gets turned off mid-sequence.
    useEffect(() => {
        if (!currentPack) return;
        if (!tts.enabled || !discoverSettings.autoplay) return;
        let cancelled = false;
        (async () => {
            for (const card of currentPack.cards) {
                if (cancelled) return;
                await tts.speakSentence(card.entryKey, card.pronunciation ?? undefined);
            }
        })();
        return () => {
            cancelled = true;
            tts.cancel();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPack?.packKey, tts.enabled, discoverSettings.autoplay]);

    // Advance past a completed pack: drop the head and refill the tail with one pack,
    // excluding the packKeys we still hold so the replacement is never a duplicate.
    // Called only after the completing card's own /sort call has resolved (see
    // handleSortCard) — calling it any earlier lets /next-pack race ahead of the
    // server-side markPackSeen and re-serve the pack that's still finishing.
    const advancePack = useCallback(async (completedKey: string, attempt = 0) => {
        const rest = queue.filter((p) => p.packKey !== completedKey);
        setQueue(rest);
        try {
            // Reads autoLevelRef fresh (not a stale closure) — handleSortCard updates it
            // synchronously from the completing pack's signal BEFORE calling advancePack,
            // so a downgrade/upgrade is reflected in THIS replenish request already
            // (docs §6, rewritten: "set to sortPackLevel±1", never a stale increment).
            const requestLevel = selectedLevel != null ? selectedLevel : autoLevelRef.current;
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/next-pack`, {
                method: "POST",
                headers: authHeaders,
                credentials: "include",
                body: JSON.stringify({
                    language,
                    excludePackKeys: rest.map((p) => p.packKey),
                    ...(requestLevel != null ? { level: requestLevel } : {}),
                    ...(selectedLevel != null ? { mode: "manual" } : {}),
                }),
            });
            if (!response.ok) throw new Error(`next-pack failed: ${response.status}`);
            const data: DiscoverNextPackResponse = await response.json();
            setExhausted(data.exhausted);
            if (data.nextPack) {
                const next = data.nextPack;
                setQueue((prev) => (prev.some((p) => p.packKey === next.packKey) ? prev : [...prev, next]));
            }
        } catch (error) {
            console.error("Error fetching next pack:", error);
            // The completed pack was already dropped above, so a swallowed failure here
            // permanently strands the queue at one slot short. One retry covers
            // transient network blips instead of leaving the user with an empty queue.
            if (attempt < 1) setTimeout(() => advancePack(completedKey, attempt + 1), 800);
        }
    }, [queue, authHeaders, language, selectedLevel]);

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
    // every bucket sorted into it this session (docs §6, rewritten): LIBRARY_SORTS_TO_DOWNGRADE
    // or more "Add to Learn Now" cards outweigh everything else (negative — several words at
    // this level were unknown), an all-"Already Learned" pack is positive, and a pack with
    // exactly one "Add to Learn Now" is neutral (one unknown word is not evidence either way,
    // so it neither downgrades nor feeds the upgrade streak). Anchored on
    // the completing pack's OWN level (not the running auto target), since the target
    // may already have drifted from an earlier in-flight signal — this is exactly why
    // the update is "set to packLevel±1", never "increment the target".
    const applyPackSignal = useCallback((pack: SortPack) => {
        const outcomes = Object.values(packBucketsRef.current[pack.packKey] ?? {});
        const libraryCount = outcomes.filter((o) => o === "library").length;
        if (libraryCount >= LIBRARY_SORTS_TO_DOWNGRADE) {
            levelStreakRef.current[pack.level] = 0;
            autoLevelRef.current = Math.max(MIN_DIFFICULTY_LEVEL, pack.level - 1);
        } else if (libraryCount > 0) {
            // Exactly one unknown word — neutral: leave the upgrade streak untouched.
        } else if (outcomes.includes("already-learned")) {
            const streak = (levelStreakRef.current[pack.level] ?? 0) + 1;
            if (streak >= ALREADY_LEARNED_STREAK_TO_UPGRADE) {
                levelStreakRef.current[pack.level] = 0;
                autoLevelRef.current = Math.min(MAX_DIFFICULTY_LEVEL, pack.level + 1);
            } else {
                levelStreakRef.current[pack.level] = streak;
            }
        }
        // A pack with no library/already-learned outcomes (fully skipped) carries no
        // signal at all — nothing to do (§5.1).
    }, []);

    const handleSortCard = useCallback(async (cardId: number, bucketId: string) => {
        const pack = currentPack;
        if (!pack) return;
        console.log("[sort-flow] sort", { cardId, bucketId, packKey: pack.packKey, packId: pack.packId });
        pushUndo({ action: "sort", cardId, bucket: bucketId, pack });
        markResolved(pack.packKey, [cardId]);
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
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/sort`, {
                method: "POST",
                headers: authHeaders,
                credentials: "include",
                body: JSON.stringify({ cardId, bucket: bucketId, language, packId: pack.packId, lastInPack }),
            });
            if (!response.ok) throw new Error(`sort failed: ${response.status}`);
            await response.json();
            // Only request the replacement pack once the server has recorded this sort
            // (and, for a pack-completing sort, marked the pack seen) — requesting it
            // any earlier lets /next-pack race ahead and re-serve the completing pack.
            if (lastInPack) advancePack(pack.packKey);
        } catch (error) {
            console.error("Error sorting card:", error);
        }
    }, [currentPack, pushUndo, markResolved, isPackComplete, selectedLevel, applyPackSignal, advancePack, authHeaders, language]);

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
            const response = await fetch(`${API_BASE_URL}/api/starter-packs/skip-pack`, {
                method: "POST",
                headers: authHeaders,
                credentials: "include",
                body: JSON.stringify({ cardIds: toSkip.map((c) => c.id), language, packId: pack.packId }),
            });
            if (!response.ok) throw new Error(`skip-pack failed: ${response.status}`);
            // Only now that the server has recorded the skip is it safe to request the
            // replacement pack — same race as handleSortCard's advancePack call.
            advancePack(pack.packKey);
        } catch (error) {
            console.error("Error skipping pack:", error);
        }
    }, [currentPack, isResolved, pushUndo, markResolved, advancePack, authHeaders, language]);

    // Undo the most recent card action (sort or skip). Un-resolves the card and, if its
    // pack has advanced off-deck, brings the pack back on deck.
    const handleUndo = useCallback(async () => {
        const entry = undoStack[undoStack.length - 1];
        if (!entry) return;
        setUndoStack((prev) => prev.slice(0, -1));

        unmarkResolved(entry.pack.packKey, entry.cardId);
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
            await fetch(`${API_BASE_URL}/api/starter-packs/undo`, {
                method: "POST",
                headers: authHeaders,
                credentials: "include",
                body: JSON.stringify({ cardId: entry.cardId, bucket: entry.bucket, language, packId: entry.pack.packId }),
            });
        } catch (error) {
            console.error("Error undoing action:", error);
        }
    }, [undoStack, unmarkResolved, authHeaders, language]);

    if (loading) {
        return (
            <NodePage title="Sort Cards" activePage="discover" onBack={() => navigate("/discover")} scrollable={false} headerExtraActions={<MinutePointsFireBadge />}>
                <Box className="sort-cards__loading-wrapper" sx={{ display: "flex", flex: 1, justifyContent: "center", alignItems: "center" }}>
                    <DelayedCircularProgress className="sort-cards__spinner" />
                </Box>
            </NodePage>
        );
    }

    if (!currentPack) {
        return (
            <NodePage title="Sort Cards" activePage="discover" onBack={() => navigate("/discover")} scrollable={false} headerExtraActions={<MinutePointsFireBadge />}>
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
            activePage="discover"
            onBack={() => navigate("/discover")}
            scrollable={false}
            headerExtraActions={
                <>
                    <Button
                        className="sort-cards__autoplay-toggle"
                        variant={discoverSettings.autoplay ? "contained" : "text"}
                        size="small"
                        onClick={() => updateDiscoverSettings({ autoplay: !discoverSettings.autoplay })}
                        aria-pressed={discoverSettings.autoplay}
                        sx={{
                            minWidth: "unset", px: 1, py: 0.25, height: "30px",
                            fontSize: SIZE.micro, textTransform: "lowercase", lineHeight: LEADING.normal,
                            borderRadius: "6px", color: COLORS.onSurface,
                            backgroundColor: discoverSettings.autoplay ? COLORS.card : "transparent",
                            "&:hover": { backgroundColor: discoverSettings.autoplay ? COLORS.card : "transparent" },
                        }}
                    >
                        autoplay
                    </Button>
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
                    <MinutePointsFireBadge />
                </>
            }
        >
            <Box
                className="sort-cards__level-bar"
                sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 40, px: 2, py: 0.5 }}
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
                            backgroundColor: COLORS.hskChip, color: "white", fontSize: SIZE.micro, fontWeight: WEIGHT.bold,
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
                                        {/* Mirrors the live slot's speaker-button footer height. */}
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
                                        register meter (vernacularScore, 1 = literary … 5 =
                                        natural colloquial) + an x/5 readout. Lives on the
                                        platform, not the card, so it stays put while the
                                        card is dragged into a bucket. */}
                                    <CardDeckHeader className="sort-cards__card-deck-header">
                                        {card.vernacularScore != null && (
                                            <>
                                                {isMiddleCard && (
                                                    <CommonalityLabel className="sort-cards__commonality-label">
                                                        Commonality
                                                    </CommonalityLabel>
                                                )}
                                                <CommonalityMeterRow className="sort-cards__commonality-meter">
                                                    <VernacularScoreDots
                                                        className="sort-cards__card-vernacular-dots"
                                                        score={card.vernacularScore}
                                                        dotSize={7}
                                                        gap={3}
                                                    />
                                                    <CommonalityScoreValue className="sort-cards__commonality-value">
                                                        {card.vernacularScore}/5
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
                                    {/* Play-audio button below the card (docs §4.5). */}
                                    <SpeakerButton
                                        onClick={() => handlePlayCardAudio(card)}
                                        isLoading={tts.speakingKey === card.entryKey}
                                    />
                                </CardSlot>
                            );
                        })}
                    </CardsRow>
                </OnDeckSection>
            </ContentArea>
        </NodePage>
    );
};

export default SortCardsPage;
