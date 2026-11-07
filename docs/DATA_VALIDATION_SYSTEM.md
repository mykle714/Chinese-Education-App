# Data Validation System

Human-in-the-loop review of AI-enriched dictionary fields. Trusted "validator"
users review **one field of one discoverable entry** and **Approve** or **Flag**
it via **inline Approve/Flag buttons** rendered directly on the est/definition/meta-chip
UI wherever the entry is already displayed (`ValidationService.submitEntryValidation`)
— see "Inline Approve/Flag" below. There is no editing: Approve always composes the
CURRENT data server-side (never trusts client content); Flag records only the flag
itself, no content.

> **Removed 2026-11-05 — the Reader document queue.** Validators used to also
> download a composed, read-only "Validate - <word1>" Reader document and
> Approve/Flag it (`POST /api/validation/download`, `POST /api/validation/:textId/submit`,
> `ValidationService.composeValidationDoc` / `submitValidation`). That path, its
> client (`src/features/reader/validationApi.ts`, the list page's download button,
> the document page's Approve/Flag) and its `texts."validation*"` linkage columns
> are gone — **migration 183** deleted the unsubmitted validation docs and dropped
> the columns. The `validations` rows it wrote are kept and read like any other. Outcomes go to a dedicated `validations`
table so future backfills never clobber human-reviewed fields.

Introduced by **migration 104** (`database/migrations/104-add-validation-system.sql`),
simplified by **migration 106** (`database/migrations/106-simplify-validator-content.sql`
— dropped the edit/suggest/revert flow, `validations.content` nullable, dropped
`texts.validationOriginalContent`), widened by **migration 132**
(`database/migrations/132-split-parts-of-speech-validation-field.sql` — split
`partsOfSpeech` out of the definitions bundle and added `difficulty` +
`frequencyScore`, so all three meta-strip chips are independently reviewable), and
given **per-sense granularity** by **migration 139**
(`database/migrations/139-add-sense-label-to-validations.sql` — a `senseLabel`
discriminator + the `senseFrequencyScore` field, so the Commonality chip's per-cluster
score is reviewable one sense at a time). **Migration 183** removed the Reader
document queue's `texts` linkage columns.

> **Why a separate table (not a det column):** `dictionaryentries_{zh,es}` are
> `TRUNCATE`+restored wholesale on every PPE data deploy
> ([DATA_DEPLOYMENT_GUIDE.md](./DATA_DEPLOYMENT_GUIDE.md)), which would wipe any
> review column. `validations` was deliberately kept out of the old dev → PPE deploy allowlist, and is keyed
> by the det row's surrogate `id` (stable across deploys — the binary dump preserves
> id values) + `language`, so it survives every deploy.

---

## Field model

A validation targets exactly one **field** of an entry — and, since migration 139, at
most one **sense** of that field. Eight fields exist, all reviewed inline (the first
four were also handed out by the removed Reader-document queue, so older `validations`
rows for them may carry a doc-queue origin — they are indistinguishable and read the same):

| `validationField` | Source column(s) | Body (`validationBodyFormat.ts`) | Notes |
|---|---|---|---|
| `definitions` | `definitions[]` + `longDefinition` | `composeDefinitionsBody` | |
| `exampleSentence0/1/2` | `exampleSentences[N]` (`foreignText` + `english`) | `composeExampleSentenceBody` | |
| `partsOfSpeech` | `partsOfSpeech` | `composePartsOfSpeechBody` | |
| `difficulty` | `difficulty` | `composeDifficultyBody` | |
| `frequencyScore` | `frequencyScore` | `composeFrequencyScoreBody` | |
| `senseFrequencyScore` | `definitionClusters[i].frequencyScore` | `composeSenseFrequencyScoreBody` | **per sense** |

Only **populated** fields are eligible: `definitions` requires both its columns,
`exampleSentenceN` requires `exampleSentences` to have index `N`, and each of the
three single-column fields requires a non-null value, and `senseFrequencyScore` requires
its `senseLabel` to still resolve to a cluster that carries a score (a stale label — the
entry was re-clustered since the client rendered it — is rejected, never recorded). The
check is `ValidationService.isFieldPopulated`. The `ValidationField` union is declared
in both `server/types/index.ts` and `src/types.ts`, and the inline endpoints'
allow-list is `VALID_FIELDS` in `server/controllers/ValidationController.ts`.

