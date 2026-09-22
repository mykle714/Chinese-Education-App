/**
 * iwNpcPinyin.test.ts — the cast's nametag readings are renderable.
 *
 * What this guards is a CONTRACT BETWEEN TWO HALVES OF THE APP that nothing else can catch:
 * `IWNpc.pinyin` is zipped one syllable per character by `ForeignText` when the nametag over
 * an NPC's head is drawn (docs/IMMERSIVE_WORLD.md § 5.3a). A miscounted reading does not
 * throw, does not fail a type check and does not look broken in a payload — it silently drops
 * the reading off the tail characters and paints the wrong tone colours on the rest, on a
 * surface no server test would otherwise see.
 *
 * It exists because the obvious field to reach for is the WRONG one. `romanization` is
 * author-facing and word-grouped (`Mǎ Shīfu` — two tokens for three characters), so the first
 * implementation of the nametag wired it in and garbled three of the seven NPCs. These
 * assertions are what stops the next one.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.3a; server/types/iwNpc.ts → `IWNpc.pinyin`.
 */

import { describe, it, expect } from 'vitest';
import { IW_NPCS } from '../config/iwNpcs.js';

/** Latin script has no per-character overlay, so an `es` NPC is expected to carry none. */
const CHARACTER_BASED = IW_NPCS.filter(npc => npc.language !== 'es');

describe('IWNpc.pinyin', () => {
  it('gives every character-based NPC a reading', () => {
    for (const npc of CHARACTER_BASED) {
      expect(npc.pinyin.trim(), `${npc.id} (${npc.name}) has no pinyin`).not.toBe('');
    }
  });

  it('carries exactly one syllable per character', () => {
    for (const npc of CHARACTER_BASED) {
      // `[...name]`, not `.length`: a name outside the BMP would otherwise count as two.
      const characters = [...npc.name].length;
      const syllables = npc.pinyin.trim().split(/\s+/).length;
      expect(syllables, `${npc.id}: "${npc.name}" (${characters} chars) vs "${npc.pinyin}"`)
        .toBe(characters);
    }
  });

  it('is lowercase, like every other pinyin the app renders', () => {
    // A name is not spelled differently from any other word on a cpcd surface — the det
    // tables store lowercase, so a capitalized tag would be the app's only one.
    for (const npc of CHARACTER_BASED) {
      expect(npc.pinyin, `${npc.id} is capitalized`).toBe(npc.pinyin.toLowerCase());
    }
  });

  it('is not the romanization, which cannot be zipped per character', () => {
    // The specific mistake this suite exists for: `romanization` is prose for authors and
    // prompts. If somebody ever assigns one to the other, the counts above will usually
    // catch it — but not for the 2-character names, where the two happen to coincide.
    for (const npc of CHARACTER_BASED) {
      expect(npc.pinyin, `${npc.id} copied its romanization`).not.toBe(npc.romanization);
    }
  });
});
