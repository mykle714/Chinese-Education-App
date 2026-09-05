/**
 * The benchmark's WORKLOAD — deliberately shaped like a real iw NPC turn, not like a
 * generic chat prompt (docs/IMMERSIVE_WORLD.md § 6).
 *
 * Why this matters: every public latency leaderboard measures a short prompt with a long
 * answer. Our shape is the exact inverse — a LARGE, STABLE, CACHEABLE prefix (world rules
 * + NPC, ~1–2K tokens) and a TINY output (~40 tokens of JSON). TTFT here is dominated
 * by prefill and queueing, not by decode, so a leaderboard's tok/s column is nearly
 * irrelevant to us and its TTFT column was measured on the wrong prompt.
 *
 * Referenced by: run.js, character-run.js, docs/IMMERSIVE_WORLD.md § 6a.
 *
 * ⚠️ THIS FILE IMPORTS TYPESCRIPT (`contracts/iw.ts`), so every entry point that pulls it
 * in must run under `tsx`, not bare `node`. That is the price of the 2026-09-05 fix below,
 * and it is worth paying.
 */

/**
 * The action vocabulary the bench offers the model.
 *
 * ⚠️ REWRITTEN 2026-09-05, twice in one day, and the second rewrite is the interesting one.
 *
 * First it was fixed to derive from `IW_ACTIONS` instead of a hand-typed list that had
 * drifted four verbs behind the contract. Then `IW_ACTIONS` was DELETED outright (§ 14 Q42):
 * an NPC no longer picks a primitive verb, it picks one of the **authored actions** written
 * for it in that scene, by name. There is no global list to derive from any more — the
 * vocabulary is per NPC and per scene.
 *
 * So the bench now takes the offered names from the probe context (`npcProbes.js`), which is
 * the right shape anyway: what 王婶 can do at a noodle stall is not what 老周 can do on a
 * folding stool, and a shared list was always measuring a fiction.
 *
 * `none` is always offered and is not authored — an NPC must be able to decline to act, and
 * under the old design that was `idle`.
 */
export const NO_ACTION = 'none';

/** Offered when a probe context names no actions of its own. */
export const DEFAULT_BENCH_ACTIONS = [NO_ACTION];

const actionsFor = (ctx) => {
  const authored = Array.isArray(ctx?.actions) ? ctx.actions : [];
  return [NO_ACTION, ...authored.filter((a) => a && a !== NO_ACTION)];
};

/**
 * Layer 1 — frozen rules of the world. Identical for every NPC, so it is the cache prefix.
 *
 * ⚠️ TWO BUGS WERE FIXED HERE ON 2026-09-01 by the first multi-NPC sweep (§ 12 phase 1c),
 * and both were invisible while only one NPC existed:
 *
 * 1. NPC CONTENT HAD LEAKED INTO LAYER 1. It ended "Stay in register: you are a street
 *    vendor, warm and brisk, not a poet." — written when 王婶 was the only NPC. Applied to
 *    every NPC it flatly contradicts the cast: 老周 is retired and sells nothing, and is
 *    written at energy 2 for long unhurried sentences. A frozen layer shared by every
 *    character cannot contain any one character's register; that is what layer 2's
 *    `register` field is. Layer 1 now says only that the register below wins.
 *
 * 2. THE HARD VOCABULARY BUDGET WAS STALE. "AT MOST ONE word outside that list. Never two."
 *    was withdrawn in § 9.4 (see § 5.6a for the evidence) in favour of guidance about the
 *    learner's level, but the bench never followed. Leaving it made the bench measure a
 *    contract production does not send.
 */
const RULES_STEM = `You are a person living in a Chinese night market. You speak to someone
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

/** Layer 2 — frozen NPC. Also cacheable. */
export const NPC = `YOU ARE: 王婶 (Auntie Wang), id "npc_wang".
JOB: you run the noodle stall at the north end of the market. You have run it for 20 years.
PERSONALITY: brisk, warm, a little bossy. You call everyone 小朋友 if they look lost.
You are proud of your beef noodles and slightly dismissive of the dumpling stall opposite.
YOU HOLD: a bowl of noodles (item "item_noodles"), chopsticks (item "item_chopsticks").
YOU LIKE: 老陈 the tea seller (npc_chen). YOU TOLERATE: 小李 the dumpling seller (npc_li).
CANONICAL LINES (use when unsure): "要几碗？" / "热的还是凉的？" / "小朋友，来吃面吧！"`;

/** Layer 3 — the volatile turn. This is the only part that changes per call. */
export const TURN_STATE = `KNOWN_WORDS: 面, 碗, 要, 热, 凉, 好, 谢谢, 多少, 钱, 一, 二, 三, 我, 你, 吃, 来, 这个, 那个, 大, 小

