# Video Subtitles (vsp — video subtitle player)

**STATUS: DESIGN / DRAFT.** Nothing in this document is implemented yet. Sections
marked ❓ are open questions for the user; sections marked ⚠️ are decisions that
must be made before any code is written. No tables, columns, routes, or endpoints
described here have been created or confirmed.

Umbrella reference for the **video subtitle** feature: a learner pastes a
**YouTube** URL, the app resolves it to a transcript, parses that transcript into
timed, segmented, dictionary-linked **cues**, and the learner watches the video —
**embedded, played by YouTube itself** — with those cues rendered as tappable
**cpcd**, at adjustable playback speed, with heavy scrubbing (repeat-a-line,
step-back, loop).

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
| **Acquire** | Raw timed text (a YouTube caption track) | Server or learner (§ 3 — the open decision) |
| **Normalize** | Sentence-shaped, punctuated, non-overlapping cues | Server |
| **Parse** | Cues: `{ startMs, endMs, text, segments[] }` with gsa segmentation | Server (reuses est's tagging path) |
| **Enrich** | Per-segment gloss/pinyin/POS/sense, linked to cdet | Server (lazy or batch) |
| **Play** | YouTube IFrame player + speed/scrub controls + tappable cue text | Client |

A parsed video is **shared, not per-user**: two learners who paste the same YouTube
URL read the same cue track. Per-user state (last position, loop bookmarks, which
cues were tapped) is separate and small.

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
uploads: there are no bytes to hash, and the id already *is* the canonical key.

### 2.2 What the server fetches at resolve time

Only metadata, and only through sanctioned surfaces:

- **oEmbed** (`youtube.com/oembed?url=…`) — title, author, thumbnail. No key needed.
  Cheapest liveness/embeddability smoke test.
- **YouTube Data API v3** `videos.list` (parts `snippet,contentDetails,status`) —
  duration, default language, `status.embeddable`. Needs an API key; quota is
  generous for this volume. ❓ Do we want the key dependency in v1, or is oEmbed
  enough to start?

⚠️ **Reject non-embeddable videos at resolve time**, with a clear message. An
uploader can disable embedding; discovering that after the parse job has run wastes
the expensive half of the pipeline and strands a `ready` track no one can watch.

### 2.3 Playback is an embed, never a download

The learner watches the video **in YouTube's own IFrame player**, driven by the
IFrame Player API (§ 6). The creator gets the view, ads serve normally, and this
project redistributes nothing. This is the sanctioned path and it should stay the
only playback path.

---

## 3. Transcript acquisition ⚠️ — the one genuinely open decision

Everything downstream is settled work. This is not. **Settle it before writing code.**

The relevant asymmetry in YouTube's own APIs:

- `captions.list` (Data API v3) will *enumerate* a video's caption tracks.
- `captions.download` requires **the video owner's** OAuth. There is no official,
  keyed way to download a third party's caption track.

So an official-API-only route gets you the knowledge that a Chinese track exists,
and not its contents. The three real options:

**Option A′ — learner-supplied transcript (recommended for v1).**
The learner opens the video's description on YouTube, taps *Show transcript*,
copies it, and pastes it into a textarea. YouTube's transcript panel emits
timestamped lines that parse trivially (`m:ss` / `h:mm:ss` + text). The app never
talks to YouTube for caption data at all.
*Cost:* one manual step — **once per video, ever**, because tracks are shared
app-wide (§ 1). The second learner to paste that URL pays nothing.
*Benefit:* zero ToS exposure, zero bot-detection maintenance, no proxy budget, and
it works today from a datacenter IP, which B′ largely does not.

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

❓ **Question for the user: A′, B′, or C′?** This document assumes **A′** everywhere
below, with the acquisition step isolated behind one service method so B′/C′ can be
layered in later without touching normalization, parsing, or playback.

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

Playback is YouTube's `<iframe>` player, driven through its JS API. It covers the
control set almost line for line:

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

**Constraints to design around, not fight:**

- **No frame callback.** There is no `timeupdate`; the current cue comes from polling
  `getCurrentTime()` on an interval (~100–200 ms is the usual compromise). Fine for
  highlighting; *loop cue* will overshoot `endMs` by up to one poll before seeking
  back. Accept it, or shorten the interval while looping.
- **We cannot restyle YouTube's chrome.** The scrub bar with cue ticks is ours,
  drawn above/below the player.
- **Ads interrupt**, and the poll must not mistake an ad break for playback progress.
- **Mobile autoplay needs a user gesture** — the first play is always a tap.
- **Some videos are embed-disabled** (§ 2.2 rejects them at resolve time).

### 6.2 Cue lookup must not be a linear scan

At poll rate a naive `cues.find(...)` is wasteful and worsens with long videos:

1. Keep the **current cue index** in a ref and advance/retreat from the last known
   index (O(1) for normal playback, O(k) for a small seek).
2. On a **large seek** (scrub drag), binary-search `startMs` instead of walking.
   This is why cues must be ordered and non-overlapping (§ 4).

Scrub drags drive a **throttled** seek with the final position applied on release —
seeking on every pointermove stalls the embedded player on mobile.

### 6.3 Touch rules

Per [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md): the page defaults to
`touchAction: "none"`, the transcript is the opt-in scrolling container, and the page
calls `useBlockEdgeSwipe(true)` so a scrub drag from near the screen edge does not
trigger a browser back-navigation. Our scrub bar handles its own pointer events and
must not let them reach the app shell.

⚠️ The `<iframe>` is a **foreign event surface** — the app's global touch rules stop
at its boundary, and gestures inside it belong to YouTube. Keep every control of ours
outside the frame.

### 6.4 Minute points ❓

Watching with subtitles is study time. Does a video session accrue minute points
([MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md))? If yes, the accrual signal
should be **wall-clock time with the player actually in the playing state**, not
video-timeline progress — otherwise a 0.5× rewatch loop farms points off ten seconds
of footage. The player's state-change events give this directly.

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

❓ Do we treat Shorts as a first-class, separately-presented content type (a
Shorts-only browse surface), or purely as an incidental URL form?

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
| **Client page** | `src/features/video/VideoSubtitlePage.tsx` | The player surface; a **Node** drill-in (back arrow), footer tab TBD ❓ (`home` or `discover`). |
| **Client hooks** | `useSubtitleTrack`, `usePlayerClock` | Cue lookup, current-cue state, speed/loop state, the polled clock. Keyed on `user?.id` / `youtubeVideoId` — **never** on `token` (see CLAUDE.md § token rule). |
| **Client player** | `src/features/video/YouTubePlayer.tsx` | Owns the IFrame API instance and its lifecycle; exposes an imperative seek/rate handle. The **only** file that knows YouTube exists. |
| **Client API** | `src/api/videoSubtitles.ts` | All server calls via `src/api/http.ts`; no function takes a `token`. |
| **Controller** | `server/controllers/VideoSubtitleController.ts` | camelCase routes, URL validation, transcript-paste intake. |
| **Service** | `server/services/VideoSubtitleService.ts` | Orchestration: resolve id, dedupe, acquire transcript (§ 3), kick off/await the parse job, assemble the read model. **Writes no SQL.** |
| **DAL** | `server/dal/implementations/VideoSubtitleDal.ts` + interface | All SQL. Language-scoped like every det/vet query. |
| **Util** | `server/utils/youtubeUrl.ts` → `parseYoutubeVideoId` | Pure URL → id normalization (§ 2.1). |
| **Pipeline** | `server/scripts/parse-video-subtitles.ts` | normalize → punctuate → segment → tag. Restartable, idempotent per `youtubeVideoId`. |

Parsing stays a **job, not a request handler** — the model passes (punctuation repair,
per-segment tagging, per-cue translation) are minutes of work on a long video. The
submit endpoint returns immediately with a `parsing` status and the client polls.

Isolating YouTube inside `YouTubePlayer.tsx` and `youtubeUrl.ts` is deliberate: if a
second source is ever added, the cue model, the page, and the whole server pipeline
are already source-agnostic.

---

## 10. Proposed persistence ❓ (nothing created — confirm before implementing)

Two new tables are proposed. Both need explicit confirmation.

1. **`videos`** — one row per video: `id`, `youtubeVideoId` (unique), `language`,
   `title`, `channelName`, `durationMs`, `width`/`height` (for the § 7.1 aspect
   switch), `addedByUserId`, `status` (`pending` | `parsing` | `ready` |
   `needs_review` | `failed`), `trackKind` (`manual` | `auto` | `translated`),
   `transcriptSource` (`pasted` | `fetched` | `vendor`), `createdAt`.
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

1. **Transcript acquisition: A′ (learner paste), B′ (server fetch), or C′ (vendor)?**
   Blocking — everything else is settled.
2. Do we take the YouTube Data API key dependency in v1, or start on oEmbed alone?
3. Cues as their own table, or one jsonb blob on `videos`?
4. Does watching accrue minute points, and on what clock (§ 6.4)?
5. Is a video private to whoever added it, shared app-wide, or shareable to friends
   ([FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md))? The shared-track model (§ 1) leans
   app-wide; note that makes one learner's paste visible to everyone.
6. Which footer tab / hub row does vsp hang off — Home, Discover, or Reader (a video
   is arguably a Reader document with a clock attached)?
7. Shorts as a first-class content type, or an incidental URL form (§ 7)?
8. Snap-to-cue-start on scrub release: always, or only within a threshold?
9. Spanish later, or Chinese-only by construction? The pipeline is language-agnostic
   apart from gsa segmentation, which only Chinese needs — and YouTube's Spanish
   caption coverage is far better than its Chinese coverage.
10. Do we add a moderation/allow-list posture, given learners can paste any URL?

---

## 12. Related documents

- [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) — segment tagging + popup model this reuses
- [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) — which definition form a popup shows
- [DISCOVER_LAZY_ENRICHMENT.md](./DISCOVER_LAZY_ENRICHMENT.md) — enriching words the video introduces
- [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) — Node-page archetype, touch/scroll rules
- [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md) / [BACKEND_LAYERING.md](./BACKEND_LAYERING.md) — layer placement rules cited in § 9
- [DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md) — model for a human cue-correction pass
- [MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md) — the accrual clock question in § 6.4
