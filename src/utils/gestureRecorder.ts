import { API_BASE_URL } from "../constants";

/**
 * Raw touch-gesture recorder, the capture half of the swipe-tuning lab.
 *
 * Built to tune the flp card's swipe/tap classifier (useCardDrag) from REAL phone input:
 * quick flicks were not registering as swipes, and the classifier's thresholds had only
 * ever been picked by feel on a desktop. This module records exactly what the browser
 * delivered for each gesture (every touch sample with its event timestamp, plus the
 * pointer stream's coalesced samples, which arrive at the digitizer rate rather than the
 * frame rate) and ships it to the server as JSONL — it never decides anything itself.
 *
 * Two callers:
 *   • /swipe-lab (src/pages/swipeLab/SwipeLabPage.tsx) — guided, LABELED gestures on a
 *     lab card driven by the production useCardDrag hook.
 *   • the live flp (src/features/flashcards/FlashcardsLearnPage/flpGestureProbe.ts) —
 *     UNLABELED gestures in real study conditions, plus the fly-out clip probe. Off unless
 *     the device opted in from the lab (`isFlpRecordingOn`).
 *
 * Sink: POST /api/diagnostics/gestures (server/routes/diagnosticsRoutes.ts), written to
 * `client-gestures-YYYY-MM-DD.jsonl` by server/utils/diagnosticsLog.ts.
 * Docs: docs/SWIPE_LAB.md, docs/CLIENT_PERF_DIAGNOSTICS.md.
 */

const ENDPOINT = `${API_BASE_URL}/api/diagnostics/gestures`;

/** Per-device opt-in for recording the live flp. Set from the lab page's toggle. */
const FLP_RECORDING_KEY = "swipeLab.recordFlp";

/** Hard caps so one runaway gesture can't blow past the server's 100 kB json limit. */
const MAX_TOUCH_SAMPLES = 400;
const MAX_POINTER_SAMPLES = 600;

/** One touch event as delivered: `t` is the event's own timeStamp (performance.now() clock). */
export interface TouchSample {
    type: "start" | "move" | "end" | "cancel";
    t: number;
    x: number;
    y: number;
    /** Touches still down after this event — >1 means a second finger joined. */
    n: number;
}

/** One pointer sample; coalesced samples share their parent event's `type`. */
export interface PointerSample {
    type: "down" | "move" | "up" | "cancel";
    t: number;
    x: number;
    y: number;
}

/** Everything the browser told us about one finger-down → all-fingers-up gesture. */
export interface RawGesture {
    startedAt: number;
    endedAt: number | null;
    touches: TouchSample[];
    pointers: PointerSample[];
}

export function isFlpRecordingOn(): boolean {
    try {
        return localStorage.getItem(FLP_RECORDING_KEY) === "1";
    } catch {
        return false;
    }
}

export function setFlpRecording(on: boolean): void {
    try {
        if (on) localStorage.setItem(FLP_RECORDING_KEY, "1");
        else localStorage.removeItem(FLP_RECORDING_KEY);
    } catch {
        /* storage unavailable (private mode) — the toggle just won't stick */
    }
}

/** Device facts every record batch carries, so velocities can be read in physical units. */
export function deviceInfo() {
    return {
        userAgent: navigator.userAgent.slice(0, 400),
        dpr: window.devicePixelRatio,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        screen: { w: window.screen?.width, h: window.screen?.height },
        maxTouchPoints: navigator.maxTouchPoints,
    };
}

/** A per-tab id so one sitting's records group together in the JSONL. */
export const GESTURE_SESSION_ID =
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Watch `el` for gestures. Listeners are capture-phase and PASSIVE: they observe the same
 * events the card's own handlers get, before them, and can never cancel or delay one —
 * recording must not change the thing it measures.
 *
 * `onGestureEnd` fires once the last finger lifts (or the touch is cancelled). Returns
 * the detach function.
 */
