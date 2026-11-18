import type { Text } from "../../types";
import type { RampHue } from "../../theme/colors";
import type { TextKind } from "../../../server/contracts/wire";

/**
 * The `/reader` list's FILTER (collection tiles) and ORDER (header sort menu), as pure
 * functions so ReaderPage stays a thin host and both can be unit-tested.
 *
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Collections (Documents / Journal)" and
 * § "Sorting". Layer: feature util (src/features/reader). Depended on by: ReaderPage.tsx,
 * ReaderCollectionTiles.tsx, ReaderSortMenu.tsx, useReaderCollection.ts,
 * useReaderListSort.ts.
 */

// ── Collections ─────────────────────────────────────────────────────────────

/**
 * Which documents the list shows: the `texts.kind` (migration 194) of the selected tile.
 * One tile is ALWAYS selected — Documents by default — so there is no "everything" view
 * (owner, 2026-11-17). Built-in (system) texts are 'document', so they appear under
 * Documents.
 */
export type ReaderCollection = TextKind;

export const READER_COLLECTIONS: readonly ReaderCollection[] = ["document", "journal"];

/**
 * Carousel position of each collection, for the list body's slide direction (the Friends
 * tab's FRIENDS_VIEW_ORDER rule: moving right in tile order slides in from the right).
 */
export const READER_COLLECTION_ORDER: Record<ReaderCollection, number> = { document: 0, journal: 1 };

export function filterByCollection(texts: Text[], collection: ReaderCollection): Text[] {
    // `?? "document"` guards a row from a server that predates migration 194.
    return texts.filter((t) => (t.kind ?? "document") === collection);
}

// ── Sorting ─────────────────────────────────────────────────────────────────

export type ReaderSortKey = "newest" | "oldest" | "title" | "edited" | "length";

/** Menu order and labels for ReaderSortMenu. */
export const READER_SORT_OPTIONS: ReadonlyArray<{ key: ReaderSortKey; label: string; icon: string }> = [
    { key: "newest", label: "Newest first", icon: "arrow_downward" },
    { key: "oldest", label: "Oldest first", icon: "arrow_upward" },
    { key: "title", label: "Title A–Z", icon: "sort_by_alpha" },
    { key: "edited", label: "Recently edited", icon: "edit_calendar" },
    { key: "length", label: "Longest first", icon: "notes" },
];

export const READER_SORT_KEYS: readonly ReaderSortKey[] = READER_SORT_OPTIONS.map((o) => o.key);

/** A timestamp as epoch ms; an unparseable / missing one sorts as oldest. */
function timeOf(iso: string | null | undefined): number {
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(ms) ? 0 : ms;
}

/**
 * A NEW array in `key` order. Every key falls back to newest-first on a tie, so the
 * order is total and stable across renders.
 *
 * Title uses `localeCompare` in the document's own language: for zh the ICU collation
 * orders Han titles by pinyin, which is what a learner scanning A–Z expects.
 */
export function sortTexts(texts: Text[], key: ReaderSortKey): Text[] {
    const newestFirst = (a: Text, b: Text) => timeOf(b.createdAt) - timeOf(a.createdAt);
    const compare: Record<ReaderSortKey, (a: Text, b: Text) => number> = {
        newest: newestFirst,
        oldest: (a, b) => -newestFirst(a, b),
        title: (a, b) => a.title.localeCompare(b.title, a.language) || newestFirst(a, b),
        // `updatedAt` is NOT NULL since migration 194; createdAt covers an older server.
        edited: (a, b) => timeOf(b.updatedAt ?? b.createdAt) - timeOf(a.updatedAt ?? a.createdAt) || newestFirst(a, b),
        length: (a, b) => (b.characterCount ?? 0) - (a.characterCount ?? 0) || newestFirst(a, b),
    };
    return [...texts].sort(compare[key]);
}

// ── Journal date ────────────────────────────────────────────────────────────

/**
 * A journal entry's date line — its `createdAt` in the viewer's locale, e.g.
 * "Tue, Nov 17, 2026". Empty when the timestamp is missing or unparseable.
 */
export function formatJournalDate(iso: string | null | undefined): string {
    const ms = iso ? Date.parse(iso) : NaN;
    if (Number.isNaN(ms)) return "";
    return new Date(ms).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

/** True for a journal entry (texts.kind = 'journal'). */
export function isJournal(text: Text): boolean {
    return text.kind === "journal";
}

/**
 * A document's avatar hue in both list views: yellow for a journal entry (the Journal
 * tile's hue), blue for the learner's own document, grey for a built-in text.
 */
export function readerDocumentHue(text: Text): RampHue {
    if (isJournal(text)) return "yel";
    return text.isUserCreated ? "blu" : "grey";
}

/** The avatar's fallback glyph when the document has no picked icon (texts."iconId"). */
export function readerDocumentGlyph(text: Text): string {
    if (isJournal(text)) return "auto_stories";
    return text.isUserCreated ? "description" : "menu_book";
}
