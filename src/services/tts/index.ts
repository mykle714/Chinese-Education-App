import { CloudTTSProvider } from './CloudTTSProvider';
import { WebSpeechProvider } from './WebSpeechProvider';
import type { TTSProvider } from './types';

export { CloudTTSProvider };

// Module-level singletons. Each provider holds its own in-flight audio state,
// so call cancel() on the previously-active one before starting a new one.
//
// Narration always runs in "auto" mode (the engine picker was removed): the
// cloud provider (better voice) is the primary, and useTTS falls back to the
// browser provider when cloud isn't reachable.
const cloudProvider = new CloudTTSProvider();
const browserProvider = new WebSpeechProvider();

// Note: `cloud` is typed as the concrete CloudTTSProvider (not the TTSProvider
// interface) so callers can use cloud-only methods like `prefetch()` without
// casts. `browser` stays widened since nothing cloud-specific applies to it.
export const tts = {
    cloud: cloudProvider as CloudTTSProvider,
    browser: browserProvider as TTSProvider,
};

export type { TTSProvider, TTSRequest, TTSLang } from './types';
