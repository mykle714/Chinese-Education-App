-- Test Users and Sample Data Initialization
-- This script creates 3 test users with different amounts of vocabulary data
-- Password for all users: testing123
-- Hash: $2b$10$f2YiGNmtO6wWOB3Gpbt2E.9Rb9BT5dxkzmysgrqIpkBwYjZyOc2HS

-- Create the 3 test users
INSERT INTO Users (id, email, name, password, "createdAt") VALUES 
('11111111-1111-1111-1111-111111111111', 'empty@test.com', 'Empty User', '$2b$10$f2YiGNmtO6wWOB3Gpbt2E.9Rb9BT5dxkzmysgrqIpkBwYjZyOc2HS', NOW()),
('22222222-2222-2222-2222-222222222222', 'small@test.com', 'Small User', '$2b$10$f2YiGNmtO6wWOB3Gpbt2E.9Rb9BT5dxkzmysgrqIpkBwYjZyOc2HS', NOW()),
('33333333-3333-3333-3333-333333333333', 'large@test.com', 'Large User', '$2b$10$f2YiGNmtO6wWOB3Gpbt2E.9Rb9BT5dxkzmysgrqIpkBwYjZyOc2HS', NOW());

-- Insert 10 vocabulary entries for Small User (22222222-2222-2222-2222-222222222222)
INSERT INTO VocabEntries ("userId", "entryKey", "entryValue", language, script, "hskLevelTag", "isCustomTag", "createdAt") VALUES 
('22222222-2222-2222-2222-222222222222', '你好', 'Hello', 'zh', 'simplified', 'HSK1', false, NOW()),
('22222222-2222-2222-2222-222222222222', '谢谢', 'Thank you', 'zh', 'simplified', 'HSK1', false, NOW()),
('22222222-2222-2222-2222-222222222222', '再见', 'Goodbye', 'zh', 'simplified', 'HSK1', false, NOW()),
('22222222-2222-2222-2222-222222222222', '水', 'Water', 'zh', 'simplified', 'HSK1', false, NOW()),
('22222222-2222-2222-2222-222222222222', '吃', 'To eat', 'zh', 'simplified', 'HSK1', false, NOW()),
('22222222-2222-2222-2222-222222222222', '喝', 'To drink', 'zh', 'simplified', 'HSK1', false, NOW()),
('22222222-2222-2222-2222-222222222222', '学习', 'To study', 'zh', 'simplified', 'HSK2', false, NOW()),
('22222222-2222-2222-2222-222222222222', '工作', 'To work', 'zh', 'simplified', 'HSK2', false, NOW()),
('22222222-2222-2222-2222-222222222222', '朋友', 'Friend', 'zh', 'simplified', 'HSK2', false, NOW()),
('22222222-2222-2222-2222-222222222222', '家', 'Home', 'zh', 'simplified', 'HSK1', false, NOW());

