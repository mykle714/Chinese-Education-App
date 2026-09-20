# Beginner Keyboard (Chinese writing input)

> **Status: DESIGN — nothing built.** This file opens the feature and, for now,
> answers exactly one question: **how small a unit can the existing decomposition
> system hand us, and what is the complete inventory of those units?** Everything
> below § 4 is an open question, not a decision.

**Goal.** Let a learner *write* Chinese without already knowing pinyin — by
drawing, not by typing a sound they may not know.

**The interaction (confirmed 2026-09-07).** A drawing area. The learner draws
strokes; the system evaluates the ink into **a component** (or a whole
character). The learner **submits** the component, which **clears the board**, and
they draw the next component of the character they are building. Accumulated
components resolve to candidate characters.

So this is not a keyboard of buttons — it is **component-scoped handwriting
recognition with a composition buffer**. That reframing invalidates most of § 3's
palette-size worry (there are no keys to lay out) and makes § 6 the load-bearing
section.

**Two further decisions, confirmed 2026-09-07:**

- **OPEN recognition.** The app does **not** know which character the learner is
  aiming at. This is the learner's own writing keyboard, not a drill with an
  answer key. So there is no target to grade against — the matcher must rank
  candidates cold. (§ 6c)
- **ORDER-INSENSITIVE lookup.** Components may be submitted in any order; the
  candidate lookup is over the **multiset** of submitted components, not a
  sequence. (§ 6h)
- **AMBIGUITY IS RESOLVED BY THE LEARNER, NOT THE SYSTEM.** A live candidate
  list of possible characters is shown at all times, filtered by what has been
  submitted so far. Writing 人人 shows *every* character containing at least two
  人 — 从, 众, 坐, 两, 座 … — and the learner taps the one they meant. The system
  never guesses a character. (§ 6h, § 6j)

- **THE CANDIDATE LIST IS A SCROLLABLE BAR, SHOWN IN FULL.** It sits at the top
  of the keyboard and holds *every* match, untruncated — the same affordance a
  pinyin IME candidate bar uses. Cells show **glyph + pinyin**, using the naive
  default reading. (§ 6p)
- **EMPTY RESULTS FALL BACK TO 2-CHARACTER WORDS.** When no single character
  matches the buffer, the same component search runs over 2-char det words, whose
  pinyin is context-resolved and therefore better. (§ 6q)

That moves the engineering problem. Uniquely identifying a character stops
mattering; **the ORDER of the candidate list** becomes the whole UX, because the
first handful of visible slots is all most learners will ever read. See § 6j
(length), § 6k (ranking) and § 6p (the bar itself).

---

## 1. The granularity ladder that exists today

Four levels of "smaller than a word" are already modelled in this codebase. Only
two of them are stored as data; the other two are computed or come from a
client-side package.

| # | Level | Where it lives | Shape | Carries meaning? |
|---|---|---|---|---|
| 1 | word → **characters** | `dictionaryentries_zh.breakdown` (jsonb) | `{char: {definition, sense, pronunciation?}}` | **yes** — per-character gloss, sense-tagged in context |
| 2 | character → **visual components** | `dictionaryentries_zh.components` (jsonb, migration 125) | `["木","目","心"]`, ordered most-common-first, multiplicity kept | **no** — shape only |
| 3 | component → **sub-parts** | *not stored*; `componentsOf()` can be re-run on a component | same as level 2 | no |
| 4 | character → **strokes** | `hanzi-writer-data` (npm, already a dependency) | SVG paths + medians per stroke, in stroke order | no |
| 4b | **stroke → which component it belongs to** | *not stored*; derivable from the IDS source's `matches` field — see § 3e | index per stroke | no |

Level 2 is the one the word-search **No Pinyin** hint ladder spends
([WORD_SEARCH_GAME.md § 5a-ii](./WORD_SEARCH_GAME.md)), and it is the level a
beginner keyboard would most plausibly key off.

**Code:** `server/scripts/backfill/chinese/lib/decompose.js`
(`loadDecompositions`, `componentsOf`, `orderByFrequency`) →
`backfill-character-components.js` (writes the column) →
`generate-component-font.js` (subsets the webfont). Runtime read:
`OnDeckVocabService.getWordSearchGrid` → `WordSearchInput.charComponents`.
Client ladder: `src/features/games/wordSearch/componentUnits.ts`.

---

## 2. How far down level 2 actually goes

