# Frontend Layering — where a file goes, and how it talks to the server

Status: **normative**. This is the rule new client code is held to.

Companion to [BACKEND_LAYERING.md](./BACKEND_LAYERING.md).
Referenced from [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) (findings 5 and 9).

---

## 1. The directories

| Directory | Holds | Test for belonging |
|---|---|---|
| `src/features/<x>/` | Everything **exclusive** to feature `<x>` — its pages, components, hooks, API client, local types | Every importer is inside `src/features/<x>/` |
| `src/pages/` | App-level, auth, and legacy pages only (`AccountPage`, login/register, settings) | It is not part of any one feature |
| `src/components/` | Genuinely shared presentational components | Importers in **two or more** features |
| `src/hooks/`, `src/utils/` | Shared, feature-agnostic logic | Same test as `components/` |
| `src/engine/market/` | The Pixi night-market engine — pure simulation/geometry | No React, no DOM, no network |
| `src/cardIcons/` | The card-icon subsystem (layout math, text layout, API client, `editor/`) | Consumed by both flp and cdp |
| `src/api/` | The HTTP transport (§ 3) | — |
| `src/routes/` | `routeMeta.ts` (path table, **no page imports**) + `registry.ts` (components) | — |

### The rule

> **A feature folder owns what only it uses.** The moment a second feature imports a
> file, that file moves up to a shared home — it does not get imported across the
> feature boundary.

`src/pages/` is **not** "where pages live". A page belongs to its feature; the
Discover, Dictionary, Games and Community pages all sit in their feature folders. What
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

### Dependency direction

`features/` → `components/`, `hooks/`, `utils/`, `engine/`, `api/` — and never the
reverse. In particular **nothing in `src/engine/` may import from `src/features/`**: the
engine is consumed by feature code and by tests, so a back-edge makes the simulation
depend on the authoring UI. When the engine needs a shape, the shape is the engine's
(see `src/engine/market/templateDefinition.ts`, which owns `TemplateDefinitionPayload`
and is re-exported by `features/nightmarket/templateEditorApi.ts` for feature callers).

---

## 2. File size

A file over ~300 lines is a candidate for splitting; over ~800 it needs a reason.
Split along the seams the consumers already imply, not by line count.

Note the constraint that shapes these splits: **`react-refresh/only-export-components`**
means a `.tsx` file that exports a component may export *nothing else*. A helper
extracted alongside a component therefore needs its own module — which is why
`infoCardTabAvailability.ts` sits next to `InfoCardTabContent.tsx` rather than inside it.

---

## 3. Talking to the server

> **All server calls go through `src/api/http.ts`.** No component, hook, or page calls
> `fetch` directly.

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

### 3.1 A feature with more than one endpoint gets an API module

`features/<x>/<x>Api.ts` (or `src/cardIcons/cardIconApi.ts`). One function per endpoint,
returning parsed data. The page does not know the path, the method, or the payload shape.

Existing modules: `features/community/communityApi.ts`,
`features/discover/starterPacksApi.ts`, `features/nightmarket/templateEditorApi.ts`,
`features/nightmarket/templateSandboxApi.ts`, `features/reader/validationApi.ts`,
`cardIcons/cardIconApi.ts`, `utils/vocabApi.ts`.

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

`/api/starterPacks/...`, `/api/nightMarketTemplates/...`, `/api/users/displaySettings`.
User-facing SPA URLs are kebab-case (`/discover/quick-mark/:language`) and are unrelated
to API paths. A client API module must stay in step with its `server/routes/*.ts` file —
these are the two halves of one contract with no compiler linking them.

---

## 4. Code references

| Section | Files |
|---|---|
| §1 directories | `src/features/`, `src/pages/`, `src/cardIcons/editor/`, `src/engine/market/` |
| §1 direction | `src/engine/market/templateDefinition.ts`, `src/features/nightmarket/templateEditorApi.ts` |
| §1 routing | `src/routes/routeMeta.ts`, `src/routes/registry.ts` |
| §2 splits | `src/features/flashcards/card/CardFace.tsx`, `src/features/flashcards/FlashcardsLearnPage/InfoCardTabContent.tsx`, `infoCardTabAvailability.ts` |
| §3 transport | `src/api/http.ts`, `src/utils/authHeader.ts`, `src/utils/fetchInterceptor.ts` |
| §3.1 API modules | the seven modules listed above |
| §3.2 token rule | `src/AuthContext.tsx`, [TOKEN_EXPIRATION_IMPLEMENTATION.md](./TOKEN_EXPIRATION_IMPLEMENTATION.md) |

Related docs: [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) (page archetypes + the
mobile shell), [BACKEND_LAYERING.md](./BACKEND_LAYERING.md) (the server counterpart).
