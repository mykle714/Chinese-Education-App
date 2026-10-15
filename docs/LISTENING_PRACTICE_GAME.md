# Listening Practice (`/games/listening-practice`)

> **STATUS: DESIGN / DRAFT (2026-10-12). Nothing is built.** No route, no registry entry,
> no endpoint, no migration (none is planned). Every "proposed" file below is a proposal.
> Scope widened from tones to general listening practice on 2026-10-12; see the
> [§ 12 Question log](#12-question-log) for what is decided and what is still open.

A **listening** drill made of **minimal pairs**. The player hears audio, sees the text with
one word highlighted (shown as `？` until review), and picks **which word was said** from
options that sound the same except along one **contrast axis**:

- **Tones**: same syllables, different tone (买 mǎi / 卖 mài).
- **Initials**: c / ch / q, s / sh / x, z / zh / j (出 chū / 区 qū, 是 shì / 系 xì). l / n and
  l / r were considered and **rejected** ([Q12](#q12-which-axes-and-how-are-they-offered)).
- **-n / -ng endings**: an / ang, en / eng, in / ing, including the ian / iang and uan / uang
  medial forms.
- **u / ü**: 路 lù / 绿 lǜ, 努 nǔ / 女 nǚ. Pinyin only contrasts these after **n** and **l**.
  After j/q/x, `u` is always ü, so there is no pair there. This axis has **no playable
  pairs until the curated words in [§ 2a](#2a-vowels-mode-prerequisite-curated-uü-words)
  are marked discoverable** ([Q14](#q14-non-discoverable-siblings)).

> **Scope history.** This was designed first as *Tone Training* (tones only). On 2026-10-12 it was
> widened to listening practice in general (initials, -n/-ng endings and u/ü were added) and renamed
> ([Q13](#q13-name)).

Each round is **an isolated word, a phrase, or a whole sentence**, drawn in a **60 / 30 / 10**
ratio ([§ 3](#3-round-kinds-word--phrase--sentence)). Context does not give the answer away; only the
ear does.

It is the app's first game that **emits no marks**. It still counts as study time: play
accrues minute points and streak like every other game.

---

## Table of contents

1. [Scope: Chinese only](#1-scope-chinese-only)
2. [What the corpus can support](#2-what-the-corpus-can-support)
   - [2a. Vowels mode prerequisite: curated u/ü words](#2a-vowels-mode-prerequisite-curated-uü-words)
3. [Round kinds: word / phrase / sentence](#3-round-kinds-word--phrase--sentence)
4. [Phrase and sentence templates](#4-phrase-and-sentence-templates)
5. [Choosing the target and its siblings](#5-choosing-the-target-and-its-siblings)
6. [Audio](#6-audio)
7. [Screen layout](#7-screen-layout)
8. [Round state machine](#8-round-state-machine)
9. [No marks, but minutes](#9-no-marks-but-minutes)
10. [Layering and proposed files](#10-layering-and-proposed-files)
11. [Registry / contract changes a no-mark game forces](#11-registry--contract-changes-a-no-mark-game-forces)
12. [Question log](#12-question-log)
13. [Dependencies (docs ↔ code)](#13-dependencies-docs--code)

---

## 1. Scope: Chinese only

`GameDef.languages = ["zh"]`. Every axis is a property of Mandarin pinyin. A Spanish
listening drill (b/v, r/rr) would need its own sibling rules. Follows the Speed Reading
precedent: the hub **hides** a game whose `languages` exclude the learner's selection.

## 2. What the corpus can support

Measured on dev, 2026-10-12, over `dictionaryentries_zh WHERE discoverable` (12,637 rows).

**Definitions.**
- A word's syllables come from `numberedPinyin`. Each syllable is split into
  **initial + spelled final + tone**.
- Two words are **siblings on an axis** when they have the same character count, every
  syllable is identical except **one**, and that one differs only along the axis.
- Finals are compared **as spelled**, not phonetically. 出 `chu1` / 区 `qu1` is a valid c/ch/q
  pair even though the `u` after q is phonetically ü. The same goes for `chi`/`qi`/`ci`. This is
  what makes q/x/j pair with the others at all, since q/x/j only appear before i/u(ü).
- **Strict** means the contrasted syllable keeps its tone. **Relaxed** means it may also differ
  in tone. **Decided: strict only** ([Q11](#q11-strict-or-relaxed-siblings)), so only the strict
  columns below are live pools. The relaxed columns are kept for reference.

**Targets with ≥1 sibling** (all lengths). "Any POS" is the pool for isolated-word rounds;
"same POS" is the pool for phrase/sentence rounds, because the sibling must also fit the slot.

| Axis | Strict, any POS | Strict, same POS | Relaxed, any POS | Relaxed, same POS |
|---|---|---|---|---|
| Tones | 1,800 | ~1,180 | — | — |
| c / ch / q | 35 | 12 | 129 | 77 |
| s / sh / x | 96 | 70 | 280 | 198 |
| z / zh / j | 84 | 52 | 338 | 246 |
| an / ang | 88 | 84 | 272 | 208 |
| en / eng | 64 | 42 | 122 | 82 |
| in / ing | 71 | 56 | 216 | 168 |
| l / n *(rejected)* | 43 | 29 | 72 | 48 |
| l / r *(rejected)* | 70 | 45 | 110 | 75 |
| u / ü (after n, l) | **0** | 0 | 0 | 0 |

**u / ü is empty for a corpus reason, not a rule reason.** There are only 66 ü syllables in the
discoverable corpus (almost all 女, plus 绿色, 旅游, 远虑), and none has a discoverable
counterpart. If one side may be **non-discoverable**, there are **548** pairs, e.g. 路 / 绿,
女 / 努, 公路 / 功率, 铁路 / 铁律, 一路 / 一律, 心路 / 心率. See
[Q14](#q14-non-discoverable-siblings).

**Tones by length** (strict, same POS): 1-char 166, 2-char 996, 3-char 19, 4-char 0.

Consequences for the design:

- **Real-word siblings are sparse** ([Q1](#q1-must-every-option-be-a-real-word): real words
  only). Most targets have exactly one sibling, so most rounds have **2 options**. 4-char words
  have no siblings on any axis.
- **Isolated-word rounds (60%) carry most of the volume.** They need no POS match, so they
  draw from the larger "any POS" pool.
- `partsOfSpeech` is **coarse** (12 tags: noun 9,360, verb 2,717, adjective 1,413, …). "Same
  POS" guarantees the sentence is grammatical, not that it makes sense
  ([Q3](#q3-grammatical-fit-or-semantic-fit): accepted).

Source columns: `dictionaryentries_zh."numberedPinyin"` (e.g. `ma1 ma`: neutral tone has no
digit, ü is written `v`) and `."partsOfSpeech"` (a jsonb string array; the allowed values are
`ALLOWED_POS_TAGS` in `server/scripts/backfill/shared/lib/posTags.js`). The measurement
script was ad hoc; the production rule is `siblingKey` in § 5.

## 2a. Vowels mode prerequisite: curated u/ü words

**APPROVED 2026-10-12 (21 words; over-marking is fine). Marked discoverable on PPE 2026-10-12**
(backup `server/backups/det-20261013T021118Z-listening-practice-uv.sql.gz` on PPE; no icons step).
The full 15-step pipeline ran with 0 errors, and the A4 verification passed for all 21 words.
**No icons yet**, so these tiles have `iconId` NULL until `backfill-icons` runs.
Dev picks them up on the next `/data-ppe-to-dev`. These words must go through
`/mark-discoverable` end to end before the Vowels mode has any rounds. They were drawn from
every strict (same-tone) u↔ü pair after n/l in `dictionaryentries_zh` where at least one side
is non-discoverable. `*` = already discoverable.

The ü inventory is small. Mandarin has few ü syllables, and `lüe`/`nüe` (略, 虐) have no u
counterpart at all, so the full useful set is about 16 words, not the 20–40 first estimated.

| Word to mark | Reading | Gloss | Pairs with |
|---|---|---|---|
| 绿 | lǜ | green | 路* lù, 鹿 lù (blocked: see data issue 1) |
| 律 | lǜ | law | 路* lù, 鹿 lù |
| 滤 | lǜ | to filter | 路* lù, 鹿 lù |
| 鹿 | lù | deer | 绿, 律, 滤 |
| 驴 | lǘ | donkey | 炉 lú |
| 炉 | lú | stove | 驴 lǘ |
| 铝 | lǚ | aluminum | 卤 lǔ |
| 卤 | lǔ | to stew in soy; brine | 铝 lǚ |
| 努 | nǔ | to exert (oneself) | 女* nǚ |
| 驴子 | lǘ zi | donkey | 炉子 lú zi |
| 炉子 | lú zi | stove | 驴子 lǘ zi |
| 铁律 | tiě lǜ | iron law | 铁路* tiě lù |
| 功率 | gōng lǜ | power (watts) | 公路* gōng lù |
| 心率 | xīn lǜ | heart rate | 心路* xīn lù |
| 熟路 | shú lù | familiar road | 熟虑* shú lǜ |
| 回头率 | huí tóu lǜ | head-turning rate | 回头路* huí tóu lù |
| 码率 | mǎ lǜ | bitrate | 马路* mǎ lù |
| 滤过 | lǜ guò | to filter | 路过* lù guò |
| 绿树 | lǜ shù | green trees | 路数* lù shù |
| 一律 | yī lǜ | without exception | (not paired; contains 一) |
| 心律 | xīn lǜ | heart rhythm | (not paired; homophone of 心率) |

**Excluded on purpose:**
- 一律 / 一路 and 心律 are marked (they are useful words) but are never paired in a round. 一律
  contains 一, which the sandhi rule excludes, and 心律 is a homophone of 心率 (§ 5).
- 旅, 吕, 屡, 虑, 率 (alone): bound forms or surnames that make poor standalone tiles.
- 怒 nù: its only ü partners (恧, 衄) are archaic.

**Data issues found while drafting (det data; PPE is the source of truth):**
1. **绿's default reading was wrong — FIXED on PPE 2026-10-12** (`/mark-discoverable` A1.5):
   `lv4`/`lǜ`, definitions `["green", <slang>]`, the lu4-only "used in names" gloss dropped,
   clusters regenerated. Original state, for the record: `pronunciation = 'lù'`, `numberedPinyin = 'lu4'`, and
   `definitions[0]` is a slang sense. The everyday "green" reading is `lǜ`/`lv4`; `lù` is the
   literary reading (绿林, 鸭绿江). It needs fixing on PPE **before** 绿 is marked, or its tile
   shows the wrong pinyin and dd.
2. **露's `pronunciation` is malformed:** `'loù'` (the tone mark is on the wrong vowel; should be
   `lòu`). The default is also the colloquial `lòu` rather than the main reading `lù` ("dew").
   It does not affect this game but should be fixed in the same pass.

## 3. Round kinds: word / phrase / sentence

| Kind | Share | What is heard | What is shown | Template? | POS match needed? |
|---|---|---|---|---|---|
| `word` | 60% | The target word alone | A highlighted `？` | No | No |
| `phrase` | 30% | A short phrase containing the target (e.g. 买{}) | The phrase, with the slot as `？` | Yes | Yes |
| `sentence` | 10% | A whole sentence containing the target | The sentence, with the slot as `？` | Yes | Yes |

The ratio is a **weighted draw per round** (`ROUND_KIND_WEIGHTS = { word: 60, phrase: 30,
sentence: 10 }`), not a fixed cycle. If no template fits the chosen target's POS, the round
falls back to `word`.

```ts
// Proposed — server/contracts/wire.ts
type ListeningRoundKind = "word" | "phrase" | "sentence";
type ContrastAxis = "tone" | "c-ch-q" | "s-sh-x" | "z-zh-j" | "n-ng" | "u-v";
interface ListeningRound {
    kind: ListeningRoundKind;
    axis: ContrastAxis;
    templateId: string | null;     // null for `word`
    text: string;                  // filled phrase/sentence; for `word`, the target itself
    highlight: { start: number; length: number }; // char span of the target in `text`
    textPronunciation: string;     // numbered pinyin of the whole `text`, for the SSML hint
    translationTemplate: string | null; // English with a `{}` slot; `___` until review, then the target's dd (Q8). null for `word`
    correctIndex: number;          // index into `options`
    options: ListeningOption[]; // target + siblings, shuffled
}
interface ListeningOption {
    entryKey: string;              // word1
    pronunciation: string;         // tone-marked pinyin
    numberedPinyin: string;
    definition: string;            // dd (resolveDisplayDefinition rules)
    iconId: number | null;
}
```

Rounds are built **server-side**, because the sibling query is a det self-join the client
cannot run, and are fetched in batches.

## 4. Phrase and sentence templates

Templates exist **only** for `phrase` and `sentence` rounds. A `word` round has none. Each
template has **one slot** with a POS constraint, hand-written pinyin and an English string
with the same slot. Templates are constants in code
([Q2](#q2-where-do-templates-live)).

```ts
// Proposed — server/services/listeningPractice/templates.ts
// phrase
{ id: "buy-n",     kind: "phrase",   text: "买{}",       pinyin: "mai3 {}",               english: "buy {}",              slotPos: ["noun"] }
{ id: "very-adj",  kind: "phrase",   text: "很{}",       pinyin: "hen3 {}",               english: "very {}",             slotPos: ["adjective"] }
{ id: "want-v",    kind: "phrase",   text: "想{}",       pinyin: "xiang3 {}",             english: "want to {}",          slotPos: ["verb"] }
// sentence
{ id: "want-noun", kind: "sentence", text: "我想要{}。",  pinyin: "wo3 xiang3 yao4 {}",    english: "I want {}.",          slotPos: ["noun"] }
{ id: "verb-now",  kind: "sentence", text: "我们现在{}吧。", pinyin: "wo3 men5 xian4 zai4 {} ba5", english: "Let's {} now.", slotPos: ["verb"] }
{ id: "is-adj",    kind: "sentence", text: "这个很{}。",  pinyin: "zhe4 ge5 hen3 {}",      english: "This is very {}.",    slotPos: ["adjective"] }
```

- The pinyin is hand-written, not looked up, so the carrier's own tones are authoritative. The
  SSML hint for the round is the template pinyin with the target's `numberedPinyin` in the slot.
- **Volume (decided 2026-10-12):** about 10–15 phrase templates and 10–15 sentence templates,
  spread across noun, verb and adjective slots. They are not drafted yet.
- Nonsense fills such as `我想喝医院` are accepted ([Q3](#q3-grammatical-fit-or-semantic-fit)).
- **The carrier must not trigger sandhi on the slot.** A template ending in a 3rd tone right
  before the slot (很 hen3 + a 3rd-tone target) changes how the carrier sounds, not the target.
  That is acceptable. But a 3rd-tone target followed by a 3rd-tone carrier syllable changes the
  target itself, so templates should avoid putting a 3rd-tone syllable right after the slot.
  Enforced by a template unit test.
- Tone-axis rounds must not use a template whose carrier contains the target's own syllables,
  since that would let the player match the sound against the visible text.

## 5. Choosing the target and its siblings

Proposed algorithm, one server query per batch:

1. **Axis**: fixed by the run's mode, or drawn per round in Mixed
   ([Q12](#q12-which-axes-and-how-are-they-offered)). In Mixed, an axis with no candidate for the
   chosen kind is skipped for that round.
2. **Kind**: weighted draw (§ 3).
3. **Pool**: library first, corpus fill ([Q4](#q4-whose-words-are-the-targets)). Draw from the
   learner's playable cards (narrowed by the hub collection selector) that have ≥1 sibling on
   the axis, then top up from any discoverable word. For `phrase`/`sentence`, a sibling must
   share a POS with the template slot.
4. **Siblings**: every discoverable word sharing the target's `siblingKey` on the axis (same
   char count, all syllables identical except one, which differs only along the axis). Dedupe
   siblings that share a `numberedPinyin`: true homophones (一世 / 义士) sound identical, so
   only one word per distinct pronunciation may appear in a round.
5. **Cap**: at most `MAX_OPTIONS = 4` options (decided 2026-10-12), preferring siblings with a
   higher `frequencyScore`.
6. **Exclusions** ([Q5](#q5-tone-sandhi)):
   - Pairs whose difference is erased by **3rd-tone sandhi** (a `3 3` word sounds `2 3`, so it
     collides with a real `2 3` sibling).
   - Words containing **一 / 不**, whose citation tone differs from the spoken tone.
   - Siblings that differ only by **neutral tone vs. a full tone** (`dong1 xi` vs `dong1 xi1`).
   - Polyphones are **not** excluded. Siblings are keyed on the row's default `numberedPinyin`,
     the audio is pinned by the SSML hint, and each tile shows tone-marked pinyin. So 绿 `lv4`
     vs 路 `lu4` is unambiguous even though 绿's `searchReadings` also lists `lu4`.
   - `numberedPinyin` is **lowercased** before keying: surnames are stored capitalized
     (卢 `Lu2`, 鲁 `Lu3`).
7. **u / ü**: ü is spelled `v` in `numberedPinyin` (`nv3`, `lv4`). The u-v axis compares `nu`/`lu`
   with `nv`/`lv` (and `lue`/`nue` with `lve`/`nve`), and only those.

`siblingKey(numberedPinyin, axis, syllableIndex)` lives in `server/utils/pinyinTones.ts` next
to `numberedToTonedPinyin`. It is the one definition of "same except along the axis". The
client's `pronunciationKey` (`src/utils/vocabSort.ts`) is the tone-axis special case and
should be expressed through the same rule rather than kept as a second copy.

## 6. Audio

All audio goes through the existing TTS path — no new provider:

- **Round audio**: `useTTS().autoSpeakSentence(text, textPronunciation)` on round
  entry, for every kind (a `word` round speaks just the target) (autoplay honours the app-wide narration setting — [AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md)),
  and `speakSentence(...)` on the replay button.
- **Each option (review mode)**: `useTTS().speak(entry)` per option's speaker button.
- Tones are forced, not guessed: `server/services/TTSService.ts` sends pinyin to Google
  Cloud TTS as an SSML phoneme hint (`buildPinyinSsml`), so a distractor such as 买/卖 is
  pronounced with the tone we asked for. The same hint pins initials and finals. **Unverified:** whether Google re-applies sandhi on
  top of the hint — see [Q5](#q5-tone-sandhi).
- Prefetch the next round's sentence + all option audio via the cloud provider's
  `prefetch` so "Next" never waits.
- **No correct/incorrect sound** ([Q6](#q6-the-correctincorrect-audio-cue)): the app has no
  sound effects, and the cue is visual only for now.

## 7. Screen layout

Leaf page (every game is — `GAME_ROUTE_META`). Portrait.

```
┌──────────────────────────────────────┐
│ ↓       Listening Practice  🔊chip 🔥│  header: back, AudioModeChip, fire badge
├──────────────────────────────────────┤
│                                      │
│          我 想 要 [ 汤 ] 。           │  sentence, centered, target highlighted
│                 (🔊 replay)           │
│                                      │
│  ┌──────────────┐  ┌──────────────┐  │
│  │  [icon]      │  │  [icon]      │  │  option tiles: icon, cpcd row
│  │  汤 tāng     │  │  糖 táng     │  │  (ForeignText), dd
│  │  soup        │  │  sugar       │  │
│  └──────────────┘  └──────────────┘  │
│                                      │
│              [ Next → ]              │  only in review
└──────────────────────────────────────┘
```

- **Prompt text**: plain, large, centered; target highlighted. A `word` round shows only the
  highlighted `？` (no translation line); `phrase`/`sentence` rounds show the carrier text.
  Replay works the same for all three kinds.
- **Sentence**: plain, large, centered; target highlighted. Censored English translation
  below it (`I want ___.`), filled with the target's dd in review. Pinyin on the sentence would
  give the answer away — so the sentence shows **characters only**, and the highlighted
  slot shows… what? All options share the same characters only if they are homographs;
  usually they are *different characters* (汤/糖), so showing the target's characters also
  gives the answer away. So the slot shows a highlighted `？` until review, then reveals the
  characters ([Q7](#q7-what-does-the-highlighted-slot-show)).
- **Option tile**: icon + cpcd row (via `ForeignText`, never `CPCDRow` directly — see
  memory: ForeignText is the only foreign-text renderer) + dd (`resolveDisplayDefinition`).
  Looks like a `MiniCard` but is its own component (`ToneOptionTile`) because it needs a
  selected / correct / wrong state and a review-mode speaker button, which `MiniCard` does
  not have. Carries `border: 1px solid ${COLORS.border}` per the Buttons & cards rule.
- **Review mode**: each tile spawns a `SpeakerButton`; the correct tile and (if different)
  the chosen tile are tinted. Colors from `COLORS` — the success/error tokens to use are
  part of [Q6](#q6-the-correctincorrect-audio-cue).

## 8. Round state machine

```
loading ──► presenting ──(audio ends or any tap)──► answering ──(tap option)──► review ──(Next)──► loading
                │                                       ▲
                └──────────── replay ───────────────────┘
```

- `presenting`: sentence autoplays. Options are tappable immediately (no forced wait).
- The run is endless; leaving the page ends it.
- `answering → review`: lock options, tint correct/incorrect, reveal the slot's characters,
  bump the header tally.
- `review`: option speaker buttons visible; replay still works; Next advances.

## 9. No marks, but minutes

- **Marks**: none. No `POST /api/flashcards/mark`. Card-level progress is not affected.
- **Minutes**: accrual is route-driven (`src/minutePoints/useMinutePoints.ts`,
  `isMinutePointsEligiblePath` in `src/minutePoints/eligibility.ts`). Add
  `'/games/listening-practice'` to `MINUTE_POINTS_ELIGIBLE_PAGES` (`src/constants.ts`); the
  `/games` prefix in `MINUTE_POINTS_AUTO_ACTIVE_PAGES` makes it start counting on entry.
- Precedent for a mark-free study surface: the Writing Notebook (`/flashcards/writing/notebook`).
- **Not challenge-eligible**: eligibility requires a recognition/production `markType`.

## 10. Layering and proposed files

| Layer | Proposed file | Role |
|---|---|---|
| Contract | `server/contracts/wire.ts` → `ListeningRound`, `ListeningOption` | Wire types |
| Contract | `server/contracts/featureFlags.ts` → `GAME_FLAGS['listening-practice']` | Flag (compile-required) |
| Controller | `server/controllers/ListeningPracticeController.ts` | `GET /api/games/listeningPractice/rounds?count=` — validate, call service |
| Route | `server/routes/…` (mounted under the games router) | |
| Service | `server/services/ListeningPracticeService.ts` | Pick template, assemble round, apply sandhi exclusions, shuffle |
| Service (data) | `server/services/listeningPractice/templates.ts` | Template constants (if [Q2](#q2-where-do-templates-live) = constants) |
| DAL | `server/dal/implementations/ListeningPracticeDAL.ts` | Sibling self-join on `dictionaryentries_zh` |
| Shared util | `server/utils/pinyinTones.ts` (extend) → `tonelessKey` | One toneless-key definition; `src/utils/vocabSort.ts` `pronunciationKey` already does the same strip client-side — consolidate rather than add a third copy |
| Client API | `src/games/listening-practice/listeningPracticeApi.ts` | via `src/api/http.ts`, no `token` param |
| Client page | `src/games/listening-practice/ListeningPracticePage.tsx` | Leaf page, state machine |
| Client component | `src/games/listening-practice/ToneOptionTile.tsx` | Option tile |
| Client constants | `src/games/listening-practice/constants.ts` | `GAME_ID`, `GAME_HUE`, `MAX_OPTIONS` |
| Registry | `src/games/registry.ts`, `server/constants.ts` `KNOWN_GAME_IDS` | Register + whitelist |
| Minutes | `src/constants.ts` `MINUTE_POINTS_ELIGIBLE_PAGES` | Accrual |

No new table is proposed **if** templates are constants and targets come from det. Any
table (templates, cached rounds, AI sentences) is pending confirmation.

## 11. Registry / contract changes a no-mark game forces

`GameDef` (`src/games/types.ts`) documents `markType` as omitted **only** for a moded game,
with `modes` set instead, and `src/games/__tests__/challengePool.test.ts` checks that
invariant. A game with **neither** is a new case. Proposal: add an explicit
`emitsMarks: false` field (decided, [Q10](#q10-how-to-declare-no-marks)) so "no marks" is a
declared fact rather than an absence the test could mistake for a forgotten field. The
`markType`/`modes` invariant becomes "exactly one of `markType`, `modes`, `emitsMarks: false`".
`markType: "none"` was rejected because `MarkType` is shared with the mark API.

Being **moded** makes this harder. `GameDef.modes` is typed `{ mode, markType }[]` and exists
for the challenge-pool test, so a mark-free moded game cannot fill it. Proposal: keep the
Listening Practice modes in the game's own `MODE_CONFIGS` (`src/games/listening-practice/constants.ts`,
the Word Search / Bucket Drop pattern) and leave `GameDef.modes` unset. With `emitsMarks:
false`, the invariant still holds, and the hub fans the tile out from `MODE_CONFIGS` the same
way Match Speed's difficulty modes do. This needs checking against `GamesPage` before building.

The Games hub's collection selector ("Playing with: …") still applies: it narrows the
library-first half of the target pool ([Q4](#q4-whose-words-are-the-targets)).

## 12. Question log

### Q1. Must every option be a real word?
Real-word options are what make the cpcd + dd + icon tiles possible, but they cap most rounds
at 2 options and nearly exclude 3–4-char words. Alternative: allow **pinyin-only phantom
options** (e.g. `tāng / táng / tǎng / tàng`) for missing tone patterns.
**Answered 2026-10-12: real words only.** Every option is a discoverable det word with a full
tile. Accepted consequences: most rounds are 2 options; the target pool is ~1,200 words,
effectively 1–2 chars (3-char: 19; 4-char: none).

### Q2. Where do templates live?
Hard-coded constant in the service (fast, reviewable in git) vs. a table (authorable on PPE).
**Answered 2026-10-12: constants in code** (`server/services/listeningPractice/templates.ts`). No table.

### Q3. Grammatical fit or semantic fit?
POS-only slots produce nonsense sentences (`我想喝医院`). Options: (a) accept nonsense;
(b) generic carrier phrases that fit anything of a POS (`我说的是___`); (c) AI-generated
natural sentences per target, cached; (d) tag words with semantic classes.
**Answered 2026-10-12: (a) POS templates, accept nonsense.** No semantic typing, no new data.

### Q4. Whose words are the targets?
The learner's library (and the hub collection selector) vs. any discoverable word.
**Answered 2026-10-12: library first, corpus fill.** Targets are drawn first from the learner's
playable cards (narrowed by the hub collection selector, so the selector keeps meaning), then
topped up from any discoverable word. Siblings are always any discoverable word.

### Q5. Tone sandhi
Exclude 3-3 sandhi collisions and 一/不 words, or speak citation tones regardless? Also
neutral-vs-full-tone siblings.
**Answered 2026-10-12: exclude ambiguous cases** — § 5 step 4 is the rule, and
**neutral-vs-full-tone siblings are excluded too** (东西 dōng xi vs dōng xī never share a round).

### Q6. The correct/incorrect audio cue
No SFX exist. Synthesized Web Audio tones, bundled audio files, or TTS ("对"/"不对")?
**Answered 2026-10-12: no audio cue for now** — feedback is visual only (tile tint). Revisit later.

### Q7. What does the highlighted slot show?
Showing the target's characters gives the answer away. Blank highlighted box? Toneless pinyin
(`tang`)?
**Answered 2026-10-12: characters revealed later.** During `presenting`/`answering` the slot
is a highlighted `？` placeholder; on entering `review` it reveals the target's characters.

### Q8. Translation
Show the sentence's English? It may leak the answer.
**Answered 2026-10-12: shown, with the target censored.** The template carries an English
string with a slot (`"I want {}."`); before review it renders as `I want ___.`, and on review
the slot fills with the target's dd. (Interpretation of "yes but also censor the word in
english" — confirm it is shown from round start, not only in review.)

### Q9. Run shape
Endless, or a fixed run (N rounds, score / medals)? Wins counted?
**Answered 2026-10-12: endless, with a running correct/total tally** in the header. No medals,
no wins, no save state (so no `gameprogress` row).

### Q10. How to declare "no marks"
See § 11. **Answered 2026-10-12: an explicit `emitsMarks: false` field on `GameDef`.**

### Q11. Strict or relaxed siblings
For the initial, ending and u/ü axes, must the contrasted syllable keep its tone? Strict pairs
are rare: c/ch/q has 12 same-POS targets strict vs 77 relaxed (§ 2). Relaxed rounds can be
answered by tone alone.
**Answered 2026-10-12: strict only.** Accepted because phrase/sentence rounds (the POS-restricted
40%) are the minority, and the 60% isolated-word rounds draw on the larger any-POS strict pool.

### Q12. Which axes, and how are they offered
Candidate axes: tones, c/ch/q, s/sh/x, z/zh/j, -n/-ng, u/ü (**requested 2026-10-12**), l/n,
l/r. Offered as one moded hub tile (Tones / Initials / Endings / Mixed, like Word Search),
always mixed, or separate games?
**Answered 2026-10-12: one moded hub tile.** Modes: **Tones / Initials / Endings (-n/-ng) /
Vowels (u/ü) / Mixed**. v1 axes: tones, c/ch/q, s/sh/x, z/zh/j, -n/-ng and u/ü (Vowels ships once § 2a is
done). **l/n and l/r: rejected 2026-10-12.**

### Q13. Name
The scope is wider than tones. Rename the game, slug and doc (e.g. "Listening Practice",
`/games/listening-practice`, `docs/LISTENING_PRACTICE_GAME.md`)?
**Answered 2026-10-12: Listening Practice**, slug `listening-practice`.

### Q14. Non-discoverable siblings
u/ü has 0 discoverable pairs but 548 where one side is a non-discoverable det row. Options:
(a) run `/mark-discoverable` on a curated set of common ü/u words (绿, 律, 率, 努, 铁律, 一律, …)
so they are fully enriched; (b) allow non-discoverable rows as distractors, which have no
enrichment guarantee (dd may need to fall back to `definitions[0]`, often no `iconId`);
(c) drop the u/ü axis. Choice (b) would also grow every other axis's pool.
**Answered 2026-10-12: (a) curate and mark discoverable.** This is a **prerequisite before the
Vowels mode can ship**: pick ~20–40 common ü/u counterpart words and run them through
`/mark-discoverable` end to end. The word list is not chosen yet. Distractors still must be
discoverable on every axis.
(Setting `discoverable` directly is forbidden; it must go through `/mark-discoverable`.)

## 13. Dependencies (docs ↔ code)

This doc references (none of which is changed yet):
- `dictionaryentries_zh` columns `numberedPinyin`, `pronunciation`, `tone`, `partsOfSpeech`,
  `frequencyScore`, `iconId`, `discoverable`
- `src/hooks/useTTS.ts` → `useTTS` (`speak`, `speakSentence`, `autoSpeakSentence`)
- `src/services/tts/CloudTTSProvider.ts` → `prefetch`, `unlock`
- `server/services/TTSService.ts` → `buildPinyinSsml`
- `src/utils/definitionUtils.ts` → `resolveDisplayDefinition`, `resolveDisplayPronunciation`
- `src/cardIcons/cardIconLayout.ts` → `iconImageUrl`
- `src/components/MiniCard.tsx` → `MiniCard` (visual reference for `ToneOptionTile`)
- `src/components/SpeakerButton.tsx` → `SpeakerButton`
- `src/utils/haptic.ts` → `quietHaptic`
- `src/utils/vocabSort.ts` → `pronunciationKey`; `server/utils/pinyinTones.ts`
- `src/constants.ts` → `MINUTE_POINTS_ELIGIBLE_PAGES`; `src/minutePoints/eligibility.ts`
- `src/games/types.ts` → `GameDef`; `src/games/registry.ts`; `server/constants.ts` → `KNOWN_GAME_IDS`;
  `server/contracts/featureFlags.ts` → `GAME_FLAGS`

Related docs: [GAMES_FEATURE.md](./GAMES_FEATURE.md), [SPEED_READING_GAME.md](./SPEED_READING_GAME.md),
[AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md), [MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md),
[FEATURE_FLAGS.md](./FEATURE_FLAGS.md).
