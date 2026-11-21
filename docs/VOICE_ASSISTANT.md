# Voice Assistant (speech-to-speech tutor)

A hands-free, spoken conversation partner for the learner. You talk to it, it talks back.
The interaction model copies **Claude's voice mode** in the Claude apps. Three things are
specific to this app:

1. **Chinglish-native.** It expects mixed Chinese/English speech, understands it, and recasts
   it into Chinese.
2. **Level-shaped speech.** Sentence length, vocabulary and speaking rate follow the learner's
   level. *How* the tutor teaches is system-prompt content and is tuned after free talk works
   (§ 6.2–6.3).
3. **Transcript-first.** Every session is saved as a tappable cpcd transcript. Cards are added
   from the transcript by the learner (a UI action), never by the assistant.

**Status: DESIGN / DRAFT (2026-11-18). Nothing is built.** No tables, routes, flags or client
code exist yet. The two tables in § 11 are approved; open questions are in § 13.

**Decisions so far (owner, 2026-11-18):**
- **Spec first, build nothing yet.** The goal is to *see free talk working*, then tune it.
- **UX is a placeholder.** Lay features out so they are naturally reachable; the owner will
  tune the look later. Do not spend design effort on polish.
- **Transcripts are saved and kept forever** for now. A TTL may come later (§ 11).
- **The learner's voice is never stored.** Only text is kept.
- **End-of-session card: yes.** Generic layout for now (§ 9.2).
- ~~**Review is also for practice**~~ — superseded 2026-11-18: re-say practice is dropped (Q15). Saved transcripts are read + listen only (§ 9.3).
- **Follow Claude's architecture, not OpenAI's** (2026-11-18): a cascade (STT → Claude → TTS)
  over a plain **WebSocket** on the existing Express server. OpenAI's voice mode is an
  audio-native model over WebRTC; WebRTC's transport-latency win matters little when the
  STT/Claude/TTS stages dominate the budget (§ 4.5). See Q3.
- **Two tables, not three** (2026-11-18): `voice_sessions` + `voice_turns`. The daily cap is
  summed from `voice_sessions`, with no separate usage table (§ 11, Q1).
- **Web only** for mic capture (`getUserMedia` + `AudioWorklet`), Q4.
- **One mode: free talk** (2026-11-18). No drill, no "about this word", no "practice again"
  modes. Free talk is tuned to help the speaker learn, and that tuning is **prompt-level work
  done after it runs** (§ 6.2–6.3).
- **Out of scope entirely** (2026-11-18): voice marks (nothing in voice mode ever marks a
  card), minute points for voice time, and tone / pronunciation grading. There are no phases.
- **Adding cards is UI, not a tool** (2026-11-18): the learner taps a word in the live or saved
  transcript → deip → add. The tutor never offers or adds cards.
- **One entry point: a Menu popover row** (2026-11-18), with the saved-session list behind it (Q2).
- **Google for both speech stages** (2026-11-18): **STT: Google Speech-to-Text** (Q5, revised: the owner wants
  fewer vendors, so ElevenLabs is dropped entirely). **TTS: Google Chirp3-HD**
  (2026-11-18, Q17), chosen after three listening rounds: every ElevenLabs voice misread tones,
  Chirp3-HD read every test line right. **No model benchmark**: the Claude model stays the § 6.1 default (Q8).
- **No push-to-talk** (2026-11-18): always hands-free (§ 4.2).
- **One tutor persona, two voices** (2026-11-18, Q14): the learner picks Google `cmn-CN-Chirp3-HD-Achird`
  (male) or `cmn-CN-Chirp3-HD-Achernar` (female). More voices later: DEFERRED_WORK.md item 56.

**Depends on / references (existing code):**
- `server/services/anthropicClient.ts` → `getAnthropicClient` (the shared client; § 6.4 proposes a separate key)
- Google Cloud Speech-to-Text (streaming, § 5.1) and Text-to-Speech Chirp3-HD voices (§ 5.3), both on the same service account as `server/services/TTSService.ts` (`GOOGLE_APPLICATION_CREDENTIALS`). The Speech-to-Text API is enabled on that project (2026-11-18)
- `server/scripts/voice-bench/tts-bench.ts` (the voice check: heteronyms, mixed lines, TTFB per model; § 5.3)
- `src/services/tts/CloudTTSProvider.ts`, `src/hooks/useTTSSettings.ts` (playback sinks; [AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md)). The tutor's voice is its own setting, not the card narration voice (Q21)
- `server/routes/vocabEntryRoutes.ts` → `/api/vocabEntries/addToLibrary` (the existing deip add path the transcript reuses; § 9)
- `server/routes/dictionaryRoutes.ts` → `/api/dictionary/segment` (gsa; § 4.3)
- `server/contracts/featureFlags.ts` → `FEATURE_FLAGS` (§ 10)
- `dictionary_ai_usage` daily cap pattern (`server/dal/implementations/DictionaryDAL.ts`), which § 11 deliberately does **not** copy

