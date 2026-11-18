/**
 * DictionarySearchHistoryPanel — the Dictionary's recent-queries list, slid in from the
 * right over the results when the search field's history icon is tapped.
 *
 * Drawn in the page's own vocabulary so it reads as a mode of the search, not a new
 * surface: a lowercase slab label ("recent searches") with a quiet "Clear all" on its
 * right, then one result slab (DictionaryResultSlab) of rows. Each row is two tap
 * targets — the query (re-runs it) and a trailing ✕ (forgets it). The ✕ is a sibling
 * button, not nested inside the row's button, so its tap never also re-runs the query.
 *
 * LAYER: client feature, presentational. No storage access — DictionaryPage owns the
 * list (useDictionarySearchHistory) and the open/closed slide.
 *
 * Depended on by: docs/SHELF_REDESIGN.md § 7c "Search history".
 */
import { Box, ButtonBase, Typography } from '@mui/material';
import Icon from '../../components/Icon';
import { SIZE, WEIGHT } from '../../theme';
import type { Tier2Look } from '../../timeOfDay/tier2Look';
import { DictionaryResultSlab, DictionarySlabLabel } from './DictionaryPageParts';
import type { DictionaryHistoryEntry } from './dictionarySearchHistory';

interface Props {
    entries: DictionaryHistoryEntry[];
    look: Tier2Look;
    onSelect: (query: string) => void;
    onRemove: (query: string) => void;
    onClearAll: () => void;
}

export default function DictionarySearchHistoryPanel({ entries, look, onSelect, onRemove, onClearAll }: Props) {
    return (
        <Box className="dictionary-history" role="region" aria-label="Recent searches">
            <Box className="dictionary-history__header" sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <DictionarySlabLabel className="dictionary-history__label" look={look} first>
                    recent searches
                </DictionarySlabLabel>
                {entries.length > 0 && (
                    <ButtonBase
                        className="dictionary-history__clear-all"
                        onClick={onClearAll}
                        sx={{
                            m: '0 4px 10px',
                            px: 1,
                            py: 0.25,
                            borderRadius: '8px',
                            color: look.muted,
                            fontSize: SIZE.body,
                            fontWeight: WEIGHT.medium,
                            '&:active': { backgroundColor: look.pressed },
                        }}
                    >
                        Clear all
                    </ButtonBase>
                )}
            </Box>

            {entries.length === 0 ? (
                <Typography
                    className="dictionary-history__empty"
                    variant="body2"
                    sx={{ color: look.muted, textAlign: 'center', py: 6 }}
                >
                    No recent searches yet.
                </Typography>
            ) : (
                <DictionaryResultSlab className="dictionary-history__list" look={look}>
                    {entries.map(({ query }) => (
                        <Box
                            key={query}
                            className="dictionary-history__row"
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                minHeight: 52,
                                // Same rule as the result rows: hairline on top of every row but
                                // the first, so the slab's rounded bottom is never crossed.
                                borderTop: `1px solid ${look.line}`,
                                '&:first-of-type': { borderTop: 'none' },
                            }}
                        >
                            <ButtonBase
                                className="dictionary-history__query"
                                onClick={() => onSelect(query)}
                                sx={{
                                    flex: 1,
                                    minWidth: 0,
                                    alignSelf: 'stretch',
                                    justifyContent: 'flex-start',
                                    gap: '12px',
                                    pl: 2,
                                    pr: 1,
                                    color: look.ink,
                                    textAlign: 'left',
                                    '&:active': { backgroundColor: look.pressed },
                                    '@media (hover: hover)': { '&:hover': { backgroundColor: look.pressed } },
                                }}
                            >
                                <Icon name="history" size={20} color={look.muted} className="dictionary-history__row-icon" />
                                <Typography
                                    className="dictionary-history__query-text"
                                    component="span"
                                    sx={{ fontSize: '17px', color: look.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                >
                                    {query}
                                </Typography>
                            </ButtonBase>
                            <ButtonBase
                                className="dictionary-history__remove"
                                aria-label={`Remove “${query}” from history`}
                                onClick={() => onRemove(query)}
                                sx={{
                                    width: 48,
                                    alignSelf: 'stretch',
                                    flexShrink: 0,
                                    '&:active': { backgroundColor: look.pressed },
                                }}
                            >
                                <Icon name="close" size={18} color={look.muted} />
                            </ButtonBase>
                        </Box>
                    ))}
                </DictionaryResultSlab>
            )}
        </Box>
    );
}
