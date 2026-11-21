/**
 * Tutor voice check for the voice assistant (docs/VOICE_ASSISTANT.md Q14 / Q17 / Q18 / Q20, § 4.5, § 5.3).
 *
 * Synthesizes a line set with named voice variants from two providers and writes a listening
 * page. It answers, per variant:
 *   1. Tones and readings. ElevenLabs takes plain text with no pinyin hint, so it must read
 *      every tone right from context. Google can take per-character pinyin hints
 *      (`<phoneme>`, the same path the flashcards use), which forces the reading.
 *   2. Mixed zh/en in one request: can one voice say both well?
 *   3. Latency. TTFB = first audio byte. ElevenLabs streams; Google's REST call does not,
 *      so for Google TTFB == total.
 *
 * Usage (from server/):
 *   npx tsx scripts/voice-bench/tts-bench.ts                       # data/tts-lines.json, multilingual vs flash
 *   npx tsx scripts/voice-bench/tts-bench.ts --lines tone-lines.json --variants flash,flash-zh
 *   npx tsx scripts/voice-bench/tts-bench.ts --lines tone-lines-short.json --variants google-wavenet,google-wavenet-pinyin,google-chirp3
 *   npx tsx scripts/voice-bench/tts-bench.ts --list-voices         # ElevenLabs voices on the account
 *
 * Env (server/.env): ELEVENLABS_API_KEY, ELEVENLABS_VOICE_IDS (comma list; ElevenLabs variants
 * run once per voice), GOOGLE_APPLICATION_CREDENTIALS (Google variants; already set for the
 * card TTS).
 * Output: scripts/voice-bench/results/tts-<timestamp>/{audio/*.mp3, results.json, report.html}
 *
 * Referenced by docs: docs/VOICE_ASSISTANT.md, scripts/voice-bench/README.md
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleAuth } from 'google-auth-library';
import { buildPinyinSsml } from '../../services/TTSService.js';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(BENCH_DIR, '..', '..');
const ELEVEN_API = 'https://api.elevenlabs.io/v1';

type Variant =
  | { provider: 'eleven'; modelId: string; languageCode?: string }
  | { provider: 'google'; voice: string; pinyinHints?: boolean };

/**
 * Named synthesis variants.
 * - ElevenLabs: multilingual_v2 = quality; flash_v2_5 = low latency (chosen, Q18);
 *   `flash-zh` pins `language_code: "zh"` (Q20 option 1).
 * - Google: Wavenet-A is the current flashcard voice. `google-wavenet-pinyin` sends each line's
 *   `hint` through `buildPinyinSsml`, the cards' own SSML builder, so tones are forced.
 *   Chirp3-HD voices sound more natural but accept no SSML, so they cannot take hints.
 * A retired id or unsupported parameter errors, and the report shows the provider's message.
 */
const VARIANTS: Record<string, Variant> = {
  multilingual: { provider: 'eleven', modelId: 'eleven_multilingual_v2' },
  flash: { provider: 'eleven', modelId: 'eleven_flash_v2_5' },
  'flash-zh': { provider: 'eleven', modelId: 'eleven_flash_v2_5', languageCode: 'zh' },
  'google-wavenet': { provider: 'google', voice: 'cmn-CN-Wavenet-A' },
  'google-wavenet-pinyin': { provider: 'google', voice: 'cmn-CN-Wavenet-A', pinyinHints: true },
  'google-chirp3': { provider: 'google', voice: 'cmn-CN-Chirp3-HD-Achird' },
  'google-chirp3-f': { provider: 'google', voice: 'cmn-CN-Chirp3-HD-Achernar' },
};
const DEFAULT_VARIANTS = ['multilingual', 'flash'];

/**
 * `pinyin`: the expected reading, shown in the report for checking tones.
 * `hint`: one syllable per Han character, for Google pinyin hints (`buildPinyinSsml`).
 */
interface TtsLine { id: string; kind: string; text: string; check?: string; pinyin?: string; hint?: string }
interface Cell { ttfbMs: number | null; totalMs: number | null; file: string | null; error: string | null }

function flagValue(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

/** fetch() that throws with the response body on a non-2xx, so the real reason reaches the report. */
async function fetchOk(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res;
}

// ─── ElevenLabs ────────────────────────────────────────────────────────────────

function elevenKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set in server/.env');
  return key;
}

