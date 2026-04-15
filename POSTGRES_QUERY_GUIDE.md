# PostgreSQL Query Guide

## Overview
This document outlines common issues when querying PostgreSQL in the Chinese Education App and provides best practices for successful queries.

## Quickest Way to Run a Query

The fastest, most reliable method is `docker exec` — no script files, no module issues, no env setup:

```bash
# Local database
docker exec cow-postgres-local psql -U cow_user -d cow_db -c "SELECT id, email FROM users;"

# Production database
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT id, email FROM users;"
```

Use this by default for ad-hoc queries. Only write a `.ts` script (see below) when you need complex logic or data transformation.

## Writing a TypeScript Query Script

When a script is needed, it **must live in the `server/` directory** (for module resolution). The project uses `"type": "module"`, so `ts-node -e` inline eval does **not** work — write a file:

```typescript
// server/my-query-tmp.ts
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.docker' });  // use .env.docker, there is no plain .env

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'cow_db',
  user: process.env.DB_USER || 'cow_user',
  password: process.env.DB_PASSWORD || 'cow_password_local',
});

const result = await pool.query('SELECT id, email FROM users');
console.log(result.rows);
await pool.end();
```

Run it from the `server/` directory:

```bash
cd server
npx ts-node --esm my-query-tmp.ts
```

## Importing `db.ts`

`db.ts` exports a `DbConnection` object, **not** a Pool directly. Use `db.pool` to access the Pool:

```typescript
import db from './db.js';                // ✅ correct import path
const result = await db.pool.query(...); // ✅ use db.pool, not db directly
```

## Common Issues Encountered

### 1. **Column Name Case Sensitivity (camelCase columns)**
**Problem**: The `users` table and others use camelCase column names (e.g., `createdAt`, not `created_at`). PostgreSQL requires double-quotes around mixed-case identifiers.

**Error Message**:
```
ERROR:  column "created_at" does not exist
HINT:  Perhaps you meant to reference the column "users.createdAt".
```

**Solution**: Quote camelCase column names with double quotes:

```sql
-- ❌ Wrong - snake_case doesn't exist
SELECT created_at FROM users;

-- ✅ Correct - quote the camelCase column
SELECT "createdAt" FROM users;
```

**Affected columns**: `createdAt`, `updatedAt`, and any other camelCase columns created by the ORM/migrations.

---

### 2. **Table Name Case Sensitivity**
**Problem**: Querying tables with incorrect casing (e.g., `"DictionaryEntries"` instead of `dictionaryentries`)

**Error Message**:
```
relation "DictionaryEntries" does not exist
```

**Root Cause**: PostgreSQL automatically converts unquoted identifiers to lowercase. When a table is created without quotes (like `CREATE TABLE dictionaryentries`), it is stored as lowercase. Querying with quotes and wrong casing fails.

**Solution**:
- Always check the actual table name using the check-tables query below
- Use lowercase table names without quotes: `FROM dictionaryentries`
- If you need mixed-case names, create tables with quotes and always quote them in queries
- Better: Just use lowercase consistently

**Example**:
```sql
-- ❌ Wrong - will fail
SELECT * FROM "DictionaryEntries" WHERE ...

-- ✅ Correct - use lowercase
SELECT * FROM dictionaryentries WHERE ...
```

### 3. **Missing Dependencies**
**Problem**: Node.js modules not installed in the working directory

**Error Message**:
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pg' imported from ...
```

**Root Cause**: The script tries to import packages that haven't been installed. While `pg` is in the server directory's `node_modules`, it's not globally available.

**Solution**:
- Run `npm install` in the `server` directory before executing scripts
- Place query scripts in the `server` directory where dependencies exist
- Or reference the server's node_modules when running from elsewhere

**Example**:
```bash
# ✅ Run from server directory where node_modules exists
cd server
npm install  # Install dependencies if not done
node query-discoverable.js

