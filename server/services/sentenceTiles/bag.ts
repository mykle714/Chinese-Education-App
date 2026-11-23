import { randomInt } from 'node:crypto';
import { SENTENCE_TILES_BAG_SIZE } from '../../contracts/sentenceTiles.js';
import type { SentenceTilesRackTile } from '../../contracts/sentenceTiles.js';
import { ZH_FORCED_COUNTS, ZH_POS_QUOTA, ZH_TILES, type TileDef } from './tileSet.zh.js';

/**
 * Sentence Tiles — composing a game's 100-tile bag (docs/SENTENCE_TILES_GAME.md § "Tiles and
 * the bag").
 *
 * The same recipe as the round-3 pilot (scripts/analysis/wordScrabblePilot/build-samples.py),
 * which is what produced the measured 0% dead racks:
 *   1. the function-word skeleton (ZH_FORCED_COUNTS) — the analogue of English vowels;
 *   2. content words sampled per POS until each POS reaches its quota (ZH_POS_QUOTA, forced
 *      copies counting toward it), drawn without repeats from tiles not already forced;
 *   3. a top-up from any remaining tile until the bag holds 100.
 * Only tiles with connectivity ≥ 3 exist in ZH_TILES, so every tile here passed the pilot's floor.
 * Each game draws its own bag, so two games never share a content-word mix.
 *
 * LAYER: pure service helper (no I/O). Randomness is injectable so tests are deterministic.
 */

/** Uniform integer in [0, max). Defaults to crypto, so a bag can't be predicted from a seed. */
export type RandomInt = (max: number) => number;
const cryptoRandomInt: RandomInt = (max) => randomInt(max);

const TILE_BY_WORD: ReadonlyMap<string, TileDef> = new Map(ZH_TILES.map((t) => [t.word, t]));

/** A tile's face value, or 0 for a word the tile set does not know (never dealt). */
export function tilePoints(word: string): number {
  return TILE_BY_WORD.get(word)?.points ?? 0;
}

/** Fisher–Yates, in place. */
export function shuffle<T>(items: T[], rand: RandomInt = cryptoRandomInt): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** `count` distinct items from `pool`, without replacement (pool is not mutated). */
function sample<T>(pool: readonly T[], count: number, rand: RandomInt): T[] {
  return shuffle([...pool], rand).slice(0, Math.max(0, count));
}

/**
 * A freshly composed, shuffled bag. Tile ids are 0..99 in shuffled order, so an id reveals
 * nothing about the word. Draws pop from the END of the returned array.
 */
export function buildBag(rand: RandomInt = cryptoRandomInt): SentenceTilesRackTile[] {
  const words: string[] = [];
  for (const [word, copies] of Object.entries(ZH_FORCED_COUNTS)) {
    for (let i = 0; i < copies; i++) words.push(word);
  }
  const forced = new Set(Object.keys(ZH_FORCED_COUNTS));

  for (const [pos, quota] of Object.entries(ZH_POS_QUOTA)) {
    const have = words.filter((w) => TILE_BY_WORD.get(w)?.pos === pos).length;
    const pool = ZH_TILES.filter((t) => t.pos === pos && !forced.has(t.word)).map((t) => t.word);
    words.push(...sample(pool, quota - have, rand));
  }

  // Top up from any POS the quota covers. Matches the pilot: tiles with a POS outside the quota
  // (classifiers, conjunctions, numerals…) never enter as filler.
  const inBag = new Set(words);
  const topUpPool = ZH_TILES
    .filter((t) => !inBag.has(t.word) && t.pos in ZH_POS_QUOTA)
    .map((t) => t.word);
  words.push(...sample(topUpPool, SENTENCE_TILES_BAG_SIZE - words.length, rand));

  shuffle(words, rand);
  return words.slice(0, SENTENCE_TILES_BAG_SIZE).map((word, id) => ({ id, word }));
}

/** Pop up to `count` tiles off the end of `bag` (mutates it) and return them. */
export function draw(bag: SentenceTilesRackTile[], count: number): SentenceTilesRackTile[] {
  return bag.splice(Math.max(0, bag.length - count), count);
}

/**
 * Replace the tiles in `removeIds` with fresh draws IN THEIR OWN RACK SLOTS, so the tiles a
 * player kept never move (the client renders the rack by position — docs/SENTENCE_TILES_GAME.md
 * § "Pages" → rack). When the bag runs dry the unfilled slots are dropped. Mutates `bag`.
 * Callers: SentenceTilesService.playTiles / exchangeTiles.
 */
export function refillInPlace(
  rack: readonly SentenceTilesRackTile[],
  removeIds: ReadonlySet<number>,
  bag: SentenceTilesRackTile[]
): SentenceTilesRackTile[] {
  const drawn = draw(bag, [...rack].filter((t) => removeIds.has(t.id)).length);
  const out: SentenceTilesRackTile[] = [];
  for (const t of rack) {
    if (!removeIds.has(t.id)) out.push(t);
    else if (drawn.length > 0) out.push(drawn.pop()!);
  }
  return out;
}

/** Total face value of a set of tiles. */
export function sumPoints(tiles: readonly { word: string }[]): number {
  return tiles.reduce((total, t) => total + tilePoints(t.word), 0);
}
