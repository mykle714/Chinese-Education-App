# Tutor voice check

One offline script, `tts-bench.ts`, that synthesizes test lines with ElevenLabs and Google voices
and writes a listening report, used to choose the voice assistant's TTS
([docs/VOICE_ASSISTANT.md](../../../docs/VOICE_ASSISTANT.md) § 5.3, Q17–Q20). Nothing here is imported
by the app. Results are gitignored.

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



**Depends on / referenced by:** [docs/VOICE_ASSISTANT.md](../../../docs/VOICE_ASSISTANT.md) § 5.3, § 10, Q17–Q20; [docs/DEFERRED_WORK.md](../../../docs/DEFERRED_WORK.md) items 13, 56. `tts-bench.ts` imports `server/services/TTSService.ts` → `buildPinyinSsml`.