# ❌ Running from project root will fail
cd /c/src/Chinese-Education-App
node query-discoverable.js  # pg module not found
```

### 4. **`ts-node -e` Fails with ESM Modules**
**Problem**: Using `npx ts-node -e "..."` for inline evaluation fails because the project uses `"type": "module"`.

**Error Message**:
```
SyntaxError: Cannot use import statement outside a module
```

**Solution**: Write the script to a `.ts` file in `server/` and run it with `--esm`:
```bash
npx ts-node --esm my-script.ts
```
Never use `-e` for inline eval with this project.

---

### 5. **No Plain `.env` File**
**Problem**: `dotenv.config()` with no path argument looks for `.env`, which doesn't exist in `server/`. Only `.env.docker` exists.

**Solution**: Either use `dotenv.config({ path: '.env.docker' })`, or skip env files entirely and connect via `docker exec psql` (recommended for ad-hoc queries).

---

### 6. **Database Connection Issues**
**Problem**: PostgreSQL pool not connecting due to:
- Missing environment variables
- Incorrect database credentials
- Database service not running

**Error Message**:
```
Database connection unavailable
```

**Root Cause**: The database configuration uses environment variables that may not be set, or the PostgreSQL server may not be running.

**Solution**:
- Ensure `.env` file is present with database credentials
- Check that PostgreSQL is running: `docker-compose up` (if using Docker)
- Verify credentials in `server/db-config.ts`
- Default credentials if .env is missing:
  - Host: `localhost`
  - Port: `5432`
  - Database: `cow_db`
  - User: `cow_user`
  - Password: `cow_password_local`

## Available Tables

To check what tables exist in the database:

```javascript
const result = await client.query(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
  ORDER BY table_name
`);
```

**Current Tables**:
- `dictionaryentries` - Dictionary words with definitions
- `vocabentries` - User vocab learning entries
- `users` - User accounts
- `texts` - User text documents
- `userworkpoints` - Work points tracking
- `ondeckvocabsets` - OnDeck feature sets

## Query Best Practices

### 1. **Use Prepared Statements**
Always use parameterized queries to prevent SQL injection:

```javascript
// ❌ Bad - vulnerable to injection
const result = await client.query(
  `SELECT * FROM dictionaryentries WHERE language = '${lang}'`
);

// ✅ Good - safe parameterized query
const result = await client.query(
  'SELECT * FROM dictionaryentries WHERE language = $1',
  [lang]
);
```

### 2. **Check Column Existence**
Verify column names exist before querying:

```javascript
const result = await client.query(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'dictionaryentries'
`);
```

### 3. **Use Lowercase Table Names**
Keep table names lowercase and unquoted:

```javascript
// ✅ Correct
await client.query('SELECT * FROM dictionaryentries WHERE ...');

// ❌ Avoid unnecessary quoting
await client.query('SELECT * FROM "dictionaryentries" WHERE ...');
```

### 4. **Handle Connection Pooling**
Always release clients back to the pool:

```javascript
const client = await pool.connect();
try {
  // ... queries here
} finally {
  client.release();  // ✅ Important!
}
```

## Example: Discoverable Cards Query

The following script queries the count of discoverable dictionary entries:

```javascript
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'cow_db',
  user: process.env.DB_USER || 'cow_user',
  password: process.env.DB_PASSWORD || 'cow_password_local',
  ssl: false
};

const pool = new Pool(config);

async function queryDiscoverableCards() {
  const client = await pool.connect();
  try {
    // Query 1: Total count
    const totalResult = await client.query(
      'SELECT COUNT(*) as total_discoverable FROM dictionaryentries WHERE discoverable = TRUE'
    );
    console.log(`Total: ${totalResult.rows[0].total_discoverable}`);

    // Query 2: Count by language
    const byLanguageResult = await client.query(
      'SELECT language, COUNT(*) as count FROM dictionaryentries WHERE discoverable = TRUE GROUP BY language ORDER BY language'
    );

    byLanguageResult.rows.forEach(row => {
      console.log(`${row.language}: ${row.count}`);
    });
  } finally {
    client.release();
    await pool.end();
  }
}

queryDiscoverableCards();
```

**Results** (as of 2025-02-28):
- **Total Discoverable Cards**: 205
- **By Language**:
  - zh (Chinese): 205

## Debugging Queries

### Enable Query Logging
Add logging to see what SQL is being executed:

```javascript
const client = await pool.connect();
console.log('Executing query:', queryString, 'with params:', params);
const result = await client.query(queryString, params);
```

### Check Query Syntax
Use PostgreSQL's EXPLAIN to understand query performance:

```sql
EXPLAIN SELECT * FROM dictionaryentries WHERE discoverable = TRUE;
```

### Validate Column Names
Before using a column, verify it exists:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'dictionaryentries'
ORDER BY ordinal_position;
```

## Connection Pooling Tips

The `pg` library uses connection pooling for efficiency:

- **Max Connections**: 20 (configured in `db-config.ts`)
- **Idle Timeout**: 30 seconds
- **Connection Timeout**: 2 seconds
- Always release clients: `client.release()`
- Use `pool.end()` to close all connections when done

## Environment Variables

Ensure these are set in `.env`:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cow_db
DB_USER=cow_user
DB_PASSWORD=cow_password_local
```

Or they default to the values shown above.

## Troubleshooting Checklist

- [ ] Is PostgreSQL running? (`docker ps` — look for `cow-postgres-local` / `cow-postgres-prod`)
- [ ] Are dependencies installed? (Run `npm install` in `server/` directory)
- [ ] Using `docker exec psql` instead of a script? (preferred for ad-hoc queries)
- [ ] If writing a script: is it in `server/` and run with `npx ts-node --esm`?
- [ ] Is `.env.docker` being loaded (not `.env`, which doesn't exist)?
- [ ] Are table names lowercase?
- [ ] Are camelCase column names double-quoted (e.g., `"createdAt"`)?
- [ ] Are you using `db.pool.query()` (not `db.query()`)?
- [ ] Are you using parameterized queries?
- [ ] Did you release the database client?
- [ ] Did you close the pool with `pool.end()`?

## Further Reading

- [pg npm documentation](https://node-postgres.com/)
- [PostgreSQL documentation](https://www.postgresql.org/docs/)
- [Connection pooling guide](https://node-postgres.com/features/pooling)