---

## 1. What "modeled on Claude's voice mode" means here

What we copy is the **user-visible behaviour** of Claude's voice mode. We do not know its
internal implementation and should not claim to. These are the behaviours to match:

| Claude voice mode behaviour | Our version |
|---|---|
| A full-screen voice view with an animated orb that shows *listening / thinking / speaking* | `VoiceSessionSheet`: a full-height sheet with one orb in three states (§ 8) |
| Hands-free by default: you just talk, and it detects when you've finished | Server-side endpointing (VAD + silence timeout; § 4.2). Always hands-free: there is no push-to-talk |
| **Barge-in**: talk over it and it stops speaking immediately | Client stops playback the moment VAD fires; server cancels the Claude stream and the TTS queue (§ 4.4) |
| Live captions of both sides | Rolling transcript under the orb. Chinese lines render as cpcd so they can be tapped (§ 8) |
| A choice of named voices | Two Chirp3-HD voices, male and female (Q14); more later (DEFERRED_WORK.md item 56). Speaking rate follows level (§ 5.3) |
| The voice conversation is saved as a normal text conversation you can scroll back through later | Each session is saved as a transcript (§ 11), reopened from a session list for review (§ 9) |
| Short, conversational replies: no markdown and no lists read aloud | A system-prompt rule plus a server-side markdown stripper before TTS (§ 6.2) |
| Tools can run mid-conversation, with a brief spoken "let me check" | Only one silent tool, `note_recast` (§ 7). No spoken filler is needed |

**Not copied:** cross-app integrations (calendar, mail), web search, and Claude's
general-assistant persona. This is a **tutor**, and its scope is limited to language practice.

---

## 2. Architecture at a glance: a cascaded pipeline

```
 ┌──────────── CLIENT (src/features/voice/) ────────────┐        ┌──────────────── SERVER ────────────────────┐
 │ mic → AudioWorklet (16 kHz PCM) → WS frames ─────────┼──────► │ voiceRoutes (WS upgrade, auth)             │
 │                                                      │        │   └ VoiceSessionController                 │
 │ local VAD (barge-in only) ─── "interrupt" msg ───────┼──────► │       └ VoiceSessionService (orchestrator) │
 │                                                      │        │           ├ SpeechToTextProvider (stream)  │
 │ audio queue ◄── mp3/opus chunks + transcript events ◄┼─────── │           ├ Claude (stream + tools)        │
 │ orb state machine, transcript (cpcd)                 │        │           ├ VoiceTTS (sentence-chunked)    │
 └──────────────────────────────────────────────────────┘        │           └ VoiceToolExecutor (note_recast)│
                                                                 │                                            │
                                                                 │       └ VoiceSessionDAL (transcripts, cap) │
                                                                 └────────────────────────────────────────────┘
```

**Why a cascade (STT → LLM → TTS) and not a native audio-to-audio model:**
- The Claude API takes text and images, not audio. A cascade is the only way to keep Claude
  as the brain, and Claude is the brain the user asked for.
- Each stage can be swapped, and we can see what passes between them. We **need the
  transcript text** anyway: it drives the cpcd captions, the gsa segmentation, card
  matching and the saved transcript.
- The app already uses Anthropic (dictionary) and Google TTS (cards). Both speech stages are Google: Speech-to-Text (Q5) and Chirp3-HD (Q17). Vendors: Google + Anthropic only.

**The cost of this choice:** latency (§ 4.5), and the loss of prosody and tone information
at the STT boundary (§ 5.2). That second point matters most for a Mandarin tutor, and it
gets its own section.

### Layer placement (per [BACKEND_LAYERING.md](./BACKEND_LAYERING.md) / [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md))

