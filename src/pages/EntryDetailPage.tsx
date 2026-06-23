import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useConfirmation } from "../contexts/ConfirmationContext";
import { useVocabularyUpdate } from "../contexts/VocabularyUpdateContext";
import apiClient from "../utils/apiClient";
import { stripParentheses } from "../utils/definitionUtils";
import {
    Container,
    Typography,
    Paper,
    Box,
    Button,
    Alert,
    Divider,
    Chip
} from "@mui/material";
import DelayedCircularProgress from "../components/DelayedCircularProgress";
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
import { usePageTitle } from "../hooks/usePageTitle";
import type { VocabEntry, DifficultyLevel } from "../types";
import { SIZE } from "../theme/scale";

// Helper function to get the numeric difficulty icon. Difficulty is the generalized
// bare-integer scale '1'..'6' (migration 79); for zh these are HSK levels.
const getDifficultyIcon = (difficulty: DifficultyLevel) => {
    switch (difficulty) {
        case '1': return <LooksOneIcon fontSize="small" />;
        case '2': return <LooksTwoIcon fontSize="small" />;
        case '3': return <Looks3Icon fontSize="small" />;
        case '4': return <Looks4Icon fontSize="small" />;
        case '5': return <Looks5Icon fontSize="small" />;
        case '6': return <Looks6Icon fontSize="small" />;
        default: return <LooksOneIcon fontSize="small" />; // Default fallback
    }
};

// Helper function to render tag badges
const renderTags = (entry: VocabEntry) => (
    <Box sx={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 0.5 }}>
        {/* HSK badge: only for zh, whose difficulty integers ARE HSK levels. Spanish
            uses the same 1–6 scale but it is not an HSK proficiency label, so no badge. */}
        {entry.language === 'zh' && entry.difficulty && (
            <Chip
                icon={getDifficultyIcon(entry.difficulty)}
                label={`HSK${entry.difficulty}`}
                size="small"
                color="secondary"
                sx={{ fontSize: SIZE.micro, height: '20px' }}
            />
        )}
    </Box>
);

function EntryDetailPage() {
    usePageTitle("Entry");
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
                const response = await apiClient.get(`/api/vocabEntries/${id}`);
                setEntry(response.data);
                setLoading(false);
            } catch (err: unknown) {
                const e = err as { response?: { data?: { error?: string; code?: string } }; message?: string };
                const errorMessage = e.response?.data?.error ?? e.message ?? `Failed to fetch vocabulary entry with ID ${id}`;
                const errorCode = e.response?.data?.code ?? "ERR_UNKNOWN";
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
            await apiClient.delete(`/api/vocabEntries/${id}`);

            // Notify vocabulary update context
            vocabularyUpdate.removeVocabEntry(parseInt(id!));

            // Navigate back to entries page after successful deletion
            navigate("/entries");
        } catch (err: unknown) {
            const e = err as { response?: { data?: { error?: string; code?: string } }; message?: string };
            const errorMessage = e.response?.data?.error ?? e.message ?? `Failed to delete vocabulary entry with ID ${id}`;
            const errorCode = e.response?.data?.code ?? "ERR_UNKNOWN";
            setError(errorMessage);
            setErrorCode(errorCode);
            console.error(err);
        }
    };

    if (loading) {
        return (
            <Container maxWidth="lg" sx={{ py: 4 }}>
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
                    <DelayedCircularProgress />
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
                    {stripParentheses(entry.definition ?? '')}
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
