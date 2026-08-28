import { useCallback, useMemo, useRef } from "react";
import { API_BASE_URL } from "../../constants";
import { authHeader } from "../../utils/authHeader";
import type { VocabEntry } from "../../types";
import { HYDRA_COLORS, type HydraCard, type HydraColor } from "./types";
import {
    BUCKETS_BY_COLOR,
    BUFFER_LOW_WATER,
    BUFFER_TARGET,
    MARK_TYPE,
    MAX_AVOID_IDS,
    SURFACE,
    TIER_OFFSET_BY_COLOR,
} from "./constants";

/**
 * Hydra Bubbles — the two color pools (docs/HYDRA_BUBBLES.md § 6.2b).
 *
 * WHAT PROBLEM THIS SOLVES. Hydra rolls a COLOR and then needs a card of that color,
 * synchronously, mid-animation. It cannot ask the server "what color is this card?"
 * at spawn time, and it cannot block a spawn on a network round trip. So it keeps
 * one buffer per color — two of them since 2026-08-21 — and a spawn simply POPS from
 * the buffer whose color it rolled. The card was already the right color, because it
 * came out of that color's buffer.
 *
 * WHY THE BUFFER IS THE COLOR AUTHORITY. A library card enters the buffer whose two
 * bands cover its real recognition `gameCategory` (BUCKETS_BY_COLOR); a LENT card
 * enters the buffer of the color that was REQUESTED, which is its difficulty tier and
 * not its (Unfamiliar) mastery. That disjunction is deliberate — coloring every lent
 * card drain would put the whole board on the shrinking side of the ladder for exactly
 * the learners most likely to be playing on lent cards (§ 5). Because the tag is
 * assigned on the way OUT of the buffer, a card also keeps its color for the whole run
 * even as it earns marks, which is what § 3's economy assumes.
 *
 * CLIENT-SIDE ONLY. No table, no persisted server state, nothing to migrate. A run
 * that ends throws its buffers away.
 *
 * A DRY BUFFER IS WAITED ON, NOT SUBSTITUTED (2026-08-18). `draw` is async: when the
 * rolled color has no stock it kicks (or joins) that color's refill and AWAITS it,
 * then pops. It does NOT quietly hand back a different color — the color is a promise
 * to the player about what the match will pay, and honoring it late is far better
 * than breaking it on time.
 *
 * This replaces a fall-through that iterated HYDRA_COLORS in ascending order, so a
 * dry BLUE buffer produced a RED bubble: the game's best slot silently became its
 * worst, and the board's economy inverted. With only two colors that substitution is
 * now the WORST case rather than a graded one — the single fallback left swaps a +1
 * for a −1 — so it stays where it is: a last resort reached only after the await has
 * already failed.
 *
 * The planner's anti-zero guarantee (§ 4.3) is the floor beneath all of it.
 *
 * Referenced by: HydraStage.tsx.
 * Docs: docs/HYDRA_BUBBLES.md § 5, § 6.2b; docs/PROVISIONAL_CARDS.md § 3b, § 3c.
 */

/** The pool endpoint's response, narrowed to what the buffers use. */
interface GamePoolResponse {
    cards: VocabEntry[];
}

export interface ColorBuffers {
    /**
     * Take a card of `color`. ASYNC ON PURPOSE: when that buffer is momentarily dry
     * this AWAITS its refill rather than substituting a different color, because a
     * substituted color is a lie about what the match will pay (§ 5).
     *
     * Returns null only after the wait has failed to produce anything, which the
     * caller treats as "skip this slot".
     */
    draw: (color: HydraColor) => Promise<HydraCard | null>;
    /** Cards currently held across both buffers, for the "still loading" check. */
    size: () => number;
    /** Kick an async top-up of any buffer below its low-water mark. Fire-and-forget. */
    topUp: () => void;
    /** Prime every buffer once, before the run starts. Resolves when both settle. */
    prime: () => Promise<void>;
    /** Mark a card as in-play (hard exclude) or retired (soft avoid). */
    hold: (id: number) => void;
    release: (id: number) => void;
    /**
     * True once a lent card has been DEALT — drives the one-shot mid-run notice.
     *
     * Dealt, not reviewed, and that is the right trigger for a notice whose message is
     * "borrowed words are now in play". The end-of-run sort offer asks a different
     * question ("which of these do you want to keep?") and is built from what the player
     * actually matched against — `useMarkedLentWords`, owned by the page, not from here.
     */
    hasLent: () => boolean;
}

