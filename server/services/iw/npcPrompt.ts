import type { IWNpc, IWTrait } from '../../types/iwNpc.js';

/**
 * iw NPC Prompt Builder — renders an IWNpc into § 5.5 LAYER 2 of the NPC prompt.
 *
 * LAYER: service (pure, no I/O, no DB). Consumed by the turn endpoint's prompt assembler
 * and by the character-fidelity bench (server/scripts/bench/npc-latency/character-run.js),
 * which is the point — the bench must grade the SAME text production ships, or a passing
 * sweep proves nothing about the running game.
 *
 * WHAT THIS IS NOT. Layer 1 (the frozen world rules + reply contract) and layer 3 (the
 * volatile turn: known words, who is nearby, what was heard) are assembled elsewhere;
 * only layer 2 lives here. The three-layer split exists so layers 1 and 2 are byte-stable
 * across a session and can sit behind a cache breakpoint (§ 5.5, § 6a).
 *
 * ⚠️ DETERMINISM IS A REQUIREMENT, NOT A STYLE CHOICE. The output must be byte-identical
 * for the same NPC on every call — no dates, no shuffling, no Set/Map iteration whose
 * order depends on insertion elsewhere. A single moved character invalidates the prefix
 * cache for every turn that follows it.
 *
 * ⚠️ NO META LANGUAGE (§ 14 Q27). Nothing rendered here may mention a scene, an objective,
 * a player, a learner, a game or a model. The NPC is told who it is, never what it is for.
 * `completionRule` is the field most at risk — it is authored as observable preconditions
 * in the character's own terms, and `assertNoMetaLanguage` guards it in tests.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.5, § 5.6, § 14 Q2/Q27.
 */

/**
 * Trait level → an English phrase, per dimension.
 *
 * WHY A TABLE AND NOT THE AUTHOR'S PROSE ALONE: `IWTrait.note` is already rendered
 * verbatim, so this is not about information — it is about COMPARABILITY. Two NPCs
 * written by two authors describe "impatient" differently; the level phrase gives the
 * model one consistent scale, so 小陈's agreeableness 2 and 老周's agreeableness 5 read as
 * points on the same axis rather than as two unrelated adjectives. The prose then supplies
 * the specificity the scale cannot.
 *
 * Index is `level - 1`.
 */
const TRAIT_SCALES: Record<string, readonly [string, string, string, string, string]> = {
  temperament: [
    'Your mood runs low and sours easily.',
    'Your mood is flat.',
    'Your mood is even.',
    'Your mood is good-humoured.',
    'Your mood is warm and hard to dent.',
  ],
  agreeableness: [
    'You do not accommodate anyone.',
    'You are not accommodating.',
    'You accommodate someone if they ask, but you never offer.',
    'You accommodate someone who is struggling without being asked twice.',
    'You are endlessly patient.',
  ],
  energy: [
    'You are very slow.',
    'You are unhurried.',
    'You speak at an ordinary pace.',
    'You are busy and quick.',
    'You are fast and restless.',
  ],
  maturity: [
    'A sharp word derails you.',
    'You take a sharp word personally.',
    'You bristle at rudeness, then let it go.',
    'You mostly absorb rudeness.',
    'Rudeness slides off you.',
  ],
  motivation: [
    'Almost nothing moves you to act.',
    'You act when it is easy or when you must.',
    'You act readily when there is a reason.',
    'You care about doing this particular thing well, and act on that.',
    'You are driven, and will go out of your way.',
  ],
} as const;

/**
 * One trait line: the dimension and its level (so the axis is explicit and comparable),
 * the short scale phrase, then the author's specific prose.
 *
 * The scale phrase is deliberately TERSE. An early version spelled each level out in a
 * full sentence and the result read as the same fact twice — "You are busy. Short bursts
 * of speech between tasks." immediately followed by the author's "Speaks in short bursts
 * between tasks." The scale's job is to place the NPC on an axis; the note's job is
 * to say what that looks like for this particular person.
 */
function renderTrait(dimension: keyof typeof TRAIT_SCALES, trait: IWTrait): string {
  const scale = TRAIT_SCALES[dimension];
  // Levels are typed 1..5, but this is prompt text reaching a model — a bad index would
  // render "undefined" into an NPC's mind rather than throwing anywhere visible.
  const phrase = scale[trait.level - 1] ?? scale[2];
  return `- ${dimension.toUpperCase()} ${trait.level}/5. ${phrase} ${trait.note}`;
}

/** A bulleted block, or a single "(none)" line so the section never renders empty. */
function bullets(items: readonly string[]): string {
  return items.length ? items.map(i => `- ${i}`).join('\n') : '- (nothing in particular)';
}

/**
 * Render one NPC as the layer-2 prompt block.
 *
 * Second person throughout: the model is being told who it IS, not shown a character
 * sheet about somebody. A third-person biography invites narration ("王婶 would probably
 * say...") instead of speech.
 */
