import { useState } from "react";
import { Box, Typography } from "@mui/material";
import { Bento, BentoTile } from "../../components/bento";
import { Row, RowList } from "../../components/primitives";
import SwipeToDeleteRow from "./SwipeToDeleteRow";
import type { Text } from "../../types";
import { readerMessageSx, readerMutedTextSx } from "./readerStyles";
import { iconImageUrl } from "../../cardIcons/cardIconLayout";

interface TextSidebarProps {
    texts: Text[];
    loading: boolean;
    error: string | null;
    // A failed swipe-delete, shown above the list (the list itself stays).
    actionError: string | null;
    onDismissActionError: () => void;
    onTextSelect: (text: Text) => void;
    onCreateNew: () => void;
    // Swipe-left → Delete. Deletes immediately (iPhone style, no confirmation).
    onDelete: (text: Text) => void;
}

/**
 * The Reader's document list (`/reader`, rendered by ReaderPage) in the Friends panel's
 * flat look (readerStyles.ts):
 *
 *   - ONE half-width `compact` Bento tile on top, in the LEFT column — "New document" —
 *     dressed exactly like the Friends tab's action tiles (FriendActionTiles): `compact`
 *     height, title only (no subtitle), the title at the tile's bottom-left, the ghost
 *     glyph top-right. Creating is a destination-shaped tap, not an MUI contained button.
 *     Half width, no subtitle (owner's call 2026-11-17): the full-width `low` tile with
 *     a subtitle read as too big for the page's one action.
 *   - A `RowList` of white `Row`s below (the shelf system's `.rw`): a 36px pastel avatar
 *     glyph (or the document's picked icon, texts."iconId"), the title, and a chevron
 *     because the row navigates. A learner's own document
 *     wears the blue avatar and can be swiped left to Delete (SwipeToDeleteRow); a
 *     built-in text wears grey and cannot.
 *   - Loading / empty / error states are plain text lines, as on the Friends board.
 *
 * Despite its name this has not been a sidebar since the Reader went mobile-only; it is
 * the list body of ReaderPage. Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Frontend.
 * Layer: feature view (src/features/reader).
 */
function TextSidebar({
    texts,
    loading,
    error,
    actionError,
    onDismissActionError,
    onTextSelect,
    onCreateNew,
    onDelete,
}: TextSidebarProps) {
    // At most one row is swiped open at a time; opening another closes this one.
    const [openRowId, setOpenRowId] = useState<string | null>(null);
    return (
        <Box className="reader-page-sidebar-content" sx={{ display: "flex", flexDirection: "column" }}>
            {/* New document — opens `/reader/new`, a blank draft in edit mode. One column
                wide; as the grid's only child it lands in the left column on its own. */}
            <Bento className="reader-page-sidebar-actions">
                <BentoTile
                    className="reader-page-sidebar-new-document-tile"
                    title="New document"
                    hue="blu"
                    icon="edit_note"
                    variant="compact"
                    onClick={onCreateNew}
                />
            </Bento>

            {error && (
                <Typography className="reader-page-sidebar-error" sx={{ ...readerMessageSx, px: "22px", pt: 1.5 }}>
                    {error}
                </Typography>
            )}

            {/* Delete failure (the row is restored by ReaderPage). Tap to dismiss — the
                Friends panel's error lines carry no close button either. */}
            {actionError && (
                <Typography
                    className="reader-page-sidebar-action-error"
                    onClick={onDismissActionError}
                    sx={{ ...readerMessageSx, px: "22px", pt: 1.5, cursor: "pointer" }}
                >
                    {actionError}
                </Typography>
            )}

            {/* Loading text rather than a spinner: the list is one small query and a
                spinner flashes more than it informs (same call as the Friends board). */}
            {loading && (
                <Typography className="reader-page-sidebar-loading" sx={readerMutedTextSx}>Loading…</Typography>
            )}

            {!loading && !error && texts.length === 0 && (
                <Typography className="reader-page-sidebar-empty" sx={readerMutedTextSx}>
                    No documents yet.
                </Typography>
            )}

            {/* Texts list — each user document is a SwipeToDeleteRow (swipe left →
            Delete). No per-row edit: content is edited inside the open document. */}
            {!loading && !error && texts.length > 0 && (
                <RowList className="reader-page-sidebar-texts-list">
                    {texts.map((text) => {
                        const row = (
                            <Row
                                className="reader-page-sidebar-text-button"
                                icon={text.isUserCreated ? "description" : "menu_book"}
                                // The learner's picked icon (texts."iconId") replaces the
                                // glyph; the glyph stays the fallback for documents without one.
                                iconSrc={text.iconId ? iconImageUrl(text.iconId) : undefined}
                                hue={text.isUserCreated ? "blu" : "grey"}
                                title={text.title}
                                chevron
                                onClick={() => onTextSelect(text)}
                            />
                        );
                        return (
                            <Box className="reader-page-sidebar-text-item" key={text.id}>
                                {text.isUserCreated ? (
                                    <SwipeToDeleteRow
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
    );
}

export default TextSidebar;
