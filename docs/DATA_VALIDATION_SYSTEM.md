# Data Validation System

Human-in-the-loop review of AI-enriched dictionary fields. Trusted "validator"
users download an auto-composed, **read-only** Reader document for **one field of
one discoverable entry**, then **Approve** it or **Flag** it. There is no editing:
Approve copies the document's displayed content verbatim; Flag records only the
flag itself, no content. Outcomes go to a dedicated `validations` table so future
backfills never clobber human-reviewed fields.

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
sentence and, separately, its definitions bundle. Each (user, entry, field) can be
recorded at most once.

---

## Schema (migration 104, updated by 106)

- `users."isValidator" BOOLEAN NOT NULL DEFAULT false` — gates the validator UI +
  endpoints. Surfaced to the client through the `user` object (login + `/api/auth/me`);
  **not** on the JWT. It must be listed in `UserDAL.findById`'s SELECT
  (`server/dal/implementations/UserDAL.ts`) or it vanishes after a token refresh.
- **`validations`** table — one row per (entry, field) reviewed by a validator:
  ```
  id UUID PK · entryId INTEGER · language VARCHAR(10) · field VARCHAR(50)
  validatorUserId UUID (FK users ON DELETE CASCADE) · validatorName TEXT
  action VARCHAR(20) CHECK IN ('approve','flag') · content TEXT NULLABLE · createdAt
  UNIQUE (entryId, language, field, validatorUserId)   -- one record per user/field
  ```
  `content` is the data version approved, copied verbatim from the document the
  validator read — `NULL` for a flag (flag is just a signal; it carries no
  suggested edit). The unique constraint enforces the "can never re-validate" rule
  (`ON CONFLICT DO NOTHING`). `(entryId, language)` is indexed for the compose
  check + backfill guard.
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
`/mark-discoverable` pipeline are unaffected. One-shot definition-normalization
passes (`backfill-split-semicolon-definitions`, `backfill-expand-abbreviations`,
`backfill-single-char-cedict`) are not part of the recurring `--stale` loop; adopt
`validatedClause(['definitions'], '<their det table>')` there too if they are ever
re-run over discoverable rows.

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
- Backfill guard: `server/scripts/backfill/run-log.js` (`validatedClause`)
- Read-path surfacing: `server/dal/implementations/DictionaryDAL.ts`
  (`fetchApprovedSentenceContents`/`isSentenceHumanApproved` for `humanApproved`;
  `fetchApprovedDefinitionsContents`/`isDefinitionsHumanApproved` for
  `definitionsApproved`), `src/features/flashcards/ExampleSentenceList.tsx`,
  `src/components/LongDefinitionDisplay.tsx`, `src/features/flashcards/VocabCardDetailBody.tsx`,
  `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx`,
  `src/theme/aiGeneratedStyling.ts` + `src/components/AiGeneratedBadge.tsx` (shared
  with `AiDictionaryEntryCard.tsx`)
