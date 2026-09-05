/**
 * Per-NPC probe context for the character sweep (docs/IMMERSIVE_WORLD.md § 5.6, § 12 phase 1c).
 *
 * WHY THIS FILE EXISTS. The original sweep was written against ONE inline 王婶 in
 * scenario.js, so its probes could hard-code noodles: the on-script turn was 我要一碗面 and
 * the rude turn was 你的面很难吃！. Neither means anything to a phone-repair kiosk or a
 * retired man on a folding stool. Run unchanged against 小陈 you are no longer measuring
 * character fidelity — you are measuring how an NPC copes with a non-sequitur, which every
 * NPC fails equally and which tells you nothing.
 *
 * So the sweep splits in two:
 *   - character.js holds the SEVEN NPC-agnostic probes (English fallback, meta question,
 *     injection, nonsense, off-topic, silence, and the rude turn's shape). Those are learner
 *     behaviours, not scene content, and they must be identical across the cast or the
 *     NPCs are not comparable.
 *   - this file holds the FOUR things that cannot be shared: what the learner is assumed to
 *     know, who is standing nearby, the on-script opening (`opening`), and the one request that reaches
 *     just past the learner's vocabulary.
 *
 * `known` IS THE GRADER'S RULER, not decoration. character.js measures the vocabulary budget
 * as "content characters outside `known`, function words exempt", so a `known` list that does
 * not fit the NPC's own trade produces VOCAB flags on perfectly good replies. Each list
 * below is a plausible early-learner vocabulary FOR THAT ENCOUNTER — roughly A1, and
 * deliberately including the nouns the NPC cannot avoid using.
 *
 * `bench` is the inline 王婶 from scenario.js, kept so the historical 18/18 baseline
 * (§ 5.6) stays reproducible after the registry NPCs replaced her. It is not a
 * registry NPC and `npcById('bench')` will not resolve it.
 *
 * Referenced by: scripts/bench/npc-latency/character-run.js, character.js.
 */

/** @typedef {{ known: string[], nearby: string[], opening: string, happy: string, hardWord: string, rude: string, rudeAgain: string, offtopic: string }} ProbeContext */

/** @type {Record<string, ProbeContext>} */
export const NPC_PROBES = {
  // 迈克尔 — the companion (§ 14 Q25). He sells nothing and is not approached: the learner
  // arrives to meet him for an outing they already agreed on, so the on-script turn is a
  // GREETING between friends who are still getting re-familiar, not a request.
  michael: {
    known: ['你好', '好', '我', '你', '去', '吃', '喝', '走', '今天', '明天', '很', '什么', '哪儿', '谢谢', '朋友', '喜欢', '工作', '累', '一', '二'],
    nearby: ['player "player" at 1 tile, facing you', 'npc_wang at 5 tiles, at her stall'],
    opening: '哎，你来啦！',
    happy: '好久不见，你还好吗？',
    // Points straight at the app — the thing he most wants to be asked about (his
    // ongoingEvents), and unanswerable inside `known`. 老周's bird probe in the same shape.
    hardWord: '你的软件做得怎么样了？',
    // He has no product and no counter, so rudeness has to be personal — 老周's case.
    rude: '你这个人真无聊。',
    rudeAgain: '真的，跟你出来一点意思都没有。',
    offtopic: '你觉得美国的政治怎么样？',
  },

  // The registry's 王婶 — same trade as the inline bench NPC, so the same ruler applies.
  wang_shen: {
    opening: '热的还是凉的？',
    known: ['面', '碗', '要', '热', '凉', '好', '谢谢', '多少', '钱', '一', '二', '三', '我', '你', '吃', '来', '这个', '那个', '大', '小'],
    nearby: ['player "player" at 2 tiles, facing you', 'npc_li at 7 tiles, behind a stall (muffled)'],
    happy: '我要一碗面',
    // Reaches one word past `known` (大碗 as a unit). A clean reply teaches exactly one.
    hardWord: '我要一个大碗',
    rude: '你的面很难吃！',
    rudeAgain: '真的，这么难吃，我不会再来了。',
    offtopic: '你觉得美国的政治怎么样？',
  },

  // 小陈 — the trade is repair, so the vocabulary is objects and faults, not food.
  xiao_chen: {
    opening: '行，多少钱的？',
    known: ['手机', '坏', '钱', '多少', '好', '谢谢', '一', '二', '三', '我', '你', '要', '看', '这个', '那个', '大', '小', '快', '今天'],
    nearby: ['player "player" at 2 tiles, facing you', 'npc_stallkeeper at 6 tiles, across the aisle'],
    happy: '我的手机坏了',
    // 屏幕 is outside `known` and unavoidable in the answer — the budget's honest test.
    hardWord: '我要修屏幕，多少钱？',
    // Aimed at the work, like 王婶's, because that is what a low-maturity character reacts to.
    rude: '你根本不会修！',
    rudeAgain: '别装了，你就是不会修。',
    offtopic: '你觉得美国的政治怎么样？',
  },

  // 老周 — he sells nothing, so there is no transaction vocabulary at all. This is the
  // NPC most likely to blow the budget, because small talk has no fixed nouns.
  lao_zhou: {
    opening: '你慢慢说，不着急。',
    known: ['好', '你好', '谢谢', '我', '你', '要', '来', '坐', '吃', '这个', '那个', '大', '小', '今天', '很', '老', '家', '人', '一', '二'],
    nearby: ['player "player" at 2 tiles, facing you', 'npc_wang at 3 tiles, at her stall'],
    happy: '你好，我可以坐这儿吗？',
    // Points straight at the bird — the thing he most wants to be asked about (§ his
    // ongoingEvents), and the thing he cannot answer inside `known`.
    hardWord: '你的鸟今天怎么样？',
    // He has no product to insult, so the rudeness has to be personal. High maturity says
    // this should slide off; that is the prediction being tested.
    rude: '你天天坐这儿，很烦。',
    rudeAgain: '你听见没有？让开点。',
    offtopic: '你觉得美国的政治怎么样？',
  },

  // The pre-registry inline NPC from scenario.js. Same probes the 18/18 run used.
  bench: {
    opening: '要几碗？',
    known: ['面', '碗', '要', '热', '凉', '好', '谢谢', '多少', '钱', '一', '二', '三', '我', '你', '吃', '来', '这个', '那个', '大', '小'],
    nearby: ['player "player" at 2 tiles, facing you', 'npc_li at 7 tiles, behind a stall (muffled)'],
    happy: '我要一碗面',
    hardWord: '我要一个大碗',
    rude: '你的面很难吃！',
    rudeAgain: '真的，这么难吃，我不会再来了。',
    offtopic: '你觉得美国的政治怎么样？',
  },
};
