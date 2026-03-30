-- Test Users and Sample Data
-- Creates 4 test users with varying amounts of vocabulary data.
-- All inserts are idempotent (ON CONFLICT DO NOTHING).
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
        INSERT INTO vocabentries ("userId", "entryKey", "entryValue", language) VALUES
        (test_user_id, '你好',       'Hello',      'zh'),
        (test_user_id, '謝謝',       'Thank you',  'zh'),
        (test_user_id, 'こんにちは',  'Hello',      'ja'),
        (test_user_id, 'ありがとう',  'Thank you',  'ja'),
        (test_user_id, '안녕하세요',  'Hello',      'ko'),
        (test_user_id, '감사합니다',  'Thank you',  'ko'),
        (test_user_id, 'Xin chào',   'Hello',      'vi'),
        (test_user_id, 'Cảm ơn',     'Thank you',  'vi');
    END IF;
END $$;

-- 10 vocab entries for small@test.com (HSK1-2 words)
INSERT INTO vocabentries ("userId", "entryKey", "entryValue", language, "createdAt") VALUES
('22222222-2222-2222-2222-222222222222', '你好', 'Hello',     'zh', NOW()),
('22222222-2222-2222-2222-222222222222', '谢谢', 'Thank you', 'zh', NOW()),
('22222222-2222-2222-2222-222222222222', '再见', 'Goodbye',   'zh', NOW()),
('22222222-2222-2222-2222-222222222222', '水',   'Water',     'zh', NOW()),
('22222222-2222-2222-2222-222222222222', '吃',   'To eat',    'zh', NOW()),
('22222222-2222-2222-2222-222222222222', '喝',   'To drink',  'zh', NOW()),
('22222222-2222-2222-2222-222222222222', '学习', 'To study',  'zh', NOW()),
('22222222-2222-2222-2222-222222222222', '工作', 'To work',   'zh', NOW()),
('22222222-2222-2222-2222-222222222222', '朋友', 'Friend',    'zh', NOW()),
('22222222-2222-2222-2222-222222222222', '家',   'Home',      'zh', NOW());

-- 50 vocab entries for large@test.com (HSK3-6 words)
INSERT INTO vocabentries ("userId", "entryKey", "entryValue", language, "createdAt") VALUES
('33333333-3333-3333-3333-333333333333', '来源',   'Source; origin',              'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '斗争',   'Struggle',                    'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '转折',   'a twist (in the plot)',        'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '与众不同', 'to stand out',               'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '事实',   'Fact',                        'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '威胁',   'to threaten',                 'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '治愈',   'to heal',                     'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '安慰',   'comfort',                     'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '作品',   'piece (art/project)',          'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '农村',   'Rural area',                  'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '支持',   'to support',                  'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '进展',   'Progress',                    'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '自信',   'self-confidence',             'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '激动',   'excited',                     'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '喜爱',   'favorite',                    'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '困惑',   'Confusion',                   'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '答应',   'to promise',                  'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '消化',   'Digestion',                   'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '极端',   'extreme',                     'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '外表',   'Appearance',                  'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '勉强',   'Reluctantly',                 'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '优化',   'optimisation',                'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '心理',   'Psychological',               'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '究竟',   'in the end',                  'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '原谅',   'Forgive',                     'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '复杂',   'complex',                     'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '改进',   'Improvements',                'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '真相',   'The Truth',                   'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '于是',   'So; therefore',               'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '创造',   'to create',                   'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '立刻',   'Immediately',                 'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '挣扎',   'to struggle',                 'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '疯狂',   'crazy; insane',               'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '新鲜',   'Fresh',                       'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '心碎',   'heartbreak',                  'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '作文',   'Essay',                       'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '安心',   'at ease',                     'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '实在',   'is really',                   'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '预想',   'to expect',                   'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '召唤',   'to summon',                   'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '批注',   'to annotate',                 'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '枯竭',   'depleted',                    'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '胡言乱语', 'yapping',                   'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '明显',   'obvious',                     'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '分享',   'to share',                    'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '角度',   'Angle',                       'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '加入',   'to Join',                     'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '专心',   'to consentrate; to focus',    'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '温和',   'Mild; moderate',              'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '冲突',   'Conflict',                    'zh', NOW());

-- Custom entries (no hsk level)
INSERT INTO vocabentries ("userId", "entryKey", "entryValue", language, "createdAt") VALUES
('22222222-2222-2222-2222-222222222222', 'Custom Word',   'My personal vocabulary',       'zh', NOW()),
('33333333-3333-3333-3333-333333333333', 'Personal Note', 'Important phrase for me',      'zh', NOW()),
('33333333-3333-3333-3333-333333333333', 'Study Tip',     'Remember this pattern',        'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '批评',          'to Criticize',                 'zh', NOW()),
('33333333-3333-3333-3333-333333333333', '挑战',          'to challenge',                 'zh', NOW());

DO $$
BEGIN
    RAISE NOTICE '=== TEST USERS ===';
    RAISE NOTICE 'test@example.com  — 8 entries (zh/ja/ko/vi)';
    RAISE NOTICE 'empty@test.com    — 0 entries  (password: testing123)';
    RAISE NOTICE 'small@test.com    — 11 entries (password: testing123)';
    RAISE NOTICE 'large@test.com    — 55 entries (password: testing123)';
    RAISE NOTICE '=================';
END $$;
