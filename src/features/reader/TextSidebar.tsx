import { useState } from "react";
import { Box, Typography, useMediaQuery } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { Row, RowList } from "../../components/primitives";
import SwipeToDeleteRow from "./SwipeToDeleteRow";
import ReaderDocumentGrid from "./ReaderDocumentGrid";
import type { ReaderListView } from "./useReaderListView";
import type { Text } from "../../types";
import { readerMessageSx, readerMutedTextSx } from "./readerStyles";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import { iconImageUrl } from "../../cardIcons/cardIconLayout";
import { formatJournalDate, isJournal, readerDocumentGlyph, readerDocumentHue, type ReaderCollection } from "./readerListOrder";

/** The collection swap's slide — the Friends tab's (FriendsBody VIEW_SLIDE_*). */
const COLLECTION_SLIDE_MS = 280;
const COLLECTION_SLIDE_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const slideInFromRight = keyframes`from { transform: translateX(100%); } to { transform: translateX(0); }`;
const slideInFromLeft = keyframes`from { transform: translateX(-100%); } to { transform: translateX(0); }`;

/** Empty-state copy per collection. */
const EMPTY_MESSAGE: Record<ReaderCollection, string> = {
    document: "No documents yet.",
    journal: "No journal entries yet. Tap New entry to write one.",
};

interface TextSidebarProps {
    /** The page's time-of-day look (ReaderPage → useTier2Look): rows, cards, copy colours. */
    look: Tier2Look;
    /** Already filtered to `collection` and sorted (ReaderPage, readerListOrder.ts). */
    texts: Text[];
    loading: boolean;
    error: string | null;
    // A failed swipe-delete, shown above the list (the list itself stays).
    actionError: string | null;
    onDismissActionError: () => void;
    onTextSelect: (text: Text) => void;
    // LIST view: swipe-left → Delete. Deletes immediately (iPhone style, no confirmation).
    onDelete: (text: Text) => void;
    // Which body to draw (the toolbar's grid/list toggle, useReaderListView.ts).
    view: ReaderListView;
    // GRID view: Delete from a card's ⋯ menu — ReaderPage confirms first.
    onRequestDelete: (text: Text) => void;
    /** The selected collection tile (useReaderCollection.ts). Keys the slide + empty copy. */
    collection: ReaderCollection;
    /** Where the body enters from after a collection change; null = no slide (first paint). */
    slideFrom: "left" | "right" | null;
}

/**
 * The Reader's document list (`/reader`, rendered by ReaderPage) in the Friends panel's
 * flat look on the Tier 2 time-of-day ground (readerStyles.ts):
 *
 *   - ABOVE it (rendered by ReaderPage, not here): the Documents / Journal selector
 *     (ReaderCollectionTiles) and the list toolbar (ReaderListToolbar: New document,
 *     sort, grid/list). Changing the collection slides this body in from the side the new
 *     tile sits on (Friends' carousel rule) — `collection` + `slideFrom`.
 *   - Below it, ONE of two bodies, by `view` (the header toggle on ReaderPage,
 *     useReaderListView.ts): the GRID (default) is ReaderDocumentGrid — 2-column cards,
 *     centred icon, title below, Delete behind a ⋯ menu with a confirmation; the LIST is
 *     described next.
 *   - LIST: a `RowList` of `Row`s on the look's surface (white by day, slate at night — `tones`) (the shelf system's `.rw`): a 36px pastel avatar
 *     glyph (or the document's picked icon, texts."iconId"), the title, and a chevron
 *     because the row navigates. A journal entry (texts.kind = 'journal') wears the
 *     yellow avatar and its `createdAt` date as the subtitle. A learner's own document
 *     wears the blue avatar and can be swiped left to Delete (SwipeToDeleteRow); a
 *     built-in text wears grey and cannot.
 *   - Loading / empty / error states are plain text lines, as on the Friends board.
 *
 * Despite its name this has not been a sidebar since the Reader went mobile-only; it is
 * the list body of ReaderPage. Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Frontend.
 * Layer: feature view (src/features/reader).
 */
