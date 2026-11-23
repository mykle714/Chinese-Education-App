/**
 * DictionaryPageParts — the Dictionary page's presentational pieces from the
 * 2026-10-29 redesign (Claude Design project "Tower Tier 2 - Time of Day",
 * artboards "Dictionary · search + results" and "Dictionary · no results").
 *
 * LAYER: client feature, presentational. No data access — DictionaryPage owns the
 * search state (useDictionarySearch) and hands these pieces what to show.
 *
 * Split out of DictionaryPage.tsx to keep that file about state and flow; nothing
 * here is used outside the Dictionary page. The result slab, its group labels and the
 * infinite-scroll tail moved to src/components/dictionarySearch/DictionaryResultParts.tsx
 * on 2026-11-21, when the mini dictionary search (DictionaryWordSearch) adopted them.
 *
 * Every piece takes the page's time-of-day `look` (src/timeOfDay/tier2Look.ts → useTier2Look,
 * called once in DictionaryPage): white surfaces on a tinted ground by day, slate at night.
 *
 * Depended on by: docs/SHELF_REDESIGN.md § Part B entry 7 (Dictionary).
 */
import { Box } from '@mui/material';
import Icon from '../../components/Icon';
import { DictionaryNoResultsWell } from '../../components/dictionarySearch/DictionaryResultParts';
import { COLORS, FONTS, SIZE, WEIGHT } from '../../theme';
import type { Tier2Look } from '../../timeOfDay/tier2Look';
import { keycapPressSx } from '../../theme/keycapPress';
import { roundedEdgeFilletDown, roundedEdgeRimLightTop } from '../../theme/roundedEdge';

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
                    // The outline ring, the hairline rounded edge just inside it (theme/roundedEdge.ts,
                    // straight-lip form), then the lip.
                    restShadow: `inset 0 0 0 1px ${look.outline}, ${roundedEdgeRimLightTop(look.surface, 1)}, ${roundedEdgeFilletDown(look.surface, look.surfaceEdge)}, 0 ${KEYCAP_LIP}px 0 ${look.surfaceEdge}`,
                    pressedShadow: `inset 0 0 0 1px ${look.outline}, ${roundedEdgeRimLightTop(look.surface, 1)}`,
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
 * `.empty` — the no-results state: the RECESSED well (DictionaryNoResultsWell, shared
 * with the mini search), followed by the wide "Ask AI" keycap when the query can be asked.
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
            {/* The recessed well is shared with the mini search (DictionaryResultParts). */}
            <DictionaryNoResultsWell className="dictionary-page__no-results-well" term={term} look={look} />
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
