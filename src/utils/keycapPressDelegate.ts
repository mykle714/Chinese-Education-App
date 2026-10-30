import { KEYCAP_MARKER_PROPERTY, KEYCAP_MIN_HELD_MS, KEYCAP_PRESSED_CLASS } from "../theme/keycapPress";

/**
 * keycapPressDelegate — the ONE place that drives every raised key's pressed look from
 * pointer events, app-wide. Installed once at startup (main.tsx → `installKeycapPress`).
 *
 * WHY not CSS `:active` alone:
 *   1. A tap whose click does heavy work never shows `:active`: the press only paints on
 *      a frame drawn while the finger is down, and a quick tap rarely gets one before the
 *      click's work blocks the main thread (the flp's More Info / Compare, which mount the
 *      eip). Setting the class on pointerdown, imperatively (no React render), gets the
 *      press onto the very next frame.
 *   2. MINIMUM HELD TIME: a release sooner than KEYCAP_MIN_HELD_MS keeps the key down for
 *      the rest of it, so even the quickest tap shows a visible press.
 *   3. A key inside a drag handle (the eip's upper panel, @use-gesture `useDrag`) loses
 *      `:active` to the handle's pointer capture. The release is heard on `window`, so
 *      capture does not matter here.
 *
 * WHICH elements are keys: whatever spreads `keycapPressSx` (src/theme/keycapPress.ts),
 * which sets the marker custom property KEYCAP_MARKER_PROPERTY to 1. It is registered
 * NON-INHERITING (`registerKeycapMarker`), so only the key itself carries it, not its
 * label or icon. Where `CSS.registerProperty` is missing the marker inherits, so the walk
 * keeps climbing to the OUTERMOST marked element — the key — either way. No consumer has
 * to opt in: a new keycap gets the press by spreading `keycapPressSx`.
 *
 * Skipped: disabled keys (`:disabled`, `aria-disabled="true"`), non-primary mouse buttons.
 * A press that travels past DRAG_SLOP_PX is a drag (a sheet resize, a scroll), and lets the
 * key up at once. Multi-touch is per pointer (two thumbs on the beginner keyboard).
 *
 * The class is added outside React, so a key that re-renders with a CHANGED className
 * mid-press (EipAddKey flips Add → Added! on the tap itself) has its class attribute
 * rewritten by React. A MutationObserver on the held keys puts the class back while the
 * key is still down (`held`).
 *
 * Layer: shared util (DOM behaviour). Depends on: theme/keycapPress.ts. Depended on by:
 * main.tsx. Docs: docs/EIP_SHEET_GESTURES.md § Add key; docs/DECK_TOWER.md § "Studying the
 * tower" → "Tap responsiveness".
 */

/** Past this many px of travel the gesture is a drag, not a key press. */
const DRAG_SLOP_PX = 8;

interface ActivePress {
    key: HTMLElement;
    x: number;
    y: number;
    downAt: number;
}

/** The marked key under `target`, or null. */
function findKey(target: EventTarget | null): HTMLElement | null {
    let node = target instanceof Element ? target : null;
    let key: HTMLElement | null = null;
    while (node && node !== document.documentElement) {
        if (getComputedStyle(node).getPropertyValue(KEYCAP_MARKER_PROPERTY).trim() === "1") {
            key = node as HTMLElement;
        } else if (key) {
            break; // past the top of the marked run: `key` is the outermost marked element
        }
        node = node.parentElement;
    }
    return key;
}

function isDisabled(key: HTMLElement): boolean {
    return key.matches(":disabled") || key.getAttribute("aria-disabled") === "true";
}

/** Registers the marker as non-inheriting (see the module comment). Safe to call twice. */
function registerKeycapMarker(): void {
    try {
        CSS.registerProperty?.({ name: KEYCAP_MARKER_PROPERTY, syntax: "<integer>", inherits: false, initialValue: "0" });
    } catch {
        // Already registered (HMR re-run), or unsupported: findKey copes with inheritance.
    }
}

let installed = false;

/** Installs the window listeners. Idempotent. */
export function installKeycapPress(): void {
    if (installed || typeof window === "undefined") return;
    installed = true;
    registerKeycapMarker();

    const active = new Map<number, ActivePress>();
    // Pending "let the key back up" timers, per key, so a re-press can cancel its own.
    const holdTimers = new Map<HTMLElement, number>();

    // Keys currently shown pressed (held, or inside their minimum held time).
    const held = new Set<HTMLElement>();
    const reapply = new MutationObserver((records) => {
        for (const r of records) {
            const key = r.target as HTMLElement;
            if (held.has(key) && !key.classList.contains(KEYCAP_PRESSED_CLASS)) {
                key.classList.add(KEYCAP_PRESSED_CLASS);
            }
        }
    });
    const observeHeld = () => {
        reapply.disconnect();
        for (const key of held) reapply.observe(key, { attributes: true, attributeFilter: ["class"] });
    };

    const lift = (key: HTMLElement) => {
        holdTimers.delete(key);
        // Still held by another pointer (two fingers on one key): stay down.
        for (const p of active.values()) if (p.key === key) return;
        held.delete(key);
        observeHeld();
        key.classList.remove(KEYCAP_PRESSED_CLASS);
    };

    const release = (pointerId: number, honourMinHeld: boolean) => {
        const press = active.get(pointerId);
        if (!press) return;
        active.delete(pointerId);
        const remaining = honourMinHeld ? KEYCAP_MIN_HELD_MS - (performance.now() - press.downAt) : 0;
        if (remaining > 0) {
            holdTimers.set(press.key, window.setTimeout(() => lift(press.key), remaining));
        } else {
            lift(press.key);
        }
    };

    window.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const key = findKey(e.target);
        if (!key || isDisabled(key)) return;
        const pending = holdTimers.get(key);
        if (pending !== undefined) {
            window.clearTimeout(pending);
            holdTimers.delete(key);
        }
        active.set(e.pointerId, { key, x: e.clientX, y: e.clientY, downAt: performance.now() });
        key.classList.add(KEYCAP_PRESSED_CLASS);
        if (!held.has(key)) {
            held.add(key);
            observeHeld();
        }
    }, { capture: true, passive: true });

    window.addEventListener("pointermove", (e) => {
        const press = active.get(e.pointerId);
        if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_SLOP_PX) {
            release(e.pointerId, false);
        }
    }, { capture: true, passive: true });

    const onUp = (e: PointerEvent) => release(e.pointerId, e.type === "pointerup");
    window.addEventListener("pointerup", onUp, { capture: true, passive: true });
    window.addEventListener("pointercancel", onUp, { capture: true, passive: true });
}
