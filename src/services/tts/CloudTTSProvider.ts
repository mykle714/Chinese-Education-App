import { API_BASE_URL } from '../../constants';
import * as authStorage from '../../utils/authStorage';
import type { AudioRoute } from '../../hooks/useTTSSettings';
import type { TTSProvider, TTSRequest } from './types';

/**
 * Server-proxied TTS. POSTs to /api/tts/synthesize, receives an MP3 blob, and
 * plays it through one of TWO sinks selected by the user's audio-route setting.
 * Server handles the Google call + caching.
 *
 * ── The two sinks, and why both exist ───────────────────────────────────────
 * The choice of sink is not an implementation detail: on iOS it decides three
 * user-visible behaviors at once, and the platform does not let us pick them
 * independently.
 *
 *   'passthrough' → HTMLAudioElement. WebKit classifies a media element as
 *      Playback, so it IGNORES the hardware ring/silent switch. Unavoidably it
 *      also takes audio focus (the user's music pauses) and registers with the
 *      system "Now Playing" center, so lock-screen transport controls appear
 *      over a one-word pronunciation clip.
 *
 *   'media' → Web Audio (AudioBufferSourceNode). Not a media session, so it
 *      MIXES with other audio and shows no lock-screen controls, but iOS
 *      silences it when the ring/silent switch is off.
 *
 * There is no third option: the web platform exposes no `mixWithOthers` for the
 * Playback category, so "ignores mute" and "doesn't disturb music" cannot be had
 * together. The app shipped media-only from 2026-06-13 (to kill the lock-screen
 * controls) until the route became a user setting; passthrough is now the
 * default. On Android the mute half is moot (the silent toggle mutes the ringer
 * stream, not the media stream) but the audio-focus half still applies.
 * See docs/AUDIO_PLAYBACK.md.
 *
 * ── Caching ─────────────────────────────────────────────────────────────────
 * One fetch per word feeds both sinks: `blobCache` holds the encoded MP3 and is
 * the shared source of truth, with a per-sink derived cache hanging off it. A
 * route switch therefore costs at most a re-decode, never a round-trip.
 *
 * ── Speed ───────────────────────────────────────────────────────────────────
 * Playback is always 1.0×. There is no speech-rate feature: `playbackRate` on an
 * AudioBufferSourceNode *resamples*, which shifts PITCH along with speed and
 * distorts Chinese tones, so it must never be used to change speed here. A
 * pitch-preserving phase-vocoder time-stretch existed for this and was removed
 * along with the rate setting it served; if a speed control is ever wanted again,
 * bake the rate into synthesis server-side rather than reviving client-side DSP.
 *
 * Requires text on the request (server caches per dictionary entry). If text is
 * missing this provider throws and the caller should fall back to WebSpeech.
 */
/**
 * Is the context actually able to make sound right now?
 *
 * Written as a widened string comparison on purpose: WebKit has a FOURTH state,
 * `'interrupted'`, that the DOM `AudioContextState` union does not include, and
 * it is the state an iPhone lands in after a phone call or an app switch. A
 * `state !== 'suspended'` style check would treat that as healthy and schedule a
 * source into a context that will never play it — whose `onended` then never
 * fires, hanging the caller until its watchdog. Only 'running' is running.
 */
function isContextRunning(ctx: AudioContext): boolean {
    return (ctx.state as string) === 'running';
}

export class CloudTTSProvider implements TTSProvider {
    readonly name = 'cloud' as const;

    // Which sink speak() uses. Mirrors the user's setting; useTTS pushes it in
    // so the provider never reads React state itself. Defaults to passthrough to
    // match DEFAULT_SETTINGS in useTTSSettings.
    private route: AudioRoute = 'passthrough';

    // --- 'media' sink state (Web Audio) --------------------------------------
    // The single session-scoped AudioContext. Created lazily (decoding needs a
    // context, and that can happen at prefetch time before any gesture) and
    // resumed inside the first user gesture by unlock(). One context is reused
    // for the whole session so decoded buffers stay valid and the gesture
    // activation we earn on iOS persists across utterances.
    private audioCtx: AudioContext | null = null;
    // The source node for the utterance currently playing, or null when idle.
    // Source nodes are one-shot in Web Audio, so each speak() creates a fresh
    // one; this handle exists only so cancel() can stop the live one.
    private currentSource: AudioBufferSourceNode | null = null;

