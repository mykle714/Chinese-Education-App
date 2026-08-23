# Word Taxonomy — outstanding review items

**Status: DESIGN / DRAFT.** Nothing is built. No migration, no column, no
enrichment step, no UI.

> Child of [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md), sibling of
> [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md). Clusters answer *"how many
> distinct meanings does this headword carry?"*; this doc answers *"what kind of
> thing is each of those meanings about?"*.

**This doc has been reduced to what still needs a decision.** Settled material is
kept as a compact register in § 3 with no expansion; § 4 is the live review queue.
Every Chinese word in § 4 carries its pinyin and definition so a row can be judged
without a dictionary lookup.

Companion artifacts (filterable, same content):

| Artifact | Covers | URL |
|---|---|---|
| Lexical Dimensions of Chinese | sweep 01 — the open adjective/adverb rows | https://claude.ai/code/artifact/dc3c8584-6ff4-43a4-8bcb-c708cdcd3767 |
| Kinds of Thing | sweep 02 — physical-noun groups, with a needs-my-review filter | https://claude.ai/code/artifact/16774933-ddce-452d-9a33-63397d353d08 |
| **The Word Tree** | **the live structure** — one uniform tree, every accepted node, browsable to any depth | https://claude.ai/code/artifact/2e229044-a7b6-45b3-a1e7-66e67c16629d |
| The Accepted Skeleton | *superseded by The Word Tree* — the three-column node/link map, kept for comparison | https://claude.ai/code/artifact/f4e75495-92a8-40eb-88f4-c1d3127984bf |

Sources live in the session scratchpad (`words02.py` → `data02.json` → `mkart02.py` /
`mkmap.py`); every Chinese word on the pages is read from `dictionaryentries_zh` at
build time, so pinyin and glosses never drift from det.

---

## 1. The four decisions the whole scheme rests on

**1a. Classify the sense cluster, not the det row.** 干 is "to do" *and*
"shield"; 会 is a modal *and* a meeting *and* (kuài) accounting. Any word-level
taxon is wrong for at least one sense. The carrier is a key on each
`definitionClusters[]` object — beside `reading`, `pos`, `gender` and the
per-cluster frequency score — which also inherits the existing per-sense
validation and approval machinery.

**1b. A scalar word is (dimension, pole, intensity).** 好 and 坏 are one
dimension with two poles, not two unrelated entries. The dimension is
POS-independent: 好 (adjective) and 好好 (adverb) are the same dimension, and the
det row for 好 carries **five** POS tags. **POS is a facet, not a rank.**

**1c. A sense may belong to several groups. Duplication is allowed** *(accepted
2026-08-21)*. 白菜 is a plant and a food and is listed under both, in full, with
no "primary" one privileged in the reading experience. Groups may even nest
reciprocally — a *food* order under `plant`, and a *plant* order under `food`.
The test a root group must pass is **"is this a meaningful set of words to a
learner?"**, not "does this partition the lexicon?".

Two consequences follow and are not yet decided:

- **The dotted path stops being the identity.** A sense carries a *set* of paths.
  Whatever the storage shape ends up being, it cannot be one string column.
- **Coverage stops being self-checking.** Under a strict tree, an unclassified
  word was one with no parent. Under a set-of-paths model a lazily single-listed
  word looks exactly like a complete one. The proposed remedy is one nominated
  **primary path per sense** — used for coverage counting and default sort only,
  with unlimited secondary listings for browsing. Logged as **Q23**.

**1d. One node class, arbitrary depth** *(accepted 2026-08-21)*. There are no
ranks and no node types. **A node is a named group of words; it may contain other
nodes.** That is the whole model. `all words` is a node, `physical` is a node,
`temperature` is a node, `more` (the positive pole of `temperature`) is a node,
and 热 is a node that happens to have no children. Depth is free: a branch may go
five levels deep while its neighbour stops at two, and neither is malformed.

This replaced two earlier structures at once:

- **The four fixed ranks** (Kingdom / Class / Order / Genus) are gone. They forced
  every branch to cut at the same granularity, which the noun sweep was already
  straining against.
- **The three drawn node *kinds*** (property dimension / entity kind / operator) are
  gone. Drawing them as three species quietly claimed they were different sorts of
  thing. They are not — `qualities` is a group of words, `temperature` is a group of
  words inside it, `more` is a group of words inside that. Poles and dimensions became
  ordinary nodes, and the property side folded into the same tree as the nouns.

---

## 2. The top of the tree

The seven kingdoms are retired. The first level under `all words` is now a set of
folk-named branches — the test is the same one a root group has to pass, *"is this
a meaningful set of words to a learner?"*.

| Branch | Was | State |
|---|---|---|
| `physical` | `entity` (the concrete half) | swept — § 5 |
| `qualities` | `property` | swept — § 3 |
| `grammar` | `operator` + `relation › spatial` + `property › quantity › unit` | swept — § 3 |
| `time` | `entity › temporal` | accepted, two children (`point`, `span`) |
| `place` | `entity › place` | accepted, unswept members |
| `events` | `occurrence` | **named but empty** — sweep 04 (925 verbs) |
| `ideas` | `abstraction` | **named but empty** — sweep 03 |
| `people & society` | *(new)* | **named but empty** — sweep 03 |
| `speech acts` | `expressive` | one accepted child (`onomatopoeia`) |

Two structural notes:

- **`grammar` is a real win from the flattening.** Measure words (个, 只, 位, 棵, 朵)
  sat under `property › quantity › unit` purely because the rank system had nowhere
  else to put them. Under "words that do a job rather than name a thing" they are
  obviously at home, next to negation and degree.
- **A proposed intermediate node, `physical › made thing`**, gathers `item`,
  `wearable`, `object`, `structure` and `component`, so the hold/size/fixity split
  lives one level down instead of five siblings wide at the top. Free depth is what
  makes this legal. **Needs review.**

⚠️ § 5 still writes its groups as `entity › <name>`. Those paths predate the
flattening and now read `physical › <name>`; the group names and rulings are
unaffected.

## 3. Sweep 01 — adjectives & adverbs  ·  **PINNED 2026-08-20**

Derived from the **full set** of `dictionaryentries_zh` rows tagged `adjective`
(599) and `adverb` (214), hand-sorted. Work on this POS pair is **paused**: the
accepted categories below are final unless reopened deliberately, and the open
rows in § 4 are parked, not abandoned. The next sweep (§ 5) moves to nouns.

### 3.1 Accepted — 29 categories

Row numbers are stable across this doc and the companion artifact.

**Scalar dimensions — all → `property`.** A scalar word is (dimension, pole,
intensity); antonyms share a row.

| # | Dimension | Positive pole | Negative pole |
|---|---|---|---|
| 1 | quality | 好, 棒, 优, 一流, 出色, 上流, 中用, 得力 | 坏, 差, 三流, 下流, 不行, 不中用, 不力 |
| 2 | size | 大, 天大, 高大, 特大, 高头大马 | 小, 小小, 区区, 矮, 点大 |
| 3 | quantity | 多, 不少, 很多, 许多, 无数 | 少 |
| 4 | speed | 快, 立刻, 马上 | 慢, 慢慢, 缓慢 |
| 5 | difficulty | 困难, 不可多得 | 容易, 方便, 简单 |
| 6 | truth · authenticity | 真, 地道, 地地道道, 道地 | 假, 名义上, 空头, 来路不明 |
| 7 | beauty | 好看, 漂亮, 优雅, 美, 动人, 拉风, 上相, 打眼 | 丑, 难看 |
| 8 | moral standing | 人道, 公道, 光明磊落, 磊落, 有德行, 心安理得 | 不道德, 不人道, 下作, 黑心, 无义, 无道 |
| 9 | fairness | 公平, 合理, 有理, 明理, 天公地道, 合情合理 | 不公, 不合理, 无理, 不平, 气不平 |
| 10 | legality | 合法 | 不合法, 不法, 无法无天 |
| 11 | cleanliness | 干净, 光光 | 脏 |
| 12 | temperature | 热, 火 | 冷, 冰 |
| 13 | health | 健, 健康 | 头疼, 有病, 病重, 过敏 |
| 14 | price · cost | 便宜, 免费 | 贵, 高利 |
| 15 | age · newness | 新, 新生, 新任, 新出生, 日新 | 旧, 年老, 年长, 老年, 高年 |
| 16 | intelligence | 聪明, 高明, 有心眼, 老成 | 笨, 二, 菜 |
| 17 | emotional state | 开心, 高兴, 兴奋, 得意, 悠闲, 平静, 安心, 自在, 泰然 | 不安, 忐忑, 惊慌, 担心, 紧张, 难过, 心事重重 |
| 18 | character · disposition | 大方, 斯文, 文气, 开明, 温文, 心眼大, 认真 | 小气, 小心眼, 多心, 多事, 自大, 花心, 生分 |
| 19 | suitability · fit | 宜, 得体, 合意, 可体, 合时, 合心, 合用, 管用, 有用 | 不中用, 无用, 可有可无 |
| 20 | certainty | 一定, 分明, 明明, 明白 | 不定, 不明, 可能, 不一定, 未卜, 不明不白 |
| 21 | publicness | 公开, 公有, 公用, 明里, 书面, 出名, 有名, 闻名 | 地下, 无名, 化外 |
| 22 | completeness | 一空, 周, 淋漓, 淋漓尽致, 深入, 通体 | *none attested* |
| 23 | origin · nativeness | 天生, 生来, 生性, 人工, 外来, 后天, 自发 | *none attested* |
| 24 | frequency | 经常, 通常, 总是, 时时, 天天, 日日, 年年, 成天 | 偶尔, 时不时, 不时, 从来不 |
| 25 | strength · power | 有力, 得力, 大力, 牛 | 无力, 不力, 有气无力 |

