# Video Subtitles (vsp — video subtitle player)

**STATUS: DESIGN / DRAFT.** Nothing in this document is implemented yet. Sections
marked ❓ are open questions for the user; sections marked ⚠️ are decisions that
must be made before any code is written. No tables, columns, routes, or endpoints
described here have been created or confirmed.

Umbrella reference for the **video subtitle** feature: **staff procure a transcript**
for a chosen **YouTube** video, the app parses that transcript into timed, segmented,
dictionary-linked **cues**, and the learner **browses a catalog** of prepared videos
and watches one — **embedded, played by YouTube itself** — with those cues rendered
as tappable **cpcd**, at adjustable playback speed, with heavy scrubbing
(repeat-a-line, step-back, loop).

> **Decided 2026-08-28 — the product is a curated catalog, not a paste box.**
> Transcripts are procured by an internal team (**A″**, § 3), so learners never
> supply a URL; they browse what has already been prepared. This resolved three of
> the § 11 open questions at once (Q1 acquisition, Q5 sharing, Q10 moderation) and
> changes the learner-facing surface from *submit-and-wait* to *browse-and-watch*.
> The rights posture of storing third-party transcripts was weighed and **accepted**
> as a known risk with a cheap exit (pull the row; no code change) — it is not
> re-argued in this document.

The parsing half and the playback half are deliberately separated: parsing is a
slow, cached, one-time-per-video backend job; playback is a latency-critical client
surface that only ever reads a finished cue track.

> **Retargeted 2026-08-24 from Instagram / RedNote to YouTube.** The earlier draft
> assumed the learner supplied a Reel or 小红书 post, which forced the server to
> hold video bytes and to recover subtitles by OCR-ing burned-in pixels. YouTube
> removes both requirements: it has a **sanctioned embeddable player** and it has
> **sidecar timed-text tracks**. The whole frame-sample → OCR → collapse → repair
> pipeline is therefore **out of v1** and survives only as § 8, kept because Shorts
> can still need it. IG/RedNote ingestion is deferred, not designed away; nothing
> here forecloses adding it behind the same cue model.

---

## 1. Concept overview

