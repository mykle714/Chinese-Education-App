import { Card, CardContent, Typography } from '@mui/material';
import type { DictionaryEntry } from '../types';
import { stripParentheses } from '../utils/definitionUtils';

interface DictionaryEntryRowProps {
    entry: DictionaryEntry;
    onClick: (entry: DictionaryEntry) => void;
}

/**
 * Compact dictionary entry row component
 * Displays word, pronunciation, and first definition
 * Clickable to open detail modal
 */
function DictionaryEntryRow({ entry, onClick }: DictionaryEntryRowProps) {
    const firstDefinition = entry.definitions && entry.definitions.length > 0
        ? stripParentheses(entry.definitions[0])
        : 'No definition available';

    return (
        <Card
            className="dictionary-entry-row"
            sx={{
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: 4,
                    borderColor: 'primary.main',
                },
                border: '1px solid',
                borderColor: 'divider',
                height: '100%',
            }}
            onClick={() => onClick(entry)}
        >
            <CardContent className="dictionary-entry-row__content">
                <Typography
                    className="dictionary-entry-row__word"
                    variant="h6"
                    component="h3"
                    gutterBottom
                    sx={{
                        fontWeight: 'bold',
                        fontFamily: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
                        fontSize: '1.25rem',
                    }}
                >
                    {entry.word1}
                </Typography>

                {entry.pronunciation && (
                    <Typography
                        className="dictionary-entry-row__pronunciation"
                        variant="body2"
                        color="text.secondary"
                        sx={{
                            fontStyle: 'italic',
                            mb: 1,
                        }}
                    >
                        {entry.pronunciation}
                    </Typography>
                )}

                <Typography
                    className="dictionary-entry-row__definition"
                    variant="body2"
                    color="text.primary"
                    sx={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                    }}
                >
                    {firstDefinition}
                </Typography>
            </CardContent>
        </Card>
    );
}

export default DictionaryEntryRow;