**Categorical dimensions — → `property`.** Same grouping, but the values are a
discrete set with no poles and no intensity.

| # | Dimension | Value set |
|---|---|---|
| 26 | colour | 红, 黄, 蓝, 绿, 黑, 白, 橙色, 紫色, 粉色, 灰色, 金色, 金黄, 大红 |
| 27 | shape | 方, 方头, 平, 直, 空心, 中空, 平方 |
| 28 | material | 金, 水, 冰, 火 (in compounds) |

A dimension therefore carries a **value type**: `scalar` or `categorical`.
Intensity words *about* a categorical value (通红, 白花花, 火红) carry both.

**Operators — do not sit on a scale, they operate on one.**

| # | Group | Members | Placement |
|---|---|---|---|
| 29 | degree modifiers | 很, 特, 大大, 分外, 有加, 重重, 老大 · 有点儿, 有一点, 三分, 不大 | `operator › degree` |
| 30 | approximators | 几乎, 差不多, 大概, 快 ("almost"), 大体, 大体上 | `operator › degree` |
| 31 | negation & scope | 不, 无, 没有, 别 · 不无, 无不, 无人不, 不得不 · 一点不, 不加, 不用, 不得, 不可 · 无故, 无缘无故, 平白 | `operator › negation` |

**Positional — a place on a frame of reference, not a degree.**

| # | Group | Members | Placement |
|---|---|---|---|
| 34 | spatial position | 上, 下, 左, 前, 水上, 水下, 海上, 地下, 线上, 线下, 上面, 后面 | `relation › spatial` |
| 35 | temporal position | 今天, 昨天, 明天, 现在, 最近, 后天, 未来, 早, 晚, 之后, 然后, 后来, 尔后, 本来 | `entity › temporal` |
| 36 | duration · span | 一生, 平生, 长年, 经年, 多年来, 有年头, 一时, 不一会 | `entity › temporal` |
| 37 | ordinal · rank | 第一, 头一, 无上, 亚 | ordinal node (unplaced) |

⚠️ 一流 / 二流 / 三流 look ordinal but sit on row 1's **quality** scale.

### 3.2 Accepted structural decisions

- **The unit is the sense cluster, not the det row** (§ 1a).
- **A scalar word is (dimension, pole, intensity)**; POS is a facet, not a rank (§ 1b).
- **"Sounds" is a facet** (`modality`), not a kingdom — sound words split across four
  kingdoms (a bang is an occurrence, a bell an artifact, "shrill" a property, 汪汪
  an expressive).
- **"Locations" is `entity › place`** — location is a role, not a kind.
- **Time is `entity › temporal`**, a sibling class to `place`, with `period` and
  `point` as its two orders.
- Also confirmed as nodes: `entity › substance`, `entity › collective`,
  `expressive › onomatopoeia`, `property › quantity › unit`.

### 3.3 Rejected — do not re-propose

- **The functional cut of adverbs** (manner / degree / frequency / volition /
  scope). "Manner" swallowed a third of the adverbs without saying anything about
  them, and a "volition" group (deliberate vs accidental vs innate) grouped words
  by a distinction too thin to be a category.
- **"Sounds" and "locations" as kingdoms** — see § 3.2.

---

## 4. Sweep 01 — outstanding, parked with the sweep

Thirteen categories awaiting a decision, plus two data-bug rows that need fixing
but not a ruling. Row numbers are stable across this doc and the artifact.

**Reading of the last round:** rows 1–31 accepted, rows 34–37 accepted. That
leaves **rows 32, 33 and 38–48** open. If 32 and 33 were meant to be accepted
along with the other operators, say so and they move to § 3.


---

## 4.1 Operators still open

### Row 32 — Quantificational scope & focus

**Kind:** Operator — does not sit on a scale, it operates on one  
**Proposed placement:** `operator › scope`  
**Why grouped:** Ranges over participants

**Question:** one group, or split? Totality (都, 通通, 举世), typicality (大多, 一般), distributive (分头, 一一), collective (一起, 一道) and focus (就, 光, 又, 不仅) are arguably five things sharing only "ranges over participants".

| Word | Pinyin | Definition |
|---|---|---|
| 都 | dōu | all; both |
| 通通 | tōng tōng | all; entire |
| 通体 | tōng tǐ | the whole body |
| 举世 | jǔ shì | throughout the world; world ranking (e.g. first) |
| 大多 | dà duō | mostly; for the most part |
| 一般 | yī bān | ordinary; common |
| 分头 | fēn tóu | separately; severally |
| 一一 | yī yī | one by one; one after another |
| 一起 | yī qǐ | together; in company (with) |
| 一道 | yī dào | together |
| 手拉手 | shǒu lā shǒu | to join hands; hand in hand |
| 就 | jiù | just; simply |
| 光 | guāng | light; bright |
| 又 | yoù | (once) again; also |
| 外加 | wài jiā | in addition; extra |
| 不仅 | bù jǐn | not just; not limited to |
| 不光 | bù guāng | not only; not the only one |

### Row 33 — Epistemic stance

**Kind:** Operator — does not sit on a scale, it operates on one  
**Proposed placement:** `operator › modal`  
**Why grouped:** Speaker's attitude to the proposition

**Question:** does epistemic stance belong with the operators, or is it closer to the accepted **certainty** dimension (row 20)? 一定 and 明明 went to certainty; 其实 and 不意 are here. The line between them is thin.

| Word | Pinyin | Definition |
|---|---|---|
| 其实 | qí shí | actually; in fact |
| 不意 | bù yì | unexpectedly; unawareness |
| 得无 | dé wú | isn't it that...?; (literary) isn't it that...? |
| 安得 | ān dé | how could one get; (literary) How can one get...? |
| 怎么 | zěn me | how?; why? |

---

## 4.2 Classificatory adjectives — the large hole

Nine productive patterns, ~15% of the adjectives. All share one property: they
are derived from a noun, non-gradable, and have no antonym — you cannot be
"very inorganic". They assert **membership in a class** or a **relation to a
noun**, so they sit on no dimension at all.

**The decision (Q12):** resolve each to the noun it derives from (电动 →
electricity, 水生 → water, 民事 → law) and treat the adjectival form as a facet —
which keeps the tree semantic but makes "give me all the -ical words"
a facet query; **or** give them a node of their own, which is easier to browse
but re-implements part of the tree.

That nine separate patterns exist, several with productive morphology (性, 电-,
-生), is the argument for a node.


### Row 38 — Scientific class

**Kind:** Classificatory — noun-derived, non-gradable, no antonym  
**Proposed placement:** `source noun + facet`  
**Why grouped:** Non-gradable, no antonym

You cannot be “very inorganic.” These assert **membership in a class**, not a position on any axis.

| Word | Pinyin | Definition |
|---|---|---|
| 有机 | yǒu jī | organic |
| 无机 | wú jī | inorganic; inorganic (chemistry) |
| 无性 | wú xìng | asexual; asexual (reproduction) |
| 线性 | xiàn xìng | linear; linearity |
| 可数 | kě shǔ | countable; denumerable |
| 不可数 | bù kě shǔ | uncountable |
| 火成 | huǒ chéng | (geology) igneous; volcanic (rock) |
| 风成 | fēng chéng | produced by wind; eolian |
| 特发性 | tè fā xìng | idiopathic |

### Row 39 — Powered · driven by

**Kind:** Classificatory — noun-derived, non-gradable, no antonym  
**Proposed placement:** `source noun + facet`  
**Why grouped:** Relation to a noun

| Word | Pinyin | Definition |
|---|---|---|
| 电动 | diàn dòng | electric-powered; (Tw) video game |
| 气动 | qì dòng | pneumatic |
| 机动 | jī dòng | motorized; power-driven |
| 手动 | shǒu dòng | manual; manually operated |
| 自动 | zì dòng | automatic; voluntarily |
| 光电 | guāng diàn | photoelectric |

### Row 40 — Domain of use

**Kind:** Classificatory — noun-derived, non-gradable, no antonym  
**Proposed placement:** `source noun + facet`  
**Why grouped:** Relation to a noun

| Word | Pinyin | Definition |
|---|---|---|
| 民用 | mín yòng | (for) civilian use |
| 家用 | jiā yòng | home-use; domestic |
| 公用 | gōng yòng | for public use; public |
| 日用 | rì yòng | of everyday use; daily expenses |
| 外用 | wài yòng | external |
| 口服 | kǒu fú | to take orally; to take medicine orally |
| 本科 | běn kē | undergraduate course; undergraduate (attributive) |

### Row 41 — Botanical life cycle

