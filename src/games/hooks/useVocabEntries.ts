import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../api/http";

// Distinct from the canonical src/types VocabEntry: this mirrors the raw
// /api/vocabentries payload shape games consume (note string id), so it is named
// separately to avoid masquerading as the shared VocabEntry model.
export interface GameVocabEntry {
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
    entries: GameVocabEntry[];
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
    const [entries, setEntries] = useState<GameVocabEntry[]>([]);
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

        apiGet<GameVocabEntry[]>("/api/vocabentries", { params })
            .then((data) => {
                if (cancelled) return;
                setEntries(data ?? []);
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
