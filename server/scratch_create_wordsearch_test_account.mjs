// One-off script: create a test account seeded with exactly the word-search
// template-fallback test case (8 four-char words + 1 two-char + 1 three-char,
// all real dictionaryentries_zh headwords with disjoint characters so the
// substring de-dup pass never has to touch them).
import fetch from 'node-fetch';

const API_BASE_URL = 'http://localhost:5000';

const testUser = {
  email: 'wordsearch-template-test@example.com',
  name: 'Word Search Template Test',
  password: 'TestPassword123!',
};

// 8 x 4-char, 1 x 2-char, 1 x 3-char. Characters are disjoint across all 10
// words, so none can be a substring of another (word-search §1a).
const words = [
  '公共汽车', // bus
  '什么时候', // when?
  '不知不觉', // unconsciously
  '强身健体', // to keep fit and healthy
  '十字路口', // intersection
  '一心一意', // concentrating one's thoughts and efforts
  '自言自语', // to talk to oneself
  '自由自在', // free and easy
  '学生',     // student (2 chars)
  '图书馆',   // library (3 chars)
];

async function main() {
  let authToken;

  const registerRes = await fetch(`${API_BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testUser),
  });
  const registerData = await registerRes.json();

  if (registerRes.ok) {
    console.log('Registered new user.');
    authToken = registerData.token;
  } else if (registerData.error && /already exists|already registered/i.test(registerData.error)) {
    console.log('User already exists, logging in instead.');
    const loginRes = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, password: testUser.password }),
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) throw new Error(`Login failed: ${loginData.error}`);
    authToken = loginData.token;
  } else {
    throw new Error(`Registration failed: ${JSON.stringify(registerData)}`);
  }

  const authHeaders = {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };

  // Clear any pre-existing vocab entries so the library is exactly these 10.
  const existingRes = await fetch(`${API_BASE_URL}/api/vocabEntries`, { headers: authHeaders });
  if (existingRes.ok) {
    const existing = await existingRes.json();
    for (const entry of existing) {
      await fetch(`${API_BASE_URL}/api/vocabEntries/${entry.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
    }
    console.log(`Cleared ${existing.length} pre-existing entries.`);
  }

  let added = 0;
  for (const entryKey of words) {
    const res = await fetch(`${API_BASE_URL}/api/vocabEntries/add-to-library`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ entryKey, language: 'zh' }),
    });
    const data = await res.json();
    if (res.ok) {
      added++;
      console.log(`  added: ${entryKey} -> ${data.status}`);
    } else {
      console.log(`  FAILED: ${entryKey} -> ${JSON.stringify(data)}`);
    }
  }

  console.log(`\nDone. ${added}/${words.length} words added to library.`);
  console.log(`Email: ${testUser.email}`);
  console.log(`Password: ${testUser.password}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
