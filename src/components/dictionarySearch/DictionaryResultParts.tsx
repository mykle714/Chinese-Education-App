/**
 * DictionaryResultParts — the presentational pieces of a dictionary RESULT LIST from the
 * 2026-10-29 Dictionary redesign (Claude Design project "Tower Tier 2 - Time of Day",
 * artboard "Dictionary · search + results"): the white result slab, the lowercase group
 * label between slabs, and the infinite-scroll tail.
 *
 * LAYER: shared presentational (src/components/dictionarySearch). No data access — the
 * host owns the search state (useDictionarySearch).
 *
 * Moved here from features/dictionary/DictionaryPageParts.tsx on 2026-11-21, when the mini
 * dictionary search (DictionaryWordSearch — the Compare panel and the Writing Notebook's
 * word picker) adopted the page's result layout. Every piece takes a `look` (Tier2Look):
 * the Dictionary page passes its time-of-day look; the Compare panel a look derived from
 * the eip palette (eipPalette.ts → `eipShelfLook`).
 *
 * Depended on by: DictionarySearchResults.tsx, features/dictionary/DictionarySearchHistoryPanel.tsx.
 * Docs: docs/SHELF_REDESIGN.md § Part B entry 7 (Dictionary); docs/WORD_COMPARE_FEATURE.md § The search.
 */
import { useEffect, useRef } from 'react';
import { Box, keyframes } from '@mui/material';
import Icon from '../Icon';
import { Label } from '../primitives/Label';
import { FONTS, SIZE, WEIGHT } from '../../theme';
import type { Tier2Look } from '../../timeOfDay/tier2Look';

/**
 * `.slab` — dictionary hits grouped on ONE white slab with hairlines between rows,
 * instead of a full-bleed list. Children are `DictionaryEntryRow variant="slab"`,
 * which draw their own between-row rules.
 */
export function DictionaryResultSlab({ className, look, children }: { className: string; look: Tier2Look; children: React.ReactNode }) {
    return (
        <Box
            className={`dictionary-result-slab ${className}`}
            sx={{
                backgroundColor: look.surface,
                borderRadius: '18px',
                // The app's outline (CLAUDE.md § Buttons & cards). The artboard drops it,
                // relying on the tinted ground alone.
                border: `1px solid ${look.outline}`,
                overflow: 'hidden',
            }}
        >
            {children}
        </Box>
    );
}

/**
 * `.sl` — a group label between slabs ("starts with “shí”", a segment's name, a match
 * kind), set in lowercase. `first` drops the top gap for a label directly under the meta row, which already
 * spaces itself.
 */
export function DictionarySlabLabel({
    className,
    look,
    first = false,
    children,
}: {
    className: string;
    look: Tier2Look;
    first?: boolean;
    children: React.ReactNode;
}) {
    return (
        <Box className={className} sx={{ m: first ? '0 4px 10px' : '20px 4px 10px' }}>
            {/* Lowercase, not the overline's usual caps, and at body size rather than the
                overline's 10px — these name the result groups, so they read as section titles
                (owner's calls 2026-10-29). The caps tracking (0.14em) is eased to 0.02em:
                wide letter-spacing is a small-caps device and reads as gappy on lowercase. */}
            <Label
                color={look.muted}
                sx={{ textTransform: 'lowercase', letterSpacing: '0.02em', fontSize: SIZE.body, fontWeight: WEIGHT.medium }}
            >
                {children}
            </Label>
        </Box>
    );
}

const spin = keyframes`to { transform: rotate(360deg); }`;

/** The Dictionary page's scroll container (MobileTabScreen) — the default observer root. */
export const PAGE_SCROLL_ROOT_SELECTOR = '.mobile-tab-screen__scroll';

/**
 * `.more` — the infinite-scroll tail. Rendered while more pages exist; it calls
 * `onReach` when it scrolls into view — an IntersectionObserver whose root is the box
 * that actually scrolls, resolved via `closest(scrollRootSelector)`. The Dictionary page's
 * is MobileTabScreen's `.mobile-tab-screen__scroll` (the default); a mini search inside a
 * sheet passes its own scroller's class. No match → the viewport, which still works for a
 * scroller that fills the screen.
 *
 * The 300px root margin starts the next fetch before the learner hits the end, so
 * on a normal flick the spinner is rarely seen.
 */
export function DictionaryLoadMore({
    onReach,
    loading,
    look,
    scrollRootSelector = PAGE_SCROLL_ROOT_SELECTOR,
}: {
    onReach: () => void;
    loading: boolean;
    look: Tier2Look;
    scrollRootSelector?: string;
}) {
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    // The latest callback, so the observer is not torn down on every render.
    const onReachRef = useRef(onReach);
    useEffect(() => { onReachRef.current = onReach; }, [onReach]);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        const root = sentinel.closest(scrollRootSelector);
        const observer = new IntersectionObserver(
            (records) => { if (records.some((r) => r.isIntersecting)) onReachRef.current(); },
            { root, rootMargin: '0px 0px 300px 0px' },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [scrollRootSelector]);

    return (
        <Box
            ref={sentinelRef}
            className="dictionary-load-more"
            sx={{ display: 'flex', justifyContent: 'center', py: 2 }}
        >
            <Icon
                name="progress_activity"
                size={22}
                color={look.muted}
                aria-label={loading ? 'Loading more results' : undefined}
                sx={{ animation: `${spin} 1s linear infinite` }}
            />
        </Box>
    );
}

/**
 * `.empty`'s well — "Nothing for “term”" as a RECESSED well (the mirror of a raised keycap:
 * an inset lip on top instead of a lip below). The Dictionary page follows it with its wide
 * Ask AI keycap (DictionaryPageParts → DictionaryNoResults); the mini search shows it alone.
 */
export function DictionaryNoResultsWell({ className, term, look }: { className: string; term: string; look: Tier2Look }) {
    return (
        <Box
            className={`dictionary-no-results-well ${className}`}
            sx={{
                mt: '6px',
                padding: '26px 22px',
                borderRadius: '18px',
                // The ground's own well (`--well` / `--wellSh`), tinted with the hour.
                backgroundColor: look.well,
                boxShadow: `inset 0 3px 0 ${look.wellShadow}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
                textAlign: 'center',
            }}
        >
            <Icon name="search_off" size={34} color={look.muted} />
            <Box
                component="h3"
                className="dictionary-no-results-well__title"
                sx={{ m: 0, fontFamily: FONTS.sans, fontSize: '19px', fontWeight: WEIGHT.semibold, color: look.ink, overflowWrap: 'anywhere' }}
            >
                Nothing for “{term}”
            </Box>
            <Box
                component="p"
                className="dictionary-no-results-well__hint"
                sx={{ m: 0, fontFamily: FONTS.sans, fontSize: SIZE.body, lineHeight: 1.4, color: look.ink2, textWrap: 'pretty' }}
            >
                Check the spelling, or search without tone marks.
            </Box>
        </Box>
    );
}
