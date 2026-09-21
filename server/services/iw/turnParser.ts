import { IW_DEFAULT_EMOTE, IW_EMOTES, IW_NO_ACTION, type IWEmote } from '../../contracts/iw.js';

/**
 * iw turn parser — the streaming state machine that turns a model's text deltas into a
 * speech bubble, an action name and an emote (§ 5.1, § 5.3).
 *
 * LAYER: service (pure). No I/O, no clock, no model client — it is handed strings and
 * returns values, so the whole of the app's least predictable input is unit-testable.
 *
 * ⚠️ IT HAS NO ERROR PATH, ONLY DEGRADED OUTPUTS, and that is a requirement rather than an
 * omission. It runs on every delta in front of a player who is watching a bubble fill; a
 * throw here is a frozen NPC. Every rule below has a default, so `push` and `finish` cannot
 * fail on any input, including the empty string and pure garbage.
 *
 * ⚠️ IT IS TOLERANT OF DRIFT AROUND A KNOWN FORMAT, NOT AGNOSTIC TO FORMAT (§ 5.3). The
 * three-line shape is asked for in the prompt and is what the model produces; this absorbs
 * the handful of things a model plausibly does anyway — a volunteered ``` fence, a speaker
 * label, a blank line, a missing third line, or a whole JSON object. It is insurance. The
 * primary mechanism is the prompt and the verification mechanism is the bench.
 *
 * ⚠️ A TOLERANT PARSER CAN FLATTER A BENCHMARK (§ 5.3). Once it degrades a junk action to
 * `none`, a naive grader reports "100% legal actions" and is measuring its own error
 * handling. {@link IWTurnReply.rescued} therefore records whether the MODEL supplied a
 * readable action and emote, so a metric over this parser can report `cleanAction` rather
 * than `legalAction`. Any future measurement needs that split.
 *
 * WHY STREAMING AND NOT THE BENCH'S WHOLE-BUFFER PARSE. `scenario.js` → `FORMATS.lines.parse`
 * implements the same rules over a finished string, which is all a latency bench needs. The
 * game needs the bubble to start painting at the first delta (~551 ms) rather than at the
 * last (~753 ms), so this splits the same rules into a cheap per-delta path
 * ({@link IWTurnParser.push}, which only ever looks at line 1) and a full tolerant pass at
 * the end ({@link IWTurnParser.finish}). The rules are deliberately identical; if one
 * changes, the other must.
 *
 * ⚠️ Measured caveat (§ 5.3): line 1 *completing* is NOT early — the newline closing it
 * lands ~33 ms before the last token, because lines 2 and 3 are about six tokens together.
 * Anything needing the whole utterance (a TTS call, a length-aware layout) gets essentially
 * no head start. Only the bubble's FIRST glyph is genuinely early.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.1, § 5.2, § 5.3, § 5.4.
 */

/** One parsed NPC turn. Every field is always present — see the no-error-path note above. */
export interface IWTurnReply {
  /** What the NPC says. Empty when they chose silence (`NOTHING`) or said nothing readable. */
  say: string;
  /**
   * The name of the authored action to run, exactly as offered, or {@link IW_NO_ACTION}.
   *
   * ⚠️ ALWAYS one of the names the caller offered. The engine must still check it against
   * live world state before executing (§ 5.4), but it can never be a name this scene does
   * not contain — an invented action degrades to `none` here.
   */
  action: string;
  emote: IWEmote;
  /**
   * What the parser had to rescue. Empty when the model produced a clean three-line reply.
   * Diagnostics only — never shown to a player.
   */
  rescued: string[];
  /** True when the reply was empty or unreadable — § 14 Q7's canned-line fallback. */
  failed: boolean;
  /**
   * The optional fourth line, present only on a `get_information` turn (2026-09-20).
   *
   * ⚠️ **ABSENT MEANS `false`, AND THAT IS THE SAFE DIRECTION.** A model that drops the line —
   * or a turn that was never collecting in the first place — reads as "not yet", so the worst
   * a missing line costs is one more exchange before the step's own turn cap ends it. The
   * opposite default would end an errand nobody finished.
   *
   * Named `collected` rather than `got` because `IWTurnRefusal.got` on the client already
   * means something unrelated (the value that broke a limit), and two `got`s reading in the
   * same breath is the kind of thing that survives a review and then bites.
   */
  collected: boolean;
}

