# PostgreSQL Query Guide

## Overview
This document outlines common issues when querying PostgreSQL in the Chinese Education App and provides best practices for successful queries.

## Common Issues Encountered

### 1. **Table Name Case Sensitivity**
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

### 2. **Missing Dependencies**
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

### 3. **Database Connection Issues**
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

- [ ] Is PostgreSQL running? (Check Docker containers)
- [ ] Are dependencies installed? (Run `npm install` in server directory)
- [ ] Is `.env` file present with correct credentials?
- [ ] Are table names lowercase?
- [ ] Are column names spelled correctly?
- [ ] Are you using parameterized queries?
- [ ] Did you release the database client?
- [ ] Did you close the pool with `pool.end()`?

## Further Reading

- [pg npm documentation](https://node-postgres.com/)
- [PostgreSQL documentation](https://www.postgresql.org/docs/)
- [Connection pooling guide](https://node-postgres.com/features/pooling)
