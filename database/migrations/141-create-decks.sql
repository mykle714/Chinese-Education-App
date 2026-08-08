-- Migration 141: Create `decks` and `deck_cards` — user-authored card sets.
--
-- See docs/DECKS_FEATURE.md.
--
-- A DECK IS JUST A NAMED SET OF THE USER'S OWN CARDS. It carries no study state,
-- no scheduling and no mastery of its own: every one of those lives on the vet row
-- the deck points at. That is deliberate — a card in three decks must have ONE
-- mark history, not three. Consequently a deck can be created, renamed and deleted
-- freely without touching a learner's progress.
--
-- PER-LANGUAGE, like everything else that touches user vocabulary. `language` is
-- stored on the DECK, not on the membership row: user vocab is physically split
-- into `vocabentries_zh` / `vocabentries_es`, every game runs in exactly one
-- language, and a deck that could mix the two would force every read to union both
-- tables and every launch surface to re-filter. The deck's language therefore also
-- tells the read path WHICH vet table to join (see vetTableForLanguage()).
--
-- ⚠️ NO FOREIGN KEY ON `deck_cards."vocabEntryId"` — AND IT IS NOT AN OVERSIGHT.
-- The vet is two physical tables sharing one id sequence, so there is no single
-- table to reference. Postgres cannot express "references exactly one of these
-- two". The integrity that an FK would have given us is supplied instead by:
--   * ON DELETE CASCADE from `decks`, which covers deck deletion; and
--   * an explicit `DELETE FROM deck_cards` inside the vet row-delete path
--     (VocabEntryDAL.deleteEntry), which covers card deletion.
-- If the vet is ever unified into one table, add the FK here and delete that
-- explicit cleanup.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS decks (
  id           SERIAL PRIMARY KEY,
  -- CASCADE: deleting an account takes its decks with it, rather than leaving
  -- orphan sets pointing at vocab rows that are themselves being removed.
  "userId"     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'zh' | 'es'. Not constrained by CHECK: the app's language set grows (see
  -- docs/ADDING_NEW_LANGUAGE_GUIDE.md) and a CHECK here would need a migration
  -- for each addition, while the write path already validates against the
  -- supported-language list.
  language     varchar(8)  NOT NULL,
  name         varchar(64) NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now(),
  -- Empty / whitespace-only names would render as an unlabelled, untappable-looking
  -- row in the deck list. Rejected at the database as well as in the service.
  CONSTRAINT decks_name_not_blank CHECK (btrim(name) <> '')
);

-- One deck per name per (user, language). Two decks called "Food" in the same
-- language are indistinguishable in the picker and in the deck list, so the
-- checkbox menu could not tell the user which one they had ticked. The same name
-- in DIFFERENT languages is fine and expected ("Food" for zh and for es).
CREATE UNIQUE INDEX IF NOT EXISTS decks_user_language_name_uniq
  ON decks ("userId", language, lower(btrim(name)));

-- The deck list is always "my decks in my current language, newest first".
CREATE INDEX IF NOT EXISTS decks_user_language_idx ON decks ("userId", language);

CREATE TABLE IF NOT EXISTS deck_cards (
  "deckId"       integer     NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  -- A `vocabentries_zh` / `vocabentries_es` id. See the no-FK note above.
  "vocabEntryId" integer     NOT NULL,
  "addedAt"      timestamptz NOT NULL DEFAULT now(),
  -- Composite PK, not a surrogate id: membership is a set, so "this card is in
  -- this deck" must be unrecordable twice. It also serves the primary read
  -- ("give me deck N's cards") without a second index.
  PRIMARY KEY ("deckId", "vocabEntryId")
);

-- The reverse read: "which decks contain this card", which drives the checkbox
-- state of the Add-to-deck menu on the cdp and the eip.
CREATE INDEX IF NOT EXISTS deck_cards_vocab_entry_idx ON deck_cards ("vocabEntryId");
