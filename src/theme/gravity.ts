// The iso world's FALL PHYSICS — per fall type, each with its own gravity, start speed and jerk.
//
// Every fall in the Deck Tower's world belongs to one FALL TYPE, and each type has its own
// three parameters (`FallParams`):
//
//   trapDoor      the trap door's falling tower            deckTransitions.ts → TRAP_DOOR
//   skyFall       the pawn's sky-fall entrance, the flp    pawnEntrances.ts → `fallFromHeight`
//                 hint pawn's drop — AND the pawn's own     usePawnMotion.ts (gravity only:
//                 physics: plate launch, poke jump,           `pawnGravity`)
//                 bounces, its fall with the trap door
//   skyDrop       a sky drop's falling tower               towerResizes.ts → SKY_DROP
//   collapse      a ghost collapse's settling runs         iso/cardCollapse.ts → `planCardCollapse`
//   launchScreen  the launch screen's pawn drop            launch/LaunchScreen.tsx → `planDrop`
//
// History: until 2026-11-20 morning each fall had its own gravity constant (60 / 110 / 130 /
// 140 / 170); they were folded into one shared gravity, then a start speed and a jerk were
// added, then (owner, 2026-11-20) split back out per fall type so each can be tuned on its
// own. All five start at the same values (110 / 0 / 0), so splitting changed nothing yet.
//
// The pawn's upward throws (plate launch, poke) take only the skyFall GRAVITY: they are set
// by their apex heights, and start speed / jerk are fall knobs, never throw knobs.
//
// Units: gravity world units / s², start speed world units / s (downward), jerk world
// units / s³. A pawn is ~2 units tall, so this is cartoon gravity.
//
// NOT covered: ConfettiBurst (src/components/ConfettiBurst.tsx) — it falls in SCREEN px over
// DOM, not in the iso world, so it keeps its own px/s² constant.
//
// ── Tuning ──────────────────────────────────────────────────────────────────────
// `/gravity-lab` (src/pages/gravityLab/GravityLabPage.tsx) sets temporary OVERRIDES of any
// parameter of any fall type, so it can be felt live on the real components. Overrides live in
// memory and in sessionStorage (they survive a reload of the tab, die with the tab), so they
// can never leak into a real session. The endpoint is to hardcode the winners in
// FALL_DEFAULTS below.
//
// Every consumer reads `fallParams(type)` (or `pawnGravity()`) at USE time — once per plan, or
// per frame for the pawn — never caching it in a module constant, so a lab change takes effect
// on the next fall without a reload.
//
// Docs: docs/GRAVITY_LAB.md, docs/DECK_TOWER_TRANSITIONS.md, docs/ISO_ART_FRAMEWORK.md.

import { useSyncExternalStore } from "react";

/** Everything a fall depends on. */
export interface FallParams {
    /** Gravity, world units / s² (> 0). */
    g: number;
    /** Start speed, world units / s downward (≥ 0). 0 = from rest. */
    v0: number;
    /**
     * Jerk, world units / s³ (≥ 0): how fast the acceleration grows (a fall accelerates at
     * g + j·t). Positive only (owner, 2026-11-20): with j ≥ 0 every fall lands and its curve is
     * a cubic a CSS cubic-bezier represents exactly (`fallEasing`).
     */
    j: number;
}

export type FallParam = keyof FallParams;

/** Every fall type, in the lab's display order. */
export const FALL_TYPES = ["trapDoor", "skyFall", "skyDrop", "collapse", "launchScreen"] as const;
export type FallType = (typeof FALL_TYPES)[number];

/** The hardcoded parameters per fall type. 110 is the pawn's long-tuned gravity (it was PAWN_GRAVITY). */
export const FALL_DEFAULTS: Record<FallType, FallParams> = {
    trapDoor: { g: 110, v0: 0, j: 0 },
    skyFall: { g: 110, v0: 0, j: 0 },
    skyDrop: { g: 110, v0: 0, j: 0 },
    collapse: { g: 110, v0: 0, j: 0 },
    launchScreen: { g: 110, v0: 0, j: 0 },
};

/**
 * The lab's slider range per parameter. Gravity goes down to 1 for extreme slow motion
 * (owner, 2026-11-20); every fall formula divides by g, so it must stay > 0. Below ~45 skyFall
 * gravity the sky fall outlasts the trap door's ready beat, and below ~59 the plate launch
 * delays every swap (the lab's checks).
 */
export const FALL_PARAM_RANGE: Record<FallParam, { min: number; max: number }> = {
    g: { min: 1, max: 300 },
    v0: { min: 0, max: 60 },
    j: { min: 0, max: 1000 },
};

// ── The lab's overrides ─────────────────────────────────────────────────────────

const STORAGE_PREFIX = "gravityLab.";
const keyOf = (type: FallType, param: FallParam) => `${STORAGE_PREFIX}${type}.${param}`;
const isValid = (param: FallParam, v: number) => Number.isFinite(v) && (param === "g" ? v > 0 : v >= 0);

function readStoredOverrides(): Partial<Record<FallType, Partial<FallParams>>> {
    const out: Partial<Record<FallType, Partial<FallParams>>> = {};
    try {
        for (const type of FALL_TYPES) {
            for (const param of ["g", "v0", "j"] as const) {
                const raw = sessionStorage.getItem(keyOf(type, param));
                if (raw === null) continue;
                const v = Number(raw);
                if (isValid(param, v)) (out[type] ??= {})[param] = v;
            }
        }
    } catch {
        // Storage blocked (private mode, sandboxed iframe): no overrides.
    }
    return out;
}

