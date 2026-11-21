import { Request, Response } from 'express';
import { StoryService } from '../services/StoryService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

/**
 * Adventures (cyoa) HTTP layer — docs/CYOA_FEATURE.md § 6.3.
 *
 * Learner
 *   GET    /api/stories                                → StoryListResponse
 *   GET    /api/stories/:id/play                       → StoryPlayResponse (resume or start)
 *   POST   /api/stories/:id/choose {choiceId}          → StoryPlayResponse
 * Author (isAuthor + own story — enforced in StoryService)
 *   POST   /api/stories {title, iconId?}               → 201 StoryEditResponse
 *   GET    /api/stories/:id/edit                       → StoryEditResponse
 *   PATCH  /api/stories/:id {title?, iconId?, startPassageId?} → StoryEditResponse
 *   DELETE /api/stories/:id                            → 204
 *   POST   /api/stories/:id/passages                   → 201 StoryPassageEdit
 *   PUT    /api/stories/:id/passages/order             → StoryEditResponse (reorder)
 *   POST   /api/stories/:id/passages/:passageId/duplicate → StoryEditResponse (copy, placed after)
 *   PUT    /api/stories/:id/passages/:passageId        → StoryPassageEdit
 *   DELETE /api/stories/:id/passages/:passageId        → 204
 *   POST   /api/stories/:id/publish                    → StoryPublishResponse
 *   POST   /api/stories/:id/unpublish                  → 204
 *
 * LAYER: controller. Extracts the caller and params, hands off to StoryService, maps
 * thrown DAL errors to status codes via handleControllerError. No policy here.
 * Wire types: server/contracts/stories.ts. Routes: server/routes/storyRoutes.ts.
 */
export class StoryController {
  constructor(private storyService: StoryService) {}

  /**
   * Shared try/catch + caller extraction. `fn` returns the JSON body, or `undefined`
   * for a 204. `status` overrides 200 for creates.
   */
  private async respond(
    req: Request,
    res: Response,
    name: string,
    fn: (userId: string) => Promise<unknown>,
    status = 200
  ): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const body = await fn(userId);
      if (body === undefined) res.status(204).send();
      else res.status(status).json(body);
    } catch (error) {
      handleControllerError(error, res, `StoryController.${name}`);
    }
  }

  async list(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'list', (userId) => this.storyService.list(userId));
  }

  async play(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'play', (userId) => this.storyService.play(userId, req.params.id));
  }

  async choose(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'choose', (userId) =>
      this.storyService.choose(userId, req.params.id, req.body?.choiceId)
    );
  }

  async create(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'create', (userId) => this.storyService.create(userId, req.body ?? {}), 201);
  }

  async getForEdit(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'getForEdit', (userId) => this.storyService.getForEdit(userId, req.params.id));
  }

  async update(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'update', (userId) =>
      this.storyService.update(userId, req.params.id, req.body ?? {})
    );
  }

  async remove(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'remove', async (userId) => {
      await this.storyService.remove(userId, req.params.id);
      return undefined;
    });
  }

  async createPassage(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'createPassage', (userId) => this.storyService.createPassage(userId, req.params.id), 201);
  }

  async duplicatePassage(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'duplicatePassage', (userId) =>
      this.storyService.duplicatePassage(userId, req.params.id, req.params.passageId), 201
    );
  }

  async reorderPassages(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'reorderPassages', (userId) =>
      this.storyService.reorderPassages(userId, req.params.id, req.body?.passageIds)
    );
  }

  async savePassage(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'savePassage', (userId) =>
      this.storyService.savePassage(userId, req.params.id, req.params.passageId, req.body ?? {})
    );
  }

  async deletePassage(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'deletePassage', async (userId) => {
      await this.storyService.deletePassage(userId, req.params.id, req.params.passageId);
      return undefined;
    });
  }

  async publish(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'publish', (userId) => this.storyService.publish(userId, req.params.id));
  }

  async unpublish(req: Request, res: Response): Promise<void> {
    await this.respond(req, res, 'unpublish', async (userId) => {
      await this.storyService.unpublish(userId, req.params.id);
      return undefined;
    });
  }
}
