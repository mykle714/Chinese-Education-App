# Data Validation System

Human-in-the-loop review of AI-enriched dictionary fields. Trusted "validator"
users download an auto-composed Reader document for **one field of one
discoverable entry**, then **Approve** it (unchanged) or **Flag it with a
suggestion** (edited body). Outcomes are recorded in a dedicated `validations`
table so future backfills never clobber human-reviewed fields.

Introduced by **migration 104** (`database/migrations/104-add-validation-system.sql`).

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
sentence and, separately, its definitions bundle. Each (user, entry, field) can be
recorded at most once.

---

## Schema (migration 104)

- `users."isValidator" BOOLEAN NOT NULL DEFAULT false` — gates the validator UI +
  endpoints. Surfaced to the client through the `user` object (login + `/api/auth/me`);
  **not** on the JWT. It must be listed in `UserDAL.findById`'s SELECT
  (`server/dal/implementations/UserDAL.ts`) or it vanishes after a token refresh.
- **`validations`** table — one row per (entry, field) reviewed by a validator:
  ```
  id UUID PK · entryId INTEGER · language VARCHAR(10) · field VARCHAR(50)
  validatorUserId UUID (FK users ON DELETE CASCADE) · validatorName TEXT
  action VARCHAR(20) CHECK IN ('approve','flag') · content TEXT · createdAt
  UNIQUE (entryId, language, field, validatorUserId)   -- one record per user/field
  ```
  `content` holds the reviewed body for **both** actions: for `approve` it is the
  exact data version approved; for `flag` it is the suggested edit. The unique
  constraint enforces the "can never re-validate" rule (`ON CONFLICT DO NOTHING`).
  `(entryId, language)` is indexed for the compose check + backfill guard.
- `texts` validation-linkage columns (nullable; NULL ⇒ ordinary user document):
  `validationEntryId INTEGER` (det id — SERIAL, **not** uuid),
  `validationLanguage VARCHAR(10)`, `validationField VARCHAR(50)`,
  `validationOriginalContent TEXT`. The last is the server's originally-composed
  body, used for client-side change detection (Approve vs Flag) and Revert.

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
3. Compose an editable body (`composeBody`), `title = "Validate - <word1> - <pronunciation>"` (pinyin appended when present),
   `description = <field label>`.
4. Create the doc via `TextService.createText`, which persists the four
   `validation*` columns. Returns the `Text`.

Body format (also the exact `validationOriginalContent`, so Revert/diff compare
byte-for-byte) — **raw stored values, not prose**. Each underlying det field is
written as `<fieldName>:\n<raw JSON value>` (pretty-printed), blank line between fields:
- **definitions** — three blocks: `partsOfSpeech:`, `definitions:`, `longDefinition:`,
  each followed by that column's raw JSON.
- **exampleSentenceN** — `exampleSentenceN:` followed by the JSON of **only** the
  two reviewable fields of `exampleSentences[N]`: `{ foreignText, english }`. The
  rest of the stored sentence object (tense, numberDict, segmentGloss, …) is machine
  metadata and is intentionally omitted from the validation body.

### Approve / Flag
`POST /api/validation/:textId/submit` `{ action, content }` →
`ValidationService.submitValidation`:
1. Assert validator + ownership + that the text is a validation doc.
   **Validator status is authoritative here**: `userId` comes from the verified JWT
   (`authenticateToken` → `req.user.userId`), and `isValidator` is read fresh from
   the DB via `userDAL.findById` — never from the request body — so it cannot be
   forged, and it fails closed if the column is absent. Ownership (`text.userId ===
   userId`) is also enforced, so an attacker can neither submit as a validator they
   aren't nor act on another user's doc.
2. **Format + shape guard** (`assertOnlyJsonValuesEdited(content, original, field)`):
   two layers, both throwing `ValidationFormatError` (code
   `ERR_VALIDATION_FORMAT_CHANGED`, HTTP 400):
   - **Format** — the body must still split (via `parseValidationBlocks`) into exactly
     the composed `<fieldName>:\n<JSON>` blocks (same headers, order, no stray text)
     with each block valid JSON. The split is unambiguous because a header line
     trimmed is exactly `<fieldName>:` while pretty-printed JSON lines are always
     quoted/bracketed.
   - **Shape** — each block's JSON **key shape** must match the server-composed
     `original` (`text.validationOriginalContent`), compared by `sameJsonShape`:
     object key names/sets identical at every level, container types matching; only
     primitive leaf **values** may differ and array **lengths** may differ. This
     blocks a renamed/added/removed key — which stays valid JSON but the server would
     no longer recognize. Runs for **both** actions (an approval's unedited body
     always passes). The block field-names are the single source of truth in
     `expectedBlockFields`, shared with `composeBody`.
3. `INSERT` a `validations` row with `content = sanitizeDocumentContent(content)`
   for **both** actions (the approved data version, or the suggested edit; stored
   verbatim, **never reparsed** into columns). `ON CONFLICT ON CONSTRAINT
   validations_unique_per_user DO NOTHING` — a zero-row result means this
   (user, entry, field) was already recorded, and the request is rejected. This is
   the "after receiving, can never re-approve/flag" rule and is race-safe.