**Kind:** Classificatory — noun-derived, non-gradable, no antonym  
**Proposed placement:** `source noun + facet`  
**Why grouped:** Relation to a noun

| Word | Pinyin | Definition |
|---|---|---|
| 一年生 | yī nián shēng | annual (plant); (botany) (of a plant) annual |
| 二年生 | èr nián shēng | biennial plant; (botany) (of a plant) biennial |
| 多年生 | duō nián shēng | perennial; (botany) (of a plant) perennial |
| 水生 | shuǐ shēng | aquatic; aquatic (plant, animal) |

### Row 42 — Medium

**Kind:** Classificatory — noun-derived, non-gradable, no antonym  
**Proposed placement:** `source noun + facet`  
**Why grouped:** Relation to a noun

| Word | Pinyin | Definition |
|---|---|---|
| 有线 | yǒu xiàn | wired; cable (television) |
| 无线 | wú xiàn | wireless |
| 红外 | hóng wài | infrared (ray) |
| 电子 | diàn zǐ | electronic; electron (particle physics) |
| 电气 | diàn qì | electrical; electric |

### Row 43 — Legal · institutional

**Kind:** Classificatory — noun-derived, non-gradable, no antonym  
**Proposed placement:** `source noun + facet`  
**Why grouped:** Relation to a noun

| Word | Pinyin | Definition |
|---|---|---|
| 法定 | fǎ dìng | statutory; law-based |
| 国有 | guó yǒu | state-owned; government owned |
| 公有 | gōng yǒu | publicly owned; communal |
| 民事 | mín shì | civil case; civil |
| 民主 | mín zhǔ | democracy; democratic |

### Row 44 — “-ical” — the 性 suffix

**Kind:** Classificatory — noun-derived, non-gradable, no antonym  
**Proposed placement:** `source noun + facet`  
**Why grouped:** Productive suffix

A productive suffix generating an entire family. Relevant to the **affixes** table.

| Word | Pinyin | Definition |
|---|---|---|
| 生物性 | shēng wù xìng | biological |
| 生理性 | shēng lǐ xìng | physiological |
| 神经性 | shén jīng xìng | neural; neurological |
| 语意性 | yǔ yì xìng | semantic |
| 流行性 | liú xíng xìng | (of a disease) epidemic |
| 地区性 | dì qū xìng | regional; local |
| 地方性 | dì fāng xìng | local |
| 后天性 | hoù tiān xìng | acquired; acquired (characteristic etc) |
| 理性 | lǐ xìng | rationality; rational |

### Row 45 — Bilateral pairs

**Kind:** Classificatory — noun-derived, non-gradable, no antonym  
**Proposed placement:** `source nouns (proper)`  
**Why grouped:** Two proper nouns

| Word | Pinyin | Definition |
|---|---|---|
| 中日 | zhōng rì | China-Japan |
| 中法 | zhōng fǎ | Sino-French; China-France |
| 中美 | zhōng měi | China-USA; Central America |
| 中西 | zhōng xī | Chinese-Western; China and the West |
| 日美 | rì měi | Japan-US |
| 美中 | měi zhōng | US-China |
| 巴阿 | bā a | Pakistan-Afghan |

### Row 46 — Proper-name derived

**Kind:** Classificatory — noun-derived, non-gradable, no antonym  
**Proposed placement:** `proper facet`  
**Why grouped:** From a name

| Word | Pinyin | Definition |
|---|---|---|
| 法西斯 | fǎ xī sī | fascist (loanword) |
| 巴罗克 | bā luó kè | baroque |
| 布尔 | bù ěr | Boole (surname); (math.) Boolean |

---

## 4.3 A morphological pattern


### Row 47 — Presence · absence

**Kind:** Morphological pattern  
**Proposed placement:** `resolve to the noun`  
**Why grouped:** 有 X / 无 X — productive and binary

Some land on an accepted dimension through their noun (有名/无名 → publicness, 有力/无力 → strength). Others are purely existential and behave like the classificatory rows.

| Word | Pinyin | Definition |
|---|---|---|
| 有色 | yǒu sè | colored; non-white |
| 无色 | wú sè | colorless |
| 有名 | yǒu míng | famous; well-known |
| 无名 | wú míng | nameless; obscure |
| 有情 | yǒu qíng | to be in love; sentient beings (Buddhism) |
| 无情 | wú qíng | merciless; ruthless |
| 有力 | yǒu lì | powerful; forceful |
| 无力 | wú lì | powerless; lacking strength |
| 有理 | yǒu lǐ | reasonable; justified |
| 无理 | wú lǐ | unreasonable; irrational |
| 有用 | yǒu yòng | useful |
| 无用 | wú yòng | useless; worthless |
| 无人 | wú rén | unmanned; uninhabited |
| 无水 | wú shuǐ | waterless; dehydrated |
| 无声 | wú shēng | silent; noiseless |
| 有电 | yǒu diàn | electrified; electric (apparatus) |
| 有风 | yǒu fēng | windy |
| 有味 | yǒu wèi | tasty |
| 有病 | yǒu bìng | to be ill; (coll.) to be not right in the head |

---

## 4.4 Situation descriptors — the small hole


### Row 48 — Situation descriptors

**Kind:** Situational — describes a scene, not a thing  
**Proposed placement:** `occurrence › state of affairs`  
**Why grouped:** Describes a scene, not a thing

Ask what dimension 车水马龙 sits on and there is no answer. Almost all 成语.

| Word | Pinyin | Definition |
|---|---|---|
| 车水马龙 | chē shuǐ mǎ lóng | heavy traffic; endless stream of horse and carriages (idiom) |
| 人山人海 | rén shān rén hǎi | vast crowd; (idiom) multitude |
| 空无一人 | kōng wú yī rén | deserted; not a soul in sight (idiom) |
| 水天一色 | shuǐ tiān yī sè | water and sky as one; water and sky merge in one color (idiom) |
| 明日黄花 | míng rì huáng huā | fig. outdated; thing of the past |
| 来日方长 | lái rì fāng cháng | ample time later; there will be ample time for that later |
| 长生不老 | cháng shēng bù lǎo | to live forever; (idiom) to live forever and never grow old |
| 风风火火 | fēng fēng huǒ huǒ | bustling; energetic |

**Question:** confirm `occurrence › state of affairs` as a node? A state of
affairs is a state, so it fits under `occurrence`; the alternative is to treat
these as unclassifiable idioms and let the `idiom` facet carry them.


---

## 4.5 Data-quality backlog — no ruling needed, just fixes

### 4.5.1 `partsOfSpeech` is assigned at word level, so it is wrong for some senses

The tag is applied to the headword, not the cluster, so any polysemous word gets a
tag from whichever sense the tagger read. 相机 is tagged `adverb` because a
literary sense means "as circumstances allow"; its everyday meaning is **camera**.
Same for 光 (light / bright / ray / **only**), 白 (white / **in vain**), 好, 快,
大, 多, 新, 早, 直, 本, 老.


### Row 49 — Mis-tagged verbs

**Kind:** Data bug in `partsOfSpeech`, not a category  
**Proposed placement:** `fix partsOfSpeech per cluster`  
**Why grouped:** Tagged adjective, actually a verb

| Word | Pinyin | Definition |
|---|---|---|
| 放松 | fàng sōng | to relax; to loosen |
| 惊慌 | jīng huāng | to panic; to be alarmed |
| 打动 | dǎ dòng | to move (to pity); touching |
| 担心 | dān xīn | to worry; to be anxious |
| 流动 | liú dòng | to flow; to circulate |
| 开化 | kāi huà | to become civilized; to be open-minded |
| 独立 | dú lì | independent; independence |
| 负责 | fù zé | to be in charge; to be responsible for |
| 自主 | zì zhǔ | to act independently; to be autonomous |
| 用心 | yòng xīn | to be attentive; to be diligent or attentive |
| 渐进 | jiàn jìn | gradual progress; progress step by step |
| 齐心 | qí xīn | to be of one mind; to work as one |
| 上色 | shàng sè | to color (a picture etc); to dye (fabric etc) |
| 合手 | hé shǒu | to join palms; to work with a common purpose |

### Row 50 — Mis-tagged nouns

**Kind:** Data bug in `partsOfSpeech`, not a category  
**Proposed placement:** `fix partsOfSpeech per cluster`  
**Why grouped:** Tagged adjective, actually a noun

| Word | Pinyin | Definition |
|---|---|---|
| 数字 | shù zì | number; digit |
| 生物 | shēng wù | living creature; organism |
| 水平 | shuǐ píng | level; a level (of ability, development etc) |
| 神经 | shén jīng | nerve; mental state |
| 科学 | kē xué | science; scientific |
| 自由 | zì yóu | freedom; liberty |
| 花 | huā | flower; blossom |
| 草 | cǎo | grass; straw |
| 菜 | cài | dish (of food); vegetable |
| 火 | huǒ | fire; urgent |
| 水 | shuǐ | water; extra income |
| 金 | jīn | gold; golden |
| 神 | shén | god; deity |
| 背 | bēi | the back; the back of a body or object |
| 重点 | chóng diǎn | main point; important point |
| 本分 | běn fèn | one's duty; (to play) one's part |
| 机车 | jī chē | locomotive; train engine car |
| 风光 | fēng guāng | scene; view |
| 动物学 | dòng wù xué | zoology; zoological |
| 相机 | xiàng jī | camera; at the opportune moment |

