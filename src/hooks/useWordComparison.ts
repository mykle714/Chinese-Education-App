import { useRef, useState } from "react";
import { API_BASE_URL } from "../constants";
import { authHeader } from "../utils/authHeader";
import { getBrowserTimezone } from "../minutePoints/minutePointsSync";
import type { Language, LongDefinitionPart } from "../types";

interface UseWordComparisonResult {
  comparison: string | null;   // the AI comparison paragraph, or null before a request / on failure
  // Embedded-Chinese runs GSA-segmented + pinyin-annotated (same treatment as longDefinition,
  // docs/WORD_COMPARE_FEATURE.md) — feed straight into <LongDefinitionDisplay>. Null when the
  // paragraph has no embedded Chinese (or before a request resolves).
  comparisonParts: LongDefinitionPart[] | null;
  loading: boolean;
  error: boolean;              // last request failed to complete (network/server) — retryable
  limitReached: boolean;       // server returned 429: shared daily AI-lookup cap hit
  limitMessage: string | null; // the server's user-facing limit message (when limitReached)
  compare: (wordA: string, wordB: string, language: Language) => void;
  reset: () => void;
}

/**
 * Fires `POST /api/dictionary/compare` for a pair of words — the eip Compare tab
 * (docs/WORD_COMPARE_FEATURE.md). The server canonically sorts the pair and caches the answer, so
 * repeat comparisons of the same two words (in either order) return instantly. Shares the
 * dictionary AI fallback's daily budget — a 429 surfaces the same "daily limit reached" shape as
 * `useDictionarySearch`'s `askAi`.
 */
export function useWordComparison(): UseWordComparisonResult {
  const [comparison, setComparison] = useState<string | null>(null);
  const [comparisonParts, setComparisonParts] = useState<LongDefinitionPart[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  // Guards a stale response from an earlier pair overwriting a newer request's result if the user
  // swaps slot B again before the first request resolves.
  const requestIdRef = useRef(0);

  const reset = () => {
    requestIdRef.current += 1;
    setComparison(null);
    setComparisonParts(null);
    setLoading(false);
    setError(false);
    setLimitReached(false);
    setLimitMessage(null);
  };

  const compare = (wordA: string, wordB: string, language: Language) => {
    const a = wordA.trim();
    const b = wordB.trim();
    if (!a || !b) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setComparison(null);
    setComparisonParts(null);
    setError(false);
    setLimitReached(false);
    setLimitMessage(null);

    fetch(`${API_BASE_URL}/api/dictionary/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      credentials: "include",
      // tz lets the server bound the shared daily limit to the caller's local streak-day.
      body: JSON.stringify({ wordA: a, wordB: b, language, tz: getBrowserTimezone() }),
    })
      .then(async (res) => {
        if (requestId !== requestIdRef.current) return null; // superseded by a newer request
        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          setLimitReached(true);
          setLimitMessage(data.error || "You've reached your daily limit of AI lookups.");
          return null;
        }
        if (!res.ok) return Promise.reject(res);
        return res.json();
      })
      .then((data) => {
        if (!data || requestId !== requestIdRef.current) return;
        setComparison(data.comparison || null);
        setComparisonParts(data.comparisonParts || null);
        if (!data.comparison) setError(true); // disabled feature / transient model failure
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        console.error("Error generating word comparison:", err);
        setError(true);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  };

  return { comparison, comparisonParts, loading, error, limitReached, limitMessage, compare, reset };
}
