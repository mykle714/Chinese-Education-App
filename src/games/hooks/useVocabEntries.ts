import { useCallback, useEffect, useState } from "react";
import apiClient from "../../utils/apiClient";

export interface VocabEntry {
    id: string;
    userId: string;
    entryKey: string;
    definition?: string | null;
    language: string;
    category?: string | null;
    pronunciation?: string | null;
    breakdown?: unknown;
    createdAt?: string;
    updatedAt?: string;
}

export interface UseVocabEntriesOptions {
    /** Optional category filter — maps to the existing /api/vocabentries query param. */
    category?: string;
    /** Optional language filter — maps to the existing /api/vocabentries query param. */
    language?: string;
    /** When false, the hook skips fetching (useful for gated/unauth flows). */
    enabled?: boolean;
}

export interface UseVocabEntriesResult {
    entries: VocabEntry[];
    loading: boolean;
    error: Error | null;
    refetch: () => void;
}

/**
 * Read-only hook over the existing `/api/vocabentries` endpoint.
 *
 * Games use this to surface the user's saved vocabulary (vet) without
 * reimplementing the HTTP plumbing each FlashcardsLearnPage / Decks page
 * already owns.
 */
export function useVocabEntries(options: UseVocabEntriesOptions = {}): UseVocabEntriesResult {
    const { category, language, enabled = true } = options;
    const [entries, setEntries] = useState<VocabEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [refetchToken, setRefetchToken] = useState(0);

    const refetch = useCallback(() => setRefetchToken((n) => n + 1), []);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;

        setLoading(true);
        setError(null);

        const params: Record<string, string> = {};
        if (category) params.category = category;
        if (language) params.language = language;

        apiClient
            .get<VocabEntry[]>("/api/vocabentries", { params })
            .then((res) => {
                if (cancelled) return;
                setEntries(res.data ?? []);
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
    }, [category, language, enabled, refetchToken]);

    return { entries, loading, error, refetch };
}