| Stage | What it produces | Where it runs |
|---|---|---|
| **Resolve** | A canonical `youtubeVideoId` + embeddability/duration metadata | Server |
| **Acquire** | Raw timed text (a YouTube caption track) | **Staff, by hand** (§ 3 — A″) |
| **Normalize** | Sentence-shaped, punctuated, non-overlapping cues | Server |
| **Parse** | Cues: `{ startMs, endMs, text, segments[] }` with gsa segmentation | Server (reuses est's tagging path) |
| **Enrich** | Per-segment gloss/pinyin/POS/sense, linked to cdet | Server (lazy or batch) |
| **Play** | YouTube IFrame player + speed/scrub controls + tappable cue text | Client |

A parsed video is **shared, not per-user** — necessarily so, now that the catalog is
staff-curated: every learner who opens a video reads the same cue track. Per-user
state (last position, loop bookmarks, which cues were tapped) is separate and small.

**The server never holds video or audio bytes.** This is the load-bearing property
of the whole design — it is what makes the feature legally simple, operationally
cheap (no object storage, no `/app/data` bind-mount fragility, no upload caps), and
fast to ship. Any future change that breaks it should be treated as a new feature,
not an increment.

---

## 2. Ingestion

### 2.1 Identity

A video is identified by its **YouTube video id** — the 11-character id — and by
nothing else. Every accepted URL form normalizes to that id:

| Form | Example |
|---|---|
| Watch | `youtube.com/watch?v=<id>` |
| Short link | `youtu.be/<id>` |
| **Shorts** | `youtube.com/shorts/<id>` |
| Embed | `youtube.com/embed/<id>` |

Note the last two collapse into the first: **a Short is an ordinary video with an
ordinary id** (§ 7). Normalization is a pure function and belongs in a shared util,
not in the controller — proposed `server/utils/youtubeUrl.ts` → `parseYoutubeVideoId`.

Identity is `(youtubeVideoId)`, unique. The old content-hash dedupe is gone with the
uploads: there are no bytes to hash, and the id already *is* the canonical key. The
uniqueness constraint also stops two staff members from independently preparing the
same video.

### 2.2 What the server fetches at resolve time

Only metadata, and only through sanctioned surfaces:

- **oEmbed** (`youtube.com/oembed?url=…`) — title, author, thumbnail. No key needed.
  Cheapest liveness/embeddability smoke test.
- **YouTube Data API v3** `videos.list` (parts `snippet,contentDetails,status`) —
  duration, default language, `status.embeddable`. Needs an API key; quota is generous
  for this volume. ⛔ **Not used in v1** (§ 11.2) — the fields it would supply are
  § 3.2 staff-entered fields instead.

⚠️ **Neither source returns the aspect ratio**, so neither settles § 7.1's layout
switch: oEmbed's `width`/`height` describe the suggested *embed box*, and `videos.list`
has no aspect field at all. The only signal in either is thumbnail dimensions, which is
a heuristic — hence the one-bit "vertical?" staff field in § 3.2.

⚠️ **The Data API cannot supply the transcript, only rumours of one.**
`contentDetails.caption` is a `"true"`/`"false"` string reflecting *manual* captions
only, and is unreliable; `captions.list` genuinely enumerates tracks, but
`captions.download` requires the video **owner's** OAuth. That asymmetry is the whole
reason A″ exists (§ 3), and it is why taking the key would not have moved acquisition
one inch.

⚠️ **Reject non-embeddable videos at resolve time**, with a clear message. An
uploader can disable embedding; discovering that after the parse job has run wastes
the expensive half of the pipeline and strands a `ready` track no one can watch.

### 2.3 Playback is an embed, never a download

The learner watches the video **in YouTube's own IFrame player**, driven by the
IFrame Player API (§ 6). The creator gets the view, ads serve normally, and this
project redistributes nothing. This is the sanctioned path and it should stay the
only playback path.

---

## 3. Transcript acquisition — ✅ DECIDED (A″, staff-sourced)

**Resolved 2026-08-28.** This was the one blocking question in the draft; it is now
settled as **A″ — staff-sourced**, described below. The alternatives are kept because
the acquisition step stays isolated behind a single service method, so any of them can
be layered in later without touching normalization, parsing, or playback.

The relevant asymmetry in YouTube's own APIs, which is why this question existed:

- `captions.list` (Data API v3) will *enumerate* a video's caption tracks.
- `captions.download` requires **the video owner's** OAuth. There is no official,
  keyed way to download a third party's caption track.

So an official-API-only route gets you the knowledge that a Chinese track exists,
and not its contents. The three real options:

**Option A″ — staff-supplied transcript. ✅ CHOSEN.**
An internal team member opens the video on YouTube while signed in, uses the
*Show transcript* panel, and loads the result into the catalog through an internal
tool. Mechanically identical to A′ — a human using YouTube's own interface — but the
human is staff, not a learner. Consequences that ripple through the whole design:

- **There is no learner-facing paste box, and no learner-facing URL field at all.**
  The learner surface is a **browse** surface over already-prepared videos (§ 9).
- **The catalog is an editorial product.** Someone chooses what is worth preparing,
  which means level, topic and quality can be curated rather than hoped for. This
  makes § 4.3's `needs_review` state a real workflow step with an owner, not a
  dead-end status.
- **Sharing and moderation stop being questions.** A staff-built catalog is app-wide
  by construction (§ 11 Q5) and gated at procurement (§ 11 Q10).
- **The § 3.1 tier is a procurement choice, not luck.** Staff can simply decline a
  video whose only track is a poor `auto` one, which is the cheapest possible fix for
  the quality problem the tier table describes.
- ⚠️ **Throughput is now a staffing question.** Catalog growth is bounded by person-hours,
  not by compute. If that becomes the binding constraint, B′ is the escape hatch —
  which is precisely why acquisition stays behind one swappable service method.

**Option A′ — learner-supplied transcript (the earlier v1 recommendation).**
The learner opens the video's description on YouTube, taps *Show transcript*,
copies it, and pastes it into a textarea. YouTube's transcript panel emits
timestamped lines that parse trivially (`m:ss` / `h:mm:ss` + text). The app never
talks to YouTube for caption data at all.
*Cost:* one manual step — **once per video, ever**, because tracks are shared
app-wide (§ 1). The second learner to paste that URL pays nothing.
*Benefit:* zero ToS exposure, zero bot-detection maintenance, no proxy budget, and
it works today from a datacenter IP, which B′ largely does not.
*Why not chosen:* it puts a data-entry chore in front of a learner who wanted to watch
a video, and it makes catalog quality a function of whatever learners happen to paste.
Retained as a plausible **v2 power-user path** on top of the curated catalog.

**Option B′ — server fetches the timed-text track.**
Nicer UX (paste URL, done). Technically straightforward — the `timedtext` endpoint,
or `yt-dlp --write-auto-sub --write-sub --skip-download`, which pulls **captions
only and no media bytes**. Two real problems, and the second is the one that bites:
1. It is outside YouTube's Terms of Service, which permit access only through the
   API and the interfaces YouTube provides.
2. YouTube actively blocks automated caption access from datacenter IPs. Expect bot
   challenges and to need cookies / a residential proxy / token upkeep, i.e. a
   dependency that breaks on YouTube's schedule rather than ours. **Do not build
   this without an explicit decision from the user**, and if built, treat it as
   best-effort with A′ as the always-present fallback.

**Option C′ — a commercial transcript API.**
Moves the operational fragility off our box and onto a vendor with a support
contract; does not change the underlying ToS question, it only changes who is
answering for it. Adds a per-video cost and a third-party dependency.

**Resolution: A″.** Everything below assumes it. The acquisition step remains isolated
behind one service method (`VideoSubtitleService`, § 9) so A′/B′/C′ can be added later
as additional intake paths rather than as a rewrite — the cue model and everything
downstream of normalization are already source-agnostic.

### 3.1 Track quality tiers

Whatever the source, record **which kind of track** we got — it predicts cue quality
and should gate the § 4.3 review state:

| Tier | What it is | Expect |
|---|---|---|
| `manual` | Creator-uploaded captions | Punctuated, sentence-shaped, accurate. The good case. |
| `auto` | YouTube ASR | No punctuation, no speaker breaks, proper nouns and low-frequency vocabulary mis-heard — i.e. wrong on exactly the words a learner opened the app for. |
| `translated` | YouTube's machine translation of another track | Do not use as the foreign-language source. Ever. |

⚠️ An `auto` track is usable but must not be presented as authoritative. It is the
strongest argument for the human cue-correction pass (§ 4.3).

### 3.2 What the staff member must provide (the intake contract)

The intake *tool* is deferred (§ 11.11), but what it must hand the server is not — this
is the input contract the service and DAL can be designed against today. Fields are
grouped by who supplies them, because that split is what determines how much tool there
eventually has to be.

**Required, typed by the staff member:**

| Field | Notes |
|---|---|
| **YouTube URL** | Any form; `parseYoutubeVideoId` (§ 2.1) normalizes it to the id. The staff member never types a bare id. |
| **The transcript** | Raw timed text, as obtained (§ 3, A″). Format is a parser concern, not a human one — the intake should accept whatever the source gives (SRT/VTT/JSON-ish) and normalize in § 4, rather than asking a person to reformat. |
| **`language`** | Which language's catalog this belongs to (§ 11.9). Not inferrable reliably enough from metadata to be worth guessing. |
| **`trackKind`** | `manual` / `auto` / `translated` (§ 3.1). Only the person who fetched the track knows which it was, and § 4's punctuation-restoration pass and § 4.3's quality gate both branch on it. This is the single most important human-supplied field. |
| **`tags`** | A list of strings (§ 9.1). A video is rarely about exactly one topic, so this is an array, not one value. |

**Required, but a judgement call rather than a transcription:**

| Field | Notes |
|---|---|
| **Embeddable?** | Confirmed by the staff member having actually watched it embedded, unless the Data API is supplying `status.embeddable` (§ 2.2). § 2.2's ⚠️ is what makes this a required gate and not a nicety. |
| **Vertical (Short)?** | One bit. Cheap insurance against the § 7 thumbnail-aspect heuristic being unreliable. |
| **`level` override** | Optional. The recommendation (§ 9.1) is that `level` is *computed* from the parsed track and the staff member only overrides it — so this field is blank in the common case, and set only when the video is lexically easy but acoustically or culturally hard. |

**Supplied by the server, never typed:** `title`, `channelName`, `durationMs`,
`width`/`height`, `thumbnail` (§ 2.2), `youtubeVideoId` (§ 2.1), every cue field
(§ 4–5), `status`, `createdAt`, `addedByUserId`.

⚠️ **The asymmetry above is the design point.** Only five fields genuinely require a
human, and three of them are one word. Everything expensive — segmentation, tagging,
translation, difficulty — is derived. That is what keeps A″'s ⚠️ staffing bound (§ 3)
as low as it can be, and it is why the intake tool can start as a script without
trapping anyone: the human's part of the job is small by construction, and the
*review* half (§ 4.3) is where a real UI would eventually earn its keep.


### 3.3 ⚠️ Survey 2026-08-28 — Chinese caption tracks are scarce, and scarce in a patterned way

A small empirical probe (14 videos, watch-page `captionTracks` metadata only) before
committing to a cue shape. It changed the risk picture more than it changed the schema.

**Eight "learn Chinese" videos — the obvious seed content — yielded zero usable tracks:**

| What was found | Count |
|---|---|
| No caption tracks at all | 4 |
| Tracks present, but **none in Chinese** | 4 |
| A Chinese track | **0** |

The two failure modes are distinct and both matter:

1. **Teaching channels caption in the learner's language, not the target language.** One
   video carried eight hand-made tracks — Dutch, English, French, German, Italian,
   Japanese, Korean, Spanish — and no Chinese. Those are *translation subtitles for a
   Chinese lesson*, which is the exact inverse of what vsp needs.
2. **YouTube's ASR mis-detects the spoken language.** Two videos of Mandarin speech
   carried an auto track labelled `en` and `es` respectively. Such a track is not a poor
   transcript, it is a **nonsense** one, and it is labelled confidently.

**Native Chinese content is the better source.** Six Chinese-language videos (podcast /
interview) were surveyed: **4 of 6 carried a hand-made Chinese track**, several with both
`zh-Hans`/`zh-CN` and `zh-TW`. Two had none.

Three consequences for the design:

- ⚠️ **Procurement should target native content, not pedagogical content.** This inverts
  the intuitive seeding strategy and is the single most actionable finding here. It also
  sharpens § 7's point that Shorts are good content: short native clips, not lessons.
- ⚠️ **`zh-Hans` vs `zh-TW` is a real choice at intake**, not a formality — the same
  video can offer both, and they are different text. Whether traditional-script tracks
  are accepted at all is a question the catalog has to answer. ❓
- **Language must be verified, never trusted.** A track's `languageCode` is a claim, and
  finding 2 shows the claim can be simply wrong. The § 4.3 quality gate should sanity-
  check that the text is actually in the expected script before a video reaches `ready`.

#### Server-side fetching (B′) is now empirically harder, which supports A″

The signed `/api/timedtext` URL extracted from a watch page returned **HTTP 200 with an
empty body** when fetched outside a browser session, with and without a matching
`Referer`. This is consistent with YouTube's known hardening of that endpoint. It is not
proof that B′ is impossible — a real browser context or a maintained tool such as
`yt-dlp` may still work — but it does mean B′ is a moving target requiring maintenance,
rather than the cheap fallback § 3 implied. **A″ is doing more work than it looked like.**


---

## 4. Cue normalization

A YouTube caption track is **not** a cue track. It is timed to speech and to the
two-line caption box, so its entries split mid-clause, overlap by design (the
rolling auto-caption style repeats the previous line), and in `auto` tracks carry no
punctuation at all. Feeding it straight to the segmenter produces half-words at
entry boundaries and popups on fragments.

Normalization is the new middle stage, replacing OCR:

1. **De-duplicate rolling entries.** Auto-caption entries frequently restate the
   tail of the previous entry. Drop the repeated prefix, keep the earliest timestamp
   for the retained text.
2. **Merge to sentence shape.** Join consecutive entries until a sentence boundary
   (`。！？`, or a long pause for unpunctuated `auto` text). The merged cue's
   `startMs` is the first entry's start, its `endMs` the last entry's end.
3. **Restore punctuation** on `auto` tracks — a model pass over the merged text.
   This is the same "repair" role the OCR path had, and can reuse its budget posture
   (a daily usage cap in the shape of `dictionary_ai_usage`).
4. **Enforce the invariants**: cues ordered, non-overlapping, `endMs` exclusive.
   Gaps are legal and mean silence/no-caption. § 6.2's binary search depends on both.

⚠️ Merging trades timing precision for linguistic wholeness, and for this feature
**wholeness wins** — a learner loops a sentence, not a caption box. But a merged cue
can run several seconds, which makes *loop cue* coarser. If that reads badly in
practice, the fix is a sub-cue boundary list on the cue, not un-merging.

### 4.3 Quality gate

Normalization ends with a per-video **confidence score** (driven mostly by the § 3.1
tier). When it is low, the video lands in `needs_review` rather than silently serving
garbage cues — mirroring the human-in-the-loop posture of
[DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md). An editable cue track (fix
a line, nudge a boundary) is the natural v2 of this gate, and is worth more here than
it was in the OCR design, because `auto` tracks are common and reliably imperfect.

---

## 5. Cue parsing & enrichment

Once a video has clean, sentence-shaped timed text, the rest is **already-solved work
in this codebase** and must reuse it rather than reimplement it:

- **Segmentation** — the same greedy segmentation algorithm (gsa) the Reader and est
  use, so a cue segments identically to the same sentence typed into the Reader.
  See `src/features/reader/documentSegmentation.ts` and the est read path.
- **Per-segment metadata** — pos / sense / number / tense tagging, keyed by gsa
  segment string, exactly as described in
  [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) § two-phase tagging. The alignment
  rule from that doc applies verbatim: **persist the segmentation, key the dicts by
  the persisted segments**, never by model-emitted tokens.
- **Rendering** — segments render as **cpcd** through `ForeignText`; cpcd is never
  used directly. Tapping a segment opens the same definition popup the est tab uses.
- **Unknown words** — a cue segment with no discoverable cdet row goes through the
  existing lazy-enrichment path
  ([DISCOVER_LAZY_ENRICHMENT.md](./DISCOVER_LAZY_ENRICHMENT.md)), not a new one.

The cue is therefore the only genuinely new data shape in the feature.

### Cue shape (proposed)

```ts
type SubtitleCue = {
  index: number;          // 0-based order within the track
  startMs: number;        // inclusive
  endMs: number;          // exclusive
  text: string;           // normalized, punctuated foreign text
  segments: string[];     // persisted gsa segmentation (authoritative)
  translation?: string;   // English, generated once per cue
  confidence?: number;    // normalization confidence, 0–1
};
```

---

## 6. Playback surface

The learner-facing requirement is unusual and should shape the implementation:
**speed changes and scrubbing are the primary interactions, not incidental ones.**
People re-watch the same three seconds eight times.

### 6.1 The IFrame Player API is the engine

Playback is YouTube's `<iframe>` player, driven through its JS API. **Confirmed
2026-08-28: the whole control surface can live outside the frame.** The IFrame API is
a `postMessage` transport-control channel — no pixel access and no DOM access into the
frame, but complete control over position, rate and play state, which is all scrubbing
needs. Crucially, **`controls: 0` hides YouTube's own control bar** (a documented,
supported `playerVars` value), so the frame renders only the picture and every control
the learner touches is ours.

