import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../AuthContext";
import { ApiError } from "../../api/http";
import { chooseStoryChoice, fetchStoryPlay } from "../../api/stories";
import type { StoryPlayResponse } from "../../../server/contracts/stories";
import { endingsFoundBeforeFor, planChooseFailure, planPick, shouldReplayQueued } from "./storyPlayModel";

/**
 * useStoryPlay — the client state of one story being read at `/adventures/:id`
 * (docs/CYOA_FEATURE.md § 3.3 Progression, § 3.5–3.6a).
 *
 * LAYER: client-state hook (src/features/cyoa). Owns the current `StoryPlayResponse` and
 * the in-flight choose request; renders nothing. The server owns every rule (which
 * passage, progress, endings found) — this hook only shows what it is told.
 *
 * Flow:
 *   mount            → GET /play (resume on the saved passage, or the start)
 *   choose(choiceId) → the next passage replaces the current one in place (no route
 *                      change per passage, § 3.3), then POST /choose confirms it
 *
 * ── Why a pick never waits (PREFETCH) ─────────────────────────────────────────
 * Every /play and /choose response carries `next`: what each available choice leads to,
 * built server-side by the same code /choose runs (StoryService.arrive). A pick shows
 * `next[choiceId]` at once and sends POST /choose in the background; the confirmed
 * response then replaces the prediction (same passage — and it brings the NEW passage's
 * own `next`). Normally the swap is invisible.
 *
 *   • A prediction carries no `next` of its own (the server prefetches one level). A pick
 *     made before its confirmation lands is QUEUED and replayed against the confirmed
 *     response — instant again, since by then `next` is there. Until then the stack shows
 *     `choosing` (dimmed), which only a very fast reader ever sees.
 *   • No prediction (an author edit raced the read) → the old path: dim and wait.
 *   • Network failure after an instant swap → put the previous passage back with a notice.
 *     Choices are final server-side, so nothing was saved and the pick can be retried.
 *
 * ── A stale choice ────────────────────────────────────────────────────────────
 * An author edit replaces a passage's choices (new ids), so a learner sitting on that
 * passage can pick a choice that no longer exists → 400. The hook then re-reads /play,
 * which returns the passage as it is now, and sets a one-line notice.
 *
 * Load effects key on `user?.id`, never `token` (CLAUDE.md ⛔ "Never reload/reset a page
 * on a silent token refresh").
 *
 * The decisions (queue / predict / wait, and what a failure undoes) are pure functions in
 * storyPlayModel.ts, unit-tested there; this hook performs them.
 *
 * Depends on: src/api/stories.ts, storyPlayModel.ts. Depended on by: StoryPlayPage.tsx.
 */

export type StoryPlayStatus = "loading" | "ready" | "unavailable" | "error";

export interface StoryPlayState {
    status: StoryPlayStatus;
    play: StoryPlayResponse | null;
    /** A choose request is in flight — the choice stack locks. */
    choosing: boolean;
    /** One-line message above the choices (a failed or stale pick). Null = none. */
    notice: string | null;
    /** The endings-found count BEFORE the ending just reached — the end screen ticks from it. */
    endingsFoundBefore: number | null;
    choose: (choiceId: string) => void;
    dismissNotice: () => void;
}

/** Pull the server's `{ error }` message out of an ApiError, if any. */
function serverMessage(err: unknown): string | null {
    if (!(err instanceof ApiError)) return null;
    const data = err.response.data as { error?: unknown } | null;
    return typeof data?.error === "string" ? data.error : null;
}

