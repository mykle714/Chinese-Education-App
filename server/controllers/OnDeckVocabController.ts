import { Request, Response } from 'express';
import { OnDeckVocabService, parseFlpWorld, type CollectionFilter } from '../services/OnDeckVocabService.js';
import { MAX_SEED_IDS, parseIdCsv, requireUserId, getUserLanguage, handleControllerError } from '../utils/controllerUtils.js';
import { MarkType, MARK_TYPES } from '../types/index.js';
import { ProvisionalCardService } from '../services/ProvisionalCardService.js';
import {
  CardBaselineSurface,
  CARD_BASELINES,
  PROVISION_RETRY_FACTOR,
  isRollingSupplySurface,
  masteredCollectionWorld,
  parseMasteryWorld,
} from '../contracts/wire.js';
import { parseBuiltinCollectionId } from '../dal/shared/vetTable.js';
import type { StudyChallengeService } from '../services/StudyChallengeService.js';
import type { ChallengeRoundContext } from '../types/studyChallenge.js';
import { isFeatureEnabled } from '../contracts/featureFlags.js';
import type { FocusModeService } from '../services/FocusModeService.js';
import { FOCUS_ENDED_HEADER } from '../contracts/focusMode.js';
import { worldForMarkType } from '../contracts/mastery.js';
import { WORD_SEARCH_BOARDS, type MasteryWorldId, type WordSearchBoardId } from '../contracts/wire.js';

/**
 * OnDeck Vocabulary Controller
 * Handles HTTP requests for active on-deck card operations.
 */
export class OnDeckVocabController {
  constructor(
    private onDeckVocabService: OnDeckVocabService,
    // Tops the user up to the surface's baseline before any set is assembled, so no
    // endpoint here can ever answer "not enough cards" (docs/PROVISIONAL_CARDS.md).
    private provisionalCardService: ProvisionalCardService,
    /**
     * Resolves + authorizes the optional `challengeId` query param
     * (docs/STUDY_CHALLENGE.md § 5.2). A challenge board is still a GAME POOL, so it
     * is served from this controller's endpoints rather than a second pool loader —
     * but only the challenge service can say whether this player may have it, which
     * round they are on, and which nine words it is made of.
     */
    private studyChallengeService: StudyChallengeService,
    /**
     * Narrows every UNRESTRICTED round to a focused world's daily set
     * (docs/FOCUS_MODE.md § 4) — see `applyFocus`.
     */
    private focusModeService: FocusModeService
  ) {}

  /**
   * FOCUS MODE (docs/FOCUS_MODE.md § 4). Given the world a round's marks land in,
   * return the scope the round should draw from:
   *
   *   - world focused  → `{ kind: 'focus', ids }`, today's remaining set.
   *     The caller must then SKIP its baseline top-up: a focused round never lends.
   *   - not focused    → null (an ordinary round). If resolving is what just switched
   *     focus off, FOCUS_ENDED_HEADER tells the client to show the popup.
   *
   * `flpBreak` turns the first case inside out (§ 4a): `{ kind: 'outside-focus', … }`,
   * every card but today's set, with the remaining set as the fallback.
   *
   * Until 2026-11-04 a round could also be launched from a deck (`?deck=`) or a
   * built-in collection (`?collection=`), which took precedence over focus; both launch
   * params were removed with the Decks feature and are now ignored if sent.
   */
  private async applyFocus(
    res: Response,
    userId: string,
    language: string,
    world: MasteryWorldId,
    flpBreak = false
  ): Promise<CollectionFilter | null> {
    const focus = await this.focusModeService.resolveWorld(userId, language, world);
    if (focus.active) {
      return flpBreak
        ? { kind: 'outside-focus', setIds: focus.setIds, remainingIds: focus.ids }
        : { kind: 'focus', ids: focus.ids };
    }
    if ('ended' in focus && focus.ended) res.setHeader(FOCUS_ENDED_HEADER, world);
    return null;
  }

