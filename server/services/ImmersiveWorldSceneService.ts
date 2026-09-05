import type { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import type { IImmersiveWorldDAL } from '../dal/interfaces/IImmersiveWorldDAL.js';
import { DALError, DuplicateError, NotFoundError, ValidationError } from '../types/dal.js';
import type { IWNpcOption, IWScene, IWSceneSummary } from '../contracts/iw.js';
import { validateScene, type IWSceneProblem } from './iw/sceneValidation.js';
import { COMPANION_NPC_ID_BY_LANGUAGE, npcsForLanguage } from '../config/iwNpcs.js';

/**
 * Immersive World Scene Service — the authoring half of iw (docs/IMMERSIVE_WORLD.md
 * § 12 phase 1d/1e).
 *
 * LAYER: service. It owns two things the DAL and the controller must not:
 *
 * 1. **THE GATE (phase 1e).** Authoring is `users.isTemplateAuthor` (migration 115),
 *    enforced HERE and not in the route — the pattern
 *    `NightMarketTemplateService.assertTemplateAuthor` set, and the reason
 *    `nightMarketTemplateRoutes.ts` deliberately carries only `authenticateToken`. A gate
 *    in a route is one forgotten middleware away from being absent; a gate at the top of
 *    every service method cannot be routed around.
 * 2. **VALIDATION.** `validateScene` is pure and lives in `iw/sceneValidation.ts`; this
 *    service is what refuses to write when it reports a problem.
 *
 * ⚠️ EVERY METHOD HERE IS AUTHORING. There is deliberately no ungated scene read yet: the
 * runtime load ("give the learner today's scene") is phase 2 and will be a different
 * method with a different contract — it picks a published scene, draws a complication and
 * opens a run, none of which an editor read should do. Do not relax the gate on
 * `getScene` to serve the runtime; add the runtime's own method.
 *
 * Depends on: migration 158 (`iw_scenes`), migration 115 (`users.isTemplateAuthor`),
 * `server/config/iwNpcs.ts` (the cast the picker is built from).
 */

/**
 * A save refused because the scene is malformed. Carries EVERY problem, not the first, so
 * the editor can mark up all the offending fields in one round trip.
 */
export class IWSceneValidationError extends DALError {
  constructor(public readonly problems: IWSceneProblem[]) {
    super('This scene has problems that must be fixed before it can be saved',
      'ERR_IW_SCENE_INVALID', 400);
    this.name = 'IWSceneValidationError';
  }
}

/** Postgres foreign-key-violation SQLSTATE — `iw_scene_runs`' ON DELETE RESTRICT firing. */
const PG_FOREIGN_KEY_VIOLATION = '23503';

export class ImmersiveWorldSceneService {
  constructor(
    private readonly iwDAL: IImmersiveWorldDAL,
    private readonly userDAL: IUserDAL,
  ) {}

  /**
   * The phase-1e gate. Mirrors `NightMarketTemplateService.assertTemplateAuthor` exactly,
   * down to the error code, because the two editors are the same grant: someone trusted to
   * author a night-market layout is trusted to author a scene on one.
   */
  private async assertTemplateAuthor(userId: string): Promise<void> {
    const user = await this.userDAL.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    if (!user.isTemplateAuthor) {
      throw new DALError(
        'Only template authors can author Immersive World scenes',
        'ERR_FORBIDDEN',
        403,
      );
    }
  }

  /** Narrow an arbitrary `language` query param to the two languages iw has a cast for. */
  private cleanLanguage(language: unknown): 'zh' | 'es' {
    if (language === 'zh' || language === 'es') return language;
    throw new ValidationError('Language must be zh or es');
  }

  /** Scene summaries for the editor's load list, optionally filtered to one language. */
  async listScenes(userId: string, language?: unknown): Promise<IWSceneSummary[]> {
    await this.assertTemplateAuthor(userId);
    const lang = language === undefined || language === null || language === ''
      ? undefined
      : this.cleanLanguage(language);
    return this.iwDAL.listScenes(lang);
  }

  /** One whole scene for the editor. Throws 404 rather than returning null. */
  async getScene(userId: string, sceneId: string): Promise<IWScene> {
    await this.assertTemplateAuthor(userId);
    const scene = await this.iwDAL.findSceneById(sceneId);
    if (!scene) throw new NotFoundError('Scene not found');
    return scene;
  }

  /**
   * The NPC picker's source (§ 14 Q2: "populate the list from the code constant rather
   * than accepting free text — which turns the runtime-lookup risk into a UI affordance
   * and removes the class of bug entirely").
   *
   * Projects each NPC down to what a choice needs. The prose fields — history, register,
   * core memories — never cross the wire: the editor picks NPCs, it does not display or
   * edit NPC text, which is the § 11 layer-1 boundary.
   */
  async listNpcOptions(userId: string, language: unknown): Promise<IWNpcOption[]> {
    await this.assertTemplateAuthor(userId);
    const lang = this.cleanLanguage(language);
    const companionId = COMPANION_NPC_ID_BY_LANGUAGE[lang];
    return npcsForLanguage(lang).map((npc) => ({
      id: npc.id,
      language: npc.language,
      name: npc.name,
      romanization: npc.romanization,
      occupation: npc.occupation,
      avatar: npc.avatar,
      isCompanion: npc.id === companionId,
      canComplete: Boolean(npc.completionRule),
    }));
  }

  /** Is a scene name free within its language? Backs the editor's rename gate. */
  async isNameAvailable(userId: string, language: unknown, name: unknown, exceptId?: string): Promise<boolean> {
    await this.assertTemplateAuthor(userId);
    const lang = this.cleanLanguage(language);
    const clean = typeof name === 'string' ? name.trim() : '';
    if (!clean) throw new ValidationError('A scene name is required');
    return this.iwDAL.isNameAvailable(lang, clean, exceptId);
  }

  /**
   * Create or overwrite a scene. `scene.id` decides which: present means overwrite that
   * row, absent means insert.
   *
   * VALIDATION RUNS BEFORE THE NAME CHECK on purpose — a scene whose language is garbage
   * cannot have its name checked within that language, and reporting "name taken" for a
   * payload with eleven other problems buries the real ones.
   */
  async saveScene(userId: string, scene: IWScene): Promise<IWScene> {
    await this.assertTemplateAuthor(userId);
    if (!scene || typeof scene !== 'object') throw new ValidationError('A scene payload is required');

    const problems = validateScene(scene);
    if (problems.length > 0) throw new IWSceneValidationError(problems);

    // Names are the author's handle on a scene; a duplicate within one language would make
    // the load list ambiguous. Enforced here rather than by a unique index because it is a
    // usability rule, not a data-integrity one — two scenes CAN legitimately share content.
    const nameFree = await this.iwDAL.isNameAvailable(scene.language, scene.name, scene.id);
    if (!nameFree) {
      throw new DuplicateError(`A ${scene.language} scene named "${scene.name.trim()}" already exists`);
    }

    if (scene.id) {
      const updated = await this.iwDAL.updateScene(scene.id, scene);
      if (!updated) throw new NotFoundError('Scene not found');
      return updated;
    }
    return this.iwDAL.createScene(scene);
  }

  /**
   * Delete a scene outright.
   *
   * A scene that has been PLAYED cannot be deleted — `iw_scene_runs."sceneId"` is
   * ON DELETE RESTRICT so a learner's history does not vanish because staff retired
   * content (migration 158). That surfaces as a foreign-key violation, which is translated
   * here into the advice the author actually needs: unpublish it instead.
   */
  async deleteScene(userId: string, sceneId: string): Promise<boolean> {
    await this.assertTemplateAuthor(userId);
    try {
      return await this.iwDAL.deleteScene(sceneId);
    } catch (error: any) {
      if (error?.code === PG_FOREIGN_KEY_VIOLATION || error?.originalError?.code === PG_FOREIGN_KEY_VIOLATION) {
        throw new DALError(
          'This scene has been played and cannot be deleted. Unpublish it instead.',
          'ERR_IW_SCENE_HAS_RUNS',
          409,
        );
      }
      throw error;
    }
  }
}