let overrides = readStoredOverrides();
/** Bumped on every change, so the React binding's snapshot is a cheap, stable value. */
let version = 0;
const listeners = new Set<() => void>();
/** Snapshots per type, rebuilt only when `version` moves (useSyncExternalStore needs a stable object). */
const snapshots = new Map<FallType, { version: number; params: FallParams }>();

/** The parameters in force for `type` right now: the lab's overrides where set, else the defaults. */
export function fallParams(type: FallType): FallParams {
    const cached = snapshots.get(type);
    if (cached && cached.version === version) return cached.params;
    const params = { ...FALL_DEFAULTS[type], ...overrides[type] };
    snapshots.set(type, { version, params });
    return params;
}

/** The pawn's own gravity (plate launch, poke, bounces, its fall with the trap door): the sky fall's (owner, 2026-11-20). */
export function pawnGravity(): number {
    return fallParams("skyFall").g;
}

/** True while any lab override is in force (the lab shows a banner; nothing else should care). */
export function hasGravityOverride(): boolean {
    return Object.values(overrides).some((o) => o && Object.keys(o).length > 0);
}

/**
 * Sets (or, with null, clears) one parameter of one fall type. Only `/gravity-lab` should
 * call this. The shipped value clears the override, so "overridden" always means "differs
 * from what ships".
 */
export function setGravityOverride(type: FallType, param: FallParam, value: number | null): void {
    const next = value === null || !isValid(param, value) || value === FALL_DEFAULTS[type][param] ? null : value;
    if ((overrides[type]?.[param] ?? null) === next) return;
    const forType = { ...overrides[type] };
    if (next === null) delete forType[param];
    else forType[param] = next;
    overrides = { ...overrides, [type]: forType };
    version++;
    try {
        if (next === null) sessionStorage.removeItem(keyOf(type, param));
        else sessionStorage.setItem(keyOf(type, param), String(next));
    } catch {
        // Storage blocked: the override still holds for this page's life.
    }
    listeners.forEach((fn) => fn());
}

/** Clears every override (the lab's "Reset all"). */
export function clearGravityOverrides(): void {
    for (const type of FALL_TYPES) for (const param of ["g", "v0", "j"] as const) setGravityOverride(type, param, null);
}

function subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** React binding for components that DISPLAY the values (the lab). Motion code calls `fallParams` directly. */
export function useFallParams(type: FallType): FallParams {
    const get = () => fallParams(type);
    return useSyncExternalStore(subscribe, get, get);
}

/** Re-renders on ANY override change (the lab's banner and timings table). */
export function useGravityVersion(): number {
    const get = () => version;
    return useSyncExternalStore(subscribe, get, get);
}

// ── Fall math — the one source for every fall's time, position and CSS curve ──────
//
// A fall of `distance` world units that starts at speed v0 (downward), under gravity g with
// jerk j (acceleration g + j·t):
//   distance fallen after s seconds   d(s) = v0·s + ½·g·s² + ⅙·j·s³
//   time to fall `distance`           T    = the root of d(T) = distance (closed form when
//                                            j = 0: (√(v0² + 2·g·distance) − v0) / g)
// A planner reads `fallParams(type)` once and passes the same object to every call, so a
// plan's time and its curve always agree.

/** World units fallen `seconds` into a fall. */
export function fallDistanceAt(seconds: number, p: FallParams): number {
    const s = Math.max(0, seconds);
    return p.v0 * s + 0.5 * p.g * s * s + (p.j * s * s * s) / 6;
}

/** Ms to fall `distance` world units. */
export function fallMs(distance: number, p: FallParams): number {
    if (distance <= 0) return 0;
    // The constant-acceleration time: exact when j = 0, and an upper bound otherwise (jerk only
    // adds distance), so Newton's method started here walks down onto the root monotonically —
    // d(s) is increasing and convex for s ≥ 0, which is what makes that safe.
    let s = (Math.sqrt(p.v0 * p.v0 + 2 * p.g * distance) - p.v0) / p.g;
    if (p.j > 0) {
        for (let i = 0; i < 40; i++) {
            const speed = p.v0 + p.g * s + 0.5 * p.j * s * s;
            const step = (fallDistanceAt(s, p) - distance) / speed;
            s -= step;
            if (Math.abs(step) < 1e-9) break;
        }
    }
    return s * 1000;
}

/**
 * The fall of `distance` as a CSS easing, for a fall played as a CSS animation over
 * `fallMs(distance, p)`. Normalized (x = t / T, y = d / distance), the fall is the cubic
 *   y = a·x + b·x² + c·x³,  a = v0·T / D,  b = ½·g·T² / D,  c = ⅙·j·T³ / D  (a + b + c = 1).
 * A cubic bezier with its x control points at 1/3 and 2/3 has x linear in its parameter, so it
 * is exactly ANY such cubic: y1 = a / 3, y2 = (b + 2a) / 3. At v0 = j = 0 this is (1/3, 0),
 * (2/3, 1/3): y = x², a fall from rest.
 */
export function fallEasing(distance: number, p: FallParams): string {
    if (distance <= 0) return "cubic-bezier(0.3333, 0.0000, 0.6667, 0.3333)";
    const t = fallMs(distance, p) / 1000;
    const a = (p.v0 * t) / distance;
    const b = (0.5 * p.g * t * t) / distance;
    return `cubic-bezier(0.3333, ${(a / 3).toFixed(4)}, 0.6667, ${((b + 2 * a) / 3).toFixed(4)})`;
}
