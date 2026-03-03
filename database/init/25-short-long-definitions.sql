ALTER TABLE dictionaryentries
  ADD COLUMN IF NOT EXISTS "shortDefinition" TEXT,
  ADD COLUMN IF NOT EXISTS "longDefinition" TEXT;
