-- Migration 174: Writing Notebook — notebook_sheets + notebook_cells
--
-- WHY (docs/WRITING_NOTEBOOK.md, schema approved 2026-10-06): the Writing Notebook is an
-- endless practice sheet per word, reached from the Writing Center's games belt. Every
-- cell's ink is kept for the lifetime of the account, and each cell remembers which
-- character of the sheet's word it was recognised as.
--
--   notebook_sheets — one row per word the learner has opened. Drives "reopen the last
--                     word" (lastOpenedAt) and the belt card's total.
--   notebook_cells  — one row per FILLED cell. Erasing a cell back to blank deletes its
--                     row, so "filled" == "row exists". `ink` is the compact v1 encoding
--                     (server/contracts/writingNotebook.ts → encodeNotebookInk): normalised
--                     to a 0..1000 grid, simplified, delta + base-36 text — ~0.4–1 KB per
--                     character instead of ~15–25 KB of raw jsonb.
--
-- Counters are NOT stored: a sheet's counter is derived from "matchedChar" on every read
-- (min over the word's distinct characters of the cells credited to it), so reopening a
-- cell and closing it unchanged can never count twice. "matchedChar" is never sent to the
-- client.
--
-- Sheets are keyed by the word TEXT (det word1), not a det id, so a sheet survives det
-- data deploys and a sheet's identity never depends on dictionary row churn.
--
-- Expand-only: no shipped code reads either table before the code that ships with it.
-- No BEGIN/COMMIT here: migrate.sh wraps each file in its own transaction.

CREATE TABLE IF NOT EXISTS notebook_sheets (
  "userId"        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language        VARCHAR(8)  NOT NULL,
  word            TEXT        NOT NULL,
  "lastOpenedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("userId", language, word)
);

-- "Reopen the last word": newest sheet first per (user, language).
CREATE INDEX IF NOT EXISTS idx_notebook_sheets_last_opened
  ON notebook_sheets ("userId", language, "lastOpenedAt" DESC);

CREATE TABLE IF NOT EXISTS notebook_cells (
  "userId"       UUID        NOT NULL,
  language       VARCHAR(8)  NOT NULL,
  word           TEXT        NOT NULL,
  "cellIndex"    INTEGER     NOT NULL CHECK ("cellIndex" >= 0),
  ink            TEXT        NOT NULL,
  "matchedChar"  TEXT        NULL,
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("userId", language, word, "cellIndex"),
  FOREIGN KEY ("userId", language, word)
    REFERENCES notebook_sheets ("userId", language, word) ON DELETE CASCADE
);
-- The primary key doubles as the page-range index (a page read is a PK range scan) and
-- the next-empty gap search.

COMMENT ON TABLE notebook_sheets IS
  'Writing Notebook sheets: one per (user, language, word) the learner opened. See docs/WRITING_NOTEBOOK.md';
COMMENT ON TABLE notebook_cells IS
  'Writing Notebook filled cells. ink = compact v1 encoding (server/contracts/writingNotebook.ts); matchedChar = the character of the word top-1 recognised, NULL if none. Counters derive from matchedChar. See docs/WRITING_NOTEBOOK.md';
COMMENT ON COLUMN notebook_cells."matchedChar" IS
  'Which character of the sheet word this ink was recognised as (top-1), or NULL. Server-only: never sent to the client.';
