-- Migration script to update column names from lowercase to camelCase
-- This script will rename columns to match the TypeScript interfaces

-- First, let's check if we need to rename columns in Users table
DO $$
BEGIN
    -- Rename createdAt column in Users table if it exists as createdat
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'createdat') THEN
        ALTER TABLE Users RENAME COLUMN createdat TO "createdAt";
        RAISE NOTICE 'Renamed Users.createdat to createdAt';
    END IF;
END $$;

-- Update VocabEntries table columns
DO $$
BEGIN
    -- Rename userid to userId
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vocabentries' AND column_name = 'userid') THEN
        ALTER TABLE VocabEntries RENAME COLUMN userid TO "userId";
        RAISE NOTICE 'Renamed VocabEntries.userid to userId';
    END IF;
    
    -- Rename entrykey to entryKey
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vocabentries' AND column_name = 'entrykey') THEN
        ALTER TABLE VocabEntries RENAME COLUMN entrykey TO "entryKey";
        RAISE NOTICE 'Renamed VocabEntries.entrykey to entryKey';
    END IF;
    
    -- Rename entryvalue to entryValue
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vocabentries' AND column_name = 'entryvalue') THEN
        ALTER TABLE VocabEntries RENAME COLUMN entryvalue TO "entryValue";
        RAISE NOTICE 'Renamed VocabEntries.entryvalue to entryValue';
    END IF;
    
    -- Rename iscustomtag to isCustomTag
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vocabentries' AND column_name = 'iscustomtag') THEN
        ALTER TABLE VocabEntries RENAME COLUMN iscustomtag TO "isCustomTag";
        RAISE NOTICE 'Renamed VocabEntries.iscustomtag to isCustomTag';
    END IF;
    
    -- Rename hskleveltag to hskLevelTag
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vocabentries' AND column_name = 'hskleveltag') THEN
        ALTER TABLE VocabEntries RENAME COLUMN hskleveltag TO "hskLevelTag";
        RAISE NOTICE 'Renamed VocabEntries.hskleveltag to hskLevelTag';
    END IF;
    
    -- Rename createdat to createdAt
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vocabentries' AND column_name = 'createdat') THEN
        ALTER TABLE VocabEntries RENAME COLUMN createdat TO "createdAt";
        RAISE NOTICE 'Renamed VocabEntries.createdat to createdAt';
    END IF;
END $$;

-- Update OnDeckVocabSets table columns
DO $$
BEGIN
    -- Rename userid to userId
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ondeckvocabsets' AND column_name = 'userid') THEN
        ALTER TABLE OnDeckVocabSets RENAME COLUMN userid TO "userId";
        RAISE NOTICE 'Renamed OnDeckVocabSets.userid to userId';
    END IF;
    
    -- Rename featurename to featureName
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ondeckvocabsets' AND column_name = 'featurename') THEN
        ALTER TABLE OnDeckVocabSets RENAME COLUMN featurename TO "featureName";
        RAISE NOTICE 'Renamed OnDeckVocabSets.featurename to featureName';
    END IF;
    
    -- Rename vocabentryids to vocabEntryIds
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ondeckvocabsets' AND column_name = 'vocabentryids') THEN
        ALTER TABLE OnDeckVocabSets RENAME COLUMN vocabentryids TO "vocabEntryIds";
        RAISE NOTICE 'Renamed OnDeckVocabSets.vocabentryids to vocabEntryIds';
    END IF;
    
    -- Rename updatedat to updatedAt
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ondeckvocabsets' AND column_name = 'updatedat') THEN
        ALTER TABLE OnDeckVocabSets RENAME COLUMN updatedat TO "updatedAt";
        RAISE NOTICE 'Renamed OnDeckVocabSets.updatedat to updatedAt';
    END IF;
END $$;

