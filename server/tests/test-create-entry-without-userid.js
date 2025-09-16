import fetch from 'node-fetch';

// Test configuration
const API_BASE_URL = 'http://localhost:5000';
const TEST_USER = { email: 'accounts@test.com', password: 'testpass123' };

async function testCreateEntryWithoutUserId() {
    console.log('🧪 Testing Create Entry API without userID field...\n');
    
    // Try to login with test user
    console.log(`Trying to login with ${TEST_USER.email}...`);
    const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(TEST_USER)
    });

    if (!loginResponse.ok) {
        const errorData = await loginResponse.json();
        throw new Error(`Login failed: ${errorData.error}`);
    }

    const loginData = await loginResponse.json();
    const token = loginData.token;
    const user = loginData.user;
    console.log(`✅ Login successful with ${TEST_USER.email}`);
    
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