It covers the control set almost line for line:

| Control | Behaviour | API |
|---|---|---|
| **Speed** | 0.5× / 0.75× / 1× (learners live at the low end). YouTube pitch-corrects, so slowed speech stays intelligible — no `preservesPitch` to set. | `setPlaybackRate()`; the legal set comes from `getAvailablePlaybackRates()` |
| **Prev / next cue** | Seek to the previous/next cue's `startMs`. The workhorse control — bigger tap targets than the scrub bar. | `seekTo()` |
| **Replay cue** | Seek to the current cue's `startMs` and play. | `seekTo()` |
| **Loop cue** | Toggle; when the clock passes `endMs`, seek back to `startMs`. | polled clock + `seekTo()` |
| **Scrub bar** | Our own bar over `seekTo`, with **cue tick marks** so a learner aims at a line, not a timestamp. Snap-to-cue-start on release (❓ always, or only within a threshold?). | `seekTo()`, `getDuration()` |
| **Cue list** | Scrollable transcript beside/below the video; tapping a line seeks to it. Also the surface for reading without playing. | `seekTo()` |

⚠️ **YouTube's own captions must be turned off** in the embed — we are rendering the
cue track ourselves and a burned-in-looking duplicate underneath it is confusing.

#### Required `playerVars`

```ts
playerVars: {
  enablejsapi: 1,
  controls: 0,        // our control surface, not YouTube's
  cc_load_policy: 0,  // YouTube's own captions OFF — we render the cue track ourselves
  playsinline: 1,     // iOS: stay inline; without it Safari hijacks to the native
                      // fullscreen player and our entire control surface disappears
  rel: 0,
  origin: window.location.origin,
}
```

