import { useState, useEffect } from 'react';
import { Box, Typography, Paper, Alert } from '@mui/material';
import DelayedCircularProgress from './DelayedCircularProgress';
import ReactMarkdown from 'react-markdown';
import { FONTS } from '../theme/fonts';
import { SIZE, WEIGHT, LEADING } from '../theme/scale';

interface ChangelogData {
    content: string;
}

const ChangelogDisplay = () => {
    const [changelog, setChangelog] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchChangelog = async () => {
            try {
                setLoading(true);
                const response = await fetch('/api/changelog');

                if (!response.ok) {
                    throw new Error(`Failed to fetch changelog: ${response.statusText}`);
                }

                const data: ChangelogData = await response.json();
                setChangelog(data.content);
                setError(null);
            } catch (err) {
                console.error('Error fetching changelog:', err);
                setError(err instanceof Error ? err.message : 'Failed to load changelog');
            } finally {
                setLoading(false);
            }
        };

        fetchChangelog();
    }, []);

    if (loading) {
        return (
            <Paper sx={{ p: 3, mt: 3 }}>
                <Box display="flex" justifyContent="center" alignItems="center" minHeight={200}>
                    <DelayedCircularProgress />
                </Box>
            </Paper>
        );
    }

    if (error) {
        return (
            <Paper sx={{ p: 3, mt: 3 }}>
                <Alert severity="error">
                    <Typography variant="body2">
                        {error}
                    </Typography>
                </Alert>
            </Paper>
        );
    }

    return (
        <Paper sx={{ p: 3, mt: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ mb: 2, fontWeight: WEIGHT.bold }}>
                📋 Changelog
            </Typography>
            <Box sx={{
                maxHeight: 400,
                overflowY: 'auto',
                '& h1': { fontSize: SIZE.subtitle, fontWeight: WEIGHT.bold, mb: 2 },
                '& h2': { fontSize: SIZE.bodyLg, fontWeight: WEIGHT.bold, mb: 1.5, mt: 2 },
                '& h3': { fontSize: SIZE.body, fontWeight: WEIGHT.bold, mb: 1, mt: 1.5 },
                '& p': { fontSize: SIZE.body, mb: 1, lineHeight: LEADING.relaxed },
                '& ul': { mb: 1.5, pl: 2 },
                '& li': { fontSize: SIZE.body, mb: 0.5 },
                '& code': {
                    backgroundColor: 'rgba(0, 0, 0, 0.04)',
                    padding: '2px 4px',
                    borderRadius: '3px',
                    fontFamily: FONTS.mono
                },
                '& a': {
                    color: 'primary.main',
                    textDecoration: 'none',
                    '&:hover': { textDecoration: 'underline' }
                }
            }}>
                <ReactMarkdown>{changelog}</ReactMarkdown>
            </Box>
        </Paper>
    );
};

export default ChangelogDisplay;
