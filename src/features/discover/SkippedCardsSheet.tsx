import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import SheetPanel, { type SheetPanelBodyHandle } from "../../components/sheet/SheetPanel";
import MiniCard from "../../components/MiniCard";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import HoldProgressRing from "../../components/HoldProgressRing";
import { MINI_CARD_WIDTH, MINI_CARD_HEIGHT, MINI_CARD_RADIUS } from "../../components/miniCardFace";
import { useLongPress } from "../../hooks/useLongPress";
import { fetchSkippedCards, recycleSkip, recycleSkips } from "./starterPacksApi";
import { stripParentheses } from "../../utils/definitionUtils";
import type { DiscoverCard, Language } from "../../types";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";

/**
 * SkippedCardsSheet — scp's HIDDEN skipped-cards panel (docs/SORT_CARDS_REQUIREMENTS.md
 * §5.1a). Opened only by holding the Skip button (SortCardsPage); nothing on screen hints
 * that it exists, and it is the ONLY way to reach skipped cards (the old Skipped Cards
 * page and its Discover tile were removed 2026-10-12). It sits over the sort flow, so a
 * learner can pull a skipped word back without leaving scp:
 *
 *   - tap a card        → the eip for that word (the host's `onOpenInfo`, the same opener
 *                         the on-deck cards' info button uses; it stacks above this sheet)
 *   - hold a card       → a progress ring traces the card's outline over RECYCLE_HOLD_MS
 *                         with a "recycling…" label above it; when the ring closes the
 *                         card is recycled (its discover_skips row is cleared) and leaves
 *   - "Recycle all"     → every skipped card back to the supply at once
 *
 * Recycled cards are NOT pushed into the current sort session. They rejoin the server's
 * supply and arrive through later fetchNextPack calls, exactly like the sheet's own
 * Recycle all.
 *
 * Mounted only while open (the host unmounts on `onClose`), so each open re-fetches and
 * the list is never stale.
 *
 * Layer: feature component (src/features/discover). Server calls go through
 * starterPacksApi (fetchSkippedCards / recycleSkip / recycleSkips).
 */

// How long a card must be held before it recycles. Shorter than the Skip button's 2s
// hold-to-open: inside the sheet the learner already knows holding is a thing, so this
// hold only has to guard against a stray press, not hide a gesture.
const RECYCLE_HOLD_MS = 1500;
// The recycled card's exit (fade + shrink) before it leaves the list.
const CARD_EXIT_MS = 220;

// MINI_CARD_RADIUS is a CSS string ("8px"); the ring's SVG geometry needs the number.
const MINI_CARD_RADIUS_PX = parseFloat(MINI_CARD_RADIUS);
const cardExit = keyframes({ to: { opacity: 0, transform: "scale(0.85)" } });

interface SkippedCardsSheetProps {
    language: Language;
    onOpenInfo: (card: DiscoverCard) => void;
    onClose: () => void;
}

