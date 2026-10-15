/**
 * workingLoop.ts — the flp's initial deal: `GET /api/onDeck/distributedWorkingLoop`.
 *
 * Two callers, and they MUST build the same request:
 *   • `useWorkingLoop` (the flp) — the ordinary fetch on mount.
 *   • `flpLaunch.ts` (the fdp) — the PRELOAD Home runs on landing for each hand mode
 *     (and the Start tap's fallback load), whose result the flp then adopts instead of
 *     fetching again.
 * The handoff is matched on `workingLoopKey(request)`, so both sides go through the one
 * param builder below; a hand-built query on either side would silently miss the match
 * and the flp would fall back to its own fetch (and spinner).
 *
 * Takes no `token` (docs/FRONTEND_LAYERING.md § 3.2) — `apiGet` reads auth at call time.
 *
 * Docs: docs/DECKS_FEATURE.md § "Launching the flp from the hand".
 */
import { apiGet } from './http';
import type { VocabEntry } from '../types';
import type { FlpBar, StudyMode } from '../../server/contracts/studyMode';

export interface WorkingLoopRequest {
    /** Mastery-category filter (`?category=`), or null for the whole library. */
    category: string | null;
    /** Review / Challenge, or null for the default Study Mix distribution. */
    mode: StudyMode | null;
    bar: FlpBar;
    /** The launch collection's params (`collectionLaunchParams`), when launched from one. */
    collection?: Record<string, string> | null;
}

/** The request's query params. `core` is the server default, so it is never sent. */
function workingLoopParams(request: WorkingLoopRequest): URLSearchParams {
    const params = new URLSearchParams();
    if (request.category) params.set('category', request.category);
    if (request.mode) params.set('mode', request.mode);
    if (request.bar !== 'core') params.set('bar', request.bar);
    for (const [key, value] of Object.entries(request.collection ?? {})) params.set(key, value);
    return params;
}

/** Stable identity of a request — what a prefetched loop is matched against. */
export function workingLoopKey(request: WorkingLoopRequest): string {
    return workingLoopParams(request).toString();
}

/** Fetch a fresh working loop. Always resolves to an array (the server may send one card bare). */
export async function fetchDistributedWorkingLoop(request: WorkingLoopRequest): Promise<VocabEntry[]> {
    const data = await apiGet<VocabEntry[] | VocabEntry>('/api/onDeck/distributedWorkingLoop', {
        params: Object.fromEntries(workingLoopParams(request)),
    });
    if (data == null) return [];
    return Array.isArray(data) ? data : [data];
}