> **Why POS is its own field (migration 132).** `definitions` used to bundle three
> columns and open its body with `Parts of Speech: …`. That forced a validator to
> endorse the POS tags and the long definition together, and — because the read path
> revalidates an approval by rebuilding the body byte-for-byte — any regeneration of
> `longDefinition` silently invalidated the POS review too. Splitting them means each
> chip's approval survives the other's churn. Migration 132 preserves history rather
> than resetting it: every pre-existing `definitions` record is **re-filed as a second
> `partsOfSpeech` record** (approvals carry the extracted `Parts of Speech: …` line,
> which is byte-identical to what `composePartsOfSpeechBody` now emits; flags carry
> NULL content, as flags always do), and the POS block is then stripped from the
> remaining `definitions` approvals so they still match the new composer. Both steps
> are idempotent.

> **Why commonality is per SENSE (migration 139).** A word-level `frequencyScore` is
> a lie for a polyseme: 干 "to do" comes up constantly (5) while 干 "shield" is
> effectively never spoken (1). The clusterer already scores each sense independently
> ([DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md)), and the eip/cdp Commonality chip
> now shows the score of the sense the card is on — so the chip's Approve/Flag pair had
> to follow, or a validator would be endorsing a number that is not on screen. Which of
> the two the chip shows is decided by `resolveCommonality`
> (`src/utils/definitionUtils.ts`): a clustered word with a scored cluster →
> `senseFrequencyScore` + that cluster's `sense` label; anything else (unclustered,
> single-cluster, or a cluster whose scoring pass failed) → the entry-level
> `frequencyScore`, exactly as before. Both carry the caption "Commonality" — the
> learner never sees the distinction.

Granularity is **per (entry, field, senseLabel)**: a user may validate an entry's example
sentence and, separately, its definitions bundle — and, for a per-sense field, each sense
independently. Each (user, entry, field) has at
most one CURRENT record, which a validator may switch (approve ↔ flag) or clear
entirely (see "Inline Approve/Flag" below).

### Adding another validatable field

`validations.field` is a free-text `VARCHAR(50)` with no CHECK constraint, so a new
field needs **no DDL** — unless it is addressed by something finer than the entry, in
which case it also needs a discriminator in the uniqueness key (migration 139 added
`senseLabel` for exactly that; a per-sense field must additionally be listed in
`PER_SENSE_VALIDATION_FIELDS`, which is what makes the controller require a `senseLabel`
and the service compose a per-sense body). It does need, in order: the `ValidationField` union in both
type files; `VALID_FIELDS` (controller); `DET_FIELD_COLUMNS`,
`DetFieldRow`, `composeBody`, `isFieldPopulated` (`ValidationService`); a formatter
in `validationBodyFormat.ts`; `ENTRY_LEVEL_VALIDATION_FIELDS` + `EntryApprovalFlags`
(`server/types/index.ts`) and the matching branch in
`DictionaryDAL.enrichFieldApprovalsBatch` if the client needs a read-path flag; a
client mount point for `ValidateFlagButtons`; and a `validatedClause` guard in every
backfill that writes the column (plus its `validationFields` entry in
`requiredScripts.js`).

---

## Schema (migration 104, updated by 106)

- `users."isValidator" BOOLEAN NOT NULL DEFAULT false` — gates the validator UI +
  endpoints (dictionary data approval ONLY). It used to ALSO gate the Night Market
  template editor; migration 115 split that onto its own `users."isTemplateAuthor"`
  flag, so the two responsibilities are now independent grants.

  **Data validation is its ONLY job.** From 2026-08-22 it was also reused as the
  "trusted tester" grant (the Study Challenge "allow anytime" hatch, then the soft-intro
  override, the banking always-play toggle, the tester dashboard and the arena manual
  tick). Migration 178 split those onto their own `users."isFeatureTester"` flag — the
  same move 115 made for the template author — and backfilled every existing validator
  as a feature tester, so granting `isValidator` no longer grants the ability to bypass
  the challenge week. The remaining `isValidator` readers are all data curation: this
  system's endpoints and buttons (`server/services/ValidationService.ts`,
  `src/components/ValidateFlagButtons.tsx`) and lazy AI enrichment spend
  (`server/services/LazyEnrichmentService.ts`, `server/controllers/DictionaryController.ts`).
  Do not gate a new testing tool on it — use `isFeatureTester`. Surfaced to the client
  through the `user` object (login + `/api/auth/me`);
  **not** on the JWT. It must be listed in `UserDAL.findById`'s SELECT
  (`server/dal/implementations/UserDAL.ts`) or it vanishes after a token refresh.
