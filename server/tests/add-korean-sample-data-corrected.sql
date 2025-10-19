-- Add Korean Sample Vocabulary Cards and Texts
-- User ID: 354f37b7-22bf-4cda-a969-1f2536c714a3

-- First, set the user's selected language to Korean
UPDATE users 
SET "selectedLanguage" = 'ko' 
WHERE id = '354f37b7-22bf-4cda-a969-1f2536c714a3';

-- Add Sample Korean Vocabulary Cards
-- Note: VocabEntries uses entryKey (the word) and entryValue (definition/notes)
INSERT INTO vocabentries ("userId", "entryKey", "entryValue", language, "createdAt")
VALUES 
  -- Basic Greetings
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '안녕하세요', 'Hello (formal) - annyeonghaseyo - Most common greeting', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '감사합니다', 'Thank you (formal) - gamsahamnida - Use in polite situations', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '안녕', 'Hi / Bye (informal) - annyeong - Use with friends', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '네', 'Yes - ne - Polite affirmative', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '아니요', 'No - aniyo - Polite negative', 'ko', NOW()),
  
  -- Common Nouns
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '학생', 'student - haksaeng - 學生 (hanja)', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '선생님', 'teacher - seonsaengnim - Honorific title', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '친구', 'friend - chingu - 親舊 (hanja)', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '가족', 'family - gajok - 家族 (hanja)', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '음식', 'food - eumsik - 飮食 (hanja)', 'ko', NOW()),
  
  -- Learning & Education
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '한국어', 'Korean language - hangugeo - 韓國語 (hanja)', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '공부', 'study - gongbu - 工夫 (hanja)', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '도서관', 'library - doseogwan - 圖書館 (hanja)', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '책', 'book - chaek - 冊 (hanja)', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '학교', 'school - hakgyo - 學校 (hanja)', 'ko', NOW()),
  
  -- Verbs & Actions
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '좋아하다', 'to like - joahada - Common verb', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '먹다', 'to eat - meokda - Irregular verb', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '가다', 'to go - gada - Basic movement', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '오다', 'to come - oda - Basic movement', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '배우다', 'to learn - baeuda - 學 (hanja root)', 'ko', NOW()),
  
  -- Emotions & States
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '사랑', 'love - sarang - Noun and verb stem', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '행복', 'happiness - haengbok - 幸福 (hanja)', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '즐겁다', 'to be fun/enjoyable - jeulgeopda', 'ko', NOW()),
  
  -- Places & Travel
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '한국', 'Korea - hanguk - 韓國 (hanja)', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '서울', 'Seoul - seoul - Capital city', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '여행', 'travel - yeohaeng - 旅行 (hanja)', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '집', 'house/home - jip - Basic noun', 'ko', NOW()),
  
  -- Time & Daily Life
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '시간', 'time - sigan - 時間 (hanja)', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '오늘', 'today - oneul - Time word', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '내일', 'tomorrow - naeil - Time word', 'ko', NOW()),
  
  -- Culture & Society
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '문화', 'culture - munhwa - 文化 (hanja)', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '회사', 'company - hoesa - 會社 (hanja)', 'ko', NOW());

