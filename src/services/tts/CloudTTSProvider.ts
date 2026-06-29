import { API_BASE_URL } from '../../constants';
import * as authStorage from '../../utils/authStorage';
import type { TTSProvider, TTSRequest } from './types';
import { timeStretchBuffer } from './timeStretch';

/**
 * Server-proxied TTS. POSTs to /api/tts/synthesize, receives an MP3 blob,
 * decodes it with the Web Audio API and plays it through an
 * AudioBufferSourceNode. Server handles the Azure/Google call + caching.
 *
 * Why Web Audio instead of an <audio> element: on iOS any <audio>/<video>
 * element that plays is automatically registered with the system "Now Playing"
 * center, which surfaces the rewind/play/fast-forward transport UI on the lock
 * screen and Control Center. TTS clips are not "media" the user wants to scrub,
 * so we route them through Web Audio, which is NOT registered as a media session
 * and therefore shows no lock-screen controls.
 *
 * Trade-offs of this approach (vs. the old HTMLAudioElement path):
 *   1. iOS silences Web Audio when the hardware ring/silent switch is OFF
 *      (media elements play through it). This is inherent to the non-media-
 *      session classification — accepted as part of suppressing the controls.
 *   2. AudioBufferSourceNode.playbackRate is a *resampling* rate (it would shift
 *      PITCH along with speed, distorting Chinese tones). So we do NOT use it for
 *      the speech-rate setting: instead we phase-vocoder time-stretch the decoded
 *      buffer to the requested rate (see timeStretch.ts) and play it back at
 *      playbackRate 1.0, preserving pitch. One stretched buffer is cached per
 *      word (re-made only when the rate setting changes) so repeats stay cheap.
 *
 * Requires `entryId`/text on the request (server caches per dictionary entry).
 * If text is missing this provider throws and the caller should fall back to
 * WebSpeech.
 */
export class CloudTTSProvider implements TTSProvider {
    readonly name = 'cloud' as const;

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
    // Monotonic counter incremented on every speak()/cancel(). A speak() in
    // flight captures its generation before awaiting the network fetch; when
    // the fetch resolves, if the generation no longer matches the latest, the
    // call bails out before starting playback. This closes the race where
    // cancel() can't stop a source that hasn't been built yet.
    private generation = 0;
    // In-session cache of DECODED audio buffers so repeated plays of the same
    // word don't re-hit the server or re-decode. AudioBuffers are reusable
    // across many source nodes, so we decode once and replay cheaply. Server
    // has its own disk cache, but skipping the round-trip is still cheaper.
    // Key: `${lang}:${text}:${pinyin}` (see bufferKey).
    private bufferCache = new Map<string, Promise<AudioBuffer>>();
    // In-session cache of PITCH-PRESERVING TIME-STRETCHED buffers, keyed by
    // bufferKey (one entry per word — same cardinality as bufferCache). The rate
    // is a single global preference, so only ever ONE stretched rate of a word is
    // reachable at a time; we store that one alongside the rate it was made at and
    // re-stretch only when the active rate changes (a slider move). The 1.0× case
    // is never stored — the original buffer is returned as-is.
    private stretchCache = new Map<string, { rate: number; buffer: AudioBuffer }>();

    // --- iOS / mobile autoplay unlock ---------------------------------------
    // WebKit (and to a lesser extent mobile Chrome) starts an AudioContext in
    // the 'suspended' state and only allows it to be resumed from inside a real
    // user-gesture task. Our speak() awaits a network fetch before playing,
    // which loses gesture context, so without priming the first autoplay would
    // be stuck in a suspended context (no sound, onended never fires).
    //
    // Workaround: on the first user gesture, resume() the shared context (and
    // play a 1-sample silent buffer as a belt-and-suspenders activation). Once
    // resumed the context stays running for the session, so later programmatic
    // playback — even from timers / fetch callbacks — produces sound, because
    // the activation lives on the context, not the call stack.
    private unlockListenerInstalled = false;
    // Flipped true once the context has been resumed inside a gesture. Guards
    // unlock() so we don't re-run the resume/silent-buffer work on every gesture.
    private audioUnlocked = false;

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

