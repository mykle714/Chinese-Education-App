import { createTurnParser, type IWTurnReply } from './turnParser.js';

/**
 * iw NPC turn runner — one model call per NPC turn, with Q7's fallback ladder.
 *
 * LAYER: service. It is the only place in iw that talks to a model, and it does so through
 * {@link IWModelRung} rather than an SDK, so a provider swap touches one adapter (§ 5.2) and
 * every test here runs against fakes with no network.
 *
 * ⚠️ **THE LADDER'S DEADLINES ARE PER RUNG, NOT PER LADDER** (§ 14 Q7). Three sequential
 * attempts at ~750 ms each is a 2.5 s turn — worse than the failure it is hiding and well
 * outside § 6's budget. **A ladder without per-rung deadlines is a slower failure, not a
 * better one**, so they are not tunable away without re-reading that section.
 *
 * ⚠️ **LIVENESS IS FIRST GLYPH, NOT `sayDone` — and that is a correction to § 14 Q7**, made
 * against measurement on 2026-09-06. Q7 says "a rung that has not produced `sayDone` by
 * ~1.2 s is dead", which was written when § 5.3 measured `sayDone` at 720 ms. Measured on the
 * first real authored scene, whose reply contract carries five long action names, the numbers
 * are quite different:
 *
 * | model | first glyph | line 1 closed | caches? |
 * |---|---|---|---|
 * | Haiku 4.5 | 792–970 ms | 792–970 ms | ❌ prefix 2175 < 4096 floor |
 * | Sonnet 5 | 715–1254 ms | 1326–1869 ms | ✅ 2175 read, 320 billed |
 *
 * A 1.2 s `sayDone` deadline therefore killed Sonnet on 4 of 4 turns, and once killed both
 * rungs and froze a scene that had a perfectly good answer coming. Worse, it threw away a
 * bubble that was ALREADY PAINTING: a rung that has emitted a glyph is alive and streaming,
 * and the learner can see it. So first glyph is the liveness test
 * ({@link RUNG_FIRST_GLYPH_DEADLINE_MS}) and `sayDone` is folded into
 * {@link RUNG_TOTAL_DEADLINE_MS}, which keeps whatever arrived instead of discarding it.
 *
 * ⚠️ **WHEN THE LADDER IS EXHAUSTED THE WORLD DOES NOTHING** (§ 14 Q7, decided). No speech,
 * no emote, no improvised cover line — the caller freezes the scene and shows a banner. This
 * is deliberately NOT the charming-canned-line option: a scene that quietly serves plausible
 * filler through a real outage is the 2026-08-21 `BILLING_DISABLED` failure mode — degraded,
 * plausible and invisible for three days. A frozen scene plus a plain banner cannot be
 * mistaken for gameplay, and will never be mistaken for the learner's own sentence being
 * wrong. `frozen` is therefore an outcome, not an error to paper over.
 *
 * ⚠️ RUNG 3 MUST BE A DIFFERENT VENDOR (§ 14 Q12). A ladder whose rungs share a provider does
 * not survive that provider's outage, which is the only failure it exists for. Nothing here
 * enforces it — it is a property of the rung list the caller assembles — so
 * {@link describeLadder} exists to make a single-vendor ladder visible in a log.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.1, § 5.2, § 6.4, § 14 Q7, § 14 Q12.
 */

/**
 * One rung: a model that can stream a turn.
 *
 * The contract is deliberately just "an async iterable of text fragments" (§ 5.2) — both
 * shapes we would consume (Anthropic's typed events, an OpenAI-compatible `delta.content`)
 * reduce to an append-only text buffer, and everything downstream is written against that
 * buffer rather than a provider's event type.
 *
 * ⚠️ FRAGMENTS SPLIT AT ARBITRARY BOUNDARIES. Never assume one fragment is one character, one
 * line, or valid on its own; `turnParser` is written for exactly this.
 */
export interface IWModelRung {
  /** For the metric and the log — the model id, e.g. `claude-haiku-4-5`. */
  id: string;
  /** The vendor, so a single-vendor ladder is visible. */
  vendor: string;
  stream(req: IWModelRequest, signal: AbortSignal): AsyncIterable<string>;
}

export interface IWModelRequest {
  /** Layers 1 + 2 — the cacheable prefix. */
  system: string;
  /** Layer 3 — the volatile turn, carrying the learner's quoted text (§ 11). */
  user: string;
  /** Short: the whole reply is three lines. */
  maxTokens: number;
}

/**
 * A rung that has not emitted a SINGLE GLYPH by this point is dead.
 *
 * 1.5 s — NOT the 1.2 s § 14 Q7 names, and the difference is measurement rather than taste.
 * Observed first glyphs span 715–1254 ms across both models on the first real authored scene,
 * so 1.2 s sits INSIDE the good case and would kill a healthy call roughly whenever the slow
 * tail is hit. 1.5 s clears the worst observed good case with ~250 ms to spare, and is still
 * short enough that a dead rung plus a live one lands inside what § 6.2's react → move → speak
 * animation covers.
 *
 * Raise this only against a new measurement, never to make a flaky rung pass.
 */
export const RUNG_FIRST_GLYPH_DEADLINE_MS = 1500;

/**
 * A hard stop for a rung that started speaking and then hung.
 *
 * ⚠️ IT DOES NOT DISCARD WHAT ARRIVED. A rung that never spoke is dead and the ladder moves
 * on; a rung that spoke and then stalled has already given the learner a bubble, so this
 * deadline stops WAITING for lines 2 and 3 and keeps the utterance, degrading the action to
 * `none` through the parser's ordinary defaults.
 *
 * 2.5 s covers the slowest measured `sayDone` (1869 ms on Sonnet 5) with room for a long
 * utterance.
 */
