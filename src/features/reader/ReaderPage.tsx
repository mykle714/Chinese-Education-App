import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Box, IconButton, Snackbar, Alert } from "@mui/material";
import { FactCheck as FactCheckIcon } from "@mui/icons-material";
import NodePage from "../../components/NodePage";
import MinutePointsFireBadge from "../../minutePoints/MinutePointsFireBadge";
import { useAuth } from "../../AuthContext";
import { API_BASE_URL } from "../../constants";
import type { Text } from "../../types";

// Extracted components
import TextSidebar from "./TextSidebar";
import CreateDocumentDialog from "./CreateDocumentDialog";
import EditDocumentDialog from "./EditDocumentDialog";
import DeleteDocumentDialog from "./DeleteDocumentDialog";

import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { downloadValidationDoc } from "./validationApi";

// READER DOCUMENT LIST — the `/reader` NODE page (docs/LEAF_NODE_PAGES.md § Reader):
// keeps the footer (Home tab stays active, same as Games/Dictionary), LEFT back
// arrow → Home, slides in from the right. Fixed non-scrolling shell
// (scrollable={false}) — TextSidebar owns its own internal scroll region for the
// document list, same shape as before under LeafPage. Opening a document is a
// real navigation to `/reader/:id` (ReaderDocumentPage.tsx), a footerless
// NODE-style drill-in reached via `useSlideNavigate` — a routed cdp-style pair,
// not in-page state.
function ReaderPage() {
    usePageTitle("Reader");
    const navigate = useNavigate();
    const slideNavigate = useSlideNavigate();
    const { token, user, isAuthenticated } = useAuth();

    const [texts, setTexts] = useState<Text[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Dialog states — list-row Edit/Delete (the open-document page has its own).
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [textToEdit, setTextToEdit] = useState<Text | null>(null);
    const [textToDelete, setTextToDelete] = useState<Text | null>(null);

    const [validationMsg, setValidationMsg] = useState<string | null>(null);

    // Fetch texts from API.
    useEffect(() => {
        const fetchTexts = async () => {
            try {
                setLoading(true);
                const response = await fetch(`${API_BASE_URL}/api/texts`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                    credentials: 'include',
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch texts');
                }

                const textsData = await response.json();
                setTexts(textsData);
            } catch (err) {
                console.error('Error fetching texts:', err);
                setTexts([]);
                setError('Failed to load texts. Please try again later.');
            } finally {
                setLoading(false);
            }
        };

        if (token) {
            fetchTexts();
        }
    // Keyed on the STABLE auth identity, not `token` — a silent access-token
    // refresh (~15 min) must not re-fetch and reset the reader's text list.
    // See CLAUDE.md "Never reload on token refresh".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    // Opening a document navigates to its routed node page; ReaderDocumentPage
    // does its own fetch-by-id and vocabulary processing on mount.
    const handleTextSelect = useCallback((text: Text) => {
        slideNavigate(`/reader/${text.id}`);
    }, [slideNavigate]);

    const formatDate = useCallback((dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }, []);

    const handleCreateNew = useCallback(() => {
        setCreateDialogOpen(true);
    }, []);

    const handleEdit = useCallback((text: Text) => {
        setTextToEdit(text);
        setEditDialogOpen(true);
    }, []);

    const handleDelete = useCallback((text: Text) => {
        setTextToDelete(text);
        setDeleteDialogOpen(true);
    }, []);

    const handleDialogSuccess = useCallback(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/texts`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
                credentials: 'include',
            });
            if (response.ok) {
                setTexts(await response.json());
            }
        } catch (err) {
            console.error('Error reloading texts:', err);
        }
    }, [token]);

    // Download a fresh entry+field to validate. It is added to the list but NOT
    // auto-opened — the validator picks it from the list when ready
    // (docs/DATA_VALIDATION_SYSTEM.md).
    const handleDownloadValidation = useCallback(async () => {
        try {
            await downloadValidationDoc(token, user?.selectedLanguage || 'zh');
            await handleDialogSuccess(); // refresh list so the new doc appears
            setValidationMsg('Added a new entry to validate to your list');
        } catch (err) {
            console.error('Error downloading validation entry:', err);
            setValidationMsg(err instanceof Error ? err.message : 'Failed to download an entry to validate');
        }
    }, [token, user?.selectedLanguage, handleDialogSuccess]);

    const headerRightContent = isAuthenticated ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {user?.isValidator && (
                <IconButton
                    className="reader-page-validate-download-button"
                    onClick={handleDownloadValidation}
                    size="small"
                    aria-label="Download an entry to validate"
                    title="Download an entry to validate"
                >
                    <FactCheckIcon />
                </IconButton>
            )}
            <MinutePointsFireBadge />
        </Box>
    ) : undefined;

    return (
        <NodePage
            title="Reader"
            activePage="home"
            onBack={() => navigate("/")}
            headerExtraActions={headerRightContent}
            scrollable={false}
            contentClassName="reader-page-root"
        >
            <Box className="reader-page-container" sx={{
                display: 'flex',
                width: '100%',
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
            }}>
                <Box className="reader-page-content" sx={{
                    flexGrow: 1,
                    minHeight: 0,
                    p: { xs: 2, sm: 3 },
                    pt: { xs: 1, sm: 2 },
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                }}>
                    <Box className="reader-page-list-wrapper" sx={{
                        width: '100%',
                        maxWidth: '500px',
                        mx: 'auto',
                        mt: 2,
                        flex: 1,
                        minHeight: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        '& > *': {
                            width: '100% !important'
                        }
                    }}>
                        <TextSidebar
                            texts={texts}
                            selectedText={null}
                            loading={loading}
                            error={error}
                            onTextSelect={handleTextSelect}
                            onCreateNew={handleCreateNew}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            formatDate={formatDate}
                            drawerWidth={500}
                        />
                    </Box>
                </Box>
            </Box>

            <CreateDocumentDialog
                open={createDialogOpen}
                onClose={() => setCreateDialogOpen(false)}
                onSuccess={handleDialogSuccess}
                language={user?.selectedLanguage || 'zh'}
            />
            <EditDocumentDialog
                open={editDialogOpen}
                text={textToEdit}
                onClose={() => {
                    setEditDialogOpen(false);
                    setTextToEdit(null);
                }}
                onSuccess={handleDialogSuccess}
            />
            <DeleteDocumentDialog
                open={deleteDialogOpen}
                text={textToDelete}
                onClose={() => {
                    setDeleteDialogOpen(false);
                    setTextToDelete(null);
                }}
                onSuccess={handleDialogSuccess}
            />

            <Snackbar
                className="reader-page-validation-snackbar"
                open={!!validationMsg}
                autoHideDuration={4000}
                onClose={() => setValidationMsg(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                // Clears the NodePage header (60px) instead of overlapping the back
                // arrow / validator-download button.
                sx={{ top: '68px !important' }}
            >
                <Alert
                    className="reader-page-validation-alert"
                    severity="error"
                    variant="filled"
                    onClose={() => setValidationMsg(null)}
                >
                    {validationMsg}
                </Alert>
            </Snackbar>
        </NodePage>
    );
}

export default ReaderPage;
