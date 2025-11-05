-- Database Schema Validation Script for Production
-- This script checks if all required tables, columns, indexes exist
-- Run this with: psql -U cow_user -d cow_db -f validate-schema.sql

\echo '========================================='
\echo 'DATABASE SCHEMA VALIDATION REPORT'
\echo '========================================='
\echo ''

-- Check PostgreSQL version
\echo '📊 PostgreSQL Version:'
SELECT version();
\echo ''

-- Check database connection
\echo '✓ Connected to database: ' || current_database();
\echo ''

\echo '========================================='
\echo 'TABLE EXISTENCE CHECK'
\echo '========================================='

-- Check if users table exists
\echo ''
\echo 'Checking: users table'
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')
        THEN '✅ users table exists'
        ELSE '❌ users table MISSING'
    END as status;

-- Check if vocabentries table exists
\echo ''
\echo 'Checking: vocabentries table'
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vocabentries')
        THEN '✅ vocabentries table exists'
        ELSE '❌ vocabentries table MISSING'
    END as status;

-- Check if texts table exists
\echo ''
\echo 'Checking: texts table'
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'texts')
        THEN '✅ texts table exists'
        ELSE '❌ texts table MISSING'
    END as status;

-- Check if ondeckvocab table exists
\echo ''
\echo 'Checking: ondeckvocab table'
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ondeckvocab')
        THEN '✅ ondeckvocab table exists'
        ELSE '❌ ondeckvocab table MISSING'
    END as status;

-- Check if userworkpoints table exists
\echo ''
\echo 'Checking: userworkpoints table'
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'userworkpoints')
        THEN '✅ userworkpoints table exists'
        ELSE '❌ userworkpoints table MISSING'
    END as status;

-- Check if dictionary tables exist
\echo ''
\echo 'Checking: dictionary_zh table'
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dictionary_zh')
        THEN '✅ dictionary_zh table exists'
        ELSE '❌ dictionary_zh table MISSING'
    END as status;

\echo ''
\echo 'Checking: dictionary_ja table'
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dictionary_ja')
        THEN '✅ dictionary_ja table exists'
        ELSE '❌ dictionary_ja table MISSING'
    END as status;

\echo ''
\echo 'Checking: dictionary_ko table'
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dictionary_ko')
        THEN '✅ dictionary_ko table exists'
        ELSE '❌ dictionary_ko table MISSING'
    END as status;

\echo ''
\echo 'Checking: dictionary_vi table'
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dictionary_vi')
        THEN '✅ dictionary_vi table exists'
        ELSE '❌ dictionary_vi table MISSING'
    END as status;

\echo ''
\echo '========================================='
\echo 'COLUMN EXISTENCE CHECK - users table'
\echo '========================================='

-- Check users table columns
\echo ''
\echo 'Checking users table columns:'
SELECT 
    column_name,
    data_type,
    CASE WHEN is_nullable = 'NO' THEN 'NOT NULL' ELSE 'NULL' END as nullable
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

\echo ''
\echo '========================================='
\echo 'COLUMN EXISTENCE CHECK - texts table'
\echo '========================================='

-- Check texts table columns
\echo ''
\echo 'Checking texts table columns (if exists):'
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'texts')
        THEN (
            SELECT string_agg(column_name || ' (' || data_type || ')', ', ')
            FROM information_schema.columns
            WHERE table_name = 'texts'
        )
        ELSE '❌ Table does not exist'
    END as columns;

\echo ''
\echo '========================================='
\echo 'INDEX CHECK'
\echo '========================================='

-- Check indexes
\echo ''
\echo 'Checking indexes:'
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

\echo ''
\echo '========================================='
\echo 'MISSING TABLES THAT NEED CREATION'
\echo '========================================='

-- List missing tables
\echo ''
WITH expected_tables AS (
    SELECT unnest(ARRAY[
        'users',
        'vocabentries',
        'texts',
        'ondeckvocab',
        'userworkpoints',
        'dictionary_zh',
        'dictionary_ja',
        'dictionary_ko',
        'dictionary_vi'
    ]) as table_name
),
existing_tables AS (
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
)
SELECT 
    '❌ MISSING: ' || et.table_name as missing_table
FROM expected_tables et
LEFT JOIN existing_tables ext ON et.table_name = ext.table_name
WHERE ext.table_name IS NULL;

\echo ''
\echo '========================================='
\echo 'RECORD COUNTS'
\echo '========================================='

-- Count records in each table (only if they exist)
\echo ''
\echo 'Record counts in existing tables:'

DO $$
DECLARE
    rec RECORD;
    cnt INTEGER;
BEGIN
    FOR rec IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
    LOOP
        EXECUTE format('SELECT COUNT(*) FROM %I', rec.table_name) INTO cnt;
        RAISE NOTICE '% rows in table: %', cnt, rec.table_name;
    END LOOP;
END $$;

\echo ''
\echo '========================================='
\echo 'VALIDATION COMPLETE'
\echo '========================================='
