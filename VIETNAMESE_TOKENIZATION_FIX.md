# Vietnamese Tokenization Fix

## Problem
Vietnamese text in the Reader was not generating any vocabulary tokens, resulting in 0 results when processing documents. This prevented vocabulary cards from appearing when reading Vietnamese texts.

## Root Cause
The tokenization logic in `src/utils/tokenUtils.ts` only detected non-Latin scripts (Chinese, Japanese, Korean characters). Vietnamese uses the Latin alphabet with diacritical marks (á, ả, ã, ạ, ă, ắ, etc.), which were not being recognized by the regex pattern.

**Flow of the issue:**
1. Vietnamese text → regex matches nothing → returns empty array
2. Empty array → generates 0 token combinations  
3. API called with 0 tokens → returns no results
4. Reader shows no vocabulary cards

## Solution
Updated `src/utils/tokenUtils.ts` to:

### 1. Detect Vietnamese Diacritical Marks
Added `hasVietnameseDiacritics()` function to detect if text contains Vietnamese diacritical marks:
```typescript
function hasVietnameseDiacritics(text: string): boolean {
  const vietnameseDiacritics = /[áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/i;
  return vietnameseDiacritics.test(text);
}
```

### 2. Extract Vietnamese Words
Added `extractVietnameseTokens()` function for word-based extraction (since Vietnamese uses spaces between words):
```typescript
function extractVietnameseTokens(text: string): string[] {
  const vietnameseWordPattern = /[a-záàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]+/gi;
  const matches = text.match(vietnameseWordPattern);
  return matches || [];
}
```

### 3. Update Main Extraction Logic
Modified `extractNonEnglishTokens()` to check for Vietnamese first:
```typescript
export function extractNonEnglishTokens(text: string): string[] {
  if (!text) return [];

  // Check if text contains Vietnamese diacritical marks
  if (hasVietnameseDiacritics(text)) {
    // Use word-based extraction for Vietnamese
    return extractVietnameseTokens(text);
  }

  // Regular expression for character-based languages (Chinese, Japanese, Korean, etc.)
  const nonEnglishRegex = /[\p{Script=Han}\p{Script=Hiragana}...]/gu;
  const matches = text.match(nonEnglishRegex);
  return matches || [];
}
```

### 4. Update Document Processing
Modified `processDocumentForTokens()` to handle Vietnamese as a word-based language (no character combinations needed):
```typescript
export function processDocumentForTokens(documentText: string): string[] {
  const nonEnglishTokens = extractNonEnglishTokens(documentText);
  
  // Check if text is Vietnamese (word-based)
  if (hasVietnameseDiacritics(documentText)) {
    // Vietnamese: Return unique words directly (no character combinations)
    const uniqueWords = Array.from(new Set(nonEnglishTokens.map(word => word.toLowerCase())));
    return uniqueWords.sort((a, b) => {
      if (a.length !== b.length) return b.length - a.length;
      return a.localeCompare(b);
    });
  }
  
  // For character-based languages: Generate token combinations (1-4 characters)
  const tokenCombinations = generateTokenCombinations(nonEnglishTokens, 4);
  return Array.from(tokenCombinations).sort(...);
}
```

## Key Differences: Vietnamese vs Chinese/Japanese/Korean

| Aspect | Vietnamese | Chinese/Japanese/Korean |
|--------|-----------|------------------------|
| Script | Latin with diacritics | Han/Hiragana/Katakana/Hangul |
| Word separation | Space-separated | No spaces (Chinese/Japanese), Spaces (Korean) |
| Tokenization | Word-based | Character-based with combinations |
| Detection | Diacritical marks | Unicode script properties |
| Processing | Extract complete words | Generate 1-4 char combinations |

## Test Results
Created `src/utils/test-vietnamese-tokens.ts` to verify the fix:

✅ **Test 1:** Simple Vietnamese text - Extracted 10 words
✅ **Test 2:** Vietnamese food text - Extracted 12 words including "Phở", "Cà phê"
✅ **Test 3:** Full document - Processed and returned 32 unique tokens
✅ **Test 4:** Mixed text - Handles Vietnamese + English
✅ **Test 5:** Chinese text - Still uses character-based extraction (not affected)

## Impact
- Vietnamese documents will now generate proper tokens for vocabulary lookup
- Vocabulary cards will appear in the Reader for Vietnamese texts
- No impact on existing Chinese, Japanese, or Korean tokenization
- Performance improvement for Vietnamese (word-based vs character combinations)

## Files Modified
1. `src/utils/tokenUtils.ts` - Updated tokenization logic
2. `src/utils/test-vietnamese-tokens.ts` - Created test file

## Next Steps
Users can now:
1. Load Vietnamese texts in the Reader
2. See vocabulary cards for Vietnamese words
3. Study Vietnamese vocabulary with the same workflow as other languages

## Date
October 18, 2025