| Component | Layer | Notes |
|---|---|---|
| `server/routes/voiceRoutes.ts` | Route | WebSocket upgrade on `/api/voice/session`. JWT checked during the upgrade handshake. **This is the app's first WebSocket** (decided, Q3) |
| `server/controllers/VoiceSessionController.ts` | Controller | Parses frames, owns the socket lifecycle, and calls nothing but the service |
| `server/services/voice/VoiceSessionService.ts` | Service | The per-session turn state machine (§ 4.1). Writes no SQL |
| `server/services/voice/stt/SpeechToTextProvider.ts` (+ one impl) | Service adapter | Streaming STT behind an interface; the one impl is Google Speech-to-Text streaming recognition over gRPC (`@google-cloud/speech`, a new server dependency) (Q5) |
| `server/services/voice/VoiceTTS.ts` | Service adapter | Sentence-chunked Google Chirp3-HD synthesis in the learner's chosen tutor voice. Reuses `TTSService`'s Google credentials but not its cache (§ 5.3) |
| `server/services/voice/voiceTools.ts` | Service | The `note_recast` tool schema + `VoiceToolExecutor` (§ 7) |
| `server/services/voice/voicePrompt.ts` | Service | Builds the system prompt + learner profile block (§ 6) |
| `server/dal/implementations/VoiceSessionDAL.ts` | DAL | Transcripts, daily usage cap |
| `src/features/voice/` | Client feature | `VoiceSessionSheet`, `useVoiceSession` (socket + state machine), `micCapture.ts` (AudioWorklet), `voicePlayback.ts` |
| `src/api/voiceSocket.ts` | Client API | The one WS opener. It must take its auth from `authHeader()`-style storage and **not take a `token` parameter** (FRONTEND_LAYERING rule) |

---

## 3. The wire protocol (one WebSocket per session)

Binary frames carry audio. Text frames carry JSON control events. Event names are camelCase.

| Direction | Event | Payload |
|---|---|---|
| C→S | `start` | `{ language: 'zh' }` |
| C→S | *(binary)* | 16 kHz mono PCM16, 20 ms frames |
| C→S | `interrupt` | barge-in detected locally; stop speaking |
| C→S | `end` | user closed the sheet |
| S→C | `state` | `{ state: 'listening' \| 'thinking' \| 'speaking' }`, which drives the orb |
| S→C | `userPartial` / `userFinal` | `{ text, segments? }`: live caption of the learner. `segments` = gsa output on the final transcript |
| S→C | `assistantText` | `{ turnId, sentenceIndex, text, segments }`, sent just before that sentence's audio |
| S→C | *(binary)* | audio chunk, prefixed with `turnId` + `sentenceIndex` so stale audio can be dropped after a barge-in |
| S→C | `error` / `capReached` | terminal or soft errors |

---

## 4. The turn loop

### 4.1 State machine (`VoiceSessionService`)

```
LISTENING ──(endpoint)──► THINKING ──(first TTS chunk ready)──► SPEAKING ──(queue drained)──► LISTENING
    ▲                        │                                     │
    └──────── interrupt ─────┴──────────── interrupt ──────────────┘
```

One `AbortController` per assistant turn. An `interrupt` aborts the Claude stream, clears the
TTS queue, and bumps `turnId` so the client drops any audio already in flight.

### 4.2 Endpointing ("are they done talking?")

This is the single biggest factor in whether the assistant *feels* like Claude's voice mode.

- **Silence timeout.** Default is longer than in an English assistant: **~900 ms rather than
  ~500 ms**. Learners pause in the middle of a sentence to search for a word, and cutting them
  off is the worst failure this feature can have. **Fixed** for everyone (decided 2026-11-18,
  Q7); tuned after hearing it work, not a user setting.
- **Hold on fillers.** If the partial transcript ends in a filler or connective (`那个…`,
  `就是…`, `um`, `like`, `的`, `是`), extend the timeout by ~600 ms.
- **Hold on repeated words** (decided 2026-11-18). A word or syllable repeated at the end of
  the partial transcript (`我我…`, `那个那个…`, `the the`) signals a learner searching for the
  next word. Extend the timeout by the same ~600 ms.
- Claude's own end-of-turn detection is unpublished and widely reported to cut people off
  mid-sentence. These holds are where we deliberately go *further* than Claude.
- **No push-to-talk** (decided 2026-11-18). Voice mode is always hands-free, so the
  endpointing above is the only way a turn ends.

### 4.3 What happens on `userFinal`

1. Run the gsa (`/api/dictionary/segment`'s service, called in-process) over the transcript to
   get word segments.
2. **Match each segment against the learner's vet** as `known` / `learning` / `notACard`. The
   client uses it to highlight caption words (and words the learner could add). Whether it is
   also passed to Claude in the turn annotations (§ 6.3) is part of the later prompt tuning.
3. Append the user turn to the message history and stream Claude's response.

### 4.4 Streaming out

- Claude's text deltas are buffered until a **sentence boundary** (`。！？.!?` or a hard cap of
  ~40 characters).
- Each sentence is stripped of markdown, emitted as `assistantText`, and queued for TTS.
- Sentence N+1 is synthesized while sentence N plays. This overlap is what keeps
  time-to-first-audio low.

### 4.5 Latency budget (target: the learner stops talking → first audio in **≤ 1.5 s**)