export const RUNG_TOTAL_DEADLINE_MS = 2500;

/** Max output tokens. Three short lines; anything longer is drift, not content. */
export const IW_TURN_MAX_TOKENS = 120;

/** What happened on one rung. Every attempt is recorded, including the successful one. */
export interface IWRungAttempt {
  id: string;
  vendor: string;
  ms: number;
  outcome: 'ok' | 'no-glyph-by-deadline' | 'empty' | 'error';
  /** Present for `error` — the message only, never the whole object. */
  error?: string;
}

export type IWTurnOutcome =
  | { kind: 'reply'; reply: IWTurnReply; rung: string; attempts: IWRungAttempt[] }
  /** Every rung failed. The caller freezes the scene and shows a banner — see the header. */
  | { kind: 'frozen'; attempts: IWRungAttempt[] };

export interface RunNpcTurnOptions {
  rungs: readonly IWModelRung[];
  request: Omit<IWModelRequest, 'maxTokens'> & { maxTokens?: number };
  /** The names offered this turn. MUST be the same array the prompt rendered (§ 5.4). */
  offered: readonly string[];
  /**
   * Called on every delta with the growing bubble text, so the client can paint from ~551 ms
   * rather than waiting for the turn at ~753 ms.
   *
   * ⚠️ IT IS CALLED FOR FAILED RUNGS TOO, and the caller must handle that: a rung can emit
   * three characters and then die, and those characters must not stay on screen when the next
   * rung starts over. `attemptIndex` changes so the caller can reset the bubble.
   */
  onDelta?: (say: string, attemptIndex: number) => void;
  /** Injectable for tests. Defaults to `Date.now`. */
  now?: () => number;
  firstGlyphDeadlineMs?: number;
  totalDeadlineMs?: number;
}

/**
 * Run one NPC turn, walking the ladder until something answers.
 *
 * A rung "answers" when it produces a non-empty reply. A rung that returns an EMPTY buffer is
 * treated as a failure and the ladder continues — § 5.3's table calls the empty reply the only
 * true parse failure, and retrying it on another model is exactly what the ladder is for.
 */
export async function runNpcTurn(options: RunNpcTurnOptions): Promise<IWTurnOutcome> {
  const {
    rungs,
    offered,
    onDelta,
    now = Date.now,
    firstGlyphDeadlineMs = RUNG_FIRST_GLYPH_DEADLINE_MS,
    totalDeadlineMs = RUNG_TOTAL_DEADLINE_MS,
  } = options;
  const request: IWModelRequest = {
    ...options.request,
    maxTokens: options.request.maxTokens ?? IW_TURN_MAX_TOKENS,
  };

  const attempts: IWRungAttempt[] = [];

  for (let i = 0; i < rungs.length; i++) {
    const rung = rungs[i];
    const started = now();
    const parser = createTurnParser(offered);
    const controller = new AbortController();
    let spoke = false;

    // Two timers rather than one: see RUNG_TOTAL_DEADLINE_MS for why the failures differ.
    const glyphTimer = setTimeout(() => {
      if (!spoke) controller.abort();
    }, firstGlyphDeadlineMs);
    const totalTimer = setTimeout(() => controller.abort(), totalDeadlineMs);

    try {
      for await (const delta of rung.stream(request, controller.signal)) {
        const progress = parser.push(delta);
        if (progress.say.length > 0) spoke = true;
        onDelta?.(progress.say, i);
      }
    } catch (err) {
      // An abort lands here too, and is NOT distinguished from a transport error on purpose:
      // both mean "this rung did not deliver", and the timing already says which.
      clearTimeout(glyphTimer);
      clearTimeout(totalTimer);
      const outcome = spoke ? 'ok' : (controller.signal.aborted ? 'no-glyph-by-deadline' : 'error');
      if (outcome !== 'ok') {
        attempts.push({
          id: rung.id,
          vendor: rung.vendor,
          ms: now() - started,
          outcome,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      // Spoke, then broke — keep what arrived and fall through to the parse below.
    }
    clearTimeout(glyphTimer);
    clearTimeout(totalTimer);

    const reply = parser.finish();
    if (reply.failed) {
      attempts.push({ id: rung.id, vendor: rung.vendor, ms: now() - started, outcome: 'empty' });
      continue;
    }
    attempts.push({ id: rung.id, vendor: rung.vendor, ms: now() - started, outcome: 'ok' });
    return { kind: 'reply', reply, rung: rung.id, attempts };
  }

  return { kind: 'frozen', attempts };
}

/**
 * A one-line summary of a ladder, for the startup log.
 *
 * ⚠️ IT NAMES A SINGLE-VENDOR LADDER OUT LOUD. Q12 makes a second vendor a REQUIREMENT rather
 * than a cost optimization — rung 3 cannot exist on one provider, and a ladder that shares a
 * vendor throughout does not survive the outage it was built for. Nothing can enforce that
 * from inside this module, so the next best thing is that a misconfiguration is legible the
 * first time somebody reads a log rather than the first time a vendor goes down.
 */
export function describeLadder(rungs: readonly IWModelRung[]): string {
  if (rungs.length === 0) return 'iw ladder: EMPTY — every turn will freeze';
  const vendors = new Set(rungs.map(r => r.vendor));
  const chain = rungs.map(r => `${r.id} (${r.vendor})`).join(' → ');
  const warning = vendors.size < 2
    ? ' ⚠️ SINGLE VENDOR — will not survive a provider outage (§ 14 Q12)'
    : '';
  return `iw ladder: ${chain}${warning}`;
}
