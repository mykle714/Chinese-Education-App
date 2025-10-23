import React, { useState } from 'react';
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
import type { VocabEntry, DictionaryEntry, HskLevel } from '../types';

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
            role="tabpanel"
            hidden={value !== index}
            id={`vocab-tabpanel-${index}`}
            aria-labelledby={`vocab-tab-${index}`}
            {...other}
        >
            {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
        </div>
    );
}

// Helper function to get HSK level number
const getHskNumber = (hskLevel: HskLevel) => {
    switch (hskLevel) {
        case 'HSK1': return '1';
        case 'HSK2': return '2';
        case 'HSK3': return '3';
        case 'HSK4': return '4';
        case 'HSK5': return '5';
        case 'HSK6': return '6';
        default: return '1';
    }
};

// Helper function to render tag badges for personal entries
const renderTags = (entry: VocabEntry) => (
    <Box sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 0.5 }}>
        {entry.hskLevelTag && (
            <Box
                sx={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: 'secondary.main',
                    color: 'secondary.contrastText',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 'bold'
                }}
            >
                {getHskNumber(entry.hskLevelTag)}
            </Box>
        )}
    </Box>
);

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
            sx={{
                width: isMobile ? '100%' : 320,
                mb: isMobile ? 2 : 0,
            }}
        >
            <Card
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
                    value={currentTab}
                    onChange={handleTabChange}
                    aria-label="vocabulary tabs"
                    sx={{ borderBottom: 1, borderColor: 'divider', px: 2, pt: 1 }}
                >
                    <Tab
                        label={
                            <Badge badgeContent={personalEntry ? 1 : 0} color="primary">
                                Personal
                            </Badge>
                        }
                        id="vocab-tab-0"
                        aria-controls="vocab-tabpanel-0"
                    />
                    <Tab
                        label={
                            <Badge badgeContent={dictionaryEntry ? 1 : 0} color="secondary">
                                Dictionary
                            </Badge>
                        }
                        id="vocab-tab-1"
                        aria-controls="vocab-tabpanel-1"
                    />
                </Tabs>

                <CardContent sx={{ pb: 2 }}>
                    {/* Personal Entry Tab */}
                    <TabPanel value={currentTab} index={0}>
                        {personalEntry ? (
                            <>
                                {personalEntry.hskLevelTag && renderTags(personalEntry)}
                                <Typography
                                    variant={isMobile ? "h5" : "h6"}
                                    component="h3"
                                    gutterBottom
                                    sx={{
                                        fontWeight: 'bold',
                                        pr: personalEntry.hskLevelTag ? 6 : 0,
                                        fontFamily: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
                                    }}
                                >
                                    {personalEntry.entryKey}
                                </Typography>

                                <Divider sx={{ mb: 1.5 }} />

                                <Typography
                                    variant="body1"
                                    color="text.secondary"
                                    sx={{
                                        mb: personalEntry.createdAt ? 1.5 : 0,
                                        lineHeight: 1.6,
                                    }}
                                >
                                    {personalEntry.entryValue}
                                </Typography>

                                {personalEntry.createdAt && (
                                    <>
                                        <Divider sx={{ mb: 1 }} />
                                        <Typography
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
                            <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                                No personal vocabulary entry found.
                            </Typography>
                        )}
                    </TabPanel>

                    {/* Dictionary Entry Tab */}
                    <TabPanel value={currentTab} index={1}>
                        {dictionaryEntry ? (
                            <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                                <Typography
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
                                    variant="body2"
                                    color="text.secondary"
                                    sx={{ mb: 1.5, fontStyle: 'italic' }}
                                >
                                    {dictionaryEntry.pronunciation}
                                </Typography>

                                <Divider sx={{ mb: 1.5 }} />

                                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                                    Definitions:
                                </Typography>

                                <List dense sx={{ pt: 0 }}>
                                    {dictionaryEntry.definitions.map((definition, index) => (
                                        <ListItem key={index} sx={{ pl: 0, py: 0.5 }}>
                                            <Typography variant="body2" color="text.secondary">
                                                {index + 1}. {definition}
                                            </Typography>
                                        </ListItem>
                                    ))}
                                </List>
                            </Box>
                        ) : (
                            <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
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
