# Data Validation System

Human-in-the-loop review of AI-enriched dictionary fields. Trusted "validator"
users review **one field of one discoverable entry** and **Approve** or **Flag**
it, via either of two paths: a **read-only Reader document** downloaded from a
queue (`ValidationService.composeValidationDoc`/`submitValidation`), or **inline
Approve/Flag buttons** rendered directly on the est/definition UI wherever the
entry is already displayed (`ValidationService.submitEntryValidation`) — see
"Inline Approve/Flag" below. Neither path supports editing: Approve always
composes/copies the CURRENT data server-side (never trusts client content); Flag
records only the flag itself, no content. Outcomes go to a dedicated `validations`
table so future backfills never clobber human-reviewed fields.

Introduced by **migration 104** (`database/migrations/104-add-validation-system.sql`),
simplified by **migration 106** (`database/migrations/106-simplify-validator-content.sql`
— dropped the edit/suggest/revert flow, `validations.content` nullable, dropped
`texts.validationOriginalContent`).

> **Why a separate table (not a det column):** `dictionaryentries_{zh,es}` are
> `TRUNCATE`+restored wholesale on every prod data deploy
> ([DATA_DEPLOYMENT_GUIDE.md](./DATA_DEPLOYMENT_GUIDE.md)), which would wipe any
> review column. `validations` lives outside the data-deploy allowlist and is keyed
> by the det row's surrogate `id` (stable across deploys — the binary dump preserves
> id values) + `language`, so it survives every deploy.

---

## Field model

A validation document targets exactly one **field** of an entry:

| `validationField` | Doc subtitle (description) | Source columns |
|---|---|---|
| `definitions` | "Definitions & Parts of Speech" | `partsOfSpeech` + `definitions[]` + `longDefinition` |
| `exampleSentence0/1/2` | "Example Sentence 1/2/3" | `exampleSentences[N]` (`foreignText` + `english`) |

Only **populated** fields are eligible. `definitions` requires all three columns
present; `exampleSentenceN` requires `exampleSentences` to have index `N`.
The `ValidationField` union is declared in both `server/types/index.ts` and
`src/types.ts`.

