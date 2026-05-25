-- Test Users and Sample Data
-- Creates 4 test users with varying amounts of vocabulary data.
-- All inserts are idempotent (ON CONFLICT DO NOTHING).
--
-- NOTE: vocabentries no longer stores a per-row definition; the definition
-- is joined from dictionaryentries at read time. These seeds only need an
-- entryKey. Terms that don't have a matching det row will render no
-- definition (acceptable for test fixtures).
--
-- Credentials:
--   test@example.com       password: (bcrypt hash placeholder)
--   empty@test.com         password: testing123
--   small@test.com         password: testing123
--   large@test.com         password: testing123

INSERT INTO users (id, email, name, password, "createdAt") VALUES
(uuid_generate_v4(),                           'test@example.com',  'Test User',   '$2b$10$example.hash.for.testing',                      NOW()),
('11111111-1111-1111-1111-111111111111',        'empty@test.com',    'Empty User',  '$2b$10$f2YiGNmtO6wWOB3Gpbt2E.9Rb9BT5dxkzmysgrqIpkBwYjZyOc2HS', NOW()),
('22222222-2222-2222-2222-222222222222',        'small@test.com',    'Small User',  '$2b$10$f2YiGNmtO6wWOB3Gpbt2E.9Rb9BT5dxkzmysgrqIpkBwYjZyOc2HS', NOW()),
('33333333-3333-3333-3333-333333333333',        'large@test.com',    'Large User',  '$2b$10$f2YiGNmtO6wWOB3Gpbt2E.9Rb9BT5dxkzmysgrqIpkBwYjZyOc2HS', NOW())
ON CONFLICT (email) DO NOTHING;

-- 8 vocab entries for test@example.com (multi-language hello/thank-you)
DO $$
DECLARE
    test_user_id UUID;
BEGIN
    SELECT id INTO test_user_id FROM users WHERE email = 'test@example.com';
    IF test_user_id IS NOT NULL THEN
        INSERT INTO vocabentries ("userId", "entryKey", language, "starterPackBucket") VALUES
        (test_user_id, '你好',       'zh', 'library'),
        (test_user_id, '謝謝',       'zh', 'library'),
        (test_user_id, 'こんにちは',  'ja', 'library'),
        (test_user_id, 'ありがとう',  'ja', 'library'),
        (test_user_id, '안녕하세요',  'ko', 'library'),
        (test_user_id, '감사합니다',  'ko', 'library'),
        (test_user_id, 'Xin chào',   'vi', 'library'),
        (test_user_id, 'Cảm ơn',     'vi', 'library');
    END IF;
END $$;

-- 10 vocab entries for small@test.com (HSK1-2 words)
INSERT INTO vocabentries ("userId", "entryKey", language, "createdAt", "starterPackBucket") VALUES
('22222222-2222-2222-2222-222222222222', '你好', 'zh', NOW(), 'library'),
('22222222-2222-2222-2222-222222222222', '谢谢', 'zh', NOW(), 'library'),
('22222222-2222-2222-2222-222222222222', '再见', 'zh', NOW(), 'library'),
('22222222-2222-2222-2222-222222222222', '水',   'zh', NOW(), 'library'),
('22222222-2222-2222-2222-222222222222', '吃',   'zh', NOW(), 'library'),
('22222222-2222-2222-2222-222222222222', '喝',   'zh', NOW(), 'library'),
('22222222-2222-2222-2222-222222222222', '学习', 'zh', NOW(), 'library'),
('22222222-2222-2222-2222-222222222222', '工作', 'zh', NOW(), 'library'),
('22222222-2222-2222-2222-222222222222', '朋友', 'zh', NOW(), 'library'),
('22222222-2222-2222-2222-222222222222', '家',   'zh', NOW(), 'library');

-- 50 vocab entries for large@test.com (HSK3-6 words)
INSERT INTO vocabentries ("userId", "entryKey", language, "createdAt", "starterPackBucket") VALUES
('33333333-3333-3333-3333-333333333333', '来源',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '斗争',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '转折',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '与众不同', 'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '事实',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '威胁',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '治愈',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '安慰',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '作品',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '农村',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '支持',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '进展',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '自信',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '激动',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '喜爱',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '困惑',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '答应',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '消化',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '极端',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '外表',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '勉强',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '优化',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '心理',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '究竟',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '原谅',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '复杂',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '改进',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '真相',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '于是',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '创造',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '立刻',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '挣扎',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '疯狂',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '新鲜',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '心碎',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '作文',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '安心',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '实在',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '预想',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '召唤',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '批注',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '枯竭',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '胡言乱语', 'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '明显',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '分享',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '角度',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '加入',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '专心',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '温和',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '冲突',     'zh', NOW(), 'library');

-- Custom entries (no hsk level)
INSERT INTO vocabentries ("userId", "entryKey", language, "createdAt", "starterPackBucket") VALUES
('22222222-2222-2222-2222-222222222222', 'Custom Word',   'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', 'Personal Note', 'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', 'Study Tip',     'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '批评',          'zh', NOW(), 'library'),
('33333333-3333-3333-3333-333333333333', '挑战',          'zh', NOW(), 'library');

DO $$
BEGIN
    RAISE NOTICE '=== TEST USERS ===';
    RAISE NOTICE 'test@example.com  — 8 entries (zh/ja/ko/vi)';
    RAISE NOTICE 'empty@test.com    — 0 entries  (password: testing123)';
    RAISE NOTICE 'small@test.com    — 11 entries (password: testing123)';
    RAISE NOTICE 'large@test.com    — 55 entries (password: testing123)';
    RAISE NOTICE '=================';
END $$;
