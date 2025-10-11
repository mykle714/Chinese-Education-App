import { Container, Typography, Box, Button, CircularProgress, Alert, LinearProgress } from "@mui/material";
import { Upload, Add } from "@mui/icons-material";
import { useState, useRef } from "react";
import { useAuth } from "../AuthContext";
import VocabEntryCards from "../VocabEntryCards";
import AddEntryModal from "../components/AddEntryModal";
import { API_BASE_URL } from "../constants";

function EntriesPage() {
    const { token } = useAuth();
    const [importing, setImporting] = useState(false);
    const [importProgress, setImportProgress] = useState(0);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);


    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleAddEntryClick = () => {
        setIsAddModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsAddModalOpen(false);
    };

    const handleEntryAdded = () => {
        setMessage({
            type: 'success',
            text: 'Vocabulary entry added successfully!'
        });
        // Trigger refresh of vocabulary entries
        setRefreshTrigger(prev => prev + 1);
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.name.endsWith('.csv')) {
            setMessage({ type: 'error', text: 'Please select a CSV file.' });
            return;
        }

        setImporting(true);
        setImportProgress(0);
        setElapsedTime(0);
        setMessage(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            // Calculate duration based on file size (100KB = 6 minutes)
            const fileSizeKB = file.size / 1024;
            const baseTimeFor100KB = 360000; // 6 minutes in milliseconds
            const totalDuration = Math.max(60000, (fileSizeKB / 100) * baseTimeFor100KB); // Minimum 1 minute
            const updateInterval = 1000; // Update every second
            const totalUpdates = totalDuration / updateInterval;
            let currentUpdate = 0;

            const progressInterval = setInterval(() => {
                // Update elapsed time
                setElapsedTime(prev => prev + 1);

                setImportProgress(prev => {
                    currentUpdate++;

                    // Calculate realistic progress with some variance
                    let targetProgress;
                    if (currentUpdate < totalUpdates * 0.1) {
                        // First 10% - slow start (parsing file)
                        targetProgress = (currentUpdate / (totalUpdates * 0.1)) * 10;
                    } else if (currentUpdate < totalUpdates * 0.8) {
                        // Middle 70% - steady processing
                        const middleProgress = ((currentUpdate - totalUpdates * 0.1) / (totalUpdates * 0.7)) * 70;
                        targetProgress = 10 + middleProgress;
                    } else if (currentUpdate < totalUpdates * 0.95) {
                        // Next 15% - database operations
                        const dbProgress = ((currentUpdate - totalUpdates * 0.8) / (totalUpdates * 0.15)) * 15;
                        targetProgress = 80 + dbProgress;
                    } else {
                        // Final 5% - wait for server response
                        targetProgress = Math.min(95, prev + 0.5);
                    }

                    // Add small random variance for realism
                    const variance = (Math.random() - 0.5) * 2;
                    targetProgress = Math.max(0, Math.min(95, targetProgress + variance));

                    return Math.max(prev, targetProgress);
                });
            }, updateInterval);

            const response = await fetch(`${API_BASE_URL}/api/vocabEntries/import`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
                body: formData,
            });

            clearInterval(progressInterval);
            setImportProgress(100); // Complete the progress bar

            const result = await response.json();

            if (response.ok) {
                const successMessage = `Successfully imported ${result.results.imported} vocabulary entries!`;
                setMessage({
                    type: 'success',
                    text: successMessage
                });

                // Note: CSV import doesn't return the actual entries, so we can't call
                // vocabularyUpdate.bulkAddVocabEntries() here. The ReaderPage will
                // automatically refresh its vocabulary when the user navigates back to it.

                // Trigger refresh of vocabulary entries
                setRefreshTrigger(prev => prev + 1);
            } else {
                setMessage({
                    type: 'error',
                    text: result.error || 'Failed to import vocabulary entries.'
                });
            }
        } catch (error) {
            console.error('Import error:', error);
            setMessage({
                type: 'error',
                text: 'An error occurred while importing. Please try again.'
            });
        } finally {
            setTimeout(() => {
                setImporting(false);
                setImportProgress(0);
                setElapsedTime(0);
            }, 1000);
            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h3" component="h1" gutterBottom sx={{ mb: 0 }}>
                    Vocabulary Entries
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {importing && <CircularProgress size={24} />}
                    <Button
                        variant="contained"
                        startIcon={<Add />}
                        onClick={handleAddEntryClick}
                    >
                        Add Entry
                    </Button>
                    <Button
                        variant="contained"
                        startIcon={<Upload />}
                        onClick={handleImportClick}
                        disabled={importing}
                    >
                        {importing ? 'Importing...' : 'Import Cards'}
                    </Button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        accept=".csv"
                        style={{ display: 'none' }}
                    />
                </Box>
            </Box>

            {message && (
                <Alert
                    severity={message.type}
                    sx={{ mb: 3 }}
                    onClose={() => setMessage(null)}
                >
                    {message.text}
                </Alert>
            )}

            {importing && (
                <Box sx={{ mb: 3 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                        Importing vocabulary entries... {Math.round(importProgress)}% - {formatTime(elapsedTime)} elapsed
                    </Typography>
                    <LinearProgress
                        variant="determinate"
                        value={importProgress}
                        sx={{ height: 8, borderRadius: 4 }}
                    />
                </Box>
            )}

            <VocabEntryCards refreshTrigger={refreshTrigger} />

            <AddEntryModal
                open={isAddModalOpen}
                onClose={handleCloseModal}
                onEntryAdded={handleEntryAdded}
            />
        </Container>
    );
}

export default EntriesPage;
