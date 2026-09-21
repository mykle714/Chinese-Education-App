import { IW_EMOTES, IW_NO_ACTION } from '../../contracts/iw.js';

/**
 * iw LAYER 1 — the frozen rules of the world (§ 5.5).
 *
 * LAYER: service (pure). No I/O. It renders layer 1 for both kinds of model call — a TURN
 * (three-line contract) and a LINE RENDER (one-line contract, § 14 Q42) — off one shared stem.
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
 * ⚠️ **NO EARSHOT CLAUSE, EVEN THOUGH EARSHOT IS BACK.** This text used to end the knowledge
 * clause with *"You do not know anything said out of your earshot"* — the prompt half of § 4's
 * geometric hearing gate. It came out on 2026-09-07 because it was never true of the data: the
 * client handed every NPC the SAME `heard` transcript, so an NPC told it had missed something
 * was holding the thing it had missed.
 *
 * § 4c brought hearing back the same day, learner-chosen, and this time it DOES gate memory —
 * a transcript is filtered per NPC before it is rendered. The clause still does not return,
 * and the reason is the stronger one: **the gate is now structural, so the prompt has nothing
 * to say about it.** An NPC cannot be told to forget a line it was never shown, and a rule
 * about invisible knowledge is exactly the kind a model half-obeys. What survives is the
 * clause the sentence was really for — do not know what nobody told you — which guards against
 * an NPC answering out of the prompt's own furniture rather than out of the conversation.
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
 * ⚠️ **SIZE IS A MEASUREMENT, NOT A GUESS** (§ 5.5). Layer 1 is ~347 tokens (re-measured 2026-09-07, after the earshot clause came out). Re-run
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

You only know what you have heard here and what you remember of your own life. Everyone
present hears everything said here; you know nothing that nobody has said to you.

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
export function renderReplyContract(actionNames: readonly string[], collecting = false): string {
  const offered = [IW_NO_ACTION, ...actionNames.filter(n => n && n !== IW_NO_ACTION)];
  // The fourth line exists only while a `get_information` step is running, and it is spliced
  // in HERE rather than added to the stem for the same reason the offered names are: the
  // common turn must keep the three-line shape the parser, the bench and § 5.3's measurements
  // are all written against. A turn that is not collecting is byte-identical to before.
  const collectLine = collecting
    ? `\nLine 4: got: yes — if what you were trying to find out has now been told to you.
        got: no — if it has not. Say no when you are still guessing at it.`
    : '';
  return `REPLY CONTRACT — reply with exactly ${collecting ? 'four' : 'three'} lines, nothing else, no markdown:
Line 1: the Chinese you speak aloud, under 12 characters (or the single word NOTHING).
Line 2: the NAME of one thing you can do, exactly as written, or ${IW_NO_ACTION}:
        ${offered.join(' | ')}
Line 3: one emote — one of: ${IW_EMOTES.join(' | ')}${collectLine}
Start line 1 immediately with the Chinese character. No preamble, no labels, no quotes.`;
}

/**
 * The ONE-LINE contract, for a line render (§ 14 Q42).
 *
 * ⚠️ **THIS IS WHY `__CONTRACT__` IS A SEAM AND NOT A CONSTANT.** The seam was cut so the
 * bench could measure three output formats against the same world rules; it turns out to be
 * what lets a second PRODUCTION call share layer 1 byte-for-byte with a turn. Both calls
 * therefore hit the same cached prefix (§ 5.5) — a render is not a second, colder prompt.
 *
 * ⚠️ **THE DIRECTION IS A NOTE TO SELF, NOT A SCRIPT TO TRANSLATE**, and saying so is the
 * whole contract. An author writes "tell them the fish is finished" in English; the failure
 * mode this replaced was that sentence reaching the learner verbatim, and the failure mode
 * this one has to avoid is a literal translation in nobody's voice. The NPC is told what they
 * MEAN, and their register, mood and memory — layer 2 and the heard list — decide the words.
 *
 * There is no action line and no emote line: a render is not a decision point. What the NPC
 * does next is already authored — it is the next step of the script.
 */
export function renderLineContract(): string {
  return `REPLY CONTRACT — reply with exactly ONE line of Chinese, nothing else, no markdown.
Below you are told WHAT YOU MEAN TO SAY, written in English. Those are NOT words to translate
and NOT words anyone said — they are a note about your own intention. Say that thing the way
YOU would say it, to the person in front of you, given what you have just heard. Under 14
characters. Never repeat something you have already said in the same words.
Start immediately with the Chinese character. No preamble, no labels, no quotes, no English.`;
}

/** Layer 1 for a line render — the same stem, the one-line contract. */
export function renderLineWorldRules(): string {
  return IW_WORLD_RULES_STEM.replace('__CONTRACT__', renderLineContract());
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
export function renderWorldRules(actionNames: readonly string[], collecting = false): string {
  return IW_WORLD_RULES_STEM.replace('__CONTRACT__', renderReplyContract(actionNames, collecting));
}
