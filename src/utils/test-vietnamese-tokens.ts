/**
 * Test script to verify Vietnamese tokenization
 */

import { extractNonEnglishTokens, processDocumentForTokens } from './tokenUtils';

console.log('🧪 Testing Vietnamese Tokenization\n');

// Test 1: Simple Vietnamese text
const vietnameseText1 = 'Xin chào! Tôi tên là Mai. Tôi học tiếng Việt.';
console.log('Test 1: Simple Vietnamese text');
console.log('Input:', vietnameseText1);
const tokens1 = extractNonEnglishTokens(vietnameseText1);
console.log('Extracted tokens:', tokens1);
console.log('Token count:', tokens1.length);
console.log('');

// Test 2: Vietnamese food text
const vietnameseText2 = 'Phở là món ăn truyền thống. Cà phê Việt Nam rất ngon.';
console.log('Test 2: Vietnamese food text');
console.log('Input:', vietnameseText2);
const tokens2 = extractNonEnglishTokens(vietnameseText2);
console.log('Extracted tokens:', tokens2);
console.log('Token count:', tokens2.length);
console.log('');

// Test 3: Full document processing
const vietnameseDocument = `Gia đình tôi có năm người: bố, mẹ, anh trai, em gái và tôi. 
Bố tôi là bác sĩ, còn mẹ tôi là giáo viên. 
Chúng tôi sống ở Sài Gòn. Vào cuối tuần, gia đình tôi thường đi chơi cùng nhau.`;

console.log('Test 3: Full document processing');
console.log('Input:', vietnameseDocument.substring(0, 100) + '...');
const processedTokens = processDocumentForTokens(vietnameseDocument);
console.log('Processed tokens (first 20):', processedTokens.slice(0, 20));
console.log('Total unique tokens:', processedTokens.length);
console.log('');

// Test 4: Mixed text (should still work for Vietnamese)
const mixedText = 'Hello xin chào world cảm ơn!';
console.log('Test 4: Mixed Vietnamese-English text');
console.log('Input:', mixedText);
const tokens4 = extractNonEnglishTokens(mixedText);
console.log('Extracted tokens:', tokens4);
console.log('(Should extract Vietnamese words only)');
console.log('');

// Test 5: Chinese text (should NOT use Vietnamese extraction)
const chineseText = '这是中文文本。今天天气很好。';
console.log('Test 5: Chinese text (should use character-based extraction)');
console.log('Input:', chineseText);
const tokens5 = extractNonEnglishTokens(chineseText);
console.log('Extracted tokens (first 10):', tokens5.slice(0, 10));
console.log('Token count:', tokens5.length);
console.log('(Should extract individual Chinese characters)');
console.log('');

console.log('✅ Vietnamese tokenization test complete!');
