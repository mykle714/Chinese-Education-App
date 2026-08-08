import { Request, Response } from 'express';
import { FriendsService } from '../services/FriendsService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import type { SendFriendRequestBody } from '../types/friends.js';

/**
 * Friend-graph HTTP layer (docs/FRIENDS_FEATURE.md).
 *
 *   GET    /api/friends                        → FriendSummary[]
 *   DELETE /api/friends/:friendUserId          → 204 (unfriend)
 *   GET    /api/friends/requests/incoming      → FriendRequestSummary[]
 *   GET    /api/friends/requests/outgoing      → FriendRequestSummary[]
 *   POST   /api/friends/requests {userId}      → SendFriendRequestResponse
 *   POST   /api/friends/requests/:id/accept    → FriendSummary
 *   DELETE /api/friends/requests/:id           → 204 (decline or revoke)
 *
 * LAYER: controller. Extracts the caller, hands off to FriendsService, maps thrown
 * DAL errors to status codes via handleControllerError. No policy lives here — the
 * "only the addressee may accept" style rules are all in the service.
 */
export class FriendsController {
  constructor(private friendsService: FriendsService) {}

  /** GET /api/friends */
  async getFriends(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      res.json(await this.friendsService.listFriends(userId));
    } catch (error) {
      handleControllerError(error, res, 'FriendsController.getFriends');
    }
  }

  /** GET /api/friends/requests/incoming */
  async getIncomingRequests(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      res.json(await this.friendsService.listIncomingRequests(userId));
    } catch (error) {
      handleControllerError(error, res, 'FriendsController.getIncomingRequests');
    }
  }

  /** GET /api/friends/requests/outgoing */
  async getOutgoingRequests(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      res.json(await this.friendsService.listOutgoingRequests(userId));
    } catch (error) {
      handleControllerError(error, res, 'FriendsController.getOutgoingRequests');
    }
  }

  /** POST /api/friends/requests — body { userId } */
  async sendRequest(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const body = (req.body ?? {}) as SendFriendRequestBody;
      const result = await this.friendsService.sendRequest(userId, body.userId);
      res.status(201).json(result);
    } catch (error) {
      handleControllerError(error, res, 'FriendsController.sendRequest');
    }
  }

  /** POST /api/friends/requests/:id/accept */
  async acceptRequest(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      res.json(await this.friendsService.acceptRequest(userId, req.params.id));
    } catch (error) {
      handleControllerError(error, res, 'FriendsController.acceptRequest');
    }
  }

  /** DELETE /api/friends/requests/:id — decline (addressee) or revoke (requester). */
  async deleteRequest(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await this.friendsService.deleteRequest(userId, req.params.id);
      res.status(204).send();
    } catch (error) {
      handleControllerError(error, res, 'FriendsController.deleteRequest');
    }
  }

  /** DELETE /api/friends/:friendUserId */
  async removeFriend(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await this.friendsService.removeFriend(userId, req.params.friendUserId);
      res.status(204).send();
    } catch (error) {
      handleControllerError(error, res, 'FriendsController.removeFriend');
    }
  }
}
