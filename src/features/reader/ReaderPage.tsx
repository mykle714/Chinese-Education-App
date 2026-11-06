import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Box } from "@mui/material";
import NodePage from "../../components/NodePage";
import { useAuth } from "../../AuthContext";
import type { Text } from "../../types";

// Extracted components
import TextSidebar from "./TextSidebar";

import { usePageTitle } from "../../hooks/usePageTitle";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { apiDelete, apiGet } from "../../api/http";
import { NEW_DOCUMENT_PATH } from "./readerPaths";
import { navigateBackOr } from "../../utils/navigateBack";

// READER DOCUMENT LIST — the `/reader` NODE page (docs/LEAF_NODE_PAGES.md § Reader):
// keeps the footer (Menu tab stays active, same as Games), LEFT back
// arrow → the previous page (else `/`, navigateBackOr), slides in from the right.
// Fixed non-scrolling shell (scrollable={false}) — TextSidebar owns its own internal scroll region for the
// document list, same shape as before under LeafPage. Opening a document is a
// real navigation to `/reader/:id` (ReaderDocumentPage.tsx), a footerless
// NODE-style drill-in reached via `useSlideNavigate` — a routed cdp-style pair,
// not in-page state. "New Document" is the same navigation to `/reader/new`, which
// ReaderDocumentPage opens as a blank draft in edit mode (no create dialog).
// Rows have no Edit/Delete buttons: swiping a row left uncovers Delete
// (SwipeToDeleteRow), and editing happens inside the open document.
function ReaderPage() {
    usePageTitle("Reader");
    const navigate = useNavigate();
    const slideNavigate = useSlideNavigate();
    const { user, isAuthenticated } = useAuth();

    const [texts, setTexts] = useState<Text[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // A failed swipe-delete; shown above the list without hiding it.
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // Fetch texts from API.
    useEffect(() => {
        const fetchTexts = async () => {
            try {
                setLoading(true);
                const textsData = await apiGet<Text[]>('/api/texts');
                setTexts(textsData);
            } catch (err) {
                console.error('Error fetching texts:', err);
                setTexts([]);
                setError('Failed to load texts. Please try again later.');
            } finally {
                setLoading(false);
            }
        };

        if (isAuthenticated) {
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

    // A blank draft; nothing is created server-side until its first Save.
    const handleCreateNew = useCallback(() => {
        slideNavigate(NEW_DOCUMENT_PATH);
    }, [slideNavigate]);

    // Swipe-left → Delete. iPhone style: no confirmation, and the row leaves the
    // list at once (optimistic). On failure the document goes back where it was
    // and an error shows above the list.
    const handleDelete = useCallback(async (text: Text) => {
        setDeleteError(null);
        let removedIndex = -1;
        setTexts(prev => {
            removedIndex = prev.findIndex(t => t.id === text.id);
            return prev.filter(t => t.id !== text.id);
        });
        try {
            await apiDelete(`/api/texts/${text.id}`);
        } catch (err) {
            console.error('Error deleting text:', err);
            setTexts(prev => {
                if (prev.some(t => t.id === text.id)) return prev;
                const next = [...prev];
                next.splice(removedIndex < 0 ? 0 : Math.min(removedIndex, next.length), 0, text);
                return next;
            });
            setDeleteError(`Couldn't delete "${text.title}". Please try again.`);
        }
    }, []);

    return (
        <NodePage
            title="Reader"
            onBack={() => navigateBackOr(navigate, "/")}
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
                            loading={loading}
                            error={error}
                            actionError={deleteError}
                            onDismissActionError={() => setDeleteError(null)}
                            onTextSelect={handleTextSelect}
                            onCreateNew={handleCreateNew}
                            onDelete={handleDelete}
                            drawerWidth={500}
                        />
                    </Box>
                </Box>
            </Box>

        </NodePage>
    );
}

export default ReaderPage;