| Stage | Budget | Lever |
|---|---|---|
| Endpoint silence | 900 ms (deliberate, § 4.2) | Fixed; the filler / repeated-word holds only ever lengthen it |
| STT finalization | ~150 ms | streaming STT, so the transcript is already mostly done |
| Claude time to first token | ~300–600 ms | prompt caching (§ 6.4), low effort, short system prompt |
| First sentence buffered + TTS | ~250 ms | sentence chunking, a short first sentence |

The 900 ms endpoint dominates the budget, and it is a choice we make for learners' sake. If
the total feels slow, adjust the endpoint first, not the model.

---

## 5. Chinglish: the parts that differ from an English assistant

### 5.1 Recognising code-switched speech (STT)

Learners say things like *"我昨天去了那个 grocery store, 买了很多 vegetables"*. The STT must
handle **zh-CN and en-US within one utterance**:
- **Vendor: Google Speech-to-Text** (decided 2026-11-18, Q5; revised from ElevenLabs Scribe the
  same day because the owner wants fewer vendors). Not benchmarked. **Streaming recognition**
  (gRPC `StreamingRecognize`), because the latency budget (§ 4.5) assumes the transcript is mostly
  done when the learner stops.
- **Model: the newest Chirp model that streams with multiple languages** (Chirp 3 or Chirp 2 on
  the v2 API, `languageCodes: ["cmn-Hans-CN", "en-US"]`). The older v1 models only pick ONE language
  per utterance (`alternativeLanguageCodes` is language detection, not code-switching), so they
  would mangle the English words in a Chinglish sentence. **Smoke test (2026-11-18, batch
  `recognize`, one Chinglish line spoken by the Chirp3-HD tutor voice):** v1 returned
  "那个**歌service**"; `chirp_2` (us-central1, cmn-Hans-CN) and `chirp_3` (us, cmn-Hans-CN with or
  without en-US) all returned the line exactly. The audio was native-quality synthetic speech, so this
  proves the setup and the code-switching, not learner-accent accuracy. Still to confirm in the
  build: which of the two supports **streaming** with these settings.
- **Known risk.** Mixed-language accuracy is unmeasured. The adapter interface keeps the vendor
  swappable; if real transcripts are poor, the fallback is another vendor's adapter, compared on
  the same saved speech.
- Supply **phrase hints** from the learner's Learning cards (the top ~200 by recency) through
  Google's speech adaptation (phrase sets / boost), if the chosen model supports it. This biases
  recognition toward the words they are trying to use, which is exactly where learner
  pronunciation is shakiest.
- Keep the STT's per-word confidence where the model provides it. Low-confidence Chinese words are passed to Claude as
  `[?]` annotations (§ 6.3), so it can say "did you mean 商店 shāngdiàn?" instead of answering
  a misheard sentence with confidence.

### 5.2 Tones: the STT boundary throws them away

A general-purpose STT outputs **characters**, which means it silently "corrects" a tone error
into the word the learner meant. So the cascade **cannot** give pronunciation feedback on tones.
- We accept this and say so in the UI. The assistant does not claim to grade
  pronunciation. Its system prompt forbids comments like "your tones were great".
- **Tone / pronunciation grading is out of scope** (decided 2026-11-18, Q6).

### 5.3 Speaking mixed-language replies (TTS)

The assistant's replies are mostly Chinese, with English glosses for beginners.

- **Vendor: Google Chirp3-HD** (decided 2026-11-18, Q17). Two voices, the learner's choice (Q14):
  `cmn-CN-Chirp3-HD-Achird` (male) and `cmn-CN-Chirp3-HD-Achernar` (female). The client sends the
  abstract role (`male` / `female`) and the server maps it to the provider voice, the same rule as
  `TTSService` → `TTSVoiceKey`: no provider voice name ever crosses the wire. The choice is a separate
  tutor setting (Q21): a male/female toggle in `VoiceSessionSheet`, saved in browser storage on its own
  key, independent of the card narration voice.
- **How it was chosen** (three listening rounds, `server/scripts/voice-bench/`, report in the
  "BoHai Voice Check" artifact):
  1. ElevenLabs multilingual vs flash on the voice BoHai: flash preferred, but both misread
     得 děi and the tones of 截止日期 / 星期五.
  2. 40 tutor lines on seven ElevenLabs takes (BoHai as-is, BoHai with `language_code: "zh"`, five
     other Mandarin library voices): every take made tone errors on everyday words (3–6 errors in
     the first half of the set); forcing Chinese changed nothing.
  3. The 10 hardest lines on BoHai vs Google: **both Chirp3-HD voices read all 10 correctly with
     no pinyin hints.** Wavenet was synthesized but not judged.