    // --- 'passthrough' sink state (media element) ----------------------------
    // ONE long-lived element reused for every utterance. Per-utterance audio is
    // swapped in via `src =` rather than `new Audio()` so it inherits the
    // element's user-activation flag (see unlockElement).
    private audioEl: HTMLAudioElement | null = null;
    // True while the element is mid-utterance, so cancel() knows to pause it.
    private elementPlaying = false;
    // Settles the live element utterance's promise. pause() does not fire
    // 'ended', so without this a cancelled utterance would hang until its
    // watchdog fired — seconds, on a long sentence.
    private elementCleanup: (() => void) | null = null;

    // Monotonic counter incremented on every speak()/cancel(). A speak() in
    // flight captures its generation before awaiting the network fetch; when
    // the fetch resolves, if the generation no longer matches the latest, the
    // call bails out before starting playback. This closes the race where
    // cancel() can't stop playback that hasn't been started yet.
    private generation = 0;

    // --- Caches --------------------------------------------------------------
    // The shared source of truth: one fetch per word, kept as an encoded Blob.
    // Both derived caches below are built from this, and a Blob hands out a
    // FRESH ArrayBuffer copy on every .arrayBuffer() call — which is what makes
    // it safe to decode (decodeAudioData DETACHES the buffer it is given) and
    // still mint an object URL from the same Blob afterwards.
    // Key: `${lang}:${text}:${pinyin}` (see bufferKey).
    private blobCache = new Map<string, Promise<Blob>>();
    // Derived, 'media' sink: decoded PCM, reusable across many source nodes.
    private bufferCache = new Map<string, Promise<AudioBuffer>>();
    // Derived, 'passthrough' sink: object URLs. Capped and revoked on eviction —
    // createObjectURL pins its Blob for the life of the document otherwise, and
    // this map would grow once per distinct word played in a session.
    private urlCache = new Map<string, string>();
    private static MAX_CACHED_URLS = 64;

    // --- iOS / mobile autoplay unlock ---------------------------------------
    // WebKit (and to a lesser extent mobile Chrome) only allows audio to start
    // from inside a real user-gesture task. Our speak() awaits a network fetch
    // before playing, which loses gesture context, so without priming, playback
    // is silently dropped.
    //
    // Both sinks need priming, and they need DIFFERENT priming: the context must
    // be resume()d, while the element must have play() called on it. unlock()
    // does both on any gesture regardless of the active route, so a later route
    // switch never has to hunt for a fresh gesture.
    //
    // ⚠️ NOTHING HERE MAY LATCH THE CONTEXT SHUT. This used to hold an
    // `audioUnlocked` flag that, once true, made unlock() a no-op for the rest
    // of the session — and the gesture listener below was `{ once: true }`. That
    // pair caused the app's worst audio bug: iOS suspends the shared context
    // whenever it takes audio focus (an incoming call, another app, locking the
    // screen) and never resumes it on its own, so after one interruption the
    // context stayed suspended, every speak() bailed out silently in
    // playViaWebAudio, and the only cure was reloading the app. The context's
    // own `state` is now the single source of truth for whether the media sink
    // can make sound — see isContextRunning — and unlock() re-primes as often as
    // it is asked to.
    private unlockListenerInstalled = false;
    // The ONE legitimate latch: a media element that has been played once inside
    // a gesture keeps its user-activation for the life of the document, so there
    // is nothing to recover and re-priming would only cost a wasted play(). Set
    // only when the silent clip's play() actually RESOLVES; a rejection leaves it
    // false so the next gesture retries.
    private elementActivated = false;
    // 1-frame silent MP3 (≈ 70 bytes) used to satisfy the gesture-bound play()
    // call on the media element without making any sound.
    private static SILENT_MP3 =
        'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfP/X9o3/+vXP///0eMpAGoEAGgIQQwQAAFAAAAQADAaqsXQAYWAUgxAYcQEEoYDQSCh4iQUEEhYg6JCAQQEoIASBQiAh4kEEEBYgwQQEcQAQQQECQQECAgQECAgQEDgIDhAYIDBAQICA4QGCAwQECDgIDhAcICBAQICBAQICBAQICAgQEDg=';

