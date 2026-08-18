/**
 * studyChallenges.ts — the client's typed calls against /api/studyChallenges/*.
 *
 * Mirrors server/types/studyChallenge.ts; keep the two in step. See
 * docs/STUDY_CHALLENGE.md.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 none of these take a `token`: they go through
 * src/api/http.ts, which resolves the Authorization header at call time.
 *
 * ⚠️ TWO FIELDS ARE DELIBERATELY ABSENT FROM SOME RESPONSES, and the client must
 * treat their absence as meaningful rather than as an error:
 *   * `gameSequence` is undefined until the viewer's own test window opens (Q63).
 *     The server omits it; do not try to derive or cache it early.
 *   * `opponentRounds` is undefined until BOTH players have finished (§ 6). Only
 *     `opponentFinished` (progress, not score) is available before then.
 */
import { apiGet, apiPost, apiPut, apiDelete, withFallback } from './http';
import type {
  ChallengeGameRef,
  ChallengeRound,
  ChallengeScoreBreakdown,
  ChallengeStatus,
  ChallengeVariant,
  ChallengeWord,
  Language,
} from '../types';

/** The other player in a challenge. */
export interface ChallengeOpponent {
  userId: string;
  name: string | null;
  email: string;
  avatarIconId: string | null;
}

/**
 * Deadlines, all as UTC instants, computed server-side from the challenge's anchor
 * plus each player's CURRENT timezone.
 *
 * `testOpensAt`/`testClosesAt` are the VIEWER's own window, not their opponent's —
 * in async mode the two do not coincide, and rendering the opponent's would tell a
 * player the wrong time.
 *
 * Render these as the user experiences them ("until 4 AM Wednesday") and never as
 * "midnight": every boundary is 04:00 local, so "midnight" copy is four hours wrong.
 */
export interface ChallengeDeadlines {
  acceptDeadline: string;
  testOpensAt: string;
  testClosesAt: string;
}

/** One challenge from the viewer's point of view. */
export interface ChallengeSummary {
  id: string;
  variant: ChallengeVariant;
  status: ChallengeStatus;
  /** True when the viewer issued it — they may withdraw; the other side declines. */
  isChallenger: boolean;
  opponent: ChallengeOpponent;
  /** The language the VIEWER plays in; may differ from the opponent's (§ 8). */
  language: Language;
  words: ChallengeWord[];
  rounds: Record<string, ChallengeRound>;
  /** Progress only — never a score. */
  opponentFinished: boolean;
  /** Present only once both players have finished. See the module warning. */
  opponentRounds?: Record<string, ChallengeRound>;
  presetDeckId: number | null;
  /** Present only once the viewer's window is open. See the module warning. */
  gameSequence?: ChallengeGameRef[];
  /** How many rounds this test is — may be fewer than 3 for a cross-language pair. */
  roundCount: number;
  deadlines: ChallengeDeadlines;
  issuedAt: string;
  completedAt: string | null;
  winnerUserId: string | null;
}

/** Why a friend cannot be challenged. Only `at-cap` is explained to the user. */
export type ChallengeBlockedReason = 'at-cap' | 'declined-this-week' | 'unavailable';

/**
 * One row of the challenges page — A FRIEND, not a challenge.
 *
 * The row is present whether or not a challenge is active, and it carries the whole
 * lifecycle: Challenge → Waiting on them / Review words → Play test → See results.
 */
export interface ChallengeFriendRow {
  friend: ChallengeOpponent;
  challenge: ChallengeSummary | null;
  /**
   * Whoever won the pair's most recent RESOLVED challenge — the 👑. A draw or a
   * no-contest leaves the previous champion in place, so this only changes hands
   * when somebody wins. There is deliberately no lifetime W–L anywhere.
   */
  championUserId: string | null;
  canChallenge: boolean;
  blockedReason: ChallengeBlockedReason | null;
  /** Whether the VIEWER has set their own half of the per-pair opt-out. */
  viewerBlocked: boolean;
}

