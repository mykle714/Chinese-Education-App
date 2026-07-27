-- Migration 129: account-level "show spaces between words" display preference.
--
-- Word spacing in segmented sentences (est) used to be a device-local flp toggle
-- stored in localStorage under 'flashcard.learn-settings'. That made the eip and
-- the cdp disagree (the cdp never threaded the value, so it always rendered
-- un-spaced) and the choice did not follow the user across devices. It now lives
-- on the account, alongside the readingGoal/writingGoal flags (migration 101).
--
-- See docs/EXAMPLE_SENTENCES.md ("Word spacing is an account setting").

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "showSegmentSpaces" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users."showSegmentSpaces" IS
  'Render a real gap between word segments in segmented sentences (est, on both the eip Examples tab and the cdp). Account-level display preference, migration 129. See docs/EXAMPLE_SENTENCES.md';
