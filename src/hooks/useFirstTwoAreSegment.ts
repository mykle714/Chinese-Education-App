import { useEffect, useState } from "react";
import { API_BASE_URL } from "../constants";
import { authHeader } from "../utils/authHeader";
import { isLatinScriptLang } from "../components/ForeignText";
import type { Language } from "../types";

// Module-level cache of "does the 2-char prefix exist as a det headword", keyed
// by `${prefix}|${language}`. Shared across every hook instance so the same word
// (e.g. both compare slots showing 过来人, or re-mounting the cdp) resolves once.
const segmentCache = new Map<string, boolean>();

/**
 * Whether the FIRST TWO characters of a 3-character CJK word themselves form a
 * dictionary word — the signal CPCDBlock uses to pick a 3-char triangle's
 * orientation (inverted 2-top/1-bottom when true; see CPCDBlock).
 *
 * "First two chars are a segment" is an exact-match existence check on the
 * 2-char prefix (e.g. 过来 inside 过来人): GET /api/dictionary/lookup/过来 returns
 * 200 when it's a real headword, 404 otherwise. Running the full GSA on the whole
 * word is no use here — the word itself is the longest match, so it never reveals
 * its own internal split.
 *
 * Returns false (no fetch) for anything that isn't an eligible 3-char CJK word:
 * pass `word = null` to disable it entirely (e.g. non-block layouts).
 *
 * Follows the "never key on token" rule: the token is read at call time via
 * authHeader() inside the fetch, and the effect deps are the stable prefix/key.
 */
export function useFirstTwoAreSegment(
    word: string | null | undefined,
    language?: Language,
): boolean {
    const chars = word ? [...word] : [];
    const eligible = chars.length === 3 && !isLatinScriptLang(language);
    const prefix = eligible ? chars.slice(0, 2).join("") : "";
    const cacheKey = `${prefix}|${language ?? ""}`;

    const [result, setResult] = useState<boolean>(() =>
        eligible ? segmentCache.get(cacheKey) ?? false : false,
    );

    useEffect(() => {
        if (!eligible) {
            setResult(false);
            return;
        }
        const cached = segmentCache.get(cacheKey);
        if (cached !== undefined) {
            setResult(cached);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(
                    `${API_BASE_URL}/api/dictionary/lookup/${encodeURIComponent(prefix)}`,
                    { headers: authHeader(), credentials: "include" },
                );
                const exists = res.ok;
                segmentCache.set(cacheKey, exists);
                if (!cancelled) setResult(exists);
            } catch {
                // Network/parse failure: leave orientation at the upright default
                // rather than guessing. Not cached, so a later render can retry.
                if (!cancelled) setResult(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [eligible, prefix, cacheKey]);

    return result;
}
