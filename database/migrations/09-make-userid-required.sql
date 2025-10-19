-- Migration 09: Make userId required and assign all system texts to specific user
-- Purpose: Eliminate concept of public/system texts - all texts must have an owner
-- Date: 2025-10-18

DO $$
DECLARE
    target_user_id UUID := '354f37b7-22bf-4cda-a969-1f2536c714a3';
    user_exists BOOLEAN;
    affected_rows INTEGER;
BEGIN
    -- Verify target user exists
    SELECT EXISTS(SELECT 1 FROM users WHERE id = target_user_id) INTO user_exists;
    
    IF NOT user_exists THEN
        RAISE EXCEPTION 'Target user % does not exist. Cannot proceed with migration.', target_user_id;
    END IF;
    
    -- Count texts that will be affected
    SELECT COUNT(*) INTO affected_rows FROM texts WHERE "userId" IS NULL;
    RAISE NOTICE 'Found % texts with NULL userId that will be assigned to user %', affected_rows, target_user_id;
    
    -- Assign all system texts (NULL userId) to the target user
    UPDATE texts 
    SET "userId" = target_user_id,
        "isUserCreated" = true
    WHERE "userId" IS NULL;
    
    RAISE NOTICE 'Successfully assigned % texts to user %', affected_rows, target_user_id;
    
    -- Now that all texts have a userId, make the column NOT NULL
    ALTER TABLE texts 
    ALTER COLUMN "userId" SET NOT NULL;
    
    RAISE NOTICE 'userId column is now required (NOT NULL constraint added)';
    
    -- Update comment to reflect new requirement
    COMMENT ON COLUMN texts."userId" IS 'Foreign key to users table. Required - all texts must have an owner';
END $$;
