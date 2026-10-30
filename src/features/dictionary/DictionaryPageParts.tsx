/**
 * DictionaryPageParts — the Dictionary page's presentational pieces from the
 * 2026-10-29 redesign (Claude Design project "Tower Tier 2 - Time of Day",
 * artboards "Dictionary · search + results" and "Dictionary · no results").
 *
 * LAYER: client feature, presentational. No data access — DictionaryPage owns the
 * search state (useDictionarySearch) and hands these pieces what to show.
 *
 * Split out of DictionaryPage.tsx to keep that file about state and flow; nothing
 * here is used outside the Dictionary page.
 *
 * Every piece takes the page's time-of-day `look` (src/timeOfDay/tier2Look.ts → useTier2Look,
 * called once in DictionaryPage): white surfaces on a tinted ground by day, slate at night.
 *
 * Depended on by: docs/SHELF_REDESIGN.md § Part B entry 7 (Dictionary).
 */
import { useEffect, useRef } from 'react';
import { Box, keyframes } from '@mui/material';
import Icon from '../../components/Icon';
import { Label } from '../../components/primitives/Label';
import { COLORS, FONTS, SIZE, WEIGHT } from '../../theme';
import type { Tier2Look } from '../../timeOfDay/tier2Look';
import { keycapPressSx } from '../../theme/keycapPress';

/** The raised keycap's bottom lip — artboard `.kc` (`box-shadow: 0 4px 0 var(--edge)`). */
const KEYCAP_LIP = 4;

/**
 * `.kc` — the raised keycap button the shelf system uses for small actions (here: the
 * AI pill and the wide "Ask AI" button). Carries the app's 1px outline (CLAUDE.md §
 * Buttons & cards) as an inset ring so it doesn't change the box. By day it is white on
 * a `COLORS.grey` lip (the framework's nearest to the artboard's #E2E2E6); at night slate.
 */
function Keycap({
    className,
    look,
    onClick,
    disabled,
    children,
    sx,
}: {
    className: string;
    look: Tier2Look;
    onClick?: () => void;
    disabled?: boolean;
    children: React.ReactNode;
    sx?: Record<string, unknown>;
}) {
    return (
        <Box
            component="button"
            type="button"
            className={className}
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '7px 12px',
                border: 'none',
                borderRadius: '12px',
                backgroundColor: look.surface,
                fontFamily: FONTS.sans,
                fontSize: SIZE.body,
                fontWeight: WEIGHT.semibold,
                color: look.ink,
                whiteSpace: 'nowrap',
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                // The app's raised-key press: the key snaps down onto its lip while held and
                // snaps back on release, no transition (theme/keycapPress.ts). A disabled
                // <button> never matches :active, so the AI keycap stays put while asking.
                ...keycapPressSx({
                    restShadow: `inset 0 0 0 1px ${look.outline}, 0 ${KEYCAP_LIP}px 0 ${look.surfaceEdge}`,
                    pressedShadow: `inset 0 0 0 1px ${look.outline}`,
                    pressedY: KEYCAP_LIP,
                }),
                ...sx,
            }}
        >
            {children}
        </Box>
    );
}

/**
 * The AI keycap row under the search field — the artboard's `.meta` row minus its result-count
 * overline, which the owner dropped 2026-10-29 (the section labels say what was found). Shown
 * only while the server says the query can be asked (canAskAi); the orange-starred keycap sits
 * at the right edge, where the count's row put it.
 */
export function DictionaryAskAiRow({
    askingAi,
    onAskAi,
    look,
}: {
    askingAi: boolean;
    onAskAi: () => void;
    look: Tier2Look;
}) {
    return (
        <Box
            className="dictionary-page__ask-ai-row"
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minHeight: 32, mx: '4px', mb: '10px' }}
        >
            <Keycap
                className="dictionary-page__ai-keycap"
                look={look}
                onClick={onAskAi}
                disabled={askingAi}
                sx={{ padding: '5px 10px', fontSize: '13px' }}
            >
                <Icon name="auto_awesome" size={16} color={COLORS.aiGenerated} fill={1} />
                AI
            </Keycap>
        </Box>
    );
}

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

/**
 * `.more` — the infinite-scroll tail. Rendered while more pages exist; it calls
 * `onReach` when it scrolls into view (an IntersectionObserver on the page's own
 * scroll container — MobileTabScreen's `.mobile-tab-screen__scroll`, resolved via
 * `closest` so the observer watches the box that actually scrolls).
 *
 * The 300px root margin starts the next fetch before the learner hits the end, so
 * on a normal flick the spinner is rarely seen.
 */
export function DictionaryLoadMore({ onReach, loading, look }: { onReach: () => void; loading: boolean; look: Tier2Look }) {
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    // The latest callback, so the observer is not torn down on every render.
    const onReachRef = useRef(onReach);
    useEffect(() => { onReachRef.current = onReach; }, [onReach]);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        const root = sentinel.closest('.mobile-tab-screen__scroll');
        const observer = new IntersectionObserver(
            (records) => { if (records.some((r) => r.isIntersecting)) onReachRef.current(); },
            { root, rootMargin: '0px 0px 300px 0px' },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, []);

    return (
        <Box
            ref={sentinelRef}
            className="dictionary-page__load-more"
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
 * `.empty` — the no-results state as a RECESSED well (the mirror of a raised
 * keycap: an inset lip on top instead of a lip below), followed by the wide
 * "Ask AI" keycap when the query can be asked.
 *
 * The artboard also lists "Closest matches" between the two; there is no
 * closest-match search on the server yet, so that block is deferred
 * (docs/DEFERRED_WORK.md → "Dictionary closest matches").
 */
export function DictionaryNoResults({
    term,
    showAskAi,
    onAskAi,
    look,
}: {
    term: string;
    showAskAi: boolean;
    onAskAi: () => void;
    look: Tier2Look;
}) {
    return (
        <Box className="dictionary-page__no-results">
            <Box
                className="dictionary-page__no-results-well"
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
                    className="dictionary-page__no-results-title"
                    sx={{ m: 0, fontFamily: FONTS.sans, fontSize: '19px', fontWeight: WEIGHT.semibold, color: look.ink, overflowWrap: 'anywhere' }}
                >
                    Nothing for “{term}”
                </Box>
                <Box
                    component="p"
                    className="dictionary-page__no-results-hint"
                    sx={{ m: 0, fontFamily: FONTS.sans, fontSize: SIZE.body, lineHeight: 1.4, color: look.ink2, textWrap: 'pretty' }}
                >
                    Check the spelling, or search without tone marks.
                </Box>
            </Box>
            {showAskAi && (
                <Keycap
                    className="dictionary-page__ask-ai-wide"
                    look={look}
                    onClick={onAskAi}
                    sx={{ width: '100%', justifyContent: 'center', mt: '18px', padding: '13px', fontSize: '15px' }}
                >
                    <Icon name="auto_awesome" size={18} color={COLORS.aiGenerated} fill={1} />
                    Ask AI about “{term}”
                </Keycap>
            )}
        </Box>
    );
}