Granularity is **per (entry, field)**: a user may validate an entry's example
sentence and, separately, its definitions bundle. Each (user, entry, field) has at
most one CURRENT record — but on the **inline path only** (see "Inline
Approve/Flag" below), a validator may switch it (approve ↔ flag) or clear it
entirely; the Reader-document path (`submitValidation`) still rejects a repeat
submit for the same (user, entry, field), since the underlying document is
auto-deleted after the first action.

---

## Schema (migration 104, updated by 106)

- `users."isValidator" BOOLEAN NOT NULL DEFAULT false` — gates the validator UI +
  endpoints (dictionary data approval ONLY). It used to ALSO gate the Night Market
  template editor; migration 115 split that onto its own `users."isTemplateAuthor"`
  flag, so the two responsibilities are now independent grants. Surfaced to the client
  through the `user` object (login + `/api/auth/me`);
  **not** on the JWT. It must be listed in `UserDAL.findById`'s SELECT
  (`server/dal/implementations/UserDAL.ts`) or it vanishes after a token refresh.
- **`validations`** table — one CURRENT row per (entry, field) reviewed by a validator:
  ```
  id UUID PK · entryId INTEGER · language VARCHAR(10) · field VARCHAR(50)
  validatorUserId UUID (NOT a FK — see below) · validatorName TEXT
  action VARCHAR(20) CHECK IN ('approve','flag') · content TEXT NULLABLE · createdAt
  UNIQUE (entryId, language, field, validatorUserId)   -- one record per user/field
  ```
  `validatorUserId` **was** `FK users(id) ON DELETE CASCADE`, but **migration 120
  dropped that FK** (the column stays `UUID NOT NULL`). Reason: prod is the source of
  truth for `validations` and it is pulled DOWN to dev boxes via `/data-pull`; a dev
  box that lacks a prod validator's account would otherwise abort the restore. The
  column is never JOINed to `users` — it is a scalar identity only (the unique
  constraint + the "did I already validate this?" filters), and display uses the
  denormalized `validatorName` — so the FK bought nothing on reads. Now consistent
  with `entryId` / `texts.validationEntryId`, which are deliberately unconstrained
  ids. Trade-off: deleting a user no longer cascades away their validation rows;
  they survive as (harmless, still-displayable) orphans.
  `content` is the data version approved, copied verbatim from the document the
  validator read — `NULL` for a flag (flag is just a signal; it carries no
  suggested edit). The unique constraint keys the Reader-document path's
  "can never re-validate" rule (`ON CONFLICT DO NOTHING`) AND the inline path's
  switch/clear (`ON CONFLICT DO UPDATE` / `DELETE`) — see "Inline Approve/Flag"
  below. There is no history of a superseded vote: switching or clearing
  overwrites/deletes the row in place. `(entryId, language)` is indexed for the
  compose check + backfill guard.
- `texts` validation-linkage columns (nullable; NULL ⇒ ordinary user document):
  `validationEntryId INTEGER` (det id — SERIAL, **not** uuid),
  `validationLanguage VARCHAR(10)`, `validationField VARCHAR(50)`. (Migration 104
  also added `validationOriginalContent`, used for client-side edit-diffing and
  Revert; migration 106 dropped it once editing was removed.)

The consolidated schema files (`database/init/01-init-schema.sql`,
`database/deploy/01-schema.sql`) mirror the `users` + `texts` + `validations`
additions. `validations` is intentionally **absent** from the data-deploy allowlist.

---

## Flow

### Download (compose)
`POST /api/validation/download` `{ language }` →
`ValidationController.downloadValidationDoc` → `ValidationService.composeValidationDoc`
(`server/services/ValidationService.ts`):
1. Assert `user.isValidator`.
2. Pick one eligible (entry, field) in `dictionaryentries_<language>` — discoverable,
   field populated, and NOT already validated by this user for that field — ordering
   by fewest existing validations of that field (random tiebreak). A `CROSS JOIN
   LATERAL (VALUES …)` expands each entry into its four candidate fields.
3. Compose a **pretty-printed, read-only** body (`composeBody`), `title = "Validate - <word1> - <pronunciation>"`
   (pinyin appended when present), `description = <field label>`.
4. Create the doc via `TextService.createText`, which persists the three
   `validation*` columns. Returns the `Text`.

Body format — plain human-readable prose, **not** JSON — built by the shared
formatters in `server/utils/validationBodyFormat.ts`:
- **`composeDefinitionsBody`** — `Parts of Speech: <comma list>`, then
  `Definitions:` as a numbered list, then `Long Definition:` followed by the prose.
  `longDefinition` is read straight from the raw det column, which for zh is a
  per-POS JSONB **object** (migration 70), so the formatter normalizes it through
  `longDefObjectToDisplayString` (the same helper the API uses to hydrate the
  client string) before rendering — passing the raw object to `.trim()` directly
  threw a 500 on every definitions Approve.
- **`composeExampleSentenceBody`** — `Sentence:` followed by `foreignText`, then
  `Translation:` followed by `english`. Only these two reviewable fields are shown
  — the rest of the stored sentence object (`tense`, `numberDict`, `segments`,
  `partOfSpeechDict`, `senseDict`, …) is machine metadata the validator never sees.

These formatters are shared with `DictionaryDAL`'s approval-freshness check (see
below) so the two always agree on what a given det row's text looks like.

### Approve / Flag
`POST /api/validation/:textId/submit` `{ action }` →
`ValidationService.submitValidation`:
1. Assert validator + ownership + that the text is a validation doc.
   **Validator status is authoritative here**: `userId` comes from the verified JWT
   (`authenticateToken` → `req.user.userId`), and `isValidator` is read fresh from
   the DB via `userDAL.findById` — never from the request body — so it cannot be
   forged, and it fails closed if the column is absent. Ownership (`text.userId ===
   userId`) is also enforced, so an attacker can neither submit as a validator they
   aren't nor act on another user's doc.
2. `content = action === 'approve' ? text.content : null` — Approve copies the
   document's content **verbatim, server-side**; nothing is taken from the request
   body, so there is nothing to re-parse or format-guard (the doc was never
   editable, so `text.content` is always exactly what `composeValidationDoc` wrote).
   Flag stores `null`.
3. `INSERT` a `validations` row. `ON CONFLICT ON CONSTRAINT
   validations_unique_per_user DO NOTHING` — a zero-row result means this
   (user, entry, field) was already recorded, and the request is rejected. This is
   the "after receiving, can never re-approve/flag" rule and is race-safe.
4. **On any accepted submit (both `approve` and `flag`)**, the throwaway validation
   document is auto-deleted from the validator's account
   (`TextService.deleteText(userId, textId)`): the review is done, the (entry, field)
   can never be handed to this user again, so the doc has no further purpose. The
   persisted `validations` row is unaffected — it is not FK-linked to `texts`.

