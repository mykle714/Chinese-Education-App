/**
 * voice.ts — the voice tutor's REST calls (docs/VOICE_ASSISTANT.md § 9).
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 nothing here takes a `token`: every call goes through
 * src/api/http.ts. The live conversation itself is a WebSocket — see src/api/voiceSocket.ts.
 *
 * Server: server/routes/voiceRoutes.ts → VoiceSessionController. Mounted only while
 * FEATURE_FLAGS.voiceAssistant is on (the client hides every entry point under the same flag).
 *
 * Callers: features/voice/VoicePage.tsx (sessions, usage), features/voice/VoiceReviewPage.tsx
 * (transcript, line audio).
 */
import { apiGet, apiPostBlob } from './http';
import type {
    TutorVoiceRole,
    VoiceSessionListItem,
    VoiceSessionTranscript,
    VoiceSpeakRequest,
} from '../../server/contracts/voice';

export interface VoiceUsage {
    available: boolean;
    /** Why the tutor is unavailable (missing server configuration), or null. */
    reason: string | null;
    secondsUsed: number;
    secondsLimit: number;
}

/** The learner's saved sessions, newest first. */
export function fetchVoiceSessions(): Promise<VoiceSessionListItem[]> {
    return apiGet<VoiceSessionListItem[]>('/api/voice/sessions');
}

/** One saved session as a segmented transcript. */
export function fetchVoiceTranscript(sessionId: string): Promise<VoiceSessionTranscript> {
    return apiGet<VoiceSessionTranscript>(`/api/voice/sessions/${encodeURIComponent(sessionId)}`);
}

/** Whether the tutor is configured, and today's voice time against the daily cap. */
export function fetchVoiceUsage(): Promise<VoiceUsage> {
    return apiGet<VoiceUsage>('/api/voice/usage', {
        params: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
}

/** One line in the tutor's voice (MP3), synthesized fresh by the server (§ 9.3). */
export function fetchVoiceLineAudio(text: string, voice: TutorVoiceRole): Promise<Blob> {
    const body: VoiceSpeakRequest = { text, voice };
    return apiPostBlob('/api/voice/speak', body);
}
