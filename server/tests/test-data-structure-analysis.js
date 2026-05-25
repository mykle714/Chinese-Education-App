// Test script to analyze the exact data structure returned by the API
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const API_BASE_URL = 'http://localhost:5000';

async function analyzeDataStructure() {
  try {
    console.log('🔍 Analyzing API Data Structure...\n');
    
    // Test credentials for the reader vocab account
    const testUser = {
      email: 'reader-vocab-test@example.com',
      password: 'TestPassword123!'
    };
    
    console.log(`🔐 Logging in with: ${testUser.email}`);
    
    // Step 1: Login to get auth token
    const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password
      })
    });
    
    const loginData = await loginResponse.json();
    
    if (!loginResponse.ok) {
      console.log(`❌ Login failed: ${loginData.error}`);
      return;
    }
    
    console.log('✅ Login successful!');
    const authToken = loginData.token;
    
    // Step 2: Get all vocab entries to analyze structure
    console.log('\n📊 Analyzing /api/vocabEntries structure...');
    
    const allEntriesResponse = await fetch(`${API_BASE_URL}/api/vocabEntries`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!allEntriesResponse.ok) {
      console.log('❌ Failed to fetch all entries');
      return;
    }
    
    const allEntries = await allEntriesResponse.json();
    console.log(`✅ Retrieved ${allEntries.length} total entries`);
    
    // Analyze first few entries
    if (allEntries.length > 0) {
      console.log('\n🔬 Sample entry structure analysis:');
      const sampleEntry = allEntries[0];
      console.log('   Sample entry keys:', Object.keys(sampleEntry));
      console.log('   Sample entry:', JSON.stringify(sampleEntry, null, 2));
      
      // Check for field name variations
      const fieldVariations = {
        id: sampleEntry.id || sampleEntry.ID || 'NOT_FOUND',
        entryKey: sampleEntry.entryKey || sampleEntry.entrykey || sampleEntry.entry_key || 'NOT_FOUND',
        definition: sampleEntry.definition || 'NOT_FOUND',
        userId: sampleEntry.userId || sampleEntry.userid || sampleEntry.user_id || 'NOT_FOUND',
        createdAt: sampleEntry.createdAt || sampleEntry.createdat || sampleEntry.created_at || 'NOT_FOUND'
      };
      
      console.log('\n   Field name analysis:');
      Object.entries(fieldVariations).forEach(([field, value]) => {
        console.log(`      ${field}: ${value !== 'NOT_FOUND' ? '✅ Found' : '❌ Not found'} (value: ${typeof value === 'string' && value.length > 50 ? value.substring(0, 50) + '...' : value})`);
      });
    }
    
    // Step 3: Test token lookup with specific words and analyze structure
    console.log('\n🎯 Testing token lookup with specific words...');
    
    const specificTokens = ['今天', '咖啡店', '春节', '太极拳', '市中心'];
    
    const tokenResponse = await fetch(`${API_BASE_URL}/api/vocabEntries/by-tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tokens: specificTokens
      })
    });
    
    if (!tokenResponse.ok) {
      console.log('❌ Token lookup failed');
      return;
    }
    
    const tokenEntries = await tokenResponse.json();
    console.log(`✅ Token lookup returned ${tokenEntries.length} entries`);
    
    // Analyze each token result
    specificTokens.forEach(token => {
      const found = tokenEntries.find(entry => {
        // Check all possible field name variations
        const entryKey = entry.entryKey || entry.entrykey || entry.entry_key;
        return entryKey === token;
      });
      
      if (found) {
        const entryValue = found.definition;
        console.log(`   ✅ ${token} → ${entryValue}`);
        console.log(`      Entry structure:`, Object.keys(found));
      } else {
        console.log(`   ❌ ${token} → NOT FOUND`);
      }
    });
    
    // Step 4: Compare with direct database query approach
    console.log('\n🔍 Searching in all entries for missing words...');
    
    specificTokens.forEach(token => {
      const foundInAll = allEntries.find(entry => {
        const entryKey = entry.entryKey || entry.entrykey || entry.entry_key;
        return entryKey === token;
      });
      
      if (foundInAll) {
        const entryValue = foundInAll.definition;
        console.log(`   ✅ ${token} found in all entries → ${entryValue}`);
      } else {
        console.log(`   ❌ ${token} not found in all entries either`);
      }
    });
    
    // Step 5: Check for partial matches or similar words
    console.log('\n🔍 Checking for partial matches...');
    
    specificTokens.forEach(token => {
      console.log(`\n   Searching for entries containing "${token}":`);
      const partialMatches = allEntries.filter(entry => {
        const entryKey = entry.entryKey || entry.entrykey || entry.entry_key;
        const entryValue = entry.definition;
        return entryKey?.includes(token) || entryValue?.includes(token);
      });
      
      if (partialMatches.length > 0) {
        partialMatches.slice(0, 3).forEach(match => {
          const entryKey = match.entryKey || match.entrykey || match.entry_key;
          const entryValue = match.definition;
          console.log(`      📝 ${entryKey} → ${entryValue?.substring(0, 50)}${entryValue?.length > 50 ? '...' : ''}`);
        });
        if (partialMatches.length > 3) {
          console.log(`      ... and ${partialMatches.length - 3} more matches`);
        }
      } else {
        console.log(`      No partial matches found`);
      }
    });
    
    // Step 6: Summary and recommendations
    console.log('\n=== DATA STRUCTURE ANALYSIS SUMMARY ===');
    console.log(`Total entries in database: ${allEntries.length}`);
    console.log(`Token lookup API working: ${tokenResponse.ok ? '✅' : '❌'}`);
    console.log(`Field naming consistency: ${allEntries.length > 0 ? (allEntries[0].entryKey ? 'camelCase' : 'lowercase') : 'unknown'}`);
    
    if (allEntries.length > 0) {
      const sampleEntry = allEntries[0];
      console.log('\nRecommended field access pattern:');
      console.log(`  ID: entry.${sampleEntry.id !== undefined ? 'id' : 'ID'}`);
      console.log(`  Key: entry.${sampleEntry.entryKey !== undefined ? 'entryKey' : sampleEntry.entrykey !== undefined ? 'entrykey' : 'entry_key'}`);
      console.log(`  Definition: entry.definition`);
    }
    
  } catch (error) {
    console.error('❌ Error analyzing data structure:', error.message);
  }
}

// Run the analysis
analyzeDataStructure();
