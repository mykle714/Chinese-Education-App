import { useCallback, useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import InfoCardListRow from "./FlashcardsLearnPage/InfoCardListRow";
import DelayedCircularProgress from "../../components/DelayedCircularProgress";
import { API_BASE_URL } from "../../constants";
import { authHeader } from "../../utils/authHeader";
import type { UsedInItem, Language } from "../../types";

// How many items the card ships pre-enriched (findUsedInForCharacter's preview
// limit on lookupTerm / OnDeckVocabService). A preview that comes back FULL means
// there may be more to page through; a short preview is the whole list.
const PREVIEW_COUNT = 4;
// Window size per infinite-scroll fetch against /api/dictionary/used-in.
const PAGE_SIZE = 20;

interface UsedInPaginatedListProps {
    /** The single-character headword whose containing words we list. */
    character: string;
    language: Language;
    /** The ≤4-item preview shipped on the card; seeds the list to paint instantly. */
    initialItems: UsedInItem[];
    showPinyin: boolean;
    showPinyinColor?: boolean;
    onItemClick?: (item: UsedInItem) => void;
    /** Per-surface row class (cdp vs eip keep their distinct descriptive names). */
    rowClassName?: string;
}

/**
 * The single-char "Used In" list, shared by the eip "Used In" tab
 * (InfoCardPanelBody) and the cdp "Used In" section (VocabCardSections).
 *
 * Seeds from the card's embedded preview (no fetch for users who never expand),
 * then infinite-scrolls the rest via GET /api/dictionary/used-in?offset=&limit=,
 * where offset is the running item count so pages continue seamlessly after the
 * preview. hasMore starts true only when the preview came back full (== PREVIEW_COUNT).
 *
 * Layer: presentational + data-fetch UI component (shared feature component).
 */
export function UsedInPaginatedList({
    character,
    language,
    initialItems,
    showPinyin,
    showPinyinColor = true,
    onItemClick,
    rowClassName,
}: UsedInPaginatedListProps) {
    const [items, setItems] = useState<UsedInItem[]>(initialItems);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(initialItems.length >= PREVIEW_COUNT);

    // Refs mirror state so loadMore stays identity-stable as the list grows (the
    // IntersectionObserver below registers once and reads the live values here),
    // and so the token refresh never re-creates the fetcher (authHeader() reads
    // the live token at call time — see docs/TOKEN_EXPIRATION_IMPLEMENTATION.md).
    const itemsRef = useRef(items);
    itemsRef.current = items;
    const loadingRef = useRef(false);
    const hasMoreRef = useRef(hasMore);
    hasMoreRef.current = hasMore;

    // Reseed when the target word changes (cdp navigates to a new word, or the eip
    // swaps cards). Key on character + language, NOT on the initialItems array
    // identity (a fresh array every render would reset mid-scroll).
    useEffect(() => {
        setItems(initialItems);
        setHasMore(initialItems.length >= PREVIEW_COUNT);
        setLoading(false);
        loadingRef.current = false;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character, language]);

    const loadMore = useCallback(async () => {
        if (loadingRef.current || !hasMoreRef.current) return;
        loadingRef.current = true;
        setLoading(true);
        try {
            const offset = itemsRef.current.length;
            const res = await fetch(
                `${API_BASE_URL}/api/dictionary/used-in?character=${encodeURIComponent(character)}&offset=${offset}&limit=${PAGE_SIZE}`,
                { headers: authHeader(), credentials: "include" }
            );
            if (!res.ok) {
                setHasMore(false);
                hasMoreRef.current = false;
                return;
            }
            const data: { items: UsedInItem[]; hasMore: boolean } = await res.json();
            setItems((prev) => [...prev, ...data.items]);
            setHasMore(data.hasMore);
            hasMoreRef.current = data.hasMore;
        } catch {
            // Network failure ends the scroll rather than looping the sentinel.
            setHasMore(false);
            hasMoreRef.current = false;
        } finally {
            loadingRef.current = false;
            setLoading(false);
        }
    }, [character]);

    // Infinite scroll: when the sentinel row nears the viewport, pull the next page.
    // Default root (viewport) works inside both the cdp scroll area and the eip
    // bottom sheet; rootMargin pre-fetches slightly before it's fully visible.
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!hasMore) return;
        const el = sentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) loadMore();
            },
            { rootMargin: "120px" }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [hasMore, loadMore]);

    return (
        <Box className="used-in-list" sx={{ display: "flex", flexDirection: "column" }}>
            {items.map((item, index) => (
                <InfoCardListRow
                    key={`${item.vocabEntryId ?? "det"}-${item.entryKey}-${index}`}
                    className={rowClassName}
                    character={item.entryKey}
                    pinyin={item.pronunciation ?? ""}
                    definition={item.definition ?? ""}
                    size="sm"
                    showPinyin={showPinyin}
                    showPinyinColor={showPinyinColor}
                    // Only the very last row (once no more pages) drops its divider.
                    isLast={!hasMore && index === items.length - 1}
                    onClick={onItemClick ? () => onItemClick(item) : undefined}
                />
            ))}
            {hasMore && (
                <Box
                    ref={sentinelRef}
                    className="used-in-list__sentinel"
                    sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 40, padding: "8px" }}
                >
                    {loading && <DelayedCircularProgress size={20} delay={150} />}
                </Box>
            )}
        </Box>
    );
}

export default UsedInPaginatedList;