`playsinline: 1` is **not optional**. On iOS without it the learner ends up scrubbing
Apple's player, not ours, and every control in the table above becomes unreachable.

#### `seekTo`'s second argument is the scrub-drag mechanism

`seekTo(seconds, allowSeekAhead)` — the boolean is the difference between a scrub bar
that feels live and one that stalls the player on mobile:

```ts
player.seekTo(t, /* allowSeekAhead */ false)  // during drag: buffered range only, no network request
player.seekTo(t, /* allowSeekAhead */ true)   // on release: real request, exact position
```

With `false` the player will not issue a new media request and stays inside what it has
already buffered, which is what makes continuous drag feedback affordable. **Passing
`true` on every `pointermove` is the mistake** § 6.2's throttling advice is guarding
against; the throttle helps, but the flag is the actual fix.

**Constraints to design around, not fight:**

- **No frame callback.** There is no `timeupdate`; the current cue comes from polling
  `getCurrentTime()` on an interval (~100–200 ms is the usual compromise). Fine for
  highlighting; *loop cue* will overshoot `endMs` by up to one poll before seeking
  back. Accept it, or shorten the interval while a loop is armed — loops are the
  exception, so the higher poll rate costs nothing in the common case.
- **Seek precision is keyframe-bounded.** Keyframe intervals can run several seconds,
  so even with `allowSeekAhead: true` the player lands *close to*, not exactly on,
  `startMs`. ⚠️ For *replay cue* and *prev cue*, therefore **target ~150 ms before**
  `startMs`: a learner would far rather catch a moment of the preceding silence than
  lose the first syllable of the line.