### 4.5.2 Tone marks are misplaced on the `-ou` rime — 2,414 rows

`pronunciation` places the tone mark on the **u** of `ou` instead of the **o**:
`goù` for gòu, `shoù` for shòu, `roù` for ròu, `hoù` for hòu, `toù` for tòu,
`loù` for lòu, `doù` for dòu. Surfaced while pulling pinyin for this doc — 又 came
back as `yoù` and 后天性 as `hoù tiān xìng`.

```sql
SELECT count(*) FROM dictionaryentries_zh WHERE pronunciation ~ 'o[ùúǔū]';
-- 2414
SELECT count(*) FROM dictionaryentries_zh
  WHERE pronunciation ~ 'a[ìíǐī]' OR pronunciation ~ 'a[òóǒō]';
-- 0  → the ai/ao rimes are correct; this is specific to ou
```

Mechanically fixable: move the diacritic one vowel left wherever the rime is `ou`.
Other individual errors seen in the same pull: 巴阿 = `bā a` (missing tone on 阿),
重点 = `chóng diǎn` (wrong reading — should be zhòng diǎn for "main point"),
背 = `bēi` where the entry's lead sense is "the back" (bèi).

---

## 5. Sweep 02 — physical things (nouns)

Source: the 3,102 `dictionaryentries_zh` rows tagged `noun`. Physical things were
taken next because they are the easy part of the noun space — a concrete referent
either exists in the world or it does not, so there is no dimension/pole machinery
to argue about.

Live review state, with a **needs-my-review** filter and per-group reviewed ticks:
the *Kinds of Thing* artifact linked at the top of this doc. **§ 5.2's flat list of
`entity › <name>` classes was restructured on 2026-08-21** — read § 5.0 for the
shape that is actually current; the group listings below it remain accurate about
*membership* but not about *placement*.

### 5.0 The `physical` branch as it now stands  ·  **RULED 2026-08-21**

```
all words
├─ physical
│  ├─ animate                accepted
│  │  ├─ person              accepted   └─ fictional            new
│  │  └─ animal              accepted   ├─ food animal          new
│  │                                    └─ mythical             new
│  ├─ plant                  accepted   └─ fungus               accepted
│  ├─ microscopic            new        └─ microbe              accepted
│  ├─ body part              accepted
│  │  ├─ common anatomy      new        └─ common organs        new
│  │  └─ medical             new
│  ├─ food                   accepted   dish · ingredient · drink  (all accepted)
│  ├─ item                   accepted   loose: 花 花朵 鲜花
│  │  ├─ man-made            accepted   tool · electric device · container · media
│  │  └─ wearable            accepted   (moved here from made thing)
│  ├─ object                 accepted
│  │  └─ man-made            accepted   vehicle · machine · furnishing
│  ├─ component              accepted   one group per whole it belongs to
│  ├─ structure              accepted   building · room · infrastructure
│  ├─ science & engineering  new        electrical engineering · biology
│  │                                    chemistry · physics
│  ├─ elements               accepted   fire · water · earth · air · metal · wood
│  │                                    electricity · ice · light · dark · poison · spirit
│  ├─ weather                accepted   雨 雪 风 云 雷 闪电 …
│  ├─ substance              accepted   (+ 石头 沙子, rehomed)
│  ├─ geography              accepted
│  ├─ celestial              accepted   └─ proper noun          new
│  ├─ space                  accepted   (renamed from void)
│  └─ fictional              accepted   (renamed from fictive)
├─ collective                accepted   raised out of physical
├─ ideas                     NEW        sweep 03 — 8 groups, all need review
├─ people & society          NEW        sweep 03 — 6 groups, all need review
├─ language                  NEW        sweep 03 — 4 groups, all need review
├─ events                    open       things that happen (925 verbs land here, sweep 04)
│  ├─ holidays               accepted   also under time › period › festival — Q39
│  ├─ historical events      accepted   proper nouns ONLY (二战 冷战 长征 五四运动 …)
│  ├─ military               accepted   war · combat action · end of fighting · uprising
│  ├─ disaster               new        natural · accident
│  ├─ ceremony · gathering · performance          new
│  ├─ competition (└─ proper noun) · assessment   new
│  ├─ crime & justice · politics & protest        new
│  └─ life event · daily routine                  new
├─ conditions                accepted   NEW top-level — a state you are IN
│  ├─ illness                accepted   moved out of events
│  ├─ injury                 new
│  └─ bodily state           new
├─ qualities · place · speech acts
├─ grammar                   accepted
│  ├─ degree                 accepted   intensifier · diminisher · approximator
│  ├─ negation               accepted   plain negators loose; └─ double negative
│  ├─ measure word           accepted
│  ├─ spatial relation       accepted
│  └─ conjunction            NEW        joining · contrast · cause · condition · alternative
└─ time                      accepted
   ├─ point · span           accepted
   ├─ unit                   NEW        秒 分钟 小时 天 日 星期 周 月 年 世纪
   ├─ time of day            NEW        早上 中午 晚上 半夜 黄昏 白天 黑夜
   ├─ period                 NEW        season · tide · festival · time off
   └─ era                    NEW        generic loose; └─ proper noun (dynasties, 民国)
```

**`made thing` is dissolved.** `wearable` went under `item`; `component` and
`structure` became siblings of `item` and `object`. Madeness is now said exactly
once, by the `man-made` node inside `item` and `object` — which resolves Q27 the
way § 7 recommended.

**`component` is grouped by the whole it belongs to** — `plane component`,
`train component`, `car component`, `engine component`, `computer component`,
`electrical component`, `plumbing component`, `bird component`,
`animal component`, `plant component`. The rule is fully mechanical: a component
word joins the group named for the thing it is part of, so classifying one
requires no judgement beyond reading its gloss. `component of anything` holds
零件 / 部件 / 表面 / 边缘, which name parthood itself rather than a part of some
particular whole.

**`natural object` is removed**, its members rehomed: 石头 沙子 → `substance`,
蛋 → `food › ingredient`, 化石 → `science & engineering › biology`, and
羽毛 贝壳 树叶 → the matching `component` groups. A feather is a bird component in
the same sense a wing is a plane component; the class was never doing work the
component rule doesn't do better.

**`science & engineering` absorbed the old `particle` class** — 中子 电子 光子
质子 夸克 原子核 to `physics`, 分子 原子 化合物 to `chemistry`, 合子 细胞 基因 to
`biology`. That is a split no single `particle` node could have made.

**`phenomenon` is dropped.** `elements` was broadened past 五行 to the union of
every culture's and every fantasy setting's element set, and each element became a
**bundling node** rather than a single word: `fire` holds 火 火花 火光 明火,
`electricity` holds 电 电流 闪电 雷 天电. Those two took phenomenon's last words.

**`electronics` → `electrical engineering`**, refilled with the field's own
vocabulary (电压, 电流, 电阻, 电容, 电磁, 变压器, 二极管, 伏特, 欧姆, 瓦特) rather
than its gadgets. 电脑 and 手机 went back to living only under `item`, which
removes half of what Q32 complained about.

**`component of anything` is flattened** — 零件 部件 表面 边缘 hang directly off
`component` beside the per-whole groups.

**Renames, all accepted:** `void` → **`space`**, `fictive` → **`fictional`**,
`device` → **`electric device`**.

**`collective` was raised out of `physical`** to sit beside it under `all words`.
A crowd of people and a heap of rubbish are not themselves a kind of physical
thing.

⚠️ The § 5.2 group listings below predate all of this. They remain accurate about
**membership**; they are wrong about **placement**.

### 5.1 Two things to know about the noun set

**It is ~10% administrative place names.** 263 entries end in 县 / 市 / 区 / 镇 /
乡 / 省 / 州 — 三亚市, 东光县, 上城区, 台安县. Add universities (东海大学), brands
(海尔, 特斯拉, 法拉利) and transliterated foreign names (加拉加斯, 明斯克) and a
large minority of the "nouns" are proper names. **Open question, separate from the
taxonomy: should county-level Chinese toponyms be discoverable learner vocabulary
at all?** They inflate every noun-based count here.

**Chinese noun compounds are head-final, so the last character usually names the
category.** Counted over the same 3,102 rows:

| Head | Count | Category it signals |
|---|---|---|
| 学 | 87 | discipline (物理学, 生物学, 眼科学) |
| 子 | 85 | ⚠️ nominal suffix — *not* a category (桌子, 电子, 儿子) |
| 人 | 83 | person (外国人, 本地人, 病人) |
| 家 | 49 | practitioner (化学家, 作家, 地理学家) |
| 车 | 35 | vehicle (汽车, 火车, 出租车) |
| 机 | 30 | machine (发动机, 洗衣机, 无人机) |
| 水 | 26 | liquid / substance (洗发水, 矿泉水, 地下水) |
| 器 | 22 | device (合成器, 电器, 理发器) |
| 石 | 15 | stone / mineral (大理石, 电气石, 火石) |
| 花 | 13 | ⚠️ flower — breaks under metaphor (火花 "spark") |

