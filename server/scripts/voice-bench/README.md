# Voice bench scripts

Offline scripts for the voice tutor ([docs/VOICE_ASSISTANT.md](../../../docs/VOICE_ASSISTANT.md)).
Nothing here is imported by the app. Results are gitignored.

| Script | What it answers |
|---|---|
| `tts-bench.ts` | Which TTS voice reads tutor lines right (§ 5.3, Q17–Q20) — the listening report below |
| `stt-stream-spike.ts` | Does Google STT v2 **stream** code-switched zh/en? Prints interim/final results and timings per (model, location, languages) config (§ 5.1). Env `PAD_SILENCE_MS` + `KEEP_OPEN=1` stream silence after the line instead of closing, to see when the model finalizes by itself |
| `live-session-smoke.ts <userId> ["line" …]` | Drives one real `LiveVoiceSession` with synthesized learner speech: STT → Claude → TTS → DB → end card, with the latency lines of § 4.5. Writes a real session for that user. `VOICE_MODEL=…` tries another Claude model |

On the dev box, run the two STT/session scripts with `DB_PORT=5433` (the Postgres container's
host port) when the session script needs the database.

## Tutor voice check (`tts-bench.ts`)

Synthesizes test lines with ElevenLabs and Google voices and writes a listening report, used to
choose the voice assistant's TTS.

**Outcome (2026-11-18):** Google Chirp3-HD (Achird, Achernar) is the tutor's TTS. Three rounds:
ElevenLabs models on one voice (`data/tts-lines.json`), tone accuracy across seven ElevenLabs takes
(`data/tone-lines.json`, with expected pinyin), then the 10 hardest lines on ElevenLabs vs Google
(`data/tone-lines-short.json`). Every ElevenLabs take misread tones; Chirp3-HD read every line right.
**Rerun the round 3 set on any voice before offering it to learners** (DEFERRED_WORK.md item 56).

## Run

From `server/`:

```bash
npx tsx scripts/voice-bench/tts-bench.ts                 # writes results/tts-<timestamp>/report.html
npx tsx scripts/voice-bench/tts-bench.ts --list-voices   # voice ids on the ElevenLabs account
# Tone check (Q20): 40 lines with expected pinyin, flash as-is vs flash with Chinese forced
npx tsx scripts/voice-bench/tts-bench.ts --lines tone-lines.json --variants flash,flash-zh
```

Variants (`tts-bench.ts` → `VARIANTS`): ElevenLabs `multilingual`, `flash`, `flash-zh` (`language_code: "zh"`), run once per voice in `ELEVENLABS_VOICE_IDS`; Google `google-wavenet`, `google-wavenet-pinyin` (per-character pinyin hints from each line's `hint`, via `TTSService` → `buildPinyinSsml`), `google-chirp3`, `google-chirp3-f`. Line sets: `data/tts-lines.json` (round 1), `data/tone-lines.json` (round 2, expected pinyin), `data/tone-lines-short.json` (round 3, 10 lines with `hint`). Override the voices for one run with `ELEVENLABS_VOICE_IDS=id1,id2 npx tsx …`.

Open `report.html` in a browser; the audio files sit next to it.

## Configuration (`server/.env`, dev box only)

| Var | What |
|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs key (profile menu → API Keys) |
| `ELEVENLABS_VOICE_IDS` | ElevenLabs voices for the `multilingual` / `flash` / `flash-zh` variants (comma list). `AwQL7jPTLzD7hSLmirIM` = BoHai. ElevenLabs is no longer the tutor's TTS (Q17); kept for re-tests |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google variants (the tutor's chosen TTS: Chirp3-HD Achird / Achernar) |



**Depends on / referenced by:** [docs/VOICE_ASSISTANT.md](../../../docs/VOICE_ASSISTANT.md) § 4.5, § 5.1, § 5.3, § 10, Q17–Q20; [docs/DEFERRED_WORK.md](../../../docs/DEFERRED_WORK.md) items 13, 56. `tts-bench.ts` imports `server/services/TTSService.ts` → `buildPinyinSsml`; `live-session-smoke.ts` imports `server/dal/setup.ts` → `voiceSessionService` and `server/services/voice/LiveVoiceSession.ts`.
