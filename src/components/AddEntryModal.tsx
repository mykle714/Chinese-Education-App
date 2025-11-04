import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle, IconButton, TextField, Button, Alert, CircularProgress } from "@mui/material";
import { Close, Add } from "@mui/icons-material";
import { useVocabularyUpdate } from "../contexts/VocabularyUpdateContext";
import { API_BASE_URL } from '../constants';

interface VocabEntryFormData {
    entryKey: string;
    entryValue: string;
}

interface AddEntryModalProps {
    open: boolean;
    onClose: () => void;
    onEntryAdded: () => void;
}

const AddEntryModal = ({ open, onClose, onEntryAdded }: AddEntryModalProps) => {
    const vocabularyUpdate = useVocabularyUpdate();
    const [formData, setFormData] = useState<VocabEntryFormData>({
        entryKey: '',
        entryValue: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const termFieldRef = useRef<HTMLInputElement>(null);

    // Handle focus when dialog has fully entered (animation complete)
    const handleDialogEntered = () => {
        if (termFieldRef.current) {
            termFieldRef.current.focus();
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);
        setErrorCode(null);

        try {
            const response = await fetch(`${API_BASE_URL}/api/vocabEntries`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw {
                    message: errorData.error || 'Failed to add vocabulary entry',
                    code: errorData.code || 'ERR_UNKNOWN'
                };
            }

            // Get the created entry from the response
            const createdEntry = await response.json();

            // Notify vocabulary update context
            vocabularyUpdate.addVocabEntry(createdEntry);

            setFormData({
                entryKey: '',
                entryValue: ''
            });
            onEntryAdded();
            onClose();
        } catch (err: any) {
            const errorMessage = err.message || 'Failed to add vocabulary entry. Please try again.';
            const errorCode = err.code || 'ERR_UNKNOWN';
            setError(errorMessage);
            setErrorCode(errorCode);
            console.error(err);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        setFormData({ entryKey: '', entryValue: '' });
        setError(null);
        setErrorCode(null);
        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
            TransitionProps={{
                onEntered: handleDialogEntered
            }}
            PaperProps={{
                sx: {
                    borderRadius: 2,
                }
            }}
        >
            <DialogTitle sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                pb: 1
            }}>
                Add New Vocabulary Entry
                <IconButton
                    aria-label="close"
                    onClick={handleClose}
                    sx={{
                        color: (theme) => theme.palette.grey[500],
                    }}
                >
                    <Close />
                </IconButton>
            </DialogTitle>
            <DialogContent>
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error} {errorCode && <span>[Error Code: {errorCode}]</span>}
                    </Alert>
                )}

                <form onSubmit={handleSubmit}>
                    <TextField
                        label="Term"
                        name="entryKey"
                        value={formData.entryKey}
                        onChange={handleChange}
                        required
                        fullWidth
                        margin="normal"
                        variant="outlined"
                        autoFocus
                        inputRef={termFieldRef}
                    />

                    <TextField
                        label="Definition"
                        name="entryValue"
                        value={formData.entryValue}
                        onChange={handleChange}
                        required
                        fullWidth
                        margin="normal"
                        variant="outlined"
                        sx={{ mb: 3 }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSubmit(e as any);
                            }
                        }}
                    />

                    <Button
                        type="submit"
                        variant="contained"
                        color="primary"
                        disabled={isSubmitting}
                        startIcon={isSubmitting ? <CircularProgress size={20} color="inherit" /> : <Add />}
                        fullWidth
                        size="large"
                    >
                        {isSubmitting ? 'Adding...' : 'Add Vocabulary Entry'}
                    </Button>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default AddEntryModal;
