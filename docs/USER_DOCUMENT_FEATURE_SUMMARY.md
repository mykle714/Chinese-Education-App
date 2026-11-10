# Reader Documents (user documents)

The Reader (`/reader`, reached from the footer's Menu popover) is a list of the learner's own
documents; opening one (`/reader/:id`) shows it as a tappable reading surface with
an inline content editor. This doc covers the document model, the CRUD API, and the
create/edit/delete flows.

> **Word segmentation & tap navigation**: how the Reader splits an open document
> into tappable dictionary words (client-side gsa) and steps the selection
> through them → [READER_SEGMENTATION.md](./READER_SEGMENTATION.md).
> **Page archetypes** (Node list page + footerless document drill-in, header
> actions, edit toolbar) → [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) § Reader.

## Data model — `texts`

Code: `database/init/01-init-schema.sql` / `database/deploy/01-schema.sql` (texts);
`server/contracts/wire.ts` → `TextBase` (re-exported as `Text` by `server/types/index.ts`
and `src/types.ts`).

| Column | Notes |
|---|---|
| `id` | uuid, `uuid_generate_v4()` |
| `userId` | owner; `ON DELETE CASCADE` |
| `title` | **derived from the content on create** (see below); renamable later |
| `content` | the document body, sanitized on write (`sanitizeDocumentContent`) |
| `language` | `zh` / `es`; set on create, immutable afterwards |
| `characterCount` | `content.length`, recomputed on every content update |
| `isUserCreated` | `true` for every row the API creates |
| `createdAt` | `now()` |

Removed columns: `description` and the validation-doc linkage
(`validationEntryId` / `validationLanguage` / `validationField`) were dropped by
**migration 183** (2026-11-05), along with the Reader validation-document queue that
used them — see [DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md).

## Backend (layers)

| Layer | File | Role |
|---|---|---|
| Route | `server/routes/textRoutes.ts` | registration only |
| Controller | `server/controllers/TextController.ts` | request parsing, status codes |
| Service | `server/services/TextService.ts` | ownership checks, limits, sanitizing, title derivation |
| DAL | `server/dal/implementations/TextDAL.ts` (`ITextDAL`) | the `texts` table: one statement per method |
| Utility | `server/utils/documentTitle.ts` | pure title rule (`deriveDocumentTitle`) |

Title derivation reads det through `IDictionaryDAL.findMultipleByWord1`.

### Endpoints

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/texts` | — | the user's documents in their `selectedLanguage`, newest first (`getUserTexts`) |
| GET | `/api/texts/stats` | — | counts / total characters |
| GET | `/api/texts/:id` | — | one document |
| POST | `/api/texts` | `{ content, language? }` | **no title** — the server derives it |
| PUT | `/api/texts/:id` | `{ title?, content? }` | owner only; `language` is rejected |
| DELETE | `/api/texts/:id` | — | owner only |

### Title derivation

Code: `server/utils/documentTitle.ts` → `deriveDocumentTitle`, `documentTitleSource`;
`server/services/TextService.ts` → `deriveTitle`; tests
`server/__tests__/documentTitle.test.ts`.

On create, the title is **as many whole words of the first non-empty line as fit in
20 characters** (`DOCUMENT_TITLE_MAX_CHARS`, counted in code points). A "word" is a gsa
segment inside a Chinese run (`splitHanRuns` → `segmentWithDict` against det, looked
up only for the substrings of the first 64 characters) and a whitespace-delimited
token elsewhere, so a title never cuts 图书馆 or "library" in half. If the first word
alone is longer than 20 characters it is hard-cut; an empty body gives `Untitled`.
The title is derived **once**: later content edits do not retitle the document.

### Limits

Code: `TextService.validateTextData` / `validateUpdateData` / `createText`.
Title ≤ 200 characters (PUT), content ≤ 50 000. Per account, `createText` caps
user-authored documents at `MAX_DOCUMENTS_PER_USER` (500), counting `isUserCreated`
rows — see [API_ABUSE_HARDENING.md](./API_ABUSE_HARDENING.md) § 1c.

## Frontend

All under `src/features/reader/`.

| File | Role |
|---|---|
| `ReaderPage.tsx` | `/reader` list (Node page); optimistic swipe-delete (`handleDelete`) |
| `TextSidebar.tsx` | the list itself (one title per row) + the **New Document** button |
| `SwipeToDeleteRow.tsx` | iPhone-style swipe-left row that uncovers **Delete** |
| `ReaderDocumentPage.tsx` | `/reader/:id` document page, including the `/reader/new` draft |
| `readerPaths.ts` | `NEW_DOCUMENT_ID` / `NEW_DOCUMENT_PATH` |
| `TextHeader.tsx` | title + vocab-processing status chips |
| `TextArea.tsx` | reading textarea ⇄ editable textarea |
| `ReaderEditToolbar.tsx` + `useReaderContentEditor.ts` | undo/redo/cancel/save for inline edit |
| `DeleteDocumentDialog.tsx` | delete confirmation for the document header's trash icon |

### Creating a document

Code: `TextSidebar.tsx` (New Document) → `ReaderPage.tsx` → `handleCreateNew`;
`ReaderDocumentPage.tsx` → `blankDraft`, `saveNewDraft`, `handleCancelEdit`.

There is no create dialog. **New Document** navigates to `/reader/new`, which
`ReaderDocumentPage` opens as an in-memory blank draft, **already in edit mode**
(the editable textarea focuses itself, raising the keyboard). Nothing exists
server-side yet:

- **Save** is disabled while the draft is blank. The first Save `POST`s
  `{ content, language }`, processes the new document's vocabulary, leaves edit
  mode and `replace`-navigates to `/reader/<new id>`, so Back returns to the list
  rather than to an empty draft. `justCreatedIdRef` stops the fetch effect from
  reloading the document it already holds after the URL change.
- **Cancel** (or the back arrow) on a draft just returns to `/reader`. No server
  record exists, so there is nothing to clean up and no empty documents pile up.

### Editing

Editing happens only inside the open document: the header's Edit toggles the inline
editor (content only). List rows have no Edit. The title is set once, on create
(§ Title derivation), and **there is currently no rename UI** — `PUT /api/texts/:id`
still accepts `title`, but no client sends it.

Neither the list nor the open document shows the character count or the creation
date (removed 2026-11-05); `characterCount` and `createdAt` are still on the wire.

### Deleting a document

Code: `SwipeToDeleteRow.tsx`; `TextSidebar.tsx` → `openRowId`; `ReaderPage.tsx` →
`handleDelete`; `DeleteDocumentDialog.tsx`.

- **List (`/reader`)** — iPhone style. Drag a row left to slide it aside and uncover
  a **Delete** button (80px, `DELETE_BUTTON_WIDTH_PX`) behind its right edge. Releasing
  past half that width leaves the row open; otherwise it springs shut. Only one row is
  open at a time, and tapping an open row closes it rather than opening the document.
  The row uses `touchAction: pan-y` and locks to an axis after 8px, so vertical drags
  still scroll the list. Tapping **Delete** deletes immediately, with no confirmation:
  the row leaves the list at once, and if `DELETE /api/texts/:id` fails it is put back
  and an error alert shows above the list. Only `isUserCreated` rows can be swiped.
- **Open document** — the header's trash icon opens `DeleteDocumentDialog`
  (a confirmation), then returns to the list.

#### Keyboard lift

Code: `ReaderDocumentPage.tsx` → the KEYBOARD LIFT comment, `keyboardLifted`,
`.reader-document-lead`; `src/features/beginnerKeyboard` → `useKeyboardInset`,
`transitionForInset`, `BEGINNER_KEYBOARD_SLIDE_MS`, `BEGINNER_KEYBOARD_EASING`.

While editing with a keyboard up (the handwriting keyboard or the OS keyboard,
whichever `useKeyboardInset` reports), the title block and the vocab card fold away
(a `Collapse`), so the text box rises to sit directly under the edit toolbar, and the
content area adds the keyboard's height to its bottom padding, so the box ends at the
keyboard's top edge. Both use the keyboard's own slide durations and curves: the box
goes up as the keyboard rises and comes back down as it leaves. The trigger is the
inset, not edit mode, so dismissing the keyboard mid-edit brings the header back with
the editor still open. Reduced motion snaps both.
