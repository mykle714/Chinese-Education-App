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
import type { Text } from '../../types';
import { apiDelete } from '../../api/http';

// The open document's delete confirmation (ReaderDocumentPage header → trash icon).
// The /reader list does NOT use it: list rows delete by swipe, with no confirmation
// (SwipeToDeleteRow). Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Deleting a document.

interface DeleteDocumentDialogProps {
    open: boolean;
    text: Text | null;
    onClose: () => void;
    onSuccess: () => void;
}

function DeleteDocumentDialog({ open, text, onClose, onSuccess }: DeleteDocumentDialogProps) {
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
            // Through api/http (bearer + refresh handled there) — docs/FRONTEND_LAYERING.md.
            await apiDelete(`/api/texts/${text.id}`);

            // Notify parent and close
            onSuccess();
            onClose();
        } catch (err: unknown) {
            console.error('[DELETE-DIALOG] ❌ Error deleting document:', err);
            setError(err instanceof Error ? err.message : 'Failed to delete document');
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
