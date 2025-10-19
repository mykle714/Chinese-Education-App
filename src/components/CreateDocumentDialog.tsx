import { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Button,
    Box,
    Alert
} from '@mui/material';
import type { Language } from '../types';
import { useAuth } from '../AuthContext';
import { API_BASE_URL } from '../constants';

interface CreateDocumentDialogProps {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
    language: Language;
}

function CreateDocumentDialog({ open, onClose, onSuccess, language }: CreateDocumentDialogProps) {
    const { token } = useAuth();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleClose = () => {
        if (!loading) {
            setTitle('');
            setDescription('');
            setError(null);
            onClose();
        }
    };

    const handleCreate = async () => {
        if (!title.trim()) {
            setError('Title is required');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const response = await fetch(`${API_BASE_URL}/api/texts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    title: title.trim(),
                    description: description.trim(),
                    content: '', // Start with blank content
                    language
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to create document');
            }

            console.log('[CREATE-DIALOG] ✅ Document created successfully');

            // Reset form
            setTitle('');
            setDescription('');

            // Notify parent and close
            onSuccess();
            onClose();
        } catch (err: any) {
            console.error('[CREATE-DIALOG] ❌ Error creating document:', err);
            setError(err.message || 'Failed to create document');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>Create New Document</DialogTitle>
            <DialogContent>
                <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {error && (
                        <Alert severity="error" onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    )}

                    <TextField
                        label="Title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        fullWidth
                        required
                        autoFocus
                        disabled={loading}
                        placeholder="Enter document title"
                    />

                    <TextField
                        label="Description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        fullWidth
                        multiline
                        rows={2}
                        disabled={loading}
                        placeholder="Optional description"
                    />
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button
                    onClick={handleClose}
                    disabled={loading}
                >
                    Cancel
                </Button>
                <Button
                    onClick={handleCreate}
                    variant="contained"
                    disabled={loading || !title.trim()}
                >
                    {loading ? 'Creating...' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default CreateDocumentDialog;
