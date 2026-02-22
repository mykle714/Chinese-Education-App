/**
 * Test script for cycle button functionality
 * Tests that cards properly move between library and learn-later buckets
 * without duplicates
 */

const API_BASE_URL = 'http://localhost:5000';

async function login() {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email: 'empty@test.com',
            password: 'testing123'
        }),
        credentials: 'include'
    });

    if (!response.ok) {
        throw new Error('Login failed');
    }

    const cookies = response.headers.get('set-cookie');
    return cookies || '';
}

async function getLibraryCards(cookies) {
    const response = await fetch(`${API_BASE_URL}/api/onDeck/library-cards`, {
        headers: {
            'Cookie': cookies
        }
    });

    if (!response.ok) {
        throw new Error('Failed to fetch library cards');
    }

    return await response.json();
}

async function getLearnLaterCards(cookies) {
    const response = await fetch(`${API_BASE_URL}/api/onDeck/learn-later-cards`, {
        headers: {
            'Cookie': cookies
        }
    });

    if (!response.ok) {
        throw new Error('Failed to fetch learn later cards');
    }

    return await response.json();
}

async function sortCard(cookies, cardId, bucket, language) {
    const response = await fetch(`${API_BASE_URL}/api/starter-packs/sort`, {
        method: 'POST',
        headers: {
            'Cookie': cookies,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            cardId,
            bucket,
            language
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to sort card: ${error.error || 'Unknown error'}`);
    }

    return await response.json();
}

async function runTest() {
    console.log('🧪 Starting Cycle Button Test...\n');

    try {
        // Step 1: Login
        console.log('1️⃣ Logging in as test user...');
        const cookies = await login();
        console.log('✅ Login successful\n');

        // Step 2: Get initial library cards
        console.log('2️⃣ Fetching initial library cards...');
        const initialLibrary = await getLibraryCards(cookies);
        console.log(`📚 Found ${initialLibrary.length} cards in library`);
        
        if (initialLibrary.length === 0) {
            console.log('⚠️  No cards in library. Please add some cards first.');
            return;
        }

        const testCard = initialLibrary[0];
        console.log(`🃏 Test card: ID=${testCard.id}, Word="${testCard.entryKey}"\n`);

        // Step 3: Get initial learn-later cards
        console.log('3️⃣ Fetching initial learn-later cards...');
        const initialLearnLater = await getLearnLaterCards(cookies);
        console.log(`⏰ Found ${initialLearnLater.length} cards in learn-later\n`);

        // Step 4: Move card from library to learn-later
        console.log('4️⃣ Moving card from library to learn-later...');
        await sortCard(cookies, testCard.id, 'learn-later', 'zh');
        console.log('✅ Sort request successful\n');

        // Wait a moment for the operation to complete
        await new Promise(resolve => setTimeout(resolve, 500));

        // Step 5: Verify card moved correctly
        console.log('5️⃣ Verifying card is in learn-later and NOT in library...');
        const libraryAfterMove = await getLibraryCards(cookies);
        const learnLaterAfterMove = await getLearnLaterCards(cookies);
        
        const inLibrary = libraryAfterMove.some(c => c.id === testCard.id);
        const inLearnLater = learnLaterAfterMove.some(c => c.id === testCard.id);
        
        console.log(`📚 In Library: ${inLibrary}`);
        console.log(`⏰ In Learn Later: ${inLearnLater}`);
        
        if (!inLibrary && inLearnLater) {
            console.log('✅ Card moved successfully - exists only in learn-later\n');
        } else if (inLibrary && inLearnLater) {
            console.log('❌ FAIL: Card exists in BOTH buckets (duplicate!)\n');
            return;
        } else if (!inLibrary && !inLearnLater) {
            console.log('❌ FAIL: Card disappeared from both buckets!\n');
            return;
        } else {
            console.log('❌ FAIL: Card still in library, not in learn-later\n');
            return;
        }

        // Step 6: Move card back from learn-later to library
        console.log('6️⃣ Moving card back from learn-later to library...');
        await sortCard(cookies, testCard.id, 'library', 'zh');
        console.log('✅ Sort request successful\n');

        // Wait a moment for the operation to complete
        await new Promise(resolve => setTimeout(resolve, 500));

        // Step 7: Verify card moved back correctly
        console.log('7️⃣ Verifying card is back in library and NOT in learn-later...');
        const libraryAfterReturn = await getLibraryCards(cookies);
        const learnLaterAfterReturn = await getLearnLaterCards(cookies);
        
        const inLibraryFinal = libraryAfterReturn.some(c => c.id === testCard.id);
        const inLearnLaterFinal = learnLaterAfterReturn.some(c => c.id === testCard.id);
        
        console.log(`📚 In Library: ${inLibraryFinal}`);
        console.log(`⏰ In Learn Later: ${inLearnLaterFinal}`);
        
        if (inLibraryFinal && !inLearnLaterFinal) {
            console.log('✅ Card moved back successfully - exists only in library\n');
        } else if (inLibraryFinal && inLearnLaterFinal) {
            console.log('❌ FAIL: Card exists in BOTH buckets (duplicate!)\n');
            return;
        } else if (!inLibraryFinal && !inLearnLaterFinal) {
            console.log('❌ FAIL: Card disappeared from both buckets!\n');
            return;
        } else {
            console.log('❌ FAIL: Card not in library, still in learn-later\n');
            return;
        }

        console.log('🎉 ALL TESTS PASSED! Cycle button works correctly.\n');

    } catch (error) {
        console.error('❌ Test failed with error:', error.message);
        console.error(error);
    }
}

// Run the test
runTest();