async function listVoices(): Promise<{ id: string; name: string }[]> {
  const res = await fetchOk(`${ELEVEN_API}/voices`, { headers: { 'xi-api-key': elevenKey() } });
  const voices = ((await res.json()) as { voices?: { voice_id: string; name: string }[] }).voices ?? [];
  return voices.map((v) => ({ id: v.voice_id, name: v.name }));
}

/** Stream one synthesis; TTFB is when the first chunk arrives (what the learner waits for). */
async function synthElevenLabs(voiceId: string, modelId: string, text: string, languageCode?: string) {
  const t0 = performance.now();
  const res = await fetchOk(`${ELEVEN_API}/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': elevenKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: modelId, ...(languageCode ? { language_code: languageCode } : {}) }),
  });
  if (!res.body) throw new Error('no response body');
  const chunks: Buffer[] = [];
  let ttfbMs = NaN;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    if (Number.isNaN(ttfbMs)) ttfbMs = performance.now() - t0;
    chunks.push(Buffer.from(chunk));
  }
  return { audio: Buffer.concat(chunks), ttfbMs, totalMs: performance.now() - t0 };
}

// ─── Google (same service account as TTSService) ─────────────────────────────

let googleAuth: GoogleAuth | null = null;
async function googleToken(): Promise<string> {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!raw) throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set in server/.env');
  const keyFile = path.isAbsolute(raw) ? raw : path.resolve(SERVER_DIR, raw);
  googleAuth ??= new GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const tok = await (await googleAuth.getClient()).getAccessToken();
  const token = typeof tok === 'string' ? tok : tok.token;
  if (!token) throw new Error('could not get a Google access token');
  return token;
}

async function synthGoogle(voice: string, line: TtsLine, pinyinHints: boolean) {
  let input: { ssml: string } | { text: string } = { text: line.text };
  if (pinyinHints) {
    const ssml = buildPinyinSsml(line.text, line.hint);
    // Fail loudly: a silent fallback to plain text would make the "hinted" column lie.
    if (!ssml) throw new Error(`no usable pinyin hint for ${line.id} (syllable count must match the Han characters)`);
    input = { ssml };
  }
  const token = await googleToken();
  const t0 = performance.now();
  const res = await fetchOk('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, voice: { languageCode: 'cmn-CN', name: voice }, audioConfig: { audioEncoding: 'MP3' } }),
  });
  const json = (await res.json()) as { audioContent?: string };
  if (!json.audioContent) throw new Error('Google returned no audioContent');
  const totalMs = performance.now() - t0;
  return { audio: Buffer.from(json.audioContent, 'base64'), ttfbMs: totalMs, totalMs };
}

// ─── Report helpers ────────────────────────────────────────────────────────────

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const fmtMs = (ms: number | null) => (ms == null ? '—' : `${Math.round(ms)} ms`);
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ─── Run ───────────────────────────────────────────────────────────────────────

interface RunVariant { key: string; run: (line: TtsLine) => Promise<{ audio: Buffer; ttfbMs: number; totalMs: number }> }

async function buildVariants(wanted: string[]): Promise<RunVariant[]> {
  const unknown = wanted.filter((w) => !VARIANTS[w]);
  if (unknown.length) throw new Error(`Unknown variant(s) ${unknown.join(', ')}; known: ${Object.keys(VARIANTS).join(', ')}`);
  const out: RunVariant[] = [];
  const needsEleven = wanted.some((w) => VARIANTS[w].provider === 'eleven');
  const voiceIds = (process.env.ELEVENLABS_VOICE_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (needsEleven && voiceIds.length === 0) throw new Error('Set ELEVENLABS_VOICE_IDS in server/.env (find ids with --list-voices)');
  const names = needsEleven ? new Map((await listVoices()).map((v) => [v.id, v.name])) : new Map<string, string>();

  for (const name of wanted) {
    const v = VARIANTS[name];
    if (v.provider === 'eleven') {
      // ElevenLabs variants run once per configured voice.
      for (const voiceId of voiceIds) {
        out.push({ key: `${names.get(voiceId)?.split(' ')[0] ?? voiceId}__${name}`, run: (l) => synthElevenLabs(voiceId, v.modelId, l.text, v.languageCode) });
      }
    } else {
      out.push({ key: name, run: (l) => synthGoogle(v.voice, l, !!v.pinyinHints) });
    }
  }
  return out;
}

async function main() {
  if (process.argv.includes('--list-voices')) { console.table(await listVoices()); return; }

  const linesFile = path.join(BENCH_DIR, 'data', flagValue('lines') ?? 'tts-lines.json');
  let lines: TtsLine[];
  try { lines = (JSON.parse(fs.readFileSync(linesFile, 'utf8')) as { lines: TtsLine[] }).lines; }
  catch (err) { throw new Error(`Could not read ${linesFile}: ${(err as Error).message}`); }

  const wanted = (flagValue('variants') ?? DEFAULT_VARIANTS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const variants = await buildVariants(wanted);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = path.join(BENCH_DIR, 'results', `tts-${stamp}`);
  fs.mkdirSync(path.join(runDir, 'audio'), { recursive: true });

  // Requests run one at a time so latencies are not distorted.
  const grid: Record<string, Record<string, Cell>> = {};
  for (const v of variants) {
    console.log(`- ${v.key}`);
    grid[v.key] = {};
    for (const line of lines) {
      try {
        const { audio, ttfbMs, totalMs } = await v.run(line);
        const file = `${v.key}__${line.id}.mp3`;
        fs.writeFileSync(path.join(runDir, 'audio', file), audio);
        grid[v.key][line.id] = { ttfbMs, totalMs, file, error: null };
      } catch (err) {
        grid[v.key][line.id] = { ttfbMs: null, totalMs: null, file: null, error: (err as Error).message };
      }
    }
  }

  const summary = variants.map((v) => {
    const cells = Object.values(grid[v.key]);
    const ok = cells.filter((c) => !c.error);
    return { variant: v.key, ok: `${ok.length}/${cells.length}`, 'median TTFB': fmtMs(median(ok.map((c) => c.ttfbMs!))), 'median total': fmtMs(median(ok.map((c) => c.totalMs!))), firstError: cells.find((c) => c.error)?.error?.slice(0, 120) ?? '' };
  });
  console.table(summary);

  const th = variants.map((v) => `<th>${esc(v.key)}</th>`).join('');
  const rows = lines.map((line) => {
    const cells = variants.map((v) => {
      const c = grid[v.key][line.id];
      return `<td>${c.error ? `<span class="bench-error">${esc(c.error)}</span>`
        : `<audio controls preload="none" src="audio/${esc(c.file)}"></audio><br><span class="bench-muted">TTFB ${fmtMs(c.ttfbMs)} · total ${fmtMs(c.totalMs)}</span>`}</td>`;
    }).join('');
    return `<tr><td><b>${esc(line.text)}</b><br><span class="bench-muted">${esc(line.kind)}${line.check ? ` · listen for: ${esc(line.check)}` : ''}${line.pinyin ? ` · ${esc(line.pinyin)}` : ''}</span></td>${cells}</tr>`;
  }).join('');
  const sumRows = summary.map((s) => `<tr><td>${esc(s.variant)}</td><td>${esc(s.ok)}</td><td>${esc(s['median TTFB'])}</td><td>${esc(s['median total'])}</td><td class="bench-error">${esc(s.firstError)}</td></tr>`).join('');

  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify({ variants: variants.map((v) => v.key), grid }, null, 2));
  fs.writeFileSync(path.join(runDir, 'report.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Tutor voice check</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 24px; color: #222; background: #fafafa; }
  .bench-table { border-collapse: collapse; background: #fff; margin: 8px 0 20px; }
  .bench-table th, .bench-table td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
  .bench-table th { background: #f0f0f0; }
  .bench-error { color: #b00020; font-size: 12px; } .bench-muted { color: #777; font-size: 12px; }
  audio { width: 220px; }
</style></head><body>
<h1>Tutor voice check</h1>
<table class="bench-table"><tr><th>variant</th><th>ok</th><th>median TTFB</th><th>median total</th><th>error</th></tr>${sumRows}</table>
<table class="bench-table"><tr><th>line</th>${th}</tr>${rows}</table>
</body></html>`);
  console.log(`\nReport: ${path.join(runDir, 'report.html')}`);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