    /**
     * Install a one-shot global gesture listener that resumes our shared
     * AudioContext so later programmatic playback is allowed by iOS. Idempotent
     * and cheap — safe to call from any speak()/prefetch() entry point.
     */
    private ensureUnlockListener(): void {
        if (typeof window === 'undefined') return;
        if (this.unlockListenerInstalled) return;
        this.unlockListenerInstalled = true;

        // pointerdown fires earliest across mouse + touch + pen. `capture: true`
        // ensures we see the gesture even if a child handler stops propagation.
        window.addEventListener('pointerdown', () => this.unlock(), { once: true, capture: true });
    }

    /**
     * Prime the shared AudioContext for autoplay by resuming it inside a real
     * user-gesture task (e.g. a button click or pointerdown handler). MUST be
     * called synchronously from the gesture — there must be no `await` between
     * the gesture and this call. Earns the context activation so a later speak()
     * can play after its awaited fetch without being stuck in a suspended
     * context.
     *
     * Idempotent: no-ops once already unlocked. Safe to call outside a gesture
     * too — it's best-effort and swallows failures.
     *
     * Callers that begin playback only after a fetch (e.g. a game's first
     * bubble-drag autoplay) should call this from an earlier guaranteed gesture
     * such as a start/level button so the context is resumed before that fetch.
     */
    unlock(): void {
        if (typeof window === 'undefined') return;
        if (this.audioUnlocked) return;

        const ctx = this.ensureContext();
        if (!ctx) return;

        try {
            // resume() must be called synchronously inside the gesture task.
            // It returns a promise; on resolve the context is 'running'.
            const p = ctx.resume();
            if (p && typeof p.then === 'function') {
                p.then(() => { this.audioUnlocked = true; }).catch(() => {
                    // Leave audioUnlocked false so a later gesture can retry.
                });
            } else {
                this.audioUnlocked = true;
            }

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

    async speak(req: TTSRequest): Promise<void> {
        if (!req.text) throw new Error('CloudTTSProvider requires text');

        // Arm the gesture-unlock listener on first call so the next user tap
        // anywhere on the page resumes our shared AudioContext. No-op after the
        // first install or once already unlocked.
        this.ensureUnlockListener();

        // Stop any in-flight playback first. cancel() also bumps `generation`,
        // so any prior speak() still awaiting its fetch will see the mismatch
        // below and bail out instead of playing an orphaned utterance.
        this.cancel();
        const myGeneration = ++this.generation;

        const buffer = await this.getOrFetchBuffer(req.text, req.lang, req.pronunciation);

        // Superseded by a newer speak() or a cancel() while the fetch/decode was
        // in flight — drop this call on the floor.
        if (myGeneration !== this.generation) return;

        const ctx = this.ensureContext();
        if (!ctx) return;

        // Best-effort resume in case the gesture-unlock hasn't fired yet (e.g.
        // an autoplay before the user has tapped). If the context still isn't
        // running we resolve with no audio rather than scheduling a source into
        // a suspended context (whose onended would never fire and hang us).
        if (ctx.state !== 'running') {
            ctx.resume().catch(() => { });
            // resume() may flip state synchronously; re-read via a widened type
            // because TS has narrowed ctx.state to non-'running' in this branch.
            if ((ctx.state as AudioContextState) !== 'running') return;
        }

        const source = ctx.createBufferSource();
        // Honor the speech-rate setting by TIME-STRETCHING (pitch-preserving)
        // rather than via playbackRate (which would resample and shift pitch —
        // see the class doc trade-off). playbackRate stays 1.0.
        const rate = req.rate ?? 1.0;
        source.buffer = this.playbackBufferForRate(
            buffer,
            this.bufferKey(req.text, req.lang, req.pronunciation),
            rate,
        );
        source.connect(ctx.destination);
        this.currentSource = source;

        return new Promise<void>((resolve) => {
            const cleanup = () => {
                source.onended = null;
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
    }

    /**
     * Fire-and-forget: warm the in-session buffer cache for (text, lang) so a
     * later `speak()` call resolves synchronously without a network round-trip
     * or decode. Errors are swallowed (and the entry evicted) so failures here
     * never surface — the next real `speak()` will simply re-fetch or fall back.
     *
     * Server-side cache is pre-warmed by the working-loop / mark endpoints
     * before the response reaches us, so this fetch is the cheap follow-up
     * that pulls bytes across the wire and decodes them.
     */
    prefetch(text: string, lang: string, pronunciation?: string | null): void {
        if (!text) return;
        // Arm the gesture-unlock listener as early as possible — prefetch fires
        // during deck load, well before the first speak(), giving the user's
        // very first tap a chance to resume the shared AudioContext.
        this.ensureUnlockListener();
        // Reuse the same get-or-fetch path so the cache key matches speak()'s.
        this.getOrFetchBuffer(text, lang, pronunciation).catch(() => {
            // already evicted by getOrFetchBuffer's promise.catch
        });
    }

    /**
     * Canonical cache key for a (text, lang, pinyin) triple. Normalizes the
     * language to its short code and trims pinyin so prefetch() and speak() land
     * on the same slot regardless of whitespace or null-vs-undefined.
     */
    private bufferKey(text: string, lang: string, pronunciation?: string | null): string {
        const shortLang = lang.split('-')[0];
        const normalizedPinyin = (pronunciation || '').trim();
        return `${shortLang}:${text}:${normalizedPinyin}`;
    }

    private getOrFetchBuffer(text: string, lang: string, pronunciation?: string | null): Promise<AudioBuffer> {
        // Server expects short language code (e.g. 'zh'); strip BCP-47 region.
        const shortLang = lang.split('-')[0];
        const normalizedPinyin = (pronunciation || '').trim();
        const key = this.bufferKey(text, lang, pronunciation);
        const cached = this.bufferCache.get(key);
        if (cached) return cached;

        const promise = (async (): Promise<AudioBuffer> => {
            const ctx = this.ensureContext();
            if (!ctx) throw new Error('Web Audio unavailable');

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
            const arrayBuffer = await res.arrayBuffer();
            return await this.decode(ctx, arrayBuffer);
        })();

        // On failure, drop the cache entry so the next call can retry.
        promise.catch(() => this.bufferCache.delete(key));
        this.bufferCache.set(key, promise);
        return promise;
    }

    /**
     * Resolve the buffer to actually play for a given speech rate. At 1.0× the
     * original buffer is returned unchanged; otherwise a pitch-preserving
     * time-stretched variant is produced (once) and memoized per (word, rate).
     * Falls back to the original buffer if stretching throws, so narration still
     * plays (just at the un-stretched 1.0× tempo) rather than going silent.
     */
    private playbackBufferForRate(original: AudioBuffer, key: string, rate: number): AudioBuffer {
        if (Math.abs(rate - 1) < 0.001) return original;
        // Reuse the cached stretch only if it was made at the current rate; a
        // slider move invalidates it (and the old buffer is dropped by overwrite).
        const cached = this.stretchCache.get(key);
        if (cached && Math.abs(cached.rate - rate) < 0.001) return cached.buffer;
        const ctx = this.audioCtx;
        if (!ctx) return original;
        try {
            const stretched = timeStretchBuffer(ctx, original, rate);
            this.stretchCache.set(key, { rate, buffer: stretched });
            return stretched;
        } catch (err) {
            console.warn('[CloudTTSProvider] time-stretch failed, playing at 1.0×:', err);
            return original;
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
