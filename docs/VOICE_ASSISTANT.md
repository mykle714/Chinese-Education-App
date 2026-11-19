# Voice Assistant (speech-to-speech tutor)

A hands-free, spoken conversation partner for the learner. You talk to it, it talks back.
The interaction model copies **Claude's voice mode** in the Claude apps. Three things are
specific to this app:

1. **Chinglish-native.** It expects mixed Chinese/English speech, understands it, and recasts
   it into Chinese.
2. **Flashcard-aware.** It knows the learner's cards, speaks at their level, drills the cards
   that are due, and can add new words as cards in the middle of a conversation.
3. **Level-shaped speech.** Sentence length, vocabulary and speaking rate follow the learner's
   utcm bands and HSK level.

**Status: DESIGN / DRAFT (2026-11-18). Nothing is built.** No tables, routes, flags or client
code exist yet. Every new table and column below is a **proposal awaiting the user's
approval** (see § 13, Question log).

**Decisions so far (owner, 2026-11-19):**
- **Spec first, build nothing yet.** Goal of phase 1 is to *see the feature working*.
- **UX is a placeholder.** Lay features out so they are naturally reachable; the owner will
  tune the look later. Do not spend design effort on polish.
- **Transcripts are saved and kept forever** for now. A TTL may come later (§ 11).
- **The learner's voice is never stored.** Only text is kept.
- **End-of-session card: yes.** Generic layout for now (§ 9.2).
- **Review is also for practice**, not read-only (§ 9.3).

**Depends on / references (existing code):**
- `server/services/anthropicClient.ts` → `getAnthropicClient` (the shared client; § 6.4 proposes a separate key)
- `server/services/TTSService.ts` (Google TTS + mp3 cache; § 5.3)
- `src/services/tts/CloudTTSProvider.ts`, `src/hooks/useTTSSettings.ts` (playback sinks + the Voice picker; [AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md))
- `server/services/FlashcardMarkService.ts` → `FlashcardMarkService.applyMark` (§ 7.3)
- `server/routes/vocabEntryRoutes.ts` → `/api/vocabEntries/addToLibrary` and the service behind it (§ 7.2)
- `server/routes/onDeckRoutes.ts` → `/api/onDeck/flpReadyCounts`, `OnDeckVocabService` (§ 7.1)
- `server/routes/dictionaryRoutes.ts` → `/api/dictionary/segment` (gsa; § 4.3)
- `server/contracts/featureFlags.ts` → `FEATURE_FLAGS` (§ 10)
- `dictionary_ai_usage` daily cap pattern (`server/dal/implementations/DictionaryDAL.ts`; § 6.5)

---

## 1. What "modeled on Claude's voice mode" means here

What we copy is the **user-visible behaviour** of Claude's voice mode. We do not know its
internal implementation and should not claim to. These are the behaviours to match:

| Claude voice mode behaviour | Our version |
|---|---|
| A full-screen voice view with an animated orb that shows *listening / thinking / speaking* | `VoiceSessionSheet`: a full-height sheet with one orb in three states (§ 8) |
| Hands-free by default: you just talk, and it detects when you've finished | Server-side endpointing (VAD + silence timeout; § 4.2). Push-to-talk is a toggle |
| **Barge-in**: talk over it and it stops speaking immediately | Client stops playback the moment VAD fires; server cancels the Claude stream and the TTS queue (§ 4.4) |
| Live captions of both sides | Rolling transcript under the orb. Chinese lines render as cpcd so they can be tapped (§ 8) |
| A choice of named voices | Reuses the existing per-language Voice picker (AUDIO_PLAYBACK.md § 6), plus a voice-mode speaking rate |
| The voice conversation is saved as a normal text conversation you can scroll back through later | Each session is saved as a transcript (§ 11), reopened from a session list, and doubles as practice material (§ 9) |
| Short, conversational replies: no markdown and no lists read aloud | A system-prompt rule plus a server-side markdown stripper before TTS (§ 6.2) |
| Tools can run mid-conversation, with a brief spoken "let me check" | Flashcard tools (§ 7). A short filler line is spoken only when a tool takes more than ~700 ms |

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
 └──────────────────────────────────────────────────────┘        │           └ VoiceToolExecutor → existing   │
                                                                 │               services (vet, det, marks)   │
                                                                 │       └ VoiceSessionDAL (transcripts, cap) │
                                                                 └────────────────────────────────────────────┘
