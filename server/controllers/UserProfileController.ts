import { Request, Response } from 'express';
import { UserProfileService } from '../services/UserProfileService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

/** Default design-page size when the client sends none. The service caps the maximum. */
const DEFAULT_DESIGN_PAGE = 12;

/**
 * User profile HTTP layer (docs/USER_PROFILE_PAGE.md).
 *
 *   GET /api/users/:userId/profile                  → UserProfileResponse
 *   GET /api/users/:userId/designs?after=&limit=    → CommunityDesign[]
 *
 * LAYER: controller. Extracts the caller, forwards to UserProfileService, and lets
 * handleControllerError map thrown errors to status codes. No policy here.
 *
 * THE LANGUAGE IS NEVER TAKEN FROM THE REQUEST, and for an unusual reason: a profile
 * is scoped to the PROFILED person's selected language, not the caller's, so there is
 * no language for a client to supply. The service resolves it from the target account.
 */
export class UserProfileController {
  constructor(private userProfileService: UserProfileService) {}

  /** GET /api/users/:userId/profile */
  getProfile = async (req: Request, res: Response): Promise<void> => {
    try {
      const viewerUserId = requireUserId(req, res);
      if (!viewerUserId) return;

      const profile = await this.userProfileService.getProfile(
        viewerUserId,
        String(req.params.userId ?? ''),
      );
      res.json(profile);
    } catch (error) {
      handleControllerError(error, res, 'UserProfileController.getProfile');
    }
  };

  /** GET /api/users/:userId/designs — one keyset page of their card designs. */
  getDesigns = async (req: Request, res: Response): Promise<void> => {
    try {
      const viewerUserId = requireUserId(req, res);
      if (!viewerUserId) return;

      const after = typeof req.query.after === 'string' && req.query.after ? req.query.after : null;
      const limit = Number.parseInt(String(req.query.limit ?? ''), 10) || DEFAULT_DESIGN_PAGE;

      const designs = await this.userProfileService.listDesigns(
        viewerUserId,
        String(req.params.userId ?? ''),
        after,
        limit,
      );
      res.json(designs);
    } catch (error) {
      handleControllerError(error, res, 'UserProfileController.getDesigns');
    }
  };
}
