import { COMPANION_NPC_ID_BY_LANGUAGE } from '../../config/iwNpcs.js';
import type { IWScene, IWSceneCastMember } from '../../contracts/iw.js';

/**
 * sceneCast — resolving an npcId to the cast row a turn needs (§ 14 Q25).
 *
 * LAYER: service helper (pure). No I/O, no scene mutation: it reads the scene it is handed
 * and returns a row, so it is as testable as the validator that forbids the row it invents.
 *
 * ⚠️ **THE COMPANION IS AN NPC IN EVERY RESPECT EXCEPT AUTHORING.** At runtime he speaks,
 * hears, is addressed and takes turns exactly like a stallkeeper. The one asymmetry is who
 * decides he is there: a cast NPC is chosen and pinned per scene, while the companion is a
 * SLOT the scene does not fill — today a code constant, and on the forward path a per-user
 * choice among several companions (`iw_npc_memories` is already keyed (userId, npcId)).
 *
 * ⚠️ **WHICH IS WHY HIS ROW IS DERIVED, NEVER STORED.** `sceneValidation` actively REFUSES a
 * cast entry for the companion, and that rule is right: a stored row would be a second,
 * desynchronizable answer to "where does he stand" — the scene's own `companionStart*` fields
 * are the first — and it would let an author build a scene whose companion is somebody else's.
 * So the row is computed here, from those same fields, at the moment a turn needs one.
 *
 * Before this existed, `takeNpcTurn` looked the companion up in `npcCast`, missed, and
 * answered `unknown-npc` — a fault the client could only render as its catch-all
 * "Not right now." He was visible, walkable, tappable, in earshot and structurally unable to
 * answer: the only character in the game that could be addressed but not replied with
 * (2026-09-07).
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.4, § 14 Q25.
 */

/**
 * The cast row for `npcId` in `scene`, or `null` if that NPC is not in this scene at all.
 *
 * The companion's row carries **no actions**, and that is correct rather than a stub: authored
 * actions are per (scene, NPC) — "bring water" belongs to the tea house — and the companion is
 * native to no scene. He still performs the scene's CONVERSATIONS, which `buildTurnOffers`
 * selects by npcId and which the validator already permits him to appear in.
 */
export function resolveCastMember(scene: IWScene, npcId: string): IWSceneCastMember | null {
  const cast = (scene.npcCast ?? []).find(m => m.npcId === npcId);
  if (cast) return cast;

  if (npcId && npcId === COMPANION_NPC_ID_BY_LANGUAGE[scene.language]) {
    return {
      npcId,
      // The scene's own start cell. It is where the client drew him, so the prompt and the
      // board agree about where he is standing without a second source to keep in step.
      col: scene.companionStartCol,
      row: scene.companionStartRow,
      facing: scene.companionStartFacing,
      actions: [],
    };
  }
  return null;
}
