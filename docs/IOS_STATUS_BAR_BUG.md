# iOS home-screen app: the status-bar band and the bottom strip

**TEMPORARY / ACTIVE BUG LOG.** Delete this file once the fix is verified on a real
device and the settled behaviour is written up in
[UX_AND_NAVIGATION.md § Safe areas and the iOS status bar](./UX_AND_NAVIGATION.md).
Until then, **every attempt goes in the log below, with what actually happened after
the build went live** — four rounds of this bug have now been "fixed" on reasoning that
a single screenshot then contradicted, and the log is the only thing that stops a fifth
round repeating a second one.

**Rules for this file**
- One row per **deployed build**, not per idea. An untested idea is a hypothesis, not a
  result.
- Record what was **observed**, separately from what was **concluded**. The observations
  have all held up; the conclusions are what keep being wrong.
- When an entry is disproved, do **not** delete it — strike the conclusion and say what
  disproved it. The disproved conclusions are the most useful part of the file.

---

## 1. The symptoms

Two distinct strips, on the **iOS home-screen ("Add to Home Screen") web app only**.
Neither appears in a Safari tab, on Android, or on desktop.

| # | Symptom | Status |
|---|---|---|
| **A** | The band behind the clock/battery does not match the page. On a flooded game page (Bubble Match, crimson ground) it shows flat paper `#FBFAF8`. | **Fixed** — round 2 (tags) + round 6 |
| **B** | A strip of the same height at the **bottom** of the screen, unpainted by any page. | **Fixed in round 6** — awaiting on-device confirmation of the deployed build |

They are two faces of one thing: the app and the layout viewport iOS reports are not
the same height, and whichever end the shell fails to cover shows something the page
did not paint.

**Not the same as** `SAFE_TOP` / `SAFE_BOTTOM` (`src/theme/safeArea.ts`). Those describe
strips the page **does** paint and merely keeps its *content* out of. These are strips
the page is failing to paint at all.

## 2. Device and environment

- iPhone, **393×852 pt** (2.35× — screenshots come back 924×1946).
- Status-bar inset on this device: **59pt** (`env(safe-area-inset-top)` when live).
- Testing surface is the **installed home-screen icon** against PPE.
- ⚠️ **iOS snapshots `index.html`'s `apple-mobile-web-app-*` tags when the icon is
  added.** A tag change does nothing to an installed icon until it is deleted and
  re-added. This does **not** apply to CSS/JS changes, which ship with a reload —
  worth keeping straight, because "did you re-add the icon?" is only a real question
  for the tag rounds (1 and 2).

## 3. Attempt log

### Round 1 — `viewport-fit=cover` alone
- **Shipped:** `e1ccccb` (2026-09-04 22:01) — `viewport-fit=cover` added to the viewport
  meta; `apple-mobile-web-app-status-bar-style` left at `default`.
- **Reasoning:** `cover` makes the web view paint edge to edge, so the page owns the band.
- **Observed:** no change. Band still paper on a crimson game.
- **Concluded:** `cover` is necessary but not sufficient — with `default`, iOS keeps the
  view letterboxed below an opaque OS-painted bar, `env(safe-area-inset-top)` resolves
  to `0px`, and the band is filled by iOS from the document background captured **at
  launch**, which no runtime write (`theme-color`, `documentElement.style`) can reach.
- **Still believed?** Yes.

### Round 2 — `black-translucent`
- **Shipped:** `a7243fb` (2026-09-05 04:31) — status-bar style `default` → `black-translucent`.
- **Observed:** **symptom A fixed** — band matched the page. **Symptom B appeared** in
  the same build: an identically sized unpainted strip at the bottom of every page.
- **Concluded:** `black-translucent` is the load-bearing tag. Its cost is that the app
  and the reported layout viewport stop agreeing. Also costs the glyph colour: the
  clock/battery follow the **system** appearance on iOS 13+, so a dark-mode device
  draws light glyphs over this app's one light palette.
- **Still believed?** Yes.

### Round 3 — one height: `window.screen.height` everywhere (`useAppHeight` v1)
- **Shipped:** `3f135c8` (2026-09-05 17:31) — new `useAppHeight` publishing a measured
  `--app-height`, read by `#root`, `FrameRoot`, `PHONE_OVERLAY_SX` and `Layout`.
