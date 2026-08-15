# Video Subtitles (vsp — video subtitle player)

**STATUS: DESIGN / DRAFT.** Nothing in this document is implemented yet. Sections
marked ❓ are open questions for the user; sections marked ⚠️ are decisions that
must be made before any code is written. No tables, columns, routes, or endpoints
described here have been created or confirmed.

Umbrella reference for the **video subtitle** feature: a learner supplies a short
Chinese-language video (Instagram Reel / RedNote 小红书 post), the app extracts and
parses its subtitles into timed, segmented, dictionary-linked **cues**, and the
learner watches the video with those cues rendered as tappable **cpcd** — at
adjustable playback speed, with heavy scrubbing (repeat-a-line, step-back, loop).

The parsing half and the playback half are deliberately separated: parsing is a
slow, cached, one-time-per-video backend pipeline; playback is a latency-critical
client surface that only ever reads a finished cue track.

---

## 1. Concept overview

| Stage | What it produces | Where it runs |
|---|---|---|
| **Ingest** | A durable video asset + a stable `videoId` | Server |
| **Extract** | Raw timed text (burned-in subtitle OCR and/or audio ASR) | Server (batch job) |
| **Parse** | Cues: `{ startMs, endMs, text, segments[] }` with GSA segmentation | Server (reuses est's tagging path) |
| **Enrich** | Per-segment gloss/pinyin/POS/sense, linked to cdet | Server (lazy or batch) |
| **Play** | Speed-controlled, scrub-friendly player with tappable cue text | Client |

A parsed video is **shared, not per-user**: two learners who submit the same
RedNote post read the same cue track. Per-user state (last position, loop
bookmarks, which cues were tapped) is separate and small.

---

## 2. Ingestion ⚠️

This is the riskiest part of the feature and must be settled first, because every
downstream layer depends on whether the server ever holds the video bytes.

**Option A — user-supplied file upload (recommended).**
The learner saves/exports the video themselves and uploads the file. The app never
touches Instagram or RedNote. Simplest legally, simplest operationally (no
scraping, no fragile CDN URLs, no bot detection), and it works for videos from any
source. Cost: an extra manual step for the learner, plus storage for the file.

**Option B — paste a post URL, server fetches.**
Nicer UX, but: both platforms' terms of service restrict automated downloading,
their CDN URLs are short-lived and require signed tokens, their HTML/JSON shapes
change without notice, and the fetcher will be rate-limited or blocked from a
datacenter IP. It also makes the app the party redistributing someone else's
video. **Do not build this without an explicit decision from the user** about the
ToS/copyright posture, and even then treat the fetcher as best-effort.

**Option C — paste a URL, client-side capture, upload the bytes.**
Middle ground: the learner's own session/browser provides the media, the server
only receives the file. Still ToS-adjacent; mostly it just relocates the problem.

❓ **Question for the user:** which of A / B / C do we build first? This document
assumes **A** everywhere below, with `sourceUrl` kept as an optional attribution
field so B can be layered on later without a schema change.

### Deduplication

Videos are keyed by a **content hash** (sha256 of the uploaded bytes), not by URL,
so the same clip uploaded twice reuses the existing parse. `sourceUrl` is metadata
only — never an identity.

---

## 3. Subtitle extraction

Instagram and RedNote videos almost never ship a sidecar subtitle track; the text
is **burned into the pixels**. That makes extraction a vision problem, not a
parsing problem, and it is the second decision to settle.

### 3.1 Burned-in OCR path (primary)

1. **Sample frames** at a fixed cadence (~4 fps is enough for subtitle timing;
   subtitles rarely change faster than ~2 Hz).
2. **Crop the subtitle band.** Both platforms put burned-in captions in a roughly
   stable horizontal band. Detect the band once per video (the region with the
   highest text-pixel density across sampled frames) rather than assuming a fixed
   rectangle — creators move captions.
3. **OCR each cropped frame** → candidate line(s) of Chinese text.
4. **Collapse runs.** Consecutive frames with (near-)identical OCR text become one
   cue; the run's first/last frame timestamps become `startMs`/`endMs`. Near-identical
   is a normalized edit-distance threshold, because OCR jitters by a character or
   two between frames of the same caption.
5. **Repair.** A model pass over the collapsed cue list fixes OCR errors using
   neighbouring cues as context, and drops non-subtitle text (watermarks, usernames,
   sticker text) that survived the band crop.

❓ **Which OCR engine?** Candidates: PaddleOCR (best-in-class for Chinese, heavy
Python dep — note the musl backend container's native-dep constraint), a hosted
vision API, or a Claude vision call per sampled frame (simplest to wire, most
expensive per video, and would sit under a usage cap like `dictionary_ai_usage`).
This choice drives whether extraction runs in-container, in a sidecar container, or
off-box.

### 3.2 ASR path (secondary / complementary)

Speech-to-text on the audio track gives timing that is *more* accurate than frame
sampling and covers speech the captions omit — but it misses on-screen-only text
and mis-hears exactly the vocabulary a learner most needs. Treat it as either a
fallback when OCR finds no subtitle band, or a **cross-check** that snaps
OCR-derived cue boundaries to word-level ASR timestamps.

❓ Do we build ASR in v1, or ship OCR-only and add ASR when a video has no
burned-in text?

### 3.3 Quality gate

Extraction ends with a per-video **confidence score** and, when it is low, the
video lands in a `needs_review` state instead of silently serving garbage cues.
This mirrors the human-in-the-loop posture of
[DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md) — an editable cue track
(fix a line, nudge a boundary) is the natural v2 of this gate.

---

## 4. Cue parsing & enrichment

Once a video has clean timed text, the rest is **already-solved work in this
codebase** and must reuse it rather than reimplement it:

- **Segmentation** — the same greedy segmentation algorithm (gsa) the Reader and
  est use, so a cue segments identically to the same sentence typed into the Reader.
  See `src/features/reader/documentSegmentation.ts` and the est read path.
- **Per-segment metadata** — pos / sense / number / tense tagging, keyed by GSA
  segment string, exactly as described in
  [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) § two-phase tagging. The alignment
  rule from that doc applies verbatim here: **persist the segmentation, key the
  dicts by the persisted segments**, never by model-emitted tokens.
- **Rendering** — segments render as **cpcd** through `ForeignText`; cpcd is never
  used directly. Tapping a segment opens the same definition popup the est tab uses.
- **Unknown words** — a cue segment that has no discoverable cdet row goes through
  the existing lazy-enrichment path
  ([DISCOVER_LAZY_ENRICHMENT.md](./DISCOVER_LAZY_ENRICHMENT.md)) rather than a new
  one.

The cue is therefore the *only* genuinely new data shape in the feature.

### Cue shape (proposed)

```ts
type SubtitleCue = {
  index: number;          // 0-based order within the track
  startMs: number;        // inclusive
  endMs: number;          // exclusive
  text: string;           // repaired foreign text
  segments: string[];     // persisted GSA segmentation (authoritative)
  translation?: string;   // English, generated once per cue
  confidence?: number;    // extraction confidence, 0–1
};
```

Cues are **non-overlapping and ordered**; a gap between cues is silence/no-caption
and is legal. The player relies on both invariants for its binary search (§5.2).

---

## 5. Playback surface

The learner-facing requirement is unusual and should shape the implementation:
**speed changes and scrubbing are the primary interactions, not incidental ones.**
People re-watch the same three seconds eight times.

### 5.1 Controls

| Control | Behaviour |
|---|---|
| **Speed** | 0.5× / 0.75× / 1× (0.25× steps down to 0.5 is where learners live). Uses the native `playbackRate`; `preservesPitch = true` so slowed speech stays intelligible. |
| **Prev / next cue** | Seek to the previous/next cue's `startMs`. This is the workhorse control — bigger tap targets than the scrub bar. |
| **Replay cue** | Seek to the current cue's `startMs` and play. |
| **Loop cue** | Toggle; on `timeupdate` past `endMs`, seek back to `startMs`. |
| **Scrub bar** | Standard drag, but with **cue tick marks** so a learner can aim at a line instead of at a timestamp. Snap-to-cue-start on release (❓ always, or only within a threshold?). |
| **Cue list** | A scrollable transcript beside/below the video; tapping a line seeks to it. Also the surface for reading without playing. |

### 5.2 Cue lookup must not be a linear scan

At 60 fps a naive `cues.find(...)` per frame is wasteful and gets worse with long
videos. Two rules:

1. Keep the **current cue index** in a ref and advance/retreat it from the last
   known index (O(1) for normal playback, O(k) for a small seek).
2. On a **large seek** (scrub drag), binary-search `startMs` instead of walking.
   This is why cues must be ordered and non-overlapping.

Scrub drags should drive a **throttled** seek (or `fastSeek` where available) with
the final position applied on release — seeking on every pointermove stalls decode
on mobile.

### 5.3 Touch rules

Per [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md): the page defaults to
`touchAction: "none"`, the transcript is the opt-in scrolling container, and the
page calls `useBlockEdgeSwipe(true)` so a scrub drag from near the screen edge does
not trigger a browser back-navigation. The scrub bar handles its own pointer events
and must not let them reach the app shell.

### 5.4 Minute points ❓

Watching with subtitles is study time. Does a video session accrue minute points
([MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md))? If yes, the accrual signal
should be **wall-clock time with the video actually playing**, not video-timeline
progress — otherwise a 0.5× rewatch loop farms points off ten seconds of footage.

---

## 6. Layering

| Layer | Component | Responsibility |
|---|---|---|
| **Client page** | `src/features/video/VideoSubtitlePage.tsx` | The player surface; a **Node** drill-in (back arrow), footer tab TBD ❓ (`home` or `discover`). |
| **Client hooks** | `useSubtitleTrack`, `usePlaybackClock` | Cue lookup, current-cue state, speed/loop state. Keyed on `user?.id` / `videoId` — **never** on `token` (see CLAUDE.md § token rule). |
| **Client API** | `src/api/videoSubtitles.ts` | All server calls via `src/api/http.ts`; no function takes a `token`. |
| **Controller** | `server/controllers/VideoSubtitleController.ts` | camelCase routes, request validation, upload handling. |
| **Service** | `server/services/VideoSubtitleService.ts` | Orchestration: dedupe by hash, kick off/await the parse job, assemble the read model. **Writes no SQL.** |
| **DAL** | `server/dal/implementations/VideoSubtitleDal.ts` + interface | All SQL. Language-scoped like every det/vet query. |
| **Pipeline** | `server/scripts/parse-video-subtitles.ts` | The frame-sample → OCR → collapse → repair → segment → tag batch job. Long-running, restartable, idempotent per `videoId`. |

Extraction is a **script/job**, not a request handler: a 60-second Reel is minutes
of OCR. The upload endpoint returns immediately with a `parsing` status and the
client polls (or the page shows a progress state) until the track is ready.

---

## 7. Proposed persistence ❓ (nothing created — confirm before implementing)

Two new tables are proposed. Both need explicit confirmation.

1. **`videos`** — one row per deduplicated video asset: `id`, `contentHash`
   (unique), `language`, `durationMs`, `width`/`height`, `sourceUrl` (nullable
   attribution), `uploadedByUserId`, `status` (`pending` | `parsing` | `ready` |
   `needs_review` | `failed`), `extractionMethod` (`ocr` | `asr` | `both`),
   `createdAt`.
2. **`video_subtitle_cues`** — one row per cue: `videoId`, `index`, `startMs`,
   `endMs`, `text`, `segments` (jsonb), `translation`, per-segment metadata dicts
   (jsonb, est-shaped), `confidence`. Unique on (`videoId`, `index`).

Alternative: store the whole cue track as a single jsonb column on `videos`. That
is simpler and matches how `exampleSentences` is stored, but it forfeits per-cue
querying (e.g. "which videos contain 差不多?"), which is a plausible v2 feature —
find a real clip using the word you just learned. ❓ Which way do we go?

**Where do the video bytes live?** Postgres is the wrong home for them. Options:
container-local disk with a bind mount, or object storage. ❓ Needs a decision;
note the local `/app/data` bind-mount fragility already recorded for this machine.

---

## 8. Open questions (consolidated)

1. Ingestion: file upload (A), server-side URL fetch (B), or client capture (C)?
2. OCR engine, and does it run in the backend container, a sidecar, or a hosted API?
3. ASR in v1, or OCR-only with ASR as a fallback later?
4. Cues as their own table, or one jsonb blob on `videos`?
5. Where do video files live, and is there a size/duration cap per upload?
6. Does watching accrue minute points, and on what clock?
7. Is a video private to its uploader, shared app-wide, or shareable to friends
   ([FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md))?
8. Which footer tab / hub row does the feature hang off — Home, Discover, or Reader
   (a video is arguably a Reader document with a clock attached)?
9. Spanish later, or is this Chinese-only by construction? The pipeline is
   language-agnostic apart from GSA segmentation, which only Chinese needs.

---

## 9. Related documents

- [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) — segment tagging + popup model this reuses
- [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) — which definition form a popup shows
- [DISCOVER_LAZY_ENRICHMENT.md](./DISCOVER_LAZY_ENRICHMENT.md) — enriching words the video introduces
- [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) — Node-page archetype, touch/scroll rules
- [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md) / [BACKEND_LAYERING.md](./BACKEND_LAYERING.md) — layer placement rules cited in §6
- [DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md) — model for a human cue-correction pass
