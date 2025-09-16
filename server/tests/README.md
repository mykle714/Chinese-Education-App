# Test Scripts and SQL Queries

This directory contains test scripts and SQL queries for the vocabulary entry manager application.

## Directory Structure

- `test-*.js` - JavaScript test scripts for API endpoints and functionality
- `*.sql` - SQL scripts for database operations and schema updates
- `README.md` - This documentation file

## Database Schema Management

### Checking Database Schema

**IMPORTANT**: The old `check-schema.js` script was outdated and has been removed.

#### Correct Protocol for Checking Schema:

1. **Via Azure Portal (Recommended)**:
   - Go to your Azure SQL Database in the Azure portal
   - Open **Query editor** or use **SQL Server Management Studio**
   - Run the schema check queries directly
   - **Note**: When database issues arise, ask the user to perform actions in Azure Portal and SSMS as they have direct access and can resolve connection issues more effectively

2. **Via SQL Files**:
   - Use the provided SQL files with the `execute-sql.js` utility
   - Example: `node execute-sql.js check-vocabentries-schema.sql`
   - **Note**: This method may fail due to connection issues - in such cases, request user to use Azure Portal instead

#### Schema Check Queries:

```sql
-- Check VocabEntries table schema
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT,
    CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'VocabEntries' 
ORDER BY ORDINAL_POSITION;

-- Check if table exists
SELECT TABLE_NAME 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_NAME = 'VocabEntries';
```

#### Expected VocabEntries Schema:

```sql
CREATE TABLE VocabEntries (
    id int IDENTITY(1,1) PRIMARY KEY,
    userId uniqueidentifier NOT NULL,
    entryKey nvarchar(MAX) NOT NULL,
    entryValue nvarchar(MAX) NOT NULL,
    createdAt datetime DEFAULT GETDATE(),
    isCustomTag bit DEFAULT 0,
    hskLevelTag nvarchar(10) NULL,
    FOREIGN KEY (userId) REFERENCES Users(id)
);
```

## Running Tests

### API Tests

To run API tests, make sure the server is running on port 3001, then execute:

```bash
node test-login.js
node test-change-password.js
node test-auth-middleware.js
node test-create-entry-without-userid.js
```

### Database Operations

To execute SQL scripts:

```bash
node execute-sql.js <sql-file-name>
```

Example:
```bash
node execute-sql.js check-vocabentries-schema.sql
```

## Test Files

### Authentication Tests
- `test-login.js` - Tests user login functionality
- `test-change-password.js` - Tests password change functionality
- `test-auth-middleware.js` - Tests JWT authentication middleware
- `test-create-entry-without-userid.js` - Tests creating entries without explicit userID

### Database Scripts
- `check-vocabentries-schema.sql` - Checks VocabEntries table schema
- `create-periodic-table-entries.js` - Creates sample vocabulary entries
- `execute-sql.js` - Utility script to execute SQL files
- `update-password-hash.sql` - Updates password hashing in database
- `set-test-passwords.sql` - Sets test passwords for development

### Utility Scripts
- `generate-hash.js` - Generates bcrypt hashes for passwords
- `update-db-passwords.js` - Updates passwords in the database
- `check-password-column.js` - Checks if password column exists
- `check-chinese-chars.js` - Tests Chinese character support

## Troubleshooting Database Issues

### Common Database Connection Problems:

1. **Schema Mismatch**: 
   - Use Azure portal to check actual table schema
   - Compare with expected schema above
   - Run ALTER TABLE statements to fix missing columns

2. **Missing Columns**:
   - The VocabEntries table must have all required columns
   - Use the schema check queries to verify
   - Add missing columns via Azure portal

3. **Connection Timeouts**:
   - Check Azure SQL Database firewall settings
   - Verify connection string in environment variables
   - Test connection via Azure portal first

### Database Schema Fix Protocol:

1. Check current schema via Azure portal
2. Compare with expected schema
3. Run ALTER TABLE statements to add missing columns
4. Test API endpoints after schema fixes
5. Verify foreign key constraints exist

### When to Request User Action in Azure Portal/SSMS:

**Always ask the user to perform these actions directly in Azure Portal or SSMS when:**

- Database connection issues prevent local scripts from running
- Schema modifications are needed (ALTER TABLE, CREATE TABLE, etc.)
- Critical database operations that require immediate verification
- Connection timeouts or authentication failures occur
- Need to check actual database state vs. expected state
- Firewall or network connectivity issues arise

**Benefits of user performing Azure Portal/SSMS actions:**
- Direct database access without connection issues
- Real-time verification of changes
- Better error messages and troubleshooting
- Immediate feedback on query results
- Ability to resolve authentication/network issues

## Guidelines

- Always use Azure portal for critical database operations
- Place all test scripts in this directory
- Use descriptive names for test files
- Include error handling in test scripts
- Document any special setup requirements
- Clean up test data after running tests

## Environment Requirements

- Node.js with ES modules support
- Database connection configured in parent directory
- Server running on localhost:5000 for API tests
- Azure SQL Database with proper firewall configuration