export interface ChallengesPageResponse {
  rows: ChallengeFriendRow[];
  activeCount: number;
  maxActive: number;
}

/** A word offered in the review flow, before it is a card. */
export interface ChallengeCandidate {
  dictionaryEntryId: number;
  word1: string;
  language: Language;
  pronunciation: string | null;
  definition: string | null;
  difficulty: number | null;
  frequencyScore: number | null;
  /** icons8 icon for the mini preview card; null when unassigned. */
  iconId: string | null;
}

/**
 * The challenges page, scoped to the viewer's current language — so a friend who
 * studies only Spanish does not appear on the Chinese page.
 */
export function fetchChallengesPage(): Promise<ChallengesPageResponse> {
  return withFallback(
    apiGet<ChallengesPageResponse>('/api/studyChallenges'),
    'Could not load your challenges'
  );
}

/**
 * The badge count — how many challenges want the viewer's attention.
 *
 * ⚠️ LANGUAGE-BLIND on purpose. There are no notifications of any kind, so this
 * badge chain is the only way a player learns a challenge exists; scoping it would
 * hide exactly the cross-language challenge that is otherwise invisible.
 */
export function fetchChallengeBadge(): Promise<{ count: number }> {
  return withFallback(
    apiGet<{ count: number }>('/api/studyChallenges/badge'),
    'Could not load your challenge count'
  );
}

/**
 * The History log, newest first. Keyset-paginated on `completedAt`: pass the last
 * row's `completedAt` as `before` for the next page. Not language-scoped.
 */
export function fetchChallengeHistory(
  limit = 20,
  before?: string | null
): Promise<ChallengeSummary[]> {
  return withFallback(
    apiGet<ChallengeSummary[]>('/api/studyChallenges/history', {
      params: { limit, before: before ?? undefined },
    }),
    'Could not load your challenge history'
  );
}

/** One challenge. */
export function fetchChallenge(challengeId: string): Promise<ChallengeSummary> {
  return withFallback(
    apiGet<ChallengeSummary>(`/api/studyChallenges/${encodeURIComponent(challengeId)}`),
    'Could not load that challenge'
  );
}

/**
 * The ten words to review.
 *
 * `struck` carries the words already marked known in THIS review session, so the
 * server can replace them from the same ranked list. It is passed on every call
 * rather than held server-side because an abandoned review must leave nothing
 * behind — the only thing a strike persists is the Mastered write on the striker's
 * own card (see `strikeChallengeWord`).
 */
export function fetchChallengeCandidates(
  friendUserId: string,
  variant: ChallengeVariant,
  struck: string[] = []
): Promise<ChallengeCandidate[]> {
  return withFallback(
    apiGet<ChallengeCandidate[]>('/api/studyChallenges/candidates', {
      params: {
        friendUserId,
        variant,
        struck: struck.length > 0 ? struck.join(',') : undefined,
      },
    }),
    'Could not load challenge words'
  );
}

/** Issue a challenge in the viewer's current language. */
export function issueChallenge(
  friendUserId: string,
  variant: ChallengeVariant,
  struckWords: string[] = []
): Promise<ChallengeSummary> {
  return withFallback(
    apiPost<ChallengeSummary>('/api/studyChallenges', { friendUserId, variant, struckWords }),
    'Could not send the challenge'
  );
}

/**
 * What a strike sends alongside the word so the server can draw its replacement.
 *
 * `friendUserId` (challenger, no challenge exists yet) or `challengeId` (challengee,
 * reviewing a stored set) picks the band's other player; `exclude` is every word on
 * screen plus every word struck this session, so the draw cannot return a duplicate.
 */
export interface StrikeReplacementContext {
  friendUserId?: string;
  challengeId?: string;
  variant?: ChallengeVariant;
  exclude?: string[];
}

