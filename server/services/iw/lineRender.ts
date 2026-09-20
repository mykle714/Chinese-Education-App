import { renderLineWorldRules } from './worldRules.js';
import { renderContextSections, type IWContextInput } from './turnState.js';
import { runLadder, type IWLadderSink, type IWModelRung, type IWRungAttempt } from './npcTurn.js';

/**
 * iw LINE RENDER — putting an authored direction into an NPC's own words (§ 14 Q42).
 *
 * LAYER: service (pure apart from the model call, which arrives as an injected ladder).
 *
 * ⚠️ **AN AUTHORED LINE IS NEVER SPOKEN VERBATIM, AND THIS IS WHY THE MODULE EXISTS.** Until
 * this landed, a `comment` step's text and a conversation turn's text went straight from the
 * scene row to the learner's screen. Two things were wrong with that, one cosmetic and one
 * structural:
 *
 *   1. **Cosmetic, and the symptom that got it noticed.** Authors write directions in
 *      English — "greet them and ask what they want" — and the client's `guardNpcLine` quite
 *      correctly refused to speak English at a Mandarin learner. The whole authored half of
 *      the first real scene was silently dropped, which read as an NPC walking over to say
 *      nothing.
 *   2. **Structural, and the actual point.** An NPC has a register, a mood, a history and a
 *      memory of what it has just heard. A verbatim line has none of those — it is the same
 *      sentence whether the learner was rude or charming, whether this NPC is 王婶 or 老周,
 *      and whether it is the first or the third time. Piping the direction through the model
 *      is what makes the authored beat happen IN CHARACTER rather than merely happen.
 *
 * ⚠️ **ONE CALL PER LINE, RESOLVED WHERE THE SCRIPT REACHES IT.** § 14 Q42 originally
 * proposed generating a whole action's comments together, once, so the latency would hide
 * behind the first walk. That is wrong, and the correction is worth keeping: an action's
 * steps can include `wait_for_response`, so a script STRADDLES the learner's own utterances.
 * A batch generated up front would produce a later line that ignores what was just said to
 * it, which defeats the memory this feature exists for. The latency is instead hidden by
 * PREFETCH — `iwScript.ts` starts a render as early as it is provably safe to, meaning no
 * barrier step sits between — which keeps Q42's mitigation for the common case without its
 * correctness cost.
 *
 * ⚠️ **A FAILED RENDER IS SILENCE, NEVER THE DIRECTION.** If the ladder is exhausted the
 * caller skips the step. It must NOT fall back to speaking the authored text, because the
 * authored text is English prose about the NPC — that is precisely the leak this replaced.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.5, § 6.4, § 14 Q6, § 14 Q42.
 */

/** Max output tokens. One short line; anything longer is drift, not content. */
export const IW_LINE_MAX_TOKENS = 60;

/** Everything a render needs beyond the NPC sheet: what they perceive, and what they mean. */
export interface LineDirectionInput extends IWContextInput {
  /**
   * The authored direction, in the author's own language — the intention, not the words.
   *
   * ⚠️ It is rendered inside the USER message, never the system block, for the same reason
   * the learner's utterance is (§ 11): it is content, and content that an author typed is
   * only marginally more trusted than content a learner typed.
   *
   * ⚠️ **OPTIONAL SINCE 2026-09-19, AND AN OMITTED ONE IS A DIFFERENT PROMPT, NOT A BLANK
   * ONE.** A `prompt_npc` cue may carry no brief at all, and the wrong way to honour that
   * would be to render an empty pair of quotes as the NPC's intention — a model handed
   * `""` as "what you mean to say" produces exactly the confused non-answer it looks like.
   * {@link renderLineDirection} swaps the closer instead.
   */
  direction?: string;
  /**
   * Who the line is aimed at, as this NPC would name them.
   *
   * ⚠️ OMITTED NO LONGER MEANS "THE ROOM" (2026-09-19). It means *you decide whom*, and the
   * closer says so — because the step that leaves it out does so precisely when the right
   * addressee depends on the moment. A line genuinely aimed at nobody is what that same
   * freedom produces when nobody in particular is owed one.
   */
  toward?: string;
}

/**
 * Build layer 3 for a render.
 *
 * The perception half is byte-identical to a turn's ({@link renderContextSections}) so an
 * NPC's memory cannot differ between answering the learner and delivering a scripted beat.
 * Only the closer differs, and it differs in the one way that matters: a turn's closer makes
 * silence legal, and a render's does the opposite — the beat is authored, so the NPC speaks.
 */