- **`validations`** table — one CURRENT row per (entry, field) reviewed by a validator:
  ```
  id UUID PK · entryId INTEGER · language VARCHAR(10) · field VARCHAR(50)
  senseLabel TEXT NOT NULL DEFAULT ''      -- migration 139
  validatorUserId UUID (NOT a FK — see below) · validatorName TEXT
  action VARCHAR(20) CHECK IN ('approve','flag') · content TEXT NULLABLE · createdAt
  UNIQUE (entryId, language, field, senseLabel, validatorUserId)
  ```
  `senseLabel` (**migration 139**) is the `definitionClusters[].sense` label a per-sense
  record reviews, and the **empty string** for every entry-level field. It is `NOT NULL`
  *because* it joins the uniqueness key: Postgres treats NULLs as DISTINCT in a UNIQUE
  constraint, so a nullable discriminator would let one validator insert unlimited
  duplicate entry-level rows and quietly break the `ON CONFLICT ON CONSTRAINT
  validations_unique_per_user` upsert both submit paths depend on. Existing rows take ''
  from the DEFAULT, so their uniqueness semantics are unchanged.
  `validatorUserId` **was** `FK users(id) ON DELETE CASCADE`, but **migration 120
  dropped that FK** (the column stays `UUID NOT NULL`). Reason: PPE is the source of
  truth for `validations` and it is pulled DOWN to dev boxes via `/data-ppe-to-dev`; a dev
  box that lacks a PPE validator's account would otherwise abort the restore. The
  column is never JOINed to `users` — it is a scalar identity only (the unique
  constraint + the "did I already validate this?" filters), and display uses the
  denormalized `validatorName` — so the FK bought nothing on reads. Now consistent
  with `entryId`, which is a deliberately unconstrained id. Trade-off: deleting a user no longer cascades away their validation rows;
  they survive as (harmless, still-displayable) orphans.
  `content` is the data version approved, composed server-side from the det row
  (`composeBody`) — `NULL` for a flag (flag is just a signal; it carries no
  suggested edit). The unique constraint keys the inline path's switch/clear
  (`ON CONFLICT DO UPDATE` / `DELETE`) — see "Inline Approve/Flag" below. There is no history of a superseded vote: switching or clearing
  overwrites/deletes the row in place. `(entryId, language)` is indexed for the
  compose check + backfill guard.
- `texts` validation-linkage columns — **dropped**. Migration 104 added
  `validationEntryId` / `validationLanguage` / `validationField` /
  `validationOriginalContent` for the Reader document queue; 106 dropped
  `validationOriginalContent` when editing was removed, and **183** dropped the
  other three with the queue itself.

The consolidated schema files (`database/init/01-init-schema.sql`,
`database/deploy/01-schema.sql`) mirror the `users` + `validations`
additions. `validations` was intentionally **absent** from the old dev → PPE deploy allowlist.
(It *is* carried by `/data-ppe-to-dev`, which is safe: that direction overwrites dev
from the authoritative PPE copy.)

---

## Review body format

Approve stores, as `validations.content`, the field's current data pretty-printed by
`ValidationService.composeBody`. Body format — plain human-readable prose, **not** JSON — built by the shared
formatters in `server/utils/validationBodyFormat.ts`:
- **`composeDefinitionsBody`** — `Parts of Speech: <comma list>`, then
  `Definitions:` as a numbered list, then `Long Definition:` followed by the prose.
  `longDefinition` is read straight from the raw det column, which is JSONB
  (migration 70) — a **per-sense array** for zh (`[{sense, pos, definition}, …]`,
  docs/DEFINITION_CLUSTERS.md) and a **per-POS object** for es/pre-v14 rows — so the
  formatter normalizes it through `longDefToDisplayString` before rendering; passing
  the raw value to `.trim()` directly threw a 500 on every definitions Approve. The
  validator reviews the field as a whole, so this shows **every** sense labeled
  `"<sense> (<pos>): …"`, unlike the learner surfaces, which show only the sense the
  card is on (`resolveLongDefinition`).
- **`composeExampleSentenceBody`** — `Sentence:` followed by `foreignText`, then
  `Translation:` followed by `english`. Only these two reviewable fields are shown
  — the rest of the stored sentence object (`tense`, `numberDict`, `segments`,
  `partOfSpeechDict`, `senseDict`, …) is machine metadata the validator never sees.

These formatters are shared with `DictionaryDAL`'s approval-freshness check (see
below) so the two always agree on what a given det row's text looks like.

## Inline Approve/Flag

Small Approve/Flag
icon buttons render directly on the est (example sentences) and long-definition
surfaces, wherever a validator is already looking at an entry — flashcard eip tabs,
the cdp, the dictionary card detail. Hidden entirely for non-validators.

> **The icon pair itself lives in `ValidateFlagButtonsView.tsx`.** The
> presentation (icon pair, fill-on-a-disc styling, per-icon spinner,
> `stopPropagation` handling) is split from `ValidateFlagButtons`, which owns the
> `/api/validation/entry*` calls and the validator gate. Det-entry fields are the
> only validation surface in the app.
>
> A second surface briefly existed — approve/flag on an authored wrong glyph for
> the Mandela game — with its own table and endpoints. That game's levels 2 and 3
> were removed in full; see [SPEED_READING_GAME.md](./SPEED_READING_GAME.md). The
> container/presentational split is kept because it reads well, not because a
> second consumer is coming.