-- Update indexes to use new column names
DO $$
BEGIN
    -- Drop old indexes if they exist
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_vocabentries_userid') THEN
        DROP INDEX idx_vocabentries_userid;
        RAISE NOTICE 'Dropped old index idx_vocabentries_userid';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_vocabentries_key') THEN
        DROP INDEX idx_vocabentries_key;
        RAISE NOTICE 'Dropped old index idx_vocabentries_key';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_vocabentries_key_trgm') THEN
        DROP INDEX idx_vocabentries_key_trgm;
        RAISE NOTICE 'Dropped old index idx_vocabentries_key_trgm';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_vocabentries_value_trgm') THEN
        DROP INDEX idx_vocabentries_value_trgm;
        RAISE NOTICE 'Dropped old index idx_vocabentries_value_trgm';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ondeckvocabsets_userid') THEN
        DROP INDEX idx_ondeckvocabsets_userid;
        RAISE NOTICE 'Dropped old index idx_ondeckvocabsets_userid';
    END IF;
    
    -- Create new indexes with camelCase column names
    CREATE INDEX idx_vocabentries_userid ON VocabEntries("userId");
    CREATE INDEX idx_vocabentries_key ON VocabEntries("entryKey");
    CREATE INDEX idx_vocabentries_key_trgm ON VocabEntries USING gin ("entryKey" gin_trgm_ops);
    CREATE INDEX idx_vocabentries_value_trgm ON VocabEntries USING gin ("entryValue" gin_trgm_ops);
    CREATE INDEX idx_ondeckvocabsets_userid ON OnDeckVocabSets("userId");
    
    RAISE NOTICE 'Created new indexes with camelCase column names';
END $$;

-- Update foreign key constraints
DO $$
BEGIN
    -- Drop and recreate foreign key constraint for VocabEntries
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name LIKE '%vocabentries%userid%') THEN
        -- Find the constraint name
        DECLARE
            constraint_name_var TEXT;
        BEGIN
            SELECT constraint_name INTO constraint_name_var
            FROM information_schema.table_constraints 
            WHERE table_name = 'vocabentries' AND constraint_type = 'FOREIGN KEY';
            
            IF constraint_name_var IS NOT NULL THEN
                EXECUTE 'ALTER TABLE VocabEntries DROP CONSTRAINT ' || constraint_name_var;
                RAISE NOTICE 'Dropped old foreign key constraint: %', constraint_name_var;
            END IF;
        END;
    END IF;
    
    -- Create new foreign key constraint
    ALTER TABLE VocabEntries ADD CONSTRAINT vocabentries_userid_fkey 
        FOREIGN KEY ("userId") REFERENCES Users(id) ON DELETE CASCADE;
    RAISE NOTICE 'Created new foreign key constraint for VocabEntries.userId';
    
    -- Drop and recreate foreign key constraint for OnDeckVocabSets
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name LIKE '%ondeckvocabsets%userid%') THEN
        DECLARE
            constraint_name_var TEXT;
        BEGIN
            SELECT constraint_name INTO constraint_name_var
            FROM information_schema.table_constraints 
            WHERE table_name = 'ondeckvocabsets' AND constraint_type = 'FOREIGN KEY';
            
            IF constraint_name_var IS NOT NULL THEN
                EXECUTE 'ALTER TABLE OnDeckVocabSets DROP CONSTRAINT ' || constraint_name_var;
                RAISE NOTICE 'Dropped old foreign key constraint: %', constraint_name_var;
            END IF;
        END;
    END IF;
    
    -- Create new foreign key constraint
    ALTER TABLE OnDeckVocabSets ADD CONSTRAINT ondeckvocabsets_userid_fkey 
        FOREIGN KEY ("userId") REFERENCES Users(id) ON DELETE CASCADE;
    RAISE NOTICE 'Created new foreign key constraint for OnDeckVocabSets.userId';
END $$;

-- Update primary key constraint for OnDeckVocabSets
DO $$
BEGIN
    -- Drop old primary key constraint
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'ondeckvocabsets' AND constraint_type = 'PRIMARY KEY') THEN
        ALTER TABLE OnDeckVocabSets DROP CONSTRAINT ondeckvocabsets_pkey;
        RAISE NOTICE 'Dropped old primary key constraint for OnDeckVocabSets';
    END IF;
    
    -- Create new primary key constraint with camelCase column names
    ALTER TABLE OnDeckVocabSets ADD CONSTRAINT ondeckvocabsets_pkey 
        PRIMARY KEY ("userId", "featureName");
    RAISE NOTICE 'Created new primary key constraint for OnDeckVocabSets';
END $$;

RAISE NOTICE 'Migration to camelCase column names completed successfully!';
