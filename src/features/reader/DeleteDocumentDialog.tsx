import { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    DialogContentText,
    Button,
    Typography,
} from '@mui/material';
import type { Text } from '../../types';
import { apiDelete } from '../../api/http';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { LEADING, SIZE, WEIGHT } from '../../theme/scale';
import { READER_CARD_RADIUS, readerMessageSx, readerPillButtonSx } from './readerStyles';

// The open document's delete confirmation (ReaderDocumentPage header → trash icon).
// The /reader list does NOT use it: list rows delete by swipe, with no confirmation
// (SwipeToDeleteRow). Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Deleting a document.
//
// Flat look (readerStyles.ts): a white card at SectionCard's 18px radius with the
// hairline and no elevation shadow, sentence-case title, and the two actions as pills —
// Cancel white, Delete the red MID fill (the Friends panel's Remove), both ink text.
// An error is a plain red line, not an MUI Alert.

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
            className="reader-delete-dialog"
            open={open}
            onClose={handleClose}
            maxWidth="xs"
            fullWidth
            PaperProps={{
                elevation: 0,
                sx: {
                    backgroundColor: COLORS.white,
                    border: `1px solid ${COLORS.rowBorder}`,
                    borderRadius: READER_CARD_RADIUS,
                    mx: 2,
                },
            }}
        >
            <DialogTitle
                className="reader-delete-dialog__title"
                sx={{ fontFamily: FONTS.sans, fontSize: SIZE.subtitle, fontWeight: WEIGHT.bold, lineHeight: LEADING.tight, color: COLORS.onSurface, pb: 1 }}
            >
                Delete document?
            </DialogTitle>
            <DialogContent className="reader-delete-dialog__content" sx={{ pb: 1 }}>
                <DialogContentText
                    className="reader-delete-dialog__message"
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, lineHeight: LEADING.normal, color: COLORS.textSecondary }}
                >
                    "{text.title}" will be deleted. This can't be undone.
                </DialogContentText>
                {error && (
                    <Typography className="reader-delete-dialog__error" sx={{ ...readerMessageSx, mt: 1.5 }}>
                        {error}
                    </Typography>
                )}
            </DialogContent>
            <DialogActions className="reader-delete-dialog__actions" sx={{ px: 3, pb: 2.5 }}>
                <Button
                    className="reader-delete-dialog__cancel"
                    onClick={handleClose}
                    disabled={loading}
                    sx={readerPillButtonSx(COLORS.white)}
                >
                    Cancel
                </Button>
                <Button
                    className="reader-delete-dialog__confirm"
                    onClick={handleDelete}
                    disabled={loading}
                    sx={readerPillButtonSx(COLORS.redM)}
                >
                    {loading ? 'Deleting…' : 'Delete'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default DeleteDocumentDialog;
