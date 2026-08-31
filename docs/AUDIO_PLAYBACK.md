# Audio Playback

How the app makes sound: the one user-facing narration setting, the two output
sinks it selects between, and the rules every narration call site must follow.

**Status:** BUILT 2026-08-28, no migration (the setting is client-side only).
Gesture-unlock latching fixed the same day — the "audio dies until I restart the
app" bug, [§ 5](#-unlock-must-never-latch).
**Not yet verified on a physical iPhone** — see [§ 7](#7-what-still-needs-a-device).

---

## 1. The setting

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
characters, plus a fixed allowance for the glyph) via `HeaderCycleChip`'s `widthCh` and measured in `ch` against the mono
face, plus `CYCLE_CHIP_SLACK_CH` (**4ch**) of breathing room — `widthCh` alone is the
label's exact advance width, which both clips the last glyph to subpixel rounding and
reads as cramped inside the chip's radius. It therefore does not resize as the user taps
through, and the controls to its left hold still under the thumb.
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
`HeaderCycleChip`; `src/pages/SettingsPage.tsx` → `AUDIO_MODE_COPY`.

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
`gameSounds.getContext()` has always had.

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

## 6. What this setting does NOT cover

**Game sounds** (`src/games/runtime/gameSounds.ts` — the synthesized correct/wrong
blips in Speed Reading and Memory Map) are deliberately **out of scope**. They
always use media semantics: they honor the silent switch and never disturb other
audio. `passthrough` therefore means "all *narration* bypasses mute", not all app
audio.

Consequence worth knowing: `gameSounds` owns a **second `AudioContext`** with its
own unlock state, unaware of the TTS one. Routing the blips would need
`MediaStreamAudioDestinationNode` → `<audio srcObject>` (an oscillator has no
Blob to hand an element), whose iOS/WebKit support is unreliable. If narration
and effects are ever unified, that spike is the prerequisite.

There is also **no full-mute state** any more. The old master switch
("Speak Chinese words aloud", `TTSSettings.enabled`) silenced everything
including speaker buttons; it was removed when the three states landed. The
phone's own mute switch covers the case in `media` mode.

---

## 7. What still needs a device

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

## 8. Migration from the pre-unification settings

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
blue matches and review rungs, so it needed a mid-play mute like the rest). The two
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

- `src/hooks/useTTSSettings.ts` — the setting, its projection and its migration
- `src/hooks/useTTS.ts` — trigger contract, fallback rule, route push-down
- `src/services/tts/CloudTTSProvider.ts` — both sinks, all three caches, unlock
- `src/services/tts/WebSpeechProvider.ts` — the unrouteable fallback
- `src/pages/SettingsPage.tsx` — `AUDIO_MODE_OPTIONS`
- `src/games/runtime/gameSounds.ts` — deliberately out of scope (§ 6); also the
  reference implementation of the resume-on-every-gesture pattern (§ 5)
- `src/__tests__/ttsUnlockRecovery.test.ts` — unlock repeatability regression tests
- `src/features/discover/SortCardsPage.tsx` — `unlockAudio` (no local latch, § 5)
- [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) — est narration call sites
- [REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md) — `expo-audio`'s
  `playsInSilentMode` is this setting, natively, if the app ever ports
- [DEFERRED_WORK.md](./DEFERRED_WORK.md) item 12 — the missing fallback metric