- **`src/components/ValidateFlagButtons.tsx`** — the det-field wrapper. Props:
  `word1`, `language`, `field` (a `ValidationField`), `alreadyApproved` (the
  caller's matching read-path flag — `sentence.humanApproved`,
  `entry.definitionsApproved`, `entry.partsOfSpeechApproved`, … — used only as a
  pre-fetch fallback, see below), and `dense` (compact variant: smaller icons, no
  button padding — used by the meta-strip chips, where a full-size icon button would
  be taller than the chip it annotates).
  **Both icons always render together, Approve on the LEFT and Flag on the
  RIGHT** (`CheckCircleOutline`/`CheckCircle`, `FlagOutlined`/`Flag`; styled like
  `SpeakerButton` — small, `stopPropagation` so a tap doesn't bubble into an
  enclosing flip/drag/segment handler) — whichever matches this validator's own
  current vote (if any) is swapped to its **filled** variant, colored with the
  project design tokens (approve → `COLORS.greenMain` #05C793 green, flag →
  `COLORS.aiGenerated` #FF9E5A orange) and sat on a faint same-color disc so a
  "shaded in" button reads as selected at a glance; the other stays a plain
  outline button. The color only appears once the server has recorded the vote
  (it's driven by `myVote`, which is set on the request's success), so green =
  "approval sent" and orange = "flag sent". All three interactions hit
  `ValidationService.submitEntryValidation`/`clearEntryValidation`/
  `getEntryValidationStatus` via `/api/validation/entrySubmit` (POST/DELETE) and
  `/api/validation/entryStatus` (GET), all through `src/api/http.ts`
  (`apiPost`/`apiDelete`/`apiGet` — cookie auth, no manual token plumbing):
  1. **Mount**: `!user?.isValidator` → renders `null`. Otherwise GETs
     `/api/validation/entryStatus` for this validator's own vote (`myVote`) on
     this (word1, language, field, senseLabel) — this is what makes the filled icon survive a
     reload, unlike the old session-only `done` flag. While that fetch is in
     flight, `alreadyApproved` is used as a fallback to avoid a flash of empty
     outline buttons on an already-approved field; once the fetch resolves
     (including to `null`), `myVote` is the only source of truth.
  2. **Tap the icon that ISN'T the current vote** (or neither vote is set) →
     POSTs `{ word1, language, field, action, senseLabel? }`; the server `UPSERT`s the
     validator's row (`ON CONFLICT ... DO UPDATE`), so this both records a fresh
     vote and **switches** an existing one (approve ↔ flag) in one call. `myVote`
     updates optimistically-after-success to the new action.
  3. **Tap the icon that IS the current vote** → sends `DELETE
     /api/validation/entrySubmit` (query params `word1`/`language`/`field`),
     which removes just this validator's row — **un-voting**, leaving no signal in
     the DB. `myVote` resets to `null` and both icons return to outline.
  A per-icon `CircularProgress` shows while its own request is in flight;
  the other icon stays interactive.
- **est**: `ExampleSentenceList.tsx` renders one `ValidateFlagButtons` per sentence
  inside the card's **top-right corner** (`.example-sentence-actions`, an
  absolutely-positioned row it shares with the sentence speaker),
  `field` =
  `exampleSentence${index}` for `index < 3` (the field model's only 3 slots) —
  `EXAMPLE_SENTENCE_FIELDS` lookup array, `alreadyApproved={sentence.humanApproved}`
  (the same flag that also drives the AI-generated ring + tag on this sentence, so
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
  `entry.entryKey`/`entry.language`). **Not** wired from `CompareWorkspace.tsx` — its
  `LongDefinitionDisplay` renders the AI word-comparison paragraph
  (docs/WORD_COMPARE_FEATURE.md), which has no backing det field at all.
- **Meta-strip chips** (migration 132): `src/features/flashcards/MetaChipLabel.tsx`
  renders a chip's uppercase caption followed by a `dense` `ValidateFlagButtons` for
  that chip's own field (`difficulty` / `partsOfSpeech` / `frequencyScore` or
  `senseFrequencyScore`), with `alreadyApproved` = the chip's read-path flag. The
  Commonality chip additionally passes `senseLabel` when it is showing a per-sense score
  (migration 139) — `MetaChipLabel` threads it straight through, and
  `ValidateFlagButtons` keys its status fetch on it, so switching senses refetches that
  sense's own vote (and clears the previous one's filled icon while the fetch is in
  flight, since the picker swaps the prop in place rather than remounting). Used by **`src/features/flashcards/DefinitionFacts.tsx`** — the ONE component both
  card-detail surfaces render since 2026-08-24 (the cdp's Definition box and the eip's
  definition tab), which passes `entry.entryKey` / `entry.language` and its own
  `classPrefix`; the buttons are skipped when `language` is absent (det-fallback
  entries). The pair is an absolutely-positioned overlay in
  the chip's **top-right corner** with no surface of its own — styled exactly like the
  est cards' corner buttons, floating over the chip without displacing its text. Each
  parent chip therefore carries `position: relative`. Non-validators see the plain caption exactly as
  before, since `ValidateFlagButtons` renders `null` for them. It is a MODULE-level
  component on purpose — declaring it inside a parent's render body would make it a
  new component type every render, remounting the buttons and re-firing their status
  fetch.