- **No pixel access.** The frame is cross-origin — no canvas draw, no frame capture.
  (This is also why the § 8 OCR path could never run client-side.)
- **We cannot restyle YouTube's chrome** — we can only hide it (`controls: 0`). The
  scrub bar with cue ticks is ours, drawn above/below the player.
- **Ads interrupt**, and the poll must not mistake an ad break for playback progress.
  ❓ The player-state behaviour during an ad break is under-specified in YouTube's
  documentation and should be **verified empirically** before the loop logic is
  trusted — a loop must not fight an ad.
- **Gestures inside the frame belong to YouTube.** With `controls: 0` the iframe still
  swallows pointer events, so tap-on-video does nothing for us. A transparent overlay
  would capture those taps, but it obscures the player — a far more visible ToS
  problem than anything else in this design. ⚠️ **Do not overlay the player**; put
  play/pause in our own control bar where it is unambiguous.
- **Mobile autoplay needs a user gesture** — the first play is always a tap.
- **Some videos are embed-disabled** (§ 2.2 rejects them at procurement time).

### 6.2 Cue lookup must not be a linear scan

At poll rate a naive `cues.find(...)` is wasteful and worsens with long videos:

1. Keep the **current cue index** in a ref and advance/retreat from the last known
   index (O(1) for normal playback, O(k) for a small seek).
2. On a **large seek** (scrub drag), binary-search `startMs` instead of walking.
   This is why cues must be ordered and non-overlapping (§ 4).

Scrub drags drive a **throttled** seek with the final position applied on release, and
each throttled seek passes `allowSeekAhead: false` (§ 6.1) so it never issues a media
request; only the release seek passes `true`. Seeking with `true` on every pointermove
stalls the embedded player on mobile.

### 6.3 Touch rules

Per [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md): the page defaults to
`touchAction: "none"`, the transcript is the opt-in scrolling container, and the page
calls `useBlockEdgeSwipe(true)` so a scrub drag from near the screen edge does not
trigger a browser back-navigation. Our scrub bar handles its own pointer events and
must not let them reach the app shell.

⚠️ The `<iframe>` is a **foreign event surface** — the app's global touch rules stop
at its boundary, and gestures inside it belong to YouTube. Keep every control of ours
outside the frame.

### 6.4 Minute points — ✅ DECIDED (accrues, under the ordinary activity rule)

**Decided 2026-08-28: watching accrues minute points
([MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md)), but vsp gets no special
accrual path — the app-wide activity rule applies unchanged. Playing a video does not,
by itself, keep the learner active.**

Concretely, vsp is an *eligible* page but **not** an auto-active one:

- It must **not** be added to `MINUTE_POINTS_AUTO_ACTIVE_PAGES` (`src/constants.ts`).
  That list exists for games, which are studied passively for a few seconds before the
  first tap; a video is the exact case the list's own comment warns about — opening a
  page and walking away.
- Accrual therefore runs on the ordinary `useActivityDetection` contract: a
  `click` / `keydown` / `touchstart` / `pointerdown` marks the learner active and holds
  for `ACTIVITY_TIMEOUT_MS` (15 s). A learner who is genuinely drilling — replay cue,
  prev/next, scrub, tapping transcript lines, changing speed — re-arms that window
  constantly and accrues normally. A learner who presses play and stops touching the
  screen stops accruing after 15 s, which is the correct outcome.
- **No player-state signal feeds accrual.** `onStateChange` drives cue highlighting and
  the loop, never the minute-points timer. This is what makes the 0.5× rewatch-loop
  farm impossible without a special rule: the points follow interaction, not playback.

⚠️ **The iframe is invisible to activity detection.** `useActivityDetection` listens on
`document`; pointer events inside the cross-origin frame never reach it (§ 6.3). Since
§ 6.1 already forbids putting controls inside or over the player, every control the
learner touches is ours and fires normally — but this is a second, independent reason
the *do not overlay the player* rule matters, and a reason a hypothetical
"tap-the-video-to-pause" affordance could never be added later without breaking
accrual.

---

## 7. YouTube Shorts ("YouTube reels")

The product is called **Shorts**; there is no separate "reels" on YouTube, and the
name should not appear in code or UI. Mechanically a Short is not a separate object —
it is an ordinary video with an ordinary id, so § 2.1 normalization makes it Just
Work, and the IFrame player embeds it like anything else. Four differences worth
designing for:

1. **Vertical (9:16).** The player letterboxes it inside a 16:9 container. The vsp
   layout should read the aspect from metadata and switch between a *video-beside-
   transcript* layout and a *tall-video-above-transcript* layout, rather than pillarboxing
   a Short into a landscape box on a phone.
2. **Length is a feature.** Shorts run well under the drill loop's attention budget —
   short enough that a learner will replay the whole thing several times. This is
   arguably the *best* content shape for vsp, and is a good reason to seed the feature
   with Shorts rather than 20-minute videos.