- **No pinyin hints.** Chirp3-HD accepts no SSML, so the card path's `<phoneme>` hints
  (`TTSService` → `buildPinyinSsml`) cannot be used; its accuracy is the model's own. If a
  misreading turns up later, the fallbacks are the tutor prompt avoiding that word, or Wavenet with
  hints built from gsa segmentation + det pinyin (correct by construction, but a flatter voice).
- **Latency.** ~500 ms to first audio per sentence with the plain (non-streaming) REST call, inside
  § 4.5's budget, against ~160 ms for ElevenLabs. Google also offers streaming synthesis for
  Chirp3-HD (gRPC); whether it is worth using is a build-time measurement.
- **Mixed zh/en in one request.** Chirp3-HD read the mixed test line correctly in one voice, so the
  old plan to split sentences into Han/Latin runs with two voices stays dropped.
- **Speaking rate** follows level: ~0.8× at HSK 1–2, rising to 1.0× at HSK 5+, via
  `audioConfig.speakingRate` if Chirp3-HD honours it (to confirm at build time).
- **No caching.** Conversational sentences almost never repeat. The card `TTSService` cache is not
  used, and the tutor (Chirp3-HD) and the cards (Wavenet-A with pinyin hints) sound different. That
  is accepted.
- **Cost.** About $30 per million characters (Google list price as last known; verify), roughly
  $0.04 per 10-minute session if the tutor speaks half the time. Cheaper than ElevenLabs flash.
- **Cloud dependency.** DEFERRED_WORK.md item 13 plans to move TTS to Amazon Polly with an AWS
  migration. The tutor's choice of Chirp3-HD is a reason to keep Google for the tutor, or to rerun
  the tone check on Polly first; noted on that item.

### 5.4 How the tutor responds to Chinglish (behaviour, system prompt — initial draft, tuned later)

- **Understand first, then recast.** Answer the *content* of what they said, then model the
  all-Chinese version once: *"……对，超市的菜很新鲜。你也可以说：我昨天去了**超市**，买了很多**蔬菜**。"*
- **One recast per turn, at most two new words.** Do not lecture.
- **Never talks about cards.** Adding a word is the learner's tap in the transcript (§ 9).
- **Code-switch down when they are lost.** Two confused turns in a row (detected by the model
  itself, or by an English "what?") switch the next reply to English-scaffolded Chinese.

---

## 6. The Claude side

### 6.1 Model and request shape

- Model: **`claude-opus-5-5`** (the default per the claude-api guidance), `output_config.effort:
  "low"`. Thinking cannot be disabled on Opus 5.5, so low effort is the latency control.
  Conversational turns do not benefit from deep reasoning. **No model benchmark** (owner,
  2026-11-18, Q8): start here, watch the time to first sentence in the running feature, and
  switch to `claude-sonnet-5-5` or `claude-haiku-5-5` only if it feels slow.
- `client.messages.stream(...)`, with `eager_input_streaming: true` on each tool and tool
  inputs validated before execution.
- Include the server-side refusal `fallbacks` (`betas: ["server-side-fallback-2026-07-01"]`,
  `fallbacks: "default"`) and check `stop_reason` before reading content. On a final
  `refusal`, speak a fixed, neutral line rather than nothing.
- `max_tokens` around 1024. Spoken replies should be short. A reply that hits the cap is a
  prompt bug.

### 6.2 System prompt (stable and cached; content is an initial draft, tuned after free talk works)

Contents, in this order (the order matters for the prefix cache):
1. Persona + scope: a patient Mandarin tutor, language practice only, polite refusal of
   off-topic requests.
2. **Voice rules:** plain sentences, no markdown, no lists, no emoji, no reading out of
   pinyin unless teaching a word, replies of 1–3 sentences unless the learner asks for more.
3. The Chinglish rules of § 5.4.
4. Tool-use rule (§ 7): call `note_recast` silently whenever a line is recast.
5. Honesty rule from § 5.2: no tone or pronunciation grading.

### 6.3 Learner profile and per-turn annotations (initial draft, tuned later)

- **Session-start profile:** sent as a `cache_control` block after the system prompt. Contains:
  HSK level estimate, utcm band counts, and the learner's **known-word list** (Mastered +
  Comfortable, capped at ~1,500 words, most frequent first). The prompt says: *"Build sentences
  mostly from these words; introduce at most one word outside them per reply."* That is how
  "speak at their level" is implemented: a vocabulary constraint, not a vague instruction.
- **Per-turn annotations:** appended to each user turn as a short bracketed block, e.g.
  `[cards: 超市=learning, 菜=known; lowConfidence: 蔬菜]`.
- **State changes in the middle of a session** (e.g. the learner added a card from the transcript)
  are injected as **mid-conversation `role: "system"` messages**, so the cached history prefix
  is not invalidated.

