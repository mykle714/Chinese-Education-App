-- Add Sample Vietnamese Data for User 354f37b7-22bf-4cda-a969-1f2536c714a3
-- This script adds sample Vietnamese texts and vocabulary entries for testing

-- First, verify the user exists and set their language to Vietnamese
UPDATE users 
SET "selectedLanguage" = 'vi' 
WHERE id = '354f37b7-22bf-4cda-a969-1f2536c714a3';

-- Insert Sample Vietnamese Texts
-- Text 1: Simple greeting and introduction
INSERT INTO texts (title, content, language, "userId", "createdAt", "updatedAt")
VALUES (
    'Lời chào đơn giản - Simple Greetings',
    'Xin chào! Tôi tên là Mai. Tôi là sinh viên. Tôi học tiếng Anh ở trường đại học. Hôm nay là một ngày đẹp trời. Tôi rất vui được gặp bạn. Bạn khỏe không? Tôi khỏe, cảm ơn bạn. Chúng ta cùng đi uống cà phê nhé!',
    'vi',
    '354f37b7-22bf-4cda-a969-1f2536c714a3',
    NOW(),
    NOW()
);

-- Text 2: About Vietnamese food
INSERT INTO texts (title, content, language, "userId", "createdAt", "updatedAt")
VALUES (
    'Ẩm thực Việt Nam - Vietnamese Cuisine',
    'Phở là món ăn truyền thống của Việt Nam. Phở rất ngon và thơm. Người Việt thường ăn phở vào buổi sáng. Ngoài phở, bánh mì cũng rất phổ biến. Bánh mì Việt Nam có nhiều loại nhân khác nhau. Cà phê Việt Nam nổi tiếng trên thế giới. Người ta thường uống cà phê sữa đá. Món ăn Việt Nam rất đa dạng và hấp dẫn.',
    'vi',
    '354f37b7-22bf-4cda-a969-1f2536c714a3',
    NOW(),
    NOW()
);

-- Text 3: Daily life in Vietnam
INSERT INTO texts (title, content, language, "userId", "createdAt", "updatedAt")
VALUES (
    'Cuộc sống hàng ngày - Daily Life',
    'Tôi thức dậy lúc sáu giờ sáng mỗi ngày. Sau đó, tôi đi tập thể dục ở công viên. Công viên rất đẹp và có nhiều cây xanh. Nhiều người già đi bộ và tập thể dục buổi sáng. Tôi về nhà lúc bảy giờ và ăn sáng. Gia đình tôi thường ăn phở hoặc bánh mì. Sau khi ăn sáng, tôi đi làm. Tôi làm việc ở công ty từ tám giờ đến năm giờ chiều.',
    'vi',
    '354f37b7-22bf-4cda-a969-1f2536c714a3',
    NOW(),
    NOW()
);

-- Text 4: About family
INSERT INTO texts (title, content, language, "userId", "createdAt", "updatedAt")
VALUES (
    'Gia đình tôi - My Family',
    'Gia đình tôi có năm người: bố, mẹ, anh trai, em gái và tôi. Bố tôi là bác sĩ, còn mẹ tôi là giáo viên. Anh trai tôi đang học đại học ở Hà Nội. Em gái tôi mới mười tuổi, em học lớp năm. Chúng tôi sống ở Sài Gòn. Vào cuối tuần, gia đình tôi thường đi chơi cùng nhau. Chúng tôi rất yêu thương nhau.',
    'vi',
    '354f37b7-22bf-4cda-a969-1f2536c714a3',
    NOW(),
    NOW()
);

-- Text 5: Vietnamese culture
INSERT INTO texts (title, content, language, "userId", "createdAt", "updatedAt")
VALUES (
    'Văn hóa Việt Nam - Vietnamese Culture',
    'Văn hóa Việt Nam rất phong phú và đa dạng. Tết Nguyên Đán là ngày lễ quan trọng nhất trong năm. Mọi người về quê đoàn tụ với gia đình. Họ nấu bánh chưng, bánh tét và các món ăn truyền thống. Trẻ em được nhận lì xì màu đỏ. Người Việt rất tôn trọng người già và thầy cô giáo. Áo dài là trang phục truyền thống của phụ nữ Việt Nam. Nó rất đẹp và thanh lịch.',
    'vi',
    '354f37b7-22bf-4cda-a969-1f2536c714a3',
    NOW(),
    NOW()
);