3. ⚠️ **Burned-in captions are common.** Short-form creators bake animated word-by-word
   captions into the pixels with editing apps. Such a Short may have a poor `auto`
   track or none at all, while being visually full of text — the exact IG/RedNote
   problem, back again on a subset of YouTube. Detection is cheap (no track, or a very
   sparse one, on a video that is clearly speech-heavy); the *fix* is § 8, which is
   out of v1. Until then this is an honest "we can't caption this one" case, and the
   UI should say so rather than serving a thin `auto` track as if it were complete.
4. **Speech is fast, slangy, and often over music** — the hardest case for ASR, so
   Shorts skew toward the low-confidence end of § 4.3.

✅ **DECIDED 2026-08-28 — Shorts are a first-class content type.** They are a
separately-presented shape in the catalog (§ 9), not an incidental URL form. Two
consequences follow immediately:

- **`length` is a catalog facet** (§ 9 browse), and "Short" is its own bucket rather
  than a footnote on a duration slider.
- **The § 7.1 aspect switch is required for v1**, not deferred. A first-class vertical
  shape that pillarboxes into a landscape box on a phone is not first-class. This makes
  `width`/`height` on `videos` (§ 10) load-bearing rather than nice-to-have.
  ⚠️ **Neither metadata source returns a video's true aspect ratio directly.** oEmbed's
  `width`/`height` describe the *suggested embed box*, not the picture, and the Data
  API's `videos.list` has no aspect field either. The practical signal in both is the
  **thumbnail dimensions** (`thumbnail_width`/`thumbnail_height`, or
  `snippet.thumbnails.*`). ❓ This should be **verified empirically against a real
  Short** before § 7.1's layout switch is built on it — and if the thumbnail proves
  unreliable, staff can simply set the flag by eye at intake, which is a one-bit
  editorial judgement and costs nothing.

Point 3's burned-in-caption problem is therefore a **procurement filter**, not an edge
case: staff decline such a Short rather than shipping a thin `auto` track.

---

## 8. Burned-in OCR path (⛔ out of v1, retained for § 7.3)

Kept because Shorts can still need it, and because a future IG/RedNote path would
need all of it. **Nothing here is in scope for v1**, and it is the only part of the
feature that would require the server to hold media bytes.

1. Sample frames at ~4 fps (subtitles rarely change faster than ~2 Hz).
2. Detect the subtitle band once per video — the region with the highest text-pixel
   density across sampled frames — rather than assuming a fixed rectangle.
3. OCR each cropped frame → candidate line(s) of Chinese text.
4. Collapse runs of (near-)identical OCR text into one cue; the run's first/last frame
   timestamps become `startMs`/`endMs`. "Near-identical" is a normalized edit-distance
   threshold, because OCR jitters by a character or two between frames of one caption.
5. A model pass repairs OCR errors from neighbouring-cue context and drops
   non-subtitle text (watermarks, usernames, sticker text).

