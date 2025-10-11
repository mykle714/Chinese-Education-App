import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useConfirmation } from "../contexts/ConfirmationContext";
import { useVocabularyUpdate } from "../contexts/VocabularyUpdateContext";
import {
    Container,
    Typography,
    Paper,
    Box,
    Button,
    CircularProgress,
    Alert,
    Divider,
    Chip
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import {
    LooksOne as LooksOneIcon,
    LooksTwo as LooksTwoIcon,
    Looks3 as Looks3Icon,
    Looks4 as Looks4Icon,
    Looks5 as Looks5Icon,
    Looks6 as Looks6Icon
} from "@mui/icons-material";

// HSK Level type
type HskLevel = 'HSK1' | 'HSK2' | 'HSK3' | 'HSK4' | 'HSK5' | 'HSK6';

interface VocabEntry {
    id: number;
    entryKey: string;
    entryValue: string;
    hskLevelTag?: HskLevel | null;
    createdAt: string;
}

// Helper function to get HSK level icon
const getHskIcon = (hskLevel: HskLevel) => {
    switch (hskLevel) {
        case 'HSK1': return <LooksOneIcon fontSize="small" />;
        case 'HSK2': return <LooksTwoIcon fontSize="small" />;
        case 'HSK3': return <Looks3Icon fontSize="small" />;
        case 'HSK4': return <Looks4Icon fontSize="small" />;
        case 'HSK5': return <Looks5Icon fontSize="small" />;
        case 'HSK6': return <Looks6Icon fontSize="small" />;
        default: return <LooksOneIcon fontSize="small" />; // Default fallback
    }
};

// Helper function to render tag badges
const renderTags = (entry: VocabEntry) => (
    <Box sx={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 0.5 }}>
        {entry.hskLevelTag && (
            <Chip
                icon={getHskIcon(entry.hskLevelTag)}
                label={entry.hskLevelTag}
                size="small"
                color="secondary"
                sx={{ fontSize: '0.7rem', height: '20px' }}
            />
        )}
    </Box>
);

function EntryDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useAuth();
    const { confirm } = useConfirmation();
    const vocabularyUpdate = useVocabularyUpdate();
    const [entry, setEntry] = useState<VocabEntry | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
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
                setEntry(result);
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

    const handleDelete = async () => {
        const confirmed = await confirm("Are you sure you want to delete this vocabulary entry? This action cannot be undone.");
        if (!confirmed) {
            return;
        }

        try {
            const response = await fetch(`http://localhost:5000/api/vocabEntries/${id}`, {
                method: "DELETE",
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw {
                    message: errorData.error || `Failed to delete vocabulary entry with ID ${id}`,
                    code: errorData.code || "ERR_DELETE_FAILED"
                };
            }

            // Notify vocabulary update context
            vocabularyUpdate.removeVocabEntry(parseInt(id!));

            // Navigate back to entries page after successful deletion
            navigate("/entries");
        } catch (err: any) {
            const errorMessage = err.message || `Failed to delete vocabulary entry with ID ${id}`;
            const errorCode = err.code || "ERR_UNKNOWN";
            setError(errorMessage);
            setErrorCode(errorCode);
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

    if (error) {
        return (
            <Container maxWidth="lg" sx={{ py: 4 }}>
                <Alert severity="error" sx={{ mb: 2 }}>
                    {error} {errorCode && <span>[Error Code: {errorCode}]</span>}
                </Alert>
                <Button
                    startIcon={<ArrowBackIcon />}
                    onClick={() => navigate("/entries")}
                    variant="outlined"
                    sx={{ mt: 2 }}
                >
                    Back to Entries
                </Button>
            </Container>
        );
    }

    if (!entry) {
        return (
            <Container maxWidth="lg" sx={{ py: 4 }}>
                <Alert severity="warning">Entry not found</Alert>
                <Button
                    startIcon={<ArrowBackIcon />}
                    onClick={() => navigate("/entries")}
                    variant="outlined"
                    sx={{ mt: 2 }}
                >
                    Back to Entries
                </Button>
            </Container>
        );
    }

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 4 }}>
                <Button
                    startIcon={<ArrowBackIcon />}
                    onClick={() => navigate("/entries")}
                    variant="outlined"
                    sx={{ mr: 2 }}
                >
                    Back
                </Button>
                <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }}>
                    Vocabulary Entry Details
                </Typography>
                <Button
                    startIcon={<EditIcon />}
                    onClick={() => navigate(`/edit/${entry.id}`)}
                    variant="outlined"
                    color="primary"
                    sx={{ mr: 1 }}
                >
                    Edit
                </Button>
                <Button
                    startIcon={<DeleteIcon />}
                    onClick={handleDelete}
                    variant="outlined"
                    color="error"
                >
                    Delete
                </Button>
            </Box>

            <Paper elevation={3} sx={{ p: 4, position: 'relative' }}>
                <Typography variant="h3" component="h2" gutterBottom>
                    {entry.entryKey}
                </Typography>
                <Divider sx={{ my: 2 }} />
                <Typography variant="body1" paragraph>
                    {entry.entryValue}
                </Typography>
                {renderTags(entry)}
                <Divider sx={{ my: 2 }} />
                <Typography variant="body2" color="text.secondary">
                    Added: {new Date(entry.createdAt).toLocaleDateString()} at{" "}
                    {new Date(entry.createdAt).toLocaleTimeString()}
                </Typography>
            </Paper>
        </Container>
    );
}

export default EntryDetailPage;
