import { useState, useEffect } from 'react';
import { Box, Typography, Paper, CircularProgress, Alert } from '@mui/material';
import ReactMarkdown from 'react-markdown';

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
                    <CircularProgress />
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
            <Typography variant="h6" gutterBottom sx={{ mb: 2, fontWeight: 'bold' }}>
                📋 Changelog
            </Typography>
            <Box sx={{
                maxHeight: 400,
                overflowY: 'auto',
                '& h1': { fontSize: '1.1rem', fontWeight: 'bold', mb: 2 },
                '& h2': { fontSize: '0.95rem', fontWeight: 'bold', mb: 1.5, mt: 2 },
                '& h3': { fontSize: '0.85rem', fontWeight: 'bold', mb: 1, mt: 1.5 },
                '& p': { fontSize: '0.8rem', mb: 1, lineHeight: 1.6 },
                '& ul': { mb: 1.5, pl: 2 },
                '& li': { fontSize: '0.8rem', mb: 0.5 },
                '& code': {
                    backgroundColor: 'rgba(0, 0, 0, 0.04)',
                    padding: '2px 4px',
                    borderRadius: '3px',
                    fontFamily: 'monospace'
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
