import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../constants";
import { hasChinese } from "../utils/textUtils";
import { authHeader } from "../utils/authHeader";
import { getBrowserTimezone } from "../minutePoints/minutePointsSync";
import type { DictionaryEntry, AiDictionaryEntry } from "../types";

export interface SegmentGroup {
  segment: string;
  exactEntries: DictionaryEntry[];
  prefixEntries: DictionaryEntry[];
}

interface UseDictionarySearchResult {
  searchInput: string;
  setSearchInput: (value: string) => void;
  debouncedSearchTerm: string;
  entries: DictionaryEntry[];
  segmentGroups: SegmentGroup[];
  isSegmentMode: boolean;
  loading: boolean;
  error: string | null;
  page: number;
  setPage: (page: number) => void;
  total: number;
  totalPages: number;
  clearSearch: () => void;
  // AI synthetic-entry fallback (docs/DICTIONARY_AI_FALLBACK_SEARCH.md). Only meaningful for a
  // zero-result pinyin query; the community search bar ignores these.
  aiEntry: AiDictionaryEntry | null; // a cached or just-generated AI answer to render (orange card)
  canAskAi: boolean;                 // server says the query is valid pinyin with no real match
  askingAi: boolean;                 // an AI generation request is in flight
  aiNoMatch: boolean;                // the AI resolved with no likely meaning (fresh empty — live or cached)
  aiError: boolean;                  // the last AI ask failed to complete (network/server error) — retryable
  aiLimitReached: boolean;           // server returned 429: user hit the daily AI-lookup cap
  aiLimitMessage: string | null;     // the server's user-facing limit message (when aiLimitReached)
  askAi: () => void;                 // fire POST /api/dictionary/ai-entry for the current term
}

/**
 * Shared dictionary-search behavior for DictionaryPage and CommunitySearchBar: a 400ms-debounced
 * query that switches between CJK segment mode (`GET /api/dictionary/segment`, one exact +
 * "starts with" group per sub-word segment) and plain paginated search (`GET
 * /api/dictionary/search`, honors numbered-pinyin queries like "jian4 shen1" — see
 * server/dal/implementations/DictionaryDAL.ts `buildNumberedPinyinPattern`) for everything else.
 * `limit` defaults to the dictionary page's page size; callers that don't paginate (e.g. the
 * community search bar) can pass a smaller one and ignore `page`/`totalPages`.
 *
 * `initial` seeds the query + page on mount so a caller can RESTORE prior state (the
 * dictionary page persists these across a drill-in to a cdp and back). The initial
 * debounce pass is skipped from the "new search → reset to page 1" rule so a restored
 * page survives mount.
 */