---

## Frontend (Reader document queue)

- **Download button**: a `FactCheck` `IconButton`
  (`reader-page-validate-download-button`) in the header `rightContent` of the
  reader **list** page ONLY (`ReaderPage.tsx`), shown only when
  `useAuth().user?.isValidator`. It calls the shared
  `downloadValidationDoc(token, language)` (`src/features/reader/validationApi.ts`)
  then refreshes the list — it does **not** auto-open the new doc; the validator
  picks it from the list when ready (a snackbar confirms it was added). The
  open-document page (`ReaderDocumentPage.tsx`) deliberately does **not** carry this
  button — you download from the list, then open a doc to act on it.
- **Approve / Flag**: two icon buttons in the **document page header**
  (`ReaderDocumentPage.tsx` `docHeaderRightContent`, alongside Delete — see
  docs/LEAF_NODE_PAGES.md § Reader), rendered only when the open doc's
  `validationEntryId` is set: a green **check** (`CheckCircle`,
  `reader-page-text-header-approve-button`) and a yellow **flag** (`Flag`,
  `reader-page-text-header-flag-button`), always both shown side by side — there is
  no diffing, so which one is "active" is never ambiguous. `handleApprove`/
  `handleFlag` (thin wrappers over `submitValidation`) POST `{ action }` with no
  body content. Feedback shows in `reader-page-validation-snackbar`. After either
  action, the server auto-deletes the doc and the client navigates back to
  `/reader` (the entry can't be re-validated).
- **Read-only, no Edit**: validation docs have **no Edit affordance** anywhere —
  not the doc page header (`isValidationDoc` hides the Edit icon; only Delete stays,
  to abandon a downloaded entry without acting on it) and not the list row
  (`TextSidebar.tsx` hides its Edit icon when `text.validationField` is set, keeps
  Delete). `EditDocumentDialog.tsx` has no validation-specific logic anymore — it's
  purely the generic reader-document editor and is never opened for a validation
  doc. `TextHeader.tsx` renders no validation actions — it is purely the
  title/description/meta block.

---

## Inline Approve/Flag (no document)

A validator doesn't have to go through the Reader queue at all: small Approve/Flag
icon buttons render directly on the est (example sentences) and long-definition
surfaces, wherever a validator is already looking at an entry — flashcard eip tabs,
the cdp, the dictionary card detail. Hidden entirely for non-validators.

- **`src/components/ValidateFlagButtons.tsx`** — the shared control. Props:
  `word1`, `language`, `field` (a `ValidationField`), `alreadyApproved` (the
  caller's `sentence.humanApproved` / `entry.definitionsApproved` — used only as
  a pre-fetch fallback, see below).
  **Both icons always render together, Approve on the LEFT and Flag on the
  RIGHT** (`CheckCircleOutline`/`CheckCircle`, `FlagOutlined`/`Flag`; styled like
  `SpeakerButton` — small, `stopPropagation` so a tap doesn't bubble into an
  enclosing flip/drag/segment handler) — whichever matches this validator's own
  current vote (if any) is swapped to its **filled** variant, colored with the
  project design tokens (approve → `COLORS.greenMain` #05C793 green, flag →
  `COLORS.yellowMain` #FF9E5A orange) and sat on a faint same-color disc so a
  "shaded in" button reads as selected at a glance; the other stays a plain
  outline button. The color only appears once the server has recorded the vote
  (it's driven by `myVote`, which is set on the request's success), so green =
  "approval sent" and orange = "flag sent". All three interactions hit
  `ValidationService.submitEntryValidation`/`clearEntryValidation`/
  `getEntryValidationStatus` via `/api/validation/entry-submit` (POST/DELETE) and
  `/api/validation/entry-status` (GET), all through `src/api/http.ts`
  (`apiPost`/`apiDelete`/`apiGet` — cookie auth, no manual token plumbing):
  1. **Mount**: `!user?.isValidator` → renders `null`. Otherwise GETs
     `/api/validation/entry-status` for this validator's own vote (`myVote`) on
     this (word1, language, field) — this is what makes the filled icon survive a
     reload, unlike the old session-only `done` flag. While that fetch is in
     flight, `alreadyApproved` is used as a fallback to avoid a flash of empty
     outline buttons on an already-approved field; once the fetch resolves
     (including to `null`), `myVote` is the only source of truth.
  2. **Tap the icon that ISN'T the current vote** (or neither vote is set) →
     POSTs `{ word1, language, field, action }`; the server `UPSERT`s the
     validator's row (`ON CONFLICT ... DO UPDATE`), so this both records a fresh
     vote and **switches** an existing one (approve ↔ flag) in one call. `myVote`
     updates optimistically-after-success to the new action.
  3. **Tap the icon that IS the current vote** → sends `DELETE
     /api/validation/entry-submit` (query params `word1`/`language`/`field`),
     which removes just this validator's row — **un-voting**, leaving no signal in
     the DB. `myVote` resets to `null` and both icons return to outline.
  A per-icon `CircularProgress` shows while its own request is in flight;
  the other icon stays interactive.
- **est**: `ExampleSentenceList.tsx` renders one `ValidateFlagButtons` per sentence
  (top-left corner, mirroring the speaker button's top-right), `field` =
  `exampleSentence${index}` for `index < 3` (the field model's only 3 slots) —
  `EXAMPLE_SENTENCE_FIELDS` lookup array, `alreadyApproved={sentence.humanApproved}`
  (the same flag that also drives the AI-generated badge/tint on this sentence, so
  the two disappear together). Needs `vocabWord` (word1) + `language`, both
  already-existing props of this component; sentences past index 2, or a list
  rendered without those props, get no buttons.
- **Long definition**: `LongDefinitionDisplay.tsx` takes new optional `word1`/
  `language` props (`field` is always `'definitions'`) and renders one
  `ValidateFlagButtons` top-right, inside whichever wrapper the content ends up in
  (`finalize`/`wrapAiGenerated` — adds `position: relative` only when needed, so
  existing callers that pass neither prop render byte-identical to before), with
  `alreadyApproved={!aiGenerated}` (the `aiGenerated` prop IS the caller's
  `!entry.definitionsApproved`, so its inverse is exactly "already approved" — same
  signal that drives the AI-generated border/tint/badge). Wired from
  `VocabCardDetailBody.tsx` and `InfoCardPanelBody.tsx` (both pass
  `entry.entryKey`/`entry.language`). **Not** wired from `CompareTabBody.tsx` — its
  `LongDefinitionDisplay` renders the AI word-comparison paragraph
  (docs/WORD_COMPARE_FEATURE.md), which has no backing det field at all.
- **`ValidationService.submitEntryValidation`** (server) — the method behind
  `POST /api/validation/entry-submit`: looks up the det row fresh by `(word1,
  language, discoverable=TRUE)` (the client never knows/sends the det surrogate
  id; shared helper `getDetFieldRowByWord1`), checks the field is populated
  (`isFieldPopulated`, mirrors `composeValidationDoc`'s SQL eligibility check),
  then `UPSERT`s into `validations` (`ON CONFLICT ... DO UPDATE SET action,
  content, validatorName`) — same `content = approve ? composeBody(...) : null`
  as `submitValidation`, but a repeat call from the same validator overwrites
  their prior vote instead of being rejected. No `texts` row is created or
  touched by this path at all.
- **`ValidationService.clearEntryValidation`** — the method behind `DELETE
  /api/validation/entry-submit`: resolves the det row the same way, then deletes
  only the calling validator's `validations` row for (entry, field). A no-op
  (not an error) if they never voted.
- **`ValidationService.getEntryValidationStatus`** — the method behind `GET
  /api/validation/entry-status`: resolves the det row the same way, then returns
  this validator's own current `action` (`'approve' | 'flag' | null`) for
  (entry, field). Used on `ValidateFlagButtons` mount so the filled icon survives
  a page reload.

---

## Read-path surfacing: approval flags + AI-generated styling

Approvals feed back into the learner-facing UI: every AI-written field tells the
user whether a human has vouched for it. Two independent read-time flags cover the
two validation field groups (Field model table above):

| Flag | Covers | Set by |
|---|---|---|
| `humanApproved` (per-sentence) | one `exampleSentences[N]` element | `DictionaryDAL.enrichExampleSentencesMetadataBatch` |
| `definitionsApproved` (per-entry) | `partsOfSpeech` + `definitions[]` + `longDefinition`, bundled as one unit | `DictionaryDAL.enrichDefinitionsApprovalBatch` |

Both share the same shape: a batched query joins `validations` back to the det
table by `entryId` (keyed by `word1` — vet-joined entries carry `entryKey` = det
`word1`, not the det id), keeping only rows with the **approval stamp**
(`action = 'approve'`, `content IS NOT NULL`), then a per-entry/per-sentence
comparison decides whether that specific approval still matches the **current**
det data — an approval recorded before the field was regenerated, re-tagged, or
edited does **not** count. Both sides of the comparison go through the same
`composeDefinitionsBody`/`composeExampleSentenceBody` formatters `ValidationService`
uses to compose the doc, so they always agree byte-for-byte.

- **`humanApproved`** (`server/dal/implementations/DictionaryDAL.ts`, helpers
  `fetchApprovedSentenceContents` + `isSentenceHumanApproved`): rebuilds
  `composeExampleSentenceBody({ foreignText, english })` from the sentence's
  CURRENT raw det values and compares against the stored approval content.
  Index-agnostic (no label/index in the body) so reordering `exampleSentences`
  doesn't orphan an exact approval. Declared on the `exampleSentences` element type
  in `server/types/index.ts` and `src/types.ts`.
- **`definitionsApproved`** (helpers `fetchApprovedDefinitionsContents` +
  `isDefinitionsHumanApproved`): rebuilds `composeDefinitionsBody` from the entry's
  **raw** det columns (fetched fresh, not the caller's already-transformed
  `longDefinition` display string) and compares the whole thing as one unit —
  editing or regenerating ANY of the three columns invalidates the approval for all
  of them. Independent of `enrichExampleSentencesMetadataBatch` (no
  `exampleSentences` precondition); callers chain it alongside
  `enrichLongDefinitionMetadataBatch`. Declared as a top-level field on
  `DictionaryEntry`/`VocabEntry` in `server/types/index.ts` and `src/types.ts` (and
  threaded through `dictEntryAdapter.ts` for the flp det-fallback path).
- Both comparisons run the current body through `sanitizeDocumentContent`
  (idempotent — strips control chars, normalizes line endings) to match how the
  approved content was stored.

**Client** — the shared **AI-generated treatment** lives in
`src/theme/aiGeneratedStyling.ts` (`aiGeneratedSurfaceSx`: orange
`COLORS.yellowMain` border + ~8% tint) and `src/components/AiGeneratedBadge.tsx`
(sparkle + label badge) — the same treatment as the dictionary AI-fallback card
(`AiDictionaryEntryCard`, docs/DICTIONARY_AI_FALLBACK_SEARCH.md). Three consumers:
- `ExampleSentenceList.tsx` (the single est UI component) renders any sentence with
  falsy `humanApproved` in the full treatment (border/tint + "AI GENERATED" badge);
  approved sentences keep the quiet `flashcard.subtleBg` background.
- `LongDefinitionDisplay.tsx` takes an `aiGenerated` prop; when true (i.e. the
  caller passes `!entry.definitionsApproved`) it wraps the rendered long definition
  in the full treatment (border/tint + badge).
- The **Type** (partsOfSpeech) chip in `VocabCardDetailBody.tsx` and
  `InfoCardPanelBody.tsx` gets **only** `aiGeneratedSurfaceSx` (border/tint, no
  badge) when `!entry.definitionsApproved` — a lighter mark since the chip is a
  small, glanceable value rather than a block of prose.

All three surfaces (eip Definition tab, cdp) inherit this automatically since
`VocabCardDetailBody`/`InfoCardPanelBody` are the shared components behind both
card-detail pages.

---

## Content sanitization

`server/utils/sanitizeContent.ts` → `sanitizeDocumentContent(text)`: strips control
chars (keeps `\n`/`\t`) and normalizes line endings. It deliberately does **not**
HTML-escape — the content is only rendered as React text nodes (escaped at render),
so escaping at rest would double-encode (e.g. `&` → `&amp;` shown literally). Wired
into `TextService.createText`/`updateText` (all document saves — this is what
sanitizes a validation doc's composed body before it's stored as `text.content`;
`ValidationService.submitValidation` does not sanitize again, since Approve copies
`text.content` verbatim).

---

## Backfill guard (don't override reviewed fields)

`initRunLog` (`server/scripts/backfill/run-log.js`) exports **`validatedClause(fields,
table)`** — a SQL predicate `NOT EXISTS (SELECT 1 FROM validations val WHERE
val."entryId" = <table>.id AND val.language = <table>.language AND val.field IN (…)
AND val.action IN ('approve','flag'))`. It correlates the `validations` table against
the det row via the **unaliased** table name, so pass the exact table the backfill
selects from. Each affected script builds `const validatedFilter = 'AND ' +
validatedClause([...], 'dictionaryentries_zh')` and interpolates it into its main
`SELECT … WHERE` (next to `discoverable = TRUE`). This check is on `action`, not
`content`, so it is unaffected by flag rows carrying no content.

Applied to the recurring AI writers:

| Field group | `validatedClause([...], table)` | Scripts (zh + es) |
|---|---|---|
| Definitions bundle | `['definitions']` | `backfill-parts-of-speech`, `backfill-long-definitions`, `backfill-process-definitions-array` |
| Example sentences | `['exampleSentence0','exampleSentence1','exampleSentence2']` | `backfill-example-sentences` |

`spanish/backfill-parts-of-speech.js` rewrites definitions/partsOfSpeech and
re-NULLs enrichment for a whole `word1`, so it is guarded at the word-selection
query (`validatedWordFilter`, a `JOIN validations`) — it skips a word if **any** of
its rows has a `definitions` validation.

New/undiscovered words have an empty `validationLog`, so initial enrichment and the
`/mark-discoverable` pipeline are unaffected.

The definition-normalization passes now carry the guard too:

| Script (zh + es) | Writes | Guard |
|---|---|---|
| `backfill-split-semicolon-definitions` | `definitions` | `validatedClause(['definitions'], '<det table>')` in its main SELECT |
| `backfill-expand-abbreviations` | `definitions` | same |
| `backfill-single-char-cedict` (zh only) | `definitions` | **none needed** — by design it only touches *undiscoverable* single-char rows, which cannot have validations |

These were previously unguarded, which mattered because they run **table-wide with
no `discoverable` filter** (es pipeline §B3 steps 1–2 invoke them with no `--words`
scope), so a re-run rewrote `definitions` in place on reviewed rows. On prod the
guard currently excludes 5 zh rows carrying a `definitions` flag. Their
`SCRIPT_VERSION` was deliberately **not** bumped: the change narrows row selection
rather than altering the transformation, and a bump would mark the whole table
stale and trigger a mass re-process.

Under `/oracle-backfill` (which loops the pipeline directly against prod with no
`/data-deploy` review gate) this guard is the only thing standing between a
regeneration loop and a validator's work — treat it as load-bearing.

---

## Key files

- Migrations: `database/migrations/104-add-validation-system.sql`,
  `database/migrations/106-simplify-validator-content.sql`
- Service/controller/routes: `server/services/ValidationService.ts`,
  `server/controllers/ValidationController.ts`, `server/routes/validationRoutes.ts`
  (mounted in `server/server.ts`; wired in `server/dal/setup.ts`)
- Shared body formatter: `server/utils/validationBodyFormat.ts`
  (`composeDefinitionsBody`, `composeExampleSentenceBody`)
- Sanitizer: `server/utils/sanitizeContent.ts`
- Types: `server/types/index.ts` (`ValidationField`, `ValidationRecord`,
  `Text.validation*`, `User.isValidator`) + `src/types.ts` (`ValidationField`,
  `Text.validation*`, `User.isValidator`), `src/AuthContext.tsx`
- Reader UI: `src/features/reader/ReaderPage.tsx`, `src/features/reader/ReaderDocumentPage.tsx`,
  `src/features/reader/TextHeader.tsx`, `src/features/reader/TextSidebar.tsx`,
  `src/features/reader/validationApi.ts`
- Inline Approve/Flag UI: `src/components/ValidateFlagButtons.tsx`,
  `src/api/http.ts` (`apiPost`/`apiDelete`/`apiGet`), wired from `src/features/flashcards/ExampleSentenceList.tsx`
  and `src/components/LongDefinitionDisplay.tsx` (via `src/features/flashcards/VocabCardDetailBody.tsx` +
  `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx`)
- Backfill guard: `server/scripts/backfill/run-log.js` (`validatedClause`)
- Read-path surfacing: `server/dal/implementations/DictionaryDAL.ts`
  (`fetchApprovedSentenceContents`/`isSentenceHumanApproved` for `humanApproved`;
  `fetchApprovedDefinitionsContents`/`isDefinitionsHumanApproved` for
  `definitionsApproved`), `src/features/flashcards/ExampleSentenceList.tsx`,
  `src/components/LongDefinitionDisplay.tsx`, `src/features/flashcards/VocabCardDetailBody.tsx`,
  `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx`,
  `src/theme/aiGeneratedStyling.ts` + `src/components/AiGeneratedBadge.tsx` (shared
  with `AiDictionaryEntryCard.tsx`)
