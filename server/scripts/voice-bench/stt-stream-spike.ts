/**
 * STT streaming spike — does Google Speech-to-Text v2 STREAM mixed Chinese/English?
 *
 * docs/VOICE_ASSISTANT.md § 5.1 left one build-time unknown: the 2026-11-18 smoke test proved
 * chirp_2 / chirp_3 handle code-switched speech in BATCH `recognize`, but not whether either
 * accepts `streamingRecognize` with these settings. This script answers that:
 *
 *   1. synthesizes one Chinglish line with the tutor's Chirp3-HD voice as 16 kHz LINEAR16,
 *   2. streams it in 20 ms frames (the voice socket's frame size) through each candidate
 *      (model, location, languageCodes) config,
 *   3. prints every interim/final result, time-to-first-result and the final text.
 *
 * Run from server/:  npx tsx scripts/voice-bench/stt-stream-spike.ts ["custom line"]
 * Needs GOOGLE_APPLICATION_CREDENTIALS. Nothing in the app imports this.
 *
 * Depends on: @google-cloud/speech (v2 client). Referenced by docs/VOICE_ASSISTANT.md § 5.1.
 */
import 'dotenv/config';
import fs from 'fs';
import { v2 as speechV2 } from '@google-cloud/speech';
import { GoogleAuth } from 'google-auth-library';

const LINE = process.argv[2] || '我昨天去了那个 grocery store，买了很多 vegetables，然后回家做饭。';
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS!;
const projectId: string = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).project_id;

/** Synthesize the test line as raw 16 kHz mono PCM16 (WAV header stripped). */
async function synthesizePcm(text: string): Promise<Buffer> {
  const auth = new GoogleAuth({ keyFile: credentialsPath, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const token = await (await auth.getClient()).getAccessToken();
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'cmn-CN', name: 'cmn-CN-Chirp3-HD-Achernar' },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 16000 },
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  const wav = Buffer.from(((await res.json()) as { audioContent: string }).audioContent, 'base64');
  return wav.subarray(44); // canonical 44-byte WAV header
}

interface Candidate { model: string; location: string; languageCodes: string[] }

const CANDIDATES: Candidate[] = [
  { model: 'chirp_3', location: 'us', languageCodes: ['cmn-Hans-CN', 'en-US'] },
  { model: 'chirp_3', location: 'us', languageCodes: ['cmn-Hans-CN'] },
  { model: 'chirp_2', location: 'us-central1', languageCodes: ['cmn-Hans-CN'] },
];

async function runCandidate(pcm: Buffer, c: Candidate): Promise<void> {
  const label = `${c.model} @ ${c.location} [${c.languageCodes.join(', ')}]`;
  const client = new speechV2.SpeechClient({
    keyFilename: credentialsPath,
    apiEndpoint: `${c.location}-speech.googleapis.com`,
  });
  const recognizer = `projects/${projectId}/locations/${c.location}/recognizers/_`;
  const started = Date.now();
  let firstResultMs: number | null = null;
  const finals: string[] = [];

  await new Promise<void>((resolve) => {
    const stream = client._streamingRecognize();
    stream.on('data', (resp: any) => {
      for (const r of resp.results ?? []) {
        const text = r.alternatives?.[0]?.transcript ?? '';
        if (firstResultMs === null) firstResultMs = Date.now() - started;
        console.log(`  +${Date.now() - started}ms ${r.isFinal ? 'FINAL  ' : 'interim'} ${text}`);
        if (r.isFinal) finals.push(text);
      }
    });
    stream.on('error', (err: Error) => { console.log(`  ✗ ${label}: ${err.message}`); resolve(); });
    stream.on('end', () => resolve());

    // First message: config only.
    stream.write({
      recognizer,
      streamingConfig: {
        config: {
          explicitDecodingConfig: { encoding: 'LINEAR16', sampleRateHertz: 16000, audioChannelCount: 1 },
          languageCodes: c.languageCodes,
          model: c.model,
          features: { enableAutomaticPunctuation: true },
        },
        streamingFeatures: { interimResults: true },
      },
    });
    // Then 20 ms frames (640 bytes at 16 kHz PCM16) paced in real time, like a live mic.
    const FRAME = 640;
    let offset = 0;
    const timer = setInterval(() => {
      // PAD_SILENCE_MS (env): keep streaming digital silence after the line instead of
      // closing, to see whether the model finalizes on a pause by itself.
      const padBytes = Number(process.env.PAD_SILENCE_MS || 0) * 32;
      if (offset >= pcm.length + padBytes) { clearInterval(timer); stream.end(); return; }
      const frame = offset < pcm.length ? pcm.subarray(offset, offset + FRAME) : Buffer.alloc(FRAME);
      if (offset >= pcm.length && finals.length && !process.env.KEEP_OPEN) { clearInterval(timer); stream.end(); return; }
      stream.write({ audio: frame });
      offset += FRAME;
    }, 20);
  });

  console.log(`→ ${label}: first result ${firstResultMs ?? '—'} ms, total ${Date.now() - started} ms`);
  console.log(`  final: ${finals.join(' ') || '(none)'}\n`);
  await client.close();
}

async function main() {
  console.log(`Line: ${LINE}\n`);
  const pcm = await synthesizePcm(LINE);
  console.log(`Audio: ${(pcm.length / 32000).toFixed(2)} s\n`);
  for (const c of CANDIDATES) {
    console.log(`=== ${c.model} @ ${c.location} [${c.languageCodes.join(', ')}]`);
    await runCandidate(pcm, c);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
