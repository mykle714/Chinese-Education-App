import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { type CollectionRef, collectionFromSearch } from "./collectionRef";

/**
 * The collection this surface was launched with, read from its own URL.
 *
 * Every game page and the flp calls this and threads the result into its pool
 * fetch (and, for the flp, into its mark calls). A surface that forgets to would
 * quietly draw from the learner's whole library while showing them a deck's name —
 * which is why this is one hook rather than five copies of the parsing.
 *
 * Returns null for an ordinary unrestricted launch. See docs/DECKS_FEATURE.md.
 */
export function useLaunchCollection(): CollectionRef | null {
    const [searchParams] = useSearchParams();
    // Memoized on the serialized query so the value is referentially stable — these
    // results land in fetch-callback dependency arrays.
    const key = searchParams.toString();
    return useMemo(() => collectionFromSearch(new URLSearchParams(key)), [key]);
}
