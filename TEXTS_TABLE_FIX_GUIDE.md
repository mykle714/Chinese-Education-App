# Texts Table Fix Guide

## Problem Summary

The production environment was experiencing two issues:
1. **500 Error**: API endpoint `/api/texts` was failing with "relation 'texts' does not exist"
2. **Sample Texts Appearing**: Frontend showed 2 hardcoded sample texts instead of the actual error

## Root Causes

1. **Missing Database Table**: The `texts` table was never created in the production database
2. **Problematic Migration File**: The original migration `06-create-texts-table.sql` included 6 sample texts (violating the "no default texts ever" requirement)
3. **Frontend Fallback Logic**: ReaderPage.tsx had a catch block that created sample texts when the API failed

## Solutions Implemented

### 1. Database Validation Tool ✅

Created a comprehensive schema validation tool to check all tables, columns, and indexes.

**Files Created:**
- `database/validate-schema.sql` - SQL script that checks schema
- `database/validate-schema.sh` - Bash wrapper for easy execution

**Usage:**
```bash
cd ~/vocabulary-app
./database/validate-schema.sh
```

This will show you exactly what's missing in your production database.

### 2. Clean Migration (No Sample Data) ✅

Created a new migration file without any sample texts.

**File Created:**
- `database/migrations/06-create-texts-table-clean.sql` - Creates texts table structure only

This migration:
- Creates the `texts` table with all required columns
- Creates necessary indexes
- **Does NOT insert any sample data**

### 3. Frontend Fix ✅

Removed the sample text fallback logic from the frontend.

**File Modified:**
- `src/pages/ReaderPage.tsx` - Removed hardcoded sample texts

**Changes:**
- When API fails, now shows proper error message instead of sample texts
- Empty texts array is returned on error
- Users see "Failed to load texts. Please try again later."

### 4. Migration Runner Script ✅

Created an automated script to safely run all required migrations.

**File Created:**
- `database/run-texts-migrations.sh` - Runs migrations in correct order

## How to Fix Production

### Step 1: Validate Current Schema (Optional but Recommended)

On your production server:
```bash
cd ~/vocabulary-app
./database/validate-schema.sh
```

This will show you exactly what's missing.

### Step 2: Run the Texts Table Migrations

On your production server:
```bash
cd ~/vocabulary-app
./database/run-texts-migrations.sh
```

This script will:
1. Create the texts table (clean, no sample data)
2. Add userId and isUserCreated columns
3. Verify the table structure
4. Give you next steps

### Step 3: Restart Backend

After migrations complete:
```bash
cd ~/vocabulary-app
docker-compose -f docker-compose.prod.yml restart backend
```

### Step 4: Deploy Frontend Changes

The frontend changes need to be deployed to production. You have two options:

**Option A: Rebuild frontend container**
```bash
cd ~/vocabulary-app
git pull origin main
docker-compose -f docker-compose.prod.yml build frontend
docker-compose -f docker-compose.prod.yml up -d frontend
```

**Option B: Full rebuild (if needed)**
```bash
cd ~/vocabulary-app
git pull origin main
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d --build
```

### Step 5: Verify the Fix

1. Check backend logs:
   ```bash
   docker logs cow-backend-prod --tail 50
   ```

2. Test the API endpoint:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:5000/api/texts
   ```

3. Check the UI:
   - Navigate to the Reader page
   - Should show empty state (no sample texts)
   - Should be able to create new documents
   - No default texts should appear

## What Was Changed

### Backend
- No backend code changes needed
- Only database migration required

### Database
- **New table**: `texts` with proper structure
- **No sample data**: Table starts empty
- **User-specific columns**: `userId` and `isUserCreated` for document ownership

### Frontend
- **Removed**: Sample text fallback in catch block
- **Added**: Proper error message display
- **Result**: Users see empty state or real error, never sample texts

## Files Created/Modified

### New Files
1. `database/validate-schema.sql` - Schema validation SQL script
2. `database/validate-schema.sh` - Validation wrapper script
3. `database/migrations/06-create-texts-table-clean.sql` - Clean migration without samples
4. `database/run-texts-migrations.sh` - Migration runner script
5. `TEXTS_TABLE_FIX_GUIDE.md` - This documentation

### Modified Files
1. `src/pages/ReaderPage.tsx` - Removed sample text fallback

## Verification Checklist

After implementing the fix, verify:

- [ ] texts table exists in production database
- [ ] texts table has all required columns (id, title, description, content, language, characterCount, createdAt, userId, isUserCreated)
- [ ] texts table has proper indexes
- [ ] texts table is empty (no sample data)
- [ ] API endpoint `/api/texts` returns empty array `[]` instead of 500 error
- [ ] Frontend shows empty state with "Create New Document" option
- [ ] Frontend never shows sample texts
- [ ] New documents can be created successfully
- [ ] Backend logs show no errors

## Troubleshooting

### If migrations fail:

1. **Check if table already exists:**
   ```bash
   docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "\dt"
   ```

2. **Check detailed error:**
   ```bash
   docker logs cow-postgres-prod --tail 50
   ```

3. **Manual migration (if needed):**
   ```bash
   # Run SQL files manually
   docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/migrations/06-create-texts-table-clean.sql
   docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/migrations/08-add-userid-to-texts.sql
   ```

### If API still returns 500:

1. Check backend logs for specific error
2. Verify table structure matches expected schema
3. Restart backend container
4. Check database connection

### If sample texts still appear:

1. Clear browser cache
2. Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
3. Verify frontend container was rebuilt with latest code

## Prevention

To prevent this issue in the future:

1. **Always run schema validation** before deploying to production
2. **Use the validation script** regularly to catch missing migrations
3. **Never include sample data** in migration files
4. **Test migrations in dev environment** before running in production
5. **Keep dev and prod schemas in sync** using migration files

## Related Files

- Original migration with samples: `database/migrations/06-create-texts-table.sql` (DO NOT USE)
- Clean migration: `database/migrations/06-create-texts-table-clean.sql` (USE THIS)
- User columns migration: `database/migrations/08-add-userid-to-texts.sql`
- Sample texts data file: `data/sample-texts.json` (for reference only)

## Notes

- The texts table is intentionally empty after migration
- Users must create their own documents from the UI
- No default or sample texts will ever appear
- Old migration with sample data should not be used
