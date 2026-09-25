# Audio Playback

How the app makes sound: the one user-facing narration setting, the two output
sinks it selects between, and the rules every narration call site must follow.

**Status:** BUILT 2026-08-28, no migration (the setting is client-side only).
Gesture-unlock latching fixed the same day — the "audio dies until I restart the
app" bug, [§ 5](#-unlock-must-never-latch).
**Not yet verified on a physical iPhone** — see [§ 8](#8-what-still-needs-a-device).

---

## 1. The setting

There are **two** narration settings, and this section is about the first: *whether and where*
audio plays. The second — *who says it* — is the Voice picker, [§ 6](#6-which-voice--one-per-language-plus-a-gender-role).

Two ways in, one setting:

- **`/settings` → Narration** — three `OptionRow`s that EXPLAIN the states (their
  subtitles have room to say "pauses music" and "follows the silent switch").
- **`AudioModeChip`** — one header chip that CHANGES them mid-study: each tap
  advances off → passthrough → media → off. Rendered on the flp, scp, Bubble Match,
  Hydra Bubbles, Match Speed and Word Search headers.

Both go through `useTTSSettings`, so they cannot disagree, and both take their order
from `AUDIO_MODE_ORDER` — the picker lists it, the chip cycles it. Three states:

| State | Autoplay | Route | iOS silent switch | Other audio | Lock-screen controls |
|---|---|---|---|---|---|
| **Mute** (`off`) | no | (remembered) | — | — | — |
| **Default** (`passthrough`) | yes | media element | **ignored** — plays anyway | **pauses** music/video | **appear** |
| **Media** (`media`) | yes | Web Audio | **honored** — silent | **mixes**, undisturbed | none |

**Default: `passthrough`.** A learner who turns audio on wants to hear it, and
the worst failure is "I pressed play and nothing happened" because a hardware
switch was flipped. The cost is visible and self-explanatory; silence is not.

`off` (shown to the learner as **Mute**) is **not a third route** — it is autoplay turned off. A speaker button
still speaks in every state, including `off`. This is why the stored model has
two fields and the UI has three states:

```ts
// src/hooks/useTTSSettings.ts
interface TTSSettings { autoplay: boolean; route: 'passthrough' | 'media' }
type AudioMode = 'off' | 'passthrough' | 'media'   // the UI projection
```

Selecting Mute clears `autoplay` and **leaves `route` untouched**, so an
off → on round trip returns to the route the user picked.

### The chip

`src/components/AudioModeChip.tsx` is self-contained — it reads the setting itself
rather than taking value/onChange props, so no surface can drift in label, icon or
cycle order, and adding it to a new header is one tag. A surface that must hide it
(Bubble Match on a reading run, where hearing the word hands over the pronunciation
being tested) simply does not render it.

Each state shows a speaker glyph plus one word: `volume_off`/**mute** ·
`volume_up`/**default** · `graphic_eq`/**media**. The glyphs make it legible as an
audio control before the label is read; the labels are the `/settings` picker's
option titles, one for one, so nobody has to work out that the chip and the picker
are the same setting.

**Two labels are copy, not the stored value** — `off` and `passthrough` are
persisted contracts and do not move:

- **`mute`, not `off`.** `off` names the setting's state; `mute` names what the tap
  does to the phone in the learner's hand.
- **`default`, not `passthrough`.** It *is* the default route
  (`DEFAULT_SETTINGS.route`), and "passthrough" names the iOS audio-session
  mechanism — accurate, but nothing a learner can act on. The subtitle explains.

⚠️ **Verify every glyph name against Material Symbols.** `multitrack_audio` was the
first choice for `media`; it is a Material *Icons* name absent from the Symbols face,
so it rendered as the raw string `MULTITRACK_AUDIO` in the flp header — see
`src/components/Icon.tsx`.

Header width is the cheaper thing to spend than clarity: `PageHeader` ellipsizes its
title and holds `rightContent` at `flexShrink: 0`, so a wider chip costs deck-name
characters on the flp and nothing else. The labels were once shortened to "loud" and
"mix" purely for width, and that is the failure mode to avoid — **a label must be a
word the learner also sees on `/settings`, never an abbreviation invented for the
chip.**

The chip is **fixed-width**, sized to its own longest label (`default`, 7
characters at 8px, so 5.6ch, plus a fixed allowance for the glyph) via `HeaderCycleChip`'s `widthCh` and measured in `ch` against the mono
face, plus `CYCLE_CHIP_SLACK_CH` (**4ch**) of breathing room — `widthCh` alone is the
label's exact advance width, which both clips the last glyph to subpixel rounding and
reads as cramped inside the chip's radius. It therefore does not resize as the user taps
through, and the controls to its left hold still under the thumb.
**A label longer than the comfortable width renders one size down, and only that
label does.** `default` is seven characters and would otherwise size the chip in all
three states, including the two the learner is looking at most of the time. Rather
than abbreviate it — which the label rule above forbids — `cycleChipFontPx`
(`src/components/cycleChipSizing.ts`) shrinks just that word far enough to fit, down
to a floor of **8px**, past which the chip widens instead. `mute` and `media` stay at
the full 10px. `cycleChipWidthCh` measures the table by the same rule, so the width
asked for is what the labels actually occupy; callers pass their whole label table to
it rather than computing a character maximum themselves.

The **icon is pinned to the chip's left edge** and the label centres in the space
that is left, rather than the pair centring together. The icon is the chip's anchor —
what says at a glance which control this is, before the word is read — and an anchor
that slides as the label changes length is not one. It also gives the label a
constant-size box in every state, which is what keeps a shrunken word optically
centred. (The immersive-world volume chip was the other control laid out this way;
it was removed on 2026-09-23 — [IMMERSIVE_WORLD.md](./IMMERSIVE_WORLD.md) § 4c.)

`MODE_LABEL_WIDTH_CH` derives the count from `MODE_CHIP`, so adding or renaming a
state cannot silently bring the jump back.

The `ariaLabel` carries the full meaning, since a screen reader gets neither a glyph
nor any hint that the control cycles.

### ⛔ Changing the mode must not make a sound

Tapping the chip changes a setting; it is not a request to hear a word. The speaker
button is.

Every automatic-narration effect is gated on `autoplay`, which made putting
`tts.autoplay` in such an effect's **dep list** look harmless — but it re-runs the
effect on the off → on edge, so switching to `default` (or `media`) narrated the card
already on screen, and on the scp replayed the entire on-deck pack. Both effects now
key on **content identity only** (`currentEntry?.id`, `currentPack?.packKey`).

The opposite direction still has to work — turning audio off must stop whatever is
mid-utterance, or "mute" leaves a word playing. That lives **once**, in `useTTS`,
edge-triggered on the on → off transition so a deliberate speaker press while muted
is not cancelled out from under the user. Surfaces get it for free and must not
re-add the flag to a dep list to obtain it.

**The one control that does make a sound is the Voice picker** (§ 6), and it does not break
this rule: its sample plays through `autoSpeakSentence`, so it is gated on `autoplay` like every
other automatic utterance and a muted phone stays muted. The rule forbids a settings tap
narrating *the card already on screen*; auditioning the voice you are choosing is the control
doing its job.

*Code:* `src/hooks/useTTS.ts` → the `wasAutoplayOnRef` effect;
`src/features/flashcards/FlashcardsLearnPage/FlashcardsLearnPage.tsx` → the
`chineseVisible` narration effect; `src/features/discover/SortCardsPage.tsx` → the
pack autoplay effect.

`HeaderCycleChip` (`src/components/PageHeader.tsx`) is its skin: the same `.lhd .tg`
chip as `HeaderToggleChip` but with **no `aria-pressed`**, which is boolean and
cannot describe three states.

### One value, not one per hook instance

`useTTSSettings` is backed by a **module-level store** read through
`useSyncExternalStore`, not by `useState`. `useTTS` is called from ~13 components
and several are mounted at once — on the flp, the header's `AudioModeChip` and the
page's card-flip narration effect are two separate hook instances of the same
setting.

With per-instance `useState` they diverged on every tap: the chip flipped its own
copy to `off` and wrote localStorage, while the page's copy stayed `autoplay: true`
and kept narrating (and kept lighting the speaker spinner) until the page
remounted. The chip *looked* obeyed and wasn't. Any future knob added to
`TTSSettings` inherits the shared store for free; **do not reintroduce local state
for it.** A `storage` listener adopts writes from other tabs (that event does not
fire in the writing tab, so `setSettings` notifies its own listeners directly).

*Code:* `src/hooks/useTTSSettings.ts` → `getSnapshot`, `subscribe`, `setSettings`.

*Code:* `src/hooks/useTTSSettings.ts` → `TTSSettings`, `AudioMode`,
`AUDIO_MODE_ORDER`, `useTTSSettings` (`mode`/`setMode`/`cycleMode`);
`src/components/AudioModeChip.tsx` → `MODE_CHIP`, `MODE_LABEL_WIDTH_CH`; `src/components/PageHeader.tsx` →
`HeaderCycleChip`; `src/components/cycleChipSizing.ts` → `cycleChipFontPx`, `cycleChipWidthCh`; `src/pages/SettingsPage.tsx` → `AUDIO_MODE_COPY`.

---

## 2. Why two sinks, and why not three

On iOS the sink decides three behaviors **at once**, and the web platform does
not let them be chosen independently:

- **`passthrough` → `HTMLAudioElement`.** WebKit classifies a media element as
  the Playback audio category, so it ignores the ring/silent switch. Inseparably,
  it also takes audio focus (the user's music pauses) and registers with the
  system "Now Playing" center, so lock-screen transport controls appear over a
  one-word pronunciation clip.
- **`media` → Web Audio `AudioBufferSourceNode`.** Not a media session, so it
  mixes with other audio and shows no lock-screen controls — but iOS silences it
  when the ring/silent switch is off.

**There is no third option.** The platform exposes no `mixWithOthers` for the
Playback category, so "ignores mute" and "doesn't disturb music" cannot be had
together. That trade *is* the setting.

**Android:** the mute half is moot — Android's silent toggle mutes the *ringer*
stream, not the *media* stream, so audio is audible on silent either way. The
audio-focus half (whether music keeps playing) still applies, so the two routes
still differ there.

**History.** The app played through `HTMLAudioElement` until **2026-06-13**
(commit `2a11641`), which switched to Web Audio purely to kill the lock-screen
controls, accepting silent-switch obedience as a documented trade-off. The route
became a user setting on 2026-08-28; that old behavior is now `passthrough`.

*Code:* `src/services/tts/CloudTTSProvider.ts` → `setRoute`, `playViaElement`,
`playViaWebAudio`.

---

## 3. Caching — one fetch, two derived caches

A word is fetched **at most once per session** regardless of route:

```
blobCache   Map<key, Promise<Blob>>          ← the only network path
  ├── bufferCache Map<key, Promise<AudioBuffer>>   'media':       decoded PCM
  └── urlCache    Map<key, string>                 'passthrough': object URLs
```

The Blob is the source of truth because **`decodeAudioData` detaches the
ArrayBuffer it is given** — you cannot decode a buffer and keep the bytes. A Blob
hands out a *fresh copy* on every `.arrayBuffer()` call, so decoding for one sink
leaves the other sink's source intact. A route switch therefore costs at most a
re-decode, never a round trip.

`urlCache` is capped at `MAX_CACHED_URLS` (64) and **revokes on eviction**:
`createObjectURL` pins its Blob for the life of the document otherwise, which is
a real leak across a long study session.

All three caches share `bufferKey` — `${shortLang}:${text}:${pinyin}` — so
`prefetch()` and `speak()` always land on the same slot. The pinyin component is
load-bearing: the server uses it as an SSML `<phoneme>` hint, so 中 zhōng and 中
zhòng are genuinely different audio.

*Code:* `CloudTTSProvider` → `getOrFetchBlob`, `getOrDecodeBuffer`,
`getOrCreateUrl`, `evictOldestUrls`, `bufferKey`.

### 3a. `prepare()` — synthesize and decode WITHOUT playing (2026-09-06)

Every other entry point plays and forgets: `speak()` fetches, decodes and starts the clip as
one call, resolving when the audio finishes. There is no moment at which the duration is known
and playback has not started — and that moment is exactly what the Immersive World needs, where
**the audio is the clock** and a line's typewriter reveal is spread across the clip's own
duration ([IMMERSIVE_WORLD.md](./IMMERSIVE_WORLD.md) § 6.4).

`prepare(req)` warms the same caches `speak` reads and returns the clip's duration in **ms**,
or `null`. So prepare-then-speak costs one synthesis, not two.

Three things about it are deliberate:

- **It decodes even on the `passthrough` route**, where playback goes through the `<audio>`
  element and never touches the decoded buffer. An element cannot report a duration without
  loading, both sinks derive from the same cached Blob, and without this every learner on the
  default route would silently lose the audio-paced reveal.
- **`null` is an answer, not a failure** — it means *pace it on a timer instead*. It is returned
  when autoplay is off, when the cloud call fails, and when there is no decoder.
- **It does not cancel in-flight playback** and does not bump `generation`: preparing the next
  line while the current one is still being spoken is the normal case.

`WebSpeechProvider.prepare` always returns `null` — `speechSynthesis` synthesizes inside the OS
and exposes no buffer and no duration. That is not a gap to fill: it is why the browser voice
can only ever drive the timer-paced reveal.

Its companion is `TTSRequest.stamp`. `POST /api/tts/synthesize` stamps `det."ttsVoice"` on a
cache miss, which is meaningful for a headword and a guaranteed-zero-row `UPDATE` for a
sentence; `stamp: false` skips it. Opt-OUT, so no existing caller changed behaviour.

*Code:* `CloudTTSProvider` → `prepare`; `useTTS` → `prepareSentence`;
`server/controllers/TTSController.ts` → `synthesize`.

---

## 4. Autoplay vs. manual — the rule every call site follows

`useTTS` exposes **two pairs** of narration functions. Which one you call is the
whole contract:

| Call | Use when | Gated by autoplay? |
|---|---|---|
| `speak(entry)` / `speakSentence(text, pinyin)` | the user pressed a speaker button | **no** — always speaks |
| `autoSpeak(entry)` / `autoSpeakSentence(text, pinyin)` | the app decided to speak | **yes** — no-op when autoplay is off |

The gate lives inside the hook, so a call site never re-checks the setting.
Automatic sites today: the flp card-flip narration, the scp on-deck pack
sequence, Word Search's find/replay plays, Memory Map's answer feedback, Speed
Reading's per-round clue (`SpeedReadingPage` → `autoSpeak`, distinct from the
manual `speak` its speaker button uses), and the bubble games' reveal. **A
game-tile tap counts as automatic**, not manual — only a dedicated speaker button
breaks the silence of `off`.

> ⚠️ **A speaker button must not be HIDDEN in `off` either.** Because the manual pair
> always speaks, a surface that renders its speaker button only when narration actually ran
> takes away the learner's one way to hear a line at exactly the moment they have no other.
> Immersive World's speech bubble did this until 2026-09-09 — `IWBubble.replayable` meant "a
> clip was decoded", so muting the app removed the button from every NPC line. It is now
> shown on every line the learner did not speak themselves, and the press pays the synth
> round-trip when nothing was cached (see IMMERSIVE_WORLD.md § 14 Q41).

> Calling the manual pair from an automatic site is a real bug, not a style slip:
> it plays audio in `off` **and** lights the speaker button's spinner, because
> `speakingKey` is only ever set for a narration that actually runs. Speed
> Reading's round-landing effect did exactly this until 2026-08-28.

### The fallback rule

`WebSpeechProvider` (`speechSynthesis`) is an **OS sink we cannot route**: on iOS
it ignores the silent switch and takes audio focus, i.e. it always behaves like
`passthrough`. So when cloud TTS fails:

- in `passthrough` — fall back freely; the browser voice matches the mode.
- in `media` — fall back **only for a manual press**. An automatic utterance
  stays silent rather than talking over the user's music with the phone on
  silent.

This path is not hypothetical: it was live for three days during the 2026-08-21
Google `BILLING_DISABLED` outage, when every disk-cache miss fell back to the
browser voice with no signal ([DEFERRED_WORK.md](./DEFERRED_WORK.md) item 12).

*Code:* `src/hooks/useTTS.ts` → `SpeakTrigger`, `speakText`, `autoSpeak`,
`autoSpeakSentence`.

---

## 5. Gesture unlock (iOS autoplay policy)

WebKit only lets audio start from inside a real user-gesture task, and `speak()`
awaits a network fetch first — which loses gesture context. Both sinks are
therefore primed on the **first pointerdown anywhere on the page**, and they need
*different* priming:

- **Context:** `resume()`, plus a 1-sample silent buffer (some WebKit builds need
  an actually-started source).
- **Element:** `play()` on a muted 1-frame silent MP3 data URI, so iOS marks the
  element user-activated. Per-utterance audio is swapped in via `src =` on the
  **same** element, because the activation lives on the element.

`unlock()` primes **both** regardless of the active route, so a later route
switch never has to hunt for a fresh gesture.

> ⚠️ Call sites that begin playback only *after* an await (a game's first
> drag-triggered narration) must call `tts.unlockAudio()` synchronously from an
> earlier guaranteed gesture — a start or level button. There must be no `await`
> between the gesture and that call. Existing examples: `SpeedReadingPage`,
> `MemoryMapPage`, `BubbleMatchPage`, `HydraBubblesPage`.

### ⛔ Unlock must never latch

**Priming is not a one-time event, and no code on this path may treat it as one.**
The two sinks differ, and the difference is the whole rule:

| Sink | Activation | Revoked by the OS? | May latch? |
|---|---|---|---|
| Element (`passthrough`) | user-activation flag on the element | no — durable for the document's life | **yes** — `elementActivated`, set only when `play()` *resolves* |
| Context (`media`) | `AudioContext.state === 'running'` | **yes**, constantly | **no** — the state itself is the only truth |

iOS suspends the shared `AudioContext` every time it takes audio focus: an
incoming call, an app switch, the screen locking. It does **not** resume on the
way back, and WebKit only accepts `resume()` from inside a gesture's call stack —
which `speak()` can never be in, because it awaits the fetch/decode first.

So the app's *only* recovery is the global `pointerdown` listener, and it must be
**persistent, not `{ once: true }`**, with `unlock()` **repeatable, not latched**.
The fast path costs one `ctx.state` read per tap. This is the same shape
`markArpeggio.getContext()` has (and that `gameSounds.getContext()`, its deleted
predecessor, always had).

**This was a real bug, fixed 2026-08-28.** `unlock()` held an `audioUnlocked`
flag that made it a no-op for the rest of the session, and the listener was
`{ once: true }` — so the session's single recovery was spent on whatever the
user tapped first, typically long before anything went wrong. After one
interruption the context stayed suspended, every `speak()` returned silently from
`playViaWebAudio`'s not-running guard, and **the only cure was reloading the app**.
Game blips kept working throughout, which is the diagnostic signature. A
redundant second latch (`audioUnlockedRef` in `SortCardsPage`) was removed in the
same pass.

Two supporting details:

- **`isContextRunning`** compares against `'running'` through a widened `string`,
  because WebKit has a fourth state — `'interrupted'` — that the DOM
  `AudioContextState` union omits, and it is exactly the state a phone call
  leaves behind. A `!== 'suspended'` check would call it healthy and schedule a
  source that never plays, hanging the caller until its watchdog.
- **`playViaWebAudio` awaits its `resume()`** instead of firing and forgetting.
  Desktop and Android grant it without a gesture, so that call recovers itself
  rather than dropping one utterance. iOS refuses, and there the next tap is the
  fix. The await is a fresh cancellation window, so the generation is re-checked
  after it.

A `visibilitychange` handler also attempts a resume on return to the foreground.
It is best-effort by construction — not a gesture — and exists only so the
platforms that allow it need no tap at all.

*Code:* `CloudTTSProvider` → `ensureUnlockListener`, `handleGesture`,
`handleVisibilityChange`, `unlock`, `unlockContext`, `unlockElement`,
`isContextRunning`, `playViaWebAudio`, `SILENT_MP3`.
*Tests:* `src/__tests__/ttsUnlockRecovery.test.ts` — pins the three repeatability
properties (persistent listener, mid-session resume, no latch on a refused
`play()`). Verified to fail against the pre-fix logic.

---

## 6. Which voice — one per language, plus a gender role

**Status:** BUILT 2026-09-09, no migration.

Narration resolves a voice from **two** axes, both server-side:

| Axis | Where it comes from |
|---|---|
| **Language** | The learner's `selectedLanguage`, mapped by `useTTS` → `toTTSLang` and resolved by `TTSService.voiceForLang`. Keeps a Spanish word off the Mandarin voice. |
| **Role** (`TTSVoiceKey`) | The **caller**: `'default'` \| `'male'` \| `'female'`, defaulting to `'default'`. Exists so an Immersive World NPC drawn as a man is voiced as a man ([IMMERSIVE_WORLD.md](./IMMERSIVE_WORLD.md) § 6.4a). |

The provider (Google Cloud TTS) carries both genders in every locale we use. Voice
names verified against `GET texttospeech/v1/voices` on our own service account,
**2026-09-09** — the genders below are the provider's `ssmlGender`, not the docs':

| Language | `default` / `female` | `male` |
|---|---|---|
| `zh` (`cmn-CN`) | `cmn-CN-Wavenet-A` | `cmn-CN-Wavenet-B` |
| `es` (`es-US`) | `es-US-Neural2-A` | `es-US-Neural2-B` |
| `en` (`en-US`) | `en-US-Neural2-C` | `en-US-Neural2-D` |

Each cell is overridable via env (`GOOGLE_TTS_VOICE_ZH`, `…_ZH_MALE`, and the `ES`/`EN`
equivalents), so swapping a voice is a restart, not a deploy.

Three deliberate choices in that table:

- **`'female'` resolves to the SAME voice as `'default'`.** The disk cache is keyed on the
  resolved voice **name**, not the role, so this makes every MP3 cached before this feature
  shipped still a hit — and it means the flashcard voice and a female NPC are one voice rather
  than two that merely sound alike.
- **The male voice is from its language's own family** (`Wavenet` with `Wavenet`, `Neural2`
  with `Neural2`), so a cast does not mix synthesis generations mid-conversation.
- **No `Chirp3-HD-*` voices**, though they sound better and Mandarin alone has 30 of them
  (16 male / 14 female — enough for one voice per NPC). They are a different price tier and
  **do not accept SSML**, which would silently drop the pinyin `<phoneme>` hint that keeps a
  polyphone's audio matching the reading on screen (§ 3, `buildPinyinSsml`). Read that
  function before putting a Chirp3 voice in the `zh` column.

**`en-US-Neural2-C` is a FEMALE voice.** It is the *language* fallback for an unknown
language — not a gender-neutral one. Every voice this app used before 2026-09-09 was female.

### The learner's choice — `/settings` → Voice (BUILT 2026-09-09)

The role is not only iw's. `/settings` carries a **Voice** picker — two `OptionRow`s, *Female*
and *Male* — that sets the voice for everything the app reads TO the learner: flashcards,
example sentences, game reveals. It is stored in the same `tts.settings` localStorage blob as
`autoplay` and `route` (`TTSSettings.voice`, typed `NarrationVoice`), so it needs no migration
and no column, and it shares the store that keeps every mounted `useTTS` in agreement (§ 1).
It is **per device**, not per account — the trade accepted for shipping it without a column.

| | |
|---|---|
| **Two options, not three** | `NarrationVoice` is `'female' \| 'male'`. `TTSVoice`'s third value, `'default'`, resolves to the *same provider voice* as `'female'`, so offering it would be one setting with two names for one outcome. The stored value says what the learner picked rather than "whatever we ship", and because `'female'` is a member of `TTSVoice` it crosses the wire unchanged and shares the default voice's cache slots. |
| **It applies per language** | Picking *Male* gets the male voice of whatever they are studying, not one fixed voice. The language axis is still resolved from `selectedLanguage`. |
| **It is a DEFAULT, not a floor** | `useTTS` uses it whenever the caller names no voice. A caller that names one — only iw, per speaking character — wins, because an NPC's voice belongs to the character, not to the learner's reading preference. The picker's subtitle says so ("Characters in a story keep their own voices"). |
| **Its own `SettingsSection`** | Not a second radio group inside Narration: the page's pattern is one control per card, and two unlabelled groups in one card read as one broken group. It sits directly under Narration because it answers the other half of the same question. |

**Tapping an option plays a sample** — 你好 / *Hola* in the voice just chosen — because for a
voice control, hearing it is the only way to make the choice. It plays through
**`autoSpeakSentence`, the AUTOMATIC path**, so it obeys the mode set in the card directly
above it: silent in **Mute**, and on whichever route is selected. That is what keeps § 1's
⛔ *changing the mode must not make a sound* rule intact where it actually matters — a muted
phone stays muted — and it is why the sample is not routed through the manual `speakSentence`,
which would speak in every mode.

The sample is a fixed greeting rather than a word from the learner's deck: one short synthesis,
identical audio for both voices so they can be compared, and no vocabulary they may not have
met. The zh sample carries its pinyin, for the same reason every other narration call does
(§ 3). ⚠️ The `onChange` handler passes the **new** value explicitly to
`autoSpeakSentence` rather than reading the store it just wrote — the callback closes over the
previous render's voice, so relying on the write would demo the voice being replaced.

**⛔ A non-default voice must not stamp `det."ttsVoice"`.** That column is shared dictionary
data meaning "this row has cached audio in the voice the app reads with", so one learner
picking *Male* must not rewrite it for everybody. `TTSController` skips the stamp unless
`TTSService.isDefaultVoice(lang, voiceKey)` — the check lives in the service because only it
knows `'female'` and `'default'` are the same voice. Before the picker existed this could not
happen (iw was the only non-default caller and it already passes `stamp: false`), which is
exactly why the guard had to be added *with* the picker.

**Consequence worth knowing: the server's pre-warm only covers the default voice.**
`OnDeckVocabService.prewarmAudio` synthesizes each on-deck card with no voice role, so a
learner on *Male* misses the disk cache on the first play of each word and pays one on-demand
synthesis (~0.2–0.4 s) — after which it is on disk forever and in the session's buffer cache.
`hasAudio` likewise reflects the default voice's success, which is a fine proxy: a word that
fails to synthesize in one voice fails in both. Making the pre-warm voice-aware would need the
preference on the server, which is the localStorage trade above.

### Role, never a voice name, on the wire

`POST /api/tts/synthesize` accepts `voice: 'default' | 'male' | 'female'` and nothing else;
`toTTSVoiceKey` narrows anything unrecognized back to `'default'`. A provider voice **name**
on the wire would let any authenticated caller synthesize through an arbitrary — and
arbitrarily priced — Google voice on our billing account, and would turn a client typo into a
provider 400 instead of a default. The role → name mapping stays entirely in `TTSService`.

### ⚠️ The voice is part of every cache key

It is folded into both caches, and it has to be in both:

- **Server**, `TTSService.cacheKey` → `sha256(provider:voiceName:text:pinyin)`. Adding a voice
  therefore *adds* cache slots and never invalidates one.
- **Client**, `CloudTTSProvider.bufferKey` → `lang:voice:text:pinyin`. Without the voice here,
  two NPCs saying the same line share one in-session clip and **whoever speaks second is voiced
  by whoever spoke first** — a bug that appears only on the second utterance and reads as the
  whole feature not working.

The corollary for `prepare()`-then-`speak()` callers (§ 3a): **pass the same voice to both.**
A mismatch measures one clip's duration and plays another, which is precisely what iw's
audio-as-clock contract cannot survive, and it pays for a second synthesis to do it.

### The browser fallback does not carry the role

`WebSpeechProvider` picks an OS voice by language tag and exposes no gender control that can be
relied on across browsers, so `useTTS` deliberately does **not** forward `voice` to it. A
wrong-gendered voice on the already-degraded fallback path is cosmetic; refusing to speak would
not be.

*Code:* `server/services/TTSService.ts` → `TTSVoiceKey`, `TTS_VOICE_KEYS`, `toTTSVoiceKey`,
`voiceForLang`, `voiceTag`, `cacheKey`, `synthesize`; `server/controllers/TTSController.ts` →
`synthesize`; `src/services/tts/types.ts` → `TTSVoice`, `TTSRequest.voice`;
`src/services/tts/CloudTTSProvider.ts` → `SynthArgs`, `bufferKey`, `getOrFetchBlob`;
`src/hooks/useTTS.ts` → `speakText`, `speakSentence`, `autoSpeakSentence`, `prepareSentence`,
`prefetchSentence`; `src/features/immersiveworld/play/useIWSceneRuntime.ts` → `voiceFor`.

---

## 7. What this setting does NOT cover

**The answer-feedback sound** (`src/services/audio/markArpeggio.ts`) is
deliberately **out of scope**. It always uses media semantics: it honors the iOS
silent switch and never disturbs other audio. `passthrough` therefore means "all
*narration* bypasses mute", not all app audio, and the `AudioModeChip`'s **Mute**
does not silence it.

Consequence worth knowing: it owns a **second `AudioContext`** with its own unlock
state, unaware of the TTS one, and therefore its own persistent `pointerdown`
listener (§ 5 — repeatable, never latched). If narration and effects are ever
unified, routing this sink through the element would need the clips to be handed
to an `<audio>` element as object URLs; it now ships real audio files rather than
oscillators, so unlike the old blips it *has* bytes to hand over. That is the
spike.

### The arpeggio

Four marimba notes — **C · E · G · C↑** — walk up on consecutive **correct**
marks; the fifth correct mark starts again on the low C. A **wrong** mark plays a
separate truncated low C, cuts any notes still ringing, and resets the ladder. The
rising pitch is the feature: a single blip says only "right", the pitch says
"right, and that's your fourth in a row", with no eye movement.

| | |
|---|---|
| **Assets** | `src/assets/Marimba/Arp/{C,E,G,C-high}.mp3` + `src/assets/Marimba/wrong.mp3` — mono 128kbps, ~22KB each, ~108KB total, peak-normalized to −1.5 dBFS so the four notes are level with one another. The `.wav` masters beside them are the source; they are 24-bit stereo with **bit-identical channels**, so the mono downmix is lossless. |
| **Fired from** | `src/api/flashcards.ts` → `markFlashcard`, on the first line, **before** the request — but **only** when `request.surface` is in `ARPEGGIO_SURFACES`: **`match-speed` and `bubble-match`**. Every other surface (flp, Hydra Bubbles, Memory Map, Speed Reading, Word Search, Practice Writing) marks silently — narrowed by request on 2026-09-13. A new surface is silent by default. |
| **Why pre-`await`** | No network round-trip between the tap and the note, and the call is still inside the tap's user-gesture stack — the only place iOS will start audio. |
| **Suppressed marks** | Still sound correct. The note follows the learner's **answer**, not the stored mark: cooldown suppression (docs/HYDRA_BUBBLES.md § 8) is invisible server bookkeeping and is only known *after* the response anyway. |
| **Streak scope** | Module-level counter, reset on mount **and** unmount of `MatchSpeedPage` and `BubbleMatchPage` by `useMarkArpeggio()` (`src/hooks/useMarkArpeggio.ts`). Leaving Match Speed mid-arpeggio and opening Bubble Match starts again on the low C. |
| **Loading** | All five clips are fetched at module load and decoded on the first `pointerdown`, so the first answer of a session is not silent. A call that beats the decode plays late rather than being dropped. |

**Batching surfaces must stay off the whitelist.** Until 2026-09-13 every surface
played the sound, and two needed a per-call opt-out (`MarkFlashcardOptions.silent`,
since deleted): the flp working loop **retries** a failed mark up to three times
(`useWorkingLoop` → `markCard`), and Word Search's "No Pinyin" board posts one find
on **two** tracks (`WordSearchPage` → `markWordFound`). Both are now silent, so the
option had no callers. Adding either back to `ARPEGGIO_SURFACES` would play a chord
and skip rungs — re-introduce a per-call opt-out first.

Memory Map used to call `playMarkArpeggio(false)` directly on a wrong non-target tap
(which emits no mark); that call went with the surface. `markFlashcard` is now the
arpeggio's only caller.

### History

This replaced `src/games/runtime/gameSounds.ts` (deleted 2026-09-05), two WebAudio
oscillator blips used only by Speed Reading and Memory Map. That module was
synthesized specifically to avoid shipping assets and paying a fetch before the
first sound — an argument that does not survive wanting a real instrument. The cost
is paid down instead by mono mp3s two orders of magnitude smaller than the masters,
a module-load fetch, and a play-late-rather-than-drop path. The flp and Practice
Writing had **no** answer sound at all before this.

There is also **no full-mute state** any more. The old master switch
("Speak Chinese words aloud", `TTSSettings.enabled`) silenced everything
including speaker buttons; it was removed when the three states landed. The
phone's own mute switch covers the case in `media` mode.

---

## 8. What still needs a device

Everything here typechecks and the suite passes, but the behavior that motivates
the whole feature is **not observable on desktop or headless**:

- Does `passthrough` actually bypass the iOS ring/silent switch? (The premise
  comes from WebKit's Playback classification and the repo's own 2026-06-13
  finding, not from a measurement on current iOS.)
- Do the lock-screen controls reappear in `passthrough`, and stay away in `media`?
- Does `media` still mix with background music?
- Does the element sink's unlock survive a route switch mid-session?
- **Does narration survive an interruption?** Take a call (or play a video in
  another app) mid-session, come back, and press a speaker button. This is the
  2026-08-28 fix in [§ 5](#-unlock-must-never-latch); the repeatability half is
  unit-tested, but only a device shows whether iOS actually grants the resume on
  the following tap.

Test on a physical iPhone with the ringer switch OFF and music playing.

---

## 9. Migration from the pre-unification settings

Three separate flags collapsed into `autoplay`:

| Old | Key | Now |
|---|---|---|
| `TTSSettings.enabled` (master mute) | `tts.settings` | deleted; `false` → `autoplay: false` |
| `FlashcardLearnSettings.autoplayChinese` (flp + Bubble Match + Hydra + Match Speed) | `flashcard.learn-settings` | deleted; `false` → `autoplay: false` |
| `DiscoverSettings.autoplay` (scp) | `discover.settings` | hook **deleted** (it held nothing else); `false` → `autoplay: false` |

Any explicit `false` migrates to `autoplay: false` — the closest available
meaning. Note it is not identical for the old master switch, whose `false` also
silenced speaker buttons; under the new model a deliberate press always speaks.
`route` has no predecessor and takes the default.

The migration runs once, on first read of a blob with no `route` key. Stale keys
left behind in the other blobs are inert (their loaders spread defaults over the
parsed object).

**The quick toggles survived, became three-state, and consolidated into the header.** Every surface
that offered an autoplay control still offers one, now reading and writing the
unified flag — and all of them are in the **page header** as an `autoplay` chip:
flp (`FlashcardsLearnHeader`), scp (`SortCardsPage` header actions), Bubble Match
and Hydra (`BubbleMatchHeaderControls`), Match Speed (`MatchSpeedHeader`) and Word
Search (`WordSearchHeaderControls`, added 2026-08-29 — the game narrates found words,
blue matches and review rungs, so it needed a mid-play mute like the rest) and
Immersive World (`IWPlayPage`'s `rightContent`, added 2026-09-09 — a scene speaks its
NPC lines aloud, so it needs the same mid-play mute). The two
that were buried — flp's settings-sheet row and Match Speed's dialog row — moved up
on 2026-08-28, so the chip means the same thing and sits in the same place
everywhere. The *setting* was unified; the affordances were made consistent.

Memory Map narrates automatically and is gated by the same flag but exposes **no**
control of its own; its header is unchanged. Word Search was in that group until
2026-08-29 and now renders the chip (see above).

**Two settings sheets are gone.** `SettingsPanelBody` and the header's settings cog
were deleted on 2026-08-28: audio moved to the header chip, tone coloring moved to
`/settings` → Display (it is a display preference applying to every reading the app
renders, not a study control belonging to one page), and the progress-category chip
on the card back was removed outright along with its `showProgressCategory` setting
and `CardFace`'s `CategoryChip` / `cornerBadge` slot. `useFlashcardLearnSettings` now
holds two booleans and has no sheet of its own; `DecksPanelBody` is the only non-eip
`SheetPanel` body left.

`MatchSpeedSettingsDialog` followed it on the same day. Its rows were the same three
settings, and once audio became a header chip and tone coloring moved to `/settings`
it held a single row — and nothing at all for a Latin-script language, since every
row was script-gated. Pinyin became a header chip beside the audio one and the cog
was removed. **`/settings` → Display is now the only place tone coloring is edited**,
in any surface. One side effect worth knowing: Match Speed's `clockPaused` lost a
source (it is now `noticeOpen || backgroundPaused`), which is correct — the pause
rule covers input-blocking overlays, and a header chip leaves the board playable.

*Code:* `src/hooks/useTTSSettings.ts` → `migrateLegacy`, `loadSettings`.

---

## Referenced by / depends on

- `src/hooks/useTTSSettings.ts` — the settings, their projection and their migration;
  `NarrationVoice`, `NARRATION_VOICE_ORDER`, `setVoice` (§ 6)
- `src/hooks/useTTS.ts` — trigger contract, fallback rule, route push-down, voice role (§ 6)
- `server/services/TTSService.ts` — the language × role voice table and the disk cache (§ 6)
- `server/controllers/TTSController.ts` — request validation, incl. the voice role (§ 6)
- `src/features/immersiveworld/play/useIWSceneRuntime.ts` — `voiceFor`, the only
  caller that asks for a non-default voice (§ 6)
- `src/services/tts/CloudTTSProvider.ts` — both sinks, all three caches, unlock
- `src/services/tts/WebSpeechProvider.ts` — the unrouteable fallback; carries no voice role (§ 6)
- `src/pages/SettingsPage.tsx` — `AUDIO_MODE_OPTIONS`; `NARRATION_VOICE_OPTIONS`,
  `VOICE_SAMPLE` and the voice section (§ 6)
- `server/services/OnDeckVocabService.ts` — `prewarmAudio`, default-voice only (§ 6)
- `src/services/audio/markArpeggio.ts` — the answer-feedback arpeggio, deliberately
  out of scope (§ 7); also carries the resume-on-every-gesture pattern (§ 5)
- `src/hooks/useMarkArpeggio.ts` — per-surface reset of the arpeggio ladder, Match Speed + Bubble Match only (§ 7)
- `src/api/flashcards.ts` — `markFlashcard` fires the arpeggio for `ARPEGGIO_SURFACES` (§ 7)
- `src/__tests__/ttsUnlockRecovery.test.ts` — unlock repeatability regression tests
- `src/features/discover/SortCardsPage.tsx` — `unlockAudio` (no local latch, § 5)
- [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) — est narration call sites
- [REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md) — `expo-audio`'s
  `playsInSilentMode` is this setting, natively, if the app ever ports
- [DEFERRED_WORK.md](./DEFERRED_WORK.md) item 12 — the missing fallback metric