`componentsOf` is **not** a recursive decomposition to strokes. It applies two
rules (documented at length in `decompose.js`'s header):

- **RULE 1 — a character that IS a radical is atomic.** 口 月 木 目 日 大 行 →
  `[]`. They have no sub-hint worth revealing.
- **RULE 2 — expand a part only when its expansion is a CLEAN RADICAL COMPOUND**
  (≥2 pieces, every piece a *solid* — non-stroke — radical). Otherwise keep the
  part whole.
  - 相 → 木 + 目, both solid radicals → expand, so 想 → `["木","目","心"]`
  - 义 → 丶 + 乂; 丶 is a stroke and 乂 is no radical → 义 stays whole
  - 曲 → 曰 + 丨丨 → 曲 stays whole, so 典 → `["曲","八"]`

There is also a hard `depth >= 3` cap and a cycle guard.

### ⚠️ The consequence that matters for a keyboard: the inventory is NOT closed

The stored components are the *most recognisable* level, not the *smallest*
level. **665 of the 895 distinct components would themselves decompose** if you
ran `componentsOf` on them again:

```
王 → 一 土      门 → 丶 丨      义 → 丶 乂      兴 → ⺍ 一 八
```

So the palette is a **recognition alphabet, not a generative one**. Two keys
cannot be composed into 王; 王 has to be its own key. A keyboard built on this
set is "pick the parts you see", not "build any character from primitives".
If we want a truly closed generative set we would have to either (a) push
decomposition to the stroke level (level 4), or (b) accept the recognition set
and hand-close it. **Open question — see § 4.**

---

## 3. The inventory (measured 2026-09-07)

Measured by re-running `componentsOf` over the det table on the dev box. Two
scopes, because they differ by a factor of 2.5 and the choice is a real design
decision:

### 3a. Whole single-character det table — 9,855 rows

| Metric | Value |
|---|---|
| single-character `dictionaryentries_zh` rows | 9,855 |
| **distinct components** | **895** (219 radicals, 676 non-radical) |
| components used by ≥2 characters | 681 |
| components used by exactly 1 character | 214 |
| characters that are atomic (radical stop) | 209 |
| characters with **no entry in the IDS source at all** | **2,711** — these also yield `[]`, indistinguishably from a genuine radical stop |
| component-count histogram | `0:2920, 1:155, 2:3979, 3:1898, 4:713, 5:156, 6:26, 7:8` |
| full alphabet if atomic characters are also keys (components ∪ atomic chars) | 3,616 |

The 2,711 gap is real: makemeahanzi's `dictionary.txt` holds 9,574 characters and
overlaps the det table on only 7,144 of them. The misses are rare/Ext-A forms
(㐄 㑇 㖞 䁖 …) and traditional variants, plus a handful of junk headwords (`%`,
`A`, `〇`). **A keyboard must not treat "empty components" as "atomic"** — the
word-search ladder can, because an unknown character just costs one reveal, but a
keyboard that offers no parts for a character silently makes it untypeable.

### 3b. Characters appearing in **discoverable** words — 784 chars

This is the corpus a learner can actually meet, and the honest scope for a v1
keyboard.

| Metric | Value |
|---|---|
| distinct characters in discoverable zh words | 784 |
| missing from the IDS source | **0** — full coverage |
| atomic (radical stop) | 75 |
| **distinct components** | **356** (169 radicals, 187 non-radical) |
| avg components per decomposable char | 2.09 (max 6; 6 chars exceed 4) |
| full alphabet (components ∪ atomic chars) | **369** |

Coverage if the keyboard shows only the top-N most common components:

| palette size | decomposable chars fully spellable |
|---|---|
| 50 | 173 / 709 (24.4%) |
| 100 | 337 / 709 (47.5%) |
| 150 | 458 / 709 (64.6%) |
| 200 | 551 / 709 (77.7%) |
| 300 | 655 / 709 (92.4%) |
| **369** | **709 / 709 (100%)** |

The tail is long and flat: of the 356, **199 appear in a single discoverable
character**. A ~150-key board covers two thirds of the corpus; the last third
costs another 200 keys. That shape is the central UX problem of this feature.

### 3c. The 356 discoverable-scope components, most-common-first

Number in parentheses = how many distinct discoverable characters use it.

```
口(80) 木(53) 亻(36) 一(35) 日(35) 氵(34) 人(27) 冂(27) 十(25) 又(25) 土(25) 扌(25)
讠(25) 艹(22) 儿(20) 亠(19) 八(17) 女(17) 寸(17) 辶(17) 厶(16) 宀(16) 纟(16) ⺼(15)
夂(15) 心(15) 匕(13) 大(13) 小(13) 田(13) 钅(13) 力(12) 目(12) ⺈(11) 刂(11) 厂(11)
白(11) 丷(10) 丿(10) 二(10) 广(10) 忄(10) 禾(10) ⺮(9) 丶(9) 冖(9) 囗(9) 子(9) 巾(9)
夕(8) 工(8) 攵(8) 米(8) 耳(8) 阝(8) ⺀(7) ⺊(7) 刀(7) 月(7) 王(7) 丁(6) 冫(6) 几(6)
弓(6) 戈(6) 斤(6) 方(6) 火(6) 疋(6) 矢(6) 青(6) 且(5) 丨(5) 勹(5) 卜(5) 彐(5) 水(5)
灬(5) 牛(5) 立(5) 罒(5) 艮(5) 虫(5) 衤(5) 足(5) 门(5) 不(4) 乂(4) 令(4) 卩(4) 士(4)
少(4) 干(4) 廾(4) 弟(4) 彡(4) 彳(4) 户(4) 欠(4) 止(4) 氏(4) 犬(4) 犭(4) 示(4) 糸(4)
舌(4) 豆(4) 隹(4) 㐌(3) 七(3) 中(3) 乍(3) 乚(3) 乛(3) 也(3) 其(3) 勺(3) 可(3) 合(3)
尤(3) 巳(3) 巴(3) 手(3) 旦(3) 未(3) 每(3) 氺(3) 爫(3) 玉(3) 监(3) 石(3) 礻(3) 禸(3)
羊(3) 聿(3) 至(3) 覀(3) 豕(3) 走(3) 非(3) 音(3) 饣(3) ⺌(2) 㐬(2) 上(2) 下(2) 丩(2)
丬(2) 主(2) 乃(2) 乙(2) 亅(2) 争(2) 亡(2) 交(2) 亥(2) 今(2) 佥(2) 兀(2) 兆(2) 关(2)
凵(2) 凶(2) 勿(2) 匸(2) 卂(2) 咸(2) 夫(2) 夬(2) 官(2) 尸(2) 巨(2) 己(2) 平(2) 廴(2)
廿(2) 戋(2) 文(2) 昔(2) 曰(2) 本(2) 正(2) 殳(2) 比(2) 毛(2) 永(2) 父(2) 甘(2) 生(2)
由(2) 疒(2) 癶(2) 直(2) 矛(2) 穴(2) 缶(2) 耂(2) 者(2) 自(2) 舟(2) 衣(2) 角(2) 言(2)
车(2) 里(2) 雨(2) 马(2) ⺳(1) 㔾(1) 与(1) 专(1) 丙(1) 业(1) 並(1) 丰(1) 义(1) 乑(1)
九(1) 乞(1) 买(1) 予(1) 于(1) 井(1) 亦(1) 亭(1) 亲(1) 亼(1) 介(1) 俞(1) 兑(1) 入(1)
兴(1) 兵(1) 兼(1) 农(1) 凡(1) 刖(1) 则(1) 利(1) 包(1) 北(1) 匚(1) 千(1) 卅(1) 午(1)
单(1) 卖(1) 厉(1) 及(1) 友(1) 叚(1) 叟(1) 右(1) 司(1) 君(1) 吾(1) 哉(1) 哥(1) 唐(1)
垂(1) 壬(1) 天(1) 失(1) 奇(1) 存(1) 孚(1) 宁(1) 宓(1) 尧(1) 尺(1) 居(1) 屮(1) 山(1)
帀(1) 库(1) 延(1) 开(1) 弋(1) 弗(1) 录(1) 彖(1) 彦(1) 总(1) 成(1) 才(1) 执(1) 攸(1)
故(1) 敬(1) 斗(1) 斥(1) 斩(1) 既(1) 昜(1) 显(1) 曲(1) 更(1) 曷(1) 有(1) 末(1) 术(1)
歹(1) 段(1) 殸(1) 母(1) 气(1) 求(1) 無(1) 焦(1) 爪(1) 爰(1) 片(1) 牙(1) 狂(1) 玨(1)
用(1) 甬(1) 申(1) 疏(1) 皿(1) 离(1) 禽(1) 约(1) 羔(1) 羽(1) 肉(1) 臣(1) 臼(1) 舛(1)
色(1) 荒(1) 蒙(1) 虍(1) 行(1) 襄(1) 责(1) 贯(1) 身(1) 辛(1) 连(1) 那(1) 邦(1) 酉(1)
釆(1) 镸(1) 长(1) 间(1) 隶(1) 革(1) 食(1) 首(1) 香(1) 高(1) 鸟(1) 龶(1) 龹(1)
```

### 3d. Regenerating these numbers

The lists above are **derived, not stored** — they are a `GROUP BY` over
`dictionaryentries_zh.components`. Once the column is populated:

```sql
SELECT c AS component, count(DISTINCT word1) AS chars
FROM dictionaryentries_zh, jsonb_array_elements_text(components) c
WHERE char_length(word1) = 1
GROUP BY 1 ORDER BY 2 DESC;
```

✅ **The `components` column was populated on this dev box on 2026-09-07** (9,855
rows written: 6,935 with components, 209 atomic, 2,711 with no source data), so
the SQL above now works here. The figures in § 3 were computed by re-running
`componentsOf` directly against the cached makemeahanzi source, which is
deterministic and gives the same answer the backfill would write. To make the
column real on dev, run:

```bash
docker exec cow-backend npx tsx scripts/backfill/chinese/backfill-character-components.js
docker exec cow-backend npx tsx scripts/backfill/chinese/generate-component-font.js
```

---

### 3e. Stroke-level granularity — yes, and it links back to level 2

`components` itself carries **no stroke data at all** — it is a flat array of
glyphs. But the level-4 stroke corpus and the level-2 decomposition come from
**the same upstream project**, and a third field bridges them.

### The two halves are already aligned

| | source | entries | licence | reaches the client? |
|---|---|---|---|---|
| decomposition (`decomposition`, `matches`) | makemeahanzi `dictionary.txt` | 9,574 | **LGPLv3** | ❌ build-time input only |
| strokes (`strokes`, `medians`) | `hanzi-writer-data` npm | 9,575 | **ARPHIC PL** | ✅ already a bundled dependency |

`hanzi-writer-data`'s own README states it is *derived from the Make Me a Hanzi
project* — hence the matching corpus size. Verified 2026-09-07:

- **784 / 784** characters in discoverable words have stroke data. Full coverage.
- For every character spot-checked (想 相 木 目 心 银 行), `len(matches)` in
  `dictionary.txt` **exactly equals** `len(strokes)` in `hanzi-writer-data`. The
  two files index the same strokes in the same order.

### The bridge: the `matches` field

Each `dictionary.txt` entry carries one entry **per stroke**, naming which
level-1 decomposition part that stroke belongs to:

```
江  decomposition "⿰氵工"   matches [[0],[0],[0],[1],[1],[1]]
                            → strokes 0-2 are 氵, strokes 3-5 are 工
```

This is **level-1 only**, while `components` recurses up to depth 3 (想 → 木 目 心,
not 相 心). But the projection **composes**: recurse through `matches` wherever
`componentsOf` recursed, and every stroke gets labelled with the component it
belongs to, at exactly the depth we stop at. Verified:

```
想  components ["木","目","心"]
    stroke→component  木 木 木 木 | 目 目 目 目 目 | 心 心 心 心
议  components ["讠","义"]
    stroke→component  讠 讠 | 义 义 义
行  components []              (atomic)
    stroke→component  行 行 行 行 行 行
```

**This is not built.** It is a ~40-line recursion parallel to `componentsOf`,
and it does not exist in the codebase today.

### Coverage and the four ways it breaks

Measured over the 784 discoverable-word characters:

| outcome | count |
|---|---|
| clean projection — every stroke labelled, labels match `componentsOf` | **584** |
| atomic character (no components; every stroke belongs to the char itself) | 75 |
| ≥1 stroke unattributable (`matches` holds `null` for it) | 71 |
| label set disagrees with `componentsOf`'s output | 54 |

So ~75% project cleanly, ~9% are atomic and trivially fine, and **~16% need a
fallback**. The failure modes, all real:

1. **Null matches.** 483 of 9,574 source entries have at least one `null` stroke
   (84 are entirely null, e.g. 心 → `[null,null,null,null]`). The source simply
   does not know which part that stroke serves.
2. **Strokes are not contiguous per part.** 目's matches are
   `[[0],[0],[1],[1],[0]]` — stroke 4 belongs back to part 0. Any UI that assumes
   "component = a contiguous stroke range" will be wrong on these.
3. **A stroke can serve two parts.** 614 source entries have a stroke whose
   `matches` entry lists more than one index (overlapping/shared strokes, ⿻
   structures). "Which component does this stroke belong to" has no single answer.
4. **Depth disagreement.** Where `componentsOf` stopped for a RULE 2 reason that
   `matches` knows nothing about, the label set can drift from the stored column.
   The projection must be reconciled against `components`, not trusted blind.

### What is already shipped client-side

Stroke *rendering* is a solved problem here — no new work needed:

- `src/components/handwriting/GlyphSvg.tsx` — static per-stroke SVG renderer
  (~40 lines), used by Speed Reading. Takes a character, draws each stroke path.
  Knows the corpus coordinate system (y-up, x ∈ [0,1024], y ∈ [-124,900]).
- `src/components/handwriting/HanziGuide.tsx` — a real Hanzi Writer instance:
  animated stroke-order guide and quiz grading.
- `src/components/handwriting/loadCharData.ts` — the loader, **with a pinned CDN
  fallback that is the normal path in production builds** (Rollup cannot resolve
  `import('hanzi-writer-data/<char>.json')`, so it survives as a bare specifier
  the browser cannot load). Any new stroke consumer must use this loader, not a
  raw dynamic import.

### Why this matters for the keyboard

A stroke→component map is what would let the keyboard **show a component
building itself**, or accept partial input — "the user has drawn 4 strokes; that
is 木; offer every character starting with 木". Without it the keyboard can only
work in whole components.

⚠️ **Licensing asymmetry.** Strokes (ARPHIC PL) already ship to the client.
`matches` (LGPLv3) does **not**, and under the existing posture only *derived
per-character facts* may reach the DB. A stroke→component projection is exactly
such a derived fact — the same category as `components` — so it would live in a
**new column** computed by a backfill, not in a shipped data file. **That column
needs explicit confirmation before anyone adds it.**

---

## 4. Open questions

1. **Which scope?** Match against the 356 discoverable-scope components or all
   895? Still open, but low-stakes now: the matcher's cost is per-stroke-count
   bucket, not per-palette, and § 6m shows nothing discoverable is stranded
   either way. A wider set only risks more wrong candidates, not missing ones.
2. ~~**Recognition set or generative set?**~~ **MOOT** — see § 6f. A flat,
   non-closed set is exactly right for a matcher; the learner draws 王 rather
   than composing it.
3. ~~**How does a 356-key board become usable?**~~ **MOOT** — there is no key
   grid. The input is a drawing surface; the only list shown is ranked
   candidates (§ 6c).
4. **Do components need names?** The column carries **shape only** — no gloss,
   no pinyin, no name. Less pressing than for a key grid (the learner recognises
   the shape they just drew), but a candidate list of bare glyphs may still be
   hard to scan. Would need a **new table or column** — explicit confirmation
   required.
5. ~~**Ordering.**~~ **MOOT** — order-insensitive lookup ignores the column's
   ordering entirely (§ 6d). The column is never reordered, so the word-search
   hint ladder is unaffected.
6. **Licensing.** Decompositions come from makemeahanzi (**LGPLv3**), a
   build-time input only — never vendored, never shipped. The existing posture is
   "only derived per-character facts reach the DB". A keyboard that shipped
   makemeahanzi's *definitions*, *etymologies* or *radical names* would be
   shipping more than derived facts; check this before pulling those fields.
7. **Stroke-level input?** § 3e — a stroke→component projection is derivable
   but unbuilt, needs a new column, and has a ~16% fallback rate. Does the
   keyboard need it at all, or is whole-component input enough for v1?
8. ~~**Guided or open recognition?**~~ **ANSWERED 2026-09-07: open** — the app
   does not know the target. See § 6c.
9. ~~**Component order.**~~ **ANSWERED 2026-09-07: order-insensitive** — the
   lookup is over an unordered multiset. See § 6d / § 6h.
10. ~~**Stroke-count strictness.**~~ **ANSWERED 2026-09-07: no gate at all** —
    neither a filter nor a ranking penalty. A hard gate scores 0% whenever the
    learner miscounts, and ungated scoring against all 895 templates costs ~22 ms.
    See § 6s.
11. **How does the learner switch between the two submit paths** (component vs.
    whole character, § 6l) without being asked to understand the distinction?
13. ~~**The one-component list.**~~ **ANSWERED 2026-09-07: show it, in full, at
    every buffer size.** A scrollable candidate bar at the top of the keyboard —
    the same affordance a pinyin IME uses. No truncation, no withholding. See
    § 6p.
14. **Is the usage-count proxy good enough to ship?** § 6k says yes for v1. If
    not, a licensed external frequency list is the alternative.
15. ~~**Should `components` distinguish "atomic" from "no source data"?**~~
    **ANALYSED 2026-09-07 — not worth changing.** § 6o: the residual cost is three
    characters (网 飞 已). Re-derive the distinction where needed; fix migration
    125's misleading column comment opportunistically.
12. **Font.** ~4% of components are not served by Google's Noto Sans SC subset;
   `src/assets/fonts/hanzi-components.woff2` (`FONTS.hanziComponents`) exists for
   exactly this. Any keyboard rendering components must use that stack, and the
   subset must be regenerated if the palette grows beyond the current column.

---

## 6. The recognition architecture (the load-bearing decision)

### 6a. The existing recognizer is the wrong tool

`server/utils/handwritingRecognizer.ts` posts ink to Google Input Tools with
`language: 'zh_CN'`. Its entire job is producing **typeable text** — whole
characters in a lexicon. Hand it 氵 or ⺈ or 龹 and it will return the nearest
whole *character*, because bound component forms are not words. It cannot be
asked to answer "which component is this" and there is no parameter that makes it.

Two further reasons not to build on it:

- **It is the only backend that exists.** `docs/HANDWRITING_RECOGNITION.md` lists
  HanziLookupJS as a "confirmed" offline fallback; **it is not implemented** —
  `handwritingRecognizer.ts` is 128 lines and speaks only to Google. (That table
  has been corrected.)
- It is an **undocumented, unofficial, keyless** Google endpoint that may
  rate-limit or vanish. A drawing surface where every component submission is a
  network round trip inherits that risk on the critical path, plus the latency.

### 6b. The right tool is already in `node_modules`

**Every component in our inventory has a stroke template.** Verified 2026-09-07:

| set | components with `hanzi-writer-data` templates |
|---|---|
| discoverable scope | **356 / 356** |
| whole det table | **895 / 895** |

Including the awkward bound forms — the package ships `⺀.json`, `⺈.json`,
`⺊.json`, `⺌.json` and the rest. The corpus that stores our decompositions also
stores the reference strokes for the things we decompose *into*.

That turns recognition from an **open-set** problem (which of ~9,000 characters
is this?) into a **closed-set nearest-neighbour** problem (which of ≤N component
templates is this?). And N is small, because stroke count gates it:

```
strokes → # discoverable components
1: 8   2: 39   3: 55   4: 64   5: 53   6: 47   7: 29   8: 22   9: 23   10: 7 …
```

**The largest bucket is 64.** Most submissions compare against a few dozen
templates. That is a client-side geometric match — medians are already in the
data, `GlyphSvg.tsx` already knows the coordinate system — with no server call,
no external dependency, no rate limit, and it works offline.

**Recommendation: build a local component matcher; do not extend the Google
proxy.** The Google path stays where it is, serving Practice Writing's whole-
character grading.

### 6c. Guided vs. open — ANSWERED: open

Two products hide behind the same drawing surface:

| | the system knows the target | difficulty |
|---|---|---|
| **Guided** | yes — the learner is answering a prompt, so the expected component sequence is known | **easy**: score the ink against *one* template. This is verification, and `HanziGuide` already does it against a known target. |
| **Open** | no — the learner writes whatever they want | **hard**: rank ≤64 templates and be right often enough that a wrong top-1 isn't infuriating |

**Confirmed: OPEN.** The app does not know the target. So every consequence of
the right-hand column applies: the matcher ranks cold, and top-1 accuracy is not
achievable often enough to be the interaction.

**Therefore the UI must be a candidate list, not an autocorrect.** Show the top
N matched components and let the learner tap one, exactly as every handwriting
IME does. This is not a fallback for when matching fails — it is the primary
affordance, and it changes the accuracy target from "top-1 is right" (hard) to
"the right answer is in the top 5" (very achievable over a ≤64-candidate bucket).
A keyboard that silently picks the wrong component and clears the board is worse
than no keyboard.

### 6d. Component order — no longer a problem

Previously flagged as a gap: `components` is stored **frequency-ordered** for the
word-search hint ladder's escalation contract, not in writing order, so a
sequential submit-and-clear flow would have needed a second ordering derived from
the IDS sequence or the § 3e first-stroke index.

**Order-insensitive lookup dissolves this entirely.** Nothing needs writing order:
the buffer is a bag of components, and the query is multiset containment. The
column's frequency ordering is simply ignored on this read path.

This also removes the risk that mattered most — nobody is now tempted to reorder
the column and break word search.

Two smaller benefits fall out:

- A learner who writes 工 before 氵 still gets 江. Real beginners do this
  constantly, and forgiving it is the point of the feature.
- The frequency ordering is still *useful* here, just for a different job:
  ranking the candidate characters a partial buffer resolves to.

### 6e. Reverse lookup — measured, and one trap

⚠️ **Correcting an earlier claim in this session:** there is **no GIN index** on
`components`. Migration 125's `idx_dictionaryentries_zh_components` is a **btree
on `word1`**, partial-filtered to single-char rows with components present —
useless for containment.

Measured on dev, 2026-09-07, with the column populated:

```sql
SELECT word1 FROM dictionaryentries_zh
WHERE char_length(word1)=1 AND components @> '["木","心"]'::jsonb;
--  想 懋
--  Index Scan ... Rows Removed by Filter: 9853
--  Execution Time: 18.626 ms
```

It reads every row and filters — an effective full scan — at **~18.6 ms**. For a
candidate list that refreshes on each *component submit* (not per stroke) that is
survivable, but it is 18 ms of nothing.

**Recommendation: an in-memory inverted index built at server boot**, not a GIN
migration. The whole column is ~9.8k tiny arrays folding to 895 keys → character
lists. No schema change, no migration to confirm, rebuilt on deploy, and it also
fixes the trap below, which no jsonb operator can.

#### ⚠️ The trap: `@>` silently discards multiplicity

Verified in Postgres:

```sql
SELECT '["人","人"]'::jsonb <@ '["人"]'::jsonb;   -- TRUE  (!!)
```

jsonb array containment is **set** containment, not multiset containment. So a
learner who draws 人 twice — building 从 — matches every character containing a
single 人, and 从 (人+人) is indistinguishable from 众 (人+人+人).

That matters precisely where it hurts most, because **multiplicity is what
disambiguates the worst ambiguity groups** (§ 6i). Any implementation must count
occurrences itself. An in-memory index does this for free; a SQL implementation
would need `jsonb_array_elements_text` + `GROUP BY` + a count comparison, which
is both slower and harder to read.

### 6f. What this design does NOT need

Worth stating, because both were flagged as problems earlier and neither blocks
this:

- **The § 3e stroke→component projection is not required.** It has a ~16%
  fallback rate, needs a new column, and carries LGPL questions — but it only
  matters for grading *mid-component*. Drawing a whole component and submitting
  it needs only the component's own template, and those are 895/895 present.
- **The non-closed palette (§ 2) stops mattering.** "You cannot compose 王 from
  two keys" was a problem for a button grid. Here the learner simply *draws* 王,
  and 王 is a component with its own template. The recognition set being flat is
  exactly right for a matcher.

### 6g. Layering

| Layer | Piece | Reuse or new |
|---|---|---|
| client component | drawing surface | **reuse** `WritingCanvas.tsx` — already emits canonical `Ink`, respects the app's `touchAction` rules |
| client util | component matcher (ink → ranked components) | **new** — pure geometry over `hanzi-writer-data` medians |
| client util | template loader | **reuse** `loadCharData.ts` (⚠️ its pinned CDN fallback is the *normal* path in production builds) |
| client feature | composition buffer, submit/clear, candidate list | **new**, under `src/features/` |
| client render | show the accepted component | **reuse** `GlyphSvg.tsx`; font stack must be `FONTS.hanziComponents` |
| ~~server service~~ **client util** | components → candidate characters | **new** — `glyphLookup.ts`, over a bundled asset |
| ~~DAL~~ **build script** | reads `dictionaryentries_zh.components` | `generate-handwriting-lookup.js` — no migration needed |

⚠️ **CHANGED 2026-09-07 — the lookup moved from the server to the client.** It was
specified as a thin server read over a boot-time inverted index (§ 6e). It is now
a bundled asset scanned locally, because the lookup re-runs on **every component
tap and every removal** (§ 6r): a network round-trip per tap is not a keyboard,
it is a search box. The keyboard now makes **no request on any interaction path**.
The cost is asset size, which is the trade § 7b already accepted. See § 6u.

**No new table or column is required for a v1 of this design.** That is the main
thing § 6 establishes — and it is still true, more so: there is no endpoint and no
DAL either.

### 6h. The lookup contract

The composition buffer is a **multiset** of components. The candidate list is:

> every character whose component multiset **contains** the submitted multiset,
> counting occurrences

Order is never consulted. Multiplicity always is, as a **≥ test** per component:
submitting 人 twice keeps every character with *at least* two 人, so 众 (three 人)
stays in the list alongside 从.

Worked, on real data:

| buffer | candidates | |
|---|---|---|
| 人 | 330 | too many to show unranked |
| 人人 | **55** | 座 两 从 众 坐 碎 醉 纵 … |
| 人人人 | **4** | 閦 赑 众 赍 |

The learner selects from the list; the system never commits to a character on
its own. This is what makes open recognition (§ 6c) tractable — a wrong *guess*
would be infuriating, but a correct answer sitting third in a list is fine.

⚠️ This is exactly the semantics `jsonb @>` does **not** give you (§ 6e): bare
containment would return 人 itself for a buffer of 人人. Counting must be done in
the implementation.

### 6i. How much information is in an unordered bag of components?

With the learner resolving ambiguity (§ 6h), this is no longer a correctness
question — it is a *how long is the list* question. Still worth knowing how much
order was actually carrying. Measured over the 6,935 characters that have
components:

| grouping | characters uniquely identified | characters sharing with ≥1 other |
|---|---|---|
| component **set** (multiplicity discarded, i.e. what `@>` gives you) | 6,533 — **94.2%** | 402 |
| component **multiset** (multiplicity kept) | 6,694 — **96.5%** | 241 |

**96.5% of characters are uniquely determined by an unordered bag of their
components.** Order genuinely is not carrying much information, which is what
makes this design viable. Keeping multiplicity recovers 161 more characters —
that is the concrete payoff for not using bare `@>`.

The residual ambiguity is concentrated, not spread:

| component set | n | characters |
|---|---|---|
| 一 | 15 | 不 丝 与 业 长 万 凸 凹 丁 丂 丏 马 专 丌 卌 |
| 口+木 | 8 | 呆 束 榀 啉 橾 杏 噪 喿 |
| 人 | 8 | 从 余 以 令 众 今 介 伞 |
| 口 | 7 | 后 向 右 哉 吕 品 司 |
| 又 | 6 | 发 叒 双 友 叕 及 |

Note the shape: **the bad groups are single-component sets.** A character whose
whole decomposition is "一" cannot be composed — there is nothing to compose.
This is why § 6l exists.


### 6j. Candidate list length — the second component is the cliff

Simulated over a random 1,200 characters, submitting each character's own
components one at a time and measuring the list after every submit:

| buffer size | median candidates | p90 | max |
|---|---|---|---|
| **1 component** | **220** | 879 | 879 |
| **2 components** | **1** | 28 | 189 |
| 3 components | 1 | 5 | 41 |
| 4+ components | 1 | 2 | 16 |
| all components | 1 | 2 | 39 |

At the end of composition, **84.2% of characters are the only candidate** and
**96.0% are in a list of ≤5**.

**The interaction lives or dies on the first submit, and only the first.** One
component leaves a median of 220 candidates; the second collapses it to 1. Two
design consequences:

1. **Do not try to make a useful list out of one component.** ~~Show it truncated,
   or hold it back until the second submit.~~ **Superseded by § 6p** — the
   confirmed behaviour is to show *all* candidates in a scrollable bar, ranked,
   with no truncation, exactly as a pinyin IME does. A 220-long list after one
   component is expected and fine; it is scrolled past, not read.
2. **After two components the list is essentially solved** and needs no further
   cleverness.

⚠️ The simulation submits components in the column's stored **frequency order**,
i.e. most-common-part first — the pessimistic case for early narrowing, and
roughly what a learner writing left-to-right/top-to-bottom actually does (radicals
come first and radicals are common). Treat these as realistic, not best-case.

### 6k. Ranking — CONFIRMED contract

**Confirmed 2026-09-07.** The candidate list is sorted by:

1. **Closeness to the submitted buffer** — ascending. Closeness is the number of
   **extra components** the candidate still needs:
   `distance = |candidate multiset| − |buffer multiset|`.
   Containment (§ 6h) guarantees this is ≥ 0, and `0` means the buffer is exactly
   the candidate's full component bag.
2. **Frequency of the candidate** — descending, as the tie-break within a
   distance tier.

#### The frequency signal — `frequencyScore`, with usage as a further tie-break

**Confirmed: use `dictionaryentries_zh.frequencyScore`.** It is currently
populated on **258 of 9,855** single-character rows (only the discoverable ones,
since `/mark-discoverable` is what fills it), but the intent is to backfill it
across the table, so the contract is written against the real column rather than
around its current coverage.

Until that backfill lands, 97.4% of candidates tie on NULL. So the sort is a
**three-level key**:

| # | key | direction | notes |
|---|---|---|---|
| 1 | `distance` (extra components needed) | ascending | 0 = buffer is the candidate's full bag |
| 2 | `frequencyScore` | descending, **NULLS LAST** | the intended signal |
| 3 | in-corpus usage count (§ 6k-proxy) | descending | breaks the NULL ties; carries the ordering until 2 is filled |

⚠️ **`NULLS LAST` is load-bearing.** Postgres sorts NULLs *first* on `DESC` by
default, so a plain `ORDER BY "frequencyScore" DESC` would put all 9,597
unscored characters **above** the 258 scored ones — the exact inverse of the
intent. This is the single easiest way to get this wrong.

Level 3 is not a stopgap to be removed later: even fully backfilled,
`frequencyScore` is a **1–5 integer**, so it will still produce large tie groups
that need an ordering.

The usage count is free, deterministic, needs no new data or licence, and is
computed in the same boot-time pass as the inverted index (§ 6e):

```sql
SELECT ch, count(*) FROM (
  SELECT regexp_split_to_table(word1,'') ch FROM dictionaryentries_zh
  WHERE language='zh' AND char_length(word1) > 1
) x GROUP BY ch;
```

Coverage: 63.4% of characters score non-zero; those scoring zero are rare, which
is where they belong.

#### The contract, worked

```
buffer 人人  (55 candidates)
  从[d0,u127]  众[d1,u116]  坐[d1,u114]  纵[d1,u60]  巫[d1,u22]  丛[d1,u20] …

buffer 口   (879 candidates)
  后[d0,u381]  司[d0,u197]  向[d0,u154]  右[d0,u68]  哉[d0,u6]
  中[d1,u908]  合[d1,u485]  可[d1,u416]  加[d1,u395] …

buffer 氵   (387 candidates)
  泽[d0,u70]  泾[d0,u8]  海[d1,u638]  流[d1,u400]  河[d1,u333]  清[d1,u300] …
```

#### Was distance-first the right call? Measured: yes.

The visible oddity is that a rare exact match outranks a very common near-match —
哉 (used in 6 words) sits above 中 (908); 泾 (8) above 海 (638). That looks wrong.
It was tested against two alternatives over 600 reasonably-common characters
(used in ≥20 dictionary words), measuring **where the intended character ranks**
as its components are submitted one at a time:

| ranking | after 1 comp (top-5) | after 2 (top-5) | at completion (top-5) |
|---|---|---|---|
| **distance, then usage** (confirmed) | 19.3% | 90.7% | **99.8%** |
| usage only | 16.5% | 91.8% | 98.3% |
| exact-match tier, then usage | 16.0% | 91.6% | 99.8% |

**The three are within noise of each other, and distance-first is the best at
completion** — the moment that matters most, where it puts the intended character
in the top 5 for 99.8% of characters. The cosmetic oddity does not cost the
learner anything measurable, because the `d0` tier is small and is itself
usage-ordered (哉 is last of the five `d0` characters, not first).

Two refinements worth layering on, neither changing the contract:

- **Float `discoverable` characters up within a tie group** — 258 characters the
  app actually teaches.
- **Truncate the display**, don't truncate the query. Top ~12 is enough at every
  buffer size (§ 6j).


### 6l. The single-component hole, and why a second path is needed

Composition input fails for two classes of character:

| class | count (all det) | count (discoverable) | why it fails |
|---|---|---|---|
| **atomic** — `components = []` | 209 | 75 | nothing to submit |
| **single-component** — one part | 155 | 38 | submitting the one part is maximally ambiguous (see 一 → 15 chars) |

For the discoverable corpus that is **113 of 784 characters (14%)** that
composition alone cannot produce — including extremely common ones (口 人 木 不 马).

**So the surface needs a second, parallel path: draw the WHOLE character.** And
that is exactly what the existing Google recognizer is good at — an open-set
lexicon of thousands of whole characters. The two paths are complementary, not
competing:

| path | recognizer | answers |
|---|---|---|
| draw a **component**, submit, repeat | **new** local matcher over 895 stroke templates | 671 / 784 discoverable chars |
| draw the **whole character** | **existing** `POST /api/handwriting/recognize` (Google) | the atomic + single-component remainder, and anything the learner can already write |

Both feed the same candidate list. The learner does not choose a mode; the
surface offers "submit as component" and "submit as character" on the same ink.

⚠️ ~~This makes the whole-character path load-bearing, which sharpens the § 6a
warning: **there is no offline fallback**, so if Google fails, 14% of characters
become untypeable.~~

**RESOLVED 2026-09-07 — the local whole-character matcher was built (§ 6t).** The
template asset is the UNION of components and whole characters, so the
whole-character path is served by the same local matcher as the component path,
scored in one pass and ranked into one row. Google is **not** used by this
keyboard, and there is no network dependency to fail. The table above should be
read as: both rows are the local matcher, distinguished only by the `kind` bits
the candidate carries.

### 6m. Reachability — nothing discoverable is stranded

The 2,711 characters with no IDS source entry (§ 3a) cannot be composed at all.
Verified 2026-09-07 that this does **not** touch the learner-facing corpus:

```
discoverable characters:            784
  with no components (unreachable):   0
  not even a det row:                 0
  atomic (need whole-char path):     75
  single-component (ditto):          38
```

**Zero stranded characters in the discoverable set.** The 2,711 hole is entirely
in rare/traditional/junk headwords. If the keyboard is ever scoped beyond
discoverable words, this stops being true.

---

### 6n. ⚠️ Atomic characters are invisible to the candidate list

Found while testing § 6k's ranking. **Submitting 人 does not offer 人.**

```
buffer 人  → 以 令 余 今 介 伞 内 个 队 从 …      (人 absent)
buffer 口  → 后 司 向 右 哉 中 合 可 加 …          (口 absent)
```

The reason is mechanical: containment asks *candidate bag ⊇ buffer bag*, and an
atomic character's bag is `[]`, which contains nothing. Every atomic character is
therefore **structurally excluded from every candidate list** — including 人 口
木 大 子 一 水 山 心 日, some of the most common characters in the language.

#### The fix: buffer-equals-itself is a distance-0 match

**781 of the 895 components are themselves single-character det headwords.** So
the rule is:

> when the buffer is exactly one component `X` and `X` is a det headword, `X`
> enters the candidate list at **distance 0**

Measured effect: **199 atomic characters rescued**, and they are precisely the
common ones —

```
大 人 子 一 水 山 生 心 无 自 小 白 行 金 气 手 高 面 力 文 儿 口 里 日 工 …
```

2,721 remain unreachable by composition (网 飞 竹 已 毋 … plus rare/junk
headwords) and still need the whole-character path of § 6l.

⚠️ Note this rule interacts with § 6k: 人 would enter at `d0` and tie-break on
usage, landing it **above** the `d0` compounds 以/令/余. That is the desired
behaviour — a learner who draws 人 and nothing else most likely means 人.

### 6o. `components = []` — analysis, and the verdict

**Verdict: not a problem.** After the § 6n rescue rule, the residual is **three
characters**. Full working below, because the conclusion is load-bearing and the
column's documented contract is wrong.

#### The column conflates several cases

```sql
SELECT word1, components FROM dictionaryentries_zh WHERE word1 IN ('口','飞','P');
--  口  []   genuinely atomic (a radical; RULE 1 stops here)
--  飞  []   source has no usable decomposition ("⿻？？")
--  P   []   not a Chinese character at all
```

⚠️ **Migration 125's column comment is wrong.** It states `NULL = not computed;
[] = atomic character with no parts`. `backfill-character-components.js` writes
`[]` for every one of these. It *counts* them apart (`atomic` vs `noSource`) but
only in its console summary, and the code comment there — "We distinguish them so
the second group can be reported rather than silently recorded as atomic" —
describes the log line, not the column. **Nothing distinguishing reaches the
database.**

#### Breakdown of all 2,920 empty rows

| category | count | in a discoverable word | usage ≥20 | rescued by § 6n |
|---|---:|---:|---:|---:|
| no source entry | 2,687 | **0** | 2 | 0 |
| atomic — is a radical | 198 | 71 | 121 | **192** |
| non-CJK headword | 24 | 0 | 1 | 0 |
| atomic — source has no decomposition | 11 | 4 | 4 | 7 |
| **total** | **2,920** | **75** | **128** | **199** |

Two facts do all the work:

1. **The two populations barely overlap in relevance.** The genuinely-atomic ones
   are common (121 of 198 used in ≥20 words) and **97% of them are rescued** by
   the § 6n headword rule. The no-source ones are inert: **zero** appear in any
   discoverable word.
2. **The no-source group is dead weight, not missing coverage.** Their corpus
   usage is median **0**, p90 **0**:

   | used in ≤ N dictionary words | share of the 2,687 |
   |---|---|
   | 0 | **93.5%** |
   | 1 | 98.2% |
   | 5 | 99.6% |

   For comparison, only 47.4% of *all* single-character rows are used in ≤1 word.
   The characters makemeahanzi lacks are overwhelmingly the characters nothing
   else uses either — rare, traditional-only, or Ext-A. The source gap and the
   irrelevance are the same gap.

#### The residual: three characters

Empty-component characters that appear in a discoverable word **and** are not
rescued by § 6n:

```
网 (used in 309 words)    飞 (200)    已 (47)
```

That is the entire learner-facing cost. Why each falls through:

| char | in source? | decomposition | why `[]` |
|---|---|---|---|
| 网 | yes | `⿵冂⿰乂乂` | it **is** a Kangxi radical, so RULE 1 stops — and decompositions use the bound forms 罒/⺳, so 网 never appears as a component and the headword rescue misses it |
| 飞 | yes | `⿻？？` | source knows the character but not its parts |
| 已 | yes | `？` | same |

All three are covered by the whole-character path (§ 6l). If that is not enough,
the cheapest fix is a **three-entry alias list**, not a data pipeline.

#### Worth knowing, not fixing

- **The 24 "non-CJK" rows are legitimate, not junk.** `P`, `CP`, `UP` etc. back
  real det headwords from internet Chinese — `PO文`, `IP剧`, `UP主`, `BP机`,
  `CP值`, `PUA`. They are correctly uncomposable; a learner types them on a normal
  keyboard.
- **The word search is unaffected.** Its hint ladder treats `[]` as "no parts,
  reveal the character", which is the right behaviour for atomic *and* no-source
  characters alike. The conflation costs it nothing, which is why it was never
  noticed.
- **The conflation does have one future cost.** If coverage is ever improved — a
  second decomposition source for the 2,687 — they cannot be found from the column
  alone; the distinction must be re-derived against the makemeahanzi map. Cheap,
  but a trap for whoever tries.

**Recommendation: do not change the column for this feature.** Re-derive the
distinction where it is needed (`ids.has(char)`), fix migration 125's misleading
comment when some other migration touches this table, and spend nothing else on
it. Tracked as question #15.


### 6p. The candidate bar

**Confirmed 2026-09-07.** The candidate list is a **horizontally scrollable bar
at the top of the keyboard**, holding **every** match with no truncation and no
withholding — the affordance every pinyin IME already uses, so it needs no
explanation to a learner who has used a Chinese keyboard.

This settles § 6j's open call in favour of "show it anyway". The reasoning holds
up: a bar that is *sometimes* long is honest, whereas a bar that disappears when
the system is unsure is a feature that appears broken exactly when the learner
most needs feedback that their stroke was understood.

#### What it has to hold

From § 6j, the real sizes this bar must render:

| buffer | median | p90 | max |
|---|---|---|---|
| 1 component | **220** | 879 | **879** (口) |
| 2 components | 1 | 28 | 189 |
| 3+ | 1 | 5 | 41 |

So the common case is a **220-item horizontal scroller**, worst case 879.

#### Consequences

**1. Ranking is now doing all the work.** With no truncation, the sort key (§ 6k)
is the entire product — the first ~8 visible slots are all most learners read,
and everything past them is a scroll nobody performs. This *raises* the stakes on
`frequencyScore` being backfilled; until then level 3 (in-corpus usage) is
carrying the bar, not merely breaking ties.

**2. It must be virtualized, or at least windowed.** 220 glyph cells is a lot of
DOM on a phone, and 879 is far too many to mount eagerly on every submit. Render
a window of the ranked head and extend on scroll. This is a performance
requirement, not a nicety — the bar re-renders on every component submit.

**3. It must scroll NATIVELY.** Per
[UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md), the app defaults components to
`touchAction: "none"`, and a scrollable container is an explicit opt-in that
**must not** be driven from JS: a `scrollLeft += dx` inside a non-passive
`touchmove` runs on the main thread and visibly stutters. The bar therefore needs
`overflow-x: auto`, `touch-action: pan-x`, and `overscroll-behavior: contain`.

> **Desktop exception — arrow buttons (built 2026-09-09).** A mouse user has no
> swipe: a vertical wheel does not scroll a horizontal box and the scrollbar is
> hidden, so on `(hover: hover) and (pointer: fine)` only, the scroller is flanked
> by a left and a right chevron that page it by 80% of the visible width. This does
> **not** violate the rule above — the travel is a one-shot native
> `scrollBy({ behavior: 'smooth' })` on a click, not a per-`touchmove`
> `scrollLeft +=` on the main thread. The arrows mount only while the content
> actually overflows, and each greys out (stays mounted, `opacity: 0.25`, so the
> chips do not shift) at its end of the travel.
>
> **Extracted and shared, same day.** The iw composer's hint tray needed the
> identical control, so the behaviour moved out of `CandidateRow` into
> `src/hooks/useHorizontalScrollArrows.ts` (the desktop gate, the overflow
> measuring, the paging scroll, and an optional end-of-travel callback the tray
> uses to fetch its next page) and `src/components/ScrollArrow.tsx` (the button).
> `CandidateRow` now supplies only the per-mode accent colour the arrows take, and
> passes `candidates` as the re-measure trigger. Behaviour here is unchanged.
> Code: `src/hooks/useHorizontalScrollArrows.ts` → `useHorizontalScrollArrows`;
> `src/components/ScrollArrow.tsx`; `src/features/beginnerKeyboard/CandidateRow.tsx`
> → `arrow`. See also [IMMERSIVE_WORLD.md](./IMMERSIVE_WORLD.md) § 9a.

**4. It will fight the edge-swipe guard.** A horizontal scroller spanning the
full width sits directly under the iOS back-swipe gesture zone. Every game page
already calls `useBlockEdgeSwipe(true)` for this reason; the keyboard surface must
do the same, and the bar's own horizontal panning must be verified against it
rather than assumed to coexist.

**5. Candidates render through `ForeignText`.** Per the project rule, foreign
words are rendered only via `ForeignText` (`src/components/ForeignText.tsx`) —
`CPCDRow`/cpcd are private to it. Each cell is a single character, so a small
`size` with pinyin shown is the natural configuration; showing pinyin here is
arguably the point, since a learner who cannot yet type pinyin is exactly who
benefits from seeing it attached to the character they just drew.

#### Cell content: glyph + pinyin

**Confirmed 2026-09-07.** Each cell shows the **glyph with its pinyin**, using the
row's default `pronunciation` — **context-naive, and knowingly wrong sometimes**.

The error is quantified, not hand-waved: **11.7% of characters are heteronyms**
(92 of the 784 with per-cluster readings carry more than one distinct reading),
and they include some of the commonest characters in the language —

```
一 为 了 长 重 都 还 着 的 得 和 行 差 少 干 空 种 相 看 教 …
```

A default reading is right whenever the learner wants the *dominant* sense, so
the real miss rate is well under 11.7%. This is accepted: a bar cell has no
context to disambiguate with, and showing a usually-right reading teaches more
than showing none.

⚠️ **Do not "fix" this later by reading `definitionClusters[*].reading`.** Picking
a per-sense reading requires knowing which sense the learner means, which is
exactly the information the keyboard does not have. The correct place for a
context-aware reading is § 6q's word fallback, where the word row's own
`pronunciation` already resolves it.

`pronunciation` coverage is 99.98% on single characters and **100%** on 2-char
words.

#### Still to decide

- What happens on **tap** — commit the character to the output buffer and clear
  the component buffer, presumably, but whether the keyboard then offers **word**
  completions (a second bar, or the same one repurposed) is unspecified and is
  the natural next feature. Note § 6q already builds half of the machinery.


### 6q. The multi-character word fallback

**Confirmed 2026-09-07.** When the single-character search returns **zero**
results, expand the same component search to **2-character words** in det.

The learner is drawing components with no way to signal "this one is finished",
so a buffer can accumulate parts spanning two characters. Nothing single-character
contains it, the bar goes empty, and the feature looks broken at the exact moment
the learner is doing something reasonable.

#### The word bag has to be derived

`components` exists only on single-character rows — a 2-char word has
`breakdown`, not components. So a word's component bag is the **multiset union of
its two characters' bags**:

```
江湖  →  江[氵,工] + 湖[氵,古,月]  →  {氵:2, 工:1, 古:1, 月:1}
```

Derived in the same boot-time pass as the inverted index (§ 6e) — **no new column,
no migration**. Coverage: **56,316 of 57,160** two-character words yield a bag
(the rest contain a character with empty components, § 6o).

#### It works, and the numbers are unusually good

Simulated over 250 discoverable 2-char words, buffer = every component of both
characters:

| | |
|---|---|
| single-char search returns 0 (so the fallback fires) | **58%** |
| of those, the fallback finds the intended word | **146 / 146 — 100%** |
| candidate-list size when it fires | median **1**, p90 **2**, max 17 |

Perfect recall into a list of essentially one item.

#### Fire on EMPTY, not on "few" — the threshold is load-bearing

The obvious relaxation (fire when the single-char list is merely *short*) is much
worse. Same sample, varying the trigger:

| trigger | fires | combined list: median | p90 |
|---|---|---|---|
| **single-char = 0** (confirmed) | 58% | **1** | **2** |
| single-char ≤ 1 | 79% | 1 | 161 |
| single-char ≤ 3 | 86% | 2 | 196 |
| single-char ≤ 10 | 93% | 2 | 215 |

One step of relaxation multiplies the p90 by 80×. **Fire only on empty.**

And always-appending words is catastrophic — the bar at a single common component
would hold:

```
氵   387 single chars  +  4,931 two-char words
口   879 single chars  + 10,778 two-char words
```

Combined-list p90 across the sample: **582**, max **11,657**. Never do this.

#### The known gap, and why it is acceptable

In the other **42%** of cases the single-char search is non-empty, so the fallback
does not fire — and the intended word is not shown even though the word index
*could* find it (verified: 104/104 findable). The learner sees a short wrong list
instead; median **2** candidates, p90 31.

This is accepted because the scenario is largely artificial. The simulation draws
*every* component of both characters without committing, whereas the real flow is:
draw the first character's components → see it in the bar → tap → the buffer
clears → draw the second. A learner reaching a full two-character buffer has
already scrolled past their answer twice. The threshold table above shows the
cure is far worse than the disease.

#### A side benefit: the pinyin is better here

The § 6p heteronym problem is *reduced* on this path. A word row's own
`pronunciation` is already context-resolved — 银行 carries `yín háng`, not the
isolated-character `xíng` — so every fallback candidate shows a reading that is
correct for that word. 100% of 2-char words have a pronunciation.

#### CONFIRMED 2026-09-07: extend to 3- and 4-character words

The fallback pool is **every det word of length 2, 3 or 4**, under the same
empty-only trigger. Bags are derived the same way (multiset union over all of the
word's characters), and coverage barely moves with length:

| word length | rows | bag derivable |
|---|---|---|
| 2 | 57,160 | 57,080 (**99.9%**) |
| 3 | 23,435 | 23,393 (99.8%) |
| 4 | 18,604 | 18,582 (99.9%) |

(These counts apply the § 6n buffer-equals-itself rescue, so they run slightly
ahead of the bare-column 56,316 quoted above.)

**The extension is not optional if 3- and 4-character words are to be reachable
at all.** With a 2-char-only pool, a 3- or 4-character buffer matches *nothing*:

| buffer from a discoverable word of length | list size, 2-char pool only | list size, 2–4 pool |
|---|---|---|
| 3 | median **0**, p90 0, max 1 | median 1, p90 3, max 13 |
| 4 | median **0**, p90 0, max 0 | median 1, p90 1, max 2 |

Recall is **200/200 at length 3 and 200/200 at length 4**.

#### ⚠️ The cost lands on the 2-character case — and ranking absorbs it

Containment is *superset* matching, so a short buffer matches long words freely.
Adding the 3/4-char rows inflates the list a 2-character learner sees:

| pool | list size for a 2-char buffer |
|---|---|
| 2-char words only | median **1**, p90 10, max 35 |
| 2–4 char words | median **9**, p90 49, max 186 |

This is survivable **only because the § 6k distance-first ranking sorts the extra
words to the bottom.** Closeness here is `candidate bag size − buffer size`, so an
exact-length match always precedes a longer word that merely contains the buffer.
Measured over 200 discoverable words per length, ranking the combined 2–4 pool:

| intended word length | top-1 | top-5 |
|---|---|---|
| 2 | 89.5% | **100%** |
| 3 | 98.5% | **100%** |
| 4 | 99.0% | **100%** |

**The intended word is in the first five, every time, at every length.** The list
grew nine-fold and the learner never sees it — which is the whole argument for
extending. If the ranking is ever changed to something that does not lead with
distance, this extension must be re-measured before shipping.

#### Open

- **Are word candidates visually distinguished** from character candidates in the
  bar, or is it one undifferentiated strip?

### 6r. Layout — CONFIRMED 2026-09-07

The keyboard occupies the usual system-keyboard slot at the bottom of the screen
and has three regions:

```
┌──────────────────────────────────────────────────────────┐
│  CANDIDATE ROW  (horizontally scrollable, dual-purpose)   │  ← § 6p
├───────────────────────┬──────────────────────────────────┤
│                       │                                  │
│  SUBMITTED COMPONENTS │        DRAWING SQUARE            │
│  (tap to remove)      │        (1:1 aspect)              │
│                       │                                  │
└───────────────────────┴──────────────────────────────────┘
```

| region | contents | tap does |
|---|---|---|
| **Candidate row** (full width, top) | *idle:* candidate characters/words for the current buffer. *while ink is present:* candidate **components** recognized from the ink. | *idle:* commits that character/word to the text field and clears the buffer. *drawing:* submits that component to the buffer and clears the canvas. |
| **Submitted components** (bottom-left) | the buffer, in submission order | removes that component from the buffer |
| **Drawing square** (bottom-right, majority of the area, **exactly square**) | the ink canvas | draws |

#### The candidate row is modal — this is the one risk worth naming

It shows two different kinds of thing depending on whether the canvas has ink.
That is what makes the single-row layout possible, but it means **the word the
learner is hunting for disappears the instant they start the next stroke**, and
returns when they submit or clear. Two consequences to design for:

1. **The empty-ink state is the word state.** Lifting the pen must NOT clear the
   canvas, or the row would flicker back to words between strokes. The row swaps
   to component mode on `strokeStart` and stays there until the canvas is
   explicitly emptied (component submitted, or an explicit clear).
2. **Some visual difference between the two modes is required** — otherwise a
   learner cannot tell whether the cell they are about to tap will commit a
   character or submit a component, and those are very different actions.
   **Settled:** a per-mode ground tint (blue while drawing, green when idle) plus
   the chip's border weight. A third cue, a vertical text label on the left of the
   row ("What you drew" / "Tap to insert"), shipped first and was **removed
   2026-09-09** by product decision so the chips get the full width — the bar now
   carries no label at all.

#### Removal re-runs the search

Tapping a submitted component removes it and the buffer search re-runs from
scratch (§ 6h). Because the buffer is an unordered multiset (§ 6d) there is no
"undo the last one" semantics to preserve — any component may be removed at any
time, and removing one **widens** the candidate list rather than narrowing it.
This is also the only escape from a misrecognized component, so it must never be
gated on the buffer being non-empty in some other sense.

#### Clearing the canvas — REVISED 2026-09-09: a clear key, ink only

**Code:** `src/features/beginnerKeyboard/BeginnerKeyboard.tsx` → `handleClear`,
`.beginner-keyboard__clear`; `src/components/handwriting/WritingCanvas.tsx` → the
imperative handle's `clear`.

The keyboard's footer row (described in § 6w, under the debug dump that shares it)
carries a **`Clear` key** beside the `ABC` escape. It clears **the canvas ink only — never the component buffer.** The
buffer keeps its own per-chip tap-to-remove, so the two controls are orthogonal
and neither undoes the other's work. Undo/redo (per-stroke) remain deferred:
clear is all-or-nothing.

It is **disabled and greyed (opacity 0.4) while the canvas is empty** rather than
hidden — a key that appears and disappears as the learner draws is a moving target
in the one row they reach for without looking. Like every other footer key it
swallows `mousedown` so the tap cannot move focus off the field.

Clearing goes through the canvas's imperative `clear()`, not through the
composition hook: the strokes live in the canvas, and `clear()` re-notifies with an
empty ink, which walks the candidate row back out of glyph mode into RESULT mode on
its own. There is deliberately no second write to the composition state.

**Superseded (2026-09-07): "submission is the only exit."** The first build had no
clear button, no undo and no redo, on the reasoning that where such controls live
is a layout question better answered against a running keyboard — it was, and the
answer is the footer row that the `ABC` escape had meanwhile created. The
consequence that decision asked us to accept — that a misdrawn or misrecognized
stroke could only be taken back by the two-step detour of submitting whichever
component the row offered and then tapping it out of the submitted strip — no
longer applies to ink. It still applies to a component already **in** the buffer,
which is why removal must stay unconditional (§ 6r "Removal re-runs the search").

⚠️ **An empty candidate row is still not allowed**, and the clear key does not
buy it back. Before the clear key, an unrecognizable ink was a hard dead end: no
cells to tap, so no way to empty the canvas. Clear is now *an* exit, but it is the
**wrong** exit for a learner who drew a real glyph — taking it throws the stroke
work away, when what they needed was a guess to correct. The component candidate
list
must therefore **never be allowed to come back empty while ink is present** — it
always offers its best guesses, however poor, exactly as § 6p's "show all
possibilities" rule does for characters. Whatever ranking the recognizer uses, the
list is truncated at the bottom, never at the top.

#### Committing — DECIDED 2026-09-07: the buffer always clears

Tapping any candidate — character or word — inserts it at the host field's caret
and **empties the buffer**. There is no "keep going" state.

So there are exactly two ways to type a multi-character word:

1. tap each character as it appears, one commit per character; or
2. draw **every component of the whole word** into one unbroken buffer, wait for
   the single-character list to go empty, and tap the word the § 6q fallback
   surfaces.

⚠️ **Route 2 is the only path to a word candidate, and it is only reachable by
accident.** The fallback fires on an empty single-character list, and the buffer
only reaches that state if the learner keeps drawing past the point where their
first character was already sitting in the bar. Nothing in the UI tells them to
do that. Accepted for v1 — the § 6q measurements (100% recall, top-5 at every
length) describe how well route 2 *works* once entered, not how often anyone
enters it. If word input turns out to matter, the fix is an explicit affordance,
not a change to the fallback rule.

#### Why the square matters

The recognizer (§ 6b/§ 6a) and every stroke template in `hanzi-writer-data` are
defined on a square coordinate system (x ∈ [0,1024], y ∈ [-124,900] — see
`src/components/handwriting/GlyphSvg.tsx`). A non-square canvas would need an
anisotropic normalization before the ink is scored, which distorts exactly the
aspect information that separates 日 from 曰. Keeping the canvas 1:1 makes the
normalization a uniform scale.

⚠️ **The square is the binding constraint on the left column, not the reverse.**
On a narrow phone the square consumes most of the keyboard height, and the
submitted-component strip gets whatever width is left. With a 4-component buffer
(§ 3b: average 2.09, max 6) that strip needs to hold up to six glyphs — it should
wrap or scroll vertically rather than shrink the square.

#### Open

- ~~**How are the two candidate-row modes distinguished?**~~ **Answered:**
  background tint + chip border weight. The leading label that also carried this
  was removed 2026-09-09.

### 6s. Ink → component — the matcher

This is the piece § 6b named but did not specify. Everything below is
**client-side**; there is no server call on the drawing path.

#### The pipeline

```
pointer events                     src/components/handwriting/types.ts  (Ink = Stroke[])
      ↓  on each strokeEnd
normalize      bounding-box centre, uniform scale by max(w, h)
      ↓
resample       each stroke → N points by arc length          (N = 16)
      ↓
score          against every component template               (895 of them)
      ↓
rank ascending → the candidate row (§ 6p), never empty (§ 6r)
```

Re-scored on every `strokeEnd`, not on a timer — the row is always current with
the ink actually on the canvas.

#### The template asset — build-time generated, bundled, not fetched

`hanzi-writer-data` ships `medians`: a sparse polyline per stroke
(木 → 4 strokes of 5, 4, 8, 6 points). Those are the reference trajectories. They
must be **resampled and normalized offline** into a single bundled asset:

| | |
|---|---|
| components with templates | **895 / 895** (§ 6b) |
| total strokes | 6,397 (avg **7.15** per component) |
| payload at N=16, int16 x/y | **400 KB** raw |
| the same as unminified JSON | 1.07 MB |

⚠️ **Do not reach for `src/components/handwriting/loadCharData.ts`.** That helper
fetches *one* character's data at a time, and (per its own comment) falls through
to a pinned CDN in production builds because Rollup cannot resolve
`import('hanzi-writer-data/<char>.json')`. A matcher needs all 895 templates
resident and offline; 895 CDN round trips on keyboard open is not a design.

⚠️ **Licensing.** `hanzi-writer-data` is **ARPHIC Public License**, not OFL. It is
already a bundled client dependency, so shipping it is settled — but a derived
template asset is a derivative work and the ARPHIC notice must ship with it, the
same way `NotoSansSC-OFL.txt` ships beside the subset font (§ 3e /
`generate-component-font.js`). This is unrelated to the makemeahanzi LGPL
question (§ 4.6), which concerns the *decompositions*, not the strokes.

#### RESOLVED 2026-09-07 (B2): all 895 components, N = 8 points, int8 — ~85 KB

The three dials are scope, points-per-stroke (N) and coordinate precision. All
eight combinations were built and brotli-compressed (brotli, because that is what
ships):

| scope | N | bits | strokes | raw KB | **brotli KB** |
|---|---|---|---|---|---|
| **895** | **8** | **8** | 6,397 | 100.8 | **84.9** ← chosen |
| 895 | 16 | 8 | 6,397 | 200.8 | 156.7 |
| 895 | 8 | 16 | 6,397 | 200.8 | 183.6 |
| 895 | 16 | 16 | 6,397 | 400.7 | 367.0 |
| 356 | 8 | 8 | 1,822 | 28.8 | 24.7 |
| 356 | 16 | 16 | 1,822 | 114.2 | 104.6 |

Note brotli barely dents full-precision coordinates (400 → 367 KB) but bites hard
on quantized ones (201 → 157) — int8 is cheaper than its 2× headline.

**Accuracy is flat across every variant.** Synthetic ink, noise 0.05, ~300
components per cell (top-1 / top-5, percent):

| variant | correct stroke count | one too few (joined) | one too many (split) |
|---|---|---|---|
| N=16, int16 | 99.0 / 99.7 | 66.3 / 86.1 | 29.1 / 50.2 |
| N=16, int8 | 100.0 / 100.0 | 64.6 / 86.7 | 32.4 / 48.5 |
| N=8, int16 | 99.7 / 100.0 | **71.4 / 86.7** | **32.4 / 53.8** |
| **N=8, int8** | **99.7 / 100.0** | 66.3 / 86.1 | 31.4 / 52.8 |

The N=16/int16 split-stroke cell reproduces the § 6s gating run's ungated arm
(30.1 / 49.8) to within sampling noise — the two harnesses agree.

The spread is sampling noise, not signal. **The precision dials are free** — 16
points and 16-bit coordinates store detail the matcher never uses, because scoring
averages point distances over a whole stroke and real ink is far noisier than the
quantization. N=8 is also **~40% faster to score**, so the small asset is the fast
one.

**Scope is the one dial that could cost a missed recognition**, so it stays at the
maximum: all **895**. See § 7f — the whole det table is expected to become
discoverable, which makes the 356-component scope a temporary number with no
future.

⚠️ **Make N and the quantization scale generator parameters, not literals.** They
appear in both the offline generator and the client loader, and the byte layout
depends on them. Kept as named build constants in one shared place, revisiting
this decision is a rebuild; hardcoded on both sides, it is a rewrite of both. This
is the entire reason B2 was ever a blocker.

#### Scoring cost — an honest range

Scoring one submission against all 895 templates measured between **~22 ms and
~190 ms** across runs of the same algorithm in Node on the dev box; the spread is
inner-loop shape and JIT, not anything meaningful. Take **tens of milliseconds to
~0.2 s** as the working figure, and note the browser will differ again.

It does not affect any decision here — a component submission is a discrete tap,
not a 60fps path — but it is the reason **N=8 was preferred over N=16 even though
size is not a constraint** (§ 7f): halving the points halves the inner loop.

#### Scoring: order-insensitive, direction-insensitive

Beginners get stroke order wrong constantly, and drawing a stroke backwards is
common. So the cost between one drawn stroke and one template stroke is

```
cost(a, b) = min( mean‖aᵢ − bᵢ‖ , mean‖aᵢ − b₍N₋₁₋ᵢ₎‖ )     ← forward vs reversed
```

and the component score is a **greedy assignment** of drawn strokes onto unused
template strokes, plus a constant for every template stroke left unmatched,
divided by `max(#drawn, #template)`. Greedy rather than Hungarian: the buckets
are tiny (avg 7 strokes) and the assignment is nearly always unambiguous.

#### ⚠️ ANSWERS open question #10: NO stroke-count gate — not a filter, not a penalty

This was the largest open question, and the measurement is unambiguous. Synthetic
ink over 300 components, noise 0.05, comparing a hard `n == ink.length` gate,
`±1`, ungated, and a soft `λ·|Δn|` ranking penalty:

| learner's stroke count | exact gate | ±1 | **ungated** | soft λ=0.02 | soft λ=0.05 |
|---|---|---|---|---|---|
| correct | 99.3 / 100 | 99.3 / 100 | **99.3 / 100** | 99.0 / 100 | 99.3 / 100 |
| one too few (two strokes joined) | **0.0 / 0.0** | 63.3 / 85.4 | **67.3 / 88.1** | 50.0 / 81.3 | 18.4 / 54.1 |
| one too many (a stroke split) | **0.0 / 0.0** | 29.8 / 51.2 | **30.1 / 49.8** | 20.4 / 42.1 | 10.4 / 21.1 |

*(top-1 / top-5, percent.)*

A hard gate scores **exactly zero** when the count is wrong, because the correct
answer is not in the candidate set at all — and getting the count wrong is not an
edge case for a beginner, it is the thing they are here to learn. Ungated wins or
ties everywhere, and the soft penalty only reproduces the same damage in
proportion to λ. **Stroke count must not influence the result at all.**

It is affordable: ungated scoring against all 895 templates measured **~22 ms**
per submission (Node, single-threaded, cold). Gating was never a performance
requirement — § 6b's stroke-count buckets are a description of the data, not a
design constraint.

#### The weak spot: split strokes

Even ungated, a learner who lifts the pen mid-stroke lands at **30% top-1 /
50% top-5** — clearly the worst case, and worse than joining two strokes
(67 / 88). The cause is the assignment model: one drawn stroke maps to at most
one template stroke, so a split stroke leaves a template stroke unmatched and
pays the constant twice over.

The fix, if it proves necessary against real ink, is **many-to-one assignment** —
allow consecutive drawn strokes to be concatenated and matched as one. Deferred:
it multiplies the search, and the numbers above are from synthetic ink.

#### ⚠️ How much to trust these numbers

The synthetic ink is generated by perturbing the templates themselves (scale
0.88–1.12, translation, Gaussian jitter, 20% of strokes reversed, stroke order
shuffled, optionally one stroke merged or split). **Real beginner ink differs in
ways this cannot model** — genuinely different stroke shapes, wrong proportions,
missing strokes entirely, extra strokes.

So read the table as a **comparison between gating strategies**, which is what it
was built for and where it is decisive, and **not** as a prediction of shipped
accuracy. The absolute numbers are optimistic. The candidate-row design (§ 6c)
exists precisely so that they do not have to be right.

> ⚠️ **THE ACCURACY NUMBERS BELOW ARE SYNTHETIC, AND THEY MISSED A TOTAL FAILURE.**
> Everything in § 6h and § 6j was measured on template medians replayed with noise
> and dropped strokes, scoring 85–100% top-1 — while the shipped matcher could not
> read a single real drawing, because the templates were stored vertically
> mirrored (§ 6y). Both sides of the benchmark were mirrored, so the error
> cancelled exactly and the numbers looked excellent.
>
> The bug is FIXED and the numbers below now describe the corrected asset, but
> treat them for what they measure: "can the scorer re-find a glyph it has already
> seen". They are not a prediction about a beginner's hand, and they demonstrably
> cannot see a whole class of failure. Real samples (§ 6w) are the only evidence
> that counts.

## 6t. BUILT 2026-09-07 — the recognizer

#### Where the two halves sit

The recognizer is two programs that never run at the same time, on two very
different inputs, that must land in the same coordinate space or nothing matches:

```
  ════════════ GENERATOR ═════════════        ════════════ RUNTIME ═════════════
  Node in the container, run BY HAND          The learner's browser
  once — its output is committed              on every strokeEnd

  dictionaryentries_zh                        pointer events on the square canvas
  ├─ components → 895 component glyphs        └─ Ink = [{ xs, ys, ts }, …]
  └─ 1-char word1 → 7,144 characters
     (union: 7,258 glyphs with strokes)
                 │                                             │
                 ▼                                             ▼
  hanzi-writer-data/木.json                   raw CSS-pixel coordinates,
  └─ medians: sparse polylines                wherever the canvas happens
     in a 1024-unit design box                to sit on screen
                 │                                             │
                 └───────────────┬─────────────────────────────┘
                                 │   two very different inputs,
                                 │   one canonical transform
                     ┌───────────▼────────────┐
                     │    inkGeometry.ts      │  ← ONE file, imported by both
                     │  resampleStroke   ──── │  8 pts/stroke, even by ARC LENGTH
                     │  normalizeStrokes ──── │  recentre + uniform scale max(w,h)
                     └───────────┬────────────┘
                                 │   both sides now in the same
                                 │   normalized box: x,y ∈ [-0.5, 0.5]
                 ┌───────────────┴─────────────────────────────┐
                 ▼                                             ▼
  quantize ×254 → int8                        Float32 fingerprint
  serialize + stamp the header                (stays in memory, never stored)
                 │                                             │
                 ▼                                             │
  glyph-templates.bin                                          │
  1.25 MB · committed to the repo                              │
                 │                                             │
                 │  fetched + parsed once per session          │
                 │  header checked: points/stroke, quant bits  │
                 ▼                                             │
  Float32Array of 77,416 stroke templates                      │
  + per-stroke centroids, DERIVED at parse                     │
                 │                                             │
                 └───────────────┬─────────────────────────────┘
                                 ▼
                     ┌────────────────────────┐
                     │   glyphMatcher.ts      │
                     │ ① coarse: centroids    │  2 floats/stroke, ~60× cheaper
                     │    ink × all 7,258     │  → best 200 survive
                     │ ② full: all 8 points   │  greedy stroke assignment,
                     │    ink × 200 survivors │  order- and direction-blind,
                     └───────────┬────────────┘  no stroke-count gate
                                 ▼
                     one ranked list, components and
                     characters mixed, each carrying its
                     `kind` bits → the candidate row (§ 6p/§ 6r)
```

The convergence point is the whole design. **A drifted `inkGeometry.ts` does not
crash** — both sides still produce numbers, still sort, still return a top
candidate. It is just wrong, quietly and permanently. Hence one shared file, a
header stamped into the asset, and a test that feeds the committed binary ink
built from the original medians.


The matcher half of § 6s is implemented and tested, over the **union** set —
components *and* whole characters. Nothing of the keyboard UI or the
component→character lookup exists yet.

| file | role |
|---|---|
| `src/components/handwriting/inkGeometry.ts` | `resampleStroke`, `normalizeStrokes`, `fingerprint`, and the two build constants `POINTS_PER_STROKE` (8) and `QUANT_SCALE` (254) |
| `server/scripts/backfill/chinese/generate-handwriting-templates.js` | offline generator → `src/assets/handwriting/glyph-templates.bin` |
| `src/components/handwriting/glyphTemplates.ts` | `parseGlyphTemplates`, `loadGlyphTemplates` (lazy, session-cached), `KIND_COMPONENT`/`KIND_CHARACTER` |
| `src/components/handwriting/glyphMatcher.ts` | `fingerprintInk`, `matchGlyphs`, `CANDIDATE_POOL` |
| `src/__tests__/glyphMatcher.test.ts` | 16 tests, all passing |

Renamed from `component*` on 2026-09-07 when the asset stopped being
components-only; `component-templates.bin` was deleted in the same pass.

**The asset shipped at 1,252 KB** for 7,258 glyphs / 77,416 strokes. That is 12×
the components-only asset, and it is the right trade: it is a one-off download
cached for the session, § 7b expects the det table to keep growing anyway, and it
is what makes whole-character recognition possible at all.

#### Why the set is the union

A learner is never told to draw *parts*. Against a components-only asset, 想
returned 耤 替 赖 越 彗 — confident nonsense with nothing to signal the answer was
never in the set. So both halves are scored in one pass and ranked into one row.

Most entries play both roles (886 of the 895 components are CJK unified
ideographs; 781 are det headwords), so `kind` is a **bitfield on one template**
rather than two templates with identical strokes — duplicates would double-score
the same shape in every match. The bits are load-bearing at the UI: the candidate
row is a single mixed list, and they are what says whether a tap **appends to the
component buffer** or **commits as text** (answered 2026-09-07).

#### The cascade, and why 8× the search is faster

Scoring all 7,258 with the full scorer costs ~1.3 s — impossible for a keystroke.
So each submission runs a cheap pass first: every stroke collapses to its
**centroid** (2 floats instead of 16), making a template ~60× cheaper, and the
best `CANDIDATE_POOL` (200) reach the full scorer.

The prefilter is safe because centroids are invariant to precisely what the full
scorer already ignores — translation, scale, stroke order, stroke direction — so
it discards along the same axis rather than a new one. Recall was **measured, not
assumed**: 100% of true answers survived the coarse pass. It is the same
retrieve-then-rerank shape as gloss confusability's bi-encoder → cross-encoder
([GLOSS_CONFUSABILITY.md](./GLOSS_CONFUSABILITY.md) § 5).

The centroids are **derived at parse time, not stored** — they are a pure function
of the coordinates, so storing them would inflate the asset and add a second
thing that can drift from the shape it summarizes.

#### Measured performance (2026-09-07)

⚠️ All ink is **synthetic** — templates perturbed with jitter, rescaling,
translation, reversed strokes and shuffled order. Absolute numbers are optimistic;
the table is valid as a comparison between configurations.

| configuration | ink | top-1 | top-5 | time |
|---|---|---|---|---|
| components only, exhaustive (895) | clean | 100.0% | 100.0% | 66 ms |
| union + cascade, scored on components | clean | 100.0% | 100.0% | 41 ms |
| union + cascade, all 7,258 | clean | 99.5% | 99.5% | 57 ms |
| components only, exhaustive | noisy | 98.2% | 100.0% | 66 ms |
| union + cascade, components | noisy | 97.8% | 99.6% | 40 ms |
| union + cascade, all | noisy | 97.0% | 99.5% | 59 ms |
| components only, exhaustive | dropped stroke | 67.0% | 90.2% | 61 ms |
| union + cascade, components | dropped stroke | 66.1% | 84.4% | 37 ms |
| **union + cascade, all** | dropped stroke | **85.6%** | **95.5%** | 54 ms |

By drawn stroke count, union cascade on noisy ink: 1–3 → 97.8% / 23 ms;
4–6 → 98.4% / 36 ms; 7–9 → 98.4% / 46 ms; 10–14 → 95.9% / 65 ms;
15+ → 96.8% / 102 ms. **Accuracy is essentially flat in complexity; only time
scales**, and with the *drawn* stroke count rather than corpus size.

The dropped-stroke row is the surprise worth keeping: **more candidates made the
matcher better, not worse** (67% → 86% top-1). A component with a stroke missing
is often another real component, so the small set confidently offers the wrong
neighbour; the character templates give the true answer somewhere better to land.
This is the single most common beginner error, so the union set helps exactly
where it matters most.

#### The drift hazard, and how it is closed

The generator and the runtime must compute *identical* fingerprints; if they
diverge, every stored template silently becomes wrong — scores stay plausible,
rankings quietly rot, and nothing throws. Two defences:

1. **One implementation.** `inkGeometry.ts` is a pure, import-free client module,
   and the generator imports *that file* under tsx rather than reimplementing it.
2. **The asset header is checked at parse.** Points-per-stroke and quantization
   width are written into the blob and compared against the client's constants;
   a mismatch throws with an instruction to regenerate, rather than being read on.

`src/__tests__/glyphMatcher.test.ts` closes the loop from the other side: it
reads the **committed** asset and feeds it ink built from the **original**
hanzi-writer medians, so a drifted generator fails the suite.

#### Behaviour the tests pin

- a component ranks **first** against its own strokes (木 氵 心 目 一 口 女 言)
- stroke **order** shuffled → still first
- stroke **direction** reversed → still first
- scaled to 25% and translated off-centre → still first
- a **missing stroke** (目 minus one) → still in the top 5, which is the
  no-stroke-count-gate rule (§ 6s) expressed as a test
- **nonsense ink still returns candidates** — the § 6r dead-end guard. It predates
  the clear key and survives it: clearing discards the strokes, so an empty row
  would still leave a learner who drew a real glyph with no way to *correct* it
- a **whole character** ranks in its own top 5 (想 你 我 爱 谢 学)
- every candidate carries usable `kind` bits, and 木 comes back as **both**
- a `kindMask` restricts the list without changing its order
- **the coarse prefilter never changes the winner** — a pooled match and an
  exhaustive one over the same set agree
- ⚠️ **simplified-only, by scope**: 請 is absent from the asset even though
  `hanzi-writer-data` ships it, because the inventory comes from the simplified
  det table. **DECIDED 2026-09-07: this version does not accept traditional
  input.** A learner writing traditional gets confident nonsense with no signal —
  accepted, not a bug. Pinned as a test so the boundary is explicit; admitting
  traditional means adding traditional headwords to the det table, which is a
  data question rather than a keyboard one.

#### Asset format

Little-endian, **format version 2**: `"HWCT"`, version, points-per-stroke, quant
bits, reserved, `u32` count; then per glyph a `u32` codepoint (not `u16` — some
radicals sit outside the BMP), a `u8` **kind** bitfield, a `u8` stroke count, and
`int8` interleaved x/y. The client decodes into one flat `Float32Array` rather
than ~620k small arrays, so the scoring loop walks memory instead of chasing
pointers.

v2 added the kind byte and widened the count from `u16`. The count is widened
ahead of need — 7,258 is comfortably under 65,535 — because § 7b expects the det
table to keep growing, and a format version bump is cheaper to spend now than
during a data expansion.

#### One tuning knob to revisit against real ink

`UNMATCHED_STROKE_COST` (0.35) in `glyphMatcher.ts` sets how hard a
missing or extra stroke is punished. Too low and a three-stroke scribble matches
every eight-stroke component; too high and it becomes the hard stroke-count gate
that § 6s rejected. It is the first thing to tune when real ink is available, and
the likely lever on the weak split-stroke case.

---

## 6u. BUILT 2026-09-07 — the reverse lookup

The buffer→candidate half of § 6h/§ 6k/§ 6n/§ 6q is implemented and tested.
The keyboard UI is still unbuilt.

| file | role |
|---|---|
| `server/scripts/backfill/chinese/generate-handwriting-lookup.js` | offline generator → `glyph-lookup.bin` + `glyph-words.bin` |
| `src/components/handwriting/glyphLookup.ts` | `parseGlyphLookup`, `parseGlyphWords`, `lookupCharacters`, `lookupWords`, `lookupBuffer`, `loadGlyphLookup`, `loadGlyphWords` |
| `src/__tests__/glyphLookup.test.ts` | 21 tests, all passing |

### Bundled to the client, not served

| | |
|---|---|
| `glyph-lookup.bin` | **124.6 KB** — 895 components, 9,855 characters, 17,651 component slots |
| `glyph-words.bin` | **699.8 KB** — 99,199 words of length 2–4 |

**Two files, because they are needed at different moments.** The character index
must be resident before the keyboard can show anything; the word pool is ~6×
larger and matters only when a search comes back empty. They are fetched in
parallel, and `lookupBuffer` accepts a null pool — until the word asset lands the
keyboard works normally and only the § 6q fallback is inert.

### Atomic characters are carried in the index

The generator loads **all 9,855** single-character headwords, not just the 6,935
that decompose. The 2,920 atomic rows cost ~26 KB and exist solely to serve the
§ 6n rescue — without them 人 口 木 大 子 一 are structurally absent from every
candidate list. They cost nothing at query time either: the scan rejects any
candidate whose bag is smaller than the buffer before doing any work.

### A linear scan, not the § 6e inverted index

§ 6e describes an inverted index, which is the right shape for a server holding
one index for every user. On the client the corpus is 9,855 characters and a full
scan is **0.16–0.55 ms**, far under the frame budget, re-run only on a tap.
Posting lists would add a build step, a second representation to keep consistent
with the bags, and a few hundred KB to save time that was never being spent.

The word pool is 10× larger but fires only on empty, and its bags are derived
once at parse rather than per query, so the same reasoning holds: **4–6 ms**.

### Measured, against the numbers § 6 predicted

Parse: **6 ms** for the index, **68 ms** for the words (including deriving all
522,753 word-bag entries).

| buffer | candidates | time | top of list |
|---|---|---|---|
| 人 | 331 | 0.55 ms | 人 以 令 余 今 介 伞 内 |
| 人人 | **55** | 0.31 ms | 从 坐 众 纵 巫 丛 耸 俎 |
| 人人人 | **4** | 0.16 ms | 众 閦 赍 赑 |
| 口 | 880 | 0.53 ms | 口 后 右 司 向 哉 中 可 |
| 氵 | 388 | 0.41 ms | 泽 泾 氵 海 河 汤 流 清 |
| 氵工 | 3 | 0.32 ms | 江 鸿 茳 |

These match § 6h's measured 55 and 4 exactly. The single-component buffers run
**one ahead** of the numbers quoted there (331 vs 330, 880 vs 879, 388 vs 387)
because the § 6n rescue adds the character itself — and it lands **first**, which
is the intended behaviour: a learner who draws 人 and stops most likely means 人.

The word fallback, buffer = every component of both characters:

| word | candidates | rank | time |
|---|---|---|---|
| 江湖 | 11 | **0** | 4.0 ms |
| 朋友 | 28 | **0** | 5.8 ms |
| 清明 | 8 | 1 | 6.1 ms |
| 图书馆 | 2 | **0** | 4.3 ms |
| 计算机 | 1 | **0** | 3.9 ms |

清明 sits at rank 1 behind 明清 — the two words are anagrams, so their derived
bags are **identical** and no component-based signal can separate them. That is a
floor of the design, not a ranking bug: order is never consulted (§ 6d).

### Behaviour the tests pin

- **multiplicity, not bare containment** — 人人 keeps 从 and 众, drops 人; 人人人
  keeps 众 and drops 从. This is the § 6e `jsonb @>` trap expressed as a test.
- the list **narrows sharply** on the second component (§ 6j's cliff)
- the § 6n rescue fires **only** for a single-component buffer, lands at
  distance 0 and in the top 3, and **never duplicates** a character containment
  already found
- ranking is **distance-first**, unscored characters sort **below** scored ones
  (the NULLS-LAST trap), and NULL-frequency ties break by usage descending
- `limit` truncates the **display, not the search** (§ 6k)
- the fallback fires on **empty, not few**, and stays inert with a null pool

### The NULL sentinel

`frequencyScore` is stored as **0 for NULL** rather than as a nullable field.
97.4% of characters (9,597 of 9,855) are unscored, and a plain descending sort
over a nullable column floats every one of them **above** the 258 the app teaches
— the exact inverse of the intent, and § 6k's single easiest mistake. Storing 0
makes NULLS-LAST fall out of an ordinary descending sort.


## 6v. BUILT 2026-09-07 — the keyboard surface

The § 6r layout, the composition state machine and the host seam are implemented.
**The keyboard is now end-to-end**: draw 氵, tap it, draw 工, tap it, tap 江 —
that walk is a passing test.

| file | role |
|---|---|
| `src/features/beginnerKeyboard/BeginnerKeyboardProvider.tsx` | app-wide focus listener, the `zh` gate, publishes the inset |
| `src/features/beginnerKeyboard/BeginnerKeyboardHost.tsx` | raises the keyboard on focus, OS-keyboard suppression, the `ABC` escape |
| `src/features/beginnerKeyboard/eligibility.ts` | which fields qualify (pure `isEligible` + DOM read) |
| `src/features/beginnerKeyboard/insertAtCaret.ts` | writes through React's value tracker |
| `src/features/beginnerKeyboard/insetContext.ts` | `useBeginnerKeyboardInset`, `--beginner-keyboard-inset` |
| `src/features/beginnerKeyboard/BeginnerKeyboard.tsx` | the three-region layout; sizes the square canvas |
| `src/features/beginnerKeyboard/CandidateRow.tsx` | the modal row (§ 6p/§ 6r) |
| `src/features/beginnerKeyboard/ComponentBuffer.tsx` | the component buffer, one chip per part, tap to remove one |
| `src/features/beginnerKeyboard/useComposition.ts` | ink + buffer + the derived candidate list |
| `src/features/beginnerKeyboard/compositionRules.ts` | the pure decisions, extracted so they are testable |
| `src/features/beginnerKeyboard/useGlyphAssets.ts` | loads the three assets independently |
| `src/features/beginnerKeyboard/useKeyboardViewport.ts` | web ÷ Capacitor adapter |
| `src/features/beginnerKeyboard/debugSnapshot.ts` | the author dump payload, pure (§ 6w) |
| `src/features/beginnerKeyboard/DebugDumpButton.tsx` | the floating author-only button (§ 6w) |
| `src/__tests__/beginnerKeyboardComposition.test.ts` | 17 tests, all passing |
| `src/__tests__/beginnerKeyboardDebugSnapshot.test.ts` | 10 tests, all passing |
| `src/__tests__/support/inkFromMedians.ts` | the ONE place synthetic ink is built — and flipped (§ 6y) |
| `src/__tests__/support/realInk.json` | two captured hand-drawn samples, the y-inversion regression fixture |

### ~~The mixed row, and what a tap means~~ — SUPERSEDED by § 6x (2026-09-07)

**The rule described here no longer holds.** It was: `kind` bits decide the
action, anything carrying the component bit appends, so tapping 木 buffers 木 and
tapping 想 commits 想.

§ 6x replaced it with **every glyph appends**, because no predicate on the glyph
survives the 尔 case. Kept as a record of what was tried, not as a description of
the code — see § 6x for the rule in force.

The mode is signalled **two ways at once** — a ground colour and the chip's border
weight (a commit chip is outlined heavier). It was three until the row's vertical
label was dropped (2026-09-09); colour alone would fail exactly the learners this
is for, which is why the border-weight channel must stay. That is now a distinction between the two
ROWS rather than between chips within one row, which makes it easier to read, not
harder.

### The canvas is sized from height, and must stay square

`normalizeStrokes` scales ink by the larger box dimension, so ink drawn in a wide
rectangle is squashed relative to the templates **before it is ever scored**. A
non-square canvas degrades recognition rather than merely looking wrong. It is
measured off the lower region's HEIGHT (height is the scarce axis on a keyboard)
and capped at 60% of the width so the buffer column cannot collapse on a narrow
phone.

### Clearing the canvas

The footer row's `Clear` key (§ 6r, added 2026-09-09) empties the **ink** and
nothing else; per-stroke undo/redo are still deferred. Submitting a candidate
remains the other way out of a full canvas, and the only one that keeps the work —
which is why `matchGlyphs` must never return an empty list for non-empty ink, and
why that is a test in both suites.

### The host seam

`BeginnerKeyboardProvider` wraps `Layout` in `App.tsx` and listens for `focusin`
on the document — it bubbles, so one listener sees every field in the app,
including ones inside portals. Wrapping inputs individually was rejected: it would
have meant editing scores of call sites and silently missing every input added
later, so the keyboard would work where someone remembered and not where they did
not.

Focusing an eligible field mounts `BeginnerKeyboardHost`, which raises the
keyboard **immediately** — no prompt (see § 7a). It sets `inputMode="none"`, then
**blurs and refocuses**: without the blur, iOS Safari keeps the OS keyboard up and
both are on screen at once. The field keeps focus throughout (every control
prevents `mousedown` default), because insertion happens at the caret.

`inputMode` is restored on unmount and when the `ABC` key hands the field back. A
field left at `"none"` can never raise a keyboard again — a leak that presents as
a permanently dead input, long after the learner has left the page.

⚠️ **Focus loss is not dismissal.** The activation itself blurs the field, so a
naive `focusout` teardown would kill the keyboard at the moment it must survive.
The provider defers the check a frame (mid-blur there is no active element) and
only clears when focus lands outside both the field and our own surface.

⚠️ **The host is keyed per field.** Without the key React reuses the component
across two different fields, and its `inputMode` cleanup runs against the new
field rather than the old — leaving the previous one stuck at `"none"`.

### The viewport adapter

`useKeyboardViewport` is the only file that knows whether the app is a web page
or a native shell.

| | web | Capacitor |
|---|---|---|
| source | `visualViewport` shrink, an **inference** | `keyboardWillShow.keyboardHeight`, a **fact** |
| threshold | 120 px, so a collapsing URL bar is not read as a keyboard | none needed |
| desktop | reports nothing; falls back to 320 px | n/a |

⚠️ **Capacitor is not installed yet.** The native path is written against the
documented `@capacitor/keyboard` events but is reached through a **runtime probe**
of `window.Capacitor.Plugins` rather than an import, so the file compiles and runs
today on the web path. Adopting Capacitor means replacing the probe with the real
import; nothing else in the hook changes.


## 6w. BUILT 2026-09-07 — the author debug dump

Every accuracy number in § 6h and § 6j was measured against **synthetic** ink:
template medians replayed with noise and dropped strokes. That is an honest proxy
for the shape of the problem and a poor one for a real hand — stroke order,
hooks, ligatures and where a stroke starts are all things the synthetic corpus
gets right by construction and a beginner gets wrong constantly.

So when a character misrecognizes on a real device, there is no way to reproduce
it from a description of what happened. The dump closes that gap: it is **the
exact ink**, so `matchGlyphs` can be re-run against it offline and the ranking
inspected.

**The gate is `users.isTemplateAuthor`** (migration 115) — the same grant as the
night-market and iw editors. It is decided in `BeginnerKeyboardProvider` (the only
layer in the feature holding auth) and passed down as `debug`. Like every other
client-side `isTemplateAuthor` check it is **UX only**: nothing here is
privileged, there is no server call behind it, and the same payload is derivable
from the console. The gate exists so the button is not in everyone's way.

**Where it sits.** In the keyboard's **footer row**, beside the `ABC` escape, in
the left column under the component buffer.

It first floated over the keyboard's top edge, on the reasoning that all three
regions (§ 6r) are load-bearing and a button placed in one would either steal a
candidate slot or shrink the canvas — and shrinking the canvas *degrades
recognition*, the one thing a debugging tool must not do. **That was wrong in
practice**: the strip above the keyboard is where the focused field sits, so the
chip covered the very text the author was watching. The footer row costs the
canvas nothing and is beside it rather than above it.

**What one press produces** — logged to the console *and*, where the context is
secure, copied to the clipboard (the label says which):

| field | why |
|---|---|
| `ink` | the strokes, in canvas px, timestamps rebased onto the first sample |
| `canvasSize` | scale context — separates "drew it tiny in a corner" from a matcher failure |
| `buffer` | the components already submitted — flat, and so also the exact list the lookup searched (there was a separate `leaves` field until the buffer went flat; see § 6x) |
| `suggested` | matcher output **with costs**, 40 deep |
| `results` | buffer lookup output, 40 deep |
| `target` | the intended character: its expansion, its rank in the **full** result list, its own cost, and the per-stroke pairings the scorer chose |
| `assets` | which of the three assets had loaded, so a thin dump is not read as a bad match |

**Setting the target.** A 🎯 chip beside the dump button opens `window.prompt`,
which borrows the OS keyboard — the one with pinyin on it — so the author types 你
the ordinary way and the footer pays no permanent width. It persists in
`localStorage`, because an author debugs one character over many attempts and
several reloads; the dump button then reads `dump→你`.

`explainGlyphMatch` (`glyphMatcher.ts`) produces the pairings by threading an
optional recorder through the same `assignmentCost` the scorer uses, so the
explanation can never describe an assignment the scorer did not make. ⚠️ It scores
the whole corpus to establish a rank — far more work than the two-stage cascade
does on a keystroke — so it is a debugging path only.

Three decisions worth keeping:

- **Both candidate lists, regardless of mode.** The row is modal and shows one of
  them; the failures worth debugging are precisely the ones where the *other* list
  is the wrong one — a buffer that will not resolve, or a fine glyph guess sitting
  behind a bad lookup.
- **40 deep, not the row's 12.** The usual question is "where *did* the right
  glyph rank?", and a list truncated at what the learner could see cannot answer
  it — rank 19 and "never scored at all" look identical on screen and are
  completely different bugs.
- **Valid JSON, leaf blocks collapsed to one line.** Replayability is the whole
  point, so it must `JSON.parse`; a plainly pretty-printed dump of a 12-stroke
  character runs past a thousand lines and stops being pasteable. A 4-stroke
  character with a one-component buffer comes to 115 lines / 5.5 KB.

`beginnerKeyboardDebugSnapshot.test.ts` pins the round trip: real ink → snapshot →
formatted text → `JSON.parse` → ink → matcher, asserting the candidate list is
unchanged. If the compaction ever loses too much, that fails rather than quietly
producing dumps that debug the wrong thing.

## 6x. BUILT 2026-09-07 — expansion, and why the buffer stopped being a list of components

**Found by the first real hand-drawn sample** (§ 6w's dump, on a device). A
learner writing 你 draws 亻 and then 尔, because that is how a human sees the
character. The index could never match that buffer:

```
你  →  [亻, ⺈, 小]      ← the components column, level-1 leaves
尔  →  [⺈, 小]          ← 尔 is not a component at all; it decomposes too
```

Expecting the learner to know the canonical decomposition is not reasonable —
nothing on screen teaches it, and 尔 is a shape they can see while ⺈ is not.

### The rule

**The 895 components are the alphabet.** Anything selected from outside it is
translated into that alphabet on the way into the buffer
(`expandGlyph`, `glyphLookup.ts`). Drawing 亻 then 尔 now yields `[亻, ⺈, 小]` —
exactly 你's stored bag, so 你 comes back at **distance 0, rank 0**.

Two things it is deliberately NOT:

| not this | why |
|---|---|
| "always expand" | 丁 **is** a registered component (of 打) and also a headword decomposing to `[一]`. Expanding it would destroy 打. A glyph already in the alphabet passes through untouched. |
| recursive | the stored bags are already at leaf granularity — `想 → [木, 目, 心]`, none of which decompose further. Recursing would shred bags past the granularity the index is keyed on. |

Coverage over the 7,258 offerable template glyphs: **6,935 expand**, 209 are
atomic headwords (correct — § 6n's rescue handles them), 114 are absent from the
index entirely (best-effort: they stand for themselves and match nothing).

### ~~The buffer holds SUBMISSIONS, not components~~ — REVERSED 2026-09-09

**The buffer is a flat list of components again.** What follows is the rule that
stood between 2026-09-07 and 2026-09-09, kept because the reasoning for it is
still the honest argument against the current design:

> A chip shows what the learner **drew**; the search runs on what it expands to.
> Draw 尔 and you get one chip reading 尔, contributing `⺈ 小`, with the leaves
> printed under the glyph small and muted. That line is there to be *reassuring*
> rather than instructive — "yes, that counted as two parts" — which is what makes
> an unexpected result row explicable instead of mysterious.
>
> One tap removes the whole submission. Removing half of it would leave a
> component the learner never drew and cannot see.

#### What it is now

Expansion is unchanged — the 895 components are still the alphabet, and
`expandGlyph` still runs on the way in. What changed is that the **leaves** are
what land in the buffer, each as its own chip. Drawing 尔 appends two chips, `⺈`
and `小`, and each is removable on its own.

The `Submission` record is gone; `buffer` is a `string[]`
(`compositionRules.ts` → `bufferAfterSelect`, `bufferAfterRemove`). So is
`bufferLeaves` — the buffer *is* the leaves, and `useComposition` passes it
straight to `lookupBuffer` with nothing to flatten.

| | before | now |
|---|---|---|
| chip | the drawn glyph, leaves printed under it | one component |
| draw 尔 | 1 chip | 2 chips |
| one tap removes | the whole submission (2 components) | 1 component |
| buffer type | `Submission[]` | `string[]` |

#### Why

The strip was a **display list layered over a search list** — two things to keep
in step, and a chip whose glyph was not in the buffer being searched at all. The
small muted leaf line existed only to reconcile them, which is a tell: a UI that
needs a footnote to explain its own contents is showing the wrong contents. One
list, shown verbatim, needs no footnote.

#### The cost, accepted

The quoted rule above is right that a learner can now remove `⺈` and be left
holding `小`, a part they did not draw and may not recognise. It is recoverable
rather than a dead end — the result row repopulates from whatever is left, and
drawing 尔 again re-adds both. Pinned as a test ("removes ONE component, even one
the learner never drew directly") so the behaviour is deliberate rather than
incidental.

Debug dumps (§ 6w) went to **`v: 2`** in the same pass: the snapshot's `buffer`
and `leaves` fields were the same list once the buffer went flat, so `leaves` was
dropped rather than left as a duplicate.

### Consequence: every glyph appends (§ 6r's tap rule is superseded)

The old rule was "carries the component bit → append, otherwise commit". It
cannot survive expansion, and the case that killed it is the motivating one: 尔 is
`kind = 2` (character only) **and** discoverable, so every version of "commit if
it is a real character" sends 尔 to the text field. There is no predicate that
separates "meant as a part" from "meant as a word" — for 尔, 木 and 你 the honest
answer is both.

So the glyph row does exactly one thing, and committing moved entirely to the
result row. Appending a whole character puts its own bag in the buffer, so it
returns at distance 0, rank 0 — the first chip. **Drawing a whole character costs
one extra tap, and it is the same two taps every time.** The modality § 6r calls
"the one risk worth naming" is now a distinction between the two rows rather than
between chips inside one row.

### It also softens § 6k's partial-buffer problem

Measured over the 200 discoverable decomposable characters, before expansion:

| buffer state | components | in top 12 | median rank |
|---|---|---|---|
| after 1st component | 2 | ~90% | 3–5 |
| after 1st component | **3** | **6.9%** | **179** |
| after 1st component | 4 | 0% | ~580 |
| full bag | any | **100%** | **0** |

Distance strictly outranks `frequencyScore`, so 你 — which scores the maximum 5 —
sat at **rank 146** after 亻 alone. Expansion does not change that sort; it makes
it matter less, because the learner reaches the full bag in fewer draws. **The
sort itself is still an open question** (§ 7g).

## 6y. FIXED 2026-09-07 — the y-axis inversion, and why the benchmark could not see it

**The templates were stored vertically mirrored relative to real ink for the whole
of the feature's development.**

hanzi-writer stores strokes in a 1024×1024 box with its origin at the **bottom**
left — which is why its own renderer wraps them in `scale(1, -1) translate(0, -900)`.
A `<canvas>`, and so every stroke a learner draws, has its origin at the **top**
left. Nothing converted between the two.

### What it cost

| ink | rank of 尔 among 7,258 |
|---|---|
| real hand-drawn sample 1 | 1409 |
| real hand-drawn sample 2 | 1670 |
| **either sample, y flipped** | **0** |

The flipped pairings also become the identity permutation (drawn stroke *i* ↔
template stroke *i*), which is the signature of a genuine match; mirrored, the
greedy assignment returned a scramble. Cost of the *best* match was ~0.18 either
way — the corpus median is ~0.28 — so the metric had almost no discrimination
left, which is what a mirrored comparison looks like from the outside.

### Why every test passed anyway

**The synthetic ink was built from the same y-up medians as the templates.** Both
sides were mirrored, the error cancelled exactly, and § 6h/§ 6j reported 85–100%
top-1 for a matcher that ranked real drawings around the 20th percentile. Two
earlier symptoms were misread as noise rather than as this: a flat cost
distribution on real ink, and a scratch harness that "wrongly" negated y and got
亻 and 小 ranked 0 and 2 — it was right, and the vertically-forgiving glyphs were
the ones that survived the mirror.

### The fix, and the guard

The conversion goes in `generate-handwriting-templates.js`, where the foreign
coordinate system enters the app — the shared `fingerprint` normalizes about the
bounding-box centre, so negation commutes with it. The asset was regenerated
(same 7,258 templates, same 1252.2 KB).

Three things now hold the line:

1. **`src/__tests__/support/inkFromMedians.ts`** is the only way a suite builds
   synthetic ink, and it flips. The convention is stated once.
2. **`src/__tests__/support/realInk.json`** checks in the two captured samples
   verbatim. They are the only evidence in the repo about a human hand — never
   regenerate them from medians.
3. **`explainGlyphMatch` asserts the identity permutation** on a real sample, so a
   future inversion shows up as a scrambled assignment rather than a slightly
   worse number.

> **The general lesson.** A benchmark built from the same source as the thing it
> tests cannot see an error in the transform between them. § 6h/§ 6j were not
> merely optimistic — they were structurally blind, and the only reason the bug
> was found is that a real device produced a dump (§ 6w).

## 6z. BUILT 2026-09-09 — appearing, disappearing, and why focus stopped binding

Two changes that only make sense together: the surface now **animates**, and focus
is now a **trigger** rather than the thing that holds it open.

Code: `BeginnerKeyboardProvider` (the whole dismissal model),
`BeginnerKeyboardHost` (the transition and the close chevron),
`eligibility.ts` → `KEEP_OPEN_VALUE`, `isKeepOpenTarget`,
`transition.ts` → `useBeginnerKeyboardTransition`,
`IWPlayPage` (the one page that reserves space).

### The bug this fixes

§ 7a's rule was *the keyboard exists exactly while an eligible field is focused*,
enforced by a `focusout` handler that cleared the field on the next frame unless
focus had landed on another field or inside our own surface. That is correct for a
field sitting alone on a page and wrong for a field sitting in a **composer row**.

On desktop a `<button>` takes focus when it is clicked. So in the immersive-world
composer, pressing **send** — or the volume chip, or the helper toggle — focused a
button, which was neither a field nor inside the keyboard, and the keyboard was
torn down at the exact moment the learner was using it. Nothing was lost (the text
survives), but the keyboard vanished mid-sentence and had to be re-summoned by
tapping back into the field.

### The model now

| event | result |
|---|---|
| focusin on an **eligible field** | opens the keyboard, or **retargets** an open one — `open` never goes false, so there is no exit/enter flicker between two fields |
| focusin or pointerdown inside **our own surface** | nothing |
| focusin or pointerdown inside a **`data-beginner-keyboard="keep"`** region | nothing |
| the **close chevron** in the keyboard's footer | closes |
| pointerdown or focus **anywhere else** | closes |
| route change, language switch, target field disconnected | closes immediately, no transition |

Three things worth being explicit about:

**1. It is an allow-list, and that direction is deliberate.** A control added
anywhere in the app is, by default, a control that dismisses the keyboard. The
opposite default would mean a new button somewhere unrelated could trap a learner
under a keyboard they cannot close.

**2. `pointerdown` is listened for separately from focus, and in the capture
phase.** Most taps never move focus at all — a touch device does not focus a
`<button>`, and a tap on inert background focuses nothing — so a focus-only model
would leave the keyboard dismissible only by finding something focusable. Capture
so a handler that stops propagation cannot strand it.

**3. Closing raises nothing in our place.** `close()` blurs the target field,
which keeps its text and simply stops being focused. Handing back to the **OS**
keyboard is a different action with its own control (`ABC`), and conflating the
two would mean a learner who wanted the screen back got a system keyboard instead.

### `data-beginner-keyboard` now has two values

The attribute that already carried the opt-out grew a second value rather than
gaining a sibling attribute, because they are the same question asked at two
moments: *may this field raise the keyboard*, and *may this element dismiss it*.

| value | meaning |
|---|---|
| `off` | never raise the keyboard on this field or anything inside it (§ 7a) |
| `keep` | interacting here does not dismiss an open keyboard (this section) |

Both are inherited from any ancestor. The only `keep` region today is the whole
`iw-composer` (`src/features/immersiveworld/play/IWComposer.tsx`) — marked on the
composer root rather than on its four buttons individually, so a control added to
that row later inherits it.

### The transition, and why `field` outlives `open`

`Slide direction="up"`, **300 ms in and 220 ms out** — getting out of the way
should feel immediate, arriving over the learner's content should not. `appear` is
set so the first mount slides in as well; without it the keyboard would animate
away but arrive instantly, which reads as a glitch. `prefers-reduced-motion:
reduce` gets the same two states with a zero-length transition, not a different
behaviour.

The exit needs a mounted element with a field to animate against, so the provider
holds two pieces of state instead of one: `open` drives the transition, `field`
survives until the host reports `onExited`. **`open`, not `field`, is the answer to
"is the keyboard up".**

### A reserving page travels with it

The keyboard is portaled over the app and cannot push anything, so a page with
something pinned to the bottom reserves the space itself off the inset context
(§ 7a). That inset is a plain number changing in ONE step — so the immersive-world
composer used to **jump** to its final position in a single frame while the
keyboard was still sliding up behind it. Two events, not one surface arriving.

`transition.ts` is therefore the single description of how the keyboard travels,
and a reserving page borrows it:

```tsx
const keyboardInset = useBeginnerKeyboardInset();
const keyboardTransition = useBeginnerKeyboardTransition('padding-bottom');
// …
contentSx={{ paddingBottom: `${keyboardInset}px`, transition: keyboardTransition }}
```

`useBeginnerKeyboardTransition` reads the **direction off the inset itself** — a
non-zero inset can only mean the keyboard is arriving — so a caller never tracks
open/closed of its own. That works because the provider zeroes the inset the
moment the exit STARTS rather than when it finishes: the page gives the space back
while the keyboard slides down, in parallel, instead of snapping back afterwards.
It returns `'none'` under reduced motion.

The durations and curves (`BEGINNER_KEYBOARD_SLIDE_MS`, `BEGINNER_KEYBOARD_EASING`
— matched to the MUI transition tokens `Slide` uses by default) live in that one
module because the host, the provider and every reserving page must agree on them.
`IWPlayPage` is the only consumer today.

### Known gap

The composer's quick-dictionary lookup input takes **English or pinyin**, and it is
an ordinary eligible field, so focusing it retargets the handwriting keyboard onto
a field the handwriting keyboard cannot usefully fill. It predates this change (the
old model followed focus there too). Marking it `data-beginner-keyboard="off"`
would fix it and, under the model above, would also close the keyboard on the way
in — which is the right behaviour. Not done, because it was not asked for.

## 7. Outstanding before we can build

**Nothing is blocking as of 2026-09-07.** What remains is one build task and a set
of things that can be settled while building. The host surface, the template
asset, the candidate-row modes and the commit semantics were all answered that
day.

### 7a. Host surface — ANSWERED 2026-09-07: app-wide

> ⚠️ **Amended 2026-09-09 by § 6z.** This section describes the keyboard as bound
> to focus ("available anywhere a text field is focused"). Focus is now only the
> TRIGGER: the keyboard stays up after focus moves away, and dismissal is its own
> set of events. Everything else here — the document listener, the opt-out policy,
> the inset contract — is unchanged.

**The keyboard is available anywhere a text field is focused.** It is not tied to
one feature.

⚠️ **REVISED 2026-09-07 — there is no swap bar. The keyboard just comes up.**
This section originally specified an app-rendered bar above the OS keyboard,
offering to replace it ("Don't know the pinyin?"). That was struck during the
build for two reasons: it made the app's own input method a *suggestion*, and it
cost a tap on every field for a learner who cannot type pinyin at all — which is
precisely the learner this exists for. Focusing an eligible field now raises the
beginner keyboard directly, with the OS keyboard suppressed via `inputMode`.

**There is still an escape to Latin text**: an `ABC` key inside the keyboard hands
the field back to the system keyboard for the rest of that focus — the same
affordance every IME has, costing nothing until it is wanted.

That makes the keyboard a **shared component**, not a feature-owned one — it is
mounted once by the app shell rather than per page. Its only contract with a host
field is "insert this text at the caret".

#### Who gets it — DECIDED 2026-09-07: Chinese learners only

Gated on the account's `selectedLanguage === 'zh'`. This is a Chinese handwriting
IME — it can only ever produce hanzi — so raising it for a Spanish learner would
replace their keyboard with one that cannot type their language.

The check lives in `BeginnerKeyboardProvider`, **not** in the per-field
eligibility policy, because it is a fact about the USER. Mixing it in would make
that policy untestable without an auth context. Switching language mid-session
removes the keyboard immediately; the host's unmount effect restores the field.

#### Which fields — opt-OUT

Default yes; `data-beginner-keyboard="off"` on a field or any ancestor declines
for a whole region. Excluded by content type: `password`, `email`, `number`,
`tel`, `url`, `date` — anything that cannot hold a Chinese character. An opt-IN
list was rejected: it would have meant editing every input in the app and would
silently miss every one added later.

The policy is a pure predicate (`isEligible`) over a `FieldTraits` record, split
from the DOM read so it can be tested in the node environment the suite runs in.

#### Which routes — a second, wholesale gate (added 2026-09-09)

Two pages switch the keyboard off entirely, by path rather than per field:
`/night-market/template-editor` and `/immersive-world/scene-editor`. Both are the
desktop-only, template-author-only authoring surfaces, and every field on them
holds authoring metadata (a scene name, a tile id, a numeric size) typed in ASCII —
a handwriting bar over a dense three-column tool is pure obstruction.

It is a PATH exclusion rather than the `off` attribute because both pages open MUI
dialogs and menus, which portal into `document.body` and so escape the attribute's
`closest()` inheritance — one entry per page beats chasing every portal. The list
is `DISABLED_PATHS` / `isKeyboardDisabledPath` in `eligibility.ts`, and
`BeginnerKeyboardProvider` folds it into the same `enabled` flag as the `zh` gate,
so on those routes the document listeners are never registered at all.

⚠️ `/night-market/template-sandbox` is deliberately **not** in the list — only the
two editors were asked for. Add it here if the sandbox grows text fields worth
protecting.

#### Giving up space — `useBeginnerKeyboardInset()`

The keyboard is portaled into the app's overlay host, so it is **not** in any
page's layout flow and cannot shrink one by existing. Most pages scroll, and a
scrolling page handles an occluded bottom correctly on its own.

Pages with something **pinned** to the bottom that scrolling cannot reveal must
opt in. `IWPlayPage` is the motivating case: the stage is a fixed viewport with
the composer pinned under it, so it reserves the inset as `paddingBottom`, which
shrinks the `flex: 1` stage and carries the composer above the keyboard.

The height is **measured** off the live surface (a `ResizeObserver`), not computed
from a nominal keyboard height — that is the only number that stays correct
mid-animation. It is published twice from that one measurement:
`useBeginnerKeyboardInset()` for React layout, and `--beginner-keyboard-inset` on
`:root` for plain CSS.

#### ⚠️ Driving a controlled React input from outside React

Nearly every input in this app is controlled. `setRangeText` and `field.value = …`
mutate the DOM but bypass React's value tracker, so the next render paints the old
value straight back — the symptom is **a character appearing and then vanishing**,
with no error. Dispatching `input` alone does not help either: the tracker sees no
change and drops the event.

`insertAtCaret` writes through the **native prototype setter** (which does not
touch React's cache) and then dispatches a bubbling `input` event, so `onChange`
fires normally. This is the standard interop shim; if it ever regresses, look for
vanishing characters rather than an exception.

#### ⚠️ The OS keyboard cannot host a bar — this app has no native wrapper

Verified 2026-09-07: there is **no Capacitor, Cordova, React Native, Ionic,
Electron or Tauri dependency**. This is a web app in a mobile browser. A row
attached to the system keyboard is an iOS `inputAccessoryView` — a native API. A
web page cannot draw above the OS keyboard, and cannot replace it.

The behaviour is still reachable, but it is three pieces of our own:

| what | how |
|---|---|
| A bar that *appears* to sit on the OS keyboard | a `position: fixed` row positioned against **`window.visualViewport`**, which shrinks when the keyboard opens. Standard technique; known to jitter during the iOS open/close animation. |
| Suppressing the OS keyboard once swapped | set **`inputmode="none"`** on the focused field (or `readOnly`) so it keeps focus and the caret but raises no system keyboard. `navigator.virtualKeyboard` is Chromium-only — not usable as the mechanism. |
| Our keyboard itself | a fixed bottom panel occupying roughly the space the OS keyboard vacated (§ 6r) |

Two consequences to design around, both flagged now rather than discovered later:

1. **Swapping is a re-focus dance.** Toggling `inputmode` on a focused input does
   not reliably dismiss an already-open keyboard on iOS — it usually needs a
   blur/refocus, which risks losing the caret position. The caret offset must be
   captured and restored explicitly.
2. **`visualViewport` is the only measurement available**, and it reports nothing
   until the keyboard has actually opened. There will be a frame or two where the
   bar is mispositioned. Budget for it; do not treat it as a bug.

#### DECIDED 2026-09-07: build on Capacitor, revisit RN only if it falls short

This is consistent with the standing recommendation in
[REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md) — *"do not migrate …
ship Capacitor if native packaging is wanted"* — and it does **not** clear that
doc's gate 3. Capacitor supplying the keyboard mechanics is the ordinary case
that recommendation anticipates, not a new argument for RN. If the keyboard turns
out to need a true `inputAccessoryView`, that becomes a gate-3 candidate and gets
re-argued there, with evidence.

⚠️ **Capacitor is additive, not a replacement — the web path still has to be
built.** Capacitor wraps the same Vite build and the app stays reachable in a
browser (that doc's distribution table: *"Same build, unchanged"*). Unless
browser access is dropped, **both** keyboard-mounting paths ship, and every
browser user gets the `visualViewport` one. So the platform difference has to be
an adapter, not a branch scattered through the keyboard:

```
useKeyboardViewport()          ← one hook, two implementations
  web     → window.visualViewport  +  inputmode="none"  +  blur/refocus
  native  → @capacitor/keyboard: keyboardWillShow.keyboardHeight,
            Keyboard.hide(), setResizeMode('none')
```

Everything above that hook — the canvas, the matcher, the candidate row, the
buffer — is identical on both. **Build the web implementation first**: it is the
one that must exist regardless, and it is testable in the dev browser today
without any of Capacitor's toolchain.

Also worth pricing in before the wrap happens, none of it keyboard work: the
**Apple Developer Program ($99/yr)**, iOS and Android build toolchains, and a
distribution route (TestFlight internal ≤100 testers needs no App Review). Deploy
stops being "rebuild the container" for the native targets.

#### What Capacitor actually fixes

[REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md) § "Concrete product
demands on a native shell" now carries this keyboard as a ledger row. The short
version:

| the web problem above | `@capacitor/keyboard` |
|---|---|
| `visualViewport` reports nothing until the keyboard has opened, and jitters through the iOS animation | `keyboardWillShow` fires **before** the animation with the exact `keyboardHeight`. The bar is positioned from a fact, not a measurement. |
| `inputmode="none"` + blur/refocus does not reliably dismiss an open iOS keyboard, and risks the caret | `Keyboard.hide()` dismisses it without touching focus. The caret dance disappears. |
| the WebView reflows underneath our fixed panel | `setResizeMode('none')` |

⚠️ **What Capacitor does NOT give is a native accessory bar.** Under Capacitor the
app is still a WebView; `Keyboard.setAccessoryBarVisible()` only toggles the
system's own Done/prev/next bar, it does not let us put our content in it. The
keyboard stays a web-rendered surface either way — Capacitor makes it *reliable*,
not *native*. (This mattered more when the design still had a swap bar sitting
above the OS keyboard; now that the keyboard replaces it outright, the accessory bar
is doubly irrelevant.)

Which is fine, because **the accessory bar is not actually needed.** Once
`Keyboard.hide()` works, our keyboard simply replaces the OS keyboard in its own
fixed panel and the swap control can live at the top of that panel. The accessory
bar is only needed for the *before* state — offering the swap while the OS
keyboard is still up — and a row at a known-exact keyboard height is visually
indistinguishable from one attached to it.

React Native is the only option that supplies the literal thing (its iOS-only
`InputAccessoryView` is a real `inputAccessoryView`). That is a very large lever
for a cosmetic gain and does not move that doc's recommendation.

**Nothing in § 6r or § 6s changes under any of these.** The canvas, the matcher
and the candidate row are DOM and JS in all three worlds; only the mounting and
dismissal mechanics differ. **Build for web now** — the fallbacks work — and treat
Capacitor as an upgrade that deletes two workarounds rather than a precondition.

### 7a-2. Former blockers, all now answered

| # | question | where | status |
|---|---|---|---|
| B2 | Template asset scope and precision | § 6s | **RESOLVED 2026-09-07: all 895 components, N=8, int8 — ~85 KB brotli.** Accuracy is flat across every variant, so the precision dials are free and N=8 is also ~40% faster to score. Scope stays maximal because it is the only dial that can cost a missed recognition. N and the quantization scale must be **generator parameters, not literals**. |
| B3 | How the two candidate-row modes are distinguished | § 6r | **ANSWERED 2026-09-09: ground tint + chip border weight, no label.** Shipped as a blue tint while drawing / green when idle, with commit chips outlined heavier. The vertical row label that was the third channel was removed the same day so the chips get the bar's full width. |
| B4 | Does the buffer survive committing a character? | § 6r | **ANSWERED 2026-09-07: no.** Committing a candidate always clears the buffer. Multi-character words are reachable **only** through the § 6q fallback — the learner draws all of the word's components in one unbroken buffer and taps the word when it appears. See § 6r "Committing". |

### 7b. Design assumption: the whole det table becomes discoverable

**Confirmed 2026-09-07.** Every decision here is made for the end state where all
9,855 single-character rows (and all 99k multi-character words) are discoverable,
not for today's subset. Concretely:

| already sized for the end state | why |
|---|---|
| **The component inventory** | 895 is derived from *every* single-char det row, not the discoverable ones. It cannot grow — the 356 discoverable-scope figure quoted throughout § 3 is a temporary number with no future. |
| **The template asset** (§ 6s) | 895 scope, chosen for exactly this reason. |
| **The § 6q word fallback** | its pool is all 57,160 / 23,435 / 18,604 det words of length 2 / 3 / 4, already ignoring `discoverable`. |
| **The § 6j candidate-length numbers** | simulated over a random 1,200 characters drawn from the whole table. |

Two things that **do** move as discoverability spreads, neither blocking:

- **The candidate bar gets longer**, since the § 6j lists are already whole-table
  but the *realistic* lists today are shorter. § 6p's "show everything, scrollable"
  rule was chosen partly because it degrades gracefully; a truncating design would
  not have.
- **`frequencyScore` becomes load-bearing.** It is the primary ranking tie-break
  (§ 6k) and is populated on 258 of 9,855 rows. Today the in-corpus usage count
  does the work; as coverage grows the ordering shifts under the same contract.

And the one build task this forces: the component subset font must be regenerated
with `--all` (§ 7c), not at discoverable scope.

### 7c. ~~One build task~~ DONE 2026-09-07

✅ **Regenerated.** `hanzi-components.woff2` went from 68.1 KB (an earlier,
partial component set) to **205.8 KB** covering all 895 components, via
`generate-component-font.js --all`. The committed binary was rewritten.

⚠️ **The run needed a container restart first.** `generate-component-font.js`
reads its source face from `/app/data/hanzi/NotoSansSC-VF.ttf`, which is the
repo-root `data/` bind mount — and that mount had silently vanished inside
`cow-backend` (a known WSL2 flake). The script's error message says
"restore it from git", which is misleading: the file was present on the host the
whole time. `docker restart cow-backend` fixed it in one second.

Original task text:

**Regenerate the component subset font.** `src/assets/fonts/hanzi-components.woff2`
was generated from an earlier state of `dictionaryentries_zh.components`; the
column has since been repopulated (§ 3d). Any keyboard rendering components must
use `FONTS.hanziComponents` (§ 4.12), and ~4% of components are not served by
Google's Noto Sans SC subset — they render as tofu without it. Run `generate-component-font.js --all` — the keyboard uses the
895-component scope (§ 6s), and § 7f expects the whole det table to become
discoverable anyway. Note it rewrites a committed binary.

### 7d. Decidable during the build

- **Lookup scope: 356 or 895 components?** (§ 4.1) Low stakes — a wider set risks
  more wrong candidates, never missing ones.
- **Do components need names?** (§ 4.4) Would need a **new table or column** —
  requires explicit confirmation before anything is added.
- **Are word candidates visually marked** as distinct from character candidates?
  (§ 6q)
- **Many-to-one stroke assignment** for split strokes (§ 6s) — only if real ink
  shows the 30%/50% split-stroke case matters.
- **`frequencyScore` coverage.** 258 of 9,855 rows populated (§ 6k), so the
  primary tie-break is largely inert today and the in-corpus usage count is doing
  the work. The ranking contract does not change as coverage grows.

### 7e. Explicitly out of scope for v1

- **Stroke-level input** (§ 3e / § 4.7) — derivable, but needs a new column and
  has a ~16% fallback rate. Whole-component input is the v1 interaction.
- **Undo / redo buttons** (§ 6r) — per-stroke history. The all-or-nothing `Clear`
  key shipped 2026-09-09; submission is still the only exit that keeps the ink.
- **Any use of the Google recognizer** (§ 6a). It stays where it is, serving
  Practice Writing.

### 7g. OPEN: does distance deserve to outrank frequency? (§ 6k)

`compareCharacters` sorts distance ascending, then `frequencyScore` descending.
Distance 0 genuinely is an exact-match signal and must stay first. **Distance 1 vs
2 is not a confidence signal** — a 3-component character is not less likely than a
2-component one — and it is what buried 你 at rank 146 behind rarer 2-component
characters (§ 6x's table).

§ 6x reduces the damage without answering the question, because the learner now
reaches distance 0 in fewer draws. Not changed, because any reweighting has to be
measured against the same 200-character set rather than argued.

### 7f. Housekeeping

- This doc is **not linked from CLAUDE.md**. It should become a grandchild link
  once the feature is real — needs the user's go-ahead.
- `src/components/handwriting/recognize.ts` takes a `token` parameter and calls
  raw `fetch`, violating
  [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md) ("no API function takes a
  `token`"). Pre-existing and on the Practice Writing path, not this one — but if
  the keyboard ever touches that file, fix it in the same pass.
- Migration 125's column comment on `components` is wrong (§ 6o): it claims
  `NULL = not computed; [] = atomic`, when `[]` also means "no source data".

## 8. Related docs

- [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md) § 5a-ii — the only current consumer
  of `components` (the No Pinyin hint ladder)
- [BREAKDOWN_FEATURE_IMPLEMENTATION.md](./BREAKDOWN_FEATURE_IMPLEMENTATION.md) —
  `breakdown` vs `components`, the level-1 table
- [PRACTICE_WRITING.md](./PRACTICE_WRITING.md) /
  [HANDWRITING_RECOGNITION.md](./HANDWRITING_RECOGNITION.md) — the level-4
  (stroke) path and the existing Hanzi Writer dependency
- [CJK_TYPEFACE_LAB.md](./CJK_TYPEFACE_LAB.md) — typeface choices for CJK glyphs