const EMOTE_SET: ReadonlySet<string> = new Set<string>(IW_EMOTES);

/**
 * The optional `got:` line of a `get_information` turn (§ 5.4).
 *
 * Tolerant in the two ways a model actually drifts around a labelled line — a bare `yes`/`no`
 * without the label would be ambiguous against speech, so the LABEL is required and only the
 * decoration around it is not.
 */
const COLLECT_LINE = /^got\s*[:：]\s*(yes|no)\b/i;

/**
 * Strip a speaker label (`王婶：`, `SAY:`) and wrapping quotes from a speech line.
 *
 * The label pattern is capped at 8 characters before the colon so it cannot eat a real
 * sentence that happens to contain one — Chinese punctuation includes `：` mid-utterance,
 * and "他说：不行" is speech, not a label.
 */
function stripSpeechDecoration(line: string): string {
  return line
    .replace(/^[^：:]{1,8}[：:]\s*/, '')
    .replace(/^["'“”](.*)["'”“]$/, '$1');
}

/** A fence line the model volunteered — dropped wherever it appears. */
const isFenceLine = (line: string): boolean => /^```/.test(line);

/**
 * Parse a JSON envelope, for the one realistic drift: a model that decided to emit an object.
 *
 * Returns null when the buffer is not usable JSON, so the caller falls through to the line
 * rules rather than failing. The regex pulls the outermost `{...}` so a fence or a sentence
 * around it does not matter.
 */
function parseJsonEnvelope(buffer: string, offered: readonly string[]): IWTurnReply | null {
  const match = buffer.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null; // The only try/catch here, and it degrades rather than throwing.
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const say = typeof obj.say === 'string' ? obj.say : '';
  const action = typeof obj.action === 'string' && offered.includes(obj.action)
    ? obj.action
    : IW_NO_ACTION;
  const emote = typeof obj.emote === 'string' && EMOTE_SET.has(obj.emote)
    ? (obj.emote as IWEmote)
    : IW_DEFAULT_EMOTE;
  return {
    say: say === 'NOTHING' ? '' : say,
    action,
    emote,
    rescued: ['emitted JSON, not lines'],
    failed: false,
    // The JSON shape the model volunteers uses the contract's own key, `got`.
    collected: obj.got === true || obj.got === 'yes',
  };
}

/**
 * The full tolerant parse over a finished buffer (§ 5.3 rules 0–4).
 *
 * `offered` is the list of action names THIS NPC was given THIS turn. Passing a different
 * list than the prompt offered would grade a fiction (§ 5.4), so the caller must hand over
 * the same array it rendered into the prompt.
 */
export function parseTurnReply(buffer: string, offered: readonly string[] = []): IWTurnReply {
  const trimmed = buffer.trim();
  if (!trimmed) {
    // The only true failure (§ 5.3's table) — the caller falls back to a canned line.
    return { say: '', action: IW_NO_ACTION, emote: IW_DEFAULT_EMOTE, rescued: ['empty reply'], failed: true, collected: false };
  }

  // Rule 0 — shape sniff. Only when the buffer actually opens with an envelope, so a reply
  // that merely mentions a brace in its speech is not hijacked.
  if (trimmed.startsWith('{') || trimmed.startsWith('```')) {
    const viaJson = parseJsonEnvelope(trimmed, offered);
    if (viaJson) return viaJson;
  }

  const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l && !isFenceLine(l));
  if (!lines.length) {
    return { say: '', action: IW_NO_ACTION, emote: IW_DEFAULT_EMOTE, rescued: ['empty reply'], failed: true, collected: false };
  }

  const rescued: string[] = [];

  // Rule 2 — line 1 is the first non-empty line.
  let say = stripSpeechDecoration(lines[0]);
  if (say !== lines[0]) rescued.push('stripped label/quotes');
  if (say === 'NOTHING') say = '';

  // Rules 3 and 4 — SCAN the remainder rather than indexing lines 2 and 3, which is what
  // survives an inserted blank line or a stray label.
  //
  // The whole line is matched against the offered names, not its first token: an action is a
  // name now (§ 14 Q42) and a name may contain spaces ("bring water").
  const rest = lines.slice(1);
  const actionLine = rest.find(l => offered.includes(l));
  const emoteLine = rest.find(l => EMOTE_SET.has(l));
  // Scanned like the other two rather than indexed at 3, for the same reason: a blank line or
  // a stray label must not move it. Only ever present on a collecting turn, so its ABSENCE is
  // never rescued — there is nothing here that knows whether one was asked for.
  const collectLine = rest.find(l => COLLECT_LINE.test(l));
  if (!actionLine) rescued.push(`no legal action line → ${IW_NO_ACTION}`);
  if (!emoteLine) rescued.push('no legal emote line → neutral');
  // The `got:` line is a legal third member of `rest`, so it is discounted before the
  // extra-lines rescue fires — otherwise every collecting turn would report drift.
  if (rest.length > (collectLine ? 3 : 2)) rescued.push('extra lines');

  return {
    say,
    action: actionLine ?? IW_NO_ACTION,
    emote: (emoteLine as IWEmote | undefined) ?? IW_DEFAULT_EMOTE,
    rescued,
    collected: collectLine ? /yes/i.test(collectLine) : false,
    // A reply with no speech AND no action is indistinguishable from silence the model did
    // not intend; it is still not a failure, because `NOTHING` + `none` is a legal turn
    // (§ 4.1 — deciding to stay quiet is a normal reply).
    failed: false,
  };
}

