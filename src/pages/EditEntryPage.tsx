import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useVocabularyUpdate } from "../contexts/VocabularyUpdateContext";
import {
    Container,
    Typography,
    Box,
    TextField,
    Button,
    CircularProgress,
    Alert,
    Paper,
    Divider
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SaveIcon from "@mui/icons-material/Save";
import { DEFAULT_TEST_USER_ID } from "../constants";

interface VocabEntry {
    id: number;
    entryKey: string;
    entryValue: string;
    userId: string;
    createdAt: string;
}

function EditEntryPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useAuth();
    const vocabularyUpdate = useVocabularyUpdate();
    const [formData, setFormData] = useState<Partial<VocabEntry>>({
        entryKey: "",
        entryValue: "",
        userId: DEFAULT_TEST_USER_ID
    });
    const [loading, setLoading] = useState<boolean>(true);
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [errorCode, setErrorCode] = useState<string | null>(null);

    useEffect(() => {
        const fetchEntry = async () => {
            try {
                setLoading(true);
                const response = await fetch(`http://localhost:5000/api/vocabEntries/${id}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw {
                        message: errorData.error || `Failed to fetch vocabulary entry with ID ${id}`,
                        code: errorData.code || "ERR_FETCH_FAILED"
                    };
                }

                const result = await response.json();
                setFormData({
                    entryKey: result.entryKey,
                    entryValue: result.entryValue,
                    userId: result.userId || DEFAULT_TEST_USER_ID
                });
                setLoading(false);
            } catch (err: any) {
                const errorMessage = err.message || `Failed to fetch vocabulary entry with ID ${id}`;
                const errorCode = err.code || "ERR_UNKNOWN";
                setError(errorMessage);
                setErrorCode(errorCode);
                setLoading(false);
                console.error(err);
            }
        };

        if (id && token) {
            fetchEntry();
        }
    }, [id, token]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        setErrorCode(null);

        try {
            const response = await fetch(`http://localhost:5000/api/vocabEntries/${id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw {
                    message: errorData.error || `Failed to update vocabulary entry with ID ${id}`,
                    code: errorData.code || "ERR_UPDATE_FAILED"
                };
            }

            // Get the updated entry from the response
            const updatedEntry = await response.json();

            // Notify vocabulary update context
            vocabularyUpdate.updateVocabEntry(updatedEntry);

            // Navigate back to entry detail page after successful update
            navigate(`/entries/${id}`);
        } catch (err: any) {
            const errorMessage = err.message || `Failed to update vocabulary entry with ID ${id}`;
            const errorCode = err.code || "ERR_UNKNOWN";
            setError(errorMessage);
            setErrorCode(errorCode);
            setSubmitting(false);
            console.error(err);
        }
    };

    if (loading) {
        return (
            <Container maxWidth="lg" sx={{ py: 4 }}>
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
                    <CircularProgress />
                </Box>
            </Container>
        );
    }

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 4 }}>
                <Button
                    startIcon={<ArrowBackIcon />}
                    onClick={() => navigate(`/entries/${id}`)}
                    variant="outlined"
                    sx={{ mr: 2 }}
                >
                    Back
                </Button>
                <Typography variant="h4" component="h1">
                    Edit Vocabulary Entry
                </Typography>
            </Box>

            {error && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    {error} {errorCode && <span>[Error Code: {errorCode}]</span>}
                </Alert>
            )}

            <Paper elevation={3} sx={{ p: 4 }}>
                <Box component="form" onSubmit={handleSubmit}>
                    <TextField
                        label="Term"
                        id="entryKey"
                        name="entryKey"
                        value={formData.entryKey}
                        onChange={handleChange}
                        required
                        fullWidth
                        margin="normal"
                        variant="outlined"
                    />

                    <TextField
                        label="Definition"
                        id="entryValue"
                        name="entryValue"
                        value={formData.entryValue}
                        onChange={handleChange}
                        required
                        fullWidth
                        multiline
                        rows={4}
                        margin="normal"
                        variant="outlined"
                        sx={{ mb: 3 }}
                    />

                    <Divider sx={{ my: 3 }} />

                    <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                        <Button
                            type="button"
                            variant="outlined"
                            onClick={() => navigate(`/entries/${id}`)}
                            sx={{ mr: 2 }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="contained"
                            color="primary"
                            disabled={submitting}
                            startIcon={submitting ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
                        >
                            {submitting ? "Saving..." : "Save Changes"}
                        </Button>
                    </Box>
                </Box>
            </Paper>
        </Container>
    );
}

export default EditEntryPage;