    private getToken(): string | null {
        if (typeof window === 'undefined') return null;
        return authStorage.getToken();
    }

    async isAvailable(): Promise<boolean> {
        // Cheap shape check only — we discover server-side misconfiguration on
        // the first actual call (which then surfaces an error and the caller
        // can fall back).
        return Boolean(this.getToken());
    }

    /**
     * Point future utterances at a different sink. Cheap and idempotent — it
     * does NOT interrupt anything already playing, because a route change is a
     * settings edit and cutting off a live word would read as a bug.
     */
    setRoute(route: AudioRoute): void {
        this.route = route;
    }

    /**
     * Lazily create the session AudioContext. Safe to call before any gesture:
     * the context starts 'suspended' (decoding still works in that state), and
     * unlock() resumes it later. Returns null if Web Audio is unavailable.
     */
    private ensureContext(): AudioContext | null {
        if (typeof window === 'undefined') return null;
        if (this.audioCtx) return this.audioCtx;
        const Ctor: typeof AudioContext | undefined =
            window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.audioCtx = new Ctor();
        return this.audioCtx;
    }

    /** Lazily create the one reused media element for the passthrough sink. */
    private ensureElement(): HTMLAudioElement | null {
        if (typeof window === 'undefined') return null;
        if (!this.audioEl) this.audioEl = new Audio();
        return this.audioEl;
    }

