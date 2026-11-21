import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../AuthContext";
import { ApiError } from "../../api/http";
import { fetchStoryEdit } from "../../api/stories";
import type { StoryEditResponse } from "../../../server/contracts/stories";

/**
 * useStoryEdit — the editor's copy of one story graph (`GET /api/stories/:id/edit`,
 * docs/CYOA_FEATURE.md § 5). Shared by the story editor and the passage editor; each page
 * calls it once (they are separate routes, so each loads its own copy — the graph is
 * small and always re-read fresh on arrival, so neither page shows another's stale state).
 *
 * LAYER: client-state hook (src/features/cyoa). Owns `edit` and a one-line `notice`;
 * renders nothing. The server owns every rule (who may write, graph integrity, the live
 * publish warnings) — this hook only holds what it last answered.
 *
 *   run(action, apply?) — perform one author call: marks `busy`, turns a failure into the
 *                         `notice` (the server's own message). Resolves `{ value }` on
 *                         success and null on failure, so the caller can stop — wrapped
 *                         because a 204 call's own value IS null. `apply` gets the value.
 *   reload()            — re-read the whole graph (after a call that returns only a part
 *                         of it, e.g. a saved passage).
 *
 * Status: 403 → "forbidden" (not an author, or another author's story); 404 →
 * "unavailable" (deleted). Load effect keys on `user?.id`, never `token` (CLAUDE.md ⛔).
 *
 * Depends on: src/api/stories.ts. Depended on by: StoryEditorPage.tsx, PassageEditorPage.tsx.
 */

export type StoryEditStatus = "loading" | "ready" | "forbidden" | "unavailable" | "error";

export interface StoryEditState {
    status: StoryEditStatus;
    edit: StoryEditResponse | null;
    /** An author call is in flight — action buttons disable. */
    busy: boolean;
    /** One-line message after a failed call. Null = none. */
    notice: string | null;
    setNotice: (notice: string | null) => void;
    reload: () => Promise<void>;
    /** Replace the held graph (an action that returns the whole graph, e.g. PATCH). */
    setEdit: (edit: StoryEditResponse) => void;
    run: <T>(action: () => Promise<T>, apply?: (result: T) => void) => Promise<{ value: T } | null>;
}

/** The failure's server message, or a generic line. */
function failureMessage(err: unknown): string {
    if (err instanceof ApiError && err.message && !err.message.startsWith("Request failed")) return err.message;
    return "Something went wrong. Please try again.";
}

export function useStoryEdit(storyId: string | undefined): StoryEditState {
    const { user } = useAuth();
    const [status, setStatus] = useState<StoryEditStatus>("loading");
    const [edit, setEdit] = useState<StoryEditResponse | null>(null);
    const [busyCount, setBusyCount] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);
    // Drops a load that lands after the story changed or the page unmounted.
    const loadSeq = useRef(0);

    const load = useCallback(async (id: string, { quiet }: { quiet: boolean }) => {
        const seq = ++loadSeq.current;
        try {
            const next = await fetchStoryEdit(id);
            if (seq !== loadSeq.current) return;
            setEdit(next);
            setStatus("ready");
        } catch (err) {
            if (seq !== loadSeq.current) return;
            console.error("useStoryEdit: failed to load story", err);
            if (quiet) {
                // A reload after an action: keep showing what we have, say it failed.
                setNotice(failureMessage(err));
                return;
            }
            if (err instanceof ApiError && err.status === 403) setStatus("forbidden");
            else if (err instanceof ApiError && err.status === 404) setStatus("unavailable");
            else setStatus("error");
        }
    }, []);

    useEffect(() => {
        if (!storyId || !user?.id) return;
        setStatus("loading");
        setEdit(null);
        setNotice(null);
        void load(storyId, { quiet: false });
        const seqRef = loadSeq; // a plain counter, read at cleanup on purpose
        return () => { seqRef.current++; };
        // Keyed on the stable auth identity, not `token` (see header).
    }, [storyId, user?.id, load]);

    const reload = useCallback(async () => {
        if (storyId) await load(storyId, { quiet: true });
    }, [storyId, load]);

    const run = useCallback(async <T,>(action: () => Promise<T>, apply?: (result: T) => void): Promise<{ value: T } | null> => {
        setBusyCount((n) => n + 1);
        setNotice(null);
        try {
            const result = await action();
            apply?.(result);
            return { value: result };
        } catch (err) {
            console.error("useStoryEdit: action failed", err);
            setNotice(failureMessage(err));
            return null;
        } finally {
            setBusyCount((n) => n - 1);
        }
    }, []);

    return { status, edit, busy: busyCount > 0, notice, setNotice, reload, setEdit, run };
}
