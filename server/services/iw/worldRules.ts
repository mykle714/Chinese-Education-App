import { IW_EMOTES, IW_NO_ACTION } from '../../contracts/iw.js';

/**
 * iw LAYER 1 — the frozen rules of the world (§ 5.5).
 *
 * LAYER: service (pure). Two exports and no I/O.
 *
 * ⚠️ THIS IS THE CACHE PREFIX. It is byte-identical for every NPC in every scene, so it sits
 * first in the system block with `cache_control` on it. A single changed character
 * invalidates the cached prefix for **every turn of every session** until the cache refills.
 * Nothing dynamic may enter it — no dates, no scene name, no learner name, no counts.
 *
 * ⚠️ **NO ONE CHARACTER'S REGISTER MAY APPEAR HERE**, and this rule was learned the hard way
 * (§ 5.5, 2026-09-01). Layer 1 used to end *"Stay in register: you are a street vendor, warm
 * and brisk, not a poet"* — written when 王婶 was the only NPC, and then applied to every NPC
 * thereafter. It flatly contradicts the cast: 老周 is retired and sells nothing, and is
 * written at energy 2 for long unhurried sentences. A frozen layer shared by every character
 * can only hold what is true of ALL of them. Register is layer 2's job
 * (`npcPrompt.renderNpcBlock`), and layer 1 says only that the register below wins.
 *
 * ⚠️ **NO HARD VOCABULARY BUDGET** (§ 9.4, § 5.6a). An earlier version said "AT MOST ONE word
 * outside that list. Never two." It was withdrawn in favour of guidance about the learner's
 * level, because a countable rule produced stilted speech and the measured failure mode was
 * never the count.
 *
 * ⚠️ **SINGLE-SOURCED WITH THE BENCH.** `server/scripts/bench/npc-latency/scenario.js`
 * imports {@link IW_WORLD_RULES_STEM} rather than keeping its own copy — the two drifted once
 * already (the stale vocabulary budget above lived on in the bench for days after production
 * dropped it, so the bench was measuring a contract production does not send). A bench that
 * grades its own private copy of the prompt passes while the shipped prompt fails.
 *
 * ⚠️ **SIZE IS A MEASUREMENT, NOT A GUESS** (§ 5.5). Layer 1 is ~331 tokens. Re-run
 * `scripts/bench/npc-latency/prefix-size.js` after editing this text; never hand-adjust the
 * table in the doc. The minimum cacheable prefix is model-dependent and NOT monotonic across
 * generations (Opus 5 = 512, Sonnet 5 = 1024, Haiku 4.5 = 4096), and under the floor the
 * failure is SILENT — no error, just `cache_read_input_tokens: 0`.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.5, § 9.4, § 11.
 */

/**
 * The world rules, with `__CONTRACT__` marking where the reply contract is spliced in.
 *
 * The placeholder exists because the bench swaps the contract to measure three output formats
 * against each other (§ 6a), while production only ever uses the three-line one. Keeping the
 * seam means the bench measures THIS text with a different contract, rather than its own text.
 */
export const IW_WORLD_RULES_STEM = `You are a person living in a Chinese night market. You speak to someone
who is learning Mandarin and is not fluent.

You are NOT an assistant. You never break character, never mention being an AI, and never
explain or refer to any of this as a game, a scene or an exercise.

__CONTRACT__

WHO YOU ARE TALKING TO — they are a beginner. KNOWN_WORDS lists roughly what they know.
Speak so they have a chance of following you: prefer those words, keep your grammar simple,
and when you need a word they do not have, use it in a way the situation explains. This is
guidance, not a rule to count against — say what your character would say, simply.

You only know what you have heard. You do not know anything said out of your earshot.

Speak the way YOU speak. Your register is described below and it overrides any instinct to
sound like a helpful narrator. Say one thing and stop.`;

/**
 * The three-line reply contract (§ 5.1), naming the actions this NPC may choose from.
 *
 * ⚠️ THE OFFERED NAMES ARE PER NPC AND PER TURN, so this is the ONE part of layer 1 that is
 * not frozen — which is why it is a function and why the contract is spliced rather than
 * baked in. In the request it therefore belongs AFTER the cache breakpoint, not before it.
 *
 * ⚠️ THE SAME ARRAY MUST REACH `turnParser.parseTurnReply` (§ 5.4). Offering one list and
 * validating against another grades a fiction; `turnOffers.buildTurnOffers` returns the
 * single `names` array both sides take.
 *
 * The "Start line 1 immediately" instruction is not politeness — § 6.1 measured that any
 * envelope the model opens first (a `{"say": "`, a volunteered fence) is dead air the player
 * sits through before the first glyph.
 */
export function renderReplyContract(actionNames: readonly string[]): string {
  const offered = [IW_NO_ACTION, ...actionNames.filter(n => n && n !== IW_NO_ACTION)];
  return `REPLY CONTRACT — reply with exactly three lines, nothing else, no markdown:
Line 1: the Chinese you speak aloud, under 12 characters (or the single word NOTHING).
Line 2: the NAME of one thing you can do, exactly as written, or ${IW_NO_ACTION}:
        ${offered.join(' | ')}
Line 3: one emote — one of: ${IW_EMOTES.join(' | ')}
Start line 1 immediately with the Chinese character. No preamble, no labels, no quotes.`;
}

/**
 * Layer 1 with the three-line contract spliced in — what production sends.
 *
 * ⚠️ THE RESULT IS NOT FULLY CACHEABLE as one block, because the contract carries this NPC's
 * offered action names. Callers that want the cache should put {@link IW_WORLD_RULES_STEM}'s
 * two halves either side of the breakpoint; this convenience is for the bench, for tests and
 * for a first implementation that has not yet wired caching. Whichever is used, § 5.5's
 * standing instruction applies: **assert `cache_read_input_tokens > 0` in the turn path**
 * rather than assuming caching engaged.
 */
export function renderWorldRules(actionNames: readonly string[]): string {
  return IW_WORLD_RULES_STEM.replace('__CONTRACT__', renderReplyContract(actionNames));
}
