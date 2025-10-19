/**
 * Test Vietnamese Dictionary API
 * Tests the Vietnamese dictionary lookup functionality
 */

const API_BASE_URL = 'http://localhost:5000';

const sampleTokens = [
    'xin chào',    // hello
    'cảm ơn',      // thank you
    'người',       // person
    'nước',        // water/country
    'đẹp',         // beautiful
    'yêu',         // love
    'Việt Nam',    // Vietnam
    'phở',         // pho
    'cà phê',      // coffee
    'học'          // study
];

async function testVietnameseDictionary() {
    console.log('🇻🇳 Testing Vietnamese Dictionary API');
    console.log('=====================================\n');
    
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
        console.log('✅ Logged in successfully\n');
        
        // Test vocabulary lookup
        console.log('🔍 Testing /api/vocabEntries/by-tokens with Vietnamese words...');
        console.log(`   Tokens: ${sampleTokens.join(', ')}\n`);
        
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
            console.log('✨ Sample Vietnamese Dictionary Entries:\n');
            data.dictionaryEntries.forEach((entry, i) => {
                console.log(`   ${i + 1}. ${entry.word1}`);
                if (entry.word2) {
                    console.log(`      Secondary: ${entry.word2}`);
                }
                if (entry.pronunciation) {
                    console.log(`      Pronunciation: ${entry.pronunciation}`);
                }
                console.log(`      Definitions: ${entry.definitions.join(', ')}`);
                console.log('');
            });
            
            console.log('🎉 SUCCESS! Vietnamese dictionary lookups are working!');
            console.log(`\n✅ Retrieved ${data.dictionaryEntries.length} Vietnamese entries`);
            
            // Check for proper encoding
            const hasProperDiacritics = data.dictionaryEntries.some(entry => 
                /[áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/i.test(entry.word1)
            );
            
            if (hasProperDiacritics) {
                console.log('✅ Diacritical marks are preserved correctly');
            } else {
                console.log('⚠️  Warning: No diacritical marks detected in results');
            }
            
        } else {
            console.log('❌ FAILED: No dictionary entries returned');
            console.log('   This could mean:');
            console.log('   - Dictionary entries were not imported');
            console.log('   - API is not querying Vietnamese entries correctly');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
        process.exit(1);
    }
}

// Run the test
testVietnameseDictionary();
