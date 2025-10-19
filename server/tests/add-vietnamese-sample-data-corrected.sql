-- Add Sample Vietnamese Data for User 354f37b7-22bf-4cda-a969-1f2536c714a3
-- Corrected version with proper column names

-- First, set the user's language to Vietnamese
UPDATE users 
SET "selectedLanguage" = 'vi' 
WHERE id = '354f37b7-22bf-4cda-a969-1f2536c714a3';

-- Insert Sample Vietnamese Vocabulary Entries (vocab is user-specific)
-- Common greetings
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt")
VALUES 
    ('xin chào', 'hello; greetings', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('chào buổi sáng', 'good morning', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('cảm ơn', 'thank you; thanks', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('tạm biệt', 'goodbye; farewell', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('xin lỗi', 'sorry; excuse me', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW());

-- Common verbs
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt")
VALUES 
    ('học', 'to study; to learn', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('làm', 'to do; to make; to work', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('đi', 'to go; to walk', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('ăn', 'to eat', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('uống', 'to drink', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('nói', 'to say; to speak; to tell', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('nghe', 'to hear; to listen', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('đọc', 'to read', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('viết', 'to write', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('hiểu', 'to understand', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW());

-- Common nouns
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt")
VALUES 
    ('người', 'person; people; human', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('gia đình', 'family', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('bố', 'father; dad', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('mẹ', 'mother; mom', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('anh', 'older brother', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('chị', 'older sister', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('em', 'younger sibling', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('nhà', 'house; home', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('trường', 'school', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('sách', 'book', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW());

-- Food and drink
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt")
VALUES 
    ('phở', 'Vietnamese noodle soup', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('bánh mì', 'Vietnamese sandwich; bread', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('cơm', 'rice; cooked rice; meal', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('cà phê', 'coffee', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('trà', 'tea', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('nước', 'water; juice', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('rau', 'vegetables', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('thịt', 'meat', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW());

-- Adjectives
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt")
VALUES 
    ('đẹp', 'beautiful; pretty; handsome', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('tốt', 'good; well; fine', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('xấu', 'bad; ugly', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('lớn', 'big; large; great', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('nhỏ', 'small; little; tiny', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('nóng', 'hot', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('lạnh', 'cold', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('ngon', 'delicious; tasty', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('khỏe', 'healthy; well; strong', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW());

-- Colors
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt")
VALUES 
    ('màu', 'color', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('đỏ', 'red', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('xanh', 'blue; green', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('vàng', 'yellow', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('trắng', 'white', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('đen', 'black', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW());

-- Numbers
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt")
VALUES 
    ('một', 'one', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('hai', 'two', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('ba', 'three', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('bốn', 'four', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('năm', 'five', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('sáu', 'six', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('bảy', 'seven', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('tám', 'eight', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('chín', 'nine', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('mười', 'ten', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW());

-- Places and cities
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt")
VALUES 
    ('Việt Nam', 'Vietnam', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('Hà Nội', 'Hanoi (capital city)', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('Sài Gòn', 'Saigon (Ho Chi Minh City)', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('thành phố', 'city', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('quê', 'countryside; hometown', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW());

-- Time expressions
INSERT INTO vocabentries ("entryKey", "entryValue", language, "userId", "createdAt")
VALUES 
    ('hôm nay', 'today', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('ngày mai', 'tomorrow', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('hôm qua', 'yesterday', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('bây giờ', 'now', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('sáng', 'morning', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('trưa', 'noon; midday', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('chiều', 'afternoon', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW()),
    ('tối', 'evening; night', 'vi', '354f37b7-22bf-4cda-a969-1f2536c714a3', NOW());

-- Insert Sample Vietnamese Texts (note: texts table doesn't have userId)
-- Text 1: Simple greeting
INSERT INTO texts (id, title, content, language, "characterCount", "createdAt")
VALUES (
    gen_random_uuid()::varchar(50),
    'Lời chào đơn giản - Simple Greetings',
    'Xin chào! Tôi tên là Mai. Tôi là sinh viên. Tôi học tiếng Anh ở trường đại học. Hôm nay là một ngày đẹp trời. Tôi rất vui được gặp bạn. Bạn khỏe không? Tôi khỏe, cảm ơn bạn. Chúng ta cùng đi uống cà phê nhé!',
    'vi',
    length('Xin chào! Tôi tên là Mai. Tôi là sinh viên. Tôi học tiếng Anh ở trường đại học. Hôm nay là một ngày đẹp trời. Tôi rất vui được gặp bạn. Bạn khỏe không? Tôi khỏe, cảm ơn bạn. Chúng ta cùng đi uống cà phê nhé!'),
    NOW()
);

-- Text 2: Vietnamese food
INSERT INTO texts (id, title, content, language, "characterCount", "createdAt")
VALUES (
    gen_random_uuid()::varchar(50),
    'Ẩm thực Việt Nam - Vietnamese Cuisine',
    'Phở là món ăn truyền thống của Việt Nam. Phở rất ngon và thơm. Người Việt thường ăn phở vào buổi sáng. Ngoài phở, bánh mì cũng rất phổ biến. Bánh mì Việt Nam có nhiều loại nhân khác nhau. Cà phê Việt Nam nổi tiếng trên thế giới. Người ta thường uống cà phê sữa đá. Món ăn Việt Nam rất đa dạng và hấp dẫn.',
    'vi',
    length('Phở là món ăn truyền thống của Việt Nam. Phở rất ngon và thơm. Người Việt thường ăn phở vào buổi sáng. Ngoài phở, bánh mì cũng rất phổ biến. Bánh mì Việt Nam có nhiều loại nhân khác nhau. Cà phê Việt Nam nổi tiếng trên thế giới. Người ta thường uống cà phê sữa đá. Món ăn Việt Nam rất đa dạng và hấp dẫn.'),
    NOW()
);

-- Text 3: Daily life
INSERT INTO texts (id, title, content, language, "characterCount", "createdAt")
VALUES (
    gen_random_uuid()::varchar(50),
    'Cuộc sống hàng ngày - Daily Life',
    'Tôi thức dậy lúc sáu giờ sáng mỗi ngày. Sau đó, tôi đi tập thể dục ở công viên. Công viên rất đẹp và có nhiều cây xanh. Nhiều người già đi bộ và tập thể dục buổi sáng. Tôi về nhà lúc bảy giờ và ăn sáng. Gia đình tôi thường ăn phở hoặc bánh mì. Sau khi ăn sáng, tôi đi làm. Tôi làm việc ở công ty từ tám giờ đến năm giờ chiều.',
    'vi',
    length('Tôi thức dậy lúc sáu giờ sáng mỗi ngày. Sau đó, tôi đi tập thể dục ở công viên. Công viên rất đẹp và có nhiều cây xanh. Nhiều người già đi bộ và tập thể dục buổi sáng. Tôi về nhà lúc bảy giờ và ăn sáng. Gia đình tôi thường ăn phở hoặc bánh mì. Sau khi ăn sáng, tôi đi làm. Tôi làm việc ở công ty từ tám giờ đến năm giờ chiều.'),
    NOW()
);

-- Text 4: About family
INSERT INTO texts (id, title, content, language, "characterCount", "createdAt")
VALUES (
    gen_random_uuid()::varchar(50),
    'Gia đình tôi - My Family',
    'Gia đình tôi có năm người: bố, mẹ, anh trai, em gái và tôi. Bố tôi là bác sĩ, còn mẹ tôi là giáo viên. Anh trai tôi đang học đại học ở Hà Nội. Em gái tôi mới mười tuổi, em học lớp năm. Chúng tôi sống ở Sài Gòn. Vào cuối tuần, gia đình tôi thường đi chơi cùng nhau. Chúng tôi rất yêu thương nhau.',
    'vi',
    length('Gia đình tôi có năm người: bố, mẹ, anh trai, em gái và tôi. Bố tôi là bác sĩ, còn mẹ tôi là giáo viên. Anh trai tôi đang học đại học ở Hà Nội. Em gái tôi mới mười tuổi, em học lớp năm. Chúng tôi sống ở Sài Gòn. Vào cuối tuần, gia đình tôi thường đi chơi cùng nhau. Chúng tôi rất yêu thương nhau.'),
    NOW()
);

-- Text 5: Vietnamese culture
INSERT INTO texts (id, title, content, language, "characterCount", "createdAt")
VALUES (
    gen_random_uuid()::varchar(50),
    'Văn hóa Việt Nam - Vietnamese Culture',
    'Văn hóa Việt Nam rất phong phú và đa dạng. Tết Nguyên Đán là ngày lễ quan trọng nhất trong năm. Mọi người về quê đoàn tụ với gia đình. Họ nấu bánh chưng, bánh tét và các món ăn truyền thống. Trẻ em được nhận lì xì màu đỏ. Người Việt rất tôn trọng người già và thầy cô giáo. Áo dài là trang phục truyền thống của phụ nữ Việt Nam. Nó rất đẹp và thanh lịch.',
    'vi',
    length('Văn hóa Việt Nam rất phong phú và đa dạng. Tết Nguyên Đán là ngày lễ quan trọng nhất trong năm. Mọi người về quê đoàn tụ với gia đình. Họ nấu bánh chưng, bánh tét và các món ăn truyền thống. Trẻ em được nhận lì xì màu đỏ. Người Việt rất tôn trọng người già và thầy cô giáo. Áo dài là trang phục truyền thống của phụ nữ Việt Nam. Nó rất đẹp và thanh lịch.'),
    NOW()
);

-- Verification queries
SELECT 'Sample data insertion complete!' as status;
SELECT COUNT(*) as text_count FROM texts WHERE language = 'vi';
SELECT COUNT(*) as vocab_count FROM vocabentries WHERE "userId" = '354f37b7-22bf-4cda-a969-1f2536c714a3' AND language = 'vi';
