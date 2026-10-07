import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Box } from "@mui/material";
import { useDragScroll } from "../../../hooks/useDragScroll";
import GameCard, { type GameCardData } from "../../../games/shared/GameCard";
import { COLORS } from "../../../theme/colors";

/**
 * GamesBelt — a Center's games belt: a swipeable, looping row of 300px `GameCard`s with
 * page dots (design frames r1 / r2, docs/READING_WRITING_CENTERS.md § Phase 1). The
 * Center decides WHICH cards and what each launches; this owns only the belt.
 *
 * Extracted from ReadingGamesCarousel (2026-10-06) when the Writing Center grew a second
 * card (the Writing Notebook) and needed the same belt.
 *
 * ── The loop ──────────────────────────────────────────────────────────────────
 * The design's carousel wraps: it renders the cards three times, parks the scroller on
 * the middle copy, and after each swipe settles silently jumps back by one copy-width
 * when it has drifted into an outer copy. Snap points make the jump invisible (it lands
 * on the identical card). The dots read `index % count`.
 *
 * ── No momentum ───────────────────────────────────────────────────────────────
 * The belt moves one card per swipe, however big the swipe. Touch flings are held by
 * `scroll-snap-stop: always` on every card (the browser may not coast past a snap
 * point); mouse drags by `useDragScroll`'s paged mode, which caps a drag at one page.
 *
 * ── Desktop drag ──────────────────────────────────────────────────────────────
 * Mouse click-and-drag pans the track via `useDragScroll` in paged mode, one page per
 * card step, so a release settles on the neighbouring card the way a touch swipe snaps
 * to one. While that drag is in flight the hook parks `scroll-snap-type` at "none"; the
 * loop's re-centre waits it out, because jumping `scrollLeft` mid-drag would fight the
 * hook's `startScrollLeft - delta` arithmetic.
 *
 * Used by: ReadingGamesCarousel, WritingGamesCarousel.
 * Layer: feature component (src/features/flashcards/centers).
 */

/** The design's `.gc` width and the row's gap / side gutter. */
const CARD_WIDTH = 300;
const CARD_GAP = 10;
const SIDE_GUTTER = 22;
/** How long the scroller must be still before the loop re-centres it. */
const SETTLE_MS = 120;

interface GamesBeltProps {
    cards: GameCardData[];
    /** Class-name root (`reading-games-carousel`, `writing-games-carousel`). */
    classPrefix: string;
    className?: string;
    /** Open parked on this card (returning from it) instead of the first. */
    focusGameId?: string | null;
    /** Belt-level extras rendered after the dots (e.g. Word Search's confirm dialog). */
    children?: ReactNode;
}

export default function GamesBelt({ cards, classPrefix, className, focusGameId, children }: GamesBeltProps) {
    // ── Looping scroller ────────────────────────────────────────────────────────
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const count = cards.length;
    // The card to open on: the game just returned from, else the first. Read once —
    // after mount the learner owns the position.
    const [focusIndex] = useState(() => Math.max(0, cards.findIndex((c) => c.gameId === focusGameId)));
    const [activeDot, setActiveDot] = useState(focusIndex);
    // One card never loops — there is nothing to wrap to.
    const copies = count > 1 ? 3 : 1;
    const step = CARD_WIDTH + CARD_GAP;
    const copyWidth = step * count;

    // Desktop click-and-drag (touch already pans natively). See "Desktop drag" above.
    useDragScroll(scrollRef, { paged: true, pageWidth: step });

    // Park on the middle copy before first paint, so the first swipe can go either way —
    // on the focused card's snap point within it (`focusIndex`; snap points are one
    // `step` apart from the copy's start). A lone card has no copies to centre in.
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const index = Math.min(focusIndex, Math.max(0, count - 1));
        el.scrollLeft = (copies === 3 ? copyWidth : 0) + index * step;
    }, [copies, copyWidth, count, step, focusIndex]);

    const settleTimer = useRef<number | null>(null);
    useEffect(() => () => { if (settleTimer.current) window.clearTimeout(settleTimer.current); }, []);

    const handleScroll = () => {
        const el = scrollRef.current;
        if (!el || count === 0) return;
        setActiveDot(((Math.round(el.scrollLeft / step) % count) + count) % count);
        if (copies !== 3) return;
        if (settleTimer.current) window.clearTimeout(settleTimer.current);
        // Once the swipe has settled, jump back into the middle copy if it drifted into
        // an outer one. The jump lands on the identical card, so it is invisible.
        const recentre = () => {
            // A mouse drag (or its release scroll) is still in flight — try again later.
            if (el.style.scrollSnapType === "none") {
                settleTimer.current = window.setTimeout(recentre, SETTLE_MS);
                return;
            }
            if (el.scrollLeft < copyWidth * 0.5) el.scrollLeft += copyWidth;
            else if (el.scrollLeft >= copyWidth * 1.5) el.scrollLeft -= copyWidth;
        };
        settleTimer.current = window.setTimeout(recentre, SETTLE_MS);
    };

    if (count === 0) return null;

    return (
        <Box className={`${classPrefix}${className ? ` ${className}` : ""}`} sx={{ alignSelf: "stretch", marginTop: "16px" }}>
            <Box
                ref={scrollRef}
                className={`${classPrefix}__track`}
                onScroll={handleScroll}
                sx={{
                    display: "flex",
                    gap: `${CARD_GAP}px`,
                    overflowX: "auto",
                    scrollSnapType: "x mandatory",
                    padding: `0 ${SIDE_GUTTER}px 4px`,
                    scrollPadding: `0 ${SIDE_GUTTER}px`,
                    scrollbarWidth: "none",
                    "&::-webkit-scrollbar": { display: "none" },
                    // Sideways scroller inside a vertically-scrolling page: both pans are
                    // opt-in here (CLAUDE.md "Touch & Scroll"); the page passes
                    // `horizontalPan` so its scroll area does not cap this.
                    touchAction: "pan-x pan-y",
                }}
            >
                {Array.from({ length: copies }, (_, copy) =>
                    cards.map((card) => (
                        <GameCard
                            key={`${copy}-${card.gameId}`}
                            card={card}
                            classPrefix={classPrefix}
                            sx={{
                                flex: `0 0 ${CARD_WIDTH}px`,
                                scrollSnapAlign: "start",
                                // No momentum: a fling, however hard, stops at the very next
                                // card rather than coasting past several (see "No momentum"
                                // in the header comment).
                                scrollSnapStop: "always",
                            }}
                        />
                    ))
                )}
            </Box>

            {count > 1 && (
                <Box className={`${classPrefix}__dots`} sx={{ display: "flex", justifyContent: "center", gap: "5px", paddingTop: "9px" }}>
                    {cards.map((card, i) => (
                        <Box
                            key={card.gameId}
                            component="i"
                            className={`${classPrefix}__dot${i === activeDot ? ` ${classPrefix}__dot--active` : ""}`}
                            sx={{
                                display: "block",
                                height: 5,
                                width: i === activeDot ? 14 : 5,
                                borderRadius: "3px",
                                backgroundColor: i === activeDot ? COLORS.onSurface : COLORS.border,
                                transition: "width 160ms ease",
                            }}
                        />
                    ))}
                </Box>
            )}

            {children}
        </Box>
    );
}
