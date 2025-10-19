/**
 * Test Japanese Dictionary API
 * Tests the /api/vocabEntries/by-tokens endpoint with Japanese words
 */

const TEST_USER_ID = '354f37b7-22bf-4cda-a969-1f2536c714a3';
const API_BASE_URL = 'http://localhost:5000';

// Sample Japanese tokens to test
const sampleTokens = [
    '日本',      // nihon (Japan)
    'こんにちは',  // konnichiwa (hello)
    'ありがとう',  // arigatou (thank you)
    '食べる',     // taberu (to eat)
    '本',        // hon (book)
    '学校',      // gakkou (school)
    '先生'       // sensei (teacher)
];

async function testJapaneseDictionaryLookup() {
    console.log('🇯🇵 Testing Japanese Dictionary API');
    console.log('=====================================\n');
    
    console.log('📝 Test tokens:', sampleTokens);
    console.log('👤 User ID:', TEST_USER_ID);
    console.log('');
    
    try {
        // First, get a JWT token for the test user
        console.log('🔐 Logging in as test user...');
        const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: 'reader-vocab-test@example.com',
                password: 'TestPassword123!'
            })
        });
        
        if (!loginResponse.ok) {
            throw new Error(`Login failed: ${loginResponse.status}`);
        }
        
        const loginData = await loginResponse.json();
        const token = loginData.token;
        console.log('✅ Logged in successfully\n');
        
        // Now test the vocabulary lookup
        console.log('🔍 Testing /api/vocabEntries/by-tokens...');
        const startTime = Date.now();
        
        const response = await fetch(`${API_BASE_URL}/api/vocabEntries/by-tokens`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                tokens: sampleTokens
            })
        });
        
        const duration = Date.now() - startTime;
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API request failed: ${response.status} - ${errorData.error}`);
        }
        
        const data = await response.json();
        
        console.log(`✅ API Response received (${duration}ms)\n`);
        console.log('📊 Results:');
        console.log(`   Personal entries: ${data.personalEntries.length}`);
        console.log(`   Dictionary entries: ${data.dictionaryEntries.length}`);
        console.log('');
        
        // Show dictionary entries
        if (data.dictionaryEntries && data.dictionaryEntries.length > 0) {
            console.log('✨ Dictionary Entries Found:');
            data.dictionaryEntries.forEach((entry, i) => {
                console.log(`\n   ${i + 1}. ${entry.word1} (${entry.word2})`);
                console.log(`      Pronunciation: ${entry.pronunciation}`);
                console.log(`      Definitions: ${entry.definitions.slice(0, 3).join(', ')}`);
            });
            console.log('');
            console.log('🎉 SUCCESS! Japanese dictionary lookups are working!');
        } else {
            console.log('❌ FAILED: No dictionary entries returned');
            console.log('   This means the dictionary lookup is not working properly.');
        }
        
        // Show personal entries if any
        if (data.personalEntries && data.personalEntries.length > 0) {
            console.log(`\n📚 Personal Entries: ${data.personalEntries.length} found`);
        }
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

testJapaneseDictionaryLookup();
