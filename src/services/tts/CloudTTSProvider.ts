import { API_BASE_URL } from '../../constants';
import type { TTSProvider, TTSRequest } from './types';

/**
 * Server-proxied TTS. POSTs to /api/tts/synthesize, receives an MP3 blob,
 * plays via HTMLAudioElement. Server handles the Azure call + caching.
 *
 * Requires `entryId` on the request (server caches per dictionary entry id).
 * If entryId is missing this provider reports unavailable and the caller
 * should fall back to WebSpeech.
 */
export class CloudTTSProvider implements TTSProvider {
    readonly name = 'cloud' as const;

    private currentAudio: HTMLAudioElement | null = null;
    // Monotonic counter incremented on every speak()/cancel(). A speak() in
    // flight captures its generation before awaiting the network fetch; when
    // the fetch resolves, if the generation no longer matches the latest, the
    // call bails out before constructing an Audio. This closes the race where
    // cancel() can't pause audio that hasn't been built yet.
    private generation = 0;
    // In-session blob cache so repeated plays of the same word don't re-hit
    // the server. Server has its own disk cache, but skipping the round-trip
    // is still cheaper. Key: `${lang}:${text}`.
    private blobCache = new Map<string, Promise<string>>();

    // --- iOS / mobile autoplay unlock ---------------------------------------
    // WebKit (and to a lesser extent mobile Chrome) blocks HTMLMediaElement.play()
    // unless it is dispatched synchronously inside a user-gesture task. Our
    // speak() awaits a network fetch before constructing the Audio, which loses
    // gesture context, so on a fresh page load the first autoplay (e.g. the
    // flashcards "first face is Chinese" effect) is silently rejected.
    //
    // Workaround: keep ONE long-lived HTMLAudioElement and call .play() on it
    // (muted, with a tiny silent src) the first time the user touches the page.
    // That call is in-gesture so iOS allows it, and the element is then marked
    // as user-activated for the rest of the session. Subsequent programmatic
    // play() calls on the same element — even from timers / fetch callbacks —
    // are allowed, because the activation lives on the element, not the call
    // stack. Per-utterance audio is swapped in via `src =` rather than
    // `new Audio()` so it inherits the unlocked element's activation.
    private audioEl: HTMLAudioElement | null = null;
    private unlockListenerInstalled = false;
    // 1-frame silent MP3 (≈ 70 bytes) used to satisfy the gesture-bound play()
    // call without making any sound.
    private static SILENT_MP3 =
        'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfP/X9o3/+vXP///0eMpAGoEAGgIQQwQAAFAAAAQADAaqsXQAYWAUgxAYcQEEoYDQSCh4iQUEEhYg6JCAQQEoIASBQiAh4kEEEBYgwQQEcQAQQQECQQECAgQECAgQEDgIDhAYIDBAQICA4QGCAwQECDgIDhAcICBAQICBAQICBAQICAgQEDg=';

    private getToken(): string | null {
        if (typeof window === 'undefined') return null;
        return window.localStorage.getItem('token');
    }

    async isAvailable(): Promise<boolean> {
        // Cheap shape check only — we discover server-side misconfiguration on
        // the first actual call (which then surfaces an error and the caller
        // can fall back).
        return Boolean(this.getToken());
    }

    /**
     * Install a one-shot global gesture listener that primes our shared
     * <audio> element so future programmatic play() calls are allowed by iOS.
     * Idempotent and cheap — safe to call from any speak()/prefetch() entry
     * point. See the audioEl/unlocked block above for the full rationale.
     */
    private ensureUnlockListener(): void {
        if (typeof window === 'undefined') return;
        if (this.unlockListenerInstalled) return;
        this.unlockListenerInstalled = true;

        if (!this.audioEl) this.audioEl = new Audio();
        const el = this.audioEl;

        const unlock = () => {
            // Must run synchronously inside the gesture task — no awaits before
            // play(). Muted + silent src so the user hears nothing; success or
            // failure, we tear the listener down (capture+once would do it too,
            // but we remove explicitly for clarity).
            try {
                el.muted = true;
                el.src = CloudTTSProvider.SILENT_MP3;
                const p = el.play();
                if (p && typeof p.then === 'function') {
                    p.catch(() => {
                        // Even on rejection iOS may still have flagged the
                        // element as activated.
                    }).finally(() => {
                        el.pause();
                        el.muted = false;
                        el.removeAttribute('src');
                        el.load();
                    });
                }
            } catch {
                // ignore — gesture activation is best-effort
            }
        };

        // pointerdown fires earliest across mouse + touch + pen. `capture: true`
        // ensures we see the gesture even if a child handler stops propagation.
        window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    }

