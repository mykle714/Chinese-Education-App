import { useStoredChoice } from "./useStoredChoice";

/**
 * How the `/reader` document list is laid out (docs/USER_DOCUMENT_FEATURE_SUMMARY.md
 * § List views):
 *   'grid' — the DEFAULT: a 2-column grid of cards, the document's icon centred with its
 *            title below (ReaderDocumentGrid.tsx). Delete sits behind each card's ⋯ menu.
 *   'list' — the RowList of Rows (TextSidebar.tsx), swipe left to Delete.
 * Switched by the header icon on ReaderPage.
 *
 * Per DEVICE, like the open document's Text ⇄ Pinyin `displayMode` (useReaderSettings.ts)
 * — no account column. Kept out of useReaderSettings because that hook is the OPEN
 * document's settings and this one is only read by the list page.
 *
 * Layer: feature hook (src/features/reader). Depended on by: ReaderPage.tsx.
 */
export type ReaderListView = "grid" | "list";

const LIST_VIEWS: readonly ReaderListView[] = ["grid", "list"];

export function useReaderListView(): [ReaderListView, (view: ReaderListView) => void] {
    // Anything but a stored "list" (unset, a stale value) is the grid default.
    return useStoredChoice("reader.listView", LIST_VIEWS, "grid");
}
