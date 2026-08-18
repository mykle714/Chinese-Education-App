import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMemoryMap, graduateMemoryMapWord, type MemoryMapWord } from "../../api/memoryMap";
import { markFlashcard } from "../../api/flashcards";
import { MARK_TYPE, MAX_TRIES, FADE_OUT_MS } from "./constants";
import { clearRun, loadRun, saveRun } from "./runStorage";
import type { Camera, PromptPhase, QueuedPrompt, RunTally, WordOutcome } from "./types";
import { nextPromptIndex } from "./promptQueue";

/**
 * Memory Map's run state machine (docs/MEMORY_MAP_GAME.md § 3–§ 5).
 *
 * Everything about "which word is being asked, what happened when it was tapped, and
 * what colour it now wears" lives here; MemoryMapPage draws the result and owns the
 * camera gestures. Splitting them keeps the page a rendering concern and makes the
 * rules readable in one file.
 *
 * ── THE ONE HARD RULE: never key a load effect on `token` ────────────────────
 * The load effect below keys on `userId`, never on the auth token. The token rotates
 * every ~15 minutes and a token-keyed effect would re-run on each refresh, wiping an
 * in-progress run — which is exactly the state this feature is built to preserve.
 * See CLAUDE.md and docs/TOKEN_EXPIRATION_IMPLEMENTATION.md.
 */

export type RunPhase = "loading" | "empty" | "playing" | "complete" | "error";

export interface MemoryMapRun {
    phase: RunPhase;
    /** Every word currently on the map, including any mid-fade graduate. */
    words: MemoryMapWord[];
    /** Colour per vet id, for words already answered this run. */
    outcomes: Record<number, WordOutcome>;
    /** The word being asked, or null when the run is over. */
    target: MemoryMapWord | null;
    /** Whether the player has burned all three tries on the current prompt. */
    promptPhase: PromptPhase;
    /** Tries burned on the current prompt, for the prompt bar's pips. */
    tries: number;
    /** Words that just took a wrong tap, for the red flash. */
    flashing: number[];
    /** Words fading off after graduating — rendered, but no longer answerable. */
    fading: number[];
    /** How many words this run has coloured, and out of how many. */
    answered: number;
    total: number;
    tally: RunTally;
    /** vet ids placed by the last load, for the growth toast. Cleared once shown. */
    newlyPlaced: number[];
    dismissGrowthToast: () => void;
    camera: Camera | null;
    setCamera: (camera: Camera) => void;
    /** Tap handler for a word on the map. Returns what the tap did, for sound/feedback. */
    tapWord: (word: MemoryMapWord) => "correct" | "wrong" | "ignored";
    /** Send the current word to the back of the queue (§ 3.2a). */
    skipWord: () => void;
    /** False when there is no other unanswered word to skip TO. */
    canSkip: boolean;
    /** Wipe colours and reshuffle. The MAP is untouched — placements are server-side. */
    restart: () => void;
}

/** Fisher–Yates. Not `sort(() => Math.random() - 0.5)`, which is measurably biased. */
function shuffle<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

