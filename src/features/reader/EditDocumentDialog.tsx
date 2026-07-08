import { useState, useEffect } from 'react';
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
import type { Text } from '../../types';
import { useAuth } from '../../AuthContext';
import { API_BASE_URL } from '../../constants';
import { canonicalizeValidationBody, isValidationShapePreserved, VALIDATION_FORMAT_MESSAGE } from './validationFormat';

interface EditDocumentDialogProps {
    open: boolean;
    text: Text | null;
    onClose: () => void;
    onSuccess: () => void;
}

function EditDocumentDialog({ open, text, onClose, onSuccess }: EditDocumentDialogProps) {
    const { token } = useAuth();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Update form when text changes
    useEffect(() => {
        if (text) {
            setTitle(text.title);
            setDescription(text.description);
            setContent(text.content);
        }
    }, [text]);

    const handleClose = () => {
        if (!loading) {
            setError(null);
            onClose();
        }
    };

    const handleSave = async () => {
        if (!text) return;

        if (!title.trim()) {
            setError('Title is required');
            return;
        }

        // Validation documents (docs/DATA_VALIDATION_SYSTEM.md) have a fixed
        // `<fieldName>:\n<JSON>` body; the validator may edit only the JSON values.
        // Canonicalize the body: a null result means the format was broken (block the
        // save), otherwise every non-value character (headers, separators, whitespace)
        // is reset so a whitespace-only edit round-trips to the original and never
        // triggers a spurious flag. Ordinary reader docs have no `validationField`.
        let contentToSave = content;
        if (text.validationField) {
            const canonical = canonicalizeValidationBody(content, text.validationField);
            // Block a broken format AND any JSON key-name change (a renamed key stays
            // valid JSON but the server would no longer recognize the field).
            if (
                canonical === null ||
                !isValidationShapePreserved(content, text.validationOriginalContent ?? '', text.validationField)
            ) {
                setError(VALIDATION_FORMAT_MESSAGE);
                return;
            }
            contentToSave = canonical;
        }

        setLoading(true);
        setError(null);

        try {
            const response = await fetch(`${API_BASE_URL}/api/texts/${text.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                credentials: 'include',
                body: JSON.stringify({
                    title: title.trim(),
                    description: description.trim(),
                    content: contentToSave
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update document');
            }

            console.log('[EDIT-DIALOG] ✅ Document updated successfully');

            // Notify parent and close
            onSuccess();
            onClose();
        } catch (err: unknown) {
            console.error('[EDIT-DIALOG] ❌ Error updating document:', err);
            setError(err instanceof Error ? err.message : 'Failed to update document');
        } finally {
            setLoading(false);
        }
    };

    if (!text) return null;

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="md"
            fullWidth
        >
            <DialogTitle>Edit Document</DialogTitle>
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
                    />

                    <TextField
                        label="Description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        fullWidth
                        multiline
                        rows={2}
                        disabled={loading}
                    />

                    <TextField
                        label="Content"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        fullWidth
                        multiline
                        rows={10}
                        disabled={loading}
                        placeholder="Enter your text content here..."
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
                    onClick={handleSave}
                    variant="contained"
                    disabled={loading || !title.trim()}
                >
                    {loading ? 'Saving...' : 'Save Changes'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default EditDocumentDialog;
