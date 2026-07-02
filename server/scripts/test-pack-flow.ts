// READ-ONLY diagnostic: only calls getNextPacks (no writes) with a nonexistent
// dummy userId to see what the client's initial + replenish fetch would return.
import { starterPacksService } from '../dal/setup.js';
import db from '../db.js';

async function main() {
  const LANG = process.argv[2] || 'zh';
  const userId = '00000000-0000-0000-0000-000000000000'; // no matching rows anywhere; pure read

  const init = await starterPacksService.getNextPacks(LANG, userId, [], 2);
  console.log('INITIAL packs:', init.packs.map(p => ({ key: p.packKey, ncards: p.cards.length, cards: p.cards.map(c => ({id: c.id, key: c.entryKey, sorted: (c as any).sorted, skipped: (c as any).skipped})) })));
  console.log('exhausted=', init.exhausted, 'level=', init.level);

  // Simulate: pack[0] completes, ask for replacement excluding held pack[1].
  const held = init.packs.slice(1).map(p => p.packKey);
  const next = await starterPacksService.getNextPacks(LANG, userId, held, 1);
  console.log('\nNEXT-PACK (excluding held=', held, '):');
  console.log(next.packs.map(p => ({ key: p.packKey, ncards: p.cards.length })));
  console.log('exhausted=', next.exhausted, 'level=', next.level);

  await db.pool?.end?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
