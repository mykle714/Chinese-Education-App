import { Request, Response } from 'express';
import { DeckService } from '../services/DeckService.js';
import { requireUserId, getUserLanguage, handleControllerError } from '../utils/controllerUtils.js';
import type { CreateDeckBody, UpdateDeckBody, SetDeckMembershipsBody } from '../types/decks.js';

/**
 * Deck HTTP layer (docs/DECKS_FEATURE.md).
 *
 *   GET    /api/decks                              → DeckSummary[]  (current language)
 *   POST   /api/decks              {name}          → DeckSummary
 *   PATCH  /api/decks/:id          {name}          → DeckSummary
 *   DELETE /api/decks/:id                          → 204
 *   GET    /api/decks/:id/cards                    → VocabEntry[]
 *   GET    /api/decks/memberships?vocabEntryId=N   → number[]  (deck ids)
 *   PUT    /api/decks/memberships  {vocabEntryId, deckIds} → number[]
 *
 * LAYER: controller. Extracts the caller and their language, hands off to
 * DeckService, and lets handleControllerError map thrown DAL/service errors to
 * status codes. No policy lives here.
 *
 * THE LANGUAGE IS NEVER TAKEN FROM THE REQUEST on a write. `POST /api/decks`
 * creates the deck in the account's selected language, resolved server-side —
 * a client cannot ask for a deck in a language the user is not studying, and
 * cannot create a Spanish deck that will then be read against the Chinese vet
 * table. Reads of a specific deck use THAT DECK's stored language (DeckService),
 * not the caller's current one, so a stale link still works after a switch.
 */
export class DecksController {
  constructor(private deckService: DeckService) {}

  /** GET /api/decks — the caller's decks in their currently selected language. */
  getDecks = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      res.json(await this.deckService.listDecks(userId, language));
    } catch (error: any) {
      handleControllerError(error, res, 'DecksController.getDecks');
    }
  };

  /** POST /api/decks — body { name } */
  createDeck = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { name } = (req.body ?? {}) as CreateDeckBody;
      const language = await getUserLanguage(userId);
      res.status(201).json(await this.deckService.createDeck(userId, language, name));
    } catch (error: any) {
      handleControllerError(error, res, 'DecksController.createDeck');
    }
  };

  /** PATCH /api/decks/:id — body { name } */
  updateDeck = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { name } = (req.body ?? {}) as UpdateDeckBody;
      res.json(await this.deckService.renameDeck(userId, req.params.id, name));
    } catch (error: any) {
      handleControllerError(error, res, 'DecksController.updateDeck');
    }
  };

  /**
   * DELETE /api/decks/:id
   * Removes the deck and its membership rows. NO CARD IS DELETED — 204 here never
   * costs the learner vocabulary or mark history.
   */
  deleteDeck = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      await this.deckService.deleteDeck(userId, req.params.id);
      res.status(204).send();
    } catch (error: any) {
      handleControllerError(error, res, 'DecksController.deleteDeck');
    }
  };

  /**
   * GET /api/decks/:id/cards
   * Same enriched VocabEntry[] shape as /api/onDeck/masteredLibraryCards and
   * /api/onDeck/nonMasteredLibraryCards, so one client page renders all three
   * collections.
   */
  getDeckCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      res.json(await this.deckService.listDeckCards(userId, req.params.id));
    } catch (error: any) {
      handleControllerError(error, res, 'DecksController.getDeckCards');
    }
  };

  /**
   * GET /api/decks/memberships?vocabEntryId=N → the deck ids containing that card.
   * Drives the initial checkbox state of the Add-to-deck menu (cdp + eip).
   */
  getCardMemberships = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      res.json(await this.deckService.listDeckIdsForCard(userId, req.query.vocabEntryId));
    } catch (error: any) {
      handleControllerError(error, res, 'DecksController.getCardMemberships');
    }
  };

  /**
   * PUT /api/decks/memberships — body { vocabEntryId, deckIds }
   *
   * WHOLE-SET semantics: `deckIds` is what the card's membership should BE, not a
   * delta (see SetDeckMembershipsBody). Returns the resulting deck ids so the menu
   * can reconcile against what the server actually stored rather than assuming its
   * optimistic state won.
   */
  setCardMemberships = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { vocabEntryId, deckIds } = (req.body ?? {}) as SetDeckMembershipsBody;
      res.json(await this.deckService.setCardMemberships(userId, vocabEntryId, deckIds));
    } catch (error: any) {
      handleControllerError(error, res, 'DecksController.setCardMemberships');
    }
  };
}
