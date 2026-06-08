import React from 'react';
import { stripParentheses } from '../utils/definitionUtils';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Divider,
    useMediaQuery,
    useTheme,
    List,
    ListItem,
} from '@mui/material';
import type { DictionaryEntry } from '../types';
import { FONTS } from '../theme/fonts';
import { WEIGHT } from '../theme/scale';

interface VocabDisplayCardProps {
    dictionaryEntry: DictionaryEntry | null;
}

const FIXED_CARD_HEIGHT = 210;

const VocabDisplayCard: React.FC<VocabDisplayCardProps> = React.memo(({ dictionaryEntry }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const hasEntry = dictionaryEntry !== null;

    return (
        <Box
            className="vocab-display-card__wrapper"
            sx={{
                width: isMobile ? '100%' : 320,
                mb: isMobile ? 2 : 0,
            }}
        >
            <Card
                className="vocab-display-card__card"
                sx={{
                    position: 'relative',
                    height: FIXED_CARD_HEIGHT,
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: hasEntry ? 6 : 2,
                    border: hasEntry
                        ? `2px solid ${theme.palette.primary.main}`
                        : `1px solid ${theme.palette.divider}`,
                    backgroundColor: theme.palette.background.paper,
                    opacity: hasEntry ? 1 : 0.6,
                    ...(isMobile ? {
                        borderRadius: 0,
                        borderTop: 'none',
                        borderLeft: 'none',
                        borderRight: 'none',
                    } : {
                        borderRadius: 2,
                    }),
                }}
            >
                <CardContent
                    className="vocab-display-card__content"
                    sx={{
                        flexGrow: 1,
                        minHeight: 0,
                        overflowY: 'auto',
                        pb: 0,
                        '&:last-child': { pb: 0 },
                    }}
                >
                    {dictionaryEntry ? (
                        <>
                            <Typography
                                className="vocab-display-card__dict-word"
                                variant={isMobile ? "h5" : "h6"}
                                component="h3"
                                gutterBottom
                                sx={{
                                    fontWeight: WEIGHT.bold,
                                    fontFamily: FONTS.cjk,
                                }}
                            >
                                {dictionaryEntry.word1}
                            </Typography>

                            <Typography
                                className="vocab-display-card__dict-pronunciation"
                                variant="body2"
                                color="text.secondary"
                                sx={{ mb: 1.5, fontStyle: 'italic' }}
                            >
                                {dictionaryEntry.pronunciation}
                            </Typography>

                            <Divider className="vocab-display-card__dict-divider" sx={{ mb: 1.5 }} />

                            <Typography className="vocab-display-card__dict-label" variant="subtitle2" sx={{ mb: 1, fontWeight: WEIGHT.bold }}>
                                Definitions:
                            </Typography>

                            <List className="vocab-display-card__dict-list" dense sx={{ p: 0 }}>
                                {dictionaryEntry.definitions.map((definition, index) => (
                                    <ListItem className="vocab-display-card__dict-item" key={index} sx={{ pl: 0, py: 0.5 }}>
                                        <Typography className="vocab-display-card__dict-definition" variant="body2" color="text.secondary">
                                            {index + 1}. {stripParentheses(definition)}
                                        </Typography>
                                    </ListItem>
                                ))}
                            </List>
                        </>
                    ) : (
                        <Typography className="vocab-display-card__no-dict-entry" variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                            No dictionary entry found.
                        </Typography>
                    )}
                </CardContent>
            </Card>
        </Box>
    );
}, (prevProps, nextProps) => {
    const prevDict = prevProps.dictionaryEntry;
    const nextDict = nextProps.dictionaryEntry;

    return (prevDict === null && nextDict === null) ||
        (prevDict !== null && nextDict !== null &&
            prevDict.id === nextDict.id &&
            prevDict.word1 === nextDict.word1);
});

VocabDisplayCard.displayName = 'VocabDisplayCard';

export default VocabDisplayCard;