-- Insert Sample Vietnamese Vocabulary Entries
-- Common greetings
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt", "updatedAt")
VALUES 
    ('xin chào', 'hello; greetings', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('chào buổi sáng', 'good morning', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('cảm ơn', 'thank you; thanks', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('tạm biệt', 'goodbye; farewell', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('xin lỗi', 'sorry; excuse me', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW());

-- Common verbs
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt", "updatedAt")
VALUES 
    ('học', 'to study; to learn', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('làm', 'to do; to make; to work', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('đi', 'to go; to walk', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('ăn', 'to eat', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('uống', 'to drink', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('nói', 'to say; to speak; to tell', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('nghe', 'to hear; to listen', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('đọc', 'to read', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('viết', 'to write', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('hiểu', 'to understand', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW());

-- Common nouns
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt", "updatedAt")
VALUES 
    ('người', 'person; people; human', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('gia đình', 'family', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('bố', 'father; dad', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('mẹ', 'mother; mom', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('anh', 'older brother', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('chị', 'older sister', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('em', 'younger sibling', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('nhà', 'house; home', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('trường', 'school', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('sách', 'book', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW());

-- Food and drink
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt", "updatedAt")
VALUES 
    ('phở', 'Vietnamese noodle soup', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('bánh mì', 'Vietnamese sandwich; bread', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('cơm', 'rice; cooked rice; meal', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('cà phê', 'coffee', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('trà', 'tea', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('nước', 'water; juice', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('rau', 'vegetables', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('thịt', 'meat', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW());

-- Adjectives
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt", "updatedAt")
VALUES 
    ('đẹp', 'beautiful; pretty; handsome', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('tốt', 'good; well; fine', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('xấu', 'bad; ugly', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('lớn', 'big; large; great', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('nhỏ', 'small; little; tiny', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('nóng', 'hot', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('lạnh', 'cold', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('ngon', 'delicious; tasty', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('khỏe', 'healthy; well; strong', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW());

-- Colors
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt", "updatedAt")
VALUES 
    ('màu', 'color', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('đỏ', 'red', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('xanh', 'blue; green', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('vàng', 'yellow', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('trắng', 'white', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('đen', 'black', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW());

-- Numbers
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt", "updatedAt")
VALUES 
    ('một', 'one', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('hai', 'two', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('ba', 'three', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('bốn', 'four', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('năm', 'five', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('sáu', 'six', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('bảy', 'seven', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('tám', 'eight', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('chín', 'nine', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('mười', 'ten', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW());

-- Places and cities
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt", "updatedAt")
VALUES 
    ('Việt Nam', 'Vietnam', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('Hà Nội', 'Hanoi (capital city)', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('Sài Gòn', 'Saigon (Ho Chi Minh City)', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('thành phố', 'city', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('quê', 'countryside; hometown', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW());

-- Time expressions
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt", "updatedAt")
VALUES 
    ('hôm nay', 'today', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('ngày mai', 'tomorrow', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('hôm qua', 'yesterday', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('bây giờ', 'now', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('sáng', 'morning', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('trưa', 'noon; midday', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('chiều', 'afternoon', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW()),
    ('tối', 'evening; night', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW(), NOW());

-- Query to verify the data was inserted
SELECT 'Sample data insertion complete!' as status;
SELECT COUNT(*) as text_count FROM texts WHERE "userId" = '354f37b7-22bf-4cda-a969-1f2536c714a3' AND language = 'vi';
SELECT COUNT(*) as vocab_count FROM vocabentries WHERE "userId" = '354f37b7-22bf-4cda-a969-1f2536c714a3' AND language = 'vi';