Open if it is ever revived: **which OCR engine** — PaddleOCR (best for Chinese, heavy
Python dep; note the musl backend container's native-dep constraint), a hosted vision
API, or a Claude vision call per sampled frame (simplest to wire, most expensive, would
sit under a usage cap). That choice drives whether extraction runs in-container, in a
sidecar, or off-box. And it revives every question this retarget deleted: where bytes
live, size/duration caps, and how they are obtained at all.

---

## 9. Layering

| Layer | Component | Responsibility |
|---|---|---|
| **Client page** | `src/features/video/VideoCatalogPage.tsx` | The **browse** surface over prepared videos — the learner's entry point. A **Node** page, reached from an **hp row** (§ 11.6 — provisional placement). |
| **Client page** | `src/features/video/VideoSubtitlePage.tsx` | The player surface, drilled into from the catalog. A **Node** drill-in (back arrow). |
| **Client hooks** | `useSubtitleTrack`, `usePlayerClock` | Cue lookup, current-cue state, speed/loop state, the polled clock. Keyed on `user?.id` / `youtubeVideoId` — **never** on `token` (see CLAUDE.md § token rule). |
| **Client player** | `src/features/video/YouTubePlayer.tsx` | Owns the `YT.Player` instance and its lifecycle; exposes the imperative `PlayerHandle` below. The **only** file that knows YouTube exists. |
| **Client API** | `src/api/videoSubtitles.ts` | All server calls via `src/api/http.ts`; no function takes a `token`. |
| **Controller** | `server/controllers/VideoSubtitleController.ts` | camelCase routes: the learner-facing catalog/track reads, plus the **staff-only** transcript intake (§ 3, A″) behind an admin guard. |
| **Service** | `server/services/VideoSubtitleService.ts` | Orchestration: resolve id, dedupe, acquire transcript (§ 3), kick off/await the parse job, assemble the read model. **Writes no SQL.** |
| **DAL** | `server/dal/implementations/VideoSubtitleDal.ts` + interface | All SQL. Language-scoped like every det/vet query. |
| **Util** | `server/utils/youtubeUrl.ts` → `parseYoutubeVideoId` | Pure URL → id normalization (§ 2.1). |
| **Pipeline** | `server/scripts/parse-video-subtitles.ts` | normalize → punctuate → segment → tag. Restartable, idempotent per `youtubeVideoId`. |

### The player boundary

`YouTubePlayer.tsx` exposes exactly this, and nothing else:

```ts
type PlayerHandle = {
  seek(ms: number, exact: boolean): void;  // exact -> seekTo(..., allowSeekAhead)
  play(): void;
  pause(): void;
  setRate(r: number): void;
  getTimeMs(): number;                     // synchronous read, called by the poll
  getState(): PlayerState;
};
```

Everything above it — scrub bar, cue ticks, prev/next/replay/loop, the transcript list
— is ordinary React reading `currentTimeMs` from `usePlayerClock` and calling this
handle. That is what keeps § 9's isolation claim true in practice: adding a second
video source later would replace one file and touch neither the page nor the server.

⚠️ **The clock poll keys on `user?.id` / `youtubeVideoId`, never on `token`.** A silent
token refresh must not restart the player or reset the current cue — that is the
CLAUDE.md token rule, and a mid-video reset would be the 2026-07-02 Word Search bug
again in a new surface.

⚠️ **The scrub bar calls `useBlockEdgeSwipe(true)`** (§ 6.3) so a drag beginning near
the screen edge does not trigger browser back-navigation mid-scrub.

Parsing stays a **job, not a request handler** — the model passes (punctuation repair,
per-segment tagging, per-cue translation) are minutes of work on a long video. The
staff intake endpoint returns immediately with a `parsing` status and the internal tool
polls; a video becomes visible in the learner-facing catalog only at `ready`.

Isolating YouTube inside `YouTubePlayer.tsx` and `youtubeUrl.ts` is deliberate: if a
second source is ever added, the cue model, the page, and the whole server pipeline
are already source-agnostic.

### 9.1 Catalog browse — the four facets

**Decided 2026-08-28.** The catalog is categorized on exactly four axes. Three of them
are cheap; one is editorial and is the real cost.

| Facet | Source | Cost | Notes |
|---|---|---|---|
| **Channel** | `videos.channelName` — already proposed, oEmbed supplies it free | none | Pure grouping. The most useful facet for the least work: a learner who likes one creator's pace wants more of that creator. |
| **Length** | derived from `videos.durationMs` | none | Bucketed, not a slider. **Short** (§ 7, its own first-class bucket) / medium / long. Buckets, because a learner picks by attention budget, not by minutes. |
| **Tags** | `videos.tags` (`text[]`) — staff-assigned at intake | low | ✅ **Decided 2026-08-28: a string array named `tags`, not a single `topic`.** A video is rarely about exactly one thing, and an array is what lets one search box query every facet at once (below). |
| **Level** | ✅ **computed** from the parsed cue track, with a staff override | low | Decided 2026-08-28. See below. |

#### Level is computed, not hand-assigned ✅ DECIDED 2026-08-28

Once a video reaches `ready`, every cue has been gsa-segmented against det (§ 5) — so
the catalog **already knows the video's entire vocabulary** as a by-product of parsing.
`level` is derived from that distribution rather than typed by a person:

```
on status -> ready:
  segments  = every cue's persisted gsa segments
  join det on (segment, language)
  histogram over frequencyScore / HSK tier
  level = f(p90 rarity, % of segments with no discoverable det row)
```

This is objective, uniform across staff members, **recomputable** if the scale ever
changes, and free — it reuses the same difficulty signal the games already use for
lending tiers. A hand-assigned label would have been none of those things.

⚠️ **But it is overridable, because vocabulary is not the only kind of hard.** A video
can be lexically trivial and still brutal — § 7.4's fast, slangy speech over music is
the standard case, and no vocabulary histogram will ever see it. So the schema carries
both: a computed `level` and a nullable staff `levelOverride`, with reads taking
`COALESCE(levelOverride, level)`.

⚠️ **`level` is therefore not available at intake.** It cannot be computed until the
parse job finishes, which is a second reason a video is invisible in the catalog until
`ready` (§ 9) — before that it has no difficulty to browse by.

#### One search box over every facet

`tags` being an array rather than a single `topic` is what makes the browse surface a
**search** rather than four dropdowns: a query string can match the title, the channel
name, or any tag, and combine with the two numeric facets (level, length) as filters.
The learner types *cooking* and gets videos tagged `cooking`, videos from a cooking
channel, and videos whose title says so — one input, no taxonomy to learn.

⚠️ **The cost of an array is that nothing enforces the vocabulary.** `cooking`, `food`
and `Cooking` are three different tags and the facet fragments silently. There is no
learner-side tagging to self-correct it, so the discipline has to live at intake:
suggest existing tags first, and normalize case and whitespace on write. ❓ Whether
that is enough, or whether a `video_tags` lookup table is eventually needed, is
deferred until the catalog is large enough to show the problem.

Facets are **language-scoped** (§ 11.9) — a Spanish learner never sees Chinese videos
in the catalog, the same rule every det/vet read follows.

---

## 10. Proposed persistence ❓ (nothing created — confirm before implementing)

Two new tables are proposed. Both need explicit confirmation.

1. **`videos`** — one row per video: `id`, `youtubeVideoId` (unique), `language`,
   `title`, `channelName`, `durationMs`, `width`/`height` (for the § 7.1 aspect
   switch), `status` (`pending` | `parsing` | `ready` |
   `needs_review` | `failed`), `trackKind` (`manual` | `auto` | `translated`),
   `transcriptSource` (`staff` | `pasted` | `fetched` | `vendor` — `staff` is A″, the
   only one in scope), `addedByUserId` (now **the staff member who prepared it**, not a
   learner), `createdAt`.
   ❓ **Plus the columns added by the § 9.1 facet decision**: `tags` (`text[]`,
   staff-assigned) and `level` (`smallint`, **computed** from the parsed cue track's
   det frequency distribution) beside a nullable `levelOverride`. `durationMs` and
   `channelName` already cover the other two facets. `width`/`height` are **replaced by
   a single `isVertical` boolean** — neither metadata source returns a true aspect ratio
   (§ 2.2), and § 7.1 only ever asks one yes/no question.
2. **`video_subtitle_cues`** — one row per cue: `videoId`, `index`, `startMs`, `endMs`,
   `text`, `segments` (jsonb), `translation`, per-segment metadata dicts (jsonb,
   est-shaped), `confidence`. Unique on (`videoId`, `index`).

Alternative: store the whole cue track as one jsonb column on `videos`. Simpler, and
it matches how `exampleSentences` is stored — but it forfeits per-cue querying ("which
videos contain 差不多?"), which is a plausible v2: *find a real clip using the word you
just learned*. ❓ Which way do we go?

**No storage decision is needed for media** — there is none (§ 1). The `/app/data`
bind-mount fragility recorded for this machine is not in play.

---

## 11. Open questions (consolidated)

1. ✅ **RESOLVED 2026-08-28 — transcript acquisition is A″ (staff-sourced).** See § 3.
   Was the blocking question; A′/B′/C′ remain available as later intake paths.
2. ✅ **RESOLVED 2026-08-28 — oEmbed only in v1.** No API key, no Cloud project, no
   quota. Under A″ a human is present at every intake, which is exactly the labour the
   Data API would have automated: duration and `status.embeddable` become § 3.2
   staff-supplied fields instead. The key can be added later with **zero schema
   change** — it would only ever populate columns that already exist. See § 2.2.
3. ✅ **RESOLVED 2026-08-28 — cues get their own table.** `video_subtitle_cues`, one
   row per cue, unique on (`videoId`, `index`). The deciding argument was the per-cue
   query (*find a real clip using the word you just learned*), which a jsonb blob
   forecloses permanently; the § 4.3 review workflow was the second (fixing one
   mis-merged cue must not rewrite a 1500-entry document). This deliberately diverges
   from the `exampleSentences` blob precedent — a cue track is queried *across* videos,
   an example-sentence set never is.
4. ✅ **RESOLVED 2026-08-28 — yes, under the ordinary activity rule.** vsp is an
   eligible page but not an auto-active one; playback alone does not maintain
   activity. See § 6.4.
5. ✅ **RESOLVED 2026-08-28 — app-wide, by construction.** A staff-curated catalog has
   no per-learner ownership to scope, so the § 1 shared-track model is now the only
   model. Friend-sharing of a *specific video* remains a possible v2 nicety, but it is
   a link-sharing feature, not a visibility model.
6. ✅ **RESOLVED 2026-08-28 — a Home (hp) row, provisionally.** The catalog hangs off
   the hp hub menu alongside Night Market / Games / Reader / Dictionary. Explicitly a
   **placeholder placement**: the user's instruction was *"put a link in home, we will
   reorganize everything later"*, so this is a parking spot, not a considered
   information-architecture decision. Whoever does the eventual hub reorganization
   should feel free to move it — the Reader argument (a video is a Reader document with
   a clock attached) remains the strongest alternative.
7. ✅ **RESOLVED 2026-08-28 — first-class content type.** `length` becomes a catalog
   facet and the § 7.1 aspect switch moves into v1 scope. See § 7.
8. ✅ **RESOLVED 2026-08-28 — snap within a threshold.** On release, snap to the
   nearest cue `startMs` only if it is within ~300 ms (`SNAP_THRESHOLD_MS`, a tuning
   constant, not a contract); otherwise honour the raw position. A magnet, not a rule:
   it helps when the learner was clearly aiming at a tick mark and gets out of the way
   on videos with long silences or music. ⚠️ **A snapped seek must still apply § 6.1's
   ~150 ms pre-roll** — otherwise "snap to the line" reliably clips the line's first
   syllable, which is the opposite of what snapping is for.
9. ✅ **RESOLVED 2026-08-28 — Spanish is allowed.** Both languages from the start.
   The pipeline is already language-agnostic apart from gsa segmentation, so the only
   real requirement is that `videos.language` is honoured everywhere and the catalog
   is language-scoped like every other det/vet read. Note the pleasant asymmetry: the
   language needing *less* enrichment (Spanish skips gsa — § 5 segments on whitespace,
   and `ForeignText` renders `es` as plain text, not cpcd) also has far better YouTube
   caption coverage, so Spanish will likely be the easier half of the catalog to
   procure.
10. ✅ **RESOLVED 2026-08-28 — moderation is procurement.** Learners cannot introduce
    a video at all, so the allow-list is simply the catalog. If A′ is ever added as a
    v2 power-user path, this question reopens with it.

11. ⏸️ **DEFERRED 2026-08-28 — the staff intake tool is out of scope for now.** Its
    *shape* (a page behind an admin guard vs. a script) is explicitly not being decided
    yet. What the tool must eventually collect is specified in § 3.2 instead, so that
    the server-side intake contract can be designed without waiting on the UI.

12. ✅ **RESOLVED 2026-08-28 — four facets: level, tags, length, channel**, queried
    through **one search box** rather than four dropdowns. `topic` became `tags`
    (`text[]`) for that reason. See § 9.1.
13. **Does the player-state behaviour during an ad break need special handling?**
    Needs empirical verification before the loop logic is trusted (§ 6.1).

---

## 12. Related documents

- [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) — segment tagging + popup model this reuses
- [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) — which definition form a popup shows
- [DISCOVER_LAZY_ENRICHMENT.md](./DISCOVER_LAZY_ENRICHMENT.md) — enriching words the video introduces
- [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) — Node-page archetype, touch/scroll rules
- [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md) / [BACKEND_LAYERING.md](./BACKEND_LAYERING.md) — layer placement rules cited in § 9
- [DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md) — model for a human cue-correction pass
- [MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md) — the accrual clock question in § 6.4
