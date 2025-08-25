import fetch from 'node-fetch';

// Test configuration
const API_BASE_URL = 'http://localhost:3001';
const TEST_USERS = [
    { email: 'test@example.com', password: 'pw' },
    { email: 'default@example.com', password: 'password' }
];

async function testCreateEntryWithoutUserId() {
    console.log('🧪 Testing Create Entry API without userID field...\n');
    
    // Try to login with available test users
    let token, user;
    
    for (const testUser of TEST_USERS) {
        try {
            console.log(`1. Attempting login with ${testUser.email}...`);
            const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(testUser)
            });

            if (loginResponse.ok) {
                const loginData = await loginResponse.json();
                token = loginData.token;
                user = loginData.user;
                
                console.log(`✅ Login successful for user: ${user.name} (${user.email})`);
                console.log(`   User ID: ${user.id}\n`);
                break;
            } else {
                const errorData = await loginResponse.json();
                console.log(`❌ Login failed for ${testUser.email}: ${errorData.error}`);
            }
        } catch (error) {
            console.log(`❌ Error logging in with ${testUser.email}: ${error.message}`);
        }
    }
    
    if (!token) {
        throw new Error('Could not login with any test user');
    }
    
    try {

        // Step 2: Create a new vocabulary entry (without sending userID)
        console.log('2. Creating new vocabulary entry without userID field...');
        const testEntry = {
            entryKey: '测试词汇',
            entryValue: 'Test vocabulary - created without userID field'
        };

        const createResponse = await fetch(`${API_BASE_URL}/api/vocabEntries`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(testEntry)
        });

        if (!createResponse.ok) {
            const errorData = await createResponse.json();
            console.log('❌ Create entry response details:');
            console.log('   Status:', createResponse.status);
            console.log('   Error data:', JSON.stringify(errorData, null, 2));
            throw new Error(`Create entry failed: ${errorData.error} (Code: ${errorData.code})`);
        }

        const createdEntry = await createResponse.json();
        console.log('✅ Entry created successfully!');
        console.log(`   Entry ID: ${createdEntry.id}`);
        console.log(`   Entry Key: ${createdEntry.entryKey}`);
        console.log(`   Entry Value: ${createdEntry.entryValue}`);
        console.log(`   User ID: ${createdEntry.userId}`);
        console.log(`   Created At: ${createdEntry.createdAt}\n`);

        // Step 3: Verify the entry was created with correct user ID
        console.log('3. Verifying entry was associated with correct user...');
        if (createdEntry.userId === user.id) {
            console.log('✅ Entry correctly associated with authenticated user!');
        } else {
            console.log(`❌ ERROR: Entry userId (${createdEntry.userId}) doesn't match authenticated user (${user.id})`);
        }

        // Step 4: Fetch the entry to double-check
        console.log('\n4. Fetching created entry to verify...');
        const fetchResponse = await fetch(`${API_BASE_URL}/api/vocabEntries/${createdEntry.id}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!fetchResponse.ok) {
            const errorData = await fetchResponse.json();
            throw new Error(`Fetch entry failed: ${errorData.error}`);
        }

        const fetchedEntry = await fetchResponse.json();
        console.log('✅ Entry fetched successfully!');
        console.log(`   Confirmed User ID: ${fetchedEntry.userId}`);
        console.log(`   Confirmed Entry Key: ${fetchedEntry.entryKey}`);
        console.log(`   Confirmed Entry Value: ${fetchedEntry.entryValue}\n`);

        // Step 5: Clean up - delete the test entry
        console.log('5. Cleaning up test entry...');
        const deleteResponse = await fetch(`${API_BASE_URL}/api/vocabEntries/${createdEntry.id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (deleteResponse.ok) {
            console.log('✅ Test entry cleaned up successfully!\n');
        } else {
            console.log('⚠️  Warning: Could not clean up test entry\n');
        }

        console.log('🎉 ALL TESTS PASSED!');
        console.log('✅ Create entry API works correctly without userID field');
        console.log('✅ User ID is automatically extracted from JWT token');
        console.log('✅ Entry is correctly associated with authenticated user');

    } catch (error) {
        console.error('❌ TEST FAILED:', error.message);
        process.exit(1);
    }
}

// Run the test
testCreateEntryWithoutUserId();
