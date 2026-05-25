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

    async speak(req: TTSRequest): Promise<void> {
        if (!req.text) throw new Error('CloudTTSProvider requires text');

        // Stop any in-flight playback first. cancel() also bumps `generation`,
        // so any prior speak() still awaiting its fetch will see the mismatch
        // below and bail out instead of playing an orphaned utterance.
        this.cancel();
        const myGeneration = ++this.generation;

        const url = await this.getOrFetchAudioUrl(req.text, req.lang, req.pronunciation);

        // Superseded by a newer speak() or a cancel() while the fetch was in
        // flight — drop this call on the floor.
        if (myGeneration !== this.generation) return;

        const audio = new Audio(url);
        audio.playbackRate = req.rate ?? 1.0;
        this.currentAudio = audio;

        return new Promise<void>((resolve) => {
            audio.onended = () => {
                if (this.currentAudio === audio) this.currentAudio = null;
                resolve();
            };
            audio.onerror = () => {
                if (this.currentAudio === audio) this.currentAudio = null;
                resolve();
            };
            // play() returns a promise that may reject on autoplay-policy blocks.
            audio.play().catch(() => resolve());
        });
    }

    cancel(): void {
        // Bump the generation so any in-flight speak() awaiting its fetch
        // will see the mismatch when it resumes and skip playback.
        this.generation++;
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
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