A cheap bootstrapping signal for the enrichment pass: a 车-final compound is a
vehicle with high confidence. The two ⚠️ rows are the exceptions.

### 5.2 The groups

Naming rulings made 2026-08-21, all user-directed:

- **`artifact` is dead.** For most people the word means an Indiana Jones relic.
  It was split on two criteria speakers actually hold: **`item`** = you hold it
  *and* it has a function (a pebble fails the second test, a car fails the first);
  **`object`** = made for a purpose but too big to hold; **`structure`** = fixed
  to the ground, entered or crossed rather than used; **`wearable`** = worn, so it
  fails `item`'s hold test while sharing everything else.
- **`natural feature` → `geography`**, accepted.
- **`natural object`** added to catch what the pebble test exposed: discrete,
  natural, no designed function.
- **`organism` → `animate`**, with `plant` as a sibling rather than a child.
- **`body part`, `plant`, `food`** accepted; **`component`** split off `body part`
  to hold the parts of made things.

#### `entity › animate` — needs review

It moves, it wants things, it can be hurt. The distinction people hold natively — and the one zh classifiers mark.

Orders: person · animal

- **person** — 医生 (yī shēng, doctor), 水手 (shuǐ shǒu, sailor), 朋友 (péng you, friend), 孩子 (hái zi, child)
- **animal** — 狗 (gǒu, dog), 猫 (māo, cat), 牛 (niú, cow), 兔子 (tù zi, rabbit), 海马 (hǎi mǎ, (zoology) sea horse), 石龙子 (shí lóng zi, skink), 鱼 (yú, fish), 虾 (xiā, shrimp)

#### `entity › plant` — **accepted**

Alive but not animate. A sibling of animate, not a child of a shared biological parent.

Orders: plant · fungus · microbe

- **plant** — 树 (shù, tree), 柠檬 (níng méng, lemon), 石南花 (shí nán huā, heather (Ericaceae)), 大黄 (dà huáng, rhubarb (botany)), 白菜 (bái cài, Chinese cabbage, esp. napa cabbage (Brassica rapa subsp. pekinensis)), 苹果 (píng guǒ, apple), 茶 (chá, tea)
- **fungus** — 蘑菇 (mó gu, mushroom), 木耳 (mù ěr, wood ear)
- **microbe** — 细菌 (xì jūn, bacterium), 病毒 (bìng dú, virus)

#### `entity › body part` — **accepted**

Parts of a living body. Accepted.

Orders: *(flat — no orders)*

- **members** — 头 (tóu, head), 眼睛 (yǎn jing, eye), 下巴 (xià ba, chin), 气管 (qì guǎn, windpipe), 头发 (tóu fa, hair (on the head)), 海马体 (hǎi mǎ tǐ, hippocampus), 人中 (rén zhōng, philtrum), 骨头 (gǔ tou, bone), 血 (xuè, blood)

#### `entity › component` — new this round — needs review

Parts of made things, and surfaces. Split off because zh names them with body vocabulary — 机头, 水龙头.

Orders: part of a made thing · surface

- **part of a made thing** — 机头 (jī tóu, nose of a plane), 火车头 (huǒ chē tóu, train engine), 水龙头 (shuǐ lóng tóu, faucet), 口器 (kǒu qì, mouthparts)
- **surface** — 表面 (biǎo miàn, surface), 边缘 (biān yuán, edge)

#### `entity › item` — new this round — needs review

Hand-held and made for a purpose. A pebble fails the second test; a car fails the first.

Orders: tool · device · container · media

- **tool** — 刀 (dāo, knife), 剃须刀 (tì xū dāo, razor), 梳子 (shū zi, comb), 钥匙 (yào shi, key), 工具 (gōng jù, tool)
- **device** — 相机 (xiàng jī, camera), 手机 (shǒu jī, mobile phone), 电脑 (diàn nǎo, computer)
- **container** — 杯子 (bēi zi, cup), 瓶子 (píng zi, bottle), 盒子 (hé zi, box), 袋子 (dài zi, bag)
- **media** — 书 (shū, book), 本子 (běn zi, notebook), 杂志 (zá zhì, magazine), 画 (huà, picture), 登机牌 (dēng jī pái, boarding pass)

#### `entity › wearable` — new this round — needs review

Worn rather than held, so it fails item's hold test while sharing everything else.

Orders: *(flat — no orders)*

- **members** — 外套 (wài tào, coat), 毛衣 (máo yī, (wool) sweater), 眼镜 (yǎn jìng, eyeglasses)

#### `entity › object` — new this round — needs review

Made for a purpose, too big to hold. The car tier.

Orders: vehicle · machine · furnishing

- **vehicle** — 汽车 (qì chē, car), 火车 (huǒ chē, train), 大巴 (dà bā, coach), 白车 (bái chē, ambulance), 自行车 (zì xíng chē, bicycle), 船 (chuán, boat), 飞机 (fēi jī, airplane), 摩托车 (mó tuō chē, (loanword) motorbike)
- **machine** — 机器 (jī qì, machine), 发电机 (fā diàn jī, generator), 无人机 (wú rén jī, drone), 洗衣机 (xǐ yī jī, washing machine), 电视 (diàn shì, TV)
- **furnishing** — 桌子 (zhuō zi, table), 椅子 (yǐ zi, chair), 柜子 (guì zi, cupboard), 冰箱 (bīng xiāng, refrigerator), 沙发 (shā fā, sofa (loanword))

#### `entity › structure` — new this round — needs review

Fixed to the ground; entered, crossed, or occupied rather than used.

Orders: building · room · infrastructure

- **building** — 医院 (yī yuàn, hospital), 图书馆 (tú shū guǎn, library), 大楼 (dà lóu, building (a relatively large, multistory one)), 房子 (fáng zi, house)
- **room** — 厨房 (chú fáng, kitchen), 房间 (fáng jiān, room)
- **infrastructure** — 桥 (qiáo, bridge), 路 (lù, road), 铁路 (tiě lù, railroad), 大门 (dà mén, gate)

#### `entity › natural object` — new this round — needs review

Discrete, natural, no designed function. The pebble class.

Orders: *(flat — no orders)*

- **members** — 石头 (shí tou, stone), 沙子 (shā zi, sand), 蛋 (dàn, egg), 鸡蛋 (jī dàn, (chicken) egg), 羽毛 (yǔ máo, feather), 贝壳 (bèi ké, shell (of a mollusk)), 树叶 (shù yè, tree leaves), 化石 (huà shí, fossil)

#### `entity › food` — **accepted**

Accepted as a real root group. Most of its members are cross-listed — a cabbage is a plant and a food, and stays in both.

Orders: dish · ingredient · drink