- **`ValidationService.submitEntryValidation`** (server) — the method behind
  `POST /api/validation/entrySubmit`: looks up the det row fresh by `(word1,
  language, discoverable=TRUE)` (the client never knows/sends the det surrogate
  id; shared helper `getDetFieldRowByWord1`), checks the field is populated
  (`isFieldPopulated`),
  then `UPSERT`s into `validations` (`ON CONFLICT ... DO UPDATE SET action,
  content, validatorName`), writing the `senseLabel` normalized by
  `normalizeSenseLabel` — the trimmed label for a per-sense field, `''` for every
  entry-level one, so a stray label on `difficulty` can never fork that field's record
  into two rows past the unique constraint — with `content = approve ? composeBody(...) : null`.
  A repeat call from the same validator overwrites their prior vote.
- **`ValidationService.clearEntryValidation`** — the method behind `DELETE
  /api/validation/entrySubmit`: resolves the det row the same way, then deletes
  only the calling validator's `validations` row for (entry, field). A no-op
  (not an error) if they never voted.
- **`ValidationService.getEntryValidationStatus`** — the method behind `GET
  /api/validation/entryStatus`: resolves the det row the same way, then returns
  this validator's own current `action` (`'approve' | 'flag' | null`) for
  (entry, field). Used on `ValidateFlagButtons` mount so the filled icon survives
  a page reload.

---

## Read-path surfacing: approval flags + AI-generated styling

Approvals feed back into the learner-facing UI: every AI-written field tells the
user whether a human has vouched for it. Five read-time flags cover the validation
fields (Field model table above), split by granularity:

| Flag | Covers | Set by |
|---|---|---|
| `humanApproved` (per-sentence) | one `exampleSentences[N]` element | `DictionaryDAL.enrichExampleSentencesMetadataBatch` |
| `definitionsApproved` (per-entry) | `definitions[]` + `longDefinition`, bundled as one unit | `DictionaryDAL.enrichFieldApprovalsBatch` |
| `partsOfSpeechApproved` (per-entry) | `partsOfSpeech` | ″ |
| `difficultyApproved` (per-entry) | `difficulty` | ″ |
| `frequencyScoreApproved` (per-entry) | `frequencyScore` | ″ |
| `approvedSenseFrequencyLabels` (per-**sense**, a label LIST) | each `definitionClusters[i].frequencyScore` | ″ |

The four per-entry flags plus the per-sense label list are one type, `EntryApprovalFlags`
(`server/contracts/wire.ts`), resolved together by a single enricher — they describe
the entry as a whole, so one raw-column read plus one `validations` read answers all
four regardless of batch size. `ENTRY_LEVEL_VALIDATION_FIELDS` + `PER_SENSE_VALIDATION_FIELDS` (same file) are the
lists that enricher queries with, joined as `APPROVAL_FIELDS` in `DictionaryDAL`; they
must stay in step with the interface.