4. **On any accepted submit (both `approve` and `flag`)**, the throwaway validation
   document is auto-deleted from the validator's account
   (`TextService.deleteText(userId, textId)`): the review is done, the (entry, field)
   can never be re-handed to this user, so the doc has no further purpose. The
   persisted `validations` row is unaffected — its `content` (the approved version
   or the suggested edit) is stored verbatim and is not FK-linked to `texts`.

The client sends `content = selectedText.content` for both actions (for an approval
that equals the original body; for a flag it is the edit).

### Revert
No endpoint — the client PUTs `validationOriginalContent` back through the ordinary
`PUT /api/texts/:id`.

---

## Frontend (Reader)

- **Download button**: a `FactCheck` `IconButton`
  (`reader-page-validate-download-button`) in the header `rightContent` of the
  reader **list** page ONLY (`ReaderPage.tsx`), shown only when
  `useAuth().user?.isValidator`. It calls the shared
  `downloadValidationDoc(token, language)` (`src/features/reader/validationApi.ts`)
  then refreshes the list — it does **not** auto-open the new doc; the validator
  picks it from the list when ready (a snackbar confirms it was added). The
  open-document page (`ReaderDocumentPage.tsx`) deliberately does **not** carry this
  button — you download from the list, then open a doc to act on it.
- **Approve / Flag / Revert**: icon buttons in the **document page header**
  (`ReaderDocumentPage.tsx` `docHeaderRightContent`, alongside Edit/Delete — see
  docs/LEAF_NODE_PAGES.md § Reader), rendered only when the open doc's
  `validationEntryId` is set. The action is a green **check** (`CheckCircle`,
  `reader-page-text-header-approve-button`) when the body equals
  `validationOriginalContent`, flipping to a yellow **flag** (`Flag`,
  `reader-page-text-header-flag-button`) once edited (`isValidationChanged`).
  **Revert** (`Undo`, `reader-page-text-header-revert-button`) restores the original
  (disabled when unchanged). Handlers `handleApproveOrFlag` / `handleRevertValidation`
  live in `ReaderDocumentPage`; feedback shows in `reader-page-validation-snackbar`.
  When the server rejects a submit with `ERR_VALIDATION_FORMAT_CHANGED` (the body's
  format was altered), `handleApproveOrFlag` shows an explicit error-severity
  snackbar telling the validator it's a format issue and to Revert and start over
  (all other failures show `data.error`). After any accepted submit (Approve **or**
  Flag), the server auto-deletes the doc and the client navigates back to `/reader`
  (the entry can't be re-validated). `TextHeader.tsx` no longer renders
  any validation actions — it is purely the title/description/meta block.
- Editing the body uses the existing **Edit** modal (`EditDocumentDialog`) — the
  reader body viewer (`TextArea`) is read-only. After an edit saves, the diff flips
  the header action to the yellow flag automatically. Validation docs are
  `isUserCreated = true`, so Edit/Delete/PUT all work; the user may delete a
  validation doc freely (and any accepted Approve/Flag deletes it automatically —
  see the Approve/Flag step above).
- **Client-side format guard + whitespace lock (canonicalize-on-save):** the guard
  runs on **both** edit surfaces, but **only when the doc is a validation doc**
  (`text.validationField` set) — ordinary reader documents have no `validationField`
  and always save their draft verbatim:
  - the doc page's inline editor save (`ReaderDocumentPage.handleSaveEdit`, the
    primary editing surface — `ReaderEditToolbar` Save), and
  - the list-row **Edit** modal (`EditDocumentDialog.handleSave`).

  Both run two checks (`src/features/reader/validationFormat.ts`) **before** the PUT,
  blocking the save with `VALIDATION_FORMAT_MESSAGE` on failure:
  - `canonicalizeValidationBody(content, field)` — a `null` result means the format
    was broken (wrong/renamed/reordered headers, stray text, or invalid JSON);
    otherwise the **canonical** re-serialization is what gets saved. Canonicalizing
    parses each block and re-emits `<fieldName>:\n<JSON.stringify(value,null,2)>`,
    which **resets every character outside the JSON values** — headers, block
    separators, indentation, stray/trailing whitespace. This is the fix for
    whitespace-only edits: they parse fine as JSON but used to differ byte-wise from
    the composed original and so falsely tripped the Approve→Flag diff. After
    canonicalization a whitespace-only edit round-trips to `validationOriginalContent`
    exactly, so the doc stays **Approve** (green); only a real JSON-value change
    produces a **Flag**.
  - `isValidationShapePreserved(content, validationOriginalContent, field)` — compares
    each block's JSON **key shape** against the composed original via `sameJsonShape`
    (object key names/sets identical at every level; only leaf values / array lengths
    may differ). This blocks a **renamed/added/removed key** — which canonicalizes
    fine (still valid JSON) but the server would no longer recognize.

  `isValidationFormatIntact` is a thin `!== null` wrapper over
  `canonicalizeValidationBody`. The server re-runs the equivalent format **and** shape
  checks in `assertOnlyJsonValuesEdited(content, original, field)` on submit as the
  source of truth (same `expectedBlockFields`, `parseValidationBlocks`, `sameJsonShape`).

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
(`action = 'approve'`), then a per-entry/per-sentence comparison decides whether
that specific approval still matches the **current** det data — an approval
recorded before the field was regenerated, re-tagged, or edited does **not** count.