export function renderLineDirection(input: LineDirectionInput): string {
  const sections = renderContextSections(input);
  const direction = input.direction?.trim();

  if (direction) {
    sections.push(
      '',
      'WHAT YOU MEAN TO SAY — your own intention, written down in English. Not words anyone',
      'said, and not a sentence to translate:',
      `"${direction}"`,
    );
  } else {
    // The unbriefed cue (2026-09-19). There is no intention to hand over, so the prompt asks
    // for one — grounded in what this NPC has just perceived, which the sections above
    // already carry, rather than in nothing at all.
    sections.push(
      '',
      'IT IS YOUR MOMENT TO SPEAK. Nobody has told you what to say. Say the thing this',
      'character would actually say right now, given what you have just seen and heard.',
    );
  }

  if (input.toward) sections.push('', `You are saying it to ${input.toward}.`);
  // An omitted addressee is a CHOICE handed to the model, not silence about one — see the
  // field's note. Saying nothing here at all is what produced lines addressed to the room by
  // default, which is rarely what an author who left the target blank meant.
  else sections.push('', 'Decide who you are saying it to, and make that clear in how you say it.');

  sections.push('', 'Say it now, in Chinese, in one line, the way you would say it.');
  return sections.join('\n');
}

/**
 * A one-line sink for {@link runLadder}.
 *
 * ⚠️ **IT HAS NO ERROR PATH, ONLY DEGRADED OUTPUT**, for the same reason `turnParser` does
 * not: it runs on every delta in front of a bubble that is already painting. It absorbs the
 * same handful of things a model plausibly volunteers around a known format — a ``` fence, a
 * speaker label, wrapping quotes, a second line it was not asked for.
 *
 * `complete` fires on the first newline, which is § 6.4 rule 1's `sayDone` for this shape:
 * the line has closed and the TTS call can go out while the rung is still being drained.
 */
export function createLineSink(): IWLadderSink<string> {
  let buffer = '';
  return {
    push(delta: string) {
      buffer += delta;
      const text = firstLine(buffer);
      return { text, complete: /\n/.test(stripLeadingFence(buffer)) && text.length > 0 };
    },
    finish() {
      const text = firstLine(buffer);
      // Empty is the ONLY failure, and it is what makes the ladder try the next rung — the
      // same rule `turnParser.finish` applies to a turn.
      return { value: text, failed: text.length === 0 };
    },
  };
}

/** Drop a fence the model volunteered, so line 1 is the first line of actual content. */
function stripLeadingFence(buffer: string): string {
  return buffer.replace(/^\s*```[^\n]*\n?/, '');
}

/**
 * The first non-empty line, with a speaker label and wrapping quotes removed.
 *
 * The label cap of 8 characters before the colon is `turnParser`'s, for its reason: Chinese
 * punctuation includes `：` mid-utterance, so "他说：不行" is speech, not a label.
 */
function firstLine(buffer: string): string {
  const body = stripLeadingFence(buffer);
  const line = body.split('\n').map(l => l.trim()).find(l => l.length > 0 && !/^```/.test(l));
  if (!line) return '';
  return line
    .replace(/^[^：:]{1,8}[：:]\s*/, '')
    .replace(/^["'“”](.*)["'”“]$/, '$1')
    .trim();
}

export type IWLineOutcome =
  | { kind: 'line'; text: string; rung: string; attempts: IWRungAttempt[] }
  /** Every rung failed. The caller SKIPS the step — it never speaks the direction. */
  | { kind: 'frozen'; attempts: IWRungAttempt[] };

export interface RenderNpcLineOptions {
  rungs: readonly IWModelRung[];
  /** Layers 1 + 2 for a render: {@link renderLineWorldRules} then the NPC sheet. */
  system: string;
  direction: LineDirectionInput;
  onDelta?: (text: string, attemptIndex: number, complete: boolean) => void;
}

/** Run one line render through the ladder. */
export async function renderNpcLine(options: RenderNpcLineOptions): Promise<IWLineOutcome> {
  const outcome = await runLadder<string>({
    rungs: options.rungs,
    request: {
      system: options.system,
      user: renderLineDirection(options.direction),
      maxTokens: IW_LINE_MAX_TOKENS,
    },
    createSink: createLineSink,
    onDelta: options.onDelta,
  });
  return outcome.kind === 'ok'
    ? { kind: 'line', text: outcome.value, rung: outcome.rung, attempts: outcome.attempts }
    : { kind: 'frozen', attempts: outcome.attempts };
}

/** Layers 1 + 2 for a render. Exported so a test and the CLI probe build the same prompt. */
export function buildLineSystemBlock(npcBlock: string): string {
  return `${renderLineWorldRules()}\n\n${npcBlock}`;
}
