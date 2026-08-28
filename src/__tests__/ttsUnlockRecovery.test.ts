import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Regression tests for the "audio dies until I restart the app" bug.
 *
 * The failure (fixed 2026-08-28): iOS suspends the shared AudioContext whenever
 * it takes audio focus — an incoming call, an app switch, the screen locking —
 * and never resumes it on its own. `CloudTTSProvider` held a one-way
 * `audioUnlocked` flag AND registered its gesture listener with `{ once: true }`,
 * so after the session's first tap there was no path left that could ever call
 * `resume()` from inside a gesture, which is the only place WebKit accepts it.
 * Narration went permanently silent while game sound effects — which re-resume
 * on every tap — kept working.
 *
 * These tests pin the three properties that make recovery possible. They assert
 * REPEATABILITY, not iOS behavior, which no headless test can reach:
 *   1. the gesture listener is persistent, not one-shot;
 *   2. unlock() resumes a context that has gone un-running mid-session;
 *   3. a refused element play() does not latch, so a later gesture retries.
 *
 * Covers: src/services/tts/CloudTTSProvider.ts → unlock, unlockContext,
 * unlockElement, ensureUnlockListener. Documented in docs/AUDIO_PLAYBACK.md § 5.
 */

type Listener = (ev?: unknown) => void;

/** Minimal AudioContext double: only what unlockContext/ensureContext touch. */
class FakeAudioContext {
    // Starts suspended, exactly as a context constructed outside a gesture does.
    state = 'suspended';
    sampleRate = 48000;
    destination = {};
    resumeCalls = 0;
    /** Flip false to model WebKit refusing a resume outside a gesture. */
    resumeAllowed = true;

    resume(): Promise<void> {
        this.resumeCalls += 1;
        if (!this.resumeAllowed) return Promise.reject(new Error('refused'));
        this.state = 'running';
        return Promise.resolve();
    }
    createBuffer() { return { duration: 0 }; }
    createBufferSource() {
        return { buffer: null, connect() { }, start() { }, stop() { }, onended: null };
    }
}

/**
 * Controls whether the NEXT-constructed element's play() resolves. The provider
 * creates its element lazily inside unlock(), so a test that needs the first
 * attempt refused has to set this before it, not on the instance after.
 */
let playResolves = true;

/** Minimal HTMLAudioElement double. Refusal models an autoplay-policy block. */
class FakeAudio {
    src = '';
    muted = false;
    playCalls = 0;
    playResolves = playResolves;
    play(): Promise<void> {
        this.playCalls += 1;
        return this.playResolves ? Promise.resolve() : Promise.reject(new Error('refused'));
    }
    pause() { }
    load() { }
    removeAttribute() { }
}

interface Registration { type: string; handler: Listener; options?: AddEventListenerOptions }

let registrations: Registration[] = [];
let contexts: FakeAudioContext[] = [];
let elements: FakeAudio[] = [];

/** Let queued promise callbacks (resume/play continuations) run. */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Fire every registered listener of a type, honoring `{ once: true }` removal. */
function dispatch(type: string): void {
    for (const reg of [...registrations]) {
        if (reg.type !== type) continue;
        reg.handler();
        if (reg.options?.once) registrations = registrations.filter(r => r !== reg);
    }
}

const g = globalThis as Record<string, unknown>;

beforeEach(() => {
    registrations = [];
    contexts = [];
    elements = [];
    playResolves = true;
    const target = {
        addEventListener(type: string, handler: Listener, options?: AddEventListenerOptions) {
            registrations.push({ type, handler, options });
        },
        removeEventListener(type: string, handler: Listener) {
            registrations = registrations.filter(r => !(r.type === type && r.handler === handler));
        },
    };
    g.window = {
        ...target,
        AudioContext: function () { const c = new FakeAudioContext(); contexts.push(c); return c; },
        Audio: function () { const a = new FakeAudio(); elements.push(a); return a; },
    };
    g.document = { ...target, visibilityState: 'visible' };
    g.AudioContext = (g.window as { AudioContext: unknown }).AudioContext;
    g.Audio = (g.window as { Audio: unknown }).Audio;
});

afterEach(() => {
    delete g.window;
    delete g.document;
    delete g.AudioContext;
    delete g.Audio;
});

/**
 * A fresh provider per test. All the unlock state we exercise is per-INSTANCE
 * (`unlockListenerInstalled`, `elementActivated`, `audioCtx`), so a new object is
 * a clean session; the module itself needs no reset.
 */
async function makeProvider() {
    const { CloudTTSProvider } = await import('../services/tts/CloudTTSProvider');
    return new CloudTTSProvider() as unknown as { unlock(): void };
}

describe('CloudTTSProvider gesture unlock', () => {
    it('keeps the pointerdown listener registered after the first gesture', async () => {
        const provider = await makeProvider();
        provider.unlock();

        const before = registrations.filter(r => r.type === 'pointerdown');
        expect(before).toHaveLength(1);
        // The bug: `{ once: true }` here spent the session's only recovery on
        // whatever the user happened to tap first.
        expect(before[0].options?.once).toBeFalsy();

        dispatch('pointerdown');
        expect(registrations.filter(r => r.type === 'pointerdown')).toHaveLength(1);
    });

    it('resumes a context that was suspended AFTER a successful unlock', async () => {
        const provider = await makeProvider();
        provider.unlock();
        await flush();

        const ctx = contexts[0];
        expect(ctx.state).toBe('running');
        const resumesAfterFirstUnlock = ctx.resumeCalls;

        // The OS takes audio focus. WebKit's fourth state, absent from the DOM
        // `AudioContextState` union — a `!== 'suspended'` check would miss it.
        ctx.state = 'interrupted';

        // The user taps. Under the old latch this call did nothing at all.
        dispatch('pointerdown');
        await flush();

        expect(ctx.resumeCalls).toBeGreaterThan(resumesAfterFirstUnlock);
        expect(ctx.state).toBe('running');
    });

    it('costs no resume() call when the context is already running', async () => {
        const provider = await makeProvider();
        provider.unlock();
        await flush();
        const ctx = contexts[0];
        const settled = ctx.resumeCalls;

        // The common case: hundreds of taps through a healthy session.
        dispatch('pointerdown');
        dispatch('pointerdown');
        await flush();

        expect(ctx.resumeCalls).toBe(settled);
    });

    it('retries element priming when the browser refused the silent play()', async () => {
        // The browser blocks the first attempt — e.g. the "gesture" was a
        // synthetic event, or the tab had not been interacted with yet.
        playResolves = false;
        const provider = await makeProvider();
        provider.unlock();
        await flush();

        const el = elements[0];
        expect(el.playCalls).toBe(1);

        // A rejected play() proves nothing was activated, so the next gesture
        // must try again. The regression was recording success on ATTEMPT.
        el.playResolves = true;
        dispatch('pointerdown');
        await flush();
        expect(el.playCalls).toBe(2);

        // ...and once it succeeds the latch closes: element activation is
        // durable, so further gestures must not pay for a redundant play().
        dispatch('pointerdown');
        await flush();
        expect(el.playCalls).toBe(2);
    });
});
