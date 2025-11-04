# Fix Registration and Leaderboard Errors - Migration Guide

## Problems Identified

The production database is missing several columns and tables that the backend expects:

1. ✅ **FIXED:** `selectedLanguage` column (causing registration errors)
2. ❌ **PENDING:** `totalWorkPoints` column (causing leaderboard errors)
3. ❌ **PENDING:** `isPublic` column (for leaderboard privacy)
4. ❌ **PENDING:** `UserWorkPoints` table (for daily points tracking)

**Root Cause:** Multiple migrations were never applied to the production database. The database schema is from an earlier version.

## Current Database State

After applying migration 11, the Users table currently has:
- ✅ id
- ✅ email
- ✅ name
- ✅ password
- ✅ createdAt
- ✅ selectedLanguage (ADDED by migration 11)
- ❌ isPublic (MISSING)
- ❌ totalWorkPoints (MISSING)

Plus the entire `UserWorkPoints` table is missing.

---

## Solution: Apply Migration 12

Migration 12 will add all remaining missing columns and tables.

### What Migration 12 Does

1. Creates `UserWorkPoints` table for daily work points tracking
2. Adds `isPublic` column to Users (for leaderboard privacy control)
3. Adds `totalWorkPoints` column to Users (for lifetime points accumulation)
4. Creates all necessary indexes and triggers

---

## Steps to Complete the Fix on Production Server

### 1. Apply Migration 12

Run this command on your production server:

```bash
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/migrations/12-add-missing-columns-and-tables.sql
```

### 2. Verify All Changes

Check the updated Users table structure:

```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c "\d Users"
```

You should now see:
```
Column          | Type                        
----------------+-----------------------------
id              | uuid                        
email           | character varying(255)      
name            | character varying(100)      
password        | character varying(255)      
createdAt       | timestamp without time zone
selectedLanguage| character varying(10)        ✅ (from migration 11)
isPublic        | boolean                      ✅ (from migration 12)
totalWorkPoints | integer                      ✅ (from migration 12)
```

Check that UserWorkPoints table was created:

```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c "\d UserWorkPoints"
```

### 3. Verify All Tables

List all tables to confirm everything is in place:

```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c "\dt"
```

You should see:
- users
- vocabentries
- ondeckvocabsets
- dictionaryentries
- texts
- userworkpoints ✅ (NEW)

### 4. Test the Application

**Test Registration (should work now):**
```bash
curl -X POST https://mren.me/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@test.com","name":"New User","password":"testpass123"}'
```

**Test Leaderboard (should work now):**
```bash
curl https://mren.me/api/leaderboard
```

### 5. Monitor the Logs

Check that errors are gone:
```bash
docker logs cow-backend-prod --tail 50
```

You should no longer see:
- "column 'selectedLanguage' does not exist" ✅ Fixed
- "column 'totalWorkPoints' does not exist" ✅ Should be fixed
- "column 'isPublic' does not exist" ✅ Should be fixed

---

## What Each Migration Does

### Migration 11 (Already Applied) ✅
- Adds `selectedLanguage` column with default 'zh'
- Fixes registration errors

### Migration 12 (To Apply) ⏳
- Creates `UserWorkPoints` table for tracking daily points
- Adds `isPublic` column (default true for new users)
- Adds `totalWorkPoints` column (default 0)
- Creates necessary indexes and triggers
- Fixes leaderboard errors

---

## Expected Results After Both Migrations

### For Existing Users:
- `selectedLanguage`: 'zh' (Chinese)
- `isPublic`: true (visible on leaderboard)
- `totalWorkPoints`: 0 (will accumulate as they study)

### For New Users:
- All columns will work properly from registration
- Can immediately use all features including leaderboard

### Application Features:
- ✅ Registration works
- ✅ Login works
- ✅ Leaderboard works
- ✅ Work points tracking works
- ✅ Privacy controls work

---

## Migration Safety

Both migrations use:
- `IF NOT EXISTS` clauses - safe to run multiple times
- `DEFAULT` values - no data loss
- Proper indexes - maintains performance
- No destructive operations - only additions

---

## Quick Commands Reference

**Apply pending migration:**
```bash
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/migrations/12-add-missing-columns-and-tables.sql
```

**Check Users table:**
```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c "\d Users"
```

**Check UserWorkPoints table:**
```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c "\d UserWorkPoints"
```

**List all tables:**
```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c "\dt"
```

**Check for specific columns:**
```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position;"
```

**View backend logs:**
```bash
docker logs cow-backend-prod --tail 50
```

**Test registration:**
```bash
curl -X POST https://mren.me/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","name":"Test User","password":"test123"}'
```

**Test leaderboard:**
```bash
curl https://mren.me/api/leaderboard
```

---

## Why This Happened

The production database schema is from an earlier version before several key features were added:
- Multi-language support (migration 05)
- Work points system (server migrations)
- Privacy controls (migration 07)

These migrations were applied to development but never to production, causing the mismatch between database schema and backend expectations.

---

## Summary Checklist

- [x] Migration 11 applied - Added selectedLanguage column
- [ ] Migration 12 to apply - Add remaining columns and UserWorkPoints table
- [ ] Verify Users table has all columns
- [ ] Verify UserWorkPoints table exists
- [ ] Test registration endpoint
- [ ] Test leaderboard endpoint
- [ ] Confirm no errors in logs
