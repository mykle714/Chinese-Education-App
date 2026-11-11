# Frontend Layering — where a file goes, and how it talks to the server

Status: **normative**. This is the rule new client code is held to.

Companion to [BACKEND_LAYERING.md](./BACKEND_LAYERING.md).
Referenced from [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) (findings 5 and 9).

---

## 1. The directories

| Directory | Holds | Test for belonging |
|---|---|---|
| `src/features/<x>/` | Everything **exclusive** to feature `<x>` — its pages, components, hooks, API client, local types | Every importer is inside `src/features/<x>/` |
| `src/pages/` | App-level, auth, and legacy pages only (`AccountSheet`, login/register, settings) | It is not part of any one feature |
| `src/components/` | Genuinely shared presentational components | Importers in **two or more** features |
| `src/hooks/`, `src/utils/` | Shared, feature-agnostic logic | Same test as `components/` |
| `src/cardIcons/` | The card-icon subsystem (layout math, text layout, API client, `editor/`) | Consumed by both flp and cdp |
| `src/api/` | The HTTP transport (§ 3) | — |
| `src/routes/` | `routeMeta.ts` (path table, **no page imports**) + `registry.ts` (components, **all `React.lazy`**) | — |

> **No `src/engine/` any more.** It held the Night Market / Immersive World iso engine
> (pure simulation, guarded by an `enginePurity` test) and was deleted with those features
> on 2026-11-09 — [ARCHIVED_FEATURES.md](./ARCHIVED_FEATURES.md). If a pure simulation layer
> comes back, restore that rule and its test with it.

### Every route is code-split

`src/routes/registry.ts` binds **every route** with `React.lazy`, and
`src/App.tsx` wraps every route in `<Suspense>` unconditionally — there is no
per-route `lazy` flag to forget. Adding a page with a plain static `import` still
works, which is precisely the danger: it silently moves that page and everything
it pulls in back into the main chunk. `src/__tests__/routeRegistry.test.ts` fails
if any route's component is not lazy.

The one module that must **never** regain a static heavy import is `src/main.tsx`:
a renderer shim imported there once pinned a whole canvas renderer into every user's
main chunk.

### The rule

> **A feature folder owns what only it uses.** The moment a second feature imports a
> file, that file moves up to a shared home — it does not get imported across the
> feature boundary.

`src/pages/` is **not** "where pages live". A page belongs to its feature; the
Add Cards, Dictionary, Games and Community pages all sit in their feature folders. What
survives in `src/pages/` is the handful of pages that belong to no feature.

**Why this specific test, and not "pages here, parts there".** The old split was by
*kind* (page vs component), which is not a dependency property, so it constrained
nothing: `src/pages/` accumulated feature-specific pages while feature folders reached
into each other. Ownership-by-importer is checkable — point at a file, list its
importers, and the correct home is determined.

**The failure this prevents.** The flashcard icon editor (fie) lived in
`src/features/flashcards/FlashcardsLearnPage/` while being consumed by **two** pages
(flp and the cdp). One page's folder therefore owned code the other page depended on, so
neither could change it safely. It now lives in `src/cardIcons/editor/`.

**Applied again, 2026-09-04.** `SheetPanel` — the modal/persistent bottom-sheet chrome —
sat in the same folder while the old Home page's card sheets and the acp already used it. That was still
*within* the flashcards feature, so it was legal; it stopped being legal the moment
`src/components/CompareSheet.tsx` (mounted by the dictionary cdp, deleted 2026-11-10; today by the saved-card cdp) needed it. It moved to
`src/components/sheet/`, taking the four styled surfaces it renders
(`EicScrim`, `InfoSheetContainer`, `InfoSheetGrabber`, `SheetHeaderSlot`) out of
`FlashcardsLearnPage/styled.ts` and into `src/components/sheet/sheetStyled.ts` — they had
exactly one importer, so nothing else had to change. Note the trigger: the file did not
become shared when a second *page* used it, but when a second *feature* did.

**Applied again, 2026-09-09.** The beginner keyboard's candidate bar carried desktop-only
horizontal paging arrows (measuring, the `(hover: hover) and (pointer: fine)` gate, the
`scrollBy` travel). The (since removed) Immersive World composer's hint tray then needed the
identical control, which is the same trigger as above — a **second feature**, not a second page. The logic moved to
`src/hooks/useHorizontalScrollArrows.ts` and the button to `src/components/ScrollArrow.tsx`;
each call site keeps only what genuinely differs (`CandidateRow` passes its per-mode accent
colour, the tray passes an end-of-travel callback that fetches its next page). Worth noting
what stayed behind: the *chrome* was not promoted with the behaviour, because the two strips
legitimately look different — promoting the shared part is not the same as unifying the two
surfaces.

### Dependency direction

`features/` → `components/`, `hooks/`, `utils/`, `api/` — and never the reverse. When a
shared layer needs a shape, the shape lives in the shared layer and features re-export it.

---

## 2. File size

A file over ~600 lines is a candidate for splitting; over ~1000 it needs a reason.
Split along the seams the consumers already imply, not by line count.

Note the constraint that shapes these splits: **`react-refresh/only-export-components`**
means a `.tsx` file that exports a component may export *nothing else*. A helper
extracted alongside a component therefore needs its own module — which is why
`infoCardTabAvailability.ts` sits next to `InfoCardTabContent.tsx` rather than inside it.

---

## 3. Talking to the server

