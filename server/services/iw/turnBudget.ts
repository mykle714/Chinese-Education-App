/**
 * iw turn budget — § 7's server-side bound on cost and abuse.
 *
 * LAYER: service (pure logic + one in-memory store). It holds no SQL and no Express types,
 * so every rule here is unit-testable against an injected clock.
 *
 * ⚠️ **THIS IS THE ONLY BOUND THAT EXISTS** (§ 7, and it says so in as many words). An
 * earlier draft of the design assumed the writing assistant's palette bounded the input by
 * construction; Q4c made the input FREE TEXT, so there is no server-issued word list and
 * nothing structural limiting what a learner can send. The endpoint must assume the client
 * was bypassed entirely — which also means every check here has to be meaningful against a
 * caller who never ran our JavaScript.
 *
 * ⚠️ **THE HEARING GATE IS NOT A COST CONTROL AT THIS BOUNDARY.** § 4.1 calls the gate the
 * primary cost control, and it is — but it runs on the CLIENT, so from the server's side a
 * caller can claim any number of NPCs heard them. That is precisely why
 * {@link IW_MAX_LISTENERS_PER_UTTERANCE} exists: it re-imposes the gate's *budget* without
 * re-implementing its geometry.
 *
 * ⚠️ **IT IS PER-PROCESS AND RESETS ON RESTART.** Deliberate for phase 2 and a real
 * limitation: the counters live in a `Map`, so a backend rebuild forgives every daily cap,
 * and a second backend replica would double them. The precedent for the durable version is
 * `dictionary_ai_usage` (migration 99), and moving there is a phase-3 decision with a
 * migration attached — it is NOT something to do quietly, because a new table needs asking
 * for. What this buys today: a scripted client cannot loop the turn endpoint, and that is
 * the failure that actually costs money.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 7, § 4.1, § 9 (the once-per-day cadence).
 */

/**
 * The hard cap on one learner utterance, in characters.
 *
 * Sized against the thing being protected, which is the PROMPT, not the database: layer 3
 * quotes the learner's text verbatim (§ 11), so an unbounded utterance is an unbounded
 * prompt and a way to blow past the cached prefix into an arbitrarily expensive call. 120
 * characters is several sentences of Chinese and far more than a beginner produces; a
 * learner who genuinely wants to say more can send it as two turns.
 */
export const IW_MAX_UTTERANCE_CHARS = 120;

/**
 * The minimum gap between two turns from the same user, in ms.
 *
 * NOT a per-IP `express-rate-limit` window (`middleware/rateLimits.ts`), because those are
 * sized to catch scripted floods over minutes and iw's abuse shape is a tight loop over
 * seconds. 700 ms is below any human's send cadence — a real turn takes ~1 s of model time
 * before the learner has even read the reply — and above what a loop can exploit.
 *
 * ⚠️ It bounds SENDS, not model calls: one send can legitimately fan out to several NPCs
 * (§ 4.1), which is what {@link IW_MAX_LISTENERS_PER_UTTERANCE} bounds instead.
 */
export const IW_MIN_TURN_GAP_MS = 700;

/**
 * How many NPCs one utterance may be routed to.
 *
 * § 4.1 decided that every audible NPC decides for itself whether to answer, so a single
 * utterance is several model calls; § 7 says the ~800 µ$/turn figure must be multiplied by
 * the audible cast size before any budget is set. The design target is 2–4, so 4 is the cap
 * and a fifth listener is dropped rather than refused — a scene with a crowd in it should
 * get quieter, not error.
 */
export const IW_MAX_LISTENERS_PER_UTTERANCE = 4;

/**
 * The session turn budget (§ 7): how many model turns one scene run may spend.
 *
 * § 7 asks for this to be surfaced IN-WORLD rather than as a quota bar — the market closes,
 * the stallholder gets tired, night falls — so the number is exposed on every response as
 * `remaining` for a HUD to dress up, and the endpoint's behaviour on exhaustion is a wind-
 * down, not an error. 60 turns is a generous single scene; § 9.3's grading prompt reads the
 * whole transcript, so an unbounded scene is also an unbounded grading prompt.
 */
export const IW_SESSION_TURN_BUDGET = 60;

/**
 * A per-user, per-local-day ceiling on turns — the backstop behind the session budget.
 *
 * The session budget bounds one *pathological* session; this bounds a caller who simply
 * starts a new session every time one runs out. § 9's once-per-day cadence is the real cap
 * and this number is what makes the cadence enforceable at all: 400 ≈ six full sessions,
 * i.e. comfortably above any honest day and far below anything that costs real money
 * (400 × ~800 µ$ ≈ 32 ¢).
 */
export const IW_DAILY_TURN_CAP = 400;

/** Why a turn was refused. `null` means it was allowed. */
export type IWBudgetRefusal =
  /** The utterance is longer than {@link IW_MAX_UTTERANCE_CHARS}. */
  | { code: 'utterance-too-long'; limit: number; got: number }
  /** Two sends closer together than {@link IW_MIN_TURN_GAP_MS}. */
  | { code: 'too-fast'; retryAfterMs: number }
  /** This scene run has spent {@link IW_SESSION_TURN_BUDGET}. Wind the scene down. */
  | { code: 'session-spent'; spent: number }
  /** This user has spent {@link IW_DAILY_TURN_CAP} today. */
  | { code: 'daily-cap'; spent: number };

export interface IWBudgetVerdict {
  refusal: IWBudgetRefusal | null;
  /** Turns left in this scene run, for the in-world HUD. */
  remaining: number;
}

