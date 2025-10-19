/**
 * Test Korean Dictionary API
 * Tests dictionary lookup functionality for Korean language support
 */

const API_BASE_URL = 'http://localhost:5000';

const sampleTokens = [
    '학생',      // student
    '한국',      // Korea
    '선생님',    // teacher
    '사랑',      // love
    '친구'       // friend
];

async function testKoreanDictionaryLookup() {
    console.log('🌐 Testing Korean Dictionary API');
    console.log('=================================\n');
    
    try {
        // Login
        console.log('🔐 Logging in...');
        const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
        console.log('✅ Logged in\n');
        
        // Test vocabulary lookup
        console.log('🔍 Testing /api/vocabEntries/by-tokens...');
        console.log(`   Sample tokens: ${sampleTokens.join(', ')}\n`);
        
        const response = await fetch(`${API_BASE_URL}/api/vocabEntries/by-tokens`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ tokens: sampleTokens })
        });
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }
        
        const data = await response.json();
        
        console.log('📊 Results:');
        console.log(`   Personal entries: ${data.personalEntries.length}`);
        console.log(`   Dictionary entries: ${data.dictionaryEntries.length}\n`);
        
        if (data.dictionaryEntries.length > 0) {
            console.log('✨ Sample Korean Dictionary Entries:');
            data.dictionaryEntries.slice(0, 5).forEach((entry, i) => {
                console.log(`\n   ${i + 1}. ${entry.word1}${entry.word2 ? ` (${entry.word2})` : ''}`);
                if (entry.pronunciation) {
                    console.log(`      Pronunciation: ${entry.pronunciation}`);
                }
                console.log(`      Definitions: ${entry.definitions.slice(0, 3).join(', ')}`);
            });
            console.log('\n🎉 SUCCESS! Korean dictionary lookups are working!');
            console.log(`\n📈 Statistics:`);
            console.log(`   Tokens requested: ${sampleTokens.length}`);
            console.log(`   Dictionary matches found: ${data.dictionaryEntries.length}`);
            console.log(`   Match rate: ${Math.round((data.dictionaryEntries.length / sampleTokens.length) * 100)}%`);
        } else {
            console.log('⚠️  WARNING: No dictionary entries returned');
            console.log('   This may indicate the dictionary is not properly loaded');
            console.log('   or the sample tokens do not exist in the dictionary');
        }
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        if (error.stack) {
            console.error('\nStack trace:', error.stack);
        }
        process.exit(1);
    }
}

testKoreanDictionaryLookup();