export function useDictionarySearch(
  limit: number = 50,
  initial?: { search?: string; page?: number },
): UseDictionarySearchResult {
  const [searchInput, setSearchInputState] = useState(initial?.search ?? "");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(initial?.search ?? "");
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [segmentGroups, setSegmentGroups] = useState<SegmentGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initial?.page ?? 1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [aiEntry, setAiEntry] = useState<AiDictionaryEntry | null>(null);
  const [canAskAi, setCanAskAi] = useState(false);
  const [askingAi, setAskingAi] = useState(false);
  const [aiNoMatch, setAiNoMatch] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [aiLimitReached, setAiLimitReached] = useState(false);
  const [aiLimitMessage, setAiLimitMessage] = useState<string | null>(null);

  const isSegmentMode = hasChinese(debouncedSearchTerm);

  const setSearchInput = (value: string) => setSearchInputState(value);

  // Debounce search input. The first pass (on mount) must NOT reset the page — it
  // would clobber a restored `initial.page`. Only genuine user edits after mount
  // reset to page 1.
  const firstDebounce = useRef(true);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchInput);
      if (firstDebounce.current) {
        firstDebounce.current = false;
        return;
      }
      setPage(1); // Reset to first page on new search
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Fetch search results — switches between segment mode (CJK input) and regular paginated search.
  useEffect(() => {
    let cancelled = false;

    const fetchResults = async () => {
      // A new search invalidates any prior AI-fallback state (button + rendered card + notes).
      setAiEntry(null);
      setCanAskAi(false);
      setAiNoMatch(false);
      setAiError(false);
      setAiLimitReached(false);
      setAiLimitMessage(null);

      if (!debouncedSearchTerm.trim()) {
        setEntries([]);
        setSegmentGroups([]);
        setTotal(0);
        setTotalPages(1);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        if (hasChinese(debouncedSearchTerm)) {
          const response = await fetch(
            `${API_BASE_URL}/api/dictionary/segment?text=${encodeURIComponent(debouncedSearchTerm)}`,
            { headers: authHeader(), credentials: "include" },
          );
          if (cancelled) return;
          if (response.ok) {
            const data = await response.json();
            setSegmentGroups(data.segments || []);
            setEntries([]);
            // AI fallback for a Chinese string with no complete-word match (breakdown-only results).
            setAiEntry(data.aiEntry || null);
            setCanAskAi(!!data.canAskAi);
            setAiNoMatch(!!data.aiNoMatch); // fresh cached empty → show the "no match" note
          } else {
            const errorData = await response.json();
            setError(errorData.error || "Failed to segment search");
          }
        } else {
          const response = await fetch(
            `${API_BASE_URL}/api/dictionary/search?term=${encodeURIComponent(debouncedSearchTerm)}&page=${page}&limit=${limit}`,
            { headers: authHeader(), credentials: "include" },
          );
          if (cancelled) return;
          if (response.ok) {
            const data = await response.json();
            setEntries(data.entries || []);
            setSegmentGroups([]);
            setTotal(data.pagination?.total || 0);
            setTotalPages(data.pagination?.totalPages || 1);
            // AI fallback flags — a cached answer renders immediately; canAskAi offers the button;
            // aiNoMatch (fresh cached empty) shows the "couldn't find a match" note.
            setAiEntry(data.aiEntry || null);
            setCanAskAi(!!data.canAskAi);
            setAiNoMatch(!!data.aiNoMatch);
          } else {
            const errorData = await response.json();
            setError(errorData.error || "Failed to search dictionary");
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Error searching dictionary:", err);
        setError("An error occurred while searching");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchResults();
    return () => { cancelled = true; };
    // `token` intentionally omitted: authHeader() reads it at call time, so a
    // silent refresh (~every 15 min) doesn't re-run the search. See CLAUDE.md
    // "Never reload on token refresh".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchTerm, page, limit]);

  const clearSearch = () => {
    setSearchInputState("");
    setDebouncedSearchTerm("");
    setEntries([]);
    setSegmentGroups([]);
    setAiEntry(null);
    setCanAskAi(false);
    setAiNoMatch(false);
    setAiError(false);
    setAiLimitReached(false);
    setAiLimitMessage(null);
  };

  // Button-triggered AI synthetic-entry generation for the current (zero-result) pinyin query.
  const askAi = () => {
    const term = debouncedSearchTerm.trim();
    if (!term || askingAi) return;
    setAskingAi(true);
    setAiNoMatch(false);
    setAiError(false);
    fetch(`${API_BASE_URL}/api/dictionary/ai-entry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      credentials: "include",
      // tz lets the server bound the daily limit to the caller's local streak-day (app convention).
      body: JSON.stringify({ term, tz: getBrowserTimezone() }),
    })
      .then(async (res) => {
        // 429 = daily AI-lookup cap hit. Read the server's user-facing message and surface it as a
        // dedicated limit state (distinct from a retryable network error). Drop canAskAi so the
        // button is replaced by the limit note rather than inviting a pointless retry.
        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          setAiLimitReached(true);
          setAiLimitMessage(data.error || "You've reached your daily limit of AI lookups.");
          setCanAskAi(false);
          return null;
        }
        if (!res.ok) return Promise.reject(res);
        return res.json();
      })
      .then((data) => {
        if (!data) return; // handled above (limit reached)
        setAiEntry(data.entry || null);
        setCanAskAi(false); // whether or not a meaning was found, the ask is now resolved
        setAiNoMatch(!data.entry); // resolved but the model found no likely meaning
      })
      .catch((err) => {
        // Network/server failure (not a "no meaning" result). Surface it and keep canAskAi so the
        // button stays for an obvious retry — otherwise the failure is silent.
        console.error("Error generating AI dictionary entry:", err);
        setAiError(true);
      })
      .finally(() => setAskingAi(false));
  };

  return {
    searchInput,
    setSearchInput,
    debouncedSearchTerm,
    entries,
    segmentGroups,
    isSegmentMode,
    loading,
    error,
    page,
    setPage,
    total,
    totalPages,
    clearSearch,
    aiEntry,
    canAskAi,
    askingAi,
    aiNoMatch,
    aiError,
    aiLimitReached,
    aiLimitMessage,
    askAi,
  };
}
