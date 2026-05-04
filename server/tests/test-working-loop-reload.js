// Diagnostic: simulate working loop + successful mark requests and verify
// that the server returns a same-category replacement card each time.
//
// NOTE: This mutates the test user's mark history. Optionally rewinds via
// /api/flashcards/undo-last-mark at the end. Safe to rerun.
//
// Usage (from /home/cow):  node server/tests/test-working-loop-reload.js

import fetch from 'node-fetch';

const API_URL = 'http://localhost:5000';
const TIMEZONE = 'America/Los_Angeles';
const ITERATIONS = 10;

const CANDIDATE_USERS = [
  { email: 'large@test.com', password: 'testing123' },
  { email: 'reader-vocab-test@example.com', password: 'TestPassword123!' },
  { email: 'small@test.com', password: 'testing123' },
];

async function login(user) {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Login failed for ${user.email}: ${data.error}`);
  return data.token;
}

async function getWorkingLoop(token) {
  const res = await fetch(`${API_URL}/api/onDeck/distributed-working-loop`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-user-timezone': TIMEZONE,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Working loop fetch failed: ${JSON.stringify(data)}`);
  return data;
}

async function markCard(token, cardId, isCorrect, excludeIds) {
  const res = await fetch(`${API_URL}/api/flashcards/mark`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-user-timezone': TIMEZONE,
    },
    body: JSON.stringify({ cardId, isCorrect, excludeIds }),
  });
  const data = await res.json();
  return { status: res.status, ok: res.ok, body: data };
}

async function undoLastMark(token, cardId, markTimestamp, displacedMark) {
  const res = await fetch(`${API_URL}/api/flashcards/undo-last-mark`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-user-timezone': TIMEZONE,
    },
    body: JSON.stringify({ cardId, markTimestamp, displacedMark }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body: data };
}

function summarize(loop) {
  const counts = {};
  for (const c of loop) counts[c.category] = (counts[c.category] || 0) + 1;
  return counts;
}

async function run() {
  // Pick a user whose working loop returns cards
  let token = null;
  let chosenUser = null;
  let workingLoop = null;
  for (const user of CANDIDATE_USERS) {
    try {
      const t = await login(user);
      const loop = await getWorkingLoop(t);
      if (Array.isArray(loop) && loop.length >= 3) {
        token = t;
        chosenUser = user;
        workingLoop = loop;
        break;
      }
      console.log(`  ${user.email}: working loop has ${loop?.length ?? 0} cards — trying next`);
    } catch (e) {
      console.log(`  ${user.email}: ${e.message}`);
    }
  }

  if (!token) {
    console.error('No suitable test user found with a populated working loop.');
    process.exit(1);
  }

  console.log(`\n✅ Logged in as ${chosenUser.email}`);
  console.log(`Working loop size: ${workingLoop.length}`);
  console.log(`Category distribution:`, summarize(workingLoop));
  console.log();

  const results = [];
  const seenReplacementIds = new Set();
  // Simulate the client's front-card pointer advancing through the loop.
  let cursor = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    if (workingLoop.length === 0) {
      console.log(`Iteration ${i + 1}: working loop empty, stopping`);
      break;
    }
    const slotIndex = cursor % workingLoop.length;
    const card = workingLoop[slotIndex];
    const categoryBefore = card.category;
    const cardIdBefore = card.id;

    const excludeIds = workingLoop.map(c => c.id);
    const { status, ok, body } = await markCard(token, cardIdBefore, true, excludeIds);

    const row = {
      i: i + 1,
      slot: slotIndex,
      cardIdBefore,
      categoryBefore,
      status,
      ok,
      markTimestamp: body?.markTimestamp ?? null,
      displacedMark: body?.displacedMark ?? null,
      newCardId: body?.newCard?.id ?? null,
      newCardCategory: body?.newCard?.category ?? null,
      sameCategory: body?.newCard?.category === categoryBefore,
      alreadyServed: body?.newCard?.id != null && seenReplacementIds.has(body.newCard.id),
      sameAsMarked: body?.newCard?.id === cardIdBefore,
      errorCode: body?.code ?? null,
      errorMsg: body?.error ?? null,
    };
    results.push(row);

    if (body?.newCard?.id != null) {
      seenReplacementIds.add(body.newCard.id);
      // Patch the slot locally (simulate client)
      workingLoop[slotIndex] = body.newCard;
    }
    cursor++;
  }

  // ---- Report ----
  console.log('\n=== Mark request results ===');
  console.log(
    'it  slot  before(id/cat)              status  newCard(id/cat)              same?  notes'
  );
  for (const r of results) {
    const before = `${r.cardIdBefore}/${r.categoryBefore}`.padEnd(26);
    const after = r.newCardId
      ? `${r.newCardId}/${r.newCardCategory}`.padEnd(26)
      : `(none)`.padEnd(26);
    const same = r.newCardId ? (r.sameCategory ? 'Y' : 'N') : '-';
    const notes = [];
    if (!r.ok) notes.push(`ERR ${r.errorCode || ''}: ${r.errorMsg || ''}`);
    if (r.alreadyServed) notes.push('DUPLICATE-REPLACEMENT');
    if (r.sameAsMarked) notes.push('RETURNED-SAME-ID-AS-MARKED');
    if (r.ok && !r.newCardId) notes.push('200-BUT-NO-NEWCARD');
    console.log(
      `${String(r.i).padStart(2)}  ${String(r.slot).padStart(4)}  ${before}  ${String(r.status).padStart(6)}  ${after}  ${same.padStart(5)}  ${notes.join('; ')}`
    );
  }

  // ---- Diagnostic summary ----
  const total = results.length;
  const okCount = results.filter((r) => r.ok).length;
  const withNewCard = results.filter((r) => r.newCardId).length;
  const sameCatCount = results.filter((r) => r.sameCategory).length;
  const dupCount = results.filter((r) => r.alreadyServed).length;
  const sameAsMarked = results.filter((r) => r.sameAsMarked).length;

  console.log('\n=== Diagnostic summary ===');
  console.log(`Total marks:              ${total}`);
  console.log(`HTTP 200 responses:       ${okCount}/${total}`);
  console.log(`Responses with newCard:   ${withNewCard}/${total}`);
  console.log(`Same-category match:      ${sameCatCount}/${withNewCard}`);
  console.log(`Duplicate replacements:   ${dupCount}`);
  console.log(`newCard.id === markedId:  ${sameAsMarked}`);

  const errSignatures = results.filter((r) => !r.ok).map((r) => r.errorCode);
  if (errSignatures.length) {
    console.log(`Error codes seen:         ${[...new Set(errSignatures)].join(', ')}`);
  }

  // ---- Cleanup: undo each mark in reverse (LIFO, matches server's "last mark" check) ----
  console.log('\n=== Cleanup: undoing marks (LIFO) ===');
  let undone = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    if (!r.markTimestamp) {
      console.log(`  undo ${i + 1} skipped: no markTimestamp captured`);
      continue;
    }
    const { status, ok, body } = await undoLastMark(
      token,
      r.cardIdBefore,
      r.markTimestamp,
      r.displacedMark
    );
    if (ok) undone++;
    else console.log(`  undo ${i + 1} (card ${r.cardIdBefore}) failed: status ${status} code=${body?.code ?? ''} msg=${body?.error ?? ''}`);
  }
  console.log(`Undone ${undone}/${results.length} marks.`);
}

run().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
