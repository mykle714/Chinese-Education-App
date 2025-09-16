import fetch from 'node-fetch';

// Test configuration
const API_BASE_URL = 'http://localhost:5000';
const TEST_USER = { email: 'accounts@test.com', password: 'testpass123' };

async function testSimpleCreate() {
    console.log('🧪 Testing Simple Create Entry...\n');
    
    try {
        // Step 1: Login
        console.log('1. Logging in...');
        const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(TEST_USER)
        });

        if (!loginResponse.ok) {
            const errorData = await loginResponse.json();
            throw new Error(`Login failed: ${errorData.error}`);
        }

        const { token, user } = await loginResponse.json();
        console.log(`✅ Login successful: ${user.name} (${user.id})\n`);

        // Step 2: Test simple create with minimal data
        console.log('2. Creating entry with minimal data...');
        const testEntry = {
            entryKey: 'test-key-' + Date.now(),
            entryValue: 'test-value-' + Date.now()
        };

        console.log('   Sending data:', JSON.stringify(testEntry, null, 2));

        const createResponse = await fetch(`${API_BASE_URL}/api/vocabEntries`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(testEntry)
        });

        console.log('   Response status:', createResponse.status);
        console.log('   Response headers:', Object.fromEntries(createResponse.headers.entries()));

        const responseText = await createResponse.text();
        console.log('   Raw response:', responseText);

        if (!createResponse.ok) {
            console.log('❌ Create failed');
            try {
                const errorData = JSON.parse(responseText);
                console.log('   Error data:', JSON.stringify(errorData, null, 2));
            } catch (e) {
                console.log('   Could not parse error as JSON');
            }
            return;
        }

        const createdEntry = JSON.parse(responseText);
        console.log('✅ Entry created successfully!');
        console.log('   Created entry:', JSON.stringify(createdEntry, null, 2));

        // Step 3: Clean up
        console.log('\n3. Cleaning up...');
        const deleteResponse = await fetch(`${API_BASE_URL}/api/vocabEntries/${createdEntry.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (deleteResponse.ok) {
            console.log('✅ Cleanup successful');
        } else {
            console.log('⚠️  Cleanup failed, but test passed');
        }

        console.log('\n🎉 CREATE TEST PASSED!');

    } catch (error) {
        console.error('❌ TEST FAILED:', error.message);
        console.error('   Stack:', error.stack);
    }
}

testSimpleCreate();