export function useMemoryMapRun(userId: string | undefined, language: string): MemoryMapRun {
    const [phase, setPhase] = useState<RunPhase>("loading");
    const [words, setWords] = useState<MemoryMapWord[]>([]);
    const [outcomes, setOutcomes] = useState<Record<number, WordOutcome>>({});
    const [queue, setQueue] = useState<QueuedPrompt[]>([]);
    const [position, setPosition] = useState(0);
    const [tries, setTries] = useState(0);
    const [flashing, setFlashing] = useState<number[]>([]);
    const [fading, setFading] = useState<number[]>([]);
    const [newlyPlaced, setNewlyPlaced] = useState<number[]>([]);
    const [camera, setCamera] = useState<Camera | null>(null);

    // Guards a resolve against double-taps: a word resolves once, emits one mark, and
    // one graduation check. Without this a fast double-tap on the target would write
    // two reading marks for one answer.
    const resolvingRef = useRef<Set<number>>(new Set());

    // ── Load ─────────────────────────────────────────────────────────────────
    //
    // Keyed on userId + language ONLY. See the hook docblock on `token`.
    useEffect(() => {
        if (!userId) return;
        let cancelled = false;

        (async () => {
            setPhase("loading");
            try {
                const map = await fetchMemoryMap();
                if (cancelled) return;

                setWords(map.words);
                setNewlyPlaced(map.newlyPlaced);

                if (map.words.length === 0) {
                    setPhase("empty");
                    return;
                }

                // Reconcile the saved run against the map that just arrived. A saved
                // queue can name words that have since left (graduated in an earlier
                // session, or the card was deleted), and the map can hold words the
                // save has never seen (spawned by this very load). Both are normal.
                const live = new Set(map.words.map((w) => w.vocabEntryId));
                const saved = loadRun(userId, language);
                const savedQueue = (saved?.queue ?? []).filter((q) => live.has(q.vocabEntryId));
                const queued = new Set(savedQueue.map((q) => q.vocabEntryId));
                const unqueued = map.words
                    .filter((w) => !queued.has(w.vocabEntryId))
                    .map((w) => ({ vocabEntryId: w.vocabEntryId }));

                setQueue([...savedQueue, ...shuffle(unqueued)]);
                setPosition(saved?.position ?? 0);
                setOutcomes(saved?.outcomes ?? {});
                setCamera(saved?.camera ?? null);
                setPhase("playing");
            } catch {
                if (!cancelled) setPhase("error");
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [userId, language]);

    const wordsById = useMemo(() => {
        const map = new Map<number, MemoryMapWord>();
        for (const word of words) map.set(word.vocabEntryId, word);
        return map;
    }, [words]);

    /**
     * The index of the prompt being asked.
     *
     * DERIVED rather than stored, and that is what makes the queue robust: entries for
     * words that have left the map or are already coloured are simply skipped. Storing
     * a "corrected" position instead would mean mutating the queue every time a word
     * graduated, and every such mutation is a chance to lose a player's place.
     *
     * The scan WRAPS around the end of the queue — see `nextPromptIndex`, which owns
     * that rule and the three ways `position` drifts out of step with the queue.
     */
    const targetIndex = useMemo(
        () =>
            nextPromptIndex(
                queue,
                position,
                (entry) => wordsById.has(entry.vocabEntryId) && !outcomes[entry.vocabEntryId]
            ),
        [position, queue, wordsById, outcomes]
    );

    const target = targetIndex >= 0 ? wordsById.get(queue[targetIndex].vocabEntryId) ?? null : null;
    const promptPhase: PromptPhase = tries >= MAX_TRIES ? "failed" : "hunting";

    // Completion: every word on the map wears a colour (§ 5). Derived from the MAP, not
    // from the queue, because the map is what the player was asked to colour and it is
    // the thing that changes underneath a run.
    useEffect(() => {
        if (phase !== "playing") return;
        if (words.length > 0 && words.every((w) => outcomes[w.vocabEntryId])) {
            setPhase("complete");
        }
    }, [phase, words, outcomes]);

    // ── Save ─────────────────────────────────────────────────────────────────
    //
    // Debounced because the CAMERA is part of the save and a pan gesture changes it
    // every frame; writing localStorage at 60 Hz would jank the very gesture it is
    // recording. 400 ms is below the time it takes to leave the page by any route.
    useEffect(() => {
        if (!userId || phase !== "playing" || !camera) return;
        const timer = window.setTimeout(() => {
            saveRun(userId, language, { queue, position, outcomes, camera });
        }, 400);
        return () => window.clearTimeout(timer);
    }, [userId, language, phase, queue, position, outcomes, camera]);

    /**
     * A word resolved: record its colour, emit its ONE reading mark, and ask the server
     * whether that mark graduated it off the map.
     *
     * Marks (§ 3.5): green is positive, orange and red are both negative — the player
     * missed it, and the colour already says so. One prompt, one mark; an individual
     * wrong tap emits nothing.
     */
    const resolve = useCallback(
        async (word: MemoryMapWord, outcome: WordOutcome) => {
            if (resolvingRef.current.has(word.vocabEntryId)) return;
            resolvingRef.current.add(word.vocabEntryId);

            setOutcomes((prev) => ({ ...prev, [word.vocabEntryId]: outcome }));
            setTries(0);
            setPosition((prev) => prev + 1);

            try {
                await markFlashcard({
                    cardId: word.vocabEntryId,
                    isCorrect: outcome === "green",
                    type: MARK_TYPE,
                    surface: "memory-map",
                });
            } catch {
                // The colour stands even if the mark failed to persist. Rolling the
                // colour back would be worse: the player answered, and re-prompting the
                // same word because of a network blip reads as the game losing track.
                return;
            }

            try {
                const result = await graduateMemoryMapWord(word.vocabEntryId);
                if (!result.graduated) return;

                // It graduated. Hold the colour for a beat, then dissolve it off (§ 3.6).
                setFading((prev) => [...prev, word.vocabEntryId]);
                window.setTimeout(() => {
                    setWords((prev) => prev.filter((w) => w.vocabEntryId !== word.vocabEntryId));
                    setFading((prev) => prev.filter((id) => id !== word.vocabEntryId));
                }, FADE_OUT_MS);

                // The map self-heals immediately, and the newcomer JOINS THIS RUN (Q32).
                // Known consequence: a productive run gets longer as you play. It still
                // terminates — the eligible pool is finite and each graduation consumes
                // one — but "colour the whole map" is not a fixed 100 prompts on a good
                // day. See § 3.6 for the fallback if this proves annoying in play.
                if (result.replacement) {
                    const replacement = result.replacement;
                    setWords((prev) => [...prev, replacement]);
                    setQueue((prev) => [...prev, { vocabEntryId: replacement.vocabEntryId }]);
                    setNewlyPlaced((prev) => [...prev, replacement.vocabEntryId]);
                }
            } catch {
                // Graduation is an optimisation, not a correctness requirement: the word
                // keeps its colour and will simply leave the map on the next load.
            }
        },
        []
    );

    /**
     * Tapping a word on the map.
     *
     * Three cases, and the ordering matters:
     *   • an ALREADY-COLOURED word is never an answer — the page opens its definition
     *     popup instead, and no try is burned (§ 3.4). Handled by returning "ignored".
     *   • the TARGET resolves the prompt, green / orange / red by how many tries it took.
     *   • any other uncoloured word is a miss: flash it red and burn a try.
     *
     * Tapping empty space never reaches here — that is the pan gesture (§ 3.3).
     */
    const tapWord = useCallback(
        (word: MemoryMapWord): "correct" | "wrong" | "ignored" => {
            if (phase !== "playing" || !target) return "ignored";
            if (outcomes[word.vocabEntryId]) return "ignored";
            if (fading.includes(word.vocabEntryId)) return "ignored";

            if (word.vocabEntryId === target.vocabEntryId) {
                // Out of tries → the lock-in tap, which seals it solid red. Otherwise
                // green for a clean first try, orange for a recovery.
                //
                // THE PINYIN SPOILER COSTS NOTHING. Only WRONG TAPS move a prompt off
                // green — revealing the pronunciation does not. An earlier version
                // capped a spoiled prompt at orange on the reasoning that green should
                // mean "read it unaided"; that was overruled, and the rule now is the
                // simpler one: the colour and the mark record whether the learner found
                // the right word, and nothing else. The spoiler is a study aid, like
                // looking a word up, not a partial answer.
                const outcome: WordOutcome =
                    promptPhase === "failed" ? "red" : tries === 0 ? "green" : "orange";
                void resolve(word, outcome);
                return "correct";
            }

            // A wrong tap once the tries are spent costs nothing further — the prompt is
            // already failed and the target is pulsing. Flash, but do not burn.
            setFlashing((prev) => [...prev, word.vocabEntryId]);
            if (promptPhase === "hunting") setTries((prev) => prev + 1);
            return "wrong";
        },
        [phase, target, outcomes, fading, promptPhase, tries, resolve]
    );

    /**
     * There is another unanswered word to move on to.
     *
     * Without this the button is a no-op on the last word — splicing the only remaining
     * entry out and pushing it back lands it in the same place, and the prompt would
     * appear frozen with no explanation.
     */
    const canSkip = useMemo(() => {
        if (!target) return false;
        return words.some(
            (word) => word.vocabEntryId !== target.vocabEntryId && !outcomes[word.vocabEntryId]
        );
    }, [words, outcomes, target]);

    /**
     * Send the current word to the back of the queue.
     *
     * ── WHY THIS IS NOT ALWAYS A FREE REQUEUE ────────────────────────────────
     * While the player still has tries, skipping costs nothing: the word comes back
     * later with a fresh three, and no mark is written. That is the whole feature —
     * "not right now".
     *
     * Once the tries are SPENT the outcome has already been decided (red), and the only
     * thing left is the lock-in tap. Requeuing there would let a player dodge every
     * negative mark by failing and skipping, which would quietly make the reading track
     * a record of successes only. So a skip in the failed state RESOLVES the word red —
     * exactly what tapping it would have done — and moves on.
     *
     * That also removes a genuine dead end: a player who truly cannot find the pulsing
     * word would otherwise have no way to continue at all.
     */
    const skipWord = useCallback(() => {
        if (phase !== "playing" || !target || targetIndex < 0) return;

        if (promptPhase === "failed") {
            void resolve(target, "red");
            return;
        }
        if (!canSkip) return;

        // ── SKIP IS A CURSOR MOVE, NOT A QUEUE EDIT ──────────────────────────
        // It used to splice the entry out and push it to the back, leaving `position`
        // alone on the reasoning that the following entry slides into the vacated
        // index. That was true but not sufficient: once the scan wraps (see
        // `nextPromptIndex`), an entry pushed to the END sits at an index the forward
        // scan reaches FIRST whenever nothing else is available ahead of `position` —
        // so skipping the last unanswered word ahead of the cursor silently re-selected
        // the very word that was skipped.
        //
        // Simply advancing the cursor past it does the same job with none of that: the
        // circular scan offers every other available word before coming back around, so
        // the word still returns "later" — which is all skip ever promised — and the
        // queue's order stays stable, which makes a saved run easier to reason about.
        setPosition(targetIndex + 1);
        setTries(0);
    }, [phase, target, targetIndex, promptPhase, canSkip, resolve]);

    /** Clear a word's red flash once its animation has run. */
    useEffect(() => {
        if (flashing.length === 0) return;
        const timer = window.setTimeout(() => setFlashing([]), 500);
        return () => window.clearTimeout(timer);
    }, [flashing]);

    /**
     * Wipe the colours and reshuffle. Serves both Restart (§ 6) and Play Again (§ 5).
     *
     * The MAP is deliberately untouched: placements are server-side and no client
     * action can move a word. That is what makes the map feel permanent.
     */
    const restart = useCallback(() => {
        if (userId) clearRun(userId, language);
        resolvingRef.current.clear();
        setOutcomes({});
        setPosition(0);
        setTries(0);
        setQueue(shuffle(words.map((w) => ({ vocabEntryId: w.vocabEntryId }))));
        setPhase(words.length === 0 ? "empty" : "playing");
    }, [userId, language, words]);

    const tally = useMemo<RunTally>(() => {
        const counts: RunTally = { green: 0, orange: 0, red: 0 };
        for (const outcome of Object.values(outcomes)) counts[outcome]++;
        return counts;
    }, [outcomes]);

    return {
        phase,
        words,
        outcomes,
        target,
        promptPhase,
        tries,
        flashing,
        fading,
        answered: Object.keys(outcomes).length,
        // The denominator is the map's CURRENT size, so the `23 / 100` header stays
        // truthful as words graduate off and replacements arrive.
        total: words.length,
        tally,
        newlyPlaced,
        dismissGrowthToast: useCallback(() => setNewlyPlaced([]), []),
        camera,
        setCamera,
        tapWord,
        skipWord,
        // A failed prompt always offers the button — there it means "accept the red",
        // which is available even when no other word is left.
        canSkip: canSkip || promptPhase === "failed",
        restart,
    };
}