-- Insert 50 vocabulary entries for Large User (33333333-3333-3333-3333-333333333333)
-- Using a mix of entries from the CSV data with various HSK levels
INSERT INTO VocabEntries ("userId", "entryKey", "entryValue", language, script, "hskLevelTag", "isCustomTag", "createdAt") VALUES 
('33333333-3333-3333-3333-333333333333', '来源', 'Source; origin', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '斗争', 'Struggle', 'zh', 'simplified', 'HSK5', false, NOW()),
('33333333-3333-3333-3333-333333333333', '转折', 'a twist (in the plot)', 'zh', 'simplified', 'HSK6', false, NOW()),
('33333333-3333-3333-3333-333333333333', '与众不同', 'to stand out', 'zh', 'simplified', 'HSK5', false, NOW()),
('33333333-3333-3333-3333-333333333333', '事实', 'Fact', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '威胁', 'to threaten', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '治愈', 'to heal', 'zh', 'simplified', 'HSK5', false, NOW()),
('33333333-3333-3333-3333-333333333333', '安慰', 'comfort', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '作品', 'piece (art/project)', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '农村', 'Rural area', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '支持', 'to support', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '进展', 'Progress', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '自信', 'self-confidence', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '激动', 'excited', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '喜爱', 'favorite', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '困惑', 'Confusion', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '答应', 'to promise', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '消化', 'Digestion', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '极端', 'extreme', 'zh', 'simplified', 'HSK5', false, NOW()),
('33333333-3333-3333-3333-333333333333', '外表', 'Appearance', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '勉强', 'Reluctantly', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '优化', 'optimisation', 'zh', 'simplified', 'HSK5', false, NOW()),
('33333333-3333-3333-3333-333333333333', '心理', 'Psychological', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '究竟', 'in the end', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '原谅', 'Forgive', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '复杂', 'complex', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '改进', 'Improvements', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '真相', 'The Truth', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '于是', 'So; therefore', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '创造', 'to create', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '立刻', 'Immediately', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '挣扎', 'to struggle', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '疯狂', 'crazy; insane', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '新鲜', 'Fresh', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '心碎', 'heartbreak', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '作文', 'Essay', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '安心', 'at ease', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '实在', 'is really', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '预想', 'to expect', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '召唤', 'to summon', 'zh', 'simplified', 'HSK5', false, NOW()),
('33333333-3333-3333-3333-333333333333', '批注', 'to annotate', 'zh', 'simplified', 'HSK5', false, NOW()),
('33333333-3333-3333-3333-333333333333', '枯竭', 'depleted', 'zh', 'simplified', 'HSK5', false, NOW()),
('33333333-3333-3333-3333-333333333333', '胡言乱语', 'yapping', 'zh', 'simplified', 'HSK6', false, NOW()),
('33333333-3333-3333-3333-333333333333', '明显', 'obvious', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '分享', 'to share', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '角度', 'Angle', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '加入', 'to Join', 'zh', 'simplified', 'HSK3', false, NOW()),
('33333333-3333-3333-3333-333333333333', '专心', 'to consentrate; to focus', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '温和', 'Mild; moderate', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '冲突', 'Conflict', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '批评', 'to Criticize', 'zh', 'simplified', 'HSK4', false, NOW()),
('33333333-3333-3333-3333-333333333333', '挑战', 'to challenge', 'zh', 'simplified', 'HSK4', false, NOW());

-- Add some custom tagged entries for variety
INSERT INTO VocabEntries ("userId", "entryKey", "entryValue", language, script, "isCustomTag", "createdAt") VALUES 
('22222222-2222-2222-2222-222222222222', 'Custom Word', 'My personal vocabulary', 'zh', 'simplified', true, NOW()),
('33333333-3333-3333-3333-333333333333', 'Personal Note', 'Important phrase for me', 'zh', 'simplified', true, NOW()),
('33333333-3333-3333-3333-333333333333', 'Study Tip', 'Remember this pattern', 'zh', 'simplified', true, NOW());

-- Create a sample OnDeck vocab set for the Large User
INSERT INTO OnDeckVocabSets ("userId", "featureName", "vocabEntryIds", "updatedAt") VALUES 
('33333333-3333-3333-3333-333333333333', 'HSK3 Practice', '[1, 2, 3, 4, 5]', NOW()),
('33333333-3333-3333-3333-333333333333', 'Daily Review', '[6, 7, 8, 9, 10]', NOW());

-- Display summary of created test users
DO $$
BEGIN
    RAISE NOTICE '=== TEST USERS CREATED ===';
    RAISE NOTICE 'User 1: empty@test.com (password: testing123) - 0 vocabulary entries';
    RAISE NOTICE 'User 2: small@test.com (password: testing123) - 11 vocabulary entries (10 + 1 custom)';
    RAISE NOTICE 'User 3: large@test.com (password: testing123) - 52 vocabulary entries (50 + 2 custom)';
    RAISE NOTICE '========================';
END $$;
