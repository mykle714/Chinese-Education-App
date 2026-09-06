import { apiGet } from '../../../api/http';
import type { IWNpcOption, IWScene, IWSceneSummary } from '../../../../server/contracts/iw';

/**
 * iwPlayApi — the learner-facing scene reads (§ 12 phase 2).
 *
 * LAYER: feature API module. It is the THIRD iw api file and the split is by AUDIENCE, which
 * matches the split on the server exactly:
 *
 * | File | Endpoints | Who |
 * |---|---|---|
 * | `immersiveWorldSceneApi.ts` | `/scenes*` | an AUTHOR, gated on `isTemplateAuthor` |
 * | `iwPlayApi.ts` (here) | `/play/scenes*` | a LEARNER, published scenes only |
 * | `immersiveWorldTurnApi.ts` | `/turn`, `/session/end` | a learner, mid-scene |
 *
 * ⚠️ **NO FUNCTION HERE TAKES A `token`** (FRONTEND_LAYERING) — `authHeader()` is read at call
 * time inside `api/http.ts`, so a silent refresh mid-scene never changes a caller's function
 * identity.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 9.4, § 12 phase 2.
 */

/** What the learner may open, and which language they are studying. */
export interface IWPlayableScenes {
  scenes: IWSceneSummary[];
  /** The user's study language, echoed so the caller need not fetch the account to know. */
  language: string;
}

/** Published scenes in the learner's own study language, newest-updated first. */
export const listPlayableScenes = (): Promise<IWPlayableScenes> =>
  apiGet<IWPlayableScenes>('/api/immersiveWorld/play/scenes');

/** A scene and the cast that renders it — one read, at scene start. */
export interface IWScenePlayPayload {
  scene: IWScene;
  /**
   * Every NPC of the scene's language, projected (§ 11 layer 1: no NPC prose crosses the
   * wire). It is the whole language cast rather than only this scene's, because it is the
   * same cheap constant either way and the caller looks NPCs up by id.
   */
  npcs: IWNpcOption[];
}

/**
 * One whole scene, blobs inline — the single read a scene start makes (migration 158).
 *
 * The cast comes with it rather than as a second request: names and body sprites are needed
 * before the first frame, and a second round trip would render the scene as unlabelled
 * squares for its duration.
 */
export const loadPlayableScene = (id: string): Promise<IWScenePlayPayload> =>
  apiGet<IWScenePlayPayload>(`/api/immersiveWorld/play/scenes/${encodeURIComponent(id)}`);

/**
 * The learner's own words, for § 9.4's vocabulary GUIDANCE.
 *
 * ⚠️ **IT IS THE GAME POOL, ON PURPOSE.** § 9.4 names `getGameVocabPool` as the source, and
 * going through the same endpoint every game uses buys the thing iw would otherwise have to
 * build: PROVISIONAL LENDING. A learner with an empty library gets cards lent to them here in
 * exactly the way they are lent for a game board, so a brand-new account still has a world
 * that can talk to it ([PROVISIONAL_CARDS.md](../../../../docs/PROVISIONAL_CARDS.md)).
 *
 * ⚠️ **IT IS GUIDANCE, NOT A GATE** (§ 9.4, Q39). The list is handed to the NPC with an
 * instruction to work these words in where it is natural; nothing rejects a reply that uses a
 * word outside it. So a short or stale list degrades the writing, never the run — which is why
 * a failure here returns an empty list rather than blocking the scene from opening.
 *
 * The distribution mirrors a mid-sized game board rather than asking for everything: the pool
 * is rendered into every NPC's prompt on every turn, so its size is a per-turn token cost.
 */
export async function fetchKnownWords(): Promise<string[]> {
  try {
    const pool = await apiGet<{ cards?: Array<{ entryKey?: string }> }>('/api/onDeck/gamePool', {
      params: { Unfamiliar: 4, Target: 20, Comfortable: 12, Mastered: 8 },
    });
    return (pool.cards ?? [])
      .map(card => card.entryKey)
      .filter((word): word is string => Boolean(word));
  } catch {
    return [];
  }
}
