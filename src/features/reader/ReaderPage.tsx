import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import NodePage from "../../components/NodePage";
import { FooterSpacer } from "../../components/MobileFooter";
import { useAuth } from "../../AuthContext";
import type { Text } from "../../types";

// Extracted components
import TextSidebar from "./TextSidebar";
import DeleteDocumentDialog from "./DeleteDocumentDialog";
import { useReaderListView } from "./useReaderListView";
import { useReaderCollection } from "./useReaderCollection";
import { useReaderListSort } from "./useReaderListSort";
import ReaderCollectionTiles from "./ReaderCollectionTiles";
import ReaderListToolbar from "./ReaderListToolbar";
import {
    filterByCollection,
    sortTexts,
    READER_COLLECTION_ORDER,
    type ReaderCollection,
} from "./readerListOrder";

import { usePageTitle } from "../../hooks/usePageTitle";
import { useTier2Look } from "../../timeOfDay/useTier2Look";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { apiDelete, apiGet } from "../../api/http";
import { newDocumentPath } from "./readerPaths";
import { navigateBackOr } from "../../utils/navigateBack";

// READER DOCUMENT LIST — the `/reader` NODE page (docs/LEAF_NODE_PAGES.md § Reader):
// keeps the footer slab (Menu tab stays active), LEFT back
// arrow → the previous page (else `/`, navigateBackOr), slides in from the right.
// A scrolling page: the list body is TextSidebar. Opening a document is a
// real navigation to `/reader/:id` (ReaderDocumentPage.tsx), a footerless
// NODE-style drill-in reached via `useSlideNavigate` — a routed cdp-style pair,
// not in-page state. "New Document" is the same navigation to `/reader/new`, which
// ReaderDocumentPage opens as a blank draft in edit mode (no create dialog).
// Top to bottom: the Documents / Journal selector (ReaderCollectionTiles), the list
// toolbar (ReaderListToolbar: New document · sort · grid/list), then the list body.
// Two list views, switched by the toolbar's view icon (useReaderListView, per device):
// the GRID (default, ReaderDocumentGrid) — Delete behind each card's ⋯ menu, confirmed
// by DeleteDocumentDialog — and the LIST, whose rows uncover Delete when swiped left
// (SwipeToDeleteRow, no confirmation). Editing happens inside the open document.
// COLLECTIONS: the Documents / Journal toggle tiles (ReaderCollectionTiles) filter the
// list by texts.kind; New document while Journal is selected opens a journal draft.
// SORTING: the toolbar's sort icon (ReaderSortMenu) orders the list client-side
// (readerListOrder.ts → sortTexts). Both choices persist per device.
function ReaderPage() {
    usePageTitle("Reader");
    // Tier 2 time-of-day look (docs/SHELF_REDESIGN.md § 7b): sky-tint ground by day, slate
    // at night, like the Dictionary. Called ONCE here (it claims the CpcdPopup/status-bar
    // chrome) and passed down to every piece that paints a surface or text.
    const look = useTier2Look();
    const navigate = useNavigate();
    const slideNavigate = useSlideNavigate();
    const { user, isAuthenticated } = useAuth();

    const [texts, setTexts] = useState<Text[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // A failed swipe-delete; shown above the list without hiding it.
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // Grid vs list (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § List views).
    const [listView, setListView] = useReaderListView();
    // The grid's ⋯ → Delete target, awaiting DeleteDocumentDialog's confirmation.
    const [pendingDelete, setPendingDelete] = useState<Text | null>(null);

    // The Documents / Journal selection (always one; Documents by default) and the sort order
    // (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Collections" / § "Sorting").
    const [collection, setCollection] = useReaderCollection();
    const [sortKey, setSortKey] = useReaderListSort();
    // Where the list body slides in from after a collection change; null on first paint.
    const [slideFrom, setSlideFrom] = useState<"left" | "right" | null>(null);

    /**
     * Select a collection tile. Tapping the already-selected tile does nothing — there is
     * no deselected state to fall back to (unlike the Friends tiles).
     */
    const handleSelectCollection = useCallback((target: ReaderCollection) => {
        if (target === collection) return;
        setSlideFrom(READER_COLLECTION_ORDER[target] > READER_COLLECTION_ORDER[collection] ? "right" : "left");
        setCollection(target);
    }, [collection, setCollection]);

    // What the list draws: the selected collection, in the chosen order.
    const visibleTexts = useMemo(
        () => sortTexts(filterByCollection(texts, collection), sortKey),
        [texts, collection, sortKey],
    );

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

    // A blank draft; nothing is created server-side until its first Save. With the
    // Journal tile selected the draft is a journal entry (`?kind=journal`).
    const handleCreateNew = useCallback(() => {
        slideNavigate(newDocumentPath(collection === "journal" ? "journal" : "document"));
    }, [slideNavigate, collection]);

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

    // Grid ⋯ → Delete, once DeleteDocumentDialog has deleted it server-side: drop it
    // from the list (the dialog owns the request and shows its own error on failure).
    const handleConfirmedDelete = useCallback(() => {
        if (!pendingDelete) return;
        const deletedId = pendingDelete.id;
        setTexts(prev => prev.filter(t => t.id !== deletedId));
    }, [pendingDelete]);

    // A plain scrolling node page on the time-of-day ground (`look`, readerStyles.ts) in
    // the Friends panel's flat shapes: the header scrolls away with the list, and FooterSpacer keeps the
    // last row clear of the footer slab. (It used to be a fixed shell whose list
    // scrolled inside a 500px "sidebar" box — a leftover of the desktop layout.)
    return (
        <NodePage
            title="Reader"
            onBack={() => navigateBackOr(navigate, "/")}
            contentClassName="reader-page-root"
            surfaceColor={look.ground}
            headerTitleColor={look.ink}
        >
            <ReaderCollectionTiles collection={collection} onSelect={handleSelectCollection} />
            <ReaderListToolbar
                look={look}
                journalSelected={collection === "journal"}
                onCreateNew={handleCreateNew}
                sortKey={sortKey}
                onSortChange={setSortKey}
                view={listView}
                onViewChange={setListView}
            />
            <TextSidebar
                look={look}
                texts={visibleTexts}
                loading={loading}
                error={error}
                actionError={deleteError}
                onDismissActionError={() => setDeleteError(null)}
                onTextSelect={handleTextSelect}
                onDelete={handleDelete}
                view={listView}
                onRequestDelete={setPendingDelete}
                collection={collection}
                slideFrom={slideFrom}
            />
            <FooterSpacer />
            <DeleteDocumentDialog
                look={look}
                open={pendingDelete !== null}
                text={pendingDelete}
                onClose={() => setPendingDelete(null)}
                onSuccess={handleConfirmedDelete}
            />
        </NodePage>
    );
}

export default ReaderPage;
