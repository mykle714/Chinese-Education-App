import { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    DialogContentText,
    Button,
    Alert
} from '@mui/material';
import type { Text } from '../types';
import { useAuth } from '../AuthContext';
import { API_BASE_URL } from '../constants';

interface DeleteDocumentDialogProps {
    open: boolean;
    text: Text | null;
    onClose: () => void;
    onSuccess: () => void;
}

function DeleteDocumentDialog({ open, text, onClose, onSuccess }: DeleteDocumentDialogProps) {
    const { token } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleClose = () => {
        if (!loading) {
            setError(null);
            onClose();
        }
    };

    const handleDelete = async () => {
        if (!text) return;

        setLoading(true);
        setError(null);

        try {
            const response = await fetch(`${API_BASE_URL}/api/texts/${text.id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete document');
            }

            console.log('[DELETE-DIALOG] ✅ Document deleted successfully');

            // Notify parent and close
            onSuccess();
            onClose();
        } catch (err: any) {
            console.error('[DELETE-DIALOG] ❌ Error deleting document:', err);
            setError(err.message || 'Failed to delete document');
        } finally {
            setLoading(false);
        }
    };

    if (!text) return null;

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>Delete Document</DialogTitle>
            <DialogContent>
                {error && (
                    <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}
                <DialogContentText>
                    Are you sure you want to delete "{text.title}"? This action cannot be undone.
                </DialogContentText>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button
                    onClick={handleClose}
                    disabled={loading}
                >
                    Cancel
                </Button>
                <Button
                    onClick={handleDelete}
                    variant="contained"
                    color="error"
                    disabled={loading}
                >
                    {loading ? 'Deleting...' : 'Delete'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default DeleteDocumentDialog;
