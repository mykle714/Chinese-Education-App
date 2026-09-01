/**
 * The benchmark's WORKLOAD — deliberately shaped like a real iw NPC turn, not like a
 * generic chat prompt (docs/IMMERSIVE_WORLD.md § 6).
 *
 * Why this matters: every public latency leaderboard measures a short prompt with a long
 * answer. Our shape is the exact inverse — a LARGE, STABLE, CACHEABLE prefix (world rules
 * + persona, ~1–2K tokens) and a TINY output (~40 tokens of JSON). TTFT here is dominated
 * by prefill and queueing, not by decode, so a leaderboard's tok/s column is nearly
 * irrelevant to us and its TTFT column was measured on the wrong prompt.
 *
 * Referenced by: run.js, docs/IMMERSIVE_WORLD.md § 6a.
 */

/** Layer 1 — frozen rules of the world. Identical for every NPC, so it is the cache prefix. */
const RULES_STEM = `You are an inhabitant of a Chinese night market in a language-learning game.
You are NOT an assistant. You never break character, never mention being an AI, and never
explain the game. You speak to a learner of Mandarin.

__CONTRACT__

VOCABULARY BUDGET — the learner only knows the words in KNOWN_WORDS. You may use those
freely. You may introduce AT MOST ONE word outside that list per reply, and only when the
situation teaches it. Never two.

You only know what you have heard. You do not know anything said out of your earshot.
Stay in register: you are a street vendor, warm and brisk, not a poet.`;

/** Layer 2 — frozen persona. Also cacheable. */
export const PERSONA = `YOU ARE: 王婶 (Auntie Wang), id "npc_wang".
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
    contract: `REPLY CONTRACT — you always reply with exactly one JSON object and nothing else:
{"say": string, "action": {"kind": string, "target": string|null}, "emote": string}

- "say" is what you speak aloud, in Simplified Chinese. It MUST come first in the object.
  Keep it under 12 characters. It may be "" if you choose to act without speaking.
- "action".kind is one of exactly: "idle", "walk_to_actor", "walk_away_from",
  "walk_to_item", "give_item", "face", "follow". "target" is the id it applies to, or null.
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
    parse: (raw) => {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return { notes: ['no JSON object'] };
      const fenced = m[0].length !== raw.trim().length;
      try {
        const o = JSON.parse(m[0]);
        return { say: o.say, actionKind: o.action?.kind, emote: o.emote, sayFirst: Object.keys(o)[0] === 'say', notes: fenced ? ['fenced'] : [] };
      } catch { return { notes: ['parse failed'] }; }
    },
  },

  schema: {
    contract: `REPLY CONTRACT — reply with one object: "say" (the Chinese you speak, under 12
characters, or ""), "action" (kind + target), "emote". "say" must come first.`,
    closer: 'Reply now.',
    sayIndex: (text) => FORMATS.json.sayIndex(text),
    parse: (raw) => FORMATS.json.parse(raw),
    /** Providers that support it get an API-enforced schema (Anthropic output_config.format). */
    jsonSchema: {
      type: 'object', additionalProperties: false, required: ['say', 'action', 'emote'],
      properties: {
        say: { type: 'string' },
        action: {
          type: 'object', additionalProperties: false, required: ['kind', 'target'],
          properties: {
            kind: { type: 'string', enum: ['idle', 'walk_to_actor', 'walk_away_from', 'walk_to_item', 'give_item', 'face', 'follow'] },
            target: { type: ['string', 'null'] },
          },
        },
        emote: { type: 'string', enum: ['neutral', 'curious', 'pleased', 'confused', 'impatient', 'amused'] },
      },
    },
  },

  lines: {
    contract: `REPLY CONTRACT — reply with exactly three lines, nothing else, no markdown:
Line 1: the Chinese you speak aloud, under 12 characters (or the single word NOTHING).
Line 2: one action — one of: idle | walk_to_actor <id> | walk_away_from <id> |
        walk_to_item <id> | give_item <itemId> <actorId> | face <id> | follow <id>
Line 3: one emote — one of: neutral | curious | pleased | confused | impatient | amused
Start line 1 immediately with the Chinese character. No preamble, no labels, no quotes.`,
    closer: 'Reply now.',
    // The speech is the very first token — there is no envelope to open.
    sayIndex: (text) => (text.length ? 0 : -1),
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
    parse: (raw) => {
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
      const actionLine = rest.find(l => ACTION_KINDS.has(l.split(/\s+/)[0]));
      const emoteLine = rest.find(l => EMOTE_KINDS.has(l));
      if (!actionLine) notes.push('no legal action line → idle');
      if (!emoteLine) notes.push('no legal emote line → neutral');
      if (rest.length > 2) notes.push('extra lines');
      return {
        say,
        actionKind: actionLine ? actionLine.split(/\s+/)[0] : 'idle',
        emote: emoteLine ?? 'neutral',
        sayFirst: true, // structurally guaranteed by the format
        notes,
      };
    },
  },
};