### 6.4 Caching and keys

- `cache_control` breakpoints after the system prompt and after the profile block. Check
  `usage.cache_read_input_tokens` in the logs during rollout. A zero means something volatile
  (a timestamp, unsorted JSON) has crept into the prefix.
- **Use a separate API key** (`VOICE_AI_API_KEY`), in the same way the dictionary AI fallback
  uses `DICT_AI_API_KEY`. That way voice spend shows up separately on the bill and can be cut
  off on its own. The client factory follows the `getAnthropicClient` lazy/null-return
  pattern, so a missing key disables the feature instead of crashing startup.

### 6.5 Abuse and cost cap

- A daily cap **per user in minutes of voice time** (not requests), enforced at `start` and
  checked every turn. When it is hit, the server sends `capReached`, which the client shows as
  a friendly limit message.
- A rough cost picture per 10-minute session (≈ 30 turns): Claude tokens are small thanks to
  caching. **STT and TTS seconds are probably the larger line items.** Measure on PPE before
  setting the cap (Q9).

---

## 7. Tools

Voice mode has **one** tool, and it never touches the learner's cards. Everything
card-related is a UI action on the transcript (§ 9): the assistant cannot add, mark or
quiz cards. Voice marks, minute points and modes other than free talk are out of scope
(decided 2026-11-18).

| Tool | What it does | Notes |
|---|---|---|
| `note_recast` | Records `{ learnerSaid, better, newWords[] }` whenever the tutor recasts a line. Writes to the session's turn record (`voice_turns.recast`) | **Silent**: never mentioned aloud. Gives the transcript highlights and the end-of-session card structured data without a second Claude call (§ 9). Strict JSON schema (`strict: true`, `additionalProperties: false`) |

Read-only tools such as `lookup_word` (ground the tutor in our det definitions) or
`get_due_cards` (steer conversation toward due Learning cards) are candidates for the later
behaviour tuning, not part of getting free talk working.

---

## 8. Client UX (placeholder: the owner will tune it)

The goal is that every feature is one obvious tap away, not that it looks finished.