function TextSidebar({
    look,
    texts,
    loading,
    error,
    actionError,
    onDismissActionError,
    onTextSelect,
    onDelete,
    view,
    onRequestDelete,
    collection,
    slideFrom,
}: TextSidebarProps) {
    // At most one row is swiped open at a time; opening another closes this one.
    const [openRowId, setOpenRowId] = useState<string | null>(null);
    const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
    return (
        <Box className="reader-page-sidebar-content" sx={{ display: "flex", flexDirection: "column" }}>

            {error && (
                <Typography className="reader-page-sidebar-error" sx={{ ...readerMessageSx(look), px: "22px", pt: 1.5 }}>
                    {error}
                </Typography>
            )}

            {/* Delete failure (the row is restored by ReaderPage). Tap to dismiss — the
                Friends panel's error lines carry no close button either. */}
            {actionError && (
                <Typography
                    className="reader-page-sidebar-action-error"
                    onClick={onDismissActionError}
                    sx={{ ...readerMessageSx(look), px: "22px", pt: 1.5, cursor: "pointer" }}
                >
                    {actionError}
                </Typography>
            )}

            {/* Loading text rather than a spinner: the list is one small query and a
                spinner flashes more than it informs (same call as the Friends board). */}
            {loading && (
                <Typography className="reader-page-sidebar-loading" sx={readerMutedTextSx(look)}>Loading…</Typography>
            )}

            {/* The swapped area. `key={collection}` remounts the body so its slide plays;
                `overflow: hidden` keeps it from painting over the tiles mid-slide. */}
            <Box className="reader-page-sidebar-collection-viewport" sx={{ overflow: "hidden" }}>
            <Box
                key={collection}
                className={`reader-page-sidebar-collection reader-page-sidebar-collection--${collection}`}
                sx={slideFrom && !reduceMotion
                    ? { animation: `${slideFrom === "right" ? slideInFromRight : slideInFromLeft} ${COLLECTION_SLIDE_MS}ms ${COLLECTION_SLIDE_EASING}` }
                    : undefined}
            >
            {!loading && !error && texts.length === 0 && (
                <Typography className="reader-page-sidebar-empty" sx={readerMutedTextSx(look)}>
                    {EMPTY_MESSAGE[collection]}
                </Typography>
            )}

            {/* Texts list — each user document is a SwipeToDeleteRow (swipe left →
            Delete). No per-row edit: content is edited inside the open document. */}
            {!loading && !error && texts.length > 0 && view === "grid" && (
                <ReaderDocumentGrid look={look} texts={texts} onTextSelect={onTextSelect} onRequestDelete={onRequestDelete} />
            )}

            {!loading && !error && texts.length > 0 && view === "list" && (
                <RowList className="reader-page-sidebar-texts-list">
                    {texts.map((text) => {
                        const row = (
                            <Row
                                className="reader-page-sidebar-text-button"
                                icon={readerDocumentGlyph(text)}
                                // The learner's picked icon (texts."iconId") replaces the
                                // glyph; the glyph stays the fallback for documents without one.
                                iconSrc={text.iconId ? iconImageUrl(text.iconId) : undefined}
                                hue={readerDocumentHue(text)}
                                title={text.title}
                                // A journal entry's date (its createdAt); other documents have no subtitle.
                                subtitle={isJournal(text) ? formatJournalDate(text.createdAt) : undefined}
                                chevron
                                tones={look}
                                onClick={() => onTextSelect(text)}
                            />
                        );
                        return (
                            <Box className="reader-page-sidebar-text-item" key={text.id}>
                                {text.isUserCreated ? (
                                    <SwipeToDeleteRow
                                        groundColor={look.ground}
                                        open={openRowId === text.id}
                                        onOpenChange={(isOpen) => setOpenRowId(isOpen ? text.id : null)}
                                        onDelete={() => {
                                            setOpenRowId(null);
                                            onDelete(text);
                                        }}
                                    >
                                        {row}
                                    </SwipeToDeleteRow>
                                ) : row}
                            </Box>
                        );
                    })}
                </RowList>
            )}
            </Box>
            </Box>
        </Box>
    );
}

export default TextSidebar;
