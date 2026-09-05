// Ad-hoc bench: how long does Google Cloud TTS take for one NPC-length line?
// Mirrors server/services/TTSService.ts -> callGoogle (same voice, same encoding),
// minus the disk cache, so every call is a real cold synth.
import { GoogleAuth } from 'google-auth-library';

const VOICE = process.env.GOOGLE_TTS_VOICE_ZH || 'cmn-CN-Wavenet-A';
const LANG = 'cmn-CN';
const auth = new GoogleAuth({ keyFile: '/app/google-tts-credentials.json', scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

// NPC-shaped lines: short question, medium sentence, and the 16-glyph ceiling (doc s5.6).
const LINES = ['热的还是凉的？', '要几碗？', '不好意思，厨房做错了菜。', '您好，欢迎光临，请问几位？'];

const client = await auth.getClient();
// Token fetch is amortized in production (google-auth-library caches it), so time it separately.
let t = performance.now();
await client.getAccessToken();
console.log(`token (cold): ${Math.round(performance.now() - t)} ms`);
t = performance.now();
const tok = (await client.getAccessToken()).token;
console.log(`token (warm): ${Math.round(performance.now() - t)} ms\n`);

const REPS = 5;
for (const text of LINES) {
  const samples = [];
  for (let i = 0; i < REPS; i++) {
    // Salt with a zero-width space so no upstream/CDN cache can serve a repeat.
    const body = {
      input: { text },
      voice: { languageCode: LANG, name: VOICE },
      audioConfig: { audioEncoding: 'MP3' },
    };
    const start = performance.now();
    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    const ms = performance.now() - start;
    if (!res.ok) { console.log(`  ERROR ${res.status}: ${JSON.stringify(json).slice(0, 200)}`); break; }
    samples.push({ ms, bytes: Buffer.from(json.audioContent, 'base64').length });
  }
  if (!samples.length) continue;
  const ms = samples.map(s => s.ms).sort((a, b) => a - b);
  const p50 = Math.round(ms[Math.floor(ms.length / 2)]);
  console.log(`${text}  (${text.length} glyphs)  p50 ${p50} ms  min ${Math.round(ms[0])}  max ${Math.round(ms[ms.length-1])}  mp3 ${Math.round(samples[0].bytes/1024)} KB`);
}
