import { Request, Response } from 'express';
import { StudyChallengeService } from '../services/StudyChallengeService.js';
import { requireUserId, getUserLanguage, handleControllerError } from '../utils/controllerUtils.js';
import type { ChallengeVariant } from '../contracts/wire.js';
import type {
  AcceptChallengeBody,
  IssueChallengeBody,
  SubmitRoundBody,
} from '../types/studyChallenge.js';

/**
 * Study Challenge HTTP layer (docs/STUDY_CHALLENGE.md).
 *
 *   GET    /api/studyChallenges                          → ChallengesPageResponse
 *   GET    /api/studyChallenges/badge                    → { count }
 *   GET    /api/studyChallenges/history                  → ChallengeSummary[]
 *   GET    /api/studyChallenges/candidates?friendUserId&variant&struck → ChallengeCandidate[]
 *   POST   /api/studyChallenges         {friendUserId, variant, struckWords} → ChallengeSummary
 *   POST   /api/studyChallenges/strike  {dictionaryEntryId|word1, friendUserId|challengeId, variant, exclude}
 *                                                        → { replacement: ChallengeCandidate | null }
 *   PUT    /api/studyChallenges/blocks/:friendUserId {blocked} → 204
 *   GET    /api/studyChallenges/:id                      → ChallengeSummary
 *   POST   /api/studyChallenges/:id/accept  {struckWords, replacementWords} → ChallengeSummary
 *   POST   /api/studyChallenges/:id/decline              → 204
 *   DELETE /api/studyChallenges/:id                      → 204 (withdraw)
 *   POST   /api/studyChallenges/:id/rounds  {roundIndex, score, breakdown} → ChallengeSummary
 *
 * LAYER: controller. Extracts the caller and their language, hands off to
 * StudyChallengeService, and lets handleControllerError map thrown errors to status
 * codes. No policy lives here — the windows, the cap, the visibility gating and the
 * "only the challengee may accept" rules are all in the service.
 *
 * THE LANGUAGE IS NEVER TAKEN FROM THE REQUEST. A challenge is scoped to the
 * challenger's ACTIVE language (Q38), resolved server-side, so a client cannot issue
 * a challenge in a language the user is not studying — and cannot make a Spanish
 * challenge whose words will then be looked up in the Chinese vet table.
 *
 * ⚠️ The `/badge` count is deliberately NOT language-scoped (Q48) — it is the only
 * signal that a cross-language challenge exists at all. See the service.
 */
export class StudyChallengeController {
  constructor(private studyChallengeService: StudyChallengeService) {}

  /**
   * `?anytime=1` — the TESTER escape hatch (docs/STUDY_CHALLENGE.md § 2a).
   *
   * Read the same way on every endpoint, including the POSTs, where it rides the
   * QUERY STRING rather than the body on purpose: it is a property of the caller's
   * session, not of the thing being created, and one parser beats five.
   *
   * ⚠️ THIS IS NOT AUTHORIZATION. Anybody may send it; the SERVICE decides whether
   * the caller is a validator and ignores it silently otherwise. The controller's job
   * is only to carry the request through — see `StudyChallengeService.resolveAnytime`.
   */
  private static anytime(req: Request): boolean {
    return String(req.query.anytime ?? '') === '1';
  }

