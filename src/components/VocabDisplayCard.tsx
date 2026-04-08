import React, { useState } from 'react';
import { stripParentheses } from '../utils/definitionUtils';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Divider,
    useMediaQuery,
    useTheme,
    Tabs,
    Tab,
    List,
    ListItem,
    Badge
} from '@mui/material';
import type { VocabEntry, DictionaryEntry } from '../types';

interface VocabDisplayCardProps {
    personalEntry: VocabEntry | null;
    dictionaryEntry: DictionaryEntry | null;
}

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

// Tab panel component
function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;

    return (
        <div
            className="vocab-display-card__tab-panel"
            role="tabpanel"
            hidden={value !== index}
            id={`vocab-tabpanel-${index}`}
            aria-labelledby={`vocab-tab-${index}`}
            {...other}
        >
            {value === index && <Box className="vocab-display-card__tab-content" sx={{ pt: 2 }}>{children}</Box>}
        </div>
    );
}



const VocabDisplayCard: React.FC<VocabDisplayCardProps> = React.memo(({ personalEntry, dictionaryEntry }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [currentTab, setCurrentTab] = useState(0);

    const hasAnyEntry = personalEntry !== null || dictionaryEntry !== null;

    const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
        setCurrentTab(newValue);
    };

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
                    boxShadow: hasAnyEntry ? 6 : 2,
                    border: hasAnyEntry
                        ? `2px solid ${theme.palette.primary.main}`
                        : `1px solid ${theme.palette.divider}`,
                    backgroundColor: theme.palette.background.paper,
                    opacity: hasAnyEntry ? 1 : 0.6,
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
                {/* Tabs - Always visible */}
                <Tabs
                    className="vocab-display-card__tabs"
                    value={currentTab}
                    onChange={handleTabChange}
                    aria-label="vocabulary tabs"
                    sx={{ borderBottom: 1, borderColor: 'divider', px: 2, pt: 1 }}
                >
                    <Tab
                        className="vocab-display-card__personal-tab"
                        label={
                            <Badge badgeContent={personalEntry ? 1 : 0} color="primary">
                                Personal
                            </Badge>
                        }
                        id="vocab-tab-0"
                        aria-controls="vocab-tabpanel-0"
                    />
                    <Tab
                        className="vocab-display-card__dictionary-tab"
                        label={
                            <Badge badgeContent={dictionaryEntry ? 1 : 0} color="secondary">
                                Dictionary
                            </Badge>
                        }
                        id="vocab-tab-1"
                        aria-controls="vocab-tabpanel-1"
                    />
                </Tabs>

                <CardContent className="vocab-display-card__content" sx={{ pb: 2 }}>
                    {/* Personal Entry Tab */}
                    <TabPanel value={currentTab} index={0}>
                        {personalEntry ? (
                            <>
                                <Typography
                                    className="vocab-display-card__personal-key"
                                    variant={isMobile ? "h5" : "h6"}
                                    component="h3"
                                    gutterBottom
                                    sx={{
                                        fontWeight: 'bold',
                                        fontFamily: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
                                    }}
                                >
                                    {personalEntry.entryKey}
                                </Typography>

                                <Divider className="vocab-display-card__personal-divider" sx={{ mb: 1.5 }} />

                                <Typography
                                    className="vocab-display-card__personal-definition"
                                    variant="body1"
                                    color="text.secondary"
                                    sx={{
                                        mb: personalEntry.createdAt ? 1.5 : 0,
                                        lineHeight: 1.6,
                                    }}
                                >
                                    {stripParentheses(personalEntry.entryValue)}
                                </Typography>

                                {personalEntry.createdAt && (
                                    <>
                                        <Divider className="vocab-display-card__personal-date-divider" sx={{ mb: 1 }} />
                                        <Typography
                                            className="vocab-display-card__personal-date"
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{
                                                display: 'block',
                                                textAlign: 'right',
                                            }}
                                        >
                                            Added: {new Date(personalEntry.createdAt).toLocaleDateString()}
                                        </Typography>
                                    </>
                                )}
                            </>
                        ) : (
                            <Typography className="vocab-display-card__no-personal-entry" variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                                No personal vocabulary entry found.
                            </Typography>
                        )}
                    </TabPanel>

                    {/* Dictionary Entry Tab */}
                    <TabPanel value={currentTab} index={1}>
                        {dictionaryEntry ? (
                            <Box className="vocab-display-card__dict-scroll" sx={{ maxHeight: 400, overflow: 'auto' }}>
                                <Typography
                                    className="vocab-display-card__dict-word"
                                    variant={isMobile ? "h5" : "h6"}
                                    component="h3"
                                    gutterBottom
                                    sx={{
                                        fontWeight: 'bold',
                                        fontFamily: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
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

                                <Typography className="vocab-display-card__dict-label" variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                                    Definitions:
                                </Typography>

                                <List className="vocab-display-card__dict-list" dense sx={{ pt: 0 }}>
                                    {dictionaryEntry.definitions.map((definition, index) => (
                                        <ListItem className="vocab-display-card__dict-item" key={index} sx={{ pl: 0, py: 0.5 }}>
                                            <Typography className="vocab-display-card__dict-definition" variant="body2" color="text.secondary">
                                                {index + 1}. {stripParentheses(definition)}
                                            </Typography>
                                        </ListItem>
                                    ))}
                                </List>
                            </Box>
                        ) : (
                            <Typography className="vocab-display-card__no-dict-entry" variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                                No dictionary entry found.
                            </Typography>
                        )}
                    </TabPanel>
                </CardContent>
            </Card>
        </Box>
    );
}, (prevProps, nextProps) => {
    // Custom comparison for memoization
    const prevPersonal = prevProps.personalEntry;
    const nextPersonal = nextProps.personalEntry;
    const prevDict = prevProps.dictionaryEntry;
    const nextDict = nextProps.dictionaryEntry;

    // Check personal entry
    const personalUnchanged =
        (prevPersonal === null && nextPersonal === null) ||
        (prevPersonal !== null && nextPersonal !== null &&
            prevPersonal.id === nextPersonal.id &&
            prevPersonal.entryKey === nextPersonal.entryKey &&
            prevPersonal.entryValue === nextPersonal.entryValue);

    // Check dictionary entry
    const dictUnchanged =
        (prevDict === null && nextDict === null) ||
        (prevDict !== null && nextDict !== null &&
            prevDict.id === nextDict.id &&
            prevDict.word1 === nextDict.word1);

    return personalUnchanged && dictUnchanged;
});

VocabDisplayCard.displayName = 'VocabDisplayCard';

export default VocabDisplayCard;
