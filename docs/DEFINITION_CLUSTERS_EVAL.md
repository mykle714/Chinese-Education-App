# Definition Clustering — Two-Stage Evaluation (Chinese)

> Child of [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md). A frozen record of
> the split→merge pipeline evaluated on 20 deliberately high-variance headwords.
> Design/rationale live in the parent; this doc is the empirical result.

## Method

- **Script:** `server/scripts/backfill/chinese/backfill-cluster-definitions.js`
- **Invocation:** `--words=<10 words> --spot-check --merge-pass` (spot-check = **no DB writes**)
- **Stage A (split):** `claude-sonnet-4-6`, "shared core idea" prompt, reading boundary, err-finer
- **Stage A.5 (merge):** `claude-sonnet-4-6`, strengthened merge prompt (lean toward merging; only guard is coherence / no grab-bag; never cross a reading)
- **Sample:** heteronym-heavy / high-polysemy single characters — the hardest case for a flat single-reading row
- **Result:** 20 words → **110 clusters** (Batch 1: 59, Batch 2: 51), avg **5.5 clusters/word**
- **Batch 1:** 行 当 点 干 着 和 倒 得 分 别
- **Batch 2:** 对 蒙 折 冲 溜 白 糊 落 处 调

`⚠` marks a data/quality issue discussed under [Open issues](#open-issues).

## Batch 1 — clusters (59)

| Word | Reading | Sense | v | Glosses |
|---|---|---|---|---|
| 干 | gan1 | dry / empty / hollow | 4 | dry, dried food, empty, hollow, futile, in vain |
| 干 | gan1 | trunk / main part ⚠ | 2 | tree trunk, main part of something |
| 干 | gan1 | heavenly stem / nominal kinship ⚠ | 3 | adoptive, foster, taken in to nominal kinship, one of the ten heavenly stems 天干 |
| 干 | gan1 | to concern / involve | 2 | to concern oneself with, (bound) to have to do with |
| 干 | gan1 | annoyed / rude / cold-shoulder | 5 | annoyed, (coll.) pissed off, blunt, (dialect) rude, (dialect) to cold-shoulder |
| 干 | gan1 | archaic shield | 1 | (archaic) shield |
| 干 | gan4 | to do / work / manage | 5 | to do, to work, to manage, to kill (slang), to fuck (vulgar) |
| 干 | gan4 | cadre / capable person | 2 | cadre, capable |
| 倒 | dao3 | to fall / collapse / fail | 5 | to fall, to collapse, to fail, to go bankrupt, to lie horizontally |
| 倒 | dao3 | to invert / pour out / overturn | 5 | to pour out, to tip out, to dump, to go backward, to invert, to place upside down…, to overthrow |
| 倒 | dao3 | to transfer / resell | 4 | to change (trains or buses), to resell at a profit, to move around |
| 倒 | dao4 | inverted / upside down | 3 | inverted, upside down, reversed |
| 倒 | dao4 | contrary to expectation / but | 5 | contrary to what one might expect, but, yet |
| 分 | fen1 | to divide / separate / distribute | 5 | to divide, to separate, to distribute, to allocate, to distinguish (good and bad) |
| 分 | fen1 | part / share / component | 3 | part, share, component, ingredient, fraction |
| 分 | fen1 | branch / sub- (prefix) | 2 | sub- (as in 分局), (bound) branch of (an organization) |
| 分 | fen1 | minute / point / small unit | 5 | minute (unit of time), a point (in sports or games), 0.01 yuan, one tenth (of certain units), minute (angular measurement unit), unit of length 0.33 cm |
| 别 | bie2 | don't …! (imperative) | 5 | don't …! |
| 别 | bie2 | different / other / category | 2 | different, another, (bound) other, (noun suffix) category |
| 别 | bie2 | to part / distinguish | 1 | to leave, to part (from), to distinguish, (literary) to differentiate |
| 别 | bie2 | to pin / clip / deflect | 3 | to fasten with a pin or clip, to stick in, to insert…, to avert…, to turn aside, to make sb change their ways, (dialect) to turn away |
| 和 | he2 | and / with / sum | 3 | and; with; sum, (joining two nouns) and, together with, (math.) sum, with (Tw han4) |
| 和 | he2 | harmonious / make peace / draw | 2 | to make peace, (sports) to draw, to tie, (bound) harmonious |
| 和 | he2 | Japan / Japanese | 2 | Japanese, (bound) Japan |
| 和 | huo2 | to mix / blend ingredients | 5 | to blend, to mix (ingredients) together, to combine a powdery substance…with water, Taiwan pr. [huo4] |
| 和 | hu2 | to complete a mahjong set | 5 | to complete a set in mahjong or playing cards |
| 和 | he4 | to chime in / reply in verse | 1 | to chime in with others, to join in the singing, to compose a poem in reply… |
| 和 | huo4 | classifier for boilings/rinses | 4 | classifier for rinses of clothes, classifier for boilings of medicinal herbs |
| 当 | dang1 | to act as / serve as | 3 | to be, to act as, to regard as, to think, to replace |
| 当 | dang1 | right at (time/place) | 2 | when, during, just at, on the spot, at or in the very same…, just at (a time or place) |
| 当 | dang1 | to manage / withstand / should | 2 | ought, should, manage, withstand, obstruct |
| 当 | dang1 | ding dong (onomatopoeia) | 4 | ding dong (bell), (onom.) dong |
| 当 | dang4 | suitable / proper / equal | 2 | proper, right, fitting, suitable, adequate, equal, same, match equally |
| 当 | dang4 | to pawn / fail (a student) | 4 | to pawn, (coll.) to fail (a student) |
| 得 | de2 | to get / obtain / gain | 4 | to get, to gain, to obtain, to catch (a disease), to allow, to permit |
| 得 | de2 | satisfied / suitable / done | 1 | proper, suitable, contented, proud, finished, ready |
| 得 | dei3 | must / have to | 5 | must, to have to, ought to, to need to |
| 得 | de5 | structural complement particle | 5 | structural particle: used after a verb… |
| 着 | zhe5 | aspect particle (ongoing/progressive) | 5 | aspect particle indicating action in progress or ongoing state |
| 着 | zhao2 | to touch / contact / be affected | 4 | to touch, to come in contact with, to contact, to feel, to be affected by |
| 着 | zhao2 | to catch fire / burn | 5 | to catch fire, to burn |
| 着 | zhao2 | to fall asleep | 5 | (coll.) to fall asleep |
| 着 | zhao2 | hitting the mark / succeeding | 5 | succeeding in, (after a verb) hitting the mark |
| 着 | zhao2 | to apply / use / add | 3 | to wear (clothes), to apply, to use, to add, (dialect) to put in |
| 着 | zhao2 | okay / all right (dialect) | 5 | all right, (dialect) okay |
| 着 | zhao1 | chess move / trick / tactic | 4 | trick, tactic, a move in chess (Tw zhuo2) |
| 行 | hang2 | commercial firm / trade / profession | 3 | trade, profession, (bound) line of business, (bound) commercial firm |
| 行 | hang2 | row / line / rank | 3 | line, (in data tables) row, classifier for rows or lines, (bound) row, (Tw) column, (bound) to rank… among one's siblings (by age) |
| 行 | xing2 | to walk / go / travel / do | 3 | to go, to travel, to perform, (bound) to do, (bound) to walk |
| 行 | xing2 | all right / capable / will do | 5 | all right, OK!, will do, capable, competent |
| 行 | xing2 | current / in circulation / temporary | 1 | in circulation, (bound) current, (bound) temporary, makeshift |
| 行 | xing2 | trip / journey / about to (literary) | 1 | journey, visit, soon, (literary) about to, (literary) trip |
| 行 | xing2 | behavior / conduct | 2 | behavior, conduct (Tw xing4) |
| 点 | dian3 | dot / point / spot (noun) | 5 | point, dot, spot, speck, point in time or space, (after a number) o'clock, dot stroke…, (math.) decimal point |
| 点 | dian3 | a small amount / a bit | 5 | a small amount, a bit, (after a verb/adj) a bit more, classifier for small amounts |
| 点 | dian3 | to tap / touch / mark / check | 4 | to tap, to touch briefly, to nod (one's head) in agreement, to mark with a dot, to check off (on a list), to beckon by moving (one's hand)… |
| 点 | dian3 | to select / order / mention / hint | 5 | to order (food etc), to select, to mention, to bring up (a topic or person), to hint at, to imply |
| 点 | dian3 | to administer drops | 3 | to administer (eye medicine etc) in drops |
| 点 | dian3 | to light / ignite | 4 | to light (a fire, a lamp etc), to ignite |

## Batch 2 — clusters (51)

| Word | Reading | Sense | v | Glosses |
|---|---|---|---|---|
| 对 | dui4 | correct / right | 5 | correct, right |
| 对 | dui4 | directed at / regarding | 3 | towards, at, for, concerning, regarding, to face, facing, to treat (sb a certain way) |
| 对 | dui4 | to answer / respond | 3 | to answer, to reply |
| 对 | dui4 | pair / couple | 3 | pair, classifier: couple |
| 对 | dui4 | to match / fit / adjust | 3 | to match together, matching, to fit, to suit, to adjust, to check, to compare |
| 对 | dui4 | to add / pour in | 4 | to pour in (a fluid), to add |
| 对 | dui4 | opposite (bound form) | 1 | (bound) opposite |
| 蒙 | meng2 | to cover / receive / suffer | 2 | to cover, to receive (a favor), to suffer (misfortune) |
| 蒙 | meng2 | drizzle / mist / ignorant / dim | 2 | drizzle, mist, blind, dim-sighted, ignorant |
| 蒙 | meng2 | sincere / honest (literary) | 1 | honest, genuine, (literary) sincere |
| 蒙 | meng1 | dazed / deceived / guess wildly | 5 | to cheat, to deceive, to hoodwink, to make a wild guess, (knocked) unconscious, dazed, stunned |
| 蒙 | Meng3 | Mongol ethnic group | 3 | Mongol ethnic group, Taiwan pr. [Meng2] |
| 折 | zhe2 | to fold, bend, or twist | 4 | to fold, to bend, to twist |
| 折 | zhe2 | to break or snap | 4 | to break, to fracture, to snap |
| 折 | zhe2 | to turn / change direction | 2 | to turn, to change direction |
| 折 | zhe2 | to convert / discount / suffer loss | 4 | discount, rebate, tenth (in price), to convert into (currency), to suffer loss |
| 折 | zhe2 | convinced / persuaded | 2 | convinced |
| 折 | zhe2 | booklet / classifier for scenes | 1 | classifier for theatrical scenes, accounts book |
| 冲 | chong1 | to rush / dash / clash | 4 | to rush, to go straight ahead, to rise in the air, (of water) to dash against, to clash, to collide with, towards, in view of |
| 冲 | chong1 | to rinse / flush / infuse | 5 | to rinse, to flush, to infuse, to mix with water, to develop (a film) |
| 冲 | chong1 | powerful / pungent / vigorous | 4 | pungent, powerful, vigorous |
| 冲 | chong1 | thoroughfare (busy place) | 1 | thoroughfare |
| 溜 | liu1 | to sneak away / slip off | 5 | to slip away, to escape in stealth |
| 溜 | liu1 | to skate / slide | 4 | to skate |
| 溜 | liu1 | skilled / speedy (dialect) | 5 | proficient, (of movements) quick, speedy, (dialect) (of speech, actions etc) skilled |
| 溜 | liu1 | to plaster / practice (dialect) | 3 | to fill in the cracks…, (dialect) to plaster, (dialect) to practice |
| 溜 | liu1 | swift current / rapids | 1 | swift current, rapids |
| 溜 | liu1 | surroundings / neighborhood | 2 | surroundings, neighborhood |
| 溜 | liu1 | classifier for rows/lines | 4 | classifier for rows, lines etc |
| 溜 | liu1 | roof gutter / rain runoff | 1 | (bound) roof gutter, (bound) rain runoff from a roof |
| 白 | bai2 | white / bright / pure | 5 | white, pure, bright, snowy |
| 白 | bai2 | empty / blank / plain | 4 | plain, blank, empty |
| 白 | bai2 | in vain / free of charge | 5 | free of charge, gratuitous, in vain |
| 白 | bai2 | to state / explain / make clear | 3 | clear, to make clear, to state, to explain |
| 白 | bai2 | vernacular / spoken operatic lines | 2 | vernacular, spoken lines in opera |
| 白 | bai2 | reactionary / anti-communist | 2 | reactionary, anti-communist |
| 白 | bai2 | funeral / cold stare / wrong character ⚠ | 3 | funeral, to stare coldly, to write wrong character |
| 糊 | hu2 | paste / thick food / muddled | 4 | paste, mush, thick gruel, congee, cream, blurry, unclear, muddled, (in 糊口) to feed oneself |
| 糊 | hu4 | to paste / glue / daub | 4 | to paste, to glue, to cover (a surface…), to smear, to daub |
| 糊 | hu1 | scorched / burnt | 5 | (esp. of food) scorched, burnt, Taiwan pr. [hu2] |
| 落 | la4 | colloquial reading for luo4 ⚠ | 5 | colloquial reading for 落[luo4] in certain compounds |
| 落 | luo4 | to fall / drop / sink / decline | 3 | to fall or drop, to fall onto, to lower, to decline or sink, to lag or fall behind, (of the sun) to set, (of a tide) to go out |
| 落 | luo4 | to leave out / forget / be missing | 5 | to leave behind or forget to bring, to leave out, to be missing |
| 落 | luo4 | to receive / rest with / settle | 2 | to get or receive, to rest with, settlement, whereabouts, to write down |
| 处 | chu3 | to dwell / be situated / get along | 2 | to be in, to be situated at, to be in a position of, to get along with, to dwell, to live, to reside, to stay |
| 处 | chu3 | to deal with / punish | 2 | to deal with, to discipline, to punish |
| 处 | chu4 | place / part / office | 2 | locality, classifier for locations, (bound) place, department, bureau, (bound) office, aspect, (bound) part |
| 调 | diao4 | to transfer / reassign | 2 | to transfer, to move (troops or cadres) |
| 调 | diao4 | to investigate / enquire | 2 | to investigate, to enquire into |
| 调 | diao4 | tone / melody / viewpoint | 3 | tone, accent, melody, tune, key (in music), mode (music), argument, view |
| 调 | tiao2 | to adjust / harmonize / provoke | 3 | to adjust, to regulate, to blend, to harmonize, to reconcile, to season (food), to suit well, to incite, to provoke |

## Cluster counts

| Word | Defs | Clusters | | Word | Defs | Clusters |
|---|---|---|---|---|---|---|
| 干 | 27 | 8 | | 对 | 24 | 7 |
| 倒 | 21 | 5 | | 蒙 | 20 | 5 |
| 分 | 18 | 4 | | 折 | 16 | 6 |
| 别 | 16 | 4 | | 冲 | 17 | 4 |
| 和 | 21 | 7 | | 溜 | 17 | 8 |
| 当 | 28 | 6 | | 白 | 21 | 7 |
| 得 | 17 | 4 | | 糊 | 18 | 3 |
| 着 | 21 | 8 | | 落 | 16 | 4 |
| 行 | 31 | 7 | | 处 | 19 | 3 |
| 点 | 27 | 6 | | 调 | 21 | 4 |
| **Batch 1** | | **59** | | **Batch 2** | | **51** |

**Combined: 20 words → 110 clusters, avg 5.5/word.**

## What works

- **Heteronym separation is reliable** across 3–4-reading words: 会 hui4/kuai4,
  得 de2/de5/dei3, 和 he2/huo2/he4/hu2, 蒙 meng2/meng1/Meng3, 糊 hu2/hu4/hu1,
  处 chu3/chu4, 调 diao4/tiao2. Each sense lands on the correct reading, and the
  reading boundary keeps them in separate clusters.
- **Per-cluster register variance is real:** single words span the full 1–5 scale
  (干 "to do"=5 vs "shield"=1; 别 "don't!"=5 vs "to part"=1) — impossible for one
  word-level score.
- **No mega-clusters.** The coherence guard holds: 当 (28 defs) is a clean 6
  clusters, not the 23-gloss grab-bag the single-stage strong-merge prompt
  produced.
- **The merge pass is correctly conservative where it should be:** 溜 stays at 8
  because its noun senses (swift current, surroundings, roof gutter, classifier)
  are genuinely unrelated despite sharing liu1.

## Persistent non-merges (model priors, not tunable via prompt)

Even under a strong merge instruction, Sonnet refuses to fuse these — it treats
them as distinct senses (as many dictionaries do):

- 点 `dot` vs `a small amount`
- 倒 `contrary-to-expectation` vs `inverted / reversed`

Reaching these exact merges would require naming them in the prompt (rejected as
over-fitting) or a post-hoc rule; they are left as-is.

## Open issues

1. **Wrong Stage-A reading blocks a valid merge.** 干 `trunk / main part` was
   tagged **gan1**; 树干/主干/骨干 is **gan4**. Because the merge pass cannot cross
   a reading boundary, the mis-read `trunk` cannot rejoin the gan4 `cadre`
   cluster. Fix is upstream: validate `reading` against the entry's known reading
   set (+ numbered-pinyin normalization) in `validatePartition`, flag/correct
   outliers.
2. **Occasional grab-bag over-reach at high merge strength.** 白 `funeral / cold
   stare / wrong character` and 干 `heavenly stem / nominal kinship` each fuse
   unrelated same-reading senses. These surface as `⚠ CLUSTER REVIEW` flags — the
   intended safety net — rather than silent errors.
3. **Meta-gloss source oddity.** 落 `colloquial reading for 落[luo4] in certain
   compounds` describes a *reading*, not a meaning, yet is a standalone gloss/
   cluster. A source-data cleanup item, not a clustering defect.

## Reproduce

```bash
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js \
  --words=行,当,点,干,着,和,倒,得,分,别 --spot-check --merge-pass
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js \
  --words=对,蒙,折,冲,溜,白,糊,落,处,调 --spot-check --merge-pass
```

Spot-check runs perform **no writes**. Output is nondeterministic — Stage A can
split slightly differently between runs (e.g. 着 landed at 5 clusters in an
earlier run, 8 here), which moves the final counts a little.
