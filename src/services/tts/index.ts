import { CloudTTSProvider } from './CloudTTSProvider';
import { WebSpeechProvider } from './WebSpeechProvider';
import type { TTSProvider } from './types';

export { CloudTTSProvider };

export type TTSEngineChoice = 'auto' | 'cloud' | 'browser';

// Module-level singletons. Each provider holds its own in-flight audio state,
// so call cancel() on the previously-selected one before switching engines.
const cloudProvider = new CloudTTSProvider();
const browserProvider = new WebSpeechProvider();

/**
 * Select a provider based on user preference. 'auto' prefers cloud (better
 * voice) and falls back to browser if cloud isn't reachable.
 *
 * Note: the actual cloud-unavailable fallback happens lazily — the cloud
 * provider's speak() throws on server error, and the caller (useTTS) catches
 * and retries via the browser provider.
 */
export function getTTSProvider(choice: TTSEngineChoice): TTSProvider {
    if (choice === 'browser') return browserProvider;
    if (choice === 'cloud') return cloudProvider;
    return cloudProvider; // auto — try cloud first
}

// Note: `cloud` is typed as the concrete CloudTTSProvider (not the TTSProvider
// interface) so callers can use cloud-only methods like `prefetch()` without
// casts. `browser` stays widened since nothing cloud-specific applies to it.
export const tts = {
    cloud: cloudProvider as CloudTTSProvider,
    browser: browserProvider as TTSProvider,
};

export type { TTSProvider, TTSRequest, TTSLang } from './types';
