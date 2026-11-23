/**
 * Live voice session smoke test — drives one real LiveVoiceSession end to end without a
 * browser (docs/VOICE_ASSISTANT.md § 4).
 *
 *   synthesized learner speech (Chirp3-HD, 16 kHz PCM) → 20 ms frames, paced in real time,
 *   with silence after each line → Endpointer → Google STT → Claude (VOICE_AI_API_KEY) →
 *   Chirp3-HD → a fake socket that logs every event, with timings.
 *
 * It writes a real voice_sessions row + turns for the given user (dev DB), and prints the
 * end-of-session card. Use it to hear-free check the loop and to read latencies:
 * "endpoint → userFinal" (STT finalization) and "userFinal → first audio" (Claude + TTS).
 *
 * Run from server/:
 *   npx tsx scripts/voice-bench/live-session-smoke.ts <userId> ["line one" "line two" ...]
 *
 * Nothing in the app imports this. Referenced by docs/VOICE_ASSISTANT.md § 10.
 */
import 'dotenv/config';
import { GoogleAuth } from 'google-auth-library';
import { voiceSessionService } from '../../dal/setup.js';
import { LiveVoiceSession } from '../../services/voice/LiveVoiceSession.js';
import type { VoiceServerEvent } from '../../contracts/voice.js';

const userId = process.argv[2];
const lines = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ['你好！我昨天去了那个 grocery store，买了很多 vegetables。', '我喜欢吃 tomato 和 potato。'];
if (!userId) {
  console.error('usage: live-session-smoke.ts <userId> ["line" ...]');
  process.exit(1);
}

async function synthesizePcm(text: string): Promise<Buffer> {
  const auth = new GoogleAuth({ keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const token = (await (await auth.getClient()).getAccessToken()).token;
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'cmn-CN', name: 'cmn-CN-Chirp3-HD-Achird' },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 16000 },
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}`);
  return Buffer.from(((await res.json()) as { audioContent: string }).audioContent, 'base64').subarray(44);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const reason = voiceSessionService.unavailableReason();
  if (reason) throw new Error(reason);
  const t0 = Date.now();
  const at = () => `+${((Date.now() - t0) / 1000).toFixed(2)}s`;
  let speechEndedAt = 0;
  let userFinalAt = 0;
  let firstAudio = true;
  let turnDone: (() => void) | null = null;

  const ctx = await voiceSessionService.openSession(userId, { language: 'zh', voice: 'female', tz: 'America/Los_Angeles' });
  let session: LiveVoiceSession;
  const sink = {
    sendEvent(e: VoiceServerEvent) {
      switch (e.type) {
        case 'userFinal':
          userFinalAt = Date.now();
          console.log(`${at()} userFinal (${userFinalAt - speechEndedAt} ms after speech end): ${e.text}  matches=${JSON.stringify(e.matches)}`);
          firstAudio = true;
          break;
        case 'assistantText':
          console.log(`${at()} tutor[${e.sentenceIndex}]: ${e.text}`);
          break;
        case 'recast':
          console.log(`${at()} recast: ${JSON.stringify(e.recast)}`);
          break;
        case 'turnEnd':
          console.log(`${at()} turnEnd interrupted=${e.interrupted}`);
          // Pretend the client played everything.
          setTimeout(() => session.onPlaybackEnded(e.turnId), 50);
          setTimeout(() => turnDone?.(), 100);
          break;
        case 'ended':
          console.log(`${at()} ended: ${JSON.stringify(e.summary, null, 2)}`);
          break;
        case 'userPartial':
          break;
        default:
          console.log(`${at()} ${JSON.stringify(e)}`);
      }
    },
    sendAudio(frame: Buffer) {
      if (firstAudio) {
        console.log(`${at()} first audio (${Date.now() - userFinalAt} ms after userFinal, ${Date.now() - speechEndedAt} ms after speech end)`);
        firstAudio = false;
      }
    },
    close(code?: number) {
      console.log(`${at()} socket close ${code}`);
    },
  };
  session = new LiveVoiceSession(voiceSessionService, ctx, sink);
  session.start();

  for (const line of lines) {
    const pcm = await synthesizePcm(line);
    console.log(`${at()} learner says (${(pcm.length / 32000).toFixed(1)} s): ${line}`);
    const done = new Promise<void>((r) => { turnDone = r; });
    for (let o = 0; o < pcm.length; o += 640) {
      session.onAudio(pcm.subarray(o, o + 640));
      await sleep(20);
    }
    speechEndedAt = Date.now();
    // Silence until the turn completes (the endpointer needs ~900 ms of it).
    let waited = 0;
    let finished = false;
    void done.then(() => { finished = true; });
    while (!finished && waited < 30_000) {
      session.onAudio(Buffer.alloc(640));
      await sleep(20);
      waited += 20;
    }
  }
  await session.onEnd();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
