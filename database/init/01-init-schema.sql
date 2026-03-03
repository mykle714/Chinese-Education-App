-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create Users table
CREATE TABLE Users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    password VARCHAR(255) NOT NULL,
    "selectedLanguage" VARCHAR(10) DEFAULT 'zh',
    "totalWorkPoints" INTEGER DEFAULT 0,
    "lastWorkPointIncrement" TIMESTAMP,
    "isPublic" BOOLEAN DEFAULT TRUE,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "lastStreakIncrement" TIMESTAMP DEFAULT NULL,
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
    "hskLevelTag" VARCHAR(10),
    pronunciation VARCHAR(200),
    tone VARCHAR(20),
    "markHistory" JSONB DEFAULT '[]',
    "totalMarkCount" INTEGER DEFAULT 0,
    "totalCorrectCount" INTEGER DEFAULT 0,
    "totalSuccessRate" DECIMAL(5,4),
    "last8SuccessRate" DECIMAL(5,4),
    "last16SuccessRate" DECIMAL(5,4),
    category VARCHAR(20) NOT NULL DEFAULT 'Unfamiliar',
    "starterPackBucket" VARCHAR(20),
    breakdown JSONB DEFAULT NULL,
    synonyms JSONB DEFAULT '[]',
    "exampleSentences" JSONB DEFAULT '[]',
    "partsOfSpeech" JSONB DEFAULT '[]',
    expansion TEXT DEFAULT NULL,
    "expansionMetadata" JSONB DEFAULT NULL,
    "createdAt" TIMESTAMP DEFAULT NOW(),
    CONSTRAINT chk_starter_pack_bucket CHECK ("starterPackBucket" IN ('library', 'learn-later', 'skip') OR "starterPackBucket" IS NULL)
);

-- Create Texts table
CREATE TABLE texts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "userId" UUID NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    content TEXT NOT NULL,
    language VARCHAR(10) DEFAULT 'zh',
    "characterCount" INTEGER DEFAULT 0,
    "isUserCreated" BOOLEAN DEFAULT TRUE,
    "createdAt" TIMESTAMP DEFAULT NOW()
);

-- Create UserWorkPoints table
CREATE TABLE userworkpoints (
    "userId" UUID NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    "deviceFingerprint" VARCHAR(255) NOT NULL,
    "workPoints" INTEGER NOT NULL DEFAULT 0,
    "lastSyncTimestamp" TIMESTAMP DEFAULT NOW(),
    "updatedAt" TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY ("userId", date, "deviceFingerprint")
);

CREATE INDEX idx_texts_userid ON texts("userId");

-- Create indexes for performance
CREATE INDEX idx_users_email ON Users(email);
CREATE INDEX idx_vocabentries_userid ON VocabEntries("userId");
CREATE INDEX idx_vocabentries_key ON VocabEntries("entryKey");
CREATE INDEX idx_vocabentries_language ON VocabEntries(language);
CREATE INDEX idx_vocabentries_key_trgm ON VocabEntries USING gin ("entryKey" gin_trgm_ops);
CREATE INDEX idx_vocabentries_value_trgm ON VocabEntries USING gin ("entryValue" gin_trgm_ops);

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