`approvedSenseFrequencyLabels` is a **list of sense labels**, not a boolean, because the
granularity is one cluster: 会 hui4 may be reviewed while 会 kuai4 is not. It rides on the
same interface (and the same query) purely because it costs no extra round trip. The
client asks `approvedSenseFrequencyLabels.includes(cluster.sense)` — done for it by
`resolveCommonality`, which never lets an entry-level approval vouch for a per-sense score
or vice versa.

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
- **The four `EntryApprovalFlags`** (`DictionaryDAL.enrichFieldApprovalsBatch`, helper
  `fetchApprovedEntryFieldContents`): one query fetches every approving `validations`
  row for the batch across all four entry-level fields, bucketed **per field** (so a
  `definitions` approval can never satisfy a `partsOfSpeech` comparison); a second
  fetches the entry's **raw** det columns (fresh, not the caller's already-transformed
  `longDefinition` display string). Each flag then rebuilds its own formatter's body
  from those raw columns and looks it up in that field's bucket. `definitionsApproved`
  is still compared as one unit across two columns — regenerating either invalidates
  it — while the other three each hinge on one column, so POS/difficulty/commonality
  churn no longer clears each other (or the definitions review). A field's bucket is a
  Set because different validators may have approved different revisions; any one
  matching today's data counts. `senseFrequencyScore` shares ONE bucket across an entry's
  senses — its label is inside the body text
  (`Commonality (<sense>): N/5`), so the byte-for-byte compare already tells them apart,
  and a re-clustering that renames, merges, or re-scores a sense correctly drops that
  cluster out of the approved list instead of transferring the approval to a different
  meaning. Independent of
  `enrichExampleSentencesMetadataBatch` (no `exampleSentences` precondition); callers
  chain it alongside `enrichLongDefinitionMetadataBatch`
  (`VocabEntryService`, `OnDeckVocabService`, `DictionaryController`, via
  `DictionaryService.enrichFieldApprovalsBatch`). Declared as top-level fields on
  `DictionaryEntry`/`VocabEntry` in `server/types/index.ts` and `src/types.ts` (and
  threaded through `dictEntryAdapter.ts` for the flp det-fallback path).
- Both comparisons run the current body through `sanitizeDocumentContent`
  (idempotent — strips control chars, normalizes line endings) to match how the
  approved content was stored.

**Client** — the shared **AI-generated treatment** lives in
`src/theme/aiGeneratedStyling.ts` (`aiGeneratedSurfaceSx`: orange
`COLORS.aiGenerated` border + ~8% tint) and `src/components/AiGeneratedBadge.tsx`
(sparkle + label badge) — the same treatment as the dictionary AI-fallback card
(`AiDictionaryEntryCard`, docs/DICTIONARY_AI_FALLBACK_SEARCH.md). The same file also
holds the **est-style AI card** (`aiGeneratedCardSx(face)` + `aiGeneratedTagPositionSx`):
the host palette's card fill in a 1px orange inset ring, 14px radius, no tint, with
`AiGeneratedBadge` `variant="tag"` hanging off the bottom-right edge. Consumers:
- `ExampleSentenceList.tsx` (the single est UI component) renders any sentence with
  falsy `humanApproved` as the AI card; approved sentences get a 1.5px `line` ring.
- `LongDefinitionDisplay.tsx` takes an `aiGenerated` prop; when true (i.e. the
  caller passes `!entry.definitionsApproved`) it wraps the rendered long definition.
  With the `aiCard` prop (`{ face, ink }` — the eip Definition tab passes
  `useEipColors().card/.ink`) it draws the AI card; without it (CompareWorkspace) the
  tinted surface + inline badge.
- `DefinitionFacts.tsx`'s grouped all-unapproved block draws the AI card (below).
- The **three meta-strip chips** in `VocabCardDetailBody.tsx` and
  `InfoCardPanelBody.tsx` each get **only** `aiGeneratedSurfaceSx` (border/tint, no
  badge) when their OWN flag is falsy — a lighter mark since a chip is a small,
  glanceable value rather than a block of prose. Before migration 132 only the POS
  chip was ever clearable (off `definitionsApproved`) and the other two were
  permanently AI-marked, having no validation field at all.

  | Chip label | Value | Field | Flag |
  |---|---|---|---|
  | **Difficulty** | six-triangle `DifficultyMeter` (every language) | `difficulty` | `difficultyApproved` |
  | **Parts of Speech** | `partsOfSpeech.join(', ')` | `partsOfSpeech` | `partsOfSpeechApproved` |
  | **Commonality** | five-circle `CommonalityMeter`, no number | `frequencyScore` | `frequencyScoreApproved` |

  The labels were previously "HSK"/"Level", "Type" and "Commonality". Since
  2026-11-07 no value names HSK either: both measures are glyph meters
  (`src/components/ScoreMeters.tsx`), because `difficulty` is an AI estimate rather
  than an HSK-list lookup.

  **Strip layout (both twins).** The strip is a two-row column, not one flex line:
  row 1 (`*-definition-meta-row`) holds **Difficulty + Commonality**, centered; row 2
  holds **Parts of Speech** alone at `width: 100%` with centered text, because the
  comma-joined POS list is the longest of the three values. Row 1 is skipped entirely
  when neither of its chips has data, so its column gap never opens above a lone POS
  row.

