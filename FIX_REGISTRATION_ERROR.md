# Fix Registration Error - Migration Guide

## Problem
The registration endpoint is failing with a 500 error due to a column name mismatch:
- **Database has:** `preferredLanguage` 
- **Code expects:** `selectedLanguage`

## Solution
Run migration 11 to rename the column on the production database.

---

## Steps to Fix on Production Server

### 1. Connect to Production Server
```bash
ssh <your-production-server>
cd ~/vocabulary-app
```

### 2. Verify Current Database State
Check if the column exists with the old name:
```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c "\d Users"
```

You should see `preferredLanguage` in the column list.

### 3. Apply the Migration

**Option A: Using psql directly (Recommended)**
```bash
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/migrations/11-rename-preferredlanguage-to-selectedlanguage.sql
```

**Option B: Using psql interactively**
```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db
```
Then run:
```sql
ALTER TABLE Users RENAME COLUMN "preferredLanguage" TO "selectedLanguage";
COMMENT ON COLUMN Users."selectedLanguage" IS 'User selected study language: zh, ja, ko, or vi';
\q
```

### 4. Verify the Migration
Check that the column was renamed:
```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c "\d Users"
```

You should now see `selectedLanguage` instead of `preferredLanguage`.

### 5. Test Registration
Try creating a new account on https://mren.me/api/auth/register

The registration should now work without the 500 error.

---

## Rollback (if needed)

If you need to rollback this change:
```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c 'ALTER TABLE Users RENAME COLUMN "selectedLanguage" TO "preferredLanguage";'
```

---

## What This Migration Does

1. Renames the `preferredLanguage` column to `selectedLanguage` in the Users table
2. Updates the column comment for clarity
3. Ensures consistency between database schema and backend code expectations

---

## Additional Notes

- **No downtime required:** This is a simple column rename operation
- **Existing data preserved:** All user language preferences will be maintained
- **No code changes needed:** The backend already expects `selectedLanguage`
- **Future-proof:** Migration file 05 has also been updated so new installs use the correct name

---

## Quick Commands Reference

**Check if migration is needed:**
```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('preferredLanguage', 'selectedLanguage');"
```

**Run migration:**
```bash
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/migrations/11-rename-preferredlanguage-to-selectedlanguage.sql
```

**View recent errors:**
```bash
docker logs cow-backend-prod --tail 50 | grep -i "selectedLanguage"
