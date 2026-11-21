/**
 * EipAddKey's sizes, in their own module so another key can be built to the same recipe
 * without importing the component file (React fast refresh wants component files to
 * export only components).
 *
 * `regular` is the design's (the eip trail row). `compact` is for a tight stack — the
 * Reader keycap's header controls when a long headword leaves no room side by side
 * (2026-11-17). Each size keeps the press arithmetic: an Add key's rest lift + lip, and an
 * Added! key's rest drop + lip, both equal `sink`, so held it bottoms out exactly where
 * the lip ended.
 *
 * Depended on by: EipAddKey.tsx, src/reading/ReaderMoreInfoKey.tsx (same lip,
 * press, type and compact width, so the pair reads as one set), src/components/
 * VocabDisplayCard.tsx's caller (ReaderDocumentPage, the stacked gap).
 * Docs: docs/EIP_SHEET_GESTURES.md § Add key.
 */
export type EipAddKeySize = "regular" | "compact";

export const EIP_ADD_KEY_SIZES = {
    regular: { width: 92, lipAdd: 5, lipAdded: 2, sink: 4, restAddY: -1, restAddedY: 2, padding: "6px 11px 6px 10px", radius: 12, fontSize: 13, icon: 18, gap: 5 },
    compact: { width: 80, lipAdd: 4, lipAdded: 2, sink: 3, restAddY: -1, restAddedY: 1, padding: "4px 9px 4px 8px", radius: 11, fontSize: 12, icon: 16, gap: 4 },
} as const;