    /**
     * Install the global gesture listener that primes both sinks so later
     * programmatic playback is allowed by iOS. Idempotent and cheap — safe to
     * call from any speak()/prefetch() entry point.
     *
     * PERSISTENT, not `{ once: true }`. The listener has to survive because the
     * thing it repairs recurs: every time iOS takes audio focus away the shared
     * context suspends, and the only place we are allowed to resume it is inside
     * a gesture. A one-shot listener spends the session's single recovery on the
     * user's first tap — typically long before anything has gone wrong — and
     * leaves nothing for the interruption that actually breaks audio. This is
     * the same pattern gameSounds.getContext() uses, and the reason game blips
     * kept working through interruptions that silenced narration.
     *
     * The per-tap cost is one `ctx.state` read (see unlock → unlockContext).
     * Never removed: the provider is a session-scoped singleton.
     */
    private ensureUnlockListener(): void {
        if (typeof window === 'undefined') return;
        if (this.unlockListenerInstalled) return;
        this.unlockListenerInstalled = true;

        // pointerdown fires earliest across mouse + touch + pen. `capture: true`
        // ensures we see the gesture even if a child handler stops propagation.
        window.addEventListener('pointerdown', this.handleGesture, { capture: true });
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.handleVisibilityChange);
        }
    }

    /**
     * Every tap, not just the first. Arrow property so it keeps its `this` and
     * so the same function identity is registered once.
     */
    private handleGesture = (): void => {
        this.unlock();
    };

    /**
     * Returning to the foreground after the interruption that suspended us.
     *
     * We cannot count on resuming here — this is not a gesture, and iOS rejects
     * a bare resume() outside one. It is still worth attempting because desktop
     * Chrome and Android usually allow it, and there audio comes back with no
     * tap at all. Where it is refused, recovery is the user's next pointerdown,
     * which reaches unlock() now that nothing latches it shut.
     */
    private handleVisibilityChange = (): void => {
        if (typeof document === 'undefined') return;
        if (document.visibilityState !== 'visible') return;
        const ctx = this.audioCtx;
        if (!ctx || isContextRunning(ctx)) return;
        ctx.resume().catch(() => { /* next gesture retries */ });
    };

    /**
     * Prime BOTH sinks for playback from inside a real user-gesture task (e.g. a
     * button click or pointerdown handler). MUST be called synchronously from
     * the gesture — there must be no `await` between the gesture and this call,
     * which is exactly why speak() cannot do this work itself: it awaits the
     * fetch/decode first, and by then the gesture is gone.
     *
     * REPEATABLE by design, and cheap when there is nothing to do: the fast path
     * is a single `ctx.state` read. It runs on every pointerdown in the app, and
     * that is the point — it is the app's only recovery from an OS interruption
     * suspending the shared context. Do not reintroduce an "already unlocked"
     * latch here; see the field block above for what that latch cost.
     *
     * Skipped for the element while a real utterance is playing on it, so the
     * silent clip's cleanup can't pause live audio — a live play is itself proof
     * of activation. Safe to call outside a gesture too: best-effort, swallows
     * failures, and leaves its flags false so the next gesture retries.
     *
     * Callers that begin playback only after a fetch (e.g. a game's first
     * bubble-drag autoplay) should ALSO call this from an earlier guaranteed
     * gesture such as a start/level button, so both sinks are primed before that
     * fetch rather than racing it.
     */
    unlock(): void {
        if (typeof window === 'undefined') return;
        // A caller may prime from a start button before anything has spoken, so
        // arm the persistent gesture/visibility listeners here too rather than
        // only from speak()/prefetch(). Idempotent, and re-entrant-safe when the
        // listener itself is what called us.
        this.ensureUnlockListener();
        this.unlockContext();
        // A real utterance is mid-flight; the silent clip's cleanup would pause
        // it and strip its src. The active play already proves activation.
        if (!this.elementPlaying && !this.elementActivated) this.unlockElement();
    }

    /**
     * 'media' sink priming: resume the shared context inside the gesture.
     *
     * The context's own state IS the latch — a running context needs nothing and
     * returns on the first line, while a suspended or 'interrupted' one is
     * re-primed however many gestures it takes.
     */
    private unlockContext(): void {
        const ctx = this.ensureContext();
        if (!ctx) return;
        if (isContextRunning(ctx)) return;
        try {
            // resume() must be called synchronously inside the gesture task.
            void ctx.resume().catch(() => { /* best-effort; next gesture retries */ });

            // Belt-and-suspenders: play a 1-sample silent buffer in-gesture.
            // Some WebKit builds need an actually-started source (not just
            // resume()) to fully unlock. Inaudible and self-cleaning.
            const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.connect(ctx.destination);
            src.start(0);
        } catch {
            // ignore — gesture activation is best-effort
        }
    }

    /**
     * 'passthrough' sink priming: play a muted silent clip on the shared element
     * so iOS marks it user-activated for the rest of the session. Later
     * programmatic play() calls on the SAME element are then allowed even from a
     * fetch callback, because the activation lives on the element.
     *
     * Unlike the context, this activation is durable — it is not revoked when the
     * OS interrupts us — so `elementActivated` is a real one-way latch. It is set
     * only when play() RESOLVES: a rejection means the browser refused, and
     * recording success there would spend the session's only priming on a
     * gesture that achieved nothing.
     */
    private unlockElement(): void {
        const el = this.ensureElement();
        if (!el) return;
        try {
            el.muted = true;
            el.src = CloudTTSProvider.SILENT_MP3;
            const p = el.play();
            if (p && typeof p.then === 'function') {
                p.then(() => { this.elementActivated = true; })
                    .catch(() => { /* refused — leave the latch open so the next gesture retries */ })
                    .finally(() => {
                        // A real speak() can take over this shared element while
                        // the silent clip is still in flight; only clean up if the
                        // element is still idle.
                        if (this.elementPlaying) return;
                        try {
                            el.pause();
                            el.removeAttribute('src');
                            el.load();
                        } catch {
                            // ignore
                        }
                        el.muted = false;
                    });
            } else {
                // Legacy play() with no promise — no success signal to wait on.
                this.elementActivated = true;
                el.muted = false;
            }
        } catch {
            // ignore — gesture activation is best-effort
        }
    }

    async speak(req: TTSRequest): Promise<void> {
        if (!req.text) throw new Error('CloudTTSProvider requires text');

        // Arm the gesture-unlock listener on first call so the next user tap
        // anywhere on the page primes both sinks. No-op after the first install
        // or once already unlocked.
        this.ensureUnlockListener();

        // Stop any in-flight playback first. cancel() also bumps `generation`,
        // so any prior speak() still awaiting its fetch will see the mismatch
        // below and bail out instead of playing an orphaned utterance.
        this.cancel();
        const myGeneration = ++this.generation;

        // Capture the route for the whole call: a settings change mid-fetch must
        // not start playback on one sink having prepared the other's artifact.
        const route = this.route;
        const key = this.bufferKey(req.text, req.lang, req.pronunciation);

        if (route === 'passthrough') {
            const url = await this.getOrCreateUrl(key, req.text, req.lang, req.pronunciation);
            // Superseded by a newer speak() or a cancel() while the fetch was in
            // flight — drop this call on the floor.
            if (myGeneration !== this.generation) return;
            return this.playViaElement(url, myGeneration);
        }

        const buffer = await this.getOrDecodeBuffer(key, req.text, req.lang, req.pronunciation);
        if (myGeneration !== this.generation) return;
        return this.playViaWebAudio(buffer, myGeneration);
    }

    /**
     * 'passthrough' playback. Resolves when the clip ends, errors, or the
     * watchdog fires — never rejects, so a narration failure can't break the UI.
     */
    private playViaElement(url: string, myGeneration: number): Promise<void> {
        const el = this.ensureElement();
        if (!el) return Promise.resolve();

        return new Promise<void>((resolve) => {
            let watchdog: ReturnType<typeof setTimeout> | null = null;
            let settled = false;
            const cleanup = () => {
                if (settled) return;
                settled = true;
                if (watchdog !== null) {
                    clearTimeout(watchdog);
                    watchdog = null;
                }
                // Only touch the SHARED element if this utterance still owns it.
                // A newer speak() may already have installed its own handlers on
                // it, and clearing those would strip the live utterance of its
                // end/error callbacks — leaving that promise to hang until its
                // own watchdog fired.
                if (myGeneration === this.generation) {
                    el.onended = null;
                    el.onerror = null;
                    el.onloadedmetadata = null;
                    this.elementPlaying = false;
                    this.elementCleanup = null;
                }
                resolve();
            };
            this.elementCleanup = cleanup;

            el.onended = cleanup;
            // Resolve (never reject) on error: a decode/network failure must not
            // hang the caller's "playing" indicator.
            el.onerror = cleanup;
            // Duration is unknown until metadata lands, so the watchdog starts
            // generous and tightens to the real length once we know it.
            el.onloadedmetadata = () => {
                if (settled) return;
                if (!Number.isFinite(el.duration)) return;
                if (watchdog !== null) clearTimeout(watchdog);
                watchdog = setTimeout(cleanup, Math.ceil(el.duration * 1000) + 750);
            };

            this.elementPlaying = true;
            el.muted = false;
            el.src = url;
            try {
                el.currentTime = 0;
            } catch {
                // Not seekable yet — harmless, a fresh src starts at 0 anyway.
            }
            // Fallback watchdog for the case where metadata never arrives (the
            // element can stall silently on iOS when the tab loses audio focus).
            watchdog = setTimeout(cleanup, 15000);

            const p = el.play();
            if (p && typeof p.then === 'function') {
                p.catch(() => cleanup());
            }
        });
    }

    /** 'media' playback. Resolves when the clip ends or the watchdog fires. */
    private async playViaWebAudio(buffer: AudioBuffer, myGeneration: number): Promise<void> {
        const ctx = this.ensureContext();
        if (!ctx) return;

        // The context can be suspended here for two different reasons: the
        // gesture-unlock hasn't fired yet (an autoplay before the user's first
        // tap), or the OS interrupted us and unlock() has not yet had a gesture
        // to repair it. AWAIT the resume rather than firing and forgetting: on
        // desktop and Android it is granted and this call recovers itself, which
        // is the difference between "audio came back" and "audio is dead until
        // the next tap". iOS rejects it outside a gesture, and there we resolve
        // with no audio rather than scheduling a source into a context that will
        // never run it — whose onended never fires and would hang the caller.
        if (!isContextRunning(ctx)) {
            try {
                await ctx.resume();
            } catch {
                // Refused. unlock() retries on the next pointerdown.
            }
            if (!isContextRunning(ctx)) return;
            // The await above is a fresh cancellation window — a newer speak()
            // or a cancel() may have landed while we waited on the OS.
            if (myGeneration !== this.generation) return;
        }

        const source = ctx.createBufferSource();
        // Always 1.0×: playbackRate resamples and would shift pitch (see class
        // doc). The decoded buffer is played exactly as synthesized.
        source.buffer = buffer;
        source.connect(ctx.destination);
        this.currentSource = source;

        // Playback length of the buffer we're about to start — the real
        // wall-clock duration, used to size the watchdog below.
        const playbackSeconds = source.buffer?.duration ?? 0;

        return new Promise<void>((resolve) => {
            // Watchdog handle so we can clear it once onended fires normally.
            let watchdog: ReturnType<typeof setTimeout> | null = null;
            const cleanup = () => {
                source.onended = null;
                if (watchdog !== null) {
                    clearTimeout(watchdog);
                    watchdog = null;
                }
                if (this.currentSource === source) this.currentSource = null;
            };
            // Fires both on natural end and when cancel() calls source.stop().
            source.onended = () => {
                cleanup();
                resolve();
            };
            try {
                source.start(0);
            } catch {
                // start() can throw if the node is in a bad state — resolve so
                // the caller isn't left hanging.
                cleanup();
                resolve();
            }
            // Safety watchdog: onended is NOT guaranteed to fire — if the
            // AudioContext is suspended mid-playback (mobile backgrounding, an
            // incoming call, the iOS ring/silent switch, or the tab losing audio
            // focus) the source stops without ever firing onended, hanging this
            // promise forever and leaving the caller's "playing" indicator stuck
            // on. Resolve shortly after the clip's own duration so the promise
            // always settles. Margin covers scheduling/decoding slop.
            const watchdogMs = Math.ceil(playbackSeconds * 1000) + 750;
            watchdog = setTimeout(() => {
                // Stop the (possibly still-scheduled) source so a resumed context
                // can't replay it after we've resolved.
                try {
                    if (this.currentSource === source) source.stop();
                } catch {
                    // already stopped / ended
                }
                cleanup();
                resolve();
            }, watchdogMs);
        });
    }

    cancel(): void {
        // Bump the generation so any in-flight speak() awaiting its fetch
        // will see the mismatch when it resumes and skip playback.
        this.generation++;
        if (this.currentSource) {
            try {
                // stop() fires onended on the source, which resolves the live
                // speak()'s promise via its handler. Guard against double-stop
                // throwing on an already-finished node.
                this.currentSource.stop();
            } catch {
                // already stopped / ended
            }
            this.currentSource = null;
        }
        if (this.elementPlaying && this.audioEl) {
            this.elementPlaying = false;
            try {
                this.audioEl.pause();
            } catch {
                // already paused / never started
            }
            // pause() does NOT fire 'ended', so settle the live utterance's
            // promise by hand — otherwise its caller waits out the watchdog.
            // Runs after the generation bump above, so cleanup's ownership check
            // correctly sees the element as no longer its own.
            const settle = this.elementCleanup;
            this.elementCleanup = null;
            if (settle) settle();
        }
    }

    /**
     * Fire-and-forget: warm the caches for (text, lang) so a later `speak()`
     * resolves without a network round-trip. Warms the ACTIVE route's derived
     * cache — the shared blob underneath serves the other route too, so a route
     * switch still avoids the wire. Errors are swallowed (and the entry evicted)
     * so failures here never surface — the next real `speak()` re-fetches or
     * falls back.
     *
     * Server-side cache is pre-warmed by the working-loop / mark endpoints
     * before the response reaches us, so this fetch is the cheap follow-up
     * that pulls bytes across the wire.
     */
    prefetch(text: string, lang: string, pronunciation?: string | null): void {
        if (!text) return;
        // Arm the gesture-unlock listener as early as possible — prefetch fires
        // during deck load, well before the first speak(), giving the user's
        // very first tap a chance to prime both sinks.
        this.ensureUnlockListener();
        const key = this.bufferKey(text, lang, pronunciation);
        const warm: Promise<unknown> = this.route === 'passthrough'
            ? this.getOrCreateUrl(key, text, lang, pronunciation)
            : this.getOrDecodeBuffer(key, text, lang, pronunciation);
        warm.catch(() => {
            // already evicted by the failing cache layer
        });
    }

    /**
     * Canonical cache key for a (text, lang, pinyin) triple. Normalizes the
     * language to its short code and trims pinyin so prefetch() and speak() land
     * on the same slot regardless of whitespace or null-vs-undefined. Shared by
     * all three caches so they stay aligned.
     */
    private bufferKey(text: string, lang: string, pronunciation?: string | null): string {
        const shortLang = lang.split('-')[0];
        const normalizedPinyin = (pronunciation || '').trim();
        return `${shortLang}:${text}:${normalizedPinyin}`;
    }

    /**
     * The one network path. Everything else derives from this Blob, so a word is
     * fetched at most once per session no matter how the route changes.
     */
    private getOrFetchBlob(key: string, text: string, lang: string, pronunciation?: string | null): Promise<Blob> {
        const cached = this.blobCache.get(key);
        if (cached) return cached;

        // Server expects short language code (e.g. 'zh'); strip BCP-47 region.
        const shortLang = lang.split('-')[0];
        const normalizedPinyin = (pronunciation || '').trim();

        const promise = (async (): Promise<Blob> => {
            const token = this.getToken();
            const res = await fetch(`${API_BASE_URL}/api/tts/synthesize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                credentials: 'include',
                body: JSON.stringify({
                    text,
                    language: shortLang,
                    // Server uses this as both a cache-key component and an SSML
                    // phoneme hint to Google so the audio matches the displayed pinyin.
                    pronunciation: normalizedPinyin || undefined,
                }),
            });
            if (!res.ok) {
                throw new Error(`TTS server error: ${res.status}`);
            }
            return await res.blob();
        })();

        // On failure, drop the cache entry so the next call can retry.
        promise.catch(() => this.blobCache.delete(key));
        this.blobCache.set(key, promise);
        return promise;
    }

    /** Derived cache for the 'media' sink: decoded PCM. */
    private getOrDecodeBuffer(key: string, text: string, lang: string, pronunciation?: string | null): Promise<AudioBuffer> {
        const cached = this.bufferCache.get(key);
        if (cached) return cached;

        const promise = (async (): Promise<AudioBuffer> => {
            const ctx = this.ensureContext();
            if (!ctx) throw new Error('Web Audio unavailable');
            const blob = await this.getOrFetchBlob(key, text, lang, pronunciation);
            // .arrayBuffer() hands out a fresh copy, so decodeAudioData detaching
            // it leaves the cached Blob intact for the other sink.
            return await this.decode(ctx, await blob.arrayBuffer());
        })();

        promise.catch(() => this.bufferCache.delete(key));
        this.bufferCache.set(key, promise);
        return promise;
    }

    /** Derived cache for the 'passthrough' sink: object URLs, capped + revoked. */
    private async getOrCreateUrl(key: string, text: string, lang: string, pronunciation?: string | null): Promise<string> {
        const cached = this.urlCache.get(key);
        if (cached) return cached;

        const blob = await this.getOrFetchBlob(key, text, lang, pronunciation);
        // Re-check after the await: a concurrent call may have won the race, and
        // minting a second URL for the same key would leak the first.
        const raced = this.urlCache.get(key);
        if (raced) return raced;

        const url = URL.createObjectURL(blob);
        this.urlCache.set(key, url);
        this.evictOldestUrls();
        return url;
    }

    /**
     * Keep the URL cache bounded. Object URLs pin their Blob for the life of the
     * document unless revoked, so an unbounded map is a real (if slow) leak in a
     * long study session. Map iteration is insertion-ordered, so the first key is
     * the oldest.
     */
    private evictOldestUrls(): void {
        while (this.urlCache.size > CloudTTSProvider.MAX_CACHED_URLS) {
            const oldest = this.urlCache.keys().next();
            if (oldest.done) return;
            const url = this.urlCache.get(oldest.value);
            this.urlCache.delete(oldest.value);
            if (url) URL.revokeObjectURL(url);
        }
    }

    /**
     * Decode compressed audio bytes to an AudioBuffer. Wraps decodeAudioData to
     * support both the modern promise form and the legacy callback form (older
     * Safari/WebKit only implements the callback signature).
     */
    private decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
        return new Promise<AudioBuffer>((resolve, reject) => {
            const maybePromise = ctx.decodeAudioData(data, resolve, reject);
            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.then(resolve, reject);
            }
        });
    }
}