export function useStoryPlay(storyId: string | undefined): StoryPlayState {
    const { user } = useAuth();
    const [status, setStatus] = useState<StoryPlayStatus>("loading");
    const [play, setPlay] = useState<StoryPlayResponse | null>(null);
    const [choosing, setChoosing] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [endingsFoundBefore, setEndingsFoundBefore] = useState<number | null>(null);

    // Guards against a response landing after the story changed or the page unmounted.
    const requestSeq = useRef(0);
    // `play` mirrored into a ref so `choose` (and its queued replay) reads the passage on
    // screen NOW, not the one its closure captured.
    const playRef = useRef<StoryPlayResponse | null>(null);
    const show = useCallback((next: StoryPlayResponse | null) => {
        playRef.current = next;
        setPlay(next);
    }, []);
    // One /choose in flight at a time (the server orders picks by the progress row), and
    // at most one pick waiting behind it — see "PREFETCH" in the header.
    const confirming = useRef(false);
    const queuedChoiceId = useRef<string | null>(null);

    const load = useCallback(async (id: string) => {
        const seq = ++requestSeq.current;
        try {
            const next = await fetchStoryPlay(id);
            if (seq !== requestSeq.current) return;
            show(next);
            setEndingsFoundBefore(null);
            setStatus("ready");
        } catch (err) {
            if (seq !== requestSeq.current) return;
            console.error("useStoryPlay: failed to load story", err);
            // 404 = unpublished, deleted or malformed id — "no longer available".
            setStatus(err instanceof ApiError && err.status === 404 ? "unavailable" : "error");
        }
    }, [show]);

    useEffect(() => {
        if (!storyId || !user?.id) return;
        setStatus("loading");
        show(null);
        setNotice(null);
        queuedChoiceId.current = null;
        void load(storyId);
        // The ref is a plain counter (not a DOM node), so reading it at cleanup is the point.
        const seqRef = requestSeq;
        return () => {
            // Invalidate anything still in flight for the previous story.
            seqRef.current++;
        };
        // Keyed on the stable auth identity, not `token` (see header).
    }, [storyId, user?.id, load, show]);

    // A ref to `choose` itself, so the confirmation can replay a queued pick through the
    // CURRENT callback.
    const chooseRef = useRef<(choiceId: string) => void>(() => {});

    const choose = useCallback((choiceId: string) => {
        const current = playRef.current;
        if (!storyId || !current) return;
        const plan = planPick(current, choiceId, confirming.current);
        if (plan.kind === "queue") {
            // The passage on screen is still a prediction: replay this pick once it's confirmed.
            queuedChoiceId.current = choiceId;
            setChoosing(true);
            return;
        }

        const seq = ++requestSeq.current;
        // The old count, for the end screen's 1/7 → 2/7 tick (§ 3.6).
        const foundBefore = current.endingsFound;
        confirming.current = true;
        setNotice(null);
        if (plan.kind === "predict") {
            show(plan.shown);
            setEndingsFoundBefore(plan.endingsFoundBefore);
        } else {
            setChoosing(true);
        }

        chooseStoryChoice(storyId, choiceId)
            .then((confirmed) => {
                if (seq !== requestSeq.current) return;
                show(confirmed);
                setEndingsFoundBefore(endingsFoundBeforeFor(confirmed, foundBefore));
            })
            .catch((err) => {
                if (seq !== requestSeq.current) return;
                console.error("useStoryPlay: choose failed", err);
                queuedChoiceId.current = null;
                const failure = planChooseFailure(err instanceof ApiError ? err.status : null, current, plan.kind === "predict");
                if (failure.kind === "unavailable") {
                    setStatus("unavailable");
                } else if (failure.kind === "reread") {
                    // Stale or target-less choice: show the passage as it is now.
                    setNotice(serverMessage(err) ?? "This passage changed — here it is again.");
                    void load(storyId);
                } else {
                    // Nothing was saved: put back the passage the pick was made on.
                    if (failure.restore) {
                        show(failure.restore);
                        setEndingsFoundBefore(null);
                    }
                    setNotice("Couldn't continue. Please try again.");
                }
            })
            .finally(() => {
                // Unconditional: the 400 path's re-read bumps `requestSeq`, so a seq check
                // here would leave the stack locked forever.
                confirming.current = false;
                setChoosing(false);
                const queued = queuedChoiceId.current;
                queuedChoiceId.current = null;
                if (shouldReplayQueued(queued, seq, requestSeq.current)) chooseRef.current(queued);
            });
    }, [storyId, load, show]);

    useEffect(() => {
        chooseRef.current = choose;
    }, [choose]);

    const dismissNotice = useCallback(() => setNotice(null), []);

    return { status, play, choosing, notice, endingsFoundBefore, choose, dismissNotice };
}
