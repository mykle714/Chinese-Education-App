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

/**
 * `actions` is the list of AUTHORED action names this NPC would be given in a scene
 * (§ 14 Q42). Since `IW_ACTIONS` was deleted there is no global verb list to offer the
 * model — what an NPC can do is per NPC and per scene — so the bench supplies a small
 * plausible set here. `none` is added by scenario.js and must not be listed.
 *
 * @typedef {{ known: string[], nearby: string[], opening: string, happy: string, hardWord: string, rude: string, rudeAgain: string, offtopic: string, actions?: string[] }} ProbeContext
 */

/** @type {Record<string, ProbeContext>} */
export const NPC_PROBES = {
  // 迈克尔 — the companion (§ 14 Q25). He sells nothing and is not approached: the learner
  // arrives to meet him for an outing they already agreed on, so the on-script turn is a
  // GREETING between friends who are still getting re-familiar, not a request.
  michael: {
    actions: ['walk with the learner', 'point something out', 'wait for them to catch up'],
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
    actions: ['serve a bowl', 'take payment', 'wipe the counter', 'call the next customer'],
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
    actions: ['take the phone to look at it', 'quote a price', 'hand the phone back'],
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
    actions: ['offer the stool', 'check on the bird', 'wave someone over'],
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

  // 周敏 — the pharmacy counter. She is the cast's one INFORMATIONAL gate, so her probes
  // are built around whether a vague answer gets waved through: `happy` is deliberately
  // under-specified and the correct reply is another question, not a handover.
  zhou_min: {
    actions: ['ask where it hurts', 'hand something over', 'send them to a doctor'],
    opening: '哪里不舒服？',
    known: ['疼', '头', '肚子', '药', '好', '谢谢', '多少', '钱', '我', '你', '要', '有', '没有', '今天', '天', '几', '一', '二', '三', '不'],
    nearby: ['player "player" at 1 tile, facing you', 'npc_customer at 4 tiles, waiting'],
    // Vague ON PURPOSE. A correct 周敏 asks again rather than accepting it — this is the
    // one probe in the suite where a HELPFUL reply would be the wrong reply.
    happy: '我不舒服',
    // 发烧 sits outside `known` and cannot be avoided in an honest answer.
    hardWord: '我头疼三天了，还发烧，怎么办？',
    rude: '你们这儿什么药都没有。',
    rudeAgain: '别问了，快点给我拿药。',
    offtopic: '你觉得美国的政治怎么样？',
  },

  // 马师傅 — a moving car, so `nearby` has no third party and no distance to speak of. He
  // is the one NPC whose failure mode is talking too MUCH, so his probes leave room for it.
  ma_shifu: {
    actions: ['pull over', 'take the fare', 'point something out'],
    opening: '朋友，去哪儿啊？',
    known: ['去', '哪儿', '这儿', '那儿', '多少', '钱', '快', '慢', '好', '谢谢', '我', '你', '要', '停', '前面', '左', '右', '一', '二', '三'],
    nearby: ['player "player" at 1 tile, in the back seat'],
    happy: '我去火车站',
    // 堵车 is outside `known`, and it is exactly the subject he will volunteer unprompted.
    hardWord: '这条路怎么这么堵？要多久？',
    rude: '你开得太慢了！',
    rudeAgain: '真的，换个人开都比你快。',
    offtopic: '你觉得美国的政治怎么样？',
  },

  // The pre-registry inline NPC from scenario.js. Same probes the 18/18 run used.
  bench: {
    actions: ['serve a bowl', 'take payment'],
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
