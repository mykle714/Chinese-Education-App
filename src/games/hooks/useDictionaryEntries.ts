import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../api/http";

export interface DictionaryEntry {
    id: string;
    word1: string;
    pronunciation?: string | null;
    definition?: string | null;
    difficultyTag?: string | null;
    [key: string]: unknown;
}

export interface UseDictionaryEntriesOptions {
    /** Terms to look up — one request per term (parallelized). */
    terms?: string[];
    /** When false, the hook skips fetching. */
    enabled?: boolean;
}

export interface UseDictionaryEntriesResult {
    entries: DictionaryEntry[];
    loading: boolean;
    error: Error | null;
    refetch: () => void;
}

/**
 * Read-only hook over `/api/dictionary/lookup/:term` (det). Issues one request
 * per term in parallel and returns the successful matches. Games use this to
 * enrich vocab cards with definitions / hsk level / rationale data without
 * reimplementing fetch plumbing.
 */
export function useDictionaryEntries(options: UseDictionaryEntriesOptions = {}): UseDictionaryEntriesResult {
    const { terms, enabled = true } = options;
    const [entries, setEntries] = useState<DictionaryEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [refetchToken, setRefetchToken] = useState(0);

    const refetch = useCallback(() => setRefetchToken((n) => n + 1), []);

    // Stable cache key so we only refetch when the term set actually changes.
    const termsCacheKey = terms ? terms.slice().sort().join(" ") : "";

    useEffect(() => {
        if (!enabled || !terms || terms.length === 0) {
            setEntries([]);
            return;
        }
        let cancelled = false;

        setLoading(true);
        setError(null);

        const lookups = terms.map((term) =>
            apiGet<DictionaryEntry>(`/api/dictionary/lookup/${encodeURIComponent(term)}`)
                // Swallow individual 404s — a missing term isn't an error for the whole batch.
                .catch(() => null)
        );

        Promise.all(lookups)
            .then((results) => {
                if (cancelled) return;
                setEntries(results.filter((r): r is DictionaryEntry => r !== null));
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [termsCacheKey, enabled, refetchToken]);

    return { entries, loading, error, refetch };
}
