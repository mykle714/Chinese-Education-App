import type { TowerWorldId } from "./towerWorlds";

/**
 * towerSnow — the rule for snow settling on the Deck Tower's platform, and its per-device
 * store (docs/TOWER_SNOW.md).
 *
 * Layer: page logic (feature module `src/features/deckTower`). Pure functions plus a small
 * localStorage reader / writer; useTowerSnow.ts holds the live state and DeckTowerPage
 * wires it to the scene.
 *
 * ── The rule ───────────────────────────────────────────────────────────────────
 * Every snowable COMPONENT of every world (`SnowComponent`) keeps a clock: when its snow
 * was last cleared, and whether it is snowy now. It is checked ONLY ON PAGE ENTRY
 * (`settleOnEntry`): if it is snowing then and the component was last cleared at least
 * `SNOW_SETTLES_AFTER_MS` (6 h) ago — or never — it turns snowy. Once snowy it STAYS snowy,
 * snowing or not, until something clears it (`clearedClock`). Weather that turns to snow
 * while the learner is on the page adds nothing until they leave and come back.
 *
 * The tower has one extra gate: a tower whose top stands at or above the cloud base
 * (`cloudBaseCards`, the cloud band's floor) on entry is above the snow and is not snowy.
 *
 * Depended on by: useTowerSnow.ts; __tests__/towerSnow.test.ts.
 * Docs: docs/TOWER_SNOW.md § "The rule", § "Storage".
 */

/**
 * Everything on a platform that holds snow. `plate` is the floor's snow lying over the deck
 * plate (buried under the floor's sheet): pressing the plate brushes it off on its own.
 */
export type SnowComponent = "floor" | "plate" | "tower" | "lever" | "sortBin" | "notebook";
export const SNOW_COMPONENTS: readonly SnowComponent[] = ["floor", "plate", "tower", "lever", "sortBin", "notebook"];

/** How long since its last clear a component must be before falling snow can settle on it. */
export const SNOW_SETTLES_AFTER_MS = 6 * 60 * 60 * 1000;

/** One component's snow clock. */
export interface SnowClock {
    /** Epoch ms of the last clear; null = never cleared (infinitely stale). */
    lastClearedAt: number | null;
    snowy: boolean;
}

/** Every component's clock, keyed by `snowKey`. A missing key is a never-cleared, bare component. */
export type SnowClocks = Record<string, SnowClock>;

export const BARE_CLOCK: SnowClock = { lastClearedAt: null, snowy: false };

export function snowKey(world: TowerWorldId, component: SnowComponent): string {
    return `${world}:${component}`;
}

/**
 * The page-entry check for one component. `snowing` is whether it snows right now;
 * `canSettle` is false where snow cannot reach (a tower above the cloud base).
 * A component that cannot settle and IS snowy is left as it is, except the tower above the
 * clouds, which the caller passes through `aboveClouds` (it is shown bare: owner's rule,
 * docs/TOWER_SNOW.md § "The tower").
 */
export function settleOnEntry(
    clock: SnowClock,
    { snowing, now, aboveClouds = false }: { snowing: boolean; now: number; aboveClouds?: boolean },
): SnowClock {
    // Above the clouds no snow reaches the top. The clock itself is kept (no clear happened),
    // so a tower that shrinks back under the clouds can snow over on a later entry.
    if (aboveClouds) return clock.snowy ? { ...clock, snowy: false } : clock;
    if (clock.snowy || !snowing) return clock;
    const stale = clock.lastClearedAt === null || now - clock.lastClearedAt >= SNOW_SETTLES_AFTER_MS;
    return stale ? { ...clock, snowy: true } : clock;
}

/** A component just cleared at `now`. */
export function clearedClock(now: number): SnowClock {
    return { lastClearedAt: now, snowy: false };
}

// ── Storage ──────────────────────────────────────────────────────────────────
// Per device (owner's choice 2026-11-09), like the weather setting it depends on.

const STORAGE_KEY = "deckTower.snow";

function isClock(v: unknown): v is SnowClock {
    if (!v || typeof v !== "object") return false;
    const c = v as Record<string, unknown>;
    return typeof c.snowy === "boolean" && (c.lastClearedAt === null || typeof c.lastClearedAt === "number");
}

/** The stored clocks; anything unreadable is dropped (that component reads as bare, never cleared). */
export function readSnowClocks(): SnowClocks {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        const out: SnowClocks = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (isClock(v)) out[k] = v;
        return out;
    } catch {
        return {};
    }
}

export function writeSnowClocks(clocks: SnowClocks): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(clocks));
    } catch {
        // Storage unavailable: snow just won't persist past this visit.
    }
}

/** The tester reset (WeatherToggle's ❄ Reset): every clock back to never-cleared. */
export function clearSnowStorage(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Nothing stored to clear.
    }
}