export const ACTION_KINDS = new Set(['idle', 'walk_to_actor', 'walk_away_from', 'walk_to_item', 'give_item', 'face', 'follow']);
export const EMOTE_KINDS = new Set(['neutral', 'curious', 'pleased', 'confused', 'impatient', 'amused']);

/**
 * Assemble the prompt for one format, optionally overriding the volatile turn (§ 5.3
 * layer 3) with a character probe. `turn` is a PROBE_TURNS entry (character.js).
 */
export function buildScenario(formatKey, turn = null) {
  const fmt = FORMATS[formatKey];
  if (!fmt) throw new Error(`unknown format ${formatKey} (have: ${Object.keys(FORMATS).join(', ')})`);
  const user = turn ? buildTurnState(turn, fmt) : TURN_STATE.replace('Reply with the JSON object now.', fmt.closer);
  return {
    system: `${RULES_STEM.replace('__CONTRACT__', fmt.contract)}\n\n${PERSONA}`,
    user,
    maxTokens: 200,
    format: fmt,
  };
}

/** Layer 3 for an arbitrary probe turn — same shape as TURN_STATE, different content. */
function buildTurnState(turn, fmt) {
  const heard = turn.heard?.length ? turn.heard.map(h => `- ${h}`).join('\n') : '- (nothing yet)';
  const event = turn.said
    ? `JUST NOW, the player said to you: "${turn.said}"`
    : `JUST NOW, the player walked up to you and said nothing.`;
  return `KNOWN_WORDS: 面, 碗, 要, 热, 凉, 好, 谢谢, 多少, 钱, 一, 二, 三, 我, 你, 吃, 来, 这个, 那个, 大, 小

NEARBY (tile distance from you):
- player "player" at 2 tiles, facing you
- npc_li at 7 tiles, behind a stall (muffled)

WHAT YOU HAVE HEARD, oldest first:
${heard}

${event}

${fmt.closer}`;
}

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
export function gradeReply(formatKey, raw) {
  const parsed = FORMATS[formatKey].parse(raw);
  const say = typeof parsed.say === 'string' ? parsed.say : '';
  const notes = parsed.notes ?? [];
  const defaulted = notes.some(n => n.startsWith('no legal action') || n.startsWith('no legal emote'));
  return {
    parsed: parsed.actionKind !== undefined,
    say,
    sayFirst: !!parsed.sayFirst,
    legalAction: ACTION_KINDS.has(parsed.actionKind),
    legalEmote: EMOTE_KINDS.has(parsed.emote),
    /** True only when the MODEL produced both lines legally — no parser rescue involved. */
    cleanAction: ACTION_KINDS.has(parsed.actionKind) && EMOTE_KINDS.has(parsed.emote) && !defaulted,
    rescued: defaulted || notes.some(n => n.includes('JSON, not lines') || n.startsWith('stripped')),
    // An empty utterance is legal (an NPC may act without speaking); a non-empty one must be Chinese.
    chinese: say === '' || /[一-鿿]/.test(say),
    notes,
  };
}