/**
 * "I already know this word."
 *
 * ⚠️ THIS WRITES TO THE USER'S OWN CARD — it promotes the word to Mastered on the
 * core bar, through the same path discover's Already-Learned sort uses. It is not a
 * challenge-local gesture, and the consequence (the word leaves discover and every
 * future challenge) is permanent. There is no cap on strikes, deliberately: the cost
 * falls entirely on the striker, which is what makes the picker self-policing.
 */
export function strikeChallengeWord(
  target: { dictionaryEntryId?: number; word1?: string },
  context: StrikeReplacementContext = {}
): Promise<ChallengeCandidate | null> {
  // Either handle works. The challenger holds candidate det ids; the challengee is
  // reviewing a STORED set that carries only the word, so they pass `word1` and the
  // server resolves it.
  //
  // The response carries the ONE word that takes the struck word's slot, so the
  // caller splices a single tile instead of reloading the list. `null` means the
  // discoverable supply is exhausted — the slot simply goes away and the set is
  // short, which § 3.1 allows.
  return withFallback(
    apiPost<{ replacement: ChallengeCandidate | null }>(
      '/api/studyChallenges/strike',
      { ...target, ...context }
    ).then((res) => res?.replacement ?? null),
    'Could not mark that word as known'
  );
}

/**
 * Accept, with whatever words the challengee struck while reviewing the set — and
 * the replacements the server handed back for them.
 *
 * `replacementWords` is echoed so the accepted set is the set that was ON SCREEN.
 * The server re-resolves every word against the det before honouring it, so this is
 * a verified echo rather than a trusted client-authored word list.
 */
export function acceptChallenge(
  challengeId: string,
  struckWords: string[] = [],
  replacementWords: string[] = []
): Promise<ChallengeSummary> {
  return withFallback(
    apiPost<ChallengeSummary>(
      `/api/studyChallenges/${encodeURIComponent(challengeId)}/accept`,
      { struckWords, replacementWords }
    ),
    'Could not accept the challenge'
  );
}

/** Decline (challengee). The row survives as `declined` and blocks the pair until next Monday. */
export function declineChallenge(challengeId: string): Promise<void> {
  return withFallback(
    apiPost<void>(`/api/studyChallenges/${encodeURIComponent(challengeId)}/decline`),
    'Could not decline the challenge'
  );
}

/**
 * Withdraw (challenger). The row is DELETED, freeing the pair's week immediately —
 * unlike a decline, which keeps its slot as the cooldown. This is the repair for a
 * challenge sent to the wrong friend.
 */
export function withdrawChallenge(challengeId: string): Promise<void> {
  return withFallback(
    apiDelete<void>(`/api/studyChallenges/${encodeURIComponent(challengeId)}`),
    'Could not withdraw the challenge'
  );
}

/**
 * Submit a finished round.
 *
 * The client is the score's author (§ 5.6): send the total AND the breakdown, both
 * derived from the SAME accumulator, never recomputed for display — otherwise the
 * card on screen can disagree with the number stored and there is nothing to
 * arbitrate.
 *
 * A submitted round is FINAL. Resubmitting rejects rather than overwriting, so treat
 * a failure here as "already recorded", not as "retry with a different score".
 */
export function submitChallengeRound(
  challengeId: string,
  roundIndex: number,
  score: number,
  breakdown: ChallengeScoreBreakdown
): Promise<ChallengeSummary> {
  return withFallback(
    apiPost<ChallengeSummary>(
      `/api/studyChallenges/${encodeURIComponent(challengeId)}/rounds`,
      { roundIndex, score, breakdown }
    ),
    'Could not save your round'
  );
}

/**
 * Set or clear the viewer's half of the per-pair opt-out.
 *
 * The effect is symmetric even though ownership is not: setting it stops the
 * viewer's own outgoing challenges to that friend as well as their incoming ones.
 * The friend is never told.
 */
export function setChallengeBlock(friendUserId: string, blocked: boolean): Promise<void> {
  return withFallback(
    apiPut<void>(
      `/api/studyChallenges/blocks/${encodeURIComponent(friendUserId)}`,
      { blocked }
    ),
    'Could not update that setting'
  );
}
