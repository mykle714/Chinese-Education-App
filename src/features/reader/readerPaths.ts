// The `/reader/:id` value that means "a blank, not-yet-saved document".
// ReaderPage navigates here from New Document; ReaderDocumentPage opens it as a
// draft in edit mode and swaps the URL for the real id on the first Save.
// Server ids are UUIDs, so this can never collide with a saved document.
// Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Creating a document".
export const NEW_DOCUMENT_ID = "new";
export const NEW_DOCUMENT_PATH = `/reader/${NEW_DOCUMENT_ID}`;

/**
 * The new-draft path for a Reader collection (texts.kind, migration 194). A journal draft
 * carries `?kind=journal`, which ReaderDocumentPage sends on the first Save; a plain
 * document uses the bare path. Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Collections".
 */
export function newDocumentPath(kind: "document" | "journal"): string {
    return kind === "journal" ? `${NEW_DOCUMENT_PATH}?kind=journal` : NEW_DOCUMENT_PATH;
}
