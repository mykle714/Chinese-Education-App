-- Reset script: drops all application tables in FK-safe order.
-- Run this before 01-schema.sql to do a clean deployment.
-- WARNING: destroys all data. Only use on non-production or before initial launch.

DROP TABLE IF EXISTS vocabentries CASCADE;
DROP TABLE IF EXISTS userworkpoints CASCADE;
DROP TABLE IF EXISTS texts CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS dictionaryentries CASCADE;
DROP TABLE IF EXISTS schema_migrations CASCADE;