/**
 * Validate one learner utterance before it reaches a prompt.
 *
 * Pure and separate from the counters on purpose: this is the check a caller wants BEFORE
 * spending a slot, and it is the one that has nothing to do with rate. Trimming first
 * matters — a client that pads with whitespace is not sending a longer sentence.
 */
export function checkUtterance(text: string): IWBudgetRefusal | null {
  const trimmed = text.trim();
  if ([...trimmed].length > IW_MAX_UTTERANCE_CHARS) {
    return { code: 'utterance-too-long', limit: IW_MAX_UTTERANCE_CHARS, got: [...trimmed].length };
  }
  return null;
}

/**
 * Trim a listener list to what one utterance may pay for.
 *
 * ⚠️ IT DROPS RATHER THAN REFUSES, and the order it keeps is the order it was given — the
 * caller sorts by distance, because the nearest NPCs are the ones a learner is plausibly
 * talking to. A refusal here would turn "you walked into a busy part of the market" into an
 * error message, which is exactly the wrong shape for a world.
 */
export function capListeners<T>(listeners: readonly T[]): T[] {
  return listeners.slice(0, IW_MAX_LISTENERS_PER_UTTERANCE);
}

interface UserBudgetState {
  lastTurnAt: number;
  /** Local-day key (`YYYY-MM-DD`) the daily count belongs to. */
  day: string;
  dayCount: number;
}

/**
 * The in-memory budget store.
 *
 * A class rather than module-level `Map`s so a test gets a fresh one per case and the
 * process gets exactly one (`iwTurnBudget` below). The clock is injectable for the same
 * reason the ladder's is: the rules being tested are all about time.
 */
export class IWTurnBudget {
  private readonly users = new Map<string, UserBudgetState>();
  private readonly sessions = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Ask whether one turn may proceed. Does NOT spend it — see {@link spend}.
   *
   * The check/spend split is deliberate: a turn that the ladder then fails to answer
   * (§ 14 Q7's frozen outcome) should not consume the learner's session budget, because
   * they got nothing for it. The caller spends only once a reply exists.
   */
  check(userId: string, sessionId: string, utterance?: string): IWBudgetVerdict {
    const spent = this.sessions.get(sessionId) ?? 0;
    const remaining = Math.max(0, IW_SESSION_TURN_BUDGET - spent);

    if (utterance !== undefined) {
      const bad = checkUtterance(utterance);
      if (bad) return { refusal: bad, remaining };
    }

    const now = this.now();
    const state = this.users.get(userId);
    if (state) {
      const gap = now - state.lastTurnAt;
      if (gap < IW_MIN_TURN_GAP_MS) {
        return { refusal: { code: 'too-fast', retryAfterMs: IW_MIN_TURN_GAP_MS - gap }, remaining };
      }
      if (state.day === this.dayKey(now) && state.dayCount >= IW_DAILY_TURN_CAP) {
        return { refusal: { code: 'daily-cap', spent: state.dayCount }, remaining };
      }
    }

    if (spent >= IW_SESSION_TURN_BUDGET) {
      return { refusal: { code: 'session-spent', spent }, remaining: 0 };
    }
    return { refusal: null, remaining };
  }

  /**
   * Record that a turn was actually taken.
   *
   * `turns` is the number of MODEL CALLS the send fanned out to (§ 4.1), so a send heard by
   * three NPCs costs three against the daily cap — the cap is a money bound and money is
   * spent per call. The session budget counts SENDS, because that is what the in-world HUD
   * is dressing up: "the market closes in 12 more things you say" is legible, "in 37 model
   * calls" is not.
   */
  spend(userId: string, sessionId: string, turns = 1): void {
    const now = this.now();
    const day = this.dayKey(now);
    const state = this.users.get(userId);
    if (!state || state.day !== day) {
      this.users.set(userId, { lastTurnAt: now, day, dayCount: turns });
    } else {
      state.lastTurnAt = now;
      state.dayCount += turns;
    }
    this.sessions.set(sessionId, (this.sessions.get(sessionId) ?? 0) + 1);
  }

  /** Turns left in a scene run, for a HUD that wants it without asking permission. */
  remaining(sessionId: string): number {
    return Math.max(0, IW_SESSION_TURN_BUDGET - (this.sessions.get(sessionId) ?? 0));
  }

  /**
   * Forget a finished scene run.
   *
   * ⚠️ WITHOUT THIS THE MAP LEAKS. Session ids are per scene run and never reused, so every
   * played scene would otherwise leave a permanent entry. The endpoint calls it when a run
   * ends; a process that never sees an end (a learner who closes the tab) leaks one integer,
   * which is the acceptable half of the trade.
   */
  endSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Test seam. */
  reset(): void {
    this.users.clear();
    this.sessions.clear();
  }

  /**
   * The local-day key.
   *
   * ⚠️ SERVER-LOCAL, not the learner's timezone — unlike `dictionary_ai_usage`, which keys
   * on the client's local day. That is a real inconsistency and it is tolerated here because
   * this cap is an ABUSE backstop rather than a fairness quota: nobody legitimate reaches
   * 400 turns, so which midnight resets it does not change any honest learner's experience.
   * If this ever becomes a user-visible allowance it must move to the client's day, and to
   * the database, in the same change.
   */
  private dayKey(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

/** The process-wide budget. One per backend; see the header's per-process caveat. */
export const iwTurnBudget = new IWTurnBudget();
