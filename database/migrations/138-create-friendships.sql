-- Migration 138: Create the `friendships` table — the friend graph.
--
-- See docs/FRIENDS_FEATURE.md.
--
-- ONE TABLE, NOT TWO. A friendship IS an accepted request: the same row is
-- created as 'pending' by the requester and flipped to 'accepted' by the
-- addressee. A separate friend_requests table would mean copying a row between
-- tables on accept and keeping two sources of truth for "are these two friends",
-- which is exactly the kind of drift that produces one-sided friendships.
--
-- DIRECTION IS RECORDED, MEANING IS NOT. (requesterId, addresseeId) is kept
-- because a pending request is inherently directional — only the addressee may
-- accept it, only the requester may revoke it. Once status = 'accepted' the
-- direction carries no meaning: the friendship is symmetric, and every read path
-- matches on `"requesterId" = $1 OR "addresseeId" = $1`.
--
-- NO 'declined' STATUS. Declining DELETES the row (product decision), so the
-- requester is not told they were declined and the pair is free to try again
-- later. The CHECK below therefore admits only two states; adding 'declined' or
-- 'blocked' later is a CHECK change plus a new migration, not a reshape.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS friendships (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who sent the request. CASCADE: deleting an account removes its edges rather
  -- than leaving the other side pointing at a ghost.
  "requesterId"  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Who must accept it.
  "addresseeId"  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         varchar(16) NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'accepted')),
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  -- When the addressee accepted. NULL while pending; doubles as "friends since".
  "respondedAt"  timestamptz,
  -- Self-friending is meaningless and would break the symmetric read query
  -- (the row would match both sides of the OR).
  CONSTRAINT friendships_no_self CHECK ("requesterId" <> "addresseeId")
);

-- AT MOST ONE ROW PER UNORDERED PAIR. Ordering the two ids with LEAST/GREATEST
-- makes the index direction-blind, so A→B and B→A collide at the database level.
-- Without this, two people who request each other simultaneously end up with two
-- rows and each sees a pending request that the other has "already accepted".
-- (The service still handles the crossing-requests case explicitly by
-- auto-accepting; this index is the backstop for the concurrent race.)
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_uniq
  ON friendships (LEAST("requesterId", "addresseeId"), GREATEST("requesterId", "addresseeId"));

-- The three list queries are all "my rows in one status". Two single-column
-- indexes rather than one composite because a row is read from whichever side
-- the viewer is on, and Postgres can use either for the OR.
CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships ("requesterId", status);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships ("addresseeId", status);
