import { useRef } from 'react';
import { Box, Typography, type SxProps, type Theme } from '@mui/material';
import useEdgeRubberBand from '../hooks/useEdgeRubberBand';

/**
 * SwipeableTextLine — one line of text that, when it is too long for its box, is SWIPED
 * sideways instead of ellipsized (owner's request 2026-10-29).
 *
 *   • The line is its own horizontal scroller with the scrollbar hidden. Text past either
 *     edge is simply CLIPPED — no fade, no "…" (owner's call 2026-10-29).
 *   • Swiping past either end drags the text a little further against growing resistance
 *     and springs it back on release (`useEdgeRubberBand`), so the learner feels the end.
 *     Native overscroll is off (`overscroll-behavior-x: none`) so iOS's own bounce never
 *     stacks on it, and a swipe that hits the end never chains into a browser back gesture.
 *   • A tap still reaches whatever the line sits in: the browser fires no `click` for a
 *     touch that panned, and one for a touch that did not.
 *
 * ── Alignment (`align`) ───────────────────────────────────────────────────────
 * `end` (the eip header, right-aligned) is done with an auto LEFT MARGIN on the text inside
 * a flex scroller, never with `text-align: right`. Blink lays an overflowing right-aligned
 * line out past the scroller's LEFT edge, and a left-to-right scroller cannot scroll left of
 * 0 — so the start of the text was unreachable and the line showed its END, with nothing
 * to swipe toward and no edge to rubber-band against. An auto margin is "safe" alignment:
 * it pushes the text right while it fits and collapses to 0 once it overflows, so an
 * overflowing line always starts at its first gloss and scrolls toward the end.
 *
 * ⚠️ touch-action: a touch pan only reaches this scroller if the ancestors allow it. On a
 * MobileTabScreen page, pass `horizontalPan` (see the note on its ScrollArea). Inside the eip
 * sheet's upper panel, `pan-x` alone is right: vertical drags belong to the sheet's resize
 * gesture, as for the word trail (EipTabStrip).
 *
 * Layer: shared component (`src/components/`). Used by: components/DictionaryEntryRow.tsx
 * (`swipeGloss`). Its two-line sibling, for the Dictionary eip's header, is
 * components/SwipeableTwoLineText.tsx. Docs: docs/SHELF_REDESIGN.md § 7b ("the gloss swipes").
 */

interface SwipeableTextLineProps {
    text: string;
    className?: string;
    /** Typography for the line (font, size, colour). Overflow/touch/alignment styles are this component's. */
    sx?: SxProps<Theme>;
    /** Where the text sits while it FITS. An overflowing line always starts at its start. */
    align?: 'start' | 'end';
    /** `pan-x pan-y` where a vertical drag should still scroll a page; `pan-x` where another gesture owns vertical. */
    touchAction?: 'pan-x' | 'pan-x pan-y';
}

function SwipeableTextLine({ text, className, sx, align = 'start', touchAction = 'pan-x pan-y' }: SwipeableTextLineProps) {
    const scrollerRef = useRef<HTMLParagraphElement | null>(null);
    // The text inside the scroller — the rubber band translates IT, not the scroller.
    const textRef = useRef<HTMLSpanElement | null>(null);
    useEdgeRubberBand(scrollerRef, textRef, true);

    return (
        <Typography
            ref={scrollerRef}
            className={['swipeable-text-line', className].filter(Boolean).join(' ')}
            sx={[
                ...(Array.isArray(sx) ? sx : [sx]),
                {
                    display: 'flex',
                    whiteSpace: 'nowrap',
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    touchAction,
                    overscrollBehaviorX: 'none',
                    scrollbarWidth: 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                },
            ]}
        >
            <Box
                component="span"
                ref={textRef}
                className="swipeable-text-line__text"
                // flexShrink 0: the text keeps its full width so it overflows (and scrolls)
                // instead of being squeezed. `marginLeft: auto` = safe end-alignment, above.
                sx={{ flexShrink: 0, marginLeft: align === 'end' ? 'auto' : 0 }}
            >
                {text}
            </Box>
        </Typography>
    );
}

export default SwipeableTextLine;