> **Placement rule: the buttons never change layout.** Every inline
> `ValidateFlagButtons` mount — est cards, the long-definition block, the three meta
> chips — is absolutely positioned OUT OF FLOW in its element's top-right corner,
> with no surface or background of its own. A validator must see the same layout as
> everyone else; a control that only some accounts render must not be allowed to
> widen, heighten, or reflow the element it annotates, or displace any of its text.
> When adding a new mount point, position it, don't inline it.

All three surfaces (eip Definition tab, cdp) inherit this automatically since
`VocabCardDetailBody`/`InfoCardPanelBody` are the shared components behind both
card-detail pages.

> **The twin strips are gone (2026-08-24).** The cdp's and the eip's meta strips were
> hand-maintained twins — ~90 lines each, identical down to the comments — held together
> only by the shared caption component. They are now ONE component,
> **`src/features/flashcards/DefinitionFacts.tsx`** (the design's `.dfx`), rendered by
> both. Every field keeps its own `MetaChipLabel`, its own approval flag and its own
> validator pair; what was deduplicated is the layout around them.
>
> **One provenance rule changed with it.** Previously each unapproved field drew its own
> orange box, so a fully-unapproved definition tab showed four of them stacked. Now:
>
> - **every** provenance-bearing value present in the block unapproved (the paragraph
>   included, when the host hands it in) → **ONE** grouped AI block: one ring, one
>   badge — the est-style AI card (`aiGeneratedCardSx` + the hanging tag) since
>   2026-11-07; it was a tinted box with an inline badge before. That is artboard 20b.
> - **any** value human-approved → back to the per-field boxes, so the approved one is
>   visibly NOT flagged.
>
> The second half is the load-bearing one. Losing the approved/unapproved distinction is
> the only thing the grouped treatment must never do, which is why the choice is a RULE
> computed from the flags rather than a prop a caller can get wrong. Because grouping is
> decided inside the component, the paragraph is passed as a render function receiving
> `{ grouped }` — a paragraph that draws its own AI border has to stand it down when it
> is about to be wrapped in one, or the panel shows two badges for one claim.

---

## Content sanitization

`server/utils/sanitizeContent.ts` → `sanitizeDocumentContent(text)`: strips control
chars (keeps `\n`/`\t`) and normalizes line endings. It deliberately does **not**
HTML-escape — the content is only rendered as React text nodes (escaped at render),
so escaping at rest would double-encode (e.g. `&` → `&amp;` shown literally). Wired
into `TextService.createText`/`updateText` (all Reader document saves), and mirrored
by `DictionaryDAL`'s approval-freshness comparisons (see `sanitizeContent.ts`).

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
| Definitions bundle | `['definitions']` | zh: `backfill-process-definitions-array`, `backfill-long-definitions`, `backfill-longdef-citations`, `backfill-split-semicolon-definitions`, `backfill-expand-abbreviations`<br>es: `backfill-process-definitions-array`, `backfill-long-definitions`, `backfill-split-semicolon-definitions`, `backfill-expand-abbreviations` |
| Example sentences | `['exampleSentence0','exampleSentence1','exampleSentence2']` | `backfill-example-sentences` (both languages) |
| Parts of speech | `['partsOfSpeech']` | zh: `backfill-parts-of-speech` (es has no POS step — POS is a by-product of clustering since migration 123) |
| Difficulty | `['difficulty']` | zh: `backfill-hsk-level` |
| Commonality + difficulty | `['frequencyScore','difficulty']` | zh: `backfill-frequency-score` guards on `['frequencyScore']` alone; **es**: `backfill-frequency-score` writes BOTH columns in one pass, so a review of either chip protects the row |
| Per-sense commonality | `['senseFrequencyScore']` | `backfill-cluster-definitions` (both languages) — the clusterer rewrites `definitionClusters` wholesale, so ONE reviewed sense protects the whole row. es additionally guards on `['definitions']`, since re-clustering re-presents them |

The manifest in `server/scripts/backfill/shared/lib/requiredScripts.js` mirrors these
per-script `validationFields`, so the lazy-enrichment worker skips (and does not wait
for) a step whose field a validator has already reviewed. Its exported
`VALIDATION_FIELDS` is derived from the manifest, so it picks up new fields for free.

The two deterministic cleanups (`split-semicolon-definitions`, `expand-abbreviations`)
are the ones that most need the guard: unlike the AI steps they scan their det table
**table-wide** with no `discoverable` filter, so without it a routine re-run would
clobber human-reviewed text anywhere in the dictionary.

There is no longer a Spanish `backfill-parts-of-speech.js`. It was deleted by
migration 123 — before that it materialized one det row per POS, so it needed a
word-level guard (`validatedWordFilter`, a `JOIN validations`) to skip a `word1` if
**any** of its rows carried a `definitions` validation. Spanish is now one row per
`word1`, and its replacement `backfill-cluster-definitions.js` writes
`definitionClusters` + `partsOfSpeech`. That used to be outside the validation model
entirely; **migration 139 brought it in** — a cluster's own `frequencyScore` is now the
`senseFrequencyScore` field — so both clusterers took the guard, and a row with any
reviewed sense is skipped rather than re-clustered.

> **A per-sense approval is coarse in one direction on purpose.** `definitionClusters`
> is one jsonb column rewritten as a unit, so the guard can only work at row
> granularity: approving ONE sense's commonality freezes the whole word's clustering.
> That is the safe direction (nothing reviewed is ever silently rewritten), but it means
> a validator approving one sense also parks re-clustering for that word. If that becomes
> a real cost, the fix is a merge-on-write clusterer that preserves reviewed clusters —
> not a weaker guard.

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
scope), so a re-run rewrote `definitions` in place on reviewed rows. On PPE the
guard currently excludes 5 zh rows carrying a `definitions` flag. Their
`SCRIPT_VERSION` was deliberately **not** bumped: the change narrows row selection
rather than altering the transformation, and a bump would mark the whole table
stale and trigger a mass re-process.