- **`VoiceSessionSheet`**: a full-height sheet raised over the current page. The orb sits in
  the centre, with the transcript below it, and a bottom bar holding **End**, **Mute mic** and the tutor-voice toggle
  (male / female, Q21).
  Rounded-edge + `COLORS.border` outline on all
  controls, per the design guidelines. The orb's three state colours must come from the colour
  framework. **They must not reuse the utcm mastery-ramp hues**, for the same reason Hydra
  Bubbles avoided them (deferred to the owner's UX pass, Q12).
- **Transcript lines**: learner lines and assistant lines are both rendered as `CPCDRow`
  segments from the gsa output, so any word can be tapped to open the deip popup and added to
  cards from there. Words the tutor introduced (`note_recast.newWords`) are highlighted so they
  are easy to spot. A word added this way shows a small chip on its line.
- **Mic capture**: `getUserMedia` → `AudioWorklet` → downsample to 16 kHz PCM16. The browser's
  echo cancellation must stay **on**; without it, barge-in triggers on the assistant's own voice.
- **Audio session (iOS):** opening the mic switches the session into play-and-record mode,
  which overrides the `passthrough`/`media` route choice (AUDIO_PLAYBACK.md § 1) for the length
  of the session. Restore the user's route when the sheet closes. **This needs testing on a
  physical device**, as AUDIO_PLAYBACK § 8 already notes for the existing playback paths.
- **Global rules**: the sheet calls `useBlockEdgeSwipe(true)`. Its load/reset effects key on
  `user?.id`, **never `token`** (a token refresh during a 10-minute voice session would
  otherwise tear the socket down). The socket re-authenticates silently on reconnect.
- **Permissions**: the first launch shows a one-screen explainer before the OS mic prompt. If
  permission is denied, show a clear message with a link to settings.

---

## 9. Transcript and review

The cascade produces text at every step, so the transcript is a by-product rather than extra
work. It is surfaced in three places.

**Depends on:** `voice_turns` (§ 11), the `note_recast` tool (§ 7), the gsa
(`/api/dictionary/segment`), `CPCDRow`, the deip popup, `VoiceTTS` (Google Chirp3-HD).

### 9.1 Live captions (during the session)
As in § 8: both sides scroll under the orb as cpcd rows, and any word is tappable.

### 9.2 End-of-session card (generic for now)
Shown when the learner taps **End**. Built from data the session already holds. **No extra
Claude call.**

| Block | Source |
|---|---|
| Duration, number of turns | `voice_sessions` timing |
| Words added to cards | adds the learner made from the transcript during the session |
| "Better ways to say it" (up to 5) | `note_recast` records: learner's line ↔ the better version |
| Card words you used | the per-turn card matching of § 4.3 (`known` / `learning` hits) |
| Buttons: **Review transcript** · **Done** | § 9.3 |

### 9.3 Saved transcripts: review
Reached from the session list behind the Menu popover row (Q2). Each saved session opens as a
scrollable conversation:

- **Read:** cpcd lines, tap any word → deip → add to cards. Recasts appear as the learner's
  version next to the better version. Words the STT was unsure of are underlined, so a
  mishearing is not mistaken for a learner error.
- **Listen:** tap an assistant line or a "better" version to hear it again. The audio is
  synthesized fresh by `VoiceTTS` in the tutor's voice, so replay sounds like the live session.
  **No learner audio exists to replay** (decision).
- **No re-say practice** (dropped 2026-11-18, Q15): the transcript is read + listen only.

---

## 10. Feature flag and rollout

- New flag `voiceAssistant` in `FEATURE_FLAGS`, **OFF** by default. Per FEATURE_FLAGS.md, gate
  **every** entry point: the WS route mount in `server/server.ts` and the Menu popover row
  (the only entry point, Q2). A flip needs both containers rebuilt.
- Scope (one release, no phases): zh only (Spanish is paused). Free talk, `note_recast`,
  live captions, saved transcripts (read + listen), add-from-transcript, and
  the generic end-of-session card.
- **Out of scope** (decided 2026-11-18): other modes, voice marks, minute points, tone grading.
- **Before building:** listen to the voice-check report (`server/scripts/voice-bench/tts-bench.ts`,
  README alongside); Q17–Q20 are answered. No other benchmark is planned: STT vendor and model were
  decided without one (Q5, Q8).
- **Before real users:** measure cost per minute and set the daily cap (Q9).
- After it works: tune the tutor's behaviour (§ 5.4, § 6.2–6.3).
- Register the sheet in [ACTIVE_DUTY_PAGES.md](./ACTIVE_DUTY_PAGES.md) once it has an entry point.

---

## 11. Data (approved 2026-11-18, Q1)

| Table | Columns (proposed) | Why |
|---|---|---|
| `voice_sessions` | `id`, `userId`, `language`, `startedAt`, `endedAt`, `userSeconds`, `assistantSeconds`, `turnCount` | Session list, end card, usage dashboard, cap accounting |
| `voice_turns` | `id`, `sessionId`, `turnIndex`, `role` (`user`/`assistant`), `text`, `lowConfidenceWords` (jsonb), `recast` (jsonb, from `note_recast`), `interrupted`, `createdAt` | The saved transcript (§ 9) |

**No separate usage table (decided 2026-11-18).** The daily cap (§ 6.5) is computed as
`SUM(userSeconds + assistantSeconds)` over the user's `voice_sessions` whose `startedAt` falls in
the current local day (04:00 boundary), **plus the in-flight session's running total held in
memory by `VoiceSessionService`** (the open session's row is only finalized at `end`). This
differs from the `dictionary_ai_usage` pattern, which keeps a dedicated counter row.
An index on `voice_sessions (userId, startedAt)` keeps the sum cheap.

**Retention (decided):** no audio is ever stored. Transcripts are kept **forever** for now.
A TTL may be added later. If so, a nightly delete on `voice_sessions.endedAt` (with cascade to
`voice_turns`) is enough; nothing else references these rows.

**No word-match columns are stored.** The `known`/`learning` tinting is recomputed against the
learner's *current* cards when a transcript opens, so it never goes stale.

---

## 12. Risks and known limits

| Risk | Mitigation |
|---|---|
| A misheard learner gets a confident wrong correction | Low-confidence annotations (§ 5.1); the assistant asks before correcting |
| No tone feedback (§ 5.2) | State it honestly; tone grading is out of scope |
| The endpoint cuts learners off mid-thought | Long fixed timeout, filler + repeated-word holds (no push-to-talk fallback, so these must be right) |
| Echo triggers barge-in on speakers | Browser AEC on; ignore VAD for the first ~150 ms of each assistant sentence |
| Cost runaway (open mic) | Per-user daily minute cap; the session auto-ends after ~60 s with no speech |
| First WebSocket in the stack: nginx, Docker and the PPE proxy need upgrade headers | `nginx.conf` needs `proxy_set_header Upgrade/Connection` for `/api/voice/`. **Needs a deploy runbook** when built |
| The model drifts off-level | Hard known-word list in the profile; spot-check transcripts during beta |

---

## 13. Question log

1. ~~**Tables**~~ — **answered 2026-11-18:** `voice_sessions` + `voice_turns` approved as listed in § 11; `voice_ai_usage` dropped, the cap is summed from `voice_sessions`.
2. ~~**Entry points**~~ — **answered 2026-11-18:** a Menu popover row only. Was: Menu popover row, a Deck Tower platform, the eip button, all three, or something else? Does voice get its own footer tab, the way Claude puts voice next to the input?
3. ~~**Transport**~~ — **answered 2026-11-18:** raw `ws` on the existing Express server, following Claude's voice-mode approach (cascade) rather than OpenAI's (audio-native model over WebRTC). Needs nginx upgrade headers + a deploy runbook (§ 12).
4. ~~**Platform**~~ — **answered 2026-11-18:** web only (`getUserMedia` + `AudioWorklet`). The iOS audio-session notes in § 8 apply once the native shell is in scope.
5. ~~**STT vendor**~~ — **answered 2026-11-18 (revised): Google Speech-to-Text**, streaming, newest multi-language Chirp model (§ 5.1). First answer the same day was ElevenLabs Scribe; dropped so the feature uses only Google + Anthropic. Not benchmarked.
6. ~~**Pronunciation assessment**~~ — **answered 2026-11-18: out of scope.** Was: in scope for phase 2, or out entirely?
7. ~~**Endpoint timeout**~~ — **answered 2026-11-18: fixed ~900 ms, extended ~600 ms after fillers and after repeated words** (§ 4.2). Not per-level, not a user setting. Was: fixed at ~900 ms, adapted per HSK level, or a user setting?
8. ~~**Model**~~ — **answered 2026-11-18: no benchmark.** Start with `claude-opus-5-5` at low effort (§ 6.1); change only if the live feature feels slow. Was: Opus 5.5 at low effort (the default here), or a faster/cheaper tier for voice? Measure both on time to first token + quality before deciding?
9. ~~**Daily cap**~~ — **answered 2026-11-18: measure cost first.** Measure STT + TTS + Claude cost per voice minute on PPE, then set the number. Was: how many voice minutes per user per day? Is it the same for every user?
10. ~~**Voice marks**~~ — **answered 2026-11-18: out of scope entirely.** Was: full-weight typed marks (Production/Recognition), reduced weight, or only after confirmation?
11. ~~**Minute points**~~ — **answered 2026-11-18: out of scope.** Was: should voice time earn them, and with what anti-farming rule?
12. ~~**Orb colours**~~ — **deferred to the owner's UX pass.** Placeholder: any framework tokens that avoid the utcm ramp and the Hydra charcoal/gold.
13. ~~**Privacy / retention**~~ — **answered 2026-11-18:** no learner audio; transcripts kept forever; TTL possibly later.
14. ~~**Persona**~~ — **answered 2026-11-18 (revised): one tutor persona, two voices** the learner chooses between: Google Chirp3-HD Achird (male) and Achernar (female). More voices: DEFERRED_WORK.md item 56. (Earlier the same day: one fixed ElevenLabs voice, BoHai; replaced when ElevenLabs failed the tone checks.)
15. ~~**Re-say attempts**~~ — **answered 2026-11-18: re-say practice is dropped entirely.** Was: store them (to show improvement over time), or keep them display-only? Display-only needs no table.
16. ~~**Re-say matching**~~ — **moot** (re-say dropped, Q15). Was: exact characters only, or also accept a homophone with the same pinyin (STT often picks a different character for the same sound)?
17. ~~**TTS vendor**~~ — **answered 2026-11-18 (revised): Google Chirp3-HD.** ElevenLabs was chosen first, then failed tone checks in rounds 1–2; Chirp3-HD passed every line in round 3 (§ 5.3).
18. ~~**TTS model + voice check**~~ — **superseded 2026-11-18**: `eleven_flash_v2_5` won round 1, but ElevenLabs was dropped for Google Chirp3-HD (Q17).
19. ~~**The failed mixed line**~~ — **answered 2026-11-18: Chinese tone/reading errors, not the English.** Multilingual: 截止日期 → jià zhī rì qí. Flash: 截止日期 → jiè zhì rì qì, 是星期五 → shí xíng qi wù. Expected jié zhǐ rì qī, shì xīng qī wǔ. The two-voice split stays dropped.
20. ~~**Tone errors in the tutor's voice**~~ — **answered 2026-11-18: switch to Google Chirp3-HD**, which read all 10 of the hardest test lines correctly without hints, where every ElevenLabs voice (with or without `language_code: "zh"`) made tone errors (§ 5.3).
21. ~~**Where the tutor-voice choice is stored**~~ — **answered 2026-11-18: a separate tutor setting**, a male/female toggle in the voice sheet, saved in browser storage on its own key, independent of the card narration voice (`useTTSSettings`).
