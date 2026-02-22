/**
 * Test script to debug library card flow
 * Tests: /api/starter-packs/sort → /api/onDeck/library-cards
 */

const API_BASE_URL = 'http://localhost:5000';

async function testLibraryFlow() {
  console.log('🧪 Starting Library Card Flow Test\n');
  console.log('='.repeat(60));

  try {
    // Step 1: Login
    console.log('\n📝 Step 1: Logging in as test user...');
    const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'empty@test.com',
        password: 'testing123'
      }),
      credentials: 'include'
    });

    if (!loginResponse.ok) {
      throw new Error(`Login failed: ${loginResponse.status}`);
    }

    const loginData = await loginResponse.json();
    const cookies = loginResponse.headers.get('set-cookie');
    console.log('✅ Logged in successfully');
    console.log('   User ID:', loginData.user?.id);

    // Step 2: Get a vocab entry to test with
    console.log('\n📝 Step 2: Fetching vocab entries...');
    const vocabResponse = await fetch(`${API_BASE_URL}/api/vocabEntries`, {
      headers: { 'Cookie': cookies || '' }
    });

    if (!vocabResponse.ok) {
      throw new Error(`Failed to get vocab: ${vocabResponse.status}`);
    }

    const vocabEntries = await vocabResponse.json();
    console.log('✅ Found', vocabEntries.length, 'existing vocab entries');
    
    let testCard;
    let testCardId;
    let testLanguage = 'zh';
    
    // Create a new test vocab entry for this test
    console.log('\n📝 Step 2b: Creating test vocab entry...');
    const createResponse = await fetch(`${API_BASE_URL}/api/vocabEntries`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': cookies || ''
      },
      body: JSON.stringify({
        entryKey: '测试',
        entryValue: 'test',
        language: testLanguage,
        notes: 'Test card for library flow',
        levelOfKnowledge: 1
      })
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.log('⚠️  Could not create new test card:', errorText);
      console.log('   Falling back to existing vocab...');
      
      if (vocabEntries.length === 0) {
        throw new Error('No vocab entries found and could not create test card');
      }
      testCard = vocabEntries[0];
      testCardId = testCard.id;
      testLanguage = testCard.language;
    } else {
      testCard = await createResponse.json();
      testCardId = testCard.id;
      console.log('✅ Created test vocab entry');
    }
    
    console.log('   Test Card ID:', testCardId);
    console.log('   Test Card:', testCard.entryKey, '→', testCard.entryValue);
    console.log('   Language:', testLanguage);

    // Step 3: Sort card to library
    console.log('\n📝 Step 3: Sorting card to library...');
    const sortResponse = await fetch(`${API_BASE_URL}/api/starter-packs/sort`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': cookies || ''
      },
      body: JSON.stringify({
        cardId: testCardId,
        bucket: 'library',
        language: testLanguage
      })
    });

    if (!sortResponse.ok) {
      const errorText = await sortResponse.text();
      throw new Error(`Sort failed: ${sortResponse.status} - ${errorText}`);
    }

    const sortData = await sortResponse.json();
    console.log('✅ Card sorted successfully');
    console.log('   Result:', JSON.stringify(sortData, null, 2));

    // Step 4: Check the OnDeck set directly
    console.log('\n📝 Step 4: Checking OnDeck set directly...');
    const featureName = `starter-${testLanguage}-library`;
    const onDeckResponse = await fetch(`${API_BASE_URL}/api/onDeckPage/${featureName}`, {
      headers: { 'Cookie': cookies || '' }
    });

    if (onDeckResponse.ok) {
      const onDeckData = await onDeckResponse.json();
      console.log('✅ OnDeck set found:');
      console.log('   Feature Name:', onDeckData.featureName);
      console.log('   Vocab Entry IDs:', onDeckData.vocabEntryIds);
      console.log('   Type of vocabEntryIds:', typeof onDeckData.vocabEntryIds);
      console.log('   Is Array:', Array.isArray(onDeckData.vocabEntryIds));
    } else {
      console.log('⚠️  OnDeck set not found (might not exist yet)');
    }

    // Step 5: Fetch library cards
    console.log('\n📝 Step 5: Fetching library cards...');
    const libraryResponse = await fetch(`${API_BASE_URL}/api/onDeck/library-cards`, {
      headers: { 'Cookie': cookies || '' }
    });

    if (!libraryResponse.ok) {
      const errorText = await libraryResponse.text();
      throw new Error(`Library cards failed: ${libraryResponse.status} - ${errorText}`);
    }

    const libraryCards = await libraryResponse.json();
    console.log('✅ Library cards fetched successfully');
    console.log('   Count:', libraryCards.length);
    
    if (libraryCards.length > 0) {
      console.log('   Cards:');
      libraryCards.forEach((card, i) => {
        console.log(`   ${i + 1}. ID:${card.id} - ${card.entryKey} → ${card.entryValue}`);
      });
    } else {
      console.log('   ⚠️  NO CARDS RETURNED!');
    }

    // Step 6: Verify the card we sorted is in the results
    console.log('\n📝 Step 6: Verification...');
    const foundCard = libraryCards.find(card => card.id === testCardId);
    if (foundCard) {
      console.log('✅ SUCCESS! Card we sorted was found in library cards');
    } else {
      console.log('❌ FAIL! Card we sorted is NOT in library cards');
      console.log('   Expected card ID:', testCardId);
      console.log('   Returned card IDs:', libraryCards.map(c => c.id));
    }

    console.log('\n' + '='.repeat(60));
    console.log('🏁 Test Complete\n');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testLibraryFlow().catch(console.error);
