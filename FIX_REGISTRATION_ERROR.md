# Fix Registration Error - Migration Guide

## Problem
The registration endpoint is failing with a 500 error because the production database is missing the `selectedLanguage` column that the backend code expects.

**Error:** `column "selectedLanguage" does not exist`

**Root Cause:** Migration 05 (which adds multi-language support) was never applied to the production database. The Users table only has the original columns from the initial schema.

## Solution
Run migration 11 to add the missing `selectedLanguage` column to the production database.

---

## Steps to Fix on Production Server

### 1. Verify Current Database State (Already Done)
The Users table in production currently has:
- id
- email
- name
- password
- createdAt

But is **missing** the `selectedLanguage` column.

### 2. Apply the Migration

Run this command on your production server:

```bash
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/migrations/11-rename-preferredlanguage-to-selectedlanguage.sql
```

This will add the `selectedLanguage` column with a default value of 'zh' (Chinese).

### 3. Verify the Migration

Check that the column was added:
```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c "\d Users"
```

You should now see `selectedLanguage` in the column list:
```
Column          | Type                        
----------------+-----------------------------
id              | uuid                        
email           | character varying(255)      
name            | character varying(100)      
password        | character varying(255)      
createdAt       | timestamp without time zone
selectedLanguage| character varying(10)        <-- NEW COLUMN
```

### 4. Test Registration
Try creating a new account at your registration endpoint. The registration should now work without the 500 error.

---

## What This Migration Does

1. Adds the `selectedLanguage` column to the Users table
2. Sets default value to 'zh' (Chinese) for all existing and new users
3. Adds a comment describing the column's purpose

---

## Expected Results

- **Existing users:** Will have `selectedLanguage` set to 'zh' (Chinese) by default
- **New registrations:** Will work successfully, with users getting 'zh' as default language
- **Language selection:** Users can update their language preference through the settings

---

## Additional Notes

- **No downtime required:** This is a simple column addition
- **Existing data preserved:** All user data remains intact
- **No backend restart needed:** The backend already expects this column
- **Safe operation:** Uses `IF NOT EXISTS` to prevent errors if column already exists

---

## Why This Happened

The production database schema appears to be from an earlier version, before multi-language support was added. Migration 05 (which should have added this column as `preferredLanguage` and later been renamed) was never applied to production.

This migration adds the column directly with the correct name (`selectedLanguage`) that the backend code expects.

---

## Quick Commands Reference

**Check current table structure:**
```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c "\d Users"
```

**Run migration:**
```bash
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/migrations/11-rename-preferredlanguage-to-selectedlanguage.sql
```

**Verify column was added:**
```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'selectedLanguage';"
```

**View recent backend errors (should be gone after fix):**
```bash
docker logs cow-backend-prod --tail 50 | grep -i "selectedLanguage"
```

**Test backend health:**
```bash
curl -X POST https://mren.me/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","name":"Test User","password":"testpass123"}'
