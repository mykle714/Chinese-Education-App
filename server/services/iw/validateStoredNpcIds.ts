import type { IImmersiveWorldDAL, IWNpcReference } from '../../dal/interfaces/IImmersiveWorldDAL.js';
import { npcById } from '../../config/iwNpcs.js';

/**
 * The startup validation pass owed by § 12 phase 1a: assert that every NPC id stored in
 * the database still resolves in `server/config/iwNpcs.ts`.
 *
 * WHY THIS EXISTS AT ALL. NPC ids are TEXT with no foreign key everywhere they appear —
 * `iw_scenes."completerNpcId"`, the `npcCast` and `conversations` blobs,
 * `iw_scene_ratings."npcId"`, `iw_npc_memories."npcId"` — because the referent is a code
 * constant, not a row (migration 158's header; docs/IMMERSIVE_WORLD.md § 14 Q2). The
 * database therefore CANNOT enforce the reference: deleting or renaming an NPC in the
 * registry orphans rows silently, and the first symptom is a learner standing in a scene
 * whose completer does not exist. This is the same class of check
 * docs/NIGHT_MARKET_GRAPH_ASSUMPTIONS.md makes for the street graph, and it is written in
 * the same spirit — a loud complaint at boot beats a mystery at play.
 *
 * IT WARNS, IT DOES NOT CRASH (by default). An orphaned NPC id breaks iw and nothing else,
 * and iw has no learner-facing surface yet; refusing to boot the whole app over it would
 * take down flashcards, the night market and the arena for a feature nobody can reach.
 * Pass `{ throwOnMissing: true }` to make it fatal — the right setting once iw is live and
 * a broken cast means a broken daily activity.
 *
 * ⚠️ IT IS A SNAPSHOT, NOT A GUARD. It runs once, at boot. An NPC deleted while the
 * process is up is not caught until the next restart, and a scene SAVED with a bad id is
 * caught earlier and better by `validateScene`. The two checks are complements: write-time
 * validation stops new breakage, this finds breakage that arrived from the other side.
 *
 * Referenced by: server/server.ts (boot), docs/IMMERSIVE_WORLD.md § 12 phase 1a.
 */

export interface IWNpcIdAudit {
  /** How many stored references were examined. */
  checked: number;
  /** The references whose npc id no longer resolves. */
  orphans: IWNpcReference[];
}

export interface ValidateStoredNpcIdsOptions {
  /** Throw instead of logging when an orphan is found. Default false. */
  throwOnMissing?: boolean;
  /** Injected for tests. Defaults to the console. */
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export async function validateStoredNpcIds(
  iwDAL: IImmersiveWorldDAL,
  options: ValidateStoredNpcIdsOptions = {},
): Promise<IWNpcIdAudit> {
  const log = options.logger ?? console;

  let references: IWNpcReference[];
  try {
    references = await iwDAL.listNpcReferences();
  } catch (error: any) {
    // A dev box that has not run migration 158 yet has no `iw_*` tables. That is a
    // migration state, not a data fault, so it must not look like one — and it must never
    // stop the process, which is why this is caught here rather than by the caller.
    log.warn(
      `[iw] Skipped the NPC-id validation pass: ${error?.message ?? error}. ` +
      'If this says the iw_* tables do not exist, run migration 158.',
    );
    return { checked: 0, orphans: [] };
  }

  const orphans = references.filter((ref) => !npcById(ref.npcId));

  if (orphans.length === 0) {
    log.log(`[iw] NPC-id validation passed — ${references.length} stored reference(s) all resolve.`);
    return { checked: references.length, orphans };
  }

  // Group by the missing id: one deleted NPC typically orphans many rows, and a list of
  // 200 identical complaints hides how many DISTINCT characters actually went away.
  const byNpcId = new Map<string, IWNpcReference[]>();
  for (const orphan of orphans) {
    const list = byNpcId.get(orphan.npcId) ?? [];
    list.push(orphan);
    byNpcId.set(orphan.npcId, list);
  }

  const detail = [...byNpcId.entries()]
    .map(([npcId, refs]) => {
      const where = refs.slice(0, 5).map((r) => `${r.source} "${r.label}"`).join(', ');
      const more = refs.length > 5 ? `, +${refs.length - 5} more` : '';
      return `  "${npcId}" — ${refs.length} reference(s): ${where}${more}`;
    })
    .join('\n');

  const message =
    `[iw] NPC-id validation FAILED: ${orphans.length} stored reference(s) point at ` +
    `${byNpcId.size} NPC id(s) that no longer exist in server/config/iwNpcs.ts.\n${detail}\n` +
    '  Either restore the NPC id in the registry or fix the stored rows — see ' +
    'docs/IMMERSIVE_WORLD.md § 14 Q2.';

  if (options.throwOnMissing) throw new Error(message);
  log.error(message);
  return { checked: references.length, orphans };
}