/** What the host needs to paint the bubble mid-stream. */
export interface IWTurnProgress {
  /** The speech so far, label already stripped. Safe to render every delta. */
  say: string;
  /** True once the newline closing line 1 has arrived — the utterance will not grow. */
  speechComplete: boolean;
}

/**
 * A per-turn streaming parser. Feed it deltas, read the bubble, then `finish()`.
 *
 * Deliberately a closure over a plain string rather than a class: there is exactly one
 * mutable thing (the buffer) and no lifecycle beyond it.
 */
export interface IWTurnParser {
  /** Append one delta and get the bubble state. Cheap — it only inspects line 1. */
  push(delta: string): IWTurnProgress;
  /** The full tolerant parse. Safe to call more than once, and before the stream ends. */
  finish(): IWTurnReply;
  /** Everything received so far — for logging a reply that went wrong. */
  raw(): string;
}

export function createTurnParser(offered: readonly string[] = []): IWTurnParser {
  let buffer = '';

  /**
   * The provisional bubble text.
   *
   * ⚠️ IT MUST NOT strip `NOTHING` mid-stream. "NOTHING" is also a prefix of nothing else the
   * model emits, but a partial delta could read `NOTH` — blanking on a prefix would make the
   * bubble flicker. Silence is applied at `finish`, which is correct because a bubble is not
   * shown until at least one character exists anyway.
   */
  function progress(): IWTurnProgress {
    const newlineAt = buffer.indexOf('\n');
    const firstLine = (newlineAt === -1 ? buffer : buffer.slice(0, newlineAt)).trim();
    // A leading fence the model volunteered is not speech; wait for the real first line.
    if (isFenceLine(firstLine)) return { say: '', speechComplete: false };
    return {
      say: firstLine === 'NOTHING' ? '' : stripSpeechDecoration(firstLine),
      speechComplete: newlineAt !== -1,
    };
  }

  return {
    push(delta: string): IWTurnProgress {
      buffer += delta;
      return progress();
    },
    finish: () => parseTurnReply(buffer, offered),
    raw: () => buffer,
  };
}