NEARBY (tile distance from you):
- player "player" at 2 tiles, facing you
- npc_li at 7 tiles, behind a stall (muffled)

WHAT YOU HAVE HEARD, oldest first:
- player said: "你好"
- you said: "小朋友，来吃面吧！"

JUST NOW, the player said to you: "我要一碗面"

Reply with the JSON object now.`;

// ─────────────────────────────────────────────────────────────────────────────
// Output formats — the single biggest measured latency variable (§ 6a)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Three ways to ask for the same three fields. They are NOT equivalent in latency, because
 * what matters is how many tokens the model must emit BEFORE the first Chinese glyph:
 *
 *   json    — must open `{"say": "` first (and models like to wrap it in a ```json fence,
 *             which costs ~8 more tokens the player waits through).
 *   schema  — API-enforced JSON. Guarantees validity; grammar-constrained decoding adds
 *             prefill overhead, so it is the SLOWEST of the three.
 *   lines   — the speech IS the first token. Nothing precedes it. Fastest by a wide margin.
 *
 * `lines` gives up schema guarantees, but § 5.2 already requires the engine to validate
 * every action against the enum before executing it, so nothing is actually lost: parsing
 * three lines and whitelisting line 2 is LESS code than tolerating fenced JSON.
 */
export const FORMATS = {
  json: {
    contract: (actions) => `REPLY CONTRACT — you always reply with exactly one JSON object and nothing else:
{"say": string, "action": string, "emote": string}

- "say" is what you speak aloud, in Simplified Chinese. It MUST come first in the object.
  Keep it under 12 characters. It may be "" if you choose to act without speaking.
- "action" is the NAME of one thing you can do, exactly as written here, or "${NO_ACTION}":
  ${actions.map(a => `"${a}"`).join(', ')}.
- "emote" is one of: "neutral", "curious", "pleased", "confused", "impatient", "amused".
- Output raw JSON. Do NOT wrap it in a markdown code fence.`,
    closer: 'Reply with the JSON object now.',
    /** Where does the first spoken glyph appear in the partial stream? -1 = not yet. */
    sayIndex: (text) => {
      const k = text.indexOf('"say"');
      if (k < 0) return -1;
      const colon = text.indexOf(':', k);
      if (colon < 0) return -1;
      const quote = text.indexOf('"', colon);
      return quote >= 0 && quote + 1 < text.length ? quote + 1 : -1;
    },
    /**
     * Where the spoken line is COMPLETE — i.e. the earliest moment the whole utterance is
     * known and could be handed to a TTS call. -1 = not yet. This is the number that matters
     * for audio (IMMERSIVE_WORLD.md § 6.4), because a synthesizer needs the finished string;
     * `sayIndex` only says when the bubble can start painting.
     */
    sayEndIndex: (text) => {
      const start = FORMATS.json.sayIndex(text);
      if (start < 0) return -1;
      // Walk to the closing quote, honouring backslash escapes inside the string.
      for (let i = start; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (text[i] === '"') return i;
      }
      return -1;
    },
    parse: (raw) => {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return { notes: ['no JSON object'] };
      const fenced = m[0].length !== raw.trim().length;
      try {
        const o = JSON.parse(m[0]);
        // `action` is a NAME now, not a {kind,target} pair — an authored action already
        // knows its own targets, so the model never supplies one. The `?.kind` fallback
        // reads a model that emitted the old shape anyway.
        const action = typeof o.action === 'string' ? o.action : o.action?.kind;
        return { say: o.say, actionKind: action, emote: o.emote, sayFirst: Object.keys(o)[0] === 'say', notes: fenced ? ['fenced'] : [] };
      } catch { return { notes: ['parse failed'] }; }
    },
  },

  schema: {
    contract: () => `REPLY CONTRACT — reply with one object: "say" (the Chinese you speak, under 12
characters, or ""), "action" (the name of one thing you can do, or "${NO_ACTION}"), "emote".
"say" must come first.`,
    closer: 'Reply now.',
    sayIndex: (text) => FORMATS.json.sayIndex(text),
    sayEndIndex: (text) => FORMATS.json.sayEndIndex(text),
    parse: (raw, actions = DEFAULT_BENCH_ACTIONS) => FORMATS.json.parse(raw, actions),
    /** Providers that support it get an API-enforced schema (Anthropic output_config.format). */
    jsonSchema: {
      type: 'object', additionalProperties: false, required: ['say', 'action', 'emote'],
      properties: {
        say: { type: 'string' },
        action: { type: 'string' },
        emote: { type: 'string', enum: ['neutral', 'curious', 'pleased', 'confused', 'impatient', 'amused'] },
      },
    },
  },

  lines: {
    contract: (actions) => `REPLY CONTRACT — reply with exactly three lines, nothing else, no markdown:
Line 1: the Chinese you speak aloud, under 12 characters (or the single word NOTHING).
Line 2: the NAME of one thing you can do, exactly as written, or ${NO_ACTION}:
        ${actions.join(' | ')}
Line 3: one emote — one of: neutral | curious | pleased | confused | impatient | amused
Start line 1 immediately with the Chinese character. No preamble, no labels, no quotes.`,
    closer: 'Reply now.',
    // The speech is the very first token — there is no envelope to open.
    sayIndex: (text) => (text.length ? 0 : -1),
    // Line 1 closes at the first newline — long before the turn does, since lines 2 and 3
    // still have to decode. That gap is the head start TTS gets (IMMERSIVE_WORLD.md § 6.4).
    sayEndIndex: (text) => text.indexOf('\n'),
    /**
     * The tolerant parser documented in IMMERSIVE_WORLD.md § 5.3. It is NOT format-agnostic
     * — the format is asked for in the prompt and this is what absorbs drift around it.
     *
     * Rules, in order: sniff for an envelope the model volunteered (a ``` fence or a leading
     * `{`) and hand those to the JSON parser; otherwise take the first non-empty line as
     * speech, then SCAN the remainder for a line whose first token is a legal action and for
     * a line that is a legal emote. Scanning rather than indexing is what survives an
     * inserted blank line or a stray label. Every step has a default, so this cannot throw.
     */
    parse: (raw, actions = DEFAULT_BENCH_ACTIONS) => {
      const trimmed = raw.trim();
      // Shape sniff: a model that decided to emit JSON anyway is still usable, and this is
      // ~3 lines of insurance against the one realistic drift.
      if (trimmed.startsWith('{') || trimmed.startsWith('```')) {
        const viaJson = FORMATS.json.parse(trimmed);
        if (viaJson.actionKind !== undefined) return { ...viaJson, notes: [...(viaJson.notes ?? []), 'emitted JSON, not lines'] };
      }
      const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) return { notes: ['empty reply'] };
      const notes = [];
      // Line 1 — strip a speaker label ("王婶：" / "SAY:") and wrapping quotes if the model
      // added them. Neither has been observed, but both are cheap to absorb.
      let say = lines[0].replace(/^[^：:]{1,8}[：:]\s*/, '').replace(/^["'“”](.*)["'“”]$/, '$1');
      if (say !== lines[0]) notes.push('stripped label/quotes');
      if (say === 'NOTHING') say = '';
      const rest = lines.slice(1);
      // An action is now a NAME, and a name may contain spaces ("bring water"), so the
      // whole line is matched rather than its first token.
      const actionLine = rest.find(l => actions.includes(l));
      const emoteLine = rest.find(l => EMOTE_KINDS.has(l));
      if (!actionLine) notes.push(`no legal action line → ${NO_ACTION}`);
      if (!emoteLine) notes.push('no legal emote line → neutral');
      if (rest.length > 2) notes.push('extra lines');
      return {
        say,
        actionKind: actionLine ?? NO_ACTION,
        emote: emoteLine ?? 'neutral',
        sayFirst: true, // structurally guaranteed by the format
        notes,
      };
    },
  },
};

export const EMOTE_KINDS = new Set(['neutral', 'curious', 'pleased', 'confused', 'impatient', 'amused']);

/**
 * Assemble the prompt for one format.
 *
 * `turn` is a probe from character.js's `buildProbeTurns` (null = the fixed happy-path turn
 * run.js benches). `ctx` overrides the NPC and the volatile turn state so the sweep can
 * run a REGISTRY NPC (config/iwNpcs.ts, rendered by services/iw/npcPrompt.ts)
 * instead of the inline 王婶 below — which is the whole point of § 12 phase 1c: the bench
 * must grade the text production actually sends.
 *
 * Defaults reproduce the pre-registry bench exactly, so run.js's latency numbers stay
 * comparable across this change.
 *
 * @param {string} formatKey
 * @param {object|null} turn
 * @param {{ NPC?: string, known?: string[], nearby?: string[] }} [ctx]
 */
export function buildScenario(formatKey, turn = null, ctx = {}) {
  const fmt = FORMATS[formatKey];
  if (!fmt) throw new Error(`unknown format ${formatKey} (have: ${Object.keys(FORMATS).join(', ')})`);
  const npcBlock = ctx.npc ?? NPC;
  const actions = actionsFor(ctx);
  const user = turn
    ? buildTurnState(turn, fmt, ctx)
    : TURN_STATE.replace('Reply with the JSON object now.', fmt.closer);
  return {
    system: `${RULES_STEM.replace('__CONTRACT__', fmt.contract(actions))}\n\n${npcBlock}`,
    user,
    maxTokens: 200,
    format: fmt,
    /** What was offered — `gradeReply` must be given the same list or it grades a fiction. */
    actions,
  };
}

/** Layer 3 for an arbitrary probe turn — same shape as TURN_STATE, different content. */
function buildTurnState(turn, fmt, ctx = {}) {
  const known = (ctx.known ?? DEFAULT_KNOWN).join(', ');
  const nearby = (ctx.nearby ?? DEFAULT_NEARBY).map(n => `- ${n}`).join('\n');
  const heard = turn.heard?.length ? turn.heard.map(h => `- ${h}`).join('\n') : '- (nothing yet)';
  const event = turn.said
    ? `JUST NOW, the player said to you: "${turn.said}"`
    : `JUST NOW, the player walked up to you and said nothing.`;
  return `KNOWN_WORDS: ${known}

NEARBY (tile distance from you):
${nearby}

WHAT YOU HAVE HEARD, oldest first:
${heard}

${event}

${fmt.closer}`;
}

/** The inline bench's turn-state defaults, used when `ctx` supplies nothing. */
const DEFAULT_KNOWN = ['面', '碗', '要', '热', '凉', '好', '谢谢', '多少', '钱', '一', '二', '三', '我', '你', '吃', '来', '这个', '那个', '大', '小'];
const DEFAULT_NEARBY = ['player "player" at 2 tiles, facing you', 'npc_li at 7 tiles, behind a stall (muffled)'];

/**
 * Grade one reply against the engine's actual requirements.
 *
 * NOTE the distinction between `legalAction` and `cleanAction`. The parser DEGRADES a junk
 * action line to `idle`, which is right for the engine — a player must never see a failure.
 * But it would make the bench report 100% legal actions no matter how badly a model
 * behaved, which would be a benchmark measuring its own error handling. So `cleanAction`
 * asks the question the bench actually cares about: did the model supply a legal action, or
 * did we paper over it? Report the second, not the first.
 */
export function gradeReply(formatKey, raw, actions = DEFAULT_BENCH_ACTIONS) {
  const parsed = FORMATS[formatKey].parse(raw, actions);
  const say = typeof parsed.say === 'string' ? parsed.say : '';
  const notes = parsed.notes ?? [];
  const defaulted = notes.some(n => n.startsWith('no legal action') || n.startsWith('no legal emote'));
  return {
    parsed: parsed.actionKind !== undefined,
    say,
    sayFirst: !!parsed.sayFirst,
    legalAction: actions.includes(parsed.actionKind),
    legalEmote: EMOTE_KINDS.has(parsed.emote),
    /** True only when the MODEL produced both lines legally — no parser rescue involved. */
    cleanAction: actions.includes(parsed.actionKind) && EMOTE_KINDS.has(parsed.emote) && !defaulted,
    rescued: defaulted || notes.some(n => n.includes('JSON, not lines') || n.startsWith('stripped')),
    // An empty utterance is legal (an NPC may act without speaking); a non-empty one must be Chinese.
    chinese: say === '' || /[一-鿿]/.test(say),
    notes,
  };
}
