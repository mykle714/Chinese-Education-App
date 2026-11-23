import fs from 'fs';
import { GoogleAuth } from 'google-auth-library';
import type { TutorVoiceRole } from '../../contracts/voice.js';

/**
 * VoiceTTS — the tutor's voice: Google Chirp3-HD, one sentence per call
 * (docs/VOICE_ASSISTANT.md § 5.3).
 *
 *   - Role → provider voice stays server-side (`TUTOR_VOICES`): the client sends 'male' /
 *     'female' and never a Google voice name (Q14, Q21; the same rule as TTSService).
 *   - Reuses TTSService's Google service account (GOOGLE_APPLICATION_CREDENTIALS) but NOT its
 *     on-disk cache: conversational sentences almost never repeat (§ 5.3).
 *   - No SSML / pinyin hints: Chirp3-HD accepts none, and it read every test line right.
 *   - `speakingRate` follows the learner's level (voicePrompt.speakingRateForLevel); Chirp3-HD
 *     honours it (measured 2026-11-21).
 *   - MP3 out. Google's Chirp3-HD MP3 is CBR 32 kbps (MPEG-2 Layer III, 24 kHz — read from
 *     the frame header 2026-11-21), so the clip's duration is computed from its byte size by
 *     `mp3DurationSeconds`; that feeds `voice_sessions.assistantSeconds` and the daily cap.
 *   - Measured ~1 s to the full sentence with the plain REST call (2026-11-21), slower than
 *     the ~500 ms § 5.3 assumed. Google's gRPC streaming synthesis is the lever if it matters.
 *
 * Layer: service adapter. Referenced by server/services/voice/LiveVoiceSession.ts and
 * VoiceSessionService.speakLine (transcript replay, § 9.3).
 */

const TUTOR_VOICES: Record<TutorVoiceRole, string> = {
  male: 'cmn-CN-Chirp3-HD-Achird',
  female: 'cmn-CN-Chirp3-HD-Achernar',
};

const SYNTH_TIMEOUT_MS = 10_000;

export interface VoiceClip {
  audio: Buffer;
  durationSeconds: number;
}

/**
 * Duration of an MP3 clip from its first frame header's bitrate (CBR), skipping an ID3v2
 * tag. Falls back to 32 kbps when no header is found. Exported for tests.
 */
export function mp3DurationSeconds(mp3: Buffer): number {
  let offset = 0;
  if (mp3.length >= 10 && mp3.subarray(0, 3).toString('latin1') === 'ID3') {
    offset = 10 + ((mp3[6] << 21) | (mp3[7] << 14) | (mp3[8] << 7) | mp3[9]);
  }
  let bitrateKbps = 32;
  for (let i = offset; i + 3 < mp3.length; i++) {
    if (mp3[i] === 0xff && (mp3[i + 1] & 0xe0) === 0xe0) {
      const versionBits = (mp3[i + 1] >> 3) & 0x03; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
      const index = (mp3[i + 2] >> 4) & 0x0f;
      const mpeg1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
      const mpeg2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
      const table = versionBits === 3 ? mpeg1L3 : mpeg2L3;
      if (index > 0 && index < 15) bitrateKbps = table[index];
      break;
    }
  }
  return (Math.max(0, mp3.length - offset) * 8) / (bitrateKbps * 1000);
}

export class VoiceTTS {
  private auth: GoogleAuth | null = null;

  constructor(private readonly credentialsPath: string | undefined = process.env.GOOGLE_APPLICATION_CREDENTIALS) {}

  /** Whether synthesis can run at all (credentials configured and present). */
  get available(): boolean {
    return !!this.credentialsPath && fs.existsSync(this.credentialsPath);
  }

  private getAuth(): GoogleAuth {
    if (this.auth) return this.auth;
    if (!this.credentialsPath) throw new Error('VoiceTTS: GOOGLE_APPLICATION_CREDENTIALS is not set');
    this.auth = new GoogleAuth({ keyFile: this.credentialsPath, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    return this.auth;
  }

  /** Synthesize one sentence. Aborts with `signal` (barge-in) or after SYNTH_TIMEOUT_MS. */
  async synthesize(text: string, voice: TutorVoiceRole, speakingRate: number, signal?: AbortSignal): Promise<VoiceClip> {
    const client = await this.getAuth().getClient();
    const tokenResp = await client.getAccessToken();
    const accessToken = typeof tokenResp === 'string' ? tokenResp : tokenResp.token;
    if (!accessToken) throw new Error('VoiceTTS: failed to obtain a Google access token');

    const timeout = AbortSignal.timeout(SYNTH_TIMEOUT_MS);
    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'cmn-CN', name: TUTOR_VOICES[voice] },
        audioConfig: { audioEncoding: 'MP3', speakingRate },
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`VoiceTTS: Google ${res.status} ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { audioContent?: string };
    if (!json.audioContent) throw new Error('VoiceTTS: empty audioContent');
    const audio = Buffer.from(json.audioContent, 'base64');
    return { audio, durationSeconds: mp3DurationSeconds(audio) };
  }
}
