import { useCallback, useEffect, useRef, useState } from "react";
import { newSnowTrail, SNOW_SHED_MS, type SnowCover, type SnowTrail } from "./iso";
import {
    BARE_CLOCK,
    clearedClock,
    clearSnowStorage,
    readSnowClocks,
    settleOnEntry,
    SNOW_COMPONENTS,
    snowKey,
    writeSnowClocks,
    type SnowClocks,
    type SnowComponent,
} from "./towerSnow";
import type { TowerWorldId } from "./towerWorlds";

/**
 * useTowerSnow — the Deck Tower's settled snow: which component of which world is snowy,
 * clearing it (with or without the brush-off), and each world's channels through the floor's
 * snow and the tower's top cap (docs/TOWER_SNOW.md).
 *
 * Layer: page logic (feature module `src/features/deckTower`). The rule and the store are
 * towerSnow.ts; DeckTowerPage calls the clears and hands `cover(…)` / `trail(…)` down to
 * DeckTowerPlatform and TowerCoverCard. Draws nothing.
 *
 * ── Page entry ────────────────────────────────────────────────────────────────
 * Each world is settled ONCE per mount (the page remounts on every return to `/`), as soon
 * as the weather has its first answer (`entry.ready`) and that world's tower count is
 * known: every one of its components goes through `settleOnEntry`. Nothing settles after
 * that — snow that starts while the learner is on the page waits for the next visit.
 *
 * ── Clearing ──────────────────────────────────────────────────────────────────
 * `clear` resets the clock (`clearedClock`) whether or not the component was snowy — it is
 * the time since the last clearing action that the rule reads. With `brush`, a component
 * that WAS snowy keeps a `shed` cover for `delayMs + SNOW_SHED_MS`, so its brush-off plays;
 * otherwise its snow just goes (it has already left with its object: a trap door, the
 * count card sliding off). Clearing the floor or the tower also wipes that surface's trail.
 *
 * ── Shown ─────────────────────────────────────────────────────────────────────
 * `shown` false (weather effects off, no tester pin) hides every cover; the clocks are kept.
 */

/** The snow surfaces a pawn walks, each with its own trail (the plate's drift shares the floor's). */
export type SnowTrailSurface = Extract<SnowComponent, "floor" | "tower">;

export interface TowerSnow {
    /** The cover to draw on a component, or undefined while it is bare (or snow is hidden). */
    cover: (world: TowerWorldId, component: SnowComponent) => SnowCover | undefined;
    /** Clear components' snow (see the header). */
    clear: (world: TowerWorldId, components: SnowComponent | readonly SnowComponent[], opts?: { brush?: boolean; delayMs?: number }) => void;
    /** The channel store of a world's surface (SnowSlab `trail`). A new object after each clear of that surface. */
    trail: (world: TowerWorldId, surface: SnowTrailSurface) => SnowTrail;
    /** Tester: forget every clock and settle every world again now, as if newly arrived. */
    reset: () => void;
}

