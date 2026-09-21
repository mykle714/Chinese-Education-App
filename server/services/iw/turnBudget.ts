import {
  IW_MAX_LISTENERS_PER_UTTERANCE,
  IW_MAX_UTTERANCE_CHARS,
  IW_MIN_TURN_GAP_MS,
} from '../../contracts/iw.js';

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
 * ⚠️ **{@link IW_MAX_LISTENERS_PER_UTTERANCE} IS NOW THE WHOLE FAN-OUT BUDGET** (2026-09-07).
 * § 4.1 used to name the earshot gate as the primary cost control and this cap as a server-side
 * restatement of it. The gate is withdrawn — everyone in a scene hears everything — so there is
 * no geometry left to restate and no distance at which a scene gets cheaper. The cap is not a
 * backstop for an untrusted client any more; it is the only thing bounding what one utterance
 * costs, on the honest path as much as the hostile one.
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
 * ⚠️ THREE OF § 7's FIVE NUMBERS LIVE IN THE CONTRACT, NOT HERE (2026-09-06).
 *
 * `IW_MAX_UTTERANCE_CHARS`, `IW_MIN_TURN_GAP_MS` and `IW_MAX_LISTENERS_PER_UTTERANCE` moved to
 * `server/contracts/iw.ts` and are re-exported below, because the CLIENT has to respect them
 * to behave well: the composer counts characters against the cap, the send button waits out
 * the gap, and the send path caps its own fan-out. A client that has to guess a server
 * limit gets it wrong the first time the limit is tuned — a refusal the learner sees as the
 * game losing their sentence.
 *
 * The two that did NOT move are the two the server enforces alone. A learner never needs to
 * know how many turns a session holds — `remaining` rides back on every reply — and the daily
 * cap is deliberately not a number anybody is shown (§ 7 asks for the wind-down to read
 * in-world, not as a quota bar).
 */
export {
  IW_MAX_UTTERANCE_CHARS,
  IW_MAX_LISTENERS_PER_UTTERANCE,
  IW_MIN_TURN_GAP_MS,
} from '../../contracts/iw.js';

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

/**
 * ⚠️ **BOTH TURN CEILINGS ARE LIFTED FOR TEMPLATE AUTHORS** ({@link IWBudgetOptions.unlimited},
 * 2026-09-20). An author testing a scene replays it dozens of times in a sitting: they burn a
 * 60-turn session run per replay and can reach the 400/day money backstop in an afternoon, at
 * which point the tool they are building with refuses to run. The grant is the existing
 * `users.isTemplateAuthor` (migration 115) — the same one that opens the editor at all — and the
 * resolution happens in `ImmersiveWorldService`, because this file holds no SQL.
 *
 * What is NOT lifted, deliberately: {@link IW_MIN_TURN_GAP_MS} and {@link IW_MAX_UTTERANCE_CHARS}.
 * Those two are also enforced CLIENT-side (see the note above), so relaxing them here alone would
 * change nothing an author could observe — and the rate gap is a runaway-loop guard, which an
 * author's browser needs as much as a learner's.
 *
 * The counters still INCREMENT for an exempt user; only the refusals are skipped. An author's
 * spend stays visible to anything that reads the store, and a flag flipped off takes effect on
 * the very next turn rather than starting them from zero.
 */
