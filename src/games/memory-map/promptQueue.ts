/**
 * Which queue entry the run should be asking (docs/MEMORY_MAP_GAME.md § 3.2).
 *
 * Extracted from `useMemoryMapRun` so the one piece of the run that can strand the
 * player is a pure function with tests, rather than a `useMemo` body.
 */

/**
 * The index of the next prompt, or -1 if nothing is left to ask.
 *
 * ── THE SCAN WRAPS, AND THAT IS THE WHOLE POINT ──────────────────────────────
 * It looks from `position` to the end of the queue and then, if it found nothing,
 * CONTINUES FROM THE START back around to `position`. A forward-only scan looks
 * obviously correct and is not: `position` and the queue drift apart in several
 * ordinary ways, and every one of them strands the player on a prompt with no word
 * behind it (reported in play as "no word and no pinyin, just a hyphen").
 *
 * The drifts, all of which really happen:
 *
 *  • **A resumed run's queue is filtered, its position is not.** `useMemoryMapRun`
 *    drops saved entries whose words have left the map — graduated in an earlier
 *    session, card deleted, placements reset — but restores `position` verbatim. Lose
 *    enough entries and the restored position points past the end of what survived.
 *  • **Skip pushes to the back.** A skipped entry lands at the end of the queue; once
 *    `position` has advanced past that point it can never be reached again going
 *    forward, even though it is exactly what still needs asking.
 *  • **`position` counts resolutions, not indices.** It increments once per resolve
 *    while the queue is being spliced and appended underneath it, so treating it as a
 *    cursor into the current array is only ever an approximation.
 *
 * Wrapping makes the queue circular, which turns all three from dead ends into
 * "start again from the top" — and the run still terminates, because this only ever
 * returns entries that are `available` and every answer removes one.
 *
 * A run ENDS when the map is fully coloured, which `useMemoryMapRun` derives from the
 * MAP rather than from this. -1 here means only "nothing askable right now".
 */
export function nextPromptIndex<T>(
    queue: readonly T[],
    position: number,
    available: (entry: T) => boolean
): number {
    if (queue.length === 0) return -1;
    // Clamp before the modulo: a restored position can exceed the filtered queue's
    // length, and a negative one would make the modulo negative too.
    const start = Math.max(0, Math.min(position, queue.length));
    for (let step = 0; step < queue.length; step++) {
        const i = (start + step) % queue.length;
        if (available(queue[i])) return i;
    }
    return -1;
}
