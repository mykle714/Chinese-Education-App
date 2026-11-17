import { apiPost } from "./http";

/**
 * TTS API calls that go through the shared http client. (Playback itself —
 * `/api/tts/synthesize` — is fetched by `src/services/tts/CloudTTSProvider.ts`, which
 * owns the audio caches.)
 *
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Tap-to-hear"; docs/AUDIO_PLAYBACK.md § 4.
 */

/** One word's clip: the headword and the pinyin hint the client will later request it with. */
export interface PrewarmClip {
    text: string;
    pronunciation: string | null;
}

/**
 * Ask the server to synthesize these clips to its disk cache in the background
 * (`POST /api/tts/prewarm` → TTSController.prewarm). Resolves as soon as the server has
 * accepted the batch (202); the synthesis runs after. Order matters: earlier clips are
 * warmed first.
 */
export async function prewarmTtsClips(clips: PrewarmClip[], language: string): Promise<void> {
    if (clips.length === 0) return;
    await apiPost<{ accepted: number }>("/api/tts/prewarm", { language, clips });
}