> **Rule: all server calls go through `src/api/http.ts`.** New code must not call
> `fetch` directly.
>
> ⚠️ **Status: aspirational, not yet true.** ~42 direct `fetch(...)` call sites across
> ~35 files still bypass it (`AuthContext.tsx`, `EntriesPage.tsx`,
> `EditEntryPage.tsx`, the Reader dialogs, `useDictionarySearch.ts`,
> `useSpeedReadingQueue.ts`, …). They work — the global
> `fetchInterceptor` patch means they still get token refresh — but they re-hand-roll
> the base URL, headers and error handling. Migrate them opportunistically; never add a
> new one. Re-check with:
> `grep -rn '\bfetch(' src/ --include=*.ts --include=*.tsx | grep -v 'src/api/http.ts\|fetchInterceptor\|__tests__'`

`src/api/http.ts` exports `apiGet` / `apiPost` / `apiPut` / `apiPatch` / `apiDelete`
plus `withFallback`. It supplies:

- the base URL (`API_BASE_URL`) and querystring building from a `params` object,
- JSON encode/decode, with **FormData passed through untouched** so the browser can set
  its own multipart boundary,
- `credentials: 'include'`,
- the `Authorization: Bearer` header, read **at call time** via `authHeader()`,
- throw-on-non-2xx as `ApiError`, carrying the parsed body at `err.response.data`.

It deliberately wraps the **global** `fetch`, which `utils/fetchInterceptor.ts` has
already patched for transparent token refresh + retry on 401 — so one auth layer serves
the whole app.

> ⛔ **`withFallback` substitutes the MESSAGE and nothing else — never the error object.**
> It exists only to replace `ApiError`'s generic `Request failed with status N` text with a
> caller-supplied sentence, and it must rethrow an **`ApiError`** carrying the original
> `status` and `response.data`.
>
> Until 2026-09-05 it threw `new Error(message)`, which silently dropped the status and the
> entire parsed body — everything except the one `error` string. **The symptom appears far
> from the cause**: the call site still gets an `Error` with a sensible `.message`, so
> nothing looks broken until some caller reads a *structured* body. The (since removed)
> Immersive World scene editor was the first to: its `problemsFromError` read
> `response.data.problems`, so a refused save showed the server's one-line summary and
> never the per-field list — defeating a validator deliberately written to return every
> problem at once. An `err.status === 409` check would have failed identically and just as
> quietly.
>
> The general rule: **a wrapper in the transport layer may enrich an error, never narrow
> it.** Anything that re-throws must preserve the class and the payload, because the
> transport cannot know which field a future caller will need.

### 3.1 A feature with more than one endpoint gets an API module

`features/<x>/<x>Api.ts` (or `src/cardIcons/cardIconApi.ts`). One function per endpoint,
returning parsed data. The page does not know the path, the method, or the payload shape.

Existing feature-local modules: `features/community/communityApi.ts`,
`features/discover/starterPacksApi.ts`, `cardIcons/cardIconApi.ts`, `utils/vocabApi.ts`.

Cross-feature endpoint groups instead live directly under `src/api/`:
`collections.ts`, `dictionary.ts`, `flashcards.ts`, `friends.ts`, `provisional.ts`,
`velocity.ts` (alongside the `http.ts` transport itself).

### 3.2 ⛔ No API function takes a `token`

This is the load-bearing rule, and it is the client half of CLAUDE.md's
**"Never reload/reset a page on a silent token refresh."**

The access token rotates every ~15 minutes, so `token` from `useAuth()` **changes
identity on every refresh while the session is unchanged**. An API function that accepts
a token pulls it into the caller's `useCallback` / `useMemo` dependency array; that
callback's identity then churns every 15 minutes; and any effect keyed on the callback
re-runs — wiping in-progress UI. This is not hypothetical:

| Site | What churned | What it would have reset |
|---|---|---|
| `cardIcons/editor/useCardIconEditor.ts` | save/reset callbacks (`[token]`) | An in-progress icon-layout edit |
| `components/IconPickerDialog.tsx` | `fetchPage` (`[token]`) | The icon grid, mid-scroll |
| the three Discover pages | `authHeaders = useMemo(..., [token])` | Sort session / unsaved Quick Mark marks |

Since `authHeader()` is read inside the transport at call time, the correct shape is a
callback with **no `token` dep at all**. Load effects key on a stable auth identity —
`user?.id` or `isAuthenticated`, never `token`.

**The one exception:** `src/AuthContext.tsx` *is* the refresh layer. It must not call
through a wrapper that depends on it, so its raw `fetch` calls stay.

### 3.3 API paths are camelCase

`/api/starterPacks/...`, `/api/writingNotebook/...`, `/api/users/displaySettings`.
User-facing SPA URLs are kebab-case (`/tester-dashboard`, `/discover/sort/:language`) and are unrelated
to API paths. A client API module must stay in step with its `server/routes/*.ts` file —
these are the two halves of one contract with no compiler linking them.

---

## 4. Code references

| Section | Files |
|---|---|
| §1 directories | `src/features/`, `src/pages/`, `src/cardIcons/editor/` |
| §1 routing | `src/routes/routeMeta.ts`, `src/routes/registry.ts` |
| §2 splits | `src/features/flashcards/card/CardFace.tsx`, `src/features/flashcards/FlashcardsLearnPage/InfoCardTabContent.tsx`, `infoCardTabAvailability.ts` |
| §3 transport | `src/api/http.ts`, `src/utils/authHeader.ts`, `src/utils/fetchInterceptor.ts` |
| §3.1 API modules | the modules listed above |
| §3.2 token rule | `src/AuthContext.tsx`, [TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md) |

Related docs: [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) (page archetypes + the
mobile shell), [BACKEND_LAYERING.md](./BACKEND_LAYERING.md) (the server counterpart).