export interface IWBudgetOptions {
  /** This caller is a template author — skip the session budget and the daily cap. */
  unlimited?: boolean;
}

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
  check(userId: string, sessionId: string, utterance?: string, opts: IWBudgetOptions = {}): IWBudgetVerdict {
    const spent = this.sessions.get(sessionId) ?? 0;
    const remaining = this.remaining(sessionId, opts);

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
      if (!opts.unlimited && state.day === this.dayKey(now) && state.dayCount >= IW_DAILY_TURN_CAP) {
        return { refusal: { code: 'daily-cap', spent: state.dayCount }, remaining };
      }
    }

    if (!opts.unlimited && spent >= IW_SESSION_TURN_BUDGET) {
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
  /**
   * ⚠️ `turns` IS VESTIGIAL AND HAS NEVER BEEN EXERCISED (§ 7, 2026-09-07). It exists because
   * § 4.1 made one utterance several model calls, and the session was meant to be charged once
   * for the utterance rather than once per call. The endpoint always took a single npcId, so
   * the client fanned out and every caller passed 1 — and since § 4.2 routes to exactly one
   * NPC, 1 is now also CORRECT rather than merely what happens. Keep the parameter until
   * something genuinely fans out again; do not read it as working fan-out billing.
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

  /**
   * Ask whether a NON-TURN model call may proceed — a line render (§ 14 Q42) or an addressee
   * route (§ 4.2).
   *
   * ⚠️ **RENAMED FROM `checkRender` (2026-09-07)** when the addressee router became the second
   * caller. The rule was never about rendering; it is about a call the SCENE makes rather than
   * one the learner's sentence makes, and those bill differently. `checkRender` would now be
   * one of two callers naming the whole category after itself.
   *
   * ⚠️ **SUCH A CALL IS BILLED AGAINST THE DAILY CAP AND NOTHING ELSE**, and each exclusion is
   * deliberate:
   *
   *   - **Not the session budget.** That counter is dressed up in-world as "the market is
   *     closing", and it counts things the LEARNER says. Charging it for an NPC's own
   *     scripted beats would shorten a scene in proportion to how much was authored into it,
   *     which is exactly backwards — and charging it for the ROUTER would bill a learner twice
   *     for one sentence, once to work out who they meant and once for the answer.
   *   - **Not the rate gap.** {@link IW_MIN_TURN_GAP_MS} exists to stop a learner spamming
   *     sends. A script legitimately renders several lines in a row with nothing but a walk
   *     between them, so the gap would refuse the scene's own content.
   *   - **But yes, the daily cap.** That one is a MONEY bound, and both of these are model
   *     calls that cost money. A scene that could generate unbounded lines — or route
   *     unbounded utterances — without touching the cap would be a hole straight through § 7.
   */
  checkSceneCall(userId: string, opts: IWBudgetOptions = {}): IWBudgetRefusal | null {
    if (opts.unlimited) return null;
    const state = this.users.get(userId);
    if (state && state.day === this.dayKey(this.now()) && state.dayCount >= IW_DAILY_TURN_CAP) {
      return { code: 'daily-cap', spent: state.dayCount };
    }
    return null;
  }

  /**
   * Record one non-turn model call against the daily cap only.
   *
   * Deliberately does NOT touch `lastTurnAt`: that field is the learner's rate gap, and a
   * render happening mid-script would otherwise make their next sentence be refused as
   * "too fast" for something they did not do. The router needs the same exemption for the
   * opposite reason — it runs a few hundred ms BEFORE the turn it belongs to, so stamping the
   * gap there would make every learner's own turn refuse itself.
   */
  spendSceneCall(userId: string): void {
    const now = this.now();
    const day = this.dayKey(now);
    const state = this.users.get(userId);
    if (!state || state.day !== day) {
      // `lastTurnAt: 0` rather than `now` — see the note above. Epoch 0 is unambiguously
      // "they have not spoken yet", and the gap check reads it as such.
      this.users.set(userId, { lastTurnAt: state?.lastTurnAt ?? 0, day, dayCount: 1 });
    } else {
      state.dayCount += 1;
    }
  }

  /**
   * Turns left in a scene run, for a HUD that wants it without asking permission.
   *
   * ⚠️ An `unlimited` caller is always reported as having the FULL budget rather than a
   * draining one. The number is dressed up in-world ("the market is closing"), so a count that
   * fell to 0 while turns kept working would be telling an author a story about their scene
   * that is not true. Their real spend is still in the counters; it is just not this number.
   */
  remaining(sessionId: string, opts: IWBudgetOptions = {}): number {
    if (opts.unlimited) return IW_SESSION_TURN_BUDGET;
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
