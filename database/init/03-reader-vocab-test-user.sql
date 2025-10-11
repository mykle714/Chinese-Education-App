-- Reader Vocabulary Test User Initialization
-- This script creates a test user with vocabulary entries from all reader docs
-- Email: reader-vocab-test@example.com
-- Password: TestPassword123!
-- Hash: $2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi

-- Create the reader vocabulary test user
INSERT INTO Users (id, email, name, password, "createdAt") VALUES 
('44444444-4444-4444-4444-444444444444', 'reader-vocab-test@example.com', 'Reader Vocab Test User', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', NOW())
ON CONFLICT (email) DO NOTHING;

-- Delete any existing entries for this user to ensure clean data
DELETE FROM VocabEntries WHERE "userId" = '44444444-4444-4444-4444-444444444444';

-- Insert vocabulary entries from reader docs
-- Text 1: Coffee Shop Morning (咖啡店的早晨)
INSERT INTO VocabEntries ("userId", "entryKey", "entryValue", language, script, "createdAt") VALUES 
('44444444-4444-4444-4444-444444444444', '今天', 'today', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '早上', 'morning', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '来到', 'to arrive at, to come to', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '市中心', 'city center, downtown', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '一家', 'one (classifier for businesses)', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '小', 'small', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '咖啡店', 'coffee shop', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '这家', 'this (business/shop)', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '店', 'shop, store', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '很', 'very', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '温馨', 'warm and cozy', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '墙上', 'on the wall', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '挂着', 'hanging', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '许多', 'many, a lot of', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '艺术', 'art', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '画作', 'paintings, artwork', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '空气', 'air', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '中', 'in, among', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '弥漫', 'to fill the air, to permeate', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '浓郁', 'rich, strong (aroma)', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '咖啡', 'coffee', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '香味', 'fragrance, aroma', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '点了', 'ordered', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '一杯', 'one cup', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '拿铁', 'latte', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '一个', 'one (classifier)', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '牛角包', 'croissant', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '坐在', 'sitting at', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '靠窗', 'by the window', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '位置', 'position, seat', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '可以', 'can, able to', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '看到', 'to see', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '街上', 'on the street', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '来来往往', 'coming and going', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '人们', 'people', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '有些人', 'some people', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '匆匆忙忙', 'hurriedly, in a rush', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '赶去', 'to rush to', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '上班', 'to go to work', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '悠闲', 'leisurely, relaxed', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '散步', 'to take a walk', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '里', 'inside', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '播放', 'to play (music)', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '轻柔', 'soft, gentle', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '音乐', 'music', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '让人', 'makes people', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '感到', 'to feel', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '放松', 'relaxed', 'zh', 'simplified', NOW()),

-- Text 2: Spring Festival Preparation (春节的准备)
('44444444-4444-4444-4444-444444444444', '春节', 'Spring Festival, Chinese New Year', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '快到了', 'is coming soon', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '我们', 'we, us', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '全家', 'whole family', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '都在', 'all are', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '忙着', 'busy with', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '准备', 'to prepare', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '过年', 'to celebrate New Year', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '妈妈', 'mom, mother', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '早早', 'early', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '就', 'already, then', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '开始', 'to start, to begin', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '计划', 'to plan', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '年夜饭', 'New Year''s Eve dinner', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '菜单', 'menu', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '她', 'she', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '说', 'to say', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '今年', 'this year', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '要', 'to want, will', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '做', 'to make, to do', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '十二道菜', 'twelve dishes', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '寓意', 'to symbolize', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '十二个月', 'twelve months', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '都', 'all', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '顺顺利利', 'smoothly, successfully', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '爸爸', 'dad, father', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '负责', 'to be responsible for', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '买', 'to buy', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '年货', 'New Year goods', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '他', 'he', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '列了', 'made a list', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '长长的', 'long', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '清单', 'list', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '瓜子', 'sunflower seeds', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '花生', 'peanuts', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '糖果', 'candy, sweets', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '水果', 'fruit', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '还有', 'also, and', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '各种', 'various kinds of', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '干货', 'dried goods', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '我', 'I, me', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '和', 'and', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '弟弟', 'younger brother', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '任务', 'task', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '是', 'is, to be', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '打扫', 'to clean', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '房子', 'house', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '贴', 'to paste, to stick', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '春联', 'Spring Festival couplets', 'zh', 'simplified', NOW()),

-- Text 3: Tai Chi in the Park (公园里的太极)
('44444444-4444-4444-4444-444444444444', '每天', 'every day', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '六点', 'six o''clock', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '都会', 'will always', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '去', 'to go', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '附近', 'nearby', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '公园', 'park', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '有', 'to have, there is/are', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '一群', 'a group of', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '老人', 'elderly people', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '在', 'at, in (location)', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '练习', 'to practice', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '太极拳', 'Tai Chi', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '他们', 'they, them', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '动作', 'movements, actions', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '缓慢', 'slow', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '而', 'and, but', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '优雅', 'elegant, graceful', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '就像', 'just like', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '跳', 'to dance, to jump', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '一支', 'one (classifier for songs/dances)', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '无声', 'silent', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '舞蹈', 'dance', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '领头', 'to lead', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '一位', 'one (polite classifier for people)', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '七十多岁', 'over seventy years old', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '张爷爷', 'Grandpa Zhang', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '练', 'to practice', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '太极', 'Tai Chi', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '已经', 'already', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '三十多年', 'over thirty years', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '了', 'particle indicating completion', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '告诉', 'to tell', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '不仅', 'not only', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '能', 'can, able to', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '强身健体', 'to strengthen the body', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '还能', 'also can', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '心情', 'mood', 'zh', 'simplified', NOW()),
('44444444-4444-4444-4444-444444444444', '平静', 'calm, peaceful', 'zh', 'simplified', NOW());

-- Display summary of created reader vocabulary test user
DO $$
BEGIN
    RAISE NOTICE '=== READER VOCABULARY TEST USER CREATED ===';
    RAISE NOTICE 'Email: reader-vocab-test@example.com';
    RAISE NOTICE 'Password: TestPassword123!';
    RAISE NOTICE 'Vocabulary entries: 135 words from reader texts';
    RAISE NOTICE 'Texts covered:';
    RAISE NOTICE '  - 咖啡店的早晨 (Coffee Shop Morning)';
    RAISE NOTICE '  - 春节的准备 (Spring Festival Preparation)';
    RAISE NOTICE '  - 公园里的太极 (Tai Chi in the Park)';
    RAISE NOTICE '===========================================';
END $$;