```

**Why a cascade (STT → LLM → TTS) and not a native audio-to-audio model:**
- The Claude API takes text and images, not audio. A cascade is the only way to keep Claude
  as the brain, and Claude is the brain the user asked for.
- Each stage can be swapped, and we can see what passes between them. We **need the
  transcript text** anyway: it drives the cpcd captions, the gsa segmentation, card
  matching and the saved transcript.
- The app already runs two of the three stages (Google TTS, and Anthropic for the dictionary).

**The cost of this choice:** latency (§ 4.5), and the loss of prosody and tone information
at the STT boundary (§ 5.2). That second point matters most for a Mandarin tutor, and it
gets its own section.

### Layer placement (per [BACKEND_LAYERING.md](./BACKEND_LAYERING.md) / [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md))

| Component | Layer | Notes |
|---|---|---|
| `server/routes/voiceRoutes.ts` | Route | WebSocket upgrade on `/api/voice/session`. JWT checked during the upgrade handshake. **This is the app's first WebSocket**: see Q3 |
| `server/controllers/VoiceSessionController.ts` | Controller | Parses frames, owns the socket lifecycle, and calls nothing but the service |
| `server/services/voice/VoiceSessionService.ts` | Service | The per-session turn state machine (§ 4.1). Writes no SQL |
| `server/services/voice/stt/SpeechToTextProvider.ts` (+ one impl) | Service adapter | Streaming STT behind an interface, so the vendor can be swapped (Q5) |
| `server/services/voice/VoiceTTS.ts` | Service adapter | Sentence-chunked synthesis. Wraps `TTSService`'s Google call but **bypasses its word cache** (§ 5.3) |
| `server/services/voice/voiceTools.ts` | Service | Tool schemas + `VoiceToolExecutor`, which delegates to existing services |
| `server/services/voice/voicePrompt.ts` | Service | Builds the system prompt + learner profile block (§ 6) |
| `server/dal/implementations/VoiceSessionDAL.ts` | DAL | Transcripts, daily usage cap |
| `src/features/voice/` | Client feature | `VoiceSessionSheet`, `useVoiceSession` (socket + state machine), `micCapture.ts` (AudioWorklet), `voicePlayback.ts` |
| `src/api/voiceSocket.ts` | Client API | The one WS opener. It must take its auth from `authHeader()`-style storage and **not take a `token` parameter** (FRONTEND_LAYERING rule) |

---

## 3. The wire protocol (one WebSocket per session)

Binary frames carry audio. Text frames carry JSON control events. Event names are camelCase.

| Direction | Event | Payload |
|---|---|---|
| C→S | `start` | `{ language: 'zh', mode: 'freeTalk' \| 'drill' \| 'aboutWord', focusWord?: string, pushToTalk: boolean }` |
| C→S | *(binary)* | 16 kHz mono PCM16, 20 ms frames |
| C→S | `pttRelease` | push-to-talk only: end the user's turn now |
| C→S | `interrupt` | barge-in detected locally; stop speaking |
| C→S | `end` | user closed the sheet |
| S→C | `state` | `{ state: 'listening' \| 'thinking' \| 'speaking' }`, which drives the orb |
| S→C | `userPartial` / `userFinal` | `{ text, segments? }`: live caption of the learner. `segments` = gsa output on the final transcript |
| S→C | `assistantText` | `{ turnId, sentenceIndex, text, segments }`, sent just before that sentence's audio |
| S→C | *(binary)* | audio chunk, prefixed with `turnId` + `sentenceIndex` so stale audio can be dropped after a barge-in |
| S→C | `cardEvent` | `{ kind: 'added' \| 'marked', vocabEntryId, word }`, which drives a toast/chip in the sheet |
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
  off is the worst failure this feature can have. The value is tunable per user (Q7).
- **Semantic hold.** If the partial transcript ends in a filler or connective (`那个…`,
  `就是…`, `um`, `like`, `的`, `是`), extend the timeout by ~600 ms.
- **Push-to-talk** removes the guessing entirely. Offer it as a toggle for noisy places and
  for beginners.

### 4.3 What happens on `userFinal`

1. Run the gsa (`/api/dictionary/segment`'s service, called in-process) over the transcript to
   get word segments.
2. **Match each segment against the learner's vet.** The result goes to Claude in the turn
   annotations (§ 6.3) as `known` / `learning` / `notACard`. This lets the model praise use of a
   target word, and lets the client highlight it in the caption.
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
| Endpoint silence | 900 ms (deliberate, § 4.2) | Semantic hold can end a turn early on a clear sentence-final |
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
- Configure STT with both languages, zh primary. Most current streaming STT vendors support
  multi-language or code-switching recognition. **Which vendor to use is an open question (Q5).**
  Google Cloud is the default candidate because the app already holds Google credentials for
  TTS and handwriting.
- Supply **phrase hints** taken from the learner's Learning cards (the top ~200 by recency).
  This biases recognition toward the words they are trying to use, which is exactly where
  learner pronunciation is shakiest.
- Keep the STT's per-word confidence. Low-confidence Chinese words are passed to Claude as
  `[?]` annotations (§ 6.3), so it can say "did you mean 商店 shāngdiàn?" instead of answering
  a misheard sentence with confidence.

### 5.2 Tones: the STT boundary throws them away

A general-purpose STT outputs **characters**, which means it silently "corrects" a tone error
into the word the learner meant. So the cascade **cannot** give pronunciation feedback on tones.
- **Phase 1:** we accept this and say so in the UI. The assistant does not claim to grade
  pronunciation. Its system prompt forbids comments like "your tones were great".
- **Phase 2 (optional):** a dedicated pronunciation-assessment service, run on the audio of
  short drill answers only (not free talk), returning a per-syllable tone score. This is a
  separate vendor decision (Q6) and has some overlap with the Listening Practice game.

### 5.3 Speaking mixed-language replies (TTS)

The assistant's replies are mostly Chinese, with English glosses for beginners.
- **Split each sentence into script runs** (Han vs Latin) and synthesize zh runs with the
  learner's chosen zh voice and en runs with a matched en voice, then concatenate. A zh voice
  reading English (or the reverse) sounds poor and teaches the wrong pronunciation.
- **Speaking rate** follows level: ~0.8× at HSK 1–2, rising to 1.0× at HSK 5+. Overridable.
- **Cache policy:** `TTSService` caches whole clips keyed on (voice, text, pinyin). That suits
  word cards. Conversational sentences almost never repeat, so `VoiceTTS` **does not write**
  them to the cache, which would otherwise fill the PPE `tts_cache` volume with single-use
  clips. Single words the assistant reads out on their own *do* go through the cache.
- **Heteronyms:** when the assistant teaches a word with an ambiguous reading (行 háng/xíng),
  it emits the reading in a tool-free inline tag (`<py>háng</py>`). `VoiceTTS` passes that to
  the existing `pronunciation` path the card TTS already uses.

### 5.4 How the tutor responds to Chinglish (behaviour, system prompt)

- **Understand first, then recast.** Answer the *content* of what they said, then model the
  all-Chinese version once: *"……对，超市的菜很新鲜。你也可以说：我昨天去了**超市**，买了很多**蔬菜**。"*
- **One recast per turn, at most two new words.** Do not lecture.
- **Offer, don't force, a card:** if a recast introduced a word that is `notACard` for them,
  end with a short offer: *"要不要把'蔬菜'加到你的卡片里？"* A "yes" calls `add_card` (§ 7.2).
- **Code-switch down when they are lost.** Two confused turns in a row (detected by the model
  itself, or by an English "what?") switch the next reply to English-scaffolded Chinese.

---

## 6. The Claude side

### 6.1 Model and request shape

- Model: **`claude-opus-5-5`** (the default per the claude-api guidance), `output_config.effort:
  "low"`. Thinking cannot be disabled on Opus 5.5, so low effort is the latency control.
  Conversational turns do not benefit from deep reasoning. **A cheaper or faster model is a
  product and cost decision for the user (Q8)** and should be measured, not assumed.
- `client.messages.stream(...)`, with `eager_input_streaming: true` on each tool and tool
  inputs validated before execution.
- Include the server-side refusal `fallbacks` (`betas: ["server-side-fallback-2026-07-01"]`,
  `fallbacks: "default"`) and check `stop_reason` before reading content. On a final
  `refusal`, speak a fixed, neutral line rather than nothing.
- `max_tokens` around 1024. Spoken replies should be short. A reply that hits the cap is a
  prompt bug.

### 6.2 System prompt (stable and cached)

Contents, in this order (the order matters for the prefix cache):
1. Persona + scope: a patient Mandarin tutor, language practice only, polite refusal of
   off-topic requests.
2. **Voice rules:** plain sentences, no markdown, no lists, no emoji, no reading out of
   pinyin unless teaching a word, replies of 1–3 sentences unless the learner asks for more.
3. The Chinglish rules of § 5.4.
4. Tool-use rules (§ 7), including "never mark a card the learner did not actually attempt".
5. Honesty rule from § 5.2: no tone or pronunciation grading.

### 6.3 Learner profile and per-turn annotations

- **Session-start profile:** sent as a `cache_control` block after the system prompt. Contains:
  HSK level estimate, utcm band counts, and the learner's **known-word list** (Mastered +
  Comfortable, capped at ~1,500 words, most frequent first). The prompt says: *"Build sentences
  mostly from these words; introduce at most one word outside them per reply."* That is how
  "speak at their level" is implemented: a vocabulary constraint, not a vague instruction.
- **Per-turn annotations:** appended to each user turn as a short bracketed block, e.g.
  `[cards: 超市=learning, 菜=known; lowConfidence: 蔬菜]`.
- **State changes in the middle of a session** (a card was just added, a drill item was marked)
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

## 7. Flashcard integration (tools)

All tools run **server-side** in `VoiceToolExecutor`, scoped to the authenticated user, and
call existing **services** directly, not the HTTP routes. Each is a strict JSON schema
(`strict: true`, `additionalProperties: false`).

| Tool | What it does | Delegates to | Notes |
|---|---|---|---|
| `get_due_cards` | Up to N off-cooldown Learning cards, with dd + pinyin | `OnDeckVocabService` (the same candidate read the flp uses) | Used by `drill` mode and by "quiz me" |
| `lookup_word` | det entry: dd, pinyin, classifier, one example sentence | `DictionaryService` | Keeps the model grounded in **our** definitions, so its dd matches the card |
| `add_card` | Adds a det word to the learner's cards | the service behind `/api/vocabEntries/addToLibrary` | **Requires an explicit spoken yes in the same or previous turn.** Emits `cardEvent` |
| `mark_card` | Records a drill result | `FlashcardMarkService.applyMark` | See § 7.3. Very conservative |
| `get_card_progress` | utcm band + recent marks for one word | vet read | "How am I doing with 超市?" |
| `note_recast` | Records `{ learnerSaid, better, newWords[] }` whenever the tutor recasts a line | nothing: writes to the session's turn record | **Silent**: never mentioned aloud. Gives the transcript highlights and the end-of-session card structured data without a second Claude call (§ 9) |

### 7.1 Modes

| Mode | Entry | Behaviour |
|---|---|---|
| `freeTalk` | Menu popover row (Q2) | Open conversation, constrained to the learner's level. Card offers as in § 5.4 |
| `drill` | Deck Tower (Q2) | Assistant pulls `get_due_cards` and runs a spoken drill: "How do you say *supermarket*?" (production) or reads the word and asks for its meaning (recognition) |
| `aboutWord` | eip / deip "Talk about this word" button | Starts with `focusWord`. Explain, give example sentences, have the learner make a sentence of their own |
| `revisit` | "Practice again" on a saved session or its end card (§ 9.3) | Seeded with that session's recasts and new words. The tutor steers the conversation so the learner has to use them again |

### 7.2 Adding cards

`add_card` creates a normal vet row, so the card shows up in the td cards page, the Learning
deck and so on. It does not create a provisional row. A word the det does not know (not
discoverable yet, or not in the det at all) is **not added**: the tool returns `notInDictionary`
and the assistant says so. This follows the "every det entry becomes discoverable" pipeline
rule: voice mode must not bypass enrichment.

### 7.3 Marking cards: the risky part

The STT can mishear, so a mark from voice is weaker evidence than a tap in the flp.
- **Only in `drill` mode**, only for the card that was asked about, and only after the
  assistant has stated the verdict out loud ("Correct!" / "Not quite, it's 超市").
- Respect the **hard cooldown** enforced in `POST /api/flashcards/mark`. A mark the cooldown
  drops is fine; the tool reports `onCooldown` and the drill moves on.
- **Which mark track?** [MASTERY_REWORK.md](./MASTERY_REWORK.md) designs four typed tracks
  (Recognition / Production / Reading / Writing). A spoken English→Chinese answer is
  Production evidence and Chinese→English is Recognition. Whether voice marks count fully,
  count at reduced weight, or only count once the learner confirms them is **Q10**.
- The learner can say "undo that" → `FlashcardMarkService.undoMark`.

### 7.4 Minute points

Does voice time earn minute points (study ticks)? It probably should, since it is real study.
But it is easy to farm by leaving the mic open. Proposal: count only minutes with ≥ 2 user
turns that produced a non-empty transcript. **Q11.**

---

## 8. Client UX (placeholder: the owner will tune it)

The goal is that every feature is one obvious tap away, not that it looks finished.

- **`VoiceSessionSheet`**: a full-height sheet raised over the current page. The orb sits in
  the centre, with the transcript below it, and a bottom bar holding **End**, **Mute mic** and
  the **Push-to-talk / Hands-free** toggle. Rounded-edge + `COLORS.border` outline on all
  controls, per the design guidelines. The orb's three state colours must come from the colour
  framework. **They must not reuse the utcm mastery-ramp hues**, for the same reason Hydra
  Bubbles avoided them (Q12).
- **Transcript lines**: learner lines and assistant lines are both rendered as `CPCDRow`
  segments from the gsa output, so any word can be tapped to open the deip popup. A just-added
  card shows a small chip on its line.
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

## 9. Transcript, review and practice

The cascade produces text at every step, so the transcript is a by-product rather than extra
work. Phase 1 surfaces it in three places.

**Depends on:** `voice_turns` (§ 11), the `note_recast` tool (§ 7), the gsa
(`/api/dictionary/segment`), `CPCDRow`, the deip popup, `TTSService`.

### 9.1 Live captions (during the session)
As in § 8: both sides scroll under the orb as cpcd rows, and any word is tappable.

### 9.2 End-of-session card (generic for now)
Shown when the learner taps **End**. Built from data the session already holds. **No extra
Claude call.**

| Block | Source |
|---|---|
| Duration, number of turns | `voice_sessions` timing |
| Words added to cards | `cardEvent`s of kind `added` |
| "Better ways to say it" (up to 5) | `note_recast` records: learner's line ↔ the better version |
| Card words you used | the per-turn card matching of § 4.3 (`known` / `learning` hits) |
| Buttons: **Review transcript** · **Practice again** · **Done** | § 9.3 |

### 9.3 Saved transcripts: review *and* practice
Reached from a session list (placement is a UX call, Q2). Each saved session opens as a
scrollable conversation:

- **Read:** cpcd lines, tap any word → deip → add to cards. Recasts appear as the learner's
  version next to the better version. Words the STT was unsure of are underlined, so a
  mishearing is not mistaken for a learner error.
- **Listen:** tap an assistant line or a "better" version to hear it again. The audio is
  synthesized fresh by the existing TTS. **No learner audio exists to replay** (decision).
- **Re-say a line** (practice): a mic button on any assistant line or recast. This is a short
  capture that goes through **speech-to-text only** (no Claude, so it is fast and cheap). The
  result is compared to the target at character level and shown as a match/miss highlight.
  Same caveat as § 5.2: this checks the words, not the tones.
- **Practice again:** starts a new voice session in `revisit` mode (§ 7.1), seeded with this
  session's recasts and new words.

---

## 10. Feature flag and rollout

- New flag `voiceAssistant` in `FEATURE_FLAGS`, **OFF** by default. Per FEATURE_FLAGS.md, gate
  **every** entry point: the WS route mount in `server/server.ts`, the Menu row, the Deck Tower
  drill entry, and the eip "Talk about this word" button. A flip needs both containers rebuilt.
- Phase 1 ("see it working"): zh only (Spanish is paused). `freeTalk` + `aboutWord` + `revisit`, `add_card` + `note_recast`, saved transcripts with review and re-say practice, and the generic end-of-session card. No `mark_card`.
- Phase 2: `drill` mode + `mark_card`, minute points, an optional pronunciation-assessment vendor.
- Register the sheet in [ACTIVE_DUTY_PAGES.md](./ACTIVE_DUTY_PAGES.md) once it has an entry point.

---

## 11. Data (PROPOSED — needs approval, Q1)

| Table | Columns (proposed) | Why |
|---|---|---|
| `voice_sessions` | `id`, `userId`, `language`, `mode`, `focusWord`, `seededFromSessionId` (for `revisit`), `startedAt`, `endedAt`, `userSeconds`, `assistantSeconds`, `turnCount` | Session list, end card, usage dashboard, cap accounting |
| `voice_turns` | `id`, `sessionId`, `turnIndex`, `role` (`user`/`assistant`), `text`, `lowConfidenceWords` (jsonb), `recast` (jsonb, from `note_recast`), `interrupted`, `createdAt` | The saved transcript (§ 9) |
| `voice_ai_usage` | `userId`, `usageDate`, `seconds` | Daily cap, mirroring `dictionary_ai_usage` |

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
| No tone feedback (§ 5.2) | State it honestly; phase-2 assessment vendor |
| The endpoint cuts learners off mid-thought | Long default timeout, semantic hold, push-to-talk |
| Echo triggers barge-in on speakers | Browser AEC on; ignore VAD for the first ~150 ms of each assistant sentence |
| Cost runaway (open mic) | Per-user daily minute cap; the session auto-ends after ~60 s with no speech |
| First WebSocket in the stack: nginx, Docker and the PPE proxy need upgrade headers | `nginx.conf` needs `proxy_set_header Upgrade/Connection` for `/api/voice/`. **Needs a deploy runbook** when built |
| The model drifts off-level | Hard known-word list in the profile; spot-check transcripts during beta |

---

## 13. Question log (open — answer before building)

1. **Tables:** approve `voice_sessions`, `voice_turns`, `voice_ai_usage` and their columns (§ 11)? (Server-side storage is implied by the 2026-11-19 decision to keep transcripts.)
2. **Entry points:** Menu popover row, a Deck Tower platform, the eip button, all three, or something else? Does voice get its own footer tab, the way Claude puts voice next to the input?
3. **Transport:** add `ws` to the server (the first WebSocket in the stack), or use a managed realtime relay? The doc assumes raw `ws` on the existing Express server.
4. **Platform:** web (`getUserMedia`) only, or also the native shell? `docs/REACT_NATIVE_MIGRATION.md` exists, so if an RN move is coming, mic capture should be written against that.
5. **STT vendor:** Google Cloud (credentials already held), or another vendor with stronger zh/en code-switching? Should we benchmark on ~50 recorded learner Chinglish clips first?
6. **Pronunciation assessment** (tones): in scope for phase 2, or out entirely?
7. **Endpoint timeout:** fixed at ~900 ms, adapted per HSK level, or a user setting?
8. **Model:** Opus 5.5 at low effort (the default here), or a faster/cheaper tier for voice? Measure both on time to first token + quality before deciding?
9. **Daily cap:** how many voice minutes per user per day? Is it the same for every user?
10. **Voice marks:** full-weight typed marks (Production/Recognition), reduced weight, or only after confirmation?
11. **Minute points:** should voice time earn them, and with what anti-farming rule?
12. ~~**Orb colours**~~ — **deferred to the owner's UX pass.** Placeholder: any framework tokens that avoid the utcm ramp and the Hydra charcoal/gold.
13. ~~**Privacy / retention**~~ — **answered 2026-11-19:** no learner audio; transcripts kept forever; TTL possibly later.
14. **Persona:** one tutor voice/character, or let the learner pick (mirroring Claude's named voices)?
15. **Re-say attempts (§ 9.3):** store them (to show improvement over time), or keep them display-only? Display-only needs no table.
16. **Re-say matching:** exact characters only, or also accept a homophone with the same pinyin (STT often picks a different character for the same sound)?