/**
 * @param collectionSuffix `?deck=`/`?collection=` query fragment, or ""
 * @param restricted       a deck/collection run: never lend (§ 6.3)
 * @param challengeCards   a Study Challenge round's contested words (§ 7.5), which
 *                         ride the BLOOM slot ahead of that buffer's own stock.
 *                         Null/empty for an ordinary run.
 */
export function useColorBuffers(
    collectionSuffix: string,
    restricted: boolean,
    challengeCards: VocabEntry[] | null = null
): ColorBuffers {
    // All buffer state lives in refs. It is read and written from inside the rAF /
    // pointer path, where a re-render per card would be both pointless (nothing
    // renders a buffer) and harmful (it would churn the stage mid-drag).
    const buffersRef = useRef<Record<HydraColor, VocabEntry[]>>({
        drain: [],
        bloom: [],
    });
    // Cards currently ON THE BOARD or sitting in a buffer — a HARD exclude, because
    // a card may contribute at most one word and one definition bubble (§ 4.4) and a
    // duplicate would give a drag two correct targets.
    const heldIdsRef = useRef<Set<number>>(new Set());
    // Cards cleared earlier this run — a SOFT avoid, so a long run stops recycling
    // the same handful of words while a small library can still refill from them.
    const retiredIdsRef = useRef<Set<number>>(new Set());
    // Per-color in-flight refill, held as a PROMISE rather than a boolean flag.
    // Two jobs: it stops three spawns in one frame firing three identical refills
    // (and over-lending three times over), and it gives `draw` something to await
    // when it finds a buffer dry. A boolean could do only the first.
    const inFlightRef = useRef<Map<HydraColor, Promise<void>>>(new Map());
    // Has this run PUT a lent card on the board yet? Only ever read as a boolean — it
    // arms the one-shot mid-run notice, which says "borrowed words are now in play" and
    // therefore fires on the deal. It used to hold the drawn cards themselves so the
    // end-of-run offer could list them; that offer now lists what the player actually
    // matched against instead (`useMarkedLentWords`), so nothing needs the set.
    const hasLentRef = useRef(false);

    /**
     * THE CHALLENGE QUEUE (docs/HYDRA_BUBBLES.md § 7.5, docs/STUDY_CHALLENGE.md § 5).
     *
     * A challenge round's contested words are served from HERE, ahead of the
     * bloom buffer's own stock, and only ever into a BLOOM slot: their payout is
     * bloom's (3) whatever the learner's real mastery of them, which is the same
     * colour/mastery disjunction § 5 already allows for a lent card.
     *
     * Bloom rather than drain on purpose — the contested words are what the run is
     * SCORED on, so making them the board-growing colour means chasing them never
     * forces the player toward the squeeze. The one place they cannot spawn is the
     * squeeze itself, which is drain-only.
     *
     * Seeded from the prop by identity, so the page can fetch them asynchronously and
     * hand them over once. Drained and never refilled: a contested word is dealt once
     * per run, and the run ends when the last one is cleared.
     */
    const challengeQueueRef = useRef<VocabEntry[]>([]);
    const challengeSeedRef = useRef<VocabEntry[] | null>(null);
    if (challengeCards && challengeSeedRef.current !== challengeCards) {
        challengeSeedRef.current = challengeCards;
        challengeQueueRef.current = [...challengeCards];
        // Hard-exclude them from every refill: a contested word must not also arrive
        // as ordinary buffer stock and land on the board twice.
        challengeCards.forEach((card) => heldIdsRef.current.add(card.id));
    }

    /**
     * Fetch cards for one color.
     *
     * The color maps to its TWO REQUESTED BANDS (`?Mastered=2&Comfortable=2`) so
     * library cards come back genuinely of that color, and to a TIER OFFSET
     * (`?lendLevelOffset=`) so anything the server has to lend is drawn at that
     * color's difficulty rather than at the learner's own level.
     * `surface=hydra-bubbles` is what allows a mid-run refill to lend at all
     * (ROLLING_SUPPLY_SURFACES, server/contracts/wire.ts).
     *
     * THE SPLIT IS A PREFERENCE, NOT A QUOTA. `need` caps the whole response and the
     * server tops a short band up from its own fallback order, so an odd `need`
     * leaning toward the color's strong band (BUCKETS_BY_COLOR) only decides which
     * band is asked for FIRST — a learner with no Mastered cards still fills a bloom
     * buffer entirely from Comfortable.
     *
     * `need` is always set, so every fetch is a partial refill — that IS Hydra's
     * supply model (§ 6.1).
     */
    const fetchColor = useCallback(async (color: HydraColor, need: number): Promise<VocabEntry[]> => {
        const exclude = [...heldIdsRef.current];
        // Newest-first cap: a Set preserves insertion order, so the tail is the most
        // recently retired. See MAX_AVOID_IDS.
        const avoid = [...retiredIdsRef.current].slice(-MAX_AVOID_IDS);
        // Split `need` across the color's bands, remainder to the first (strongest)
        // one. Both bands are always sent, even at need=1 where one of them asks for
        // zero, so the request still names the full set the color may be served from.
        const bands = BUCKETS_BY_COLOR[color];
        const per = Math.floor(need / bands.length);
        const bandParams = bands.map((band, i) =>
            `${band}=${per + (i === 0 ? need % bands.length : 0)}`
        );
        const params = [
            `markType=${MARK_TYPE}`,
            `surface=${SURFACE}`,
            ...bandParams,
            // "These two bands or nothing." Without it the server tops a short request
            // up from ANY band, and Hydra would pay the player at the rolled color's
            // rate for a card of the opposite tier (§ 6.2d). Load-bearing since the
            // request became two bands wide: the server used to infer this from a
            // one-band request, and cannot any more.
            `strictBuckets=1`,
            `need=${need}`,
            `exclude=${exclude.join(",")}`,
            `avoid=${avoid.join(",")}`,
        ];
        // A restricted run plays the set the learner chose, so it must not ask for a
        // lend tier at all — the server refuses to lend under a collection filter
        // anyway (§ 6.3), and sending the param would imply otherwise to anyone
        // reading the request log.
        if (!restricted) params.push(`lendLevelOffset=${TIER_OFFSET_BY_COLOR[color]}`);

        const res = await fetch(
            `${API_BASE_URL}/api/onDeck/gamePool?${params.join("&")}${collectionSuffix}`,
            { credentials: "include", headers: authHeader() }
        );
        if (!res.ok) throw new Error("Failed to load Hydra pool");
        const data: GamePoolResponse = await res.json();
        return data.cards ?? [];
        // authHeader() reads the token at call time, so this callback's identity is
        // stable across a silent token refresh (CLAUDE.md ⛔ rule). `collectionSuffix`
        // comes from this page's own URL and cannot change without a remount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [restricted]);

    /**
     * Refill one buffer to BUFFER_TARGET, returning the in-flight promise so a caller
     * can await it. Safe to call concurrently: a second call for a color already
     * refilling joins the first rather than firing a duplicate request (which would
     * also lend twice over).
     */
    const refill = useCallback((color: HydraColor): Promise<void> => {
        const existing = inFlightRef.current.get(color);
        if (existing) return existing;
        const need = BUFFER_TARGET - buffersRef.current[color].length;
        if (need <= 0) return Promise.resolve();

        const run = (async () => {
            try {
                const cards = await fetchColor(color, need);
                for (const card of cards) {
                    // The server can legitimately return a card already held:
                    // `exclude` was built before the request and other colors have
                    // been drawing since. Dropping it here is cheaper than a
                    // wire-level reservation.
                    if (heldIdsRef.current.has(card.id)) continue;
                    heldIdsRef.current.add(card.id);
                    buffersRef.current[color].push(card);
                }
            } catch {
                // Swallowed on purpose: a failed top-up must never interrupt a live
                // run. The buffer stays short, the awaiting `draw` falls through, and
                // the next top-up tries again.
            } finally {
                inFlightRef.current.delete(color);
            }
        })();
        inFlightRef.current.set(color, run);
        return run;
    }, [fetchColor]);

    const topUp = useCallback(() => {
        for (const color of HYDRA_COLORS) {
            if (buffersRef.current[color].length <= BUFFER_LOW_WATER) {
                void refill(color);
            }
        }
    }, [refill]);

    const prime = useCallback(async () => {
        // Sequential, not Promise.all: both requests share one exclusion set, and
        // firing them together would let the two colors claim the same card and land a
        // duplicate on the board. Two small requests at page load is a cost worth
        // paying for that guarantee.
        for (const color of HYDRA_COLORS) {
            await refill(color);
        }
    }, [refill]);

    /**
     * Pop the front of one buffer and tag it, or null when that buffer is empty.
     *
     * The tag is the buffer the card CAME OUT OF, which for a lent card is its
     * difficulty tier and not its (Unfamiliar) mastery (§ 5). This is the moment the
     * color becomes final for the card, for the rest of the run.
     */
    const take = useCallback((color: HydraColor): HydraCard | null => {
        // A bloom slot serves a contested word first, while any is left undealt.
        // Drain never does — see the challenge queue's note.
        if (color === "bloom" && challengeQueueRef.current.length > 0) {
            return { entry: challengeQueueRef.current.shift()!, color };
        }
        const entry = buffersRef.current[color].shift();
        if (!entry) return null;
        if (entry.starterPackBucket === "provisional") {
            hasLentRef.current = true;
        }
        return { entry, color };
    }, []);

    /**
     * The other color — the last-resort substitute.
     *
     * Reached only after the await below has already failed, i.e. the refill errored
     * or the server had nothing at all for this color. Substituting misstates the
     * payout, and under the two-color ladder there is no "near miss" left to fall to:
     * the only substitute is the opposite sign, a 2-bubble swing. It is still the
     * right call, because a board that stalls with nothing to match is worse than one
     * that occasionally mis-pays — but it is now strictly a stall-breaker rather than
     * a graded degradation, which is why the await above exists to make it rare.
     */
    const fallbackOrder = useCallback(
        (color: HydraColor): HydraColor[] => HYDRA_COLORS.filter((c) => c !== color),
        []
    );

    const draw = useCallback(async (color: HydraColor): Promise<HydraCard | null> => {
        const immediate = take(color);
        if (immediate) return immediate;

        // Dry. Wait for this color's supply rather than substituting the other one:
        // `refill` joins an already-running request, so a batch that rolls bloom three
        // times over waits on ONE round trip, not three.
        await refill(color);
        const afterWait = take(color);
        if (afterWait) return afterWait;

        // The wait produced nothing (request failed, or the server is out of this
        // color entirely). Walk outward before giving up — see fallbackOrder.
        for (const candidate of fallbackOrder(color)) {
            const substitute = take(candidate);
            if (substitute) return substitute;
        }
        return null;
    }, [take, refill, fallbackOrder]);

    const size = useCallback(
        () => HYDRA_COLORS.reduce((n, color) => n + buffersRef.current[color].length, 0),
        []
    );

    const hold = useCallback((id: number) => {
        heldIdsRef.current.add(id);
    }, []);

    // A card leaving the board is retired, not freed: it stays a hard exclude so it
    // cannot come back as its own replacement, and joins the soft-avoid list so the
    // server only re-serves it when the library has nothing else.
    const release = useCallback((id: number) => {
        retiredIdsRef.current.add(id);
    }, []);

    const hasLent = useCallback(() => hasLentRef.current, []);

    // MEMOIZED, and it matters. HydraStage takes this object as a prop and threads it
    // through several useCallbacks, one of which the window pointer listeners depend
    // on — a fresh object identity every render would tear down and re-attach those
    // listeners on every score update, mid-drag. Every member is already a stable
    // useCallback, so the object is the only thing that could churn.
    return useMemo(
        () => ({ draw, size, topUp, prime, hold, release, hasLent }),
        [draw, size, topUp, prime, hold, release, hasLent]
    );
}