export function useTowerSnow({
    shown,
    entry,
    towerCards,
    cloudBaseCards,
}: {
    shown: boolean;
    /** `ready`: the weather has answered; `snowing`: it is snowing right now. */
    entry: { ready: boolean; snowing: boolean };
    /** Each world's tower count; undefined until it has loaded. */
    towerCards: Record<TowerWorldId, number | undefined>;
    /** The cloud base, in cards: a tower at or above it on entry is above the snow. */
    cloudBaseCards: number;
}): TowerSnow {
    const [clocks, setClocks] = useState<SnowClocks>(readSnowClocks);
    // Brush-offs playing now, by snow key.
    const [shedding, setShedding] = useState<Record<string, { id: number; delayMs: number }>>({});
    const shedIds = useRef(0);
    const shedTimers = useRef(new Map<string, number>());
    // Worlds already settled on this mount.
    const settled = useRef(new Set<TowerWorldId>());
    // Trails by snow key, floor and tower only (refs: the recorders write into them every
    // frame without renders).
    const trails = useRef(new Map<string, SnowTrail>());
    // Bumped by `reset`, so the entry effect runs again with an emptied `settled`.
    const [entryRound, setEntryRound] = useState(0);

    // Persist every change.
    const firstWrite = useRef(true);
    useEffect(() => {
        if (firstWrite.current) {
            firstWrite.current = false;
            return;
        }
        writeSnowClocks(clocks);
    }, [clocks]);

    // ── Page entry ──
    const { ready, snowing } = entry;
    const cardsKey = (Object.keys(towerCards) as TowerWorldId[]).map((w) => `${w}:${towerCards[w] ?? "?"}`).join(",");
    useEffect(() => {
        if (!ready) return;
        const due = (Object.keys(towerCards) as TowerWorldId[]).filter((w) => !settled.current.has(w) && towerCards[w] !== undefined);
        if (due.length === 0) return;
        const now = Date.now();
        for (const w of due) settled.current.add(w);
        setClocks((all) => {
            const next = { ...all };
            for (const w of due) {
                for (const c of SNOW_COMPONENTS) {
                    if (c === "plate") continue;
                    const key = snowKey(w, c);
                    next[key] = settleOnEntry(all[key] ?? BARE_CLOCK, {
                        snowing,
                        now,
                        aboveClouds: c === "tower" && (towerCards[w] ?? 0) >= cloudBaseCards,
                    });
                }
                // The plate lies under the floor's snow, so it has no 6 h rule of its own:
                // it is buried whenever the floor's snow is new (it just settled) or the plate
                // has no clock yet. A plate pressed clear stays clear until the floor's snow
                // is cleared (the trap door) and settles again.
                const floorKey = snowKey(w, "floor");
                const plateKey = snowKey(w, "plate");
                const floorNew = !!next[floorKey]?.snowy && !all[floorKey]?.snowy;
                const plate = all[plateKey];
                next[plateKey] = next[floorKey]?.snowy && (floorNew || !plate) ? { ...(plate ?? BARE_CLOCK), snowy: true } : (plate ?? BARE_CLOCK);
            }
            return next;
        });
        // Only the counts' arrival and the weather's first answer drive this; `settled`
        // guards against re-settling a world.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, cardsKey, entryRound]);

    // Brush-off timers die with the page.
    useEffect(() => {
        const timers = shedTimers.current;
        return () => {
            for (const t of timers.values()) window.clearTimeout(t);
            timers.clear();
        };
    }, []);

    // The latest clocks, read by `clear` (which must not run side effects inside a state
    // updater — StrictMode calls updaters twice).
    const clocksRef = useRef(clocks);
    clocksRef.current = clocks;

    const clear = useCallback<TowerSnow["clear"]>((world, components, opts) => {
        const list = typeof components === "string" ? [components] : components;
        const now = Date.now();
        for (const c of list) {
            const key = snowKey(world, c);
            // Only a component that was snowy has a brush-off to play.
            if (!opts?.brush || !clocksRef.current[key]?.snowy) continue;
            const shed = { id: ++shedIds.current, delayMs: opts.delayMs ?? 0 };
            setShedding((s) => ({ ...s, [key]: shed }));
            const old = shedTimers.current.get(key);
            if (old !== undefined) window.clearTimeout(old);
            shedTimers.current.set(
                key,
                window.setTimeout(() => {
                    shedTimers.current.delete(key);
                    setShedding((s) => {
                        if (s[key]?.id !== shed.id) return s;
                        const rest = { ...s };
                        delete rest[key];
                        return rest;
                    });
                }, shed.delayMs + SNOW_SHED_MS),
            );
        }
        setClocks((all) => {
            const next = { ...all };
            for (const c of list) next[snowKey(world, c)] = clearedClock(now);
            // Written here, not left to the persisting effect: a clear can come with a
            // navigation away (Add Cards, the notebook) that unmounts the page before that
            // effect would run. Idempotent, so StrictMode's second call is harmless.
            writeSnowClocks(next);
            return next;
        });
        // A surface's prints go with its snow.
        for (const c of list) if (c === "floor" || c === "tower") trails.current.set(snowKey(world, c), newSnowTrail());
    }, []);

    const trail = useCallback((world: TowerWorldId, surface: SnowTrailSurface) => {
        const key = snowKey(world, surface);
        let t = trails.current.get(key);
        if (!t) {
            t = newSnowTrail();
            trails.current.set(key, t);
        }
        return t;
    }, []);

    const reset = useCallback(() => {
        clearSnowStorage();
        settled.current.clear();
        trails.current.clear();
        setShedding({});
        setClocks({});
        setEntryRound((n) => n + 1);
    }, []);

    const cover = (world: TowerWorldId, component: SnowComponent): SnowCover | undefined => {
        if (!shown) return undefined;
        const key = snowKey(world, component);
        if (clocks[key]?.snowy) return LYING;
        const shed = shedding[key];
        return shed ? { shed } : undefined;
    };

    return { cover, clear, trail, reset };
}

/** One shared object for every lying cover, so props compare equal across renders. */
const LYING: SnowCover = {};