  /**
   * Resolve the optional `?challengeId=&gameId=&mode=` params into one round's
   * board context, or null for an ordinary launch.
   *
   * THROWS (401/400/404 via handleControllerError) rather than degrading to a
   * normal pool when the challenge is named but unplayable — a player who is out of
   * their test window must be told, not handed a casual board that scores nothing.
   */
  private async resolveChallengeRound(req: Request, userId: string): Promise<ChallengeRoundContext | null> {
    // Study Challenge flag (server/contracts/featureFlags.ts). Returning null here
    // gates BOTH callers — gamePool and wordSearchGrid — because a challenge board is
    // the only thing either does differently for a challenge. Deliberately a silent
    // fall-through to the ordinary pool rather than the 400/404 an unplayable
    // challenge gets: with the feature off there is no challenge to report on, and a
    // stray `?challengeId=` in a bookmarked URL should still hand back a casual board.
    if (!isFeatureEnabled('studyChallenge')) return null;
    const rawId = req.query.challengeId;
    if (rawId == null || String(rawId).trim() === '') return null;
    const gameId = typeof req.query.gameId === 'string' ? req.query.gameId : '';
    // A duplicate `mode=` query key (once possible from WordSearchPage's own
    // fetch double-appending it alongside useChallengeRound's poolParams — fixed,
    // but defense in depth here) parses to an ARRAY under Express's default `qs`
    // parser, not a string. Take the first value rather than silently discarding
    // it to null, which mismatched the drawn round's mode and 400'd every
    // affected launch (`ValidationError: Round N of this test is not that game`).
    const rawModeValue = Array.isArray(req.query.mode) ? req.query.mode[0] : req.query.mode;
    const rawMode = typeof rawModeValue === 'string' ? rawModeValue : '';
    return this.studyChallengeService.getRoundContext(
      userId,
      String(rawId),
      // The game is stated by the caller and CHECKED against the drawn sequence, so
      // a client cannot pick which of the three games it plays. `mode` collapses to
      // null for a game that has only one, matching how the sequence stores it.
      gameId ? { gameId, mode: rawMode || null } : null,
      // The tester escape hatch rides through to the WINDOW check only, and the
      // service still verifies the caller is a validator
      // (docs/STUDY_CHALLENGE.md § 2a). Without it a tester could open a round from
      // the challenge page and then be refused its board.
      String(req.query.anytime ?? '') === '1'
    );
  }

  /**
   * Parse the `surface` query param naming which baseline applies to this request.
   *
   * Every game/flp caller sends it. An unrecognized or missing value means an older
   * client (or a hand-rolled request), and we must still not block: fall back to the
   * requested distribution's own total, which is what that caller was going to try to
   * fill anyway.
   */
  private static parseSurface(raw: unknown): CardBaselineSurface | null {
    const value = String(raw ?? '');
    return value in CARD_BASELINES ? (value as CardBaselineSurface) : null;
  }