- **`humanApproved`** (`server/dal/implementations/DictionaryDAL.ts`, helpers
  `fetchApprovedSentenceContents` + `isSentenceHumanApproved`): the comparison
  mirrors `composeBody`/`rawField` for `exampleSentenceN` — the stored content's
  label line is stripped at fetch time, and the remainder is compared against
  `JSON.stringify(<raw det sentence object>, null, 2)` (both sides read the same
  jsonb, so Postgres's canonical key order makes this deterministic). Matching is
  index-agnostic (label stripped) so reordering `exampleSentences` doesn't orphan an
  exact approval. Declared on the `exampleSentences` element type in
  `server/types/index.ts` and `src/types.ts`.
- **`definitionsApproved`** (helpers `fetchApprovedDefinitionsContents` +
  `isDefinitionsHumanApproved`): rebuilds the exact `composeBody` output for
  `definitions` (three `rawField` blocks — `partsOfSpeech`, `definitions`,
  `longDefinition` — joined by blank lines) from the entry's **raw** det columns
  (fetched fresh, not the caller's already-transformed `longDefinition` display
  string) and compares the whole thing as one unit — editing or regenerating ANY of
  the three columns invalidates the approval for all of them. Independent of
  `enrichExampleSentencesMetadataBatch` (no `exampleSentences` precondition);
  callers chain it alongside `enrichLongDefinitionMetadataBatch`. Declared as a
  top-level field on `DictionaryEntry`/`VocabEntry` in `server/types/index.ts` and
  `src/types.ts` (and threaded through `dictEntryAdapter.ts` for the flp det-fallback
  path).
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
into `TextService.createText`/`updateText` (all document saves) and into every
validation submission's `content` before it is persisted.

---

## Backfill guard (don't override reviewed fields)

`initRunLog` (`server/scripts/backfill/run-log.js`) exports **`validatedClause(fields,
table)`** — a SQL predicate `NOT EXISTS (SELECT 1 FROM validations val WHERE
val."entryId" = <table>.id AND val.language = <table>.language AND val.field IN (…)
AND val.action IN ('approve','flag'))`. It correlates the `validations` table against
the det row via the **unaliased** table name, so pass the exact table the backfill
selects from. Each affected script builds `const validatedFilter = 'AND ' +
validatedClause([...], 'dictionaryentries_zh')` and interpolates it into its main
`SELECT … WHERE` (next to `discoverable = TRUE`).

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
`/mark-discoverable` pipeline are unaffected. One-shot definition-normalization
passes (`backfill-split-semicolon-definitions`, `backfill-expand-abbreviations`,
`backfill-single-char-cedict`) are not part of the recurring `--stale` loop; adopt
`validatedClause(['definitions'], '<their det table>')` there too if they are ever
re-run over discoverable rows.

---

## Key files

- Migration: `database/migrations/104-add-validation-system.sql`
- Service/controller/routes: `server/services/ValidationService.ts`,
  `server/controllers/ValidationController.ts`, `server/routes/validationRoutes.ts`
  (mounted in `server/server.ts`; wired in `server/dal/setup.ts`)
- Sanitizer: `server/utils/sanitizeContent.ts`
- Types: `server/types/index.ts` (`ValidationField`, `ValidationRecord`,
  `Text.validation*`, `User.isValidator`) + `src/types.ts` (`ValidationField`,
  `Text.validation*`, `User.isValidator`), `src/AuthContext.tsx`
- Reader UI: `src/features/reader/ReaderPage.tsx`, `src/features/reader/ReaderDocumentPage.tsx`,
  `src/features/reader/TextHeader.tsx`, `src/features/reader/validationApi.ts`
- Backfill guard: `server/scripts/backfill/run-log.js` (`validatedClause`)
- Read-path surfacing: `server/dal/implementations/DictionaryDAL.ts`
  (`fetchApprovedSentenceContents`/`isSentenceHumanApproved` for `humanApproved`;
  `fetchApprovedDefinitionsContents`/`isDefinitionsHumanApproved` for
  `definitionsApproved`), `src/features/flashcards/ExampleSentenceList.tsx`,
  `src/components/LongDefinitionDisplay.tsx`, `src/features/flashcards/VocabCardDetailBody.tsx`,
  `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx`,
  `src/theme/aiGeneratedStyling.ts` + `src/components/AiGeneratedBadge.tsx` (shared
  with `AiDictionaryEntryCard.tsx`)
- Read-path surfacing: `server/dal/implementations/DictionaryDAL.ts`
  (`fetchApprovedSentenceContents`, `isSentenceHumanApproved`, `humanApproved` on both
  enrichment branches), `src/features/flashcards/ExampleSentenceList.tsx`,
  `src/theme/aiGeneratedStyling.ts` + `src/components/AiGeneratedBadge.tsx`
  (shared with `AiDictionaryEntryCard.tsx`)