    async speak(req: TTSRequest): Promise<void> {
        if (!req.text) throw new Error('CloudTTSProvider requires text');

        // Arm the gesture-unlock listener on first call so the next user tap
        // anywhere on the page primes our shared <audio> element. No-op after
        // the first install or once already unlocked.
        this.ensureUnlockListener();

        // Stop any in-flight playback first. cancel() also bumps `generation`,
        // so any prior speak() still awaiting its fetch will see the mismatch
        // below and bail out instead of playing an orphaned utterance.
        this.cancel();
        const myGeneration = ++this.generation;

        const url = await this.getOrFetchAudioUrl(req.text, req.lang, req.pronunciation);

        // Superseded by a newer speak() or a cancel() while the fetch was in
        // flight — drop this call on the floor.
        if (myGeneration !== this.generation) return;

        // Reuse the shared element instead of `new Audio(url)`. iOS autoplay
        // activation is per-element, so a fresh Audio() would lose the unlock
        // we earned during the first user gesture. Swapping src on the unlocked
        // element keeps the activation flag and lets programmatic play() (after
        // our awaited fetch) succeed.
        if (!this.audioEl) this.audioEl = new Audio();
        const audio = this.audioEl;
        audio.src = url;
        audio.playbackRate = req.rate ?? 1.0;
        audio.muted = false;
        this.currentAudio = audio;

        return new Promise<void>((resolve) => {
            const cleanup = () => {
                audio.onended = null;
                audio.onerror = null;
                if (this.currentAudio === audio) this.currentAudio = null;
            };
            audio.onended = () => {
                cleanup();
                resolve();
            };
            audio.onerror = () => {
                cleanup();
                resolve();
            };
            // play() returns a promise that may reject on autoplay-policy blocks.
            // Once the element is gesture-unlocked this branch should not fire
            // on iOS; before unlock (very first card before any tap) the play
            // is silently dropped and the caller resolves with no audio.
            audio.play().catch(() => {
                cleanup();
                resolve();
            });
        });
    }

    cancel(): void {
        // Bump the generation so any in-flight speak() awaiting its fetch
        // will see the mismatch when it resumes and skip playback.
        this.generation++;
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            // Don't null out audioEl itself — its iOS gesture-unlock activation
            // is a one-shot per element and must survive across utterances.
            this.currentAudio = null;
        }
    }

    /**
     * Fire-and-forget: warm the in-session blob cache for (text, lang) so a
     * later `speak()` call resolves synchronously without a network round-trip.
     * Errors are swallowed (and the entry evicted) so failures here never
     * surface — the next real `speak()` will simply re-fetch or fall back.
     *
     * Server-side cache is pre-warmed by the working-loop / mark endpoints
     * before the response reaches us, so this fetch is the cheap follow-up
     * that pulls bytes across the wire into the browser.
     */
    prefetch(text: string, lang: string, pronunciation?: string | null): void {
        if (!text) return;
        // Arm the gesture-unlock listener as early as possible — prefetch fires
        // during deck load, well before the first speak(), giving the user's
        // very first tap a chance to unlock the shared <audio> element.
        this.ensureUnlockListener();
        // Reuse the same get-or-fetch path so the cache key matches speak()'s.
        this.getOrFetchAudioUrl(text, lang, pronunciation).catch(() => {
            // already evicted by getOrFetchAudioUrl's promise.catch
        });
    }

    private getOrFetchAudioUrl(text: string, lang: string, pronunciation?: string | null): Promise<string> {
        // Server expects short language code (e.g. 'zh'); strip BCP-47 region.
        const shortLang = lang.split('-')[0];
        // Normalize pinyin so prefetch and speak land on the same cache slot
        // regardless of whitespace or null vs undefined.
        const normalizedPinyin = (pronunciation || '').trim();
        const key = `${shortLang}:${text}:${normalizedPinyin}`;
        const cached = this.blobCache.get(key);
        if (cached) return cached;

        const promise = (async (): Promise<string> => {
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
            const blob = await res.blob();
            return URL.createObjectURL(blob);
        })();

        // On failure, drop the cache entry so the next call can retry.
        promise.catch(() => this.blobCache.delete(key));
        this.blobCache.set(key, promise);
        return promise;
    }
}
