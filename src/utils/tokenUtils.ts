/**
 * Token processing utilities for vocabulary lookup in reader documents
 * Handles extraction of non-English characters and generation of token combinations
 */

/**
 * Detects if text contains Vietnamese diacritical marks
 */
function hasVietnameseDiacritics(text: string): boolean {
  // Vietnamese diacritical marks pattern
  const vietnameseDiacritics = /[áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/i;
  return vietnameseDiacritics.test(text);
}

/**
 * Extracts Vietnamese words from text
 * Vietnamese uses space-separated words with Latin alphabet + diacritical marks
 */
function extractVietnameseTokens(text: string): string[] {
  if (!text) return [];
  
  // Pattern to match Vietnamese words (letters with diacritics + đ)
  const vietnameseWordPattern = /[a-záàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]+/gi;
  
  const matches = text.match(vietnameseWordPattern);
  return matches || [];
}

/**
 * Extracts non-English characters from text
 * Includes Chinese, Japanese, Korean, and other non-Latin scripts
 * Excludes English letters, numbers, spaces, and punctuation
 */
export function extractNonEnglishTokens(text: string): string[] {
  if (!text) return [];

  // Check if text contains Vietnamese diacritical marks
  if (hasVietnameseDiacritics(text)) {
    // Use word-based extraction for Vietnamese
    return extractVietnameseTokens(text);
  }

  // Regular expression to match non-English characters
  // Includes: Chinese (Han), Japanese (Hiragana, Katakana), Korean (Hangul), 
  // and other non-Latin scripts while excluding English letters, numbers, spaces, punctuation
  const nonEnglishRegex = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Thai}\p{Script=Devanagari}]/gu;
  
  const matches = text.match(nonEnglishRegex);
  return matches || [];
}

/**
 * Generates all possible token combinations of specified lengths from a character array
 * @param tokens Array of individual characters/tokens
 * @param maxLength Maximum length of token combinations (default: 4)
 * @returns Set of unique token combinations
 */
export function generateTokenCombinations(tokens: string[], maxLength: number = 4): Set<string> {
  const combinations = new Set<string>();
  
  if (!tokens || tokens.length === 0) return combinations;

  // Generate combinations of length 1 to maxLength
  for (let length = 1; length <= maxLength; length++) {
    for (let i = 0; i <= tokens.length - length; i++) {
      const combination = tokens.slice(i, i + length).join('');
      if (combination.trim()) { // Only add non-empty combinations
        combinations.add(combination);
      }
    }
  }

  return combinations;
}

/**
 * Processes a document text to extract all relevant token combinations
 * @param documentText The full text of the document
 * @returns Array of unique tokens for vocabulary lookup
 */
export function processDocumentForTokens(documentText: string): string[] {
  // Extract non-English characters/words
  const nonEnglishTokens = extractNonEnglishTokens(documentText);
  
  // Check if text is Vietnamese (word-based) or character-based (Chinese/Japanese/Korean)
  if (hasVietnameseDiacritics(documentText)) {
    // Vietnamese: Return unique words directly (no character combinations)
    const uniqueWords = Array.from(new Set(nonEnglishTokens.map(word => word.toLowerCase())));
    
    // Sort by length (longer words first for better matching)
    return uniqueWords.sort((a, b) => {
      if (a.length !== b.length) {
        return b.length - a.length;
      }
      return a.localeCompare(b);
    });
  }
  
  // For character-based languages (Chinese, Japanese, Korean, etc.)
  // Generate token combinations (1-4 characters)
  const tokenCombinations = generateTokenCombinations(nonEnglishTokens, 4);
  
  // Convert Set to Array and sort by length (longer tokens first for better matching)
  return Array.from(tokenCombinations).sort((a, b) => {
    if (a.length !== b.length) {
      return b.length - a.length; // Longer tokens first
    }
    return a.localeCompare(b); // Alphabetical for same length
  });
}

/**
 * Validates if a character is considered a non-English token
 * @param char Single character to validate
 * @returns boolean indicating if character should be processed as a token
 */
export function isNonEnglishToken(char: string): boolean {
  if (!char || char.length !== 1) return false;
  
  // Check if character matches our non-English criteria
  const nonEnglishRegex = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Thai}\p{Script=Devanagari}]/u;
  return nonEnglishRegex.test(char);
}

/**
 * Estimates the number of tokens that will be generated from a document
 * Useful for performance considerations and user feedback
 * @param documentText The document text to analyze
 * @returns Estimated token count
 */
export function estimateTokenCount(documentText: string): number {
  const nonEnglishTokens = extractNonEnglishTokens(documentText);
  const uniqueChars = new Set(nonEnglishTokens).size;
  
  // Estimate based on combination formula for different lengths
  // This is an approximation - actual count may vary
  let estimate = 0;
  const maxLength = Math.min(4, uniqueChars);
  
  for (let length = 1; length <= maxLength; length++) {
    // Approximate number of combinations of given length
    estimate += Math.max(0, nonEnglishTokens.length - length + 1);
  }
  
  return estimate;
}
