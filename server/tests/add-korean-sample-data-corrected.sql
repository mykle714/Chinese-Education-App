-- Add Korean Sample Vocabulary Cards and Texts
-- User ID: 354f37b7-22bf-4cda-a969-1f2536c714a3

-- First, set the user's selected language to Korean
UPDATE users 
SET "selectedLanguage" = 'ko' 
WHERE id = '354f37b7-22bf-4cda-a969-1f2536c714a3';

-- Add Sample Korean Vocabulary Cards
-- Note: VocabEntries stores only the word (entryKey); definitions are joined from dictionaryentries at read time.
INSERT INTO vocabentries ("userId", "entryKey", language, "createdAt")
VALUES 
  -- Basic Greetings
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '안녕하세요', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '감사합니다', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '안녕', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '네', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '아니요', 'ko', NOW()),
  
  -- Common Nouns
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '학생', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '선생님', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '친구', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '가족', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '음식', 'ko', NOW()),
  
  -- Learning & Education
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '한국어', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '공부', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '도서관', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '책', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '학교', 'ko', NOW()),
  
  -- Verbs & Actions
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '좋아하다', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '먹다', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '가다', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '오다', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '배우다', 'ko', NOW()),
  
  -- Emotions & States
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '사랑', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '행복', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '즐겁다', 'ko', NOW()),
  
  -- Places & Travel
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '한국', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '서울', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '여행', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '집', 'ko', NOW()),
  
  -- Time & Daily Life
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '시간', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '오늘', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '내일', 'ko', NOW()),
  
  -- Culture & Society
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '문화', 'ko', NOW()),
  ('354f37b7-22bf-4cda-a969-1f2536c714a3', '회사', 'ko', NOW());

-- Add Sample Korean Texts for the Reader
-- Note: Texts table needs id, title, content, language, characterCount
INSERT INTO texts (id, title, content, language, "characterCount", description, "createdAt")
VALUES 
  -- Text 1: Simple Introduction
  ('ko-intro-001', 
   '자기소개 (Self Introduction)', 
   'ko',
   168,
   'Beginner level self-introduction in Korean',
   NOW()),
  
  -- Text 2: Daily Life
  ('ko-daily-002', 
   '하루 일과 (Daily Routine)', 
   'ko',
   265,
   'Description of a typical daily routine',
   NOW()),
  
  -- Text 3: Korean Food
  ('ko-food-003', 
   '한국 음식 (Korean Food)', 
   'ko',
   256,
   'Introduction to popular Korean dishes',
   NOW()),
  
  -- Text 4: Seoul
  ('ko-seoul-004', 
   '서울 여행 (Seoul Travel)', 
   'ko',
   287,
   'Tourist guide to Seoul attractions',
   NOW()),
  
  -- Text 5: Learning Korean
  ('ko-learning-005', 
   '한국어 공부 (Studying Korean)', 
   'ko',
   301,
   'Tips for learning Korean language',
   NOW());

-- Verify the data was inserted
SELECT 'Vocab Entries:', COUNT(*) as count FROM vocabentries WHERE "userId" = '354f37b7-22bf-4cda-a969-1f2536c714a3' AND language = 'ko';
SELECT 'Korean Texts:', COUNT(*) as count FROM texts WHERE language = 'ko' AND id LIKE 'ko-%';
SELECT 'User Language:', "selectedLanguage" FROM users WHERE id = '354f37b7-22bf-4cda-a969-1f2536c714a3';