export function watchGestures(
    el: HTMLElement | Document,
    onGestureEnd: (g: RawGesture) => void,
    onGestureStart?: (g: RawGesture) => void,
    /** Only a touchstart this accepts opens a gesture (e.g. "landed on the card"). */
    startFilter?: (e: TouchEvent) => boolean,
): () => void {
    let current: RawGesture | null = null;

    const pushTouch = (type: TouchSample["type"], e: TouchEvent) => {
        if (!current || current.touches.length >= MAX_TOUCH_SAMPLES) return;
        // A start/move reports the touch it is about; an end reports the lifted finger
        // in changedTouches (touches[] no longer holds it).
        const tp = e.changedTouches[0] ?? e.touches[0];
        if (!tp) return;
        current.touches.push({
            type,
            t: round1(e.timeStamp),
            x: round1(tp.clientX),
            y: round1(tp.clientY),
            n: e.touches.length,
        });
    };

    const onTouchStart = (e: Event) => {
        const te = e as TouchEvent;
        // A second finger landing mid-gesture extends the current gesture rather than
        // starting a new one — the classifier only ever reads touches[0].
        if (!current) {
            if (startFilter && !startFilter(te)) return;
            current = { startedAt: round1(te.timeStamp), endedAt: null, touches: [], pointers: [] };
            onGestureStart?.(current);
        }
        pushTouch("start", te);
    };
    const onTouchMove = (e: Event) => pushTouch("move", e as TouchEvent);
    const finish = (type: "end" | "cancel") => (e: Event) => {
        const te = e as TouchEvent;
        pushTouch(type, te);
        if (current && te.touches.length === 0) {
            current.endedAt = round1(te.timeStamp);
            const done = current;
            current = null;
            onGestureEnd(done);
        }
    };
    const onTouchEnd = finish("end");
    const onTouchCancel = finish("cancel");

    const pushPointer = (type: PointerSample["type"]) => (e: Event) => {
        const pe = e as PointerEvent;
        if (!current || pe.pointerType !== "touch") return;
        // Coalesced samples are the ones the browser merged into this frame's single
        // pointermove — the digitizer's true rate, which is what a flick velocity needs.
        const batch = type === "move" && typeof pe.getCoalescedEvents === "function"
            ? pe.getCoalescedEvents()
            : [];
        const samples = batch.length > 0 ? batch : [pe];
        for (const s of samples) {
            if (current.pointers.length >= MAX_POINTER_SAMPLES) return;
            current.pointers.push({ type, t: round1(s.timeStamp), x: round1(s.clientX), y: round1(s.clientY) });
        }
    };
    const onPointerDown = pushPointer("down");
    const onPointerMove = pushPointer("move");
    const onPointerUp = pushPointer("up");
    const onPointerCancel = pushPointer("cancel");

    const opts: AddEventListenerOptions = { capture: true, passive: true };
    const pairs: [string, EventListener][] = [
        ["touchstart", onTouchStart],
        ["touchmove", onTouchMove],
        ["touchend", onTouchEnd],
        ["touchcancel", onTouchCancel],
        ["pointerdown", onPointerDown],
        ["pointermove", onPointerMove],
        ["pointerup", onPointerUp],
        ["pointercancel", onPointerCancel],
    ];
    for (const [type, fn] of pairs) el.addEventListener(type, fn, opts);
    return () => {
        for (const [type, fn] of pairs) el.removeEventListener(type, fn, opts);
    };
}

/** Compact rect for the JSONL: integers are plenty for layout. */
export function rectOf(el: Element) {
    const r = el.getBoundingClientRect();
    return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) };
}

/**
 * POST a batch of records. Resolves true when the server accepted it. Uses a keepalive
 * fetch (not sendBeacon) so the lab can show whether each gesture actually landed — a
 * dropped upload is a lost data point the tester should know about, not swallow.
 *
 * Deliberately not via src/api/http.ts: the sink is unauthenticated and must not get the
 * 401-refresh retry loop, mirroring perfDiagnostics/errorReporting.
 */
export async function sendGestureRecords(records: unknown[]): Promise<boolean> {
    if (records.length === 0) return true;
    try {
        const body = JSON.stringify({ session: GESTURE_SESSION_ID, device: deviceInfo(), records });
        const res = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            // keepalive lets a batch outlive a navigation, but browsers refuse a keepalive
            // body over 64 KiB outright — so a long gesture goes as a plain fetch.
            keepalive: body.length < 60_000,
        });
        return res.ok;
    } catch {
        return false;
    }
}