export default function SkippedCardsSheet({ language, onOpenInfo, onClose }: SkippedCardsSheetProps) {
    const bodyRef = useRef<SheetPanelBodyHandle | null>(null);
    // The body is one element that is both the gesture root and the scroller
    // (the NotebookWordPickerSheet pattern).
    const setBody = useCallback((node: HTMLDivElement | null) => {
        bodyRef.current = { root: node, scroll: node };
    }, []);

    const [cards, setCards] = useState<DiscoverCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Cards whose recycle has fired and are playing their exit; removed on animation end.
    const [leavingIds, setLeavingIds] = useState<Set<number>>(() => new Set());

    const load = useCallback(async () => {
        try {
            setError(null);
            setCards(await fetchSkippedCards(language));
        } catch (err: unknown) {
            console.error("Error fetching skipped cards:", err);
            setError(err instanceof Error ? err.message : "Failed to load skipped cards");
        } finally {
            setLoading(false);
        }
    }, [language]);

    // Keyed on `language` only (via `load`), never on the auth token — see CLAUDE.md
    // "Never reload/reset a page on a silent token refresh".
    useEffect(() => { void load(); }, [load]);

    // Optimistic: the card starts leaving at once. A failed request re-fetches the list
    // instead of guessing where to re-insert the card, so the sheet stays truthful.
    const handleRecycleOne = useCallback((card: DiscoverCard) => {
        setLeavingIds((prev) => new Set(prev).add(card.id));
        recycleSkip(language, card.id).catch((err) => {
            console.error(`Error recycling skipped card "${card.entryKey}":`, err);
            void load();
        });
    }, [language, load]);

    const handleExitDone = useCallback((cardId: number) => {
        setCards((prev) => prev.filter((c) => c.id !== cardId));
        setLeavingIds((prev) => {
            const next = new Set(prev);
            next.delete(cardId);
            return next;
        });
    }, []);

    const handleRecycleAll = useCallback(() => {
        setCards([]);
        setLeavingIds(new Set());
        recycleSkips(language).catch((err) => {
            console.error("Error recycling skips:", err);
            void load();
        });
    }, [language, load]);

    return (
        <SheetPanel onClose={onClose} bodyRef={bodyRef} bodyKey="skipped-cards-sheet" title="Skipped Cards">
            <Box
                ref={setBody}
                className="skipped-cards-sheet"
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    padding: "4px 16px 24px",
                    // `pan-y`, not `none`: SheetPanel leaves scroll gestures to the browser.
                    // A scroll that starts on a card cancels that card's hold (pointercancel).
                    touchAction: "pan-y",
                    overscrollBehavior: "contain",
                }}
            >
                {cards.length > 0 && (
                    <Box className="skipped-cards-sheet__actions" sx={{ display: "flex", justifyContent: "flex-end" }}>
                        <Button
                            className="skipped-cards-sheet__recycle-all"
                            variant="text"
                            size="small"
                            onClick={handleRecycleAll}
                            sx={{ fontSize: SIZE.micro, fontWeight: WEIGHT.bold, color: COLORS.infoInk, textTransform: "none" }}
                        >
                            Recycle all
                        </Button>
                    </Box>
                )}

                {loading ? (
                    <Box className="skipped-cards-sheet__loading" sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                        <DelayedCircularProgress size={24} />
                    </Box>
                ) : error ? (
                    <Typography className="skipped-cards-sheet__error" sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, textAlign: "center", py: 4 }}>
                        {error}
                    </Typography>
                ) : cards.length === 0 ? (
                    <Typography className="skipped-cards-sheet__empty" sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary, textAlign: "center", py: 4 }}>
                        No skipped cards.
                    </Typography>
                ) : (
                    <Box
                        className="skipped-cards-sheet__grid"
                        sx={{
                            display: "flex",
                            flexWrap: "wrap",
                            justifyContent: "center",
                            columnGap: "10px",
                            // Row gap leaves room for a card's "recycling…" label, which sits
                            // above the card in the gap rather than over the card above it.
                            rowGap: "26px",
                            // Same headroom for the first row's label.
                            paddingTop: "20px",
                        }}
                    >
                        {cards.map((card) => (
                            <RecyclableSkippedCard
                                key={card.id}
                                card={card}
                                leaving={leavingIds.has(card.id)}
                                onOpenInfo={onOpenInfo}
                                onRecycle={handleRecycleOne}
                                onExitDone={handleExitDone}
                            />
                        ))}
                    </Box>
                )}
            </Box>
        </SheetPanel>
    );
}

// One skipped card. Tap → eip; hold → recycle, with the ring tracing the outline and the
// label above for the length of the hold. Letting go early abandons the hold and the ring
// disappears (it restarts from zero on the next press, since it mounts per press).
function RecyclableSkippedCard({ card, leaving, onOpenInfo, onRecycle, onExitDone }: {
    card: DiscoverCard;
    leaving: boolean;
    onOpenInfo: (card: DiscoverCard) => void;
    onRecycle: (card: DiscoverCard) => void;
    onExitDone: (cardId: number) => void;
}) {
    const { pressing, handlers } = useLongPress({
        delayMs: RECYCLE_HOLD_MS,
        onLongPress: () => onRecycle(card),
        onTap: () => onOpenInfo(card),
        disabled: leaving,
    });
    // The label and the (closed) ring stay up through the exit, so it reads as the card
    // leaving BECAUSE it is being recycled rather than vanishing the moment the ring closes.
    const showHoldUi = pressing || leaving;

    return (
        <Box
            className="skipped-cards-sheet__card"
            {...handlers}
            onAnimationEnd={(e) => { if (leaving && e.target === e.currentTarget) onExitDone(card.id); }}
            sx={{
                position: "relative",
                flex: "none",
                width: MINI_CARD_WIDTH,
                height: MINI_CARD_HEIGHT,
                // No OS callout / text-selection loupe on a long-press.
                WebkitTouchCallout: "none",
                pointerEvents: leaving ? "none" : undefined,
                animation: leaving ? `${cardExit} ${CARD_EXIT_MS}ms ease-in forwards` : undefined,
            }}
        >
            {showHoldUi && (
                <Typography
                    className="skipped-cards-sheet__recycling-label"
                    sx={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: "100%",
                        marginBottom: "4px",
                        textAlign: "center",
                        fontSize: SIZE.micro,
                        lineHeight: LEADING.normal,
                        color: COLORS.textSecondary,
                        whiteSpace: "nowrap",
                    }}
                >
                    recycling…
                </Typography>
            )}
            <MiniCard
                className="skipped-cards-sheet__card-face"
                language={card.language}
                entryKey={card.entryKey}
                pronunciation={card.pronunciation}
                definition={stripParentheses(card.definition ?? "")}
                iconId={card.iconId}
                hoverLift
            />
            {/* The hold timer (HoldProgressRing): a stroke tracing the card's rounded
                outline once over the hold. Mounted only while pressing (so every press
                starts the trace from zero) and kept, closed, through the exit. */}
            {showHoldUi && (
                <HoldProgressRing
                    className="skipped-cards-sheet__recycle-ring"
                    durationMs={RECYCLE_HOLD_MS}
                    radius={MINI_CARD_RADIUS_PX}
                />
            )}
        </Box>
    );
}
