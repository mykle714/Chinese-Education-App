import { useState } from 'react';
import { stripParentheses } from '../utils/definitionUtils';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    List,
    ListItem,
    Divider,
    Box,
    Alert,
    CircularProgress,
} from '@mui/material';
import { Add, Close } from '@mui/icons-material';
import type { DictionaryEntry } from '../types';
import { API_BASE_URL } from '../constants';
import { useAuth } from '../AuthContext';

interface DictionaryEntryDetailModalProps {
    entry: DictionaryEntry | null;
    open: boolean;
    onClose: () => void;
}

/**
 * Modal component for displaying full dictionary entry details
 * Includes button to add entry to personal vocabulary cards
 */
function DictionaryEntryDetailModal({ entry, open, onClose }: DictionaryEntryDetailModalProps) {
    const { token } = useAuth();
    const [adding, setAdding] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleAddToVocab = async () => {
        if (!entry) return;

        setAdding(true);
        setMessage(null);

        try {
            const firstDefinition = entry.definitions && entry.definitions.length > 0
                ? entry.definitions[0]
                : 'No definition available';

            const response = await fetch(`${API_BASE_URL}/api/vocabEntries`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                credentials: 'include',
                body: JSON.stringify({
                    entryKey: entry.word1,
                    entryValue: firstDefinition,
                    language: entry.language,
                }),
            });

            if (response.ok) {
                setMessage({
                    type: 'success',
                    text: 'Successfully added to your vocabulary cards!',
                });
            } else {
                const error = await response.json();
                setMessage({
                    type: 'error',
                    text: error.error || 'Failed to add to vocabulary cards',
                });
            }
        } catch (error) {
            console.error('Error adding to vocabulary:', error);
            setMessage({
                type: 'error',
                text: 'An error occurred. Please try again.',
            });
        } finally {
            setAdding(false);
        }
    };

    const handleClose = () => {
        setMessage(null);
        onClose();
    };

    if (!entry) return null;

    return (
        <Dialog
            className="dictionary-entry-modal"
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: { maxHeight: '80vh' }
            }}
        >
            <DialogTitle className="dictionary-entry-modal__title" sx={{ pb: 1 }}>
                <Typography
                    className="dictionary-entry-modal__primary-word"
                    variant="h5"
                    component="div"
                    sx={{
                        fontWeight: 'bold',
                        fontFamily: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
                    }}
                >
                    {entry.word1}
                </Typography>
                {entry.word2 && (
                    <Typography
                        className="dictionary-entry-modal__secondary-word"
                        variant="subtitle1"
                        color="text.secondary"
                        sx={{
                            fontFamily: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
                        }}
                    >
                        {entry.word2}
                    </Typography>
                )}
            </DialogTitle>

            <DialogContent className="dictionary-entry-modal__content" dividers>
                {entry.pronunciation && (
                    <Box className="dictionary-entry-modal__pronunciation-section" sx={{ mb: 2 }}>
                        <Typography
                            className="dictionary-entry-modal__pronunciation"
                            variant="body1"
                            sx={{
                                fontStyle: 'italic',
                                color: 'text.secondary',
                                fontWeight: 500,
                            }}
                        >
                            {entry.pronunciation}
                        </Typography>
                    </Box>
                )}

                <Divider sx={{ my: 2 }} />

                <Typography className="dictionary-entry-modal__definitions-label" variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                    Definitions:
                </Typography>

                <List className="dictionary-entry-modal__definitions-list" dense sx={{ pt: 0 }}>
                    {entry.definitions && entry.definitions.length > 0 ? (
                        entry.definitions.map((definition, index) => (
                            <ListItem key={index} className="dictionary-entry-modal__definition-item" sx={{ pl: 0, py: 0.5, alignItems: 'flex-start' }}>
                                <Typography className="dictionary-entry-modal__definition-number" variant="body2" component="span" sx={{ mr: 1, fontWeight: 'bold' }}>
                                    {index + 1}.
                                </Typography>
                                <Typography className="dictionary-entry-modal__definition-text" variant="body2" component="span">
                                    {stripParentheses(definition)}
                                </Typography>
                            </ListItem>
                        ))
                    ) : (
                        <Typography variant="body2" color="text.secondary">
                            No definitions available.
                        </Typography>
                    )}
                </List>

                {message && (
                    <Alert className="dictionary-entry-modal__feedback-alert" severity={message.type} sx={{ mt: 2 }} onClose={() => setMessage(null)}>
                        {message.text}
                    </Alert>
                )}
            </DialogContent>

            <DialogActions className="dictionary-entry-modal__actions" sx={{ px: 3, py: 2 }}>
                <Button
                    className="dictionary-entry-modal__close-btn"
                    onClick={handleClose}
                    startIcon={<Close />}
                    color="inherit"
                >
                    Close
                </Button>
                <Button
                    className="dictionary-entry-modal__add-to-vocab-btn"
                    onClick={handleAddToVocab}
                    startIcon={adding ? <CircularProgress size={16} /> : <Add />}
                    variant="contained"
                    disabled={adding}
                >
                    {adding ? 'Adding...' : 'Add to Vocabulary'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default DictionaryEntryDetailModal;