  /**
   * Get all library cards (vocab entries from *-library OnDeck sets)
   * GET /api/onDeck/libraryCards
   */
  getLibraryCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const libraryCards = await this.onDeckVocabService.getLibraryCards(userId, language);
      res.json(libraryCards);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getLibraryCards');
    }
  };

  /**
   * The contents of ONE built-in collection — the Deck Tower's card library calls it
   * with `collection=all` (the collection pages that used the other ids were deleted
   * 2026-11-04; the ids still parse).
   * GET /api/onDeck/collectionCards?collection=all|learn-now
   *                                            |mastered|mastered-reading|mastered-writing
   *
   * This replaces the old `masteredLibraryCards?world=` and `nonMasteredLibraryCards`
   * pair. Those two were the same query with two different WHERE fragments; one
   * parameterized endpoint keeps every built-in collection reaching the client
   * through one shape.
   *
   * An unrecognized collection falls back to **learn-now** rather than to "everything":
   * a typo'd or stale link must never quietly widen the set a learner is looking at.
   */
  getCollectionCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const collection = parseBuiltinCollectionId(String(req.query.collection ?? '')) ?? 'learn-now';
      const cards = await this.onDeckVocabService.getBuiltinCollectionCards(userId, language, collection);
      res.json(cards);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getCollectionCards');
    }
  };

  /**
   * Get the Study Mix working loop (1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target).
   * GET /api/onDeck/distributedWorkingLoop?world=<core|reading|writing>
   *
   * A focused world (docs/FOCUS_MODE.md § 4) narrows the loop to today's set; the mark
   * endpoint re-resolves the same scope for its refills. The `mode` (Review/Challenge),
   * `deck`, `collection` and single-band `category` params were removed 2026-11-04 and
   * are ignored if sent.
   */
  getDistributedWorkingLoop = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      // Which track the session exercises (core / reading / writing).
      const world = parseFlpWorld(req.query.world);
      const language = await getUserLanguage(userId);
      const collection = await this.applyFocus(res, userId, language, world);

      // flp never blocks on deck size any more: top the user up to the flp baseline
      // first, so a learner with an empty deck still gets a full working loop. The
      // response shape is unchanged — the client spots the temporary cards by their
      // `starterPackBucket` and shows the generic notice (flp is not itemized,
      // because the loop refills as you go and the played set isn't known up front).
      //
      // The top-up fires only for a learner short on SORTED cards, and the loop's own
      // lend tier sits below its cooled tier, so an established learner with a resting
      // deck is never lent anything (docs/PROVISIONAL_CARDS.md § 4b).
      // A focused loop skips it: it serves the day's set and nothing else.
      const { lentIds } = collection?.kind === 'focus'
        ? { lentIds: [] as number[] }
        : await this.provisionalCardService.ensureBaselineForSurface(userId, language, 'flp');

      const workingLoop = await this.onDeckVocabService.getDistributedWorkingLoop(userId, language, collection, lentIds, world);
      res.json(workingLoop);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getDistributedWorkingLoop');
    }
  };

  /**
   * Replacements for the working-loop cards an flp game break cleared
   * (docs/FLP_GAME_BREAKS.md § 4a).
   * GET /api/onDeck/loopRefill?replace=<ids>&exclude=<ids>[&world=]
   *
   * `replace` = the cleared cards (capped at MAX_SEED_IDS — a break's seed is the loop,
   * so it can clear no more than that); `exclude` = the loop's ids. The session params
   * are the loop's own (`workingLoopParams`), resolved exactly as the loop fetch
   * resolves them — the world, then focus — so a refill can never widen the session.
   * No baseline top-up: the loop already holds the baseline, and the picker lends on
   * its own when the pool is spent (getNextLibraryCardWithFallback tier 4).
   */
  getLoopRefill = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const replacedIds = parseIdCsv(req.query.replace).slice(0, MAX_SEED_IDS);
      const excludeIds = parseIdCsv(req.query.exclude).slice(0, MAX_SEED_IDS);
      const world = parseFlpWorld(req.query.world);
      const language = await getUserLanguage(userId);
      const collection = await this.applyFocus(res, userId, language, world);

      const cards = await this.onDeckVocabService.refillWorkingLoop(
        userId, language, replacedIds, excludeIds, collection, world
      );
      // Same graceful degrade as the swipe refill: a cold TTS cache costs latency only.
      // The pre-warm stamps `hasAudio`, so its result is what goes out.
      let warmed = cards;
      try {
        warmed = await this.onDeckVocabService.prewarmAudio(cards);
      } catch (prewarmError) {
        console.error('TTS pre-warm failed for loop refill:', prewarmError);
      }
      res.json(warmed);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getLoopRefill');
    }
  };

  /**
   * Per-category library card counts of ONE mastery bar
   * (Unfamiliar / Target / Comfortable / Mastered).
   * GET /api/onDeck/categoryCounts[?world=core|reading|writing]
   *
   * `bar` defaults to `core`, which is what every caller before the Reading/Writing
   * Centers meant. An unrecognized value falls back to core rather than 400ing: the
   * parameter only chooses which lens the same four bands are counted through, so a
   * bad one can mislead but never leak another user's data.
   */
  getCategoryCounts = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const world = parseMasteryWorld(req.query.world as string | undefined) ?? 'core';
      const language = await getUserLanguage(userId);
      const counts = await this.onDeckVocabService.getCategoryCounts(
        userId, language, undefined, world
      );
      res.json(counts);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getCategoryCounts');
    }
  };

  /**
   * How many cards are mastered in each of the three bars (migration 143).
   * GET /api/onDeck/masteredCounts → { core, reading, writing }
   *
   * Separate from categoryCounts rather than folded into it: that map is keyed by
   * BAND for one bar, this one is keyed by BAR for one band, and merging the two
   * shapes would give the client a response it has to disambiguate by key spelling.
   */
  getMasteredCounts = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const counts = await this.onDeckVocabService.getMasteredCountsByWorld(userId, language);
      res.json(counts);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getMasteredCounts');
    }
  };

  /**
   * Cooldown-aware ready counts per utcm band of the session bar — the Deck Tower's
   * Learning-deck figures (docs/DECK_TOWER.md), one call per bar.
   * GET /api/onDeck/flpReadyCounts[?world=core|reading|writing]
   * → { counts: {Unfamiliar,Target,Comfortable,Mastered}, upcoming: {readyAt, band}[], focusOn: boolean }
   *
   * `upcoming` is the cooling cards' release schedule for the next 24 h
   * (`flpUpcomingReady`), scoped like `counts` (a focused world: today's set only).
   *
   * `reviewNextReadyMs` (the Review study mode's countdown) was dropped from the
   * response 2026-11-04 with that mode (docs/DEFERRED_WORK.md § 31).
   *
   * Deliberately narrow: unlike `getCollectionCards`, this never joins the dictionary
   * or runs the enrichment pipeline, since every figure here is computed from
   * `typedMarkHistory` alone — see `OnDeckVocabService.getFlpReadyCounts`.
   */
  getFlpReadyCounts = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const world = parseFlpWorld(req.query.world);
      // A focused world counts only today's remaining set — the Deck Tower reads this,
      // so it never promises a card focus will not serve.
      const focus = await this.applyFocus(res, userId, language, world);
      const result = await this.onDeckVocabService.getFlpReadyCounts(
        userId, language, world, focus?.kind === 'focus' ? focus.ids : undefined
      );
      res.json({ ...result, focusOn: focus?.kind === 'focus' });
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getFlpReadyCounts');
    }
  };

  // Categories the game pool may request counts for (mirrors the SR buckets).
  private static readonly GAME_POOL_CATEGORIES = ['Unfamiliar', 'Target', 'Comfortable', 'Mastered'];

  /**
   * Build a game's card pool.
   * GET /api/onDeck/gamePool?markType=recognition&Unfamiliar=2&Target=10&Comfortable=6&Mastered=2
   *
   * `markType` selects which mastery track buckets and cools the candidates —
   * `recognition` (Bubble Match), `reading` (Speed Reading), `production`, or `writing`.
   * Every caller passes it explicitly; see the parameterization note below.
   * Defaults to 2 Unfamiliar + 10 Target + 6 Comfortable + 2 Mastered (20 total)
   * when no recognised category params are supplied. The service tops the pool
   * up to its total from fallback buckets when a quota can't be met, so this is
   * a best-effort fill. Returns { cards, requested, available, total, needed,
   * sufficient }.
   *
   * PARTIAL REFILL: `&need=N&exclude=12,34&avoid=56,78` returns only N cards,
   * never returns an `exclude`d id, and treats `avoid`ed ids as cooled (drawn
   * only if the library can't fill the board without them). Bubble Match's single
   * "Play Again" button uses this to swap out only the pairs the player matched:
   * the pairs still on the board are `exclude`d and every pair cleared this
   * session is `avoid`ed.
   */
  getGamePool = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const distribution: Record<string, number> = {};
      for (const cat of OnDeckVocabController.GAME_POOL_CATEGORIES) {
        const raw = req.query[cat];
        if (raw != null) {
          const n = parseInt(String(raw), 10);
          if (Number.isFinite(n) && n > 0) distribution[cat] = n;
        }
      }
      if (Object.keys(distribution).length === 0) {
        distribution.Unfamiliar = 2;
        distribution.Target = 10;
        distribution.Comfortable = 6;
        distribution.Mastered = 2;
      }

      // Partial-refill params, all optional and defensively parsed — anything
      // unparseable falls back to full-board behavior.
      //   exclude — csv of vocab-entry ids that can NEVER come back (still on the
      //             board), filtered in SQL
      //   avoid   — csv of ids to treat as cooled (just cleared this session), only
      //             drawn if the library can't fill the board otherwise
      //   need    — how many cards to return
      const excludeIds = parseIdCsv(req.query.exclude);
      const avoidIds = parseIdCsv(req.query.avoid);
      //   seedIds — csv of vet ids the caller wants ON the board if they can take this
      //             game's marks (an flp game break's working loop —
      //             docs/FLP_GAME_BREAKS.md § 4). Partitioned server-side by
      //             `isCardGameEligible`; the ineligible ones are a fallback only.
      //             Capped at a board's worth so a malformed request can't fan out.
      const seedIds = parseIdCsv(req.query.seedIds).slice(0, MAX_SEED_IDS);
      const rawNeed = parseInt(String(req.query.need ?? ''), 10);
      const need = Number.isFinite(rawNeed) && rawNeed >= 0 ? rawNeed : undefined;

      // Which mastery track this caller's game exercises. A game's pool must be
      // bucketed by the mark type it actually EMITS (not the goal-blended overall
      // category) and must honor that type's cooldown — otherwise a card just
      // answered correctly comes straight back, while a card weak in the relevant
      // track is treated as strong because some other track is healthy.
      // See docs/MASTERY_REWORK.md § "Games select by their own mark type".
      //
      // This used to be hardcoded to 'recognition' back when Bubble Match was the
      // only caller. Speed Reading emits READING marks, so the endpoint is parameterized
      // and every caller passes `markType` explicitly — the default below is a
      // safety net for a malformed request, not a supported calling convention.
      const rawMarkType = String(req.query.markType ?? '');
      const markType: MarkType = MARK_TYPES.includes(rawMarkType as MarkType)
        ? (rawMarkType as MarkType)
        : 'recognition';

      const language = await getUserLanguage(userId);

      // ── STUDY CHALLENGE BOARD (docs/STUDY_CHALLENGE.md § 5.2) ──
      // A named, authorized challenge round short-circuits everything below: the
      // band distribution, the baseline top-up and the fallback ladder are all
      // answers to "what MIX should this board have", and a challenge board's
      // composition is already decided — the nine contested words plus
      // `mastered-first` filler. Resolved first so an out-of-window request fails
      // before any lending happens.
      const challengeRound = await this.resolveChallengeRound(req, userId);
      if (challengeRound) {
        // THE BOARD SIZE IS THE GAME'S OWN, and every caller already states it: a
        // full board is the sum of its requested distribution (Bubble Match's 20),
        // and a partial refill states `need` (a Match Speed buffer top-up). Reusing
        // those two rather than inventing a challenge-specific parameter is what
        // keeps a challenge round the same size as a casual one — the nine
        // contested words are ADDED to the board's composition, never a cap on it.
        const boardSize = need ?? Object.values(distribution).reduce((sum, n) => sum + n, 0);
        res.json(await this.onDeckVocabService.getChallengeGamePool(
          userId, challengeRound.language, markType, {
            contestedIds: challengeRound.vocabEntryIds,
            contestedWords: challengeRound.words,
            need: boardSize,
            includeContested: String(req.query.contested ?? '') !== 'exclude',
            excludeIds,
          }
        ));
        return;
      }

      // A focused world narrows the pool to today's set (the game's world is the one
      // its marks land in); an flp break (`?flpBreak=1`) draws from outside it.
      const collection = await this.applyFocus(
        res, userId, language, worldForMarkType(markType),
        String(req.query.flpBreak ?? '') === '1'
      );

      // Top up to the surface's baseline BEFORE assembling the pool, so the selection
      // below has enough rows to draw from and `sufficient` comes back true. A partial
      // refill (`need` set — Bubble Match's Play Again) skips this: the player is
      // mid-session with a board already in hand, and lending more cards there would
      // quietly grow their deck every time they tapped the button.
      //
      // The ids it lent are threaded into the pool below: selection queries are
      // sorted-only, so a lent card that is not named cannot appear in the round
      // (docs/PROVISIONAL_CARDS.md § 4b).
      let lentIds: number[] = [];
      // Never for a focused pool: it plays the day's set or a smaller board. The same
      // goes for a focused break, which has the learner's whole pile to draw on.
      if (need === undefined && collection?.kind !== 'focus' && collection?.kind !== 'outside-focus') {
        const surface = OnDeckVocabController.parseSurface(req.query.surface);
        const baseline = surface
          ? CARD_BASELINES[surface]
          : Object.values(distribution).reduce((sum, n) => sum + n, 0);
        ({ lentIds } = await this.provisionalCardService.ensureBaseline(userId, language, baseline));
      }

      // ROLLING SUPPLY (ROLLING_SUPPLY_SURFACES, contracts/wire.ts). A surface whose
      // every spawn is a refill opts out of the "refills never lend" rule above —
      // without it, a game that declares no baseline could never lend at any point in
      // a run. It is read from the SAME `?surface=` param as the baseline lookup;
      // a rolling-supply surface simply isn't in CARD_BASELINES, so `parseSurface`
      // returns null for it and the baseline branch above is a no-op even when a
      // malformed request omits `need`.
      const lendOnRefill = isRollingSupplySurface(
        typeof req.query.surface === 'string' ? req.query.surface : null
      );
      // Optional TIER OFFSET — how many levels away from the learner's own estimated
      // level to lend. Hydra maps a rolled payout tier to one (drain 0, bloom -1;
      // docs/HYDRA_BUBBLES.md § 6.2); the server resolves it against `L`, which the
      // client never sees. Bounded to the width of the 1..6 level range in both
      // directions, so a malformed value cannot be used to probe the clamp.
      const rawOffset = parseInt(String(req.query.lendLevelOffset ?? ''), 10);
      const lendLevelOffset =
        Number.isInteger(rawOffset) && rawOffset >= -5 && rawOffset <= 5 ? rawOffset : undefined;
      // STRICT BUCKETS — "these bands or nothing". Set by a caller for whom the band a
      // card came from IS the answer rather than a preference, so the pool must never
      // be topped up from outside the requested set (docs/HYDRA_BUBBLES.md § 6.2d).
      // Hydra sends it because it pays the player by the color the card was drawn as.
      const strictBuckets = String(req.query.strictBuckets ?? '') === '1';

      const pool = await this.onDeckVocabService.getGameVocabPool(
        userId, language, distribution, markType,
        { need, excludeIds, avoidIds, collection, lendOnRefill, lendLevelOffset, lentIds, strictBuckets, seedIds }
      );
      res.json(pool);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getGamePool');
    }
  };

  /**
   * Build the Word Search game grid.
   * GET /api/onDeck/wordSearchGrid?Unfamiliar=2&Target=6&Comfortable=3&Mastered=1
   * Same requested distribution + fallback semantics as the bubble-match pool,
   * plus a substring de-dup pass and snaking grid generation. Returns
   * { grid, words, rows, cols, total, available, sufficient, reason? }.
   *
   * An flp game break adds `&seedIds=` (its working loop) and `&flpBreak=1`, with the
   * same meaning as on gamePool (docs/FLP_GAME_BREAKS.md § 4, docs/FOCUS_MODE.md § 4a).
   * A Deck Tower break also sends `&board=compact` (WORD_SEARCH_BOARDS). A challenge
   * round ignores it: it always plays the standard board.
   */
  getWordSearchGrid = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const distribution: Record<string, number> = {};
      for (const cat of OnDeckVocabController.GAME_POOL_CATEGORIES) {
        const raw = req.query[cat];
        if (raw != null) {
          const n = parseInt(String(raw), 10);
          if (Number.isFinite(n) && n > 0) distribution[cat] = n;
        }
      }
      // `compact` is the Deck Tower break's smaller board; anything else is the standard one.
      const board: WordSearchBoardId = req.query.board === 'compact' ? 'compact' : 'standard';
      // A defensive fallback for a query missing all four category params: the app
      // always sends them, so this only fires on a manual/raw API call.
      if (Object.keys(distribution).length === 0) {
        Object.assign(distribution, WORD_SEARCH_BOARDS[board].distribution);
      }

      const language = await getUserLanguage(userId);
      // Board mode decides the PRIMARY mark type of this board (docs/MASTERY_REWORK.md
      // § "Games select by their own mark type"): No-Pinyin is a reading review,
      // Pinyin is a production review. That type buckets the pool by its own mark
      // history and gates freshness on its bar's cooldown clock. Default to PPE (Pinyin) if
      // the mode param is absent/unrecognized.
      //
      // PRIMARY, because a No-Pinyin find also writes a `production` mark
      // (docs/WORD_SEARCH_GAME.md § "What a find marks"). The pool is deliberately NOT
      // widened to both: a candidate has one Unfamiliar/Target/Comfortable/Mastered
      // bucket per track, and banding a board by two of them has no defined meaning.
      // The consequence is intended — the secondary production mark is judged on a
      // cooldown the board was not selected against, and may be dropped at the mark
      // endpoint.
      const mode = String(req.query.mode ?? '');
      const gameMarkType: MarkType = mode === 'no-pinyin' ? 'reading' : 'production';

      // ── STUDY CHALLENGE ROUND (docs/STUDY_CHALLENGE.md § 5.2) ──
      // Word Search is challenge-eligible as PINYIN only, and `getRoundContext`
      // enforces that by comparing the caller's (gameId, mode) against the drawn
      // sequence — a No-Pinyin board can never be a challenge round because the
      // sequence can never hold one. Nothing else about the grid changes: the same
      // generator, the same client, a bigger board and a fixed word list.
      const challengeRound = await this.resolveChallengeRound(req, userId);
      if (challengeRound) {
        // Same "de-dup pass can still come up short" failure mode as the non-challenge
        // retry loop below (see its comment), but there is no baseline to lend against
        // here — the contested nine are fixed — so escalation means asking
        // `getFillerPool` for a bigger spare queue instead of a bigger lent baseline.
        // Without this retry, a contested set that can't be cleanly de-duped even
        // against a doubled filler queue was a permanent dead end for that round.
        let fillerMultiplier = 2;
        let result = await this.onDeckVocabService.getWordSearchGrid(
          userId, challengeRound.language, distribution, gameMarkType, null, [],
          { contestedIds: challengeRound.vocabEntryIds, contestedWords: challengeRound.words, fillerMultiplier }
        );
        for (let attempt = 1; attempt <= PROVISION_RETRY_FACTOR && !result.sufficient; attempt++) {
          if (result.reason !== 'insufficient-distinct') break;
          fillerMultiplier += 1;
          result = await this.onDeckVocabService.getWordSearchGrid(
            userId, challengeRound.language, distribution, gameMarkType, null, [],
            { contestedIds: challengeRound.vocabEntryIds, contestedWords: challengeRound.words, fillerMultiplier }
          );
        }
        res.json(result);
        return;
      }

      const collection = await this.applyFocus(
        res, userId, language, worldForMarkType(gameMarkType),
        String(req.query.flpBreak ?? '') === '1'
      );
      const seedIds = parseIdCsv(req.query.seedIds).slice(0, MAX_SEED_IDS);

      // Word Search is the one surface where meeting the baseline does NOT guarantee a
      // playable round: its ten words must have mutually DISTINCT characters, which a
      // row count cannot express, so a topped-up deck can still fail the de-dup pass.
      // Escalate the baseline and retry until the grid builds or we hit the cap.
      // `shortfall > 0` means the dictionary itself ran dry, so retrying is pointless.
      // Lent ids ACCUMULATE across retries: each escalation adds to the pool the grid
      // may draw from rather than replacing it, and selection is sorted-only so an id
      // dropped from this list is a card the grid can no longer see.
      const lentIds: number[] = [];
      let result = await this.onDeckVocabService.getWordSearchGrid(
        userId, language, distribution, gameMarkType, collection, lentIds, null, seedIds, board
      );
      // A focused grid never escalates: lending cannot add to the day's set. A focused
      // break does not lend either, as on gamePool: it has the learner's whole pile.
      const mayEscalate = collection?.kind !== 'focus' && collection?.kind !== 'outside-focus';
      for (let multiplier = 1; mayEscalate && multiplier <= PROVISION_RETRY_FACTOR && !result.sufficient; multiplier++) {
        // 'language' means the game is zh-only and this user isn't studying zh —
        // no amount of lending fixes that.
        if (result.reason === 'language') break;
        const top = await this.provisionalCardService.ensureBaselineForSurface(
          userId, language, 'word-search', multiplier
        );
        // Nothing new to draw on — neither re-lent nor minted — so re-running the
        // grid would run the identical query. CONTINUE rather than break: the next
        // iteration escalates the multiplier, and it is the ESCALATION that unblocks
        // a learner whose sorted deck is already past the flat baseline but cannot
        // yield nine distinct-charactered words (`ensureBaseline` is a no-op until the
        // escalated target exceeds their sorted count). Breaking here left that
        // learner with an empty grid.
        //
        // `granted` alone is the wrong test either way: a re-lent row is not granted
        // but IS new to this grid.
        const fresh = top.lentIds.filter((id) => !lentIds.includes(id));
        if (fresh.length === 0) continue;
        lentIds.push(...fresh);
        result = await this.onDeckVocabService.getWordSearchGrid(
          userId, language, distribution, gameMarkType, collection, lentIds, null, seedIds, board
        );
      }
      res.json(result);
    } catch (error: any) {
      handleControllerError(error, res, 'OnDeckVocabController.getWordSearchGrid');
    }
  };
}