- **Reasoning:** if the shell is as tall as the screen, it paints the strip.
- **Observed** (user screenshot, 18:58, Bubble Match): band **matched** (crimson to
  `y=0`). Page content ran past the visible area — the play panel's "drop here to cancel
  match" row was **sliced in half** at the bottom.
- **Concluded at the time:** ~~the missing pixels are OUTSIDE the web view, so no layout
  can paint them; growing the shell only clips content and the white strip stays exactly
  where it was.~~ **DISPROVED in round 4** — see below. The clipping was real; the claim
  that the band's improvement was unrelated to the height was not tested.
- **Reverted:** `e59385e` (2026-09-05 19:09), which also wrote the disproved conclusion
  into `safeArea.ts` as a ⛔ do-not-retry.

### Round 4 — back to `100dvh` (the revert)
- **Shipped:** `e59385e` (2026-09-05 19:09).
- **Observed** (user screenshot, 02:01 next day, Bubble Match, **after a delete-and-re-add
  of the icon**): **symptom A is back** — paper band above a crimson header. Bottom of
  the page is intact (rounded panel corner visible, nothing sliced).
- **What this establishes:** the shell's **paint height is what decides the band**. Two
  builds one commit apart, identical `index.html`, opposite band behaviour — and a fresh
  icon install rules out the tag snapshot. Round 3's conclusion is dead.
- **Measurement backing it** (header geometry, `PageHeader` → `SIZE_SPEC.leaf` pads
  `27px + env(safe-area-inset-top)`):

  | Build | White band above header | Title centre, measured | Predicted if inset = 59 | if inset = 0 |
  |---|---|---|---|---|
  | Round 3 (`screen.height`) | none | ~98pt | **97pt** ✓ | 92pt |
  | Round 4 (`100dvh`) | ~54pt | ~92pt | 97pt | **92pt** ✓ |

  ⚠️ Read this table with care: it is eyeballed off screenshots, ±5pt, and 5pt is the
  whole spread. It is *suggestive* that the inset itself goes to 0 in the round-4 build —
  i.e. that the app is letterboxed there — but it is **not** established, and no
  mechanism is known by which a CSS height could change an OS inset. **Do not build on
  this row without measuring `env(safe-area-inset-top)` on the device.**