-- Add Sample Korean Texts for the Reader
-- Note: Texts table needs id, title, content, language, characterCount
INSERT INTO texts (id, title, content, language, "characterCount", description, "createdAt")
VALUES 
  -- Text 1: Simple Introduction
  ('ko-intro-001', 
   '자기소개 (Self Introduction)', 
   '안녕하세요! 저는 한국어 학생입니다. 저는 한국 문화에 관심이 많습니다. 매일 한국어를 공부합니다.

한국 음식을 정말 좋아합니다. 특히 김치와 비빔밥을 좋아합니다. 제 친구들도 한국 음식을 좋아합니다.

저는 도서관에서 자주 공부합니다. 도서관은 조용하고 편안합니다. 선생님께서 도서관 공부를 추천하셨습니다.

내년에 한국으로 여행을 가고 싶습니다. 한국의 역사와 문화를 배우고 싶습니다. 한국 사람들과 친구가 되고 싶습니다.

감사합니다!', 
   'ko',
   168,
   'Beginner level self-introduction in Korean',
   NOW()),
  
  -- Text 2: Daily Life
  ('ko-daily-002', 
   '하루 일과 (Daily Routine)', 
   '저는 아침 7시에 일어납니다. 먼저 샤워를 하고 아침을 먹습니다. 보통 밥과 김치를 먹습니다.

8시에 학교에 갑니다. 학교까지 30분 걸립니다. 버스를 타고 갑니다. 학교에서 친구들을 만납니다.

오전에는 한국어 수업이 있습니다. 우리 선생님은 매우 친절하십니다. 수업이 끝나면 점심을 먹습니다.

오후에는 도서관에서 공부합니다. 숙제를 하고 책을 읽습니다. 때때로 친구와 같이 공부합니다.

저녁 6시에 집에 돌아옵니다. 가족과 저녁을 먹습니다. 저녁 후에 TV를 보거나 음악을 듣습니다.

밤 11시에 잠을 잡니다. 내일도 좋은 하루가 되기를 바랍니다!', 
   'ko',
   265,
   'Description of a typical daily routine',
   NOW()),
  
  -- Text 3: Korean Food
  ('ko-food-003', 
   '한국 음식 (Korean Food)', 
   '한국 음식은 세계적으로 유명합니다. 김치는 한국의 대표적인 음식입니다. 김치는 배추와 여러 가지 양념으로 만듭니다.

비빔밥도 인기가 많습니다. 비빔밥은 밥 위에 여러 가지 채소와 고기를 올려서 먹습니다. 고추장과 함께 비벼 먹으면 맛있습니다.

불고기는 달콤한 간장 소스에 재운 고기입니다. 구워서 먹으면 정말 맛있습니다. 외국인들도 불고기를 좋아합니다.

떡볶이는 떡과 어묵을 매운 소스에 볶은 음식입니다. 학생들이 특히 좋아하는 간식입니다.

한국 음식은 건강에 좋습니다. 채소가 많이 들어가고 발효 음식이 많습니다. 여러분도 한국 음식을 꼭 드셔 보세요!', 
   'ko',
   256,
   'Introduction to popular Korean dishes',
   NOW()),
  
  -- Text 4: Seoul
  ('ko-seoul-004', 
   '서울 여행 (Seoul Travel)', 
   '서울은 한국의 수도입니다. 인구가 약 천만 명입니다. 서울에는 볼 것이 정말 많습니다.

경복궁은 조선 시대의 왕궁입니다. 아름다운 전통 건물들이 많습니다. 한복을 입고 구경하면 입장료가 무료입니다.

명동은 쇼핑의 천국입니다. 화장품 가게와 옷 가게가 많습니다. 맛있는 음식점도 많이 있습니다.

남산 타워에서는 서울 전체를 볼 수 있습니다. 특히 밤 경치가 아름답습니다. 많은 연인들이 사랑의 자물쇠를 걸어 놓습니다.

강남은 현대적인 지역입니다. 높은 빌딩과 큰 회사들이 많습니다. K-pop 엔터테인먼트 회사들도 강남에 있습니다.

서울은 전통과 현대가 조화를 이루는 멋진 도시입니다!', 
   'ko',
   287,
   'Tourist guide to Seoul attractions',
   NOW()),
  
  -- Text 5: Learning Korean
  ('ko-learning-005', 
   '한국어 공부 (Studying Korean)', 
   '한국어를 배우는 것은 어렵지만 재미있습니다. 한글은 배우기 쉬운 문자입니다. 세종대왕께서 만드신 과학적인 문자입니다.

발음이 중요합니다. 매일 듣기 연습을 하는 것이 좋습니다. K-드라마나 K-pop을 보면서 공부할 수 있습니다.

문법은 조금 복잡합니다. 존댓말과 반말을 구별해야 합니다. 하지만 계속 연습하면 익숙해집니다.

단어를 많이 외워야 합니다. 매일 새로운 단어를 배우는 것이 중요합니다. 플래시카드를 사용하면 도움이 됩니다.

한국 친구를 사귀면 더 빨리 배울 수 있습니다. 실제로 말하는 연습을 많이 하세요. 실수를 두려워하지 마세요!

포기하지 말고 계속 노력하세요. 한국어를 마스터할 수 있습니다!', 
   'ko',
   301,
   'Tips for learning Korean language',
   NOW());

-- Verify the data was inserted
SELECT 'Vocab Entries:', COUNT(*) as count FROM vocabentries WHERE "userId" = '354f37b7-22bf-4cda-a969-1f2536c714a3' AND language = 'ko';
SELECT 'Korean Texts:', COUNT(*) as count FROM texts WHERE language = 'ko' AND id LIKE 'ko-%';
SELECT 'User Language:', "selectedLanguage" FROM users WHERE id = '354f37b7-22bf-4cda-a969-1f2536c714a3';
