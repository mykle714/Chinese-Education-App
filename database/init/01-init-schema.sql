-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create Users table
CREATE TABLE Users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    password VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Create VocabEntries table
CREATE TABLE VocabEntries (
    id SERIAL PRIMARY KEY,
    "userId" UUID NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
    "entryKey" TEXT NOT NULL,
    "entryValue" TEXT NOT NULL,
    language VARCHAR(10) DEFAULT 'zh',
    script VARCHAR(20),
    "isCustomTag" BOOLEAN DEFAULT FALSE,
    "hskLevelTag" VARCHAR(10),
    "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Create OnDeckVocabSets table
CREATE TABLE OnDeckVocabSets (
    "userId" UUID NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
    "featureName" VARCHAR(100) NOT NULL,
    "vocabEntryIds" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY ("userId", "featureName")
);

-- Create indexes for performance
CREATE INDEX idx_users_email ON Users(email);
CREATE INDEX idx_vocabentries_userid ON VocabEntries("userId");
CREATE INDEX idx_vocabentries_key ON VocabEntries("entryKey");
CREATE INDEX idx_vocabentries_language ON VocabEntries(language);
CREATE INDEX idx_vocabentries_key_trgm ON VocabEntries USING gin ("entryKey" gin_trgm_ops);
CREATE INDEX idx_vocabentries_value_trgm ON VocabEntries USING gin ("entryValue" gin_trgm_ops);
CREATE INDEX idx_ondeckvocabsets_userid ON OnDeckVocabSets("userId");

-- Insert some sample data for testing
INSERT INTO Users (id, email, name, password) VALUES 
(uuid_generate_v4(), 'test@example.com', 'Test User', '$2b$10$example.hash.for.testing');

-- Add some sample vocabulary entries for testing multi-language support
DO $$
DECLARE
    test_user_id UUID;
BEGIN
    SELECT id INTO test_user_id FROM Users WHERE email = 'test@example.com';
    
    INSERT INTO VocabEntries ("userId", "entryKey", "entryValue", language, script) VALUES 
    (test_user_id, '你好', 'Hello', 'zh', 'simplified'),
    (test_user_id, '謝謝', 'Thank you', 'zh', 'traditional'),
    (test_user_id, 'こんにちは', 'Hello', 'ja', 'hiragana'),
    (test_user_id, 'ありがとう', 'Thank you', 'ja', 'hiragana'),
    (test_user_id, '안녕하세요', 'Hello', 'ko', 'hangul'),
    (test_user_id, '감사합니다', 'Thank you', 'ko', 'hangul'),
    (test_user_id, 'Xin chào', 'Hello', 'vi', 'latin'),
    (test_user_id, 'Cảm ơn', 'Thank you', 'vi', 'latin');
END $$;