- **dish** — 三明治 (sān míng zhì, (loanword) sandwich), 火锅 (huǒ guō, hotpot), 炒饭 (chǎo fàn, fried rice), 包子 (bāo zi, steamed stuffed bun), 米饭 (mǐ fàn, (cooked) rice), 面条 (miàn tiáo, noodles), 菜 (cài, dish (of food))
- **ingredient** — 牛肉 (niú roù, beef), 肉 (roù, meat), 白菜 (bái cài, Chinese cabbage, esp. napa cabbage (Brassica rapa subsp. pekinensis)), 苹果 (píng guǒ, apple), 水果 (shuǐ guǒ, fruit), 蘑菇 (mó gu, mushroom), 鸡蛋 (jī dàn, (chicken) egg), 鱼 (yú, fish), 虾 (xiā, shrimp)
- **drink** — 水 (shuǐ, water), 茶 (chá, tea), 咖啡 (kā fēi, (loanword) coffee), 牛奶 (niú nǎi, cow's milk), 矿泉水 (kuàng quán shuǐ, mineral water)

#### `entity › substance` — **accepted**

Stuff rather than things: no shape of its own, measured not counted.

Orders: *(flat — no orders)*

- **members** — 水 (shuǐ, water), 冰 (bīng, ice), 气体 (qì tǐ, gas), 白金 (bái jīn, platinum), 合金 (hé jīn, alloy), 大理石 (dà lǐ shí, marble), 纸 (zhǐ, paper), 布 (bù, cloth), 血 (xuè, blood), 肉 (roù, meat), 牛奶 (niú nǎi, cow's milk)

#### `entity › geography` — **accepted**

Features of the land itself, at a scale you travel through.

Orders: *(flat — no orders)*

- **members** — 山 (shān, mountain), 火山 (huǒ shān, volcano), 河 (hé, river), 湖 (hú, lake), 海 (hǎi, sea), 台地 (tái dì, tableland), 地平线 (dì píng xiàn, horizon), 火山口 (huǒ shān kǒu, volcanic crater), 山洞 (shān dòng, cavern)

#### `entity › celestial` — needs review

Bodies beyond the atmosphere.

Orders: *(flat — no orders)*

- **members** — 天体 (tiān tǐ, celestial body), 太阳 (tài yang, sun), 月亮 (yuè liang, the moon), 地球 (dì qiú, the earth), 卫星 (wèi xīng, satellite), 星星 (xīng xing, (coll.) a star), 南门二 (nán mén èr, Alpha Centauri)

#### `entity › particle` — needs review

Physical but not pointable. Brings a scientific register with it.

Orders: *(flat — no orders)*

- **members** — 中子 (zhōng zǐ, neutron), 电子 (diàn zǐ, electronic), 光子 (guāng zǐ, photon), 分子 (fēn zǐ, (chemistry) molecule), 合子 (hé zǐ, zygote (biology))

#### `entity › phenomenon` — needs review

Happens rather than sits — but names a thing while it happens.

Orders: *(flat — no orders)*

- **members** — 火 (huǒ, fire), 光 (guāng, light), 电 (diàn, electricity), 火花 (huǒ huā, spark), 电流 (diàn liú, an electric current), 火光 (huǒ guāng, flame), 明火 (míng huǒ, flame), 天电 (tiān diàn, static), 雨 (yǔ, rain), 雪 (xuě, snow), 风 (fēng, wind)

#### `entity › collective` — **accepted**

Many things spoken of as one. The group was confirmed back in sweep 01; only its membership is open.

Orders: *(flat — no orders)*

- **members** — 人群 (rén qún, crowd), 群 (qún, a group (of people or animals)), 队伍 (duì wǔ, ranks), 林 (lín, forest), 树林 (shù lín, woods), 家具 (jiā jù, furniture), 垃圾 (lā jī, trash)

#### `entity › void` — new this round — needs review

A named absence: physical, locatable, made of nothing.

Orders: *(flat — no orders)*

- **members** — 洞 (dòng, cave), 缝 (féng, crack), 口子 (kǒu zi, opening), 空间 (kōng jiān, space)

#### `entity › fictive` — needs review

No referent in the world, but behaves grammatically like one that has.

Orders: *(flat — no orders)*

- **members** — 天马 (tiān mǎ, celestial horse), 大力神 (dà lì shén, Heracles), 点金石 (diǎn jīn shí, philosopher's stone), 神 (shén, god), 上龙 (shàng lóng, pliosaurus)


**Why `animate` and not `organism`.** A single biological class is the
scientifically tidy cut but not how untrained speakers carve the world: *animate*
— it moves, it wants things, it can be hurt — is a distinction people hold
natively, and one the language marks (animacy drives zh classifier choice, 个/只/位
vs 棵/朵). Plants are alive but not animate, so they get a sibling class rather
than being folded in above the level people actually think at. **This is a
learner's map, so folk categories beat scientific ones wherever the two
disagree.** 生物 / 有机体 "organism" are then ordinary members of `abstraction`,
not the name of a rank.

### 5.3 Cross-listings in this sweep

Per § 1c these words are listed in two groups each, and are the joins between
them. 肉 is the sharpest: flesh is a body part, meat is a food, and Chinese does
not distinguish them.

| Word | Groups |
|---|---|
| 白菜 (bái cài, Chinese cabbage) | plant + food |
| 茶 (chá, tea) | plant + food |
| 蘑菇 (mó gu, mushroom) | plant + food |
| 苹果 (píng guǒ, apple) | plant + food |
| 水 (shuǐ, water) | substance + food |
| 牛奶 (niú nǎi, cow's milk) | substance + food |
| 肉 (roù ⚠️, meat) | body part + food |
| 血 (xuè, blood) | body part + substance |
| 石头 (shí tou, stone) | substance + geography |
| 树林 (shù lín, woods) | collective + plant |
| 鸡蛋 (jī dàn, chicken egg) | natural object + food |

⚠️ 肉's stored pinyin is `roù` — the `-ou` tone-mark bug of § 4.5.2, live in a word
this common.

### 5.4 Open questions for this sweep

**Q15 — Do particles belong under `substance`, or their own class?** 电子 and 分子
are physical but not pointable, and bring a scientific register (中子数, 有机分子,
光电子) that is otherwise homeless.

**Q16 — Are phenomena `entity` or `occurrence`?** 火 behaves like a thing, 火花 is
an event. *Recommendation: cross-list — exactly the case § 1c was accepted for.*

**Q17 — Is `structure` distinct from the accepted `entity › place`?** 医院 is a
building you point at and a place you are in; 厨房 is a room, part of one.
Duplication lets it be both — what is left is whether `structure` earns a root
group or is `place` seen from outside.

**Q18 — Does `component` hold as its own class?** zh names the parts of made
things with body vocabulary (机头, 火车头, 水龙头 all use 头). The gamble is that a
*surface* (表面, 边缘) belongs in the same class as a machine's nose.

**Q19 — Which members does `collective` take?** ⚠️ The group itself is **already
accepted** — § 3.2 confirmed `entity › collective` in sweep 01. Only membership is
open: 人群 and 队伍 are uncontroversial, but 树林 and 垃圾 may just be plural plants
and plural rubbish, i.e. the `countability` facet.

**Q20 — Brands and proper artifacts.** 特斯拉, 法拉利, 海尔, 国美电器 are objects
*and* proper names. Falls out of Q9 if proper becomes a facet.

**Q21 — Is `item` / `object` a kind split or a size facet?** 手机 and 电视 are the
same kind of thing at different scales; so are 杯子 and 冰箱. The split is real to
speakers, which is the whole test — but if it is scale rather than kind it may
want to be a `portability` facet over one made-thing class instead of two classes.

**Q22 — Does `void` survive contact with the data?** 洞, 缝, 口子, 空间 are
physical, locatable and made of nothing. Four members is thin; if it stays this
small it folds into `component` as a negative-space order.

**Q23 — With duplication allowed, does a sense still need one *primary* path?**
See § 1c. *Recommendation: yes — one primary path per sense for coverage counting
and default sort, unlimited secondary listings for browsing.*

---

## 5.5 Sweep 03 — non-physical nouns  ·  **FIRST PROPOSAL 2026-08-21**

**Everything in this sweep needs review.** Three branches that were empty
placeholders now carry a first cut: `ideas`, `people & society`, and a new
top-level `language`.

**Method — head-character frequency.** Chinese noun compounds are head-final, so
the final character of a compound usually names its category (§ 5.1). Counting
final characters over the **2,642** noun rows left after administrative toponyms
are stripped gives a real map of the noun space *and* a size estimate per group,
in one pass. `server/scripts` has no equivalent yet; the count is reproducible
from `dictionaryentries_zh` with a `partsOfSpeech @> '["noun"]'` filter.

| Head | Rows | Proposed group | Examples |
|---|---|---|---|
| 学 | 86 | `ideas › field of study` | 数学, 化学, 物理, 哲学, 医学 |
| 人 | 82 | `people & society › nationality & ethnicity` | 中国人, 美国人, 外国人 |
| 家 | 46 | `people & society › occupation` (the -ist slot) | 书法家, 画家 |
| 化 | 33 | `ideas › process` (the -ization slot) | 现代化, 全球化, 一体化 |
| 语 · 文 | 63 | `language › language name` | 中文, 英语, 汉语 |
| 义 | 31 | `ideas › doctrine` (the -ism slot) | 主义, 资本主义, 人道主义 |
| 性 | 28 | `ideas › quality noun` (the -ness slot) | 人性, 可能性, 重要性 |
| 数 | 24 | `ideas › number` | 数字, 分数, 百分比 |
| 法 | 22 | `ideas › law & rule` | 法律, 宪法, 制度 |
| 心 | 22 | `ideas › mind & feeling` | 感情, 想法, 记忆 |
| 病 | 22 | `events › illness` | 病, 疾病, 感冒, 癌症 |
| 字 · 音 | 38 | `language › script`, `language › sound` | 汉字, 拼音, 发音, 口音 |
| 族 | 17 | folds into `nationality & ethnicity` | 汉族 |

Plus, from no single head: `kinship` (爸爸, 妈妈, 哥哥), `social role` (主人,
客人, 邻居), `life stage` (婴儿, 少年, 青年, 老人), `institution` (公司, 政府,
银行 — the organisation, not the building, so it cross-lists with
`structure › building`), `method` (方法, 办法, 手段), `word & phrase` (词, 句子,
成语).

**The head count is a sizing signal, not a rule.** 面 (42) and 头 (40) rank high
and mean nothing coherent; 体 (38) splits across body, substance and abstraction.
But where a head *is* coherent it hands you a group and its rough size together,
which is a far better starting point than reading 2,642 glosses.

**Why `language` is top-level and not under `ideas`:** over 100 rows are about
language itself. That is too large a slice of det to bury one level down, and a
learner looking for 拼音 will not look under "ideas".

---

## 5.6 Sweep 05 (partial) — `grammar` and `time`  ·  **FIRST PROPOSAL 2026-08-21**

Taken out of order, because `time` was a two-node stub (`point`, `span`) that
could not hold the commonest vocabulary in the language, and because the
conjunctions were worth seeing before the rest of sweep 05.

**`negation` flattened.** 不 无 没有 别 now sit directly on `negation`; the old
`plain` node is gone and `double` is renamed `double negative`. The rule this
sets: **only the marked case earns a group.** An unmarked default does not need
a node to name it — the same reasoning that dissolved `component of anything`.

**`grammar › conjunction` — new, 25 words.** Sub-grouped by the relation the
conjunction asserts between the two halves it joins, because a conjunction names
nothing and so has no other classification available:

| Group | Members |
|---|---|
| `joining` | 和 与 以及 并且 而且 而 |
| `contrast` | 但是 可是 不过 然而 虽然 尽管 不但 不仅 |
| `cause` | 因为 所以 因此 于是 |
| `condition` | 如果 要是 除非 只要 即使 |
| `alternative` | 或者 还是 |

This is the first branch whose sub-groups are **relations, not kinds** — worth
noting because sweep 05's other closed classes (prepositions, particles) will
probably want the same treatment.

**`time` — four new groups.**

| Group | Contents | Why |
|---|---|---|
| `unit` | 秒 分钟 小时 天 日 星期 周 月 月份 年 世纪 | the calendar/clock units; see **Q38** |
| `time of day` | 早上 上午 中午 下午 晚上 夜 半夜 午夜 黄昏 傍晚 清晨 白天 黑夜 | recurring points inside a day |
| `period` | `season` · `tide` · `festival` · `time off` | a named stretch that **recurs** |
| `era` | generic words loose; `proper noun` for named ones | a **one-off** stretch of history |

`period` is the answer to "where does 春天 or 涨潮 go": both are a *phase of a
cycle* — neither a point nor a duration — and once that is the criterion,
festivals and 周末 fall in with them. `era` uses the same `proper noun` child
that `celestial` uses: 唐朝 宋朝 明朝 清朝 汉朝 民国 are named individuals, while
史前 古代 近代 现代 当代 年代 时代 时期 朝代 王朝 are generic and sit loose on
the node.

**Data-quality finds in this batch** (no ruling needed): 时代's lead gloss in
`dictionaryentries_zh` is *"Time, US weekly news magazine"* and 现代's is
*"Hyundai, South Korean company"* — the proper-noun sense has displaced the
ordinary one. Both are overridden on the artifact and both should be re-ordered
in det.

---

## 5.65 `events` vs `conditions` — the happens/is line  ·  **RULED 2026-08-21**

`illness` was originally filed under `events` on the reasoning that an illness is
a state that *happens to you*. That was overruled, and the replacement line is
sharper:

> **`events` is what happens. `conditions` is what you are in.**

`conditions` is a new top-level branch holding `illness` (病 疾病 感冒 发烧 癌症
糖尿病 高血压 头疼 咳嗽 腹泻 发炎) plus two proposed siblings that the line
immediately implies — `injury` (伤 残疾) and `bodily state` (怀孕 饥饿 疲劳 失眠
过敏 中毒 压力). The two proposals exist because a branch with exactly one child
is not yet a branch; both need review.

`events` gains two ruled groups:

| Group | Contents |
|---|---|
| `holidays` | 节日 春节 中秋节 国庆节 圣诞节 情人节 母亲节 新年 生日 |
| `historical events` | generic: 战争 世界大战 内战 战役 革命 起义 政变 · `proper noun`: 一战 二战 冷战 抗战 鸦片战争 五四运动 文化大革命 大跃进 长征 |

`historical events` was **corrected on 2026-08-21**: it holds proper nouns
**only** — 一战 二战 冷战 抗战 鸦片战争 五四运动 文化大革命 大跃进 长征. The
generic war words it originally carried loose (战争 世界大战 内战 战役 革命 起义
政变) moved into a new `military` group.

That correction is instructive about the proper-noun device. `celestial` and
`time › era` both keep the *kind* words loose on the parent and group the named
individuals in a `proper noun` child. `historical events` does neither: the named
individuals **are** the node, and the kind words live in a *sibling* branch. The
rule that reconciles the three is: **a node is either about a kind or about
individuals, never both — a `proper noun` child is what you use when they have to
share a parent, and a sibling branch is what you use when they do not.**

**Data-quality finds** (no ruling needed): 革命's lead gloss in
`dictionaryentries_zh` is the archaic *"to withdraw the mandate of heaven…"*
rather than "revolution"; 二战's stored pronunciation is `er zhàn`, missing the
tone mark on 二 — the same class of bug as § 4.5.2's `-ou` rime, but a different
cause, so the two are not one fix.

---

### 5.65.1 Sweep of `events` — ten more groups  ·  **FIRST PROPOSAL 2026-08-21**

Hand-built from det noun rows, ahead of sweep 04's 925 verbs. All ten are `new`.

| Group | Contents |
|---|---|
| `military` | `war` 战争 世界大战 内战 战役 打仗 冲突 · `combat action` 进攻 撤退 投降 侵略 空袭 轰炸 开火 征服 占领 包围 埋伏 袭击 · `end of fighting` 停战 休战 和平 · `uprising` 革命 起义 政变 |
| `disaster` | `natural` 地震 洪水 台风 海啸 干旱 · `accident` 事故 车祸 火灾 爆炸 · loose 灾难 |
| `ceremony` | 仪式 典礼 婚礼 葬礼 毕业 开学 |
| `gathering` | 会议 聚会 派对 晚会 演讲 展览 谈判 |
| `performance` | 演出 音乐会 演唱会 节目 |
| `competition` | 比赛 竞赛 决赛 运动会 · `proper noun` 奥运会 世界杯 |
| `assessment` | 考试 面试 |
| `crime & justice` | 犯罪 谋杀 抢劫 偷窃 审判 |
| `politics & protest` | 选举 罢工 抗议 示威 |
| `life event` | 出生 死亡 结婚 离婚 搬家 旅行 旅游 |
| `daily routine` | 吃饭 睡觉 休息 工作 |

Two splits worth defending:

- **`disaster › natural` vs `accident`** — the line is whether anyone could have
  prevented it. 火灾 and 爆炸 land on the accident side even though a wildfire is
  natural, which is a real weakness in the criterion.
- **`assessment` is not `competition`** — an exam is judged against a standard,
  a race against the other entrants. Different event shape entirely.

`events` now carries 97 words and **↳ 17 new** on its rolled-up tag, making it
the largest unsettled branch in the tree.

---

## 5.7 Status is rolled up, not just held  ·  **2026-08-21**

A node carries two separate signals on The Word Tree, and the distinction matters
for whatever eventually stores this:

| Signal | Meaning | Rendered as |
|---|---|---|
| **own status** | this node has been ruled on (`accepted`) / is a first proposal (`new`) / is a placeholder (`open`) | filled pill |
| **inherited status** | how many groups *below* it, at any depth, are still `new` or `open` | outlined pill, `↳ 6 new` |

The inherited counts are computed in the generator (`tree.py` → `norm`, fields
`dn` / `dp`) rather than in the page, because they are a fact about the tree, not
about the view. The rule is: a node's `dn` is the number of descendant **groups**
marked `new`; words never contribute, since a word has no status of its own.

Why it exists: with the tree collapsed to depth 3 — the default — an accepted
branch can be hiding a dozen unruled groups four levels down, and it reads as
finished. The rolled-up tag makes that impossible. `all words` currently shows
**↳ 73 new · ↳ 5 to review**, and `physical` alone accounts for 36 of the 73
despite being the only branch described as "mostly ruled".

The outlined tag fades to 22% opacity once its node is expanded, on the grounds
that a summary of what you can already see is noise.

**Consequence for storage (Q6):** if the `taxa` table ever exists, this is an
argument for *not* materialising a rollup column — it is a cheap recursive
aggregate over the adjacency list and it would go stale on every ruling.

---

## 6. Facets — the axes deliberately kept out of the tree

A single-parent tree encodes one dimension. Everything else is a facet: an
independent flat axis on the same sense. If two senses can differ on it while
sitting in the same leaf, it is a facet.

| Facet | Values |
|---|---|
| `pos` | already exists as `partsOfSpeech` — never duplicate it in the tree |
| `pole` | positive / negative / neutral (open: facet or part of the leaf?) |
| `value type` | scalar / categorical (settled, § 3) |
| `domain` | cooking, medicine, law, sport, tech… |
| `register` | neutral, formal, literary, colloquial, slang, vulgar |
| `modality` | sight, sound, taste, smell, touch — where "sounds" went |
| `animacy` | animate / inanimate — drives zh classifier choice; redundant for `entity › animate` members, but still needed to mark animate-*behaving* words elsewhere (神, 天马, 机器人) |
| `countability` | count / mass |
| `idiom` | 成语 and other non-compositional forms |
| `proper` | proper name (open — see Q9) |
| `culture_bound` | 春节, *siesta* |
| frequency | already exists per cluster |

---

## 7. Open questions

**Q1 — What is it FOR?** The consumer decides the granularity and nothing else
does. Sort/discover packs by category? A decks filter? A game mode? Better
enrichment prompts (a taxon is a strong prior for icon choice, example sentences
and classifier selection)? A 4-rank tree is overkill for a filter chip and too
shallow for a curriculum.

**Q4 — Single-parent or multi-label?** "school" (institution + building),
"chicken" (animal + meat), 春节 (time point + event + proper name) are one *sense*
spanning two kingdoms. Options: (a) strict single parent, accept some mis-filing;
(b) one primary path plus secondaries; (c) split the cluster so each taxon gets
its own sense. **(c) is most principled** — it pushes ambiguity into the layer
that already models ambiguity — but it means the taxonomy pass can *modify
clusters*, making it part of the clusterer rather than a step after it.

**Q5 — Is a taxon language-independent?** If the tree is over meanings, 水 and
*agua* share a leaf, and the taxonomy becomes the first cross-language sense link
in the schema. Valuable, but a bigger claim than the data currently supports.

**Q6 — Storage.** (a) a `taxon` string on each `definitionClusters[]` object (no
migration, denormalized); (b) a **`taxa` table** (`id`, `path`, `rank`,
`parentId`, `label`) holding the closed rank-1–3 vocabulary plus growable leaves,
with clusters storing a `taxonId` FK; (c) Postgres `ltree` for native ancestor
queries. Recommendation: **(b) + a cached path string on the cluster**. **No table
or column is created without explicit go-ahead.**

**Q7 — Who assigns it?** Presumably an AI pass alongside the clusterer, gated by
`/mark-discoverable`, with `taxon` added to the validator field list so humans can
approve/flag it like any other enriched field.

**Q8 — Retrofit cost.** Discoverable senses × one AI call each. Worth measuring
before committing to rank-4 granularity.

**Q9 — Proper names: branch or facet?** Beijing is a place, Confucius a person,
Nike an organization, 春节 a time point. Recommendation: a `proper` **facet** plus
normal placement in the referent's kingdom.

**Q12 — Do classificatory adjectives need their own node?** See § 4.2.

**Q13 — Is `pole` a facet or part of the leaf?** Putting 好 and 坏 in the same
leaf makes "teach me quality words" one query, but "only the positive ones" then
needs the facet.

⚠️ **Q6 is reopened by § 1d.** The `taxa` table's `rank` column no longer has a
meaning — ranks are gone. Its replacement is a plain adjacency list (`id`,
`parentId`, `label`) with depth derived, not stored, which is *simpler* than what
Q6 proposed. `ltree` also gets more attractive, since arbitrary depth is exactly
what it is for. **Q13 is answered by § 1d**: a pole is a node (`qualities ›
temperature › more`), so "only the positive ones" is a subtree query, not a facet.

**Q24 — Does anything constrain depth now?** With ranks gone, two branches may
disagree about how finely to cut and no rule says either is wrong. Options: (a)
genuinely free depth — the point of the change; (b) a soft guideline (aim for
3–5 levels) enforced only in review. Recommendation: **(a)**, with § 8 sweeps
reporting depth spread so an outlier branch gets *noticed* rather than *blocked*.

**Q25 — Node identity, now that names repeat.** Three collisions exist already:
`man-made` (under `item` and under `object`) and `fictional` (the child of
`person`, and the renamed top-level class). Identity has to be
the full path or a surrogate id with a display label. Same pressure as Q23;
probably the same answer. Recommendation: **surrogate id + label**, with the path
materialized for display and sort.

~~**Q27 — Does `made thing` still earn its place?**~~ **Answered 2026-08-21: no.**
Dissolved as recommended.

**Q28 — Does `item` need a `natural` sibling to `man-made`?** 花 currently hangs
loose directly under `item`. One loose word is fine; a dozen is a missing node.
Sharper now that `natural object` is removed: there is nowhere else for a held,
natural, purposeful thing to land.

~~**Q29 — `fictive` is down to one word**~~ **Answered 2026-08-21:** kept, renamed
`fictional`, accepted.

~~**Q30 — Does `phenomenon` survive?**~~ **Answered 2026-08-21: no**, dropped.

~~**Q31 — five phases or four elements?**~~ **Answered 2026-08-21: neither** —
the union of every culture's and every fantasy setting's element set.

**Q33 — Is `electrical engineering` the right name?** Its siblings are `biology`,
`chemistry`, `physics` — bare field names — so `electricity` would read more
consistently, but it then collides with `elements › electricity`. I took the
unique label over the consistent sibling set; say if you'd rather have the
consistency and live with the collision (which Q25 has to solve anyway).

**Q34 — `elements` overlaps three ways.** 风, 雷, 闪电, 霜 are under `weather` *and*
`elements`; 光, 电 are also `physics`; 金, 铁, 钢 are also `substance`. Intended —
but `elements` is now plainly a **view** over words that live elsewhere, the same
shape as `science & engineering` (Q32).

**Q35 — Does `ideas › quality noun` duplicate the whole `qualities` branch?**
Every 性 word names a dimension that already exists: 可能性 *is* `certainty`,
重要性 *is* a quality scale. Either it is a real group of nouns, or it is a
derivational facet (-ness) pointing back at `qualities`. Recommendation: **keep
the group, add a facet link** — the nouns are real words a learner meets, but the
dimension should be recoverable.

**Q36 — Is `ideas › process` (化) an idea or an event?** 现代化 is something that
*happens*. Parked until sweep 04 puts real verbs in `events`.

**Q37 — Sweep 03 in general.** All 18 groups across `ideas`, `people & society`
and `language` are first proposals with no ruling on any of them.

**Q38 — `time › unit` and `grammar › measure word` are the same words.** 天 年
月 星期 are calendar units when named and measure words when counted (三天, 两年).
Duplication handles it, but this is the first split that is between *naming* and
*counting* rather than between two senses — so it may be a **facet** (§ 6) rather
than a second home.

**Q41 — answered.** `events › disaster` exists, split `natural` / `accident`.

**Q43 — Is `uprising` military or political?** 革命 起义 政变 are filed under
`military` because that is where the war words went, but they sit just as
naturally beside 选举 罢工 抗议 示威 in `politics & protest`. The two groups may
really be one branch — *political events* — with military as its violent half.

**Q44 — Is `daily routine` a real group?** 吃饭 睡觉 休息 工作 are events by
every test the tree applies, but nobody thinks of eating lunch as an event. If
frequency is what disqualifies them, that is a **facet** (§ 6) and not a node —
and the same scale runs from 吃饭 through 婚礼 to 二战.

**Q45 — `events` is the biggest unswept branch and the verbs have not landed.**
97 words from a hand-built noun sweep; sweep 04 adds 925 verbs. Treat § 5.65.1's
ten groups as a probe of the **shape**, not a proposal for the contents.

**Q42 — Is `conditions` only about bodies?** Everything in it is medical. 状态,
情况 and 条件 all gloss as "condition" in det and are *not* in the branch, because
they name conditionhood rather than a condition. If they belong, `conditions` is
about states in general and needs a different shape — probably a `bodily` child
plus siblings.

**Q39 — answered both ways.** 春节 now sits under `time › period › festival`
*and* `events › holidays`. Duplication doing its job — but one word is carrying
the whole time/event distinction, which is the clearest case yet for Q23.

**Q40 — Most of the new `time` and `conjunction` words are not `discoverable`.**
古代, 唐朝, 或者, 虽然, 世纪, 黄昏 are all present in `dictionaryentries_zh` with
`discoverable = false`. The tree needs them to have shape, but a group whose
members no learner can reach will read as empty in the app. Either these words
should go through `/mark-discoverable`, or the tree needs to distinguish
*structural* members from *reachable* ones.

**Q32 — `science & engineering` duplicates hard.** 电脑 and 手机 sit under
`electronics` *and* under `item › man-made › electric device`; 细菌 sits under
`biology` *and* under `microscopic › microbe`. Duplication working as designed —
but it makes those branches **views** rather than **homes**, which means Q23's
primary path stops being optional. This is the strongest argument yet for Q23.

**Q26 — Is a word a node, or a member of one?** The Word Tree renders words as
nodes with no children, which is what the uniform model implies and what makes
the page honest. The alternative is that leaves are *sense clusters attached to*
nodes — in which case the structure has an edge type after all and § 1d is only
true of the groups. This is the one place the uniform claim might have to yield,
and it should be settled before any storage decision (Q6).

---

## 8. Sweep order

| Sweep | POS | Rows | Status |
|---|---|---|---|
| 01 | adjective + adverb | 599 + 214 | **Pinned** — § 3 accepted, § 4 parked |
| 02 | noun — physical things | 3,102 (subset) | **Mostly ruled** — § 5, § 5.0 |
| 03 | noun — abstract, social, informational | 2,642 non-toponym | **First proposal** — § 5.5, all 18 groups need review |
| 04 | verb | 925 | not started |
| 05 | closed classes: classifier (47), numeral (46), pronoun (40), particle (27), conjunction (26), interjection (21), preposition (16) | 223 | **Partial** — § 5.6 proposes `conjunction` and rebuilds `time`; the rest not started |

Coverage is verified against the POS histogram rather than by imagination — every
group found so far surfaced because a measured count of rows had to go somewhere.

---

## 9. Code & docs this would touch (none of it yet written)

| Area | Reference |
|---|---|
| Cluster shape | `server/contracts/wire.ts` → `DefinitionCluster` |
| Clusterer | `scripts/backfill/chinese/backfill-cluster-definitions.js`, `scripts/backfill/spanish/backfill-cluster-definitions.js` |
| Enrichment gate | `/mark-discoverable` skill |
| Validation | [DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md) |
| Classifier overlap | `particlesandclassifiers` (pct) |
| Bound morphemes | `affixes` table, [BOUND_FORM_WORDS.md](./BOUND_FORM_WORDS.md) |
| Sense identity | [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md), [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) |
| Pinyin bug (§ 4.5.2) | `dictionaryentries_zh.pronunciation` |