### Round 5 — two heights (paint vs layout) — **IN REVIEW, NOT YET DEPLOYED**
- **Change (uncommitted at time of writing):** `useAppHeight` restored, publishing two
  variables instead of one, both only when `navigator.standalone && screen.height >
  innerHeight`:
  - `--app-height` = `screen.height` — how tall the shell is **painted** (`#root`,
    `FrameRoot`, `Layout`'s `minHeight`).
  - `--app-viewport` = `innerHeight` — how tall its content may **be**. New
    `FrameViewport` inside `MobileDemoFrame` holds every page **and** the footer bar
    (`FooterPresenter` had to move inside it, or `bottom: 0` parks the bar in the
    reserved strip).
  - `useThemeColor` additionally publishes `--surface-ground`, which `FrameRoot` paints,
    so the reserved strip takes the current surface's colour instead of paper.
  - `PHONE_OVERLAY_SX` deliberately reads neither — those dialogs are `position: fixed`
    and resolve against the layout viewport already.
- **Prediction:** band matches (round 3's win) **and** nothing is sliced (round 4's win).
- **Observed** (user screenshot, 2026-09-13, Bubble Match): band **matched** (crimson to
  `y=0`), nothing sliced — and **symptom B remained**, a dead strip at the bottom
  measuring **59pt** and, decisively, **pure `rgb(255,255,255)`**. That colour is what
  broke the round open: it is neither `--surface-ground` (crimson) nor `COLORS.background`
  (`#FBFAF8` = `251,250,248`), so the strip was **not** the reserved `FrameRoot` region
  the round thought it was painting.
- **Concluded:** ~~content laid out past `innerHeight` is off the visible area, so the
  frame must reserve a strip for it.~~ **DISPROVED in round 6.** The region is fully
  visible; reserving it is what left it blank. `--app-viewport` and `FrameViewport` were
  a fix for a constraint that does not exist.

### Round 6 — device probe, then one height applied to `html, body` — **THE FIX**
- **Diagnostic first.** § 6's advice was finally taken: four rounds of a static probe
  page (`diag-viewport.html`, served straight into PPE's nginx with `docker cp` — no
  rebuild, no downtime, `try_files` puts a real file ahead of the SPA fallback) added to
  the Home Screen as its own icon, each round painting a different mechanism a different
  colour. **This settled in ~20 minutes what four deploy-and-look rounds could not.**
- **Measured** (iPhone 15, standalone, `navigator.standalone === true`):

  | Reading | Value | |
  |---|---|---|
  | `screen.height` | **852** | stable across every round |
  | `documentElement.clientHeight` (the ICB) | **793** | stable across every round |
  | `env(safe-area-inset-top)` / `-bottom` | 59 / 34 | `852 − 793 = 59` exactly |
  | `window.innerHeight` | **793 or 852** | **NOT STABLE** — differed between rounds with identical CSS |
  | `100vh` / `100dvh` / `100lvh` | 793 or 852 | tracks `innerHeight`, equally unstable |
  | `100svh` / `100%` | 793 | always short |
  | `(display-mode: standalone)` | **false** | while `navigator.standalone` was true |

- **The two findings that mattered:**
  1. **The region beyond the ICB is visible and ours.** A probe painted `793..852`
     magenta and it appeared on screen, home indicator sitting inside it. Round 3's and
     round 5's shared premise — that those pixels are unreachable — was simply false.
  2. **`body` is the clipper.** `index.css` pinned `html, body { height: 100%;
     overflow: hidden }`, so body resolved to the 793 ICB and became a clipping box.
     `#root` and `FrameRoot` were already being sized to 852 correctly by round 5's
     `--app-height`, and body was slicing the bottom 59px off both. **Every earlier round
     applied its fix one element too low in the tree.**
- **Shipped:** `--app-height` (one variable, no split) now also applied to `html, body`;
  `--app-viewport` and `FrameViewport` deleted; the hook's guard re-based off
  `documentElement.clientHeight` instead of `innerHeight`.
- **Probe A/B, same page, one tap apart:**

  | | `body` | `#root` | unpainted |
  |---|---|---|---|
  | Before (`height: 100%`) | 793 | 852 | **59** |
  | After (`height: var(--app-height)`) | **852** | 852 | **0** |

- **⚠️ Why the guard changed.** The old condition was `screen.height - innerHeight > 0`.
  `innerHeight` reads the correct 852 often enough that the guard computes a zero gap,
  clears the variable and lets the bug back in on the next load. `documentElement
  .clientHeight` is stable at 793 — and, being spec'd to return the *viewport* height for
  the root element, it keeps returning 793 after the fix is applied, so re-measuring on
  resize cannot oscillate.
- **A methodological note worth keeping:** probe round 3 graded itself green while a
  59px hole was on screen, because its verdict compared `body` against `innerHeight` —
  the very value under suspicion. **A test must not measure a suspect against itself.**

## 4. What is actually established

Only these, and only these, are safe to build on:

1. `viewport-fit=cover` **and** `black-translucent` are both required for the page to
   own the band at all (rounds 1–2).
2. With both tags live, **the shell's paint height changes whether the band matches**
   (rounds 3–4, one commit apart, fresh icon install).
3. ~~A shell sized to `screen.height` **clips ~60pt of content** off the bottom of every
   page (round 3, measured on the sliced game panel).~~ **Superseded by round 6:** the
   clipping was real but `body` did it, not the web view. Sizing the shell to
   `screen.height` is correct *provided `html, body` are sized with it*.
4. The tag snapshot is **not** the current cause — round 4's symptom survived a
   delete-and-re-add.
5. The web view really is `screen.height` tall, and the region past the document's
   containing block is **visible and paintable** (round 6, painted and photographed).
6. `window.innerHeight` and every CSS viewport unit are **unreliable** in this mode.
   `screen.height` and `documentElement.clientHeight` are not. Measure from those.

## 5. Open questions

- ~~**Where does the visible region actually start?**~~ **ANSWERED (round 6):**
  edge-to-edge. The document's origin is `y=0`, under the clock, and
  `env(safe-area-inset-top)` is a live 59 — not 0. The app is not letterboxed.
- ~~**Is symptom B's strip inside the web view or outside it?**~~ **ANSWERED (round 6):**
  inside, and paintable. A probe filled it and it showed. The manifest route in § 7 is
  therefore not needed for symptom B.
- **The status-bar scrim** (observed 2026-09-05): the band is not flat page ground but a
  **white overlay fading out downward** — ~68% white at `y=0`, reaching zero at ~77pt,
  over a ground that is exactly `RAMP.red.ink`. Nothing in `src/` draws it; the falloff
  is linear in all three channels, which is what an OS-composited alpha ramp looks like.
  Working theory: an iOS legibility scrim over `black-translucent` in light appearance.
  If so no CSS removes it — the page only chooses what it fades *into*.

## 6. The diagnostic — RUN, and how to run it again

Round 6 finally did this, and it ended the bug in one sitting after four deploy-and-look
rounds had not. **If any of this resurfaces, start here rather than reasoning from a
screenshot of the app.**

How it was served, which is the part worth reusing — a **static HTML page needs no React
route, no build and no downtime**:

```bash
scp -i ~/.ssh/id_ed25519_cow_ppe diag-viewport.html michael@174.127.171.187:/tmp/
ssh -i ~/.ssh/id_ed25519_cow_ppe michael@174.127.171.187 \
  'docker cp /tmp/diag-viewport.html cow-frontend:/usr/share/nginx/html/'
```

nginx's `try_files $uri $uri/ /index.html` serves a real file ahead of the SPA fallback,
so it is live instantly at `mren.me/diag-viewport.html`. Give the probe the **same**
`viewport-fit=cover` + `black-translucent` meta tags as `index.html` and **add it to the
Home Screen as its own icon** — the behaviour does not exist in a Safari tab. The copy is
lost on the next container rebuild, which is exactly the lifetime a diagnostic wants.

Two things that made it work, both learned the hard way:
- **Paint each mechanism a different colour** (html canvas / a normal element / nothing)
  and split the suspect region between them. Numbers alone did not separate "the pixels
  are not ours" from "the pixels are ours and blank"; colour did, immediately.
- **Never compare a suspect against itself.** Probe round 3 reported a green "no
  clipping" while a 59px hole was on screen, because it graded `body` against
  `innerHeight` — the value that was moving. Grade against `screen.height`.

The readout to put on screen:

```
navigator.standalone            true?
window.innerHeight              layout viewport
window.screen.height            screen
document.documentElement.clientHeight
getComputedStyle(document.documentElement)
    .getPropertyValue("--sat")  // an element with height: env(safe-area-inset-top)
visualViewport.height / .offsetTop
```

One screenshot of those numbers settles every open question in § 5 at once, and is
cheaper than another deploy-and-look round.

## 7. Options not yet tried

| Option | What it would cost |
|---|---|
| **Web app manifest** (`display: standalone` + `background_color`) alongside the Apple meta tags | iOS 17+ honours it, and `background_color` paints the window backdrop — so if symptom B's strip is outside the web view, this is the only lever that reaches it. But it is one static colour, not the current page's ground. Unverified on this device. |
| Revert to `status-bar-style: default` | Symptom B disappears (the view is letterboxed and spans to the bottom) but symptom A becomes permanent and unfixable — the band is OS-painted again. This is giving up on the feature. |
| Accept symptom B | A ~60pt band under every page in the home-screen app. |

## 8. Referenced code

- `src/hooks/useAppHeight.ts` — `--app-height`, the web view's real height in px
- `src/index.css` — `html, body`, **the element that was clipping the shell**
- `src/components/MobileDemoFrame.tsx` — `FrameRoot` (`FrameViewport` deleted in round 6)
- `src/hooks/useThemeColor.ts` — `theme-color` claims + `--surface-ground`
- `src/theme/safeArea.ts` — `SAFE_TOP` / `SAFE_BOTTOM`, and the tag rationale
- `src/components/PageHeader.tsx` → `Header` — the only place the top inset is absorbed
- `index.html` — `viewport-fit=cover`, `apple-mobile-web-app-*`, default `theme-color`
- `src/App.css` — `#root`, the shell scroll container