Under `/oracle-backfill` (which loops the pipeline directly against PPE with no
dev-side review gate) this guard is the only thing standing between a
regeneration loop and a validator's work — treat it as load-bearing.

---

## Key files

- Migrations: `database/migrations/104-add-validation-system.sql`,
  `database/migrations/106-simplify-validator-content.sql`,
  `database/migrations/120-drop-validations-validator-fk.sql`,
  `database/migrations/132-split-parts-of-speech-validation-field.sql`,
  `database/migrations/139-add-sense-label-to-validations.sql`,
  `database/migrations/183-drop-texts-description-and-validation-docs.sql` (queue removal)
- Service/controller/routes: `server/services/ValidationService.ts`,
  `server/controllers/ValidationController.ts`, `server/routes/validationRoutes.ts`
  (mounted in `server/server.ts`; wired in `server/dal/setup.ts`)
- Shared body formatters: `server/utils/validationBodyFormat.ts`
  (`composeDefinitionsBody`, `composeExampleSentenceBody`, `composePartsOfSpeechBody`,
  `composeDifficultyBody`, `composeFrequencyScoreBody`, `composeSenseFrequencyScoreBody`)
- Sanitizer: `server/utils/sanitizeContent.ts`
- Sense-aware resolver (which score the Commonality chip shows, and therefore which
  field/label it validates): `resolveCommonality` in `src/utils/definitionUtils.ts`,
  covered by `src/__tests__/resolveCommonality.test.ts`
- Types: `server/contracts/wire.ts` (`ValidationField`, `ENTRY_LEVEL_VALIDATION_FIELDS`,
  `PER_SENSE_VALIDATION_FIELDS`/`isPerSenseValidationField`,
  `EntryApprovalFlags`/`NO_APPROVALS`), re-exported by `server/types/index.ts`
  (which also declares `ValidationRecord`, `User.isValidator`)
  and by `src/types.ts` (`ValidationField`, `User.isValidator`), `src/AuthContext.tsx`
- Inline Approve/Flag UI: `src/components/ValidateFlagButtonsView.tsx` (shared
  presentation) + `src/components/ValidateFlagButtons.tsx` (det-field wrapper),
  `src/api/http.ts` (`apiPost`/`apiDelete`/`apiGet`), wired from `src/features/flashcards/ExampleSentenceList.tsx`
  and `src/components/LongDefinitionDisplay.tsx` (via `src/features/flashcards/VocabCardDetailBody.tsx` +
  `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx`), and
  `src/features/flashcards/MetaChipLabel.tsx` (one chip's caption + its validator pair;
  passes `senseLabel` for a per-sense Commonality chip), hosted by
  `src/features/flashcards/DefinitionFacts.tsx` (the `.dfx` block both card-detail
  surfaces render)
- Backfill guard: `server/scripts/backfill/run-log.js` (`validatedClause`)
- Read-path surfacing: `server/dal/implementations/DictionaryDAL.ts`
  (`fetchApprovedSentenceContents`/`isSentenceHumanApproved` for `humanApproved`;
  `enrichFieldApprovalsBatch`/`fetchApprovedEntryFieldContents` for the four
  `EntryApprovalFlags` booleans + `approvedSenseFrequencyLabels`), `src/features/flashcards/ExampleSentenceList.tsx`,
  `src/components/LongDefinitionDisplay.tsx`, `src/features/flashcards/VocabCardDetailBody.tsx`,
  `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx`,
  `src/theme/aiGeneratedStyling.ts` + `src/components/AiGeneratedBadge.tsx` (shared
  with `AiDictionaryEntryCard.tsx`)