export function renderNpcBlock(npc: IWNpc): string {
  const p = npc;
  const sections: string[] = [
    `YOU ARE: ${p.name} (${p.romanization}), id "${p.id}". You are ${p.age}.`,
    `WHAT YOU DO: ${p.occupation}`,
    `WHERE YOU LIVE: ${p.home}`,
    ``,
    `YOUR HISTORY: ${p.history}`,
    ``,
    `WHAT YOU ARE TRYING TO DO WITH YOUR LIFE RIGHT NOW:\n${bullets(p.currentGoals)}`,
    ``,
    `YOUR DAYS: ${p.lifestyle}`,
    ``,
    `WHAT YOU THINK (you volunteer these unprompted):\n${bullets(p.preferences)}`,
    ``,
    `WHAT IS GOING ON WITH YOU THIS MONTH (this is what you make small talk about):\n${bullets(p.ongoingEvents)}`,
    ``,
    `PEOPLE AND ANIMALS YOU TALK ABOUT BY NAME:\n${bullets(p.network)}`,
    ``,
    `WHAT YOU OWN THAT MATTERS TO YOU:\n${bullets(p.property)}`,
    ``,
    `WHAT YOU COME BACK TO WHEN A CONVERSATION GETS PERSONAL:\n${bullets(p.coreMemories)}`,
    ``,
    `HOW YOU ARE:`,
    renderTrait('temperament', p.temperament),
    renderTrait('agreeableness', p.agreeableness),
    renderTrait('energy', p.energy),
    renderTrait('maturity', p.maturity),
    renderTrait('motivation', p.motivation),
    ``,
    `HOW YOU TALK: ${p.register}`,
    // ⚠️ FRAMED AS SAMPLES, NOT AS A FALLBACK SCRIPT. The first wording was "fall back to
    // these when you are unsure", and the 2026-09-01 sweep showed exactly what that buys:
    // 老周 answered four different probes — a meta question, garbage input, an off-topic
    // question and an insult — with the identical canonical line 你慢慢说，不着急。A model
    // is unsure often, so "when unsure" is most of the time, and the richest NPC in the
    // cast collapsed into a parrot. Canonical lines exist so a HUMAN can hear the voice, and
    // so the model can calibrate register; they are not a menu.
    `EXAMPLES OF HOW YOU SOUND — these are samples of your voice, not a script. Do not reuse
them when the moment calls for something else; say the new thing in this voice instead.
${bullets(p.canonicalLines)}`,
  ];

  // Rendered last so it sits closest to the turn — it is the only conditional field, and
  // the one whose preconditions the model has to check against what it just heard.
  if (p.completionRule) {
    sections.push(``, `WHEN YOU WILL AND WILL NOT DO BUSINESS: ${p.completionRule}`);
  }

  return sections.join('\n');
}

/**
 * Meta-language guard for `renderNpcBlock` output (§ 14 Q27).
 *
 * Returns the offending terms, empty when clean. This is a LINT, not a runtime gate: it is
 * meant to run in a test over every registered NPC and in the scene editor when an
 * author saves, because an NPC that mentions the game is a bug that shows up as an NPC
 * explaining itself to a learner — the exact failure `character.js`'s BROKE-CHARACTER flag
 * catches only after the fact and only sometimes.
 *
 * ⚠️ IT MATCHES PHRASES, NOT BARE WORDS, and the first version proved why. A word list
 * containing "game" and "assistant" flagged 小陈 for "a game he plays on the counter" and
 * "shop assistant" — both perfectly good in-world prose. An NPC lives in a world that
 * contains games, users, tasks and levels; what it must never contain is a reference to
 * ITSELF as software or to the fiction as a fiction. So the patterns below are the
 * multi-word shapes that failure actually takes, plus the few nouns that have no innocent
 * reading in an NPC.
 *
 * This trades recall for precision on purpose: a lint that cries wolf on ordinary
 * biography gets suppressed, and then catches nothing at all.
 */
const META_PATTERNS: readonly RegExp[] = [
  /\blanguage model\b/i, /\bsystem prompt\b/i, /\bAI\b/, /\bNPC\b/, /\bchatbot\b/i,
  /\bthe player\b/i, /\bthe learner\b/i, /\bthe user\b/i, /\bthe student\b/i,
  /\bthis scene\b/i, /\bthe scene\b/i, /\byour objective\b/i, /\bthe objective\b/i,
  /\bcomplete the (scene|objective|task|level)\b/i, /\bend the (scene|game)\b/i,
  /\byou are playing\b/i, /\bin this game\b/i, /\bthe game\b/i,
];

/** The offending fragments, empty when clean. */
export function findMetaLanguage(rendered: string): string[] {
  const hits = META_PATTERNS.map(re => rendered.match(re)?.[0]).filter((m): m is string => !!m);
  return Array.from(new Set(hits));
}
