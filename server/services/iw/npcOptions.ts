import { COMPANION_NPC_ID_BY_LANGUAGE, npcsForLanguage } from '../../config/iwNpcs.js';
import type { IWNpcOption } from '../../contracts/iw.js';

/**
 * npcOptions — the ONE projection of an NPC that is allowed to cross the wire.
 *
 * LAYER: service helper (pure). Extracted 2026-09-06 when the runtime gained a second
 * caller: the editor's picker needs it to CHOOSE an NPC, and the play surface needs it to
 * DRAW one (a name over a head, the right body sprite). Two copies of this map would be two
 * places to forget the rule below.
 *
 * ⚠️ **WHAT IS ABSENT IS THE POINT.** Every prose field an NPC has — history, register, core
 * memories, completion rule — stays on the server. That is § 11's layer-1 boundary: NPC text
 * is never displayed, never edited and never round-tripped through a client, so it cannot be
 * read out of a payload or fed back into a prompt. `avatar` is the one cosmetic field that has
 * to cross, because both surfaces draw the actual body rather than a coloured square.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 11, § 12 phase 1d, § 12 phase 2, § 14 Q2.
 */

/** Every NPC in one language's cast, projected to what a picker or a renderer needs. */
export function npcOptionsForLanguage(language: 'zh' | 'es'): IWNpcOption[] {
  const companionId = COMPANION_NPC_ID_BY_LANGUAGE[language];
  return npcsForLanguage(language).map(npc => ({
    id: npc.id,
    language: npc.language,
    name: npc.name,
    romanization: npc.romanization,
    occupation: npc.occupation,
    avatar: npc.avatar,
    isCompanion: npc.id === companionId,
    /**
     * Only an NPC with a `completionRule` can end a scene: without one the character has no
     * idea what it would be agreeing to (§ 14 Q27).
     */
    canComplete: Boolean(npc.completionRule),
  }));
}