  /** GET /api/studyChallenges — the challenges page, in the caller's current language. */
  getChallengesPage = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      res.json(await this.studyChallengeService.getChallengesPage(
        userId, language, StudyChallengeController.anytime(req)
      ));
    } catch (error) {
      handleControllerError(error, res, 'StudyChallengeController.getChallengesPage');
    }
  };

  /** GET /api/studyChallenges/badge — language-blind, on purpose. */
  getBadge = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      res.json({ count: await this.studyChallengeService.countBadge(
        userId, StudyChallengeController.anytime(req)
      ) });
    } catch (error) {
      handleControllerError(error, res, 'StudyChallengeController.getBadge');
    }
  };

  /** GET /api/studyChallenges/history?limit&before — keyset page, not language-scoped. */
  getHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const limit = parseInt(String(req.query.limit ?? '20'), 10);
      const before = typeof req.query.before === 'string' ? req.query.before : null;
      res.json(await this.studyChallengeService.getHistory(
        userId,
        Number.isFinite(limit) ? limit : 20,
        before,
        StudyChallengeController.anytime(req)
      ));
    } catch (error) {
      handleControllerError(error, res, 'StudyChallengeController.getHistory');
    }
  };

  /**
   * GET /api/studyChallenges/candidates — the ten words to review.
   *
   * `struck` carries the words the caller has already marked known IN THIS SESSION,
   * so the replacement query can exclude them. It is a query param rather than
   * server state because the review flow is not a transaction: the user may abandon
   * it, and nothing about a half-finished review should persist. (What DOES persist
   * is the Mastered write each strike makes to their own card — see /strike.)
   */
  getCandidates = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const friendUserId = String(req.query.friendUserId ?? '');
      const variant = String(req.query.variant ?? 'same_word') as ChallengeVariant;
      const struck = typeof req.query.struck === 'string' && req.query.struck.length > 0
        ? req.query.struck.split(',')
        : [];

      res.json(await this.studyChallengeService.getCandidates(
        userId, friendUserId, variant, language, struck
      ));
    } catch (error) {
      handleControllerError(error, res, 'StudyChallengeController.getCandidates');
    }
  };

  /** POST /api/studyChallenges — body { friendUserId, variant, struckWords? } */
  issueChallenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const body = (req.body ?? {}) as IssueChallengeBody & { struckWords?: string[] };
      const struckWords = Array.isArray(body.struckWords)
        ? body.struckWords.filter((w): w is string => typeof w === 'string')
        : [];

      res.status(201).json(await this.studyChallengeService.issueChallenge(
        userId, body.friendUserId, body.variant, language, struckWords,
        StudyChallengeController.anytime(req)
      ));
    } catch (error) {
      handleControllerError(error, res, 'StudyChallengeController.issueChallenge');
    }
  };

  /**
   * POST /api/studyChallenges/strike
   * body { dictionaryEntryId | word1, friendUserId | challengeId, variant?, exclude? }
   *
   * "I already know this." Writes Mastered to the CALLER'S OWN card through the same
   * path discover's Already-Learned sort uses, so the two can never diverge.
   *
   * It answers with the ONE replacement word for the struck slot, so the reviewer's
   * list swaps a single tile instead of reloading (§ 3.2). The replacement half is
   * optional: with no `friendUserId`/`challengeId` the response is
   * `{ replacement: null }` and the call is a bare strike.
   */
  strikeWord = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const body = (req.body ?? {}) as {
        dictionaryEntryId?: unknown;
        word1?: unknown;
        friendUserId?: unknown;
        challengeId?: unknown;
        variant?: unknown;
        exclude?: unknown;
      };
      const parsedId = parseInt(String(body.dictionaryEntryId ?? ''), 10);
      // Either handle is accepted — see the service for why the challengee only has
      // the word, not its det id.
      const replacement = await this.studyChallengeService.strikeWord(
        userId,
        {
          dictionaryEntryId: Number.isFinite(parsedId) ? parsedId : undefined,
          word1: typeof body.word1 === 'string' ? body.word1 : undefined,
        },
        language,
        {
          friendUserId: typeof body.friendUserId === 'string' ? body.friendUserId : undefined,
          challengeId: typeof body.challengeId === 'string' ? body.challengeId : undefined,
          variant: body.variant === 'different_word' ? 'different_word' : 'same_word',
          exclude: Array.isArray(body.exclude)
            ? body.exclude.filter((w): w is string => typeof w === 'string')
            : [],
        }
      );
      res.json({ replacement });
    } catch (error) {
      handleControllerError(error, res, 'StudyChallengeController.strikeWord');
    }
  };

  /** PUT /api/studyChallenges/blocks/:friendUserId — body { blocked } */
  setBlock = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const blocked = (req.body ?? {}).blocked === true;
      await this.studyChallengeService.setChallengeBlock(
        userId, String(req.params.friendUserId ?? ''), blocked
      );
      res.status(204).send();
    } catch (error) {
      handleControllerError(error, res, 'StudyChallengeController.setBlock');
    }
  };

  /** GET /api/studyChallenges/:id */
  getChallenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      res.json(await this.studyChallengeService.getChallenge(
        userId, String(req.params.id), StudyChallengeController.anytime(req)
      ));
    } catch (error) {
      handleControllerError(error, res, 'StudyChallengeController.getChallenge');
    }
  };

  /** POST /api/studyChallenges/:id/accept — body { struckEntryIds? } */
  acceptChallenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      // The picker submits the WORDS it struck, not their det ids: the challenge
      // stores words as the denormalised (language, word1) pair, and a det id would
      // not survive a data deploy (Q49).
      const body = (req.body ?? {}) as AcceptChallengeBody;
      const struckWords = Array.isArray(body.struckWords)
        ? body.struckWords.filter((w): w is string => typeof w === 'string')
        : [];
      // The replacements the picker was SHOWN, echoed back so the accepted set is the
      // set on screen rather than a fresh draw. The service re-resolves each word
      // against the det, so this is an echo the server verifies, not a trusted input.
      const replacementWords = Array.isArray(body.replacementWords)
        ? body.replacementWords.filter((w): w is string => typeof w === 'string')
        : [];

      res.json(await this.studyChallengeService.acceptChallenge(
        userId, String(req.params.id), struckWords, replacementWords,
        StudyChallengeController.anytime(req)
      ));
    } catch (error) {
      handleControllerError(error, res, 'StudyChallengeController.acceptChallenge');
    }
  };

  /** POST /api/studyChallenges/:id/decline */
  declineChallenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await this.studyChallengeService.declineChallenge(userId, String(req.params.id));
      res.status(204).send();
    } catch (error) {
      handleControllerError(error, res, 'StudyChallengeController.declineChallenge');
    }
  };

  /** DELETE /api/studyChallenges/:id — withdraw (challenger only; the row is deleted). */
  withdrawChallenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await this.studyChallengeService.withdrawChallenge(userId, String(req.params.id));
      res.status(204).send();
    } catch (error) {
      handleControllerError(error, res, 'StudyChallengeController.withdrawChallenge');
    }
  };

  /** POST /api/studyChallenges/:id/rounds — body { roundIndex, score, breakdown } */
  submitRound = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const body = (req.body ?? {}) as SubmitRoundBody;
      const roundIndex = parseInt(String(body.roundIndex ?? ''), 10);
      const score = Number(body.score);

      res.json(await this.studyChallengeService.submitRound(
        userId,
        String(req.params.id),
        roundIndex,
        score,
        // Stored verbatim (§ 5.6). The server does not recompute the score, so it
        // does not validate the breakdown's internals either — it is an open shape a
        // game may enrich without a migration.
        body.breakdown as any,
        StudyChallengeController.anytime(req)
      ));
    } catch (error) {
      handleControllerError(error, res, 'StudyChallengeController.submitRound');
    }
  };
}
