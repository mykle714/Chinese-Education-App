# longDefinition Spot-Check Review (Chinese)

> ⚠️ **Superseded by v11 (migration 70).** This review documents v9/v10, when
> `longDefinition` was a single labeled TEXT string with a per-ENTRY budget of
> `100 × (POScount + 1)` (200/300/400). As of SCRIPT_VERSION 11, `longDefinition` is
> a JSONB OBJECT keyed by POS (`{"noun": "...", "verb": "..."}`) with a **per-POS-value
> budget of 125 chars** (constant, independent of POS count). The lengths/budgets quoted
> below no longer apply; the qualitative rule notes (rules 2–11) still do.

**Date:** 2026-06-06
**Script:** `server/scripts/backfill/chinese/backfill-long-definitions.js` (SCRIPT_VERSION 10)
**Sample:** 15 discoverable `dictionaryentries_zh` words spanning vernacularScore 2–5.
**Pipeline:** generator (Sonnet) → validator (Sonnet) → regenerator (Opus) → chooser (Opus) → `enforceMaxLen` (Opus tightener, up to 4 passes).

> "Original" = the longDefinition before this round of prompt work (backed up to `/tmp/longdef_backup.tsv`).
> "v9" = the value currently written to the DB.

---

## Rules enforced

| # | Rule |
|---|------|
| 1 | Length 25 … **`100 × (POScount + 1)`** chars. The cap is a **ceiling, not a target**. |
| 2 | English; **Chinese characters only for culturally-significant terms** (idiom/chengyu/loaded phrase). No ad-hoc Chinese, no Chinese for function-word grammar, no pinyin. |
| 3 | No contrast **against the displayed gloss / English wording** (contrast between the word's own senses is fine). |
| 4 | No bare self-reference. |
| 5 | Cover every POS; multi-POS uses `noun:` / `verb:` labels, primary POS first. |
| 6 | No synonym lists. |
| 7 | No restatement of the displayed gloss, nor anything inferable from it. |
| 8 | Never reference English (unless the word is *about* English). |
| 9 | No register/formality commentary (learner gets that from vernacularScore). |
| 10 | No regional/dialectal/geographic-usage elaboration. |
| 11 | No "appears in" / "found in" tacked-on example phrasing. |

**Automated checks (湖/家人/工作/能 reworked under v10):** over-budget = **0**, "appears in" = **0**, contains "English" = **0**.
**Remaining issue:** 能 still cites 能量 across two v10 reruns — see note 5.

---

## Single-POS words (budget 200)

### 湖 — vs 3 — gloss: "lake"  (196/200)  ✅ fixed (v10)
- **Original:** A large body of freshwater or saltwater surrounded by land, distinct from a river which flows continuously.
- **v10:** Lakes loom large in landscape aesthetics and poetry; sites like 西湖 anchor centuries of verse and legend. The word also figures in 江湖, the world of wandering martial heroes beyond official society.

### 葬礼 — vs 3 — gloss: "funeral"  (175/200)
- **Original:** A funeral ceremony or ritual for burying or cremating the deceased, encompassing all related rites and observances.
- **v9:** In Chinese tradition, the ceremony typically includes rituals such as mourning rites, processions, and burial or cremation, often shaped by Buddhist, Taoist, or local customs.

### 原谅 — vs 4 — gloss: "to forgive"  (179/200)
- **Original:** To forgive someone for a wrongdoing; to pardon or excuse. Implies releasing resentment and accepting an apology, not merely overlooking or ignoring an offense.
- **v9:** Excuses personal wrongs or offenses, usually between individuals, not legal or institutional pardon. Often implies an emotional release of grievance, not merely verbal absolution.

### 家人 — vs 4 — gloss: "family member"  (191/200)  ✅ fixed (v10, no headword cite)
- **Original:** Family members; relatives living in the same household. Broader than "spouse" or "children" alone, encompassing all who share a home.
- **v10:** Carries a warm sense of shared belonging and mutual obligation; increasingly used metaphorically by brands and online communities to address followers or customers as part of an inner circle.

### 留学 — vs 4 — gloss: "to study abroad"  (184/200)
- **Original:** To study abroad in a foreign country, typically for an extended period as a student, not merely to travel or visit.
- **v9:** Covers pursuing a degree or extended program overseas, not short trips; rooted in state programs sending students abroad to modernize the nation, now tied to ambition and family pride.

### 九 — vs 5 — gloss: "nine"  (144/200)
- **Original:** The number nine; in Chinese culture, symbolizes longevity and good fortune due to its homophonic association with the word for "long-lasting."
- **v9:** Considered auspicious in Chinese culture, associated with longevity and imperial power; 九五之尊 traditionally denotes the emperor's supreme status.

### 土豆 — vs 5 — gloss: "potato"  (123/200)
- **Original:** A starchy underground tuber vegetable, commonly known as potato in English; distinct from peanuts despite the similar "bean" suffix in Chinese.
- **v9:** A staple of Chinese home cooking, commonly stir-fried, stewed, or mashed, and central to everyday meals across the country.

### 拿铁 — vs 5 — gloss: "latte"  (196/200)
- **Original:** A coffee drink made with espresso and steamed milk, typically topped with a thin layer of milk foam; the Chinese transliteration of the Italian word "latte."
- **v9:** A transliteration of Italian "latte," used specifically for espresso-based drinks with steamed milk. Ubiquitous in Chinese cafe culture, where customization of sweetness and milk type is standard.

### 刮风 — vs 5 — gloss: "to be windy"  (196/200)
- **Original:** To blow or be windy; the wind is blowing. Describes weather conditions, not the act of scraping or scratching.
- **v9:** Describes wind as a natural event or condition, typically used as a weather statement. Unlike stative weather verbs in some languages, it implies active movement of air rather than a static state.

---

## Multi-POS words (budget 300, labeled format)

### 工作 — vs 3 — gloss: "work" — [noun, verb]  (257/300)  ✅ fixed (v10, fully English)
- **Original:** Work or employment; a job or task performed as part of one's occupation or duties, distinct from leisure or study.
- **v10:**
  > noun: One's occupation or job duties; stable employment carries strong social weight, and asking about someone's job is a standard part of introductions.
  >
  > verb: To be employed or to perform job-related tasks, not general physical effort or household chores.

### 怎么 — vs 5 — gloss: "how?" — [pronoun, adverb]  (293/300)  ✅ now fully English
- **Original:** How or in what way; used to ask about manner, method, or reason in questions and exclamations.
- **v9:**
  > pronoun: Used to ask about manner, method, or reason — covering "why," "in what way," and "by what means" depending on context, not just manner alone.
  >
  > adverb: Used in statements to mean "no matter how" or "however one tries," expressing that an outcome holds regardless of effort or approach.

### 思念 — vs 2 — gloss: "to miss" — [verb, noun]  (284/300)
- **Original:** To miss someone or something; a longing or yearning for an absent person or thing, often tinged with melancholy.
- **v9:**
  > verb: Carries a sense of prolonged, tender longing — typically for someone absent due to distance or death rather than a brief separation.
  >
  > noun: The feeling itself, often described as deep and bittersweet; 思念之苦 captures how the emotion is culturally framed as a quiet, enduring ache.

### 现在 — vs 5 — gloss: "now" — [noun, adverb]  (254/300)
- **Original:** At the present time; now. Refers to the current moment, not a future intention or habitual action.
- **v9:**
  > noun: The present moment treated as a point in time, often contrasted with the past or future in the same sentence.
  >
  > adverb: Used to frame an action or state as currently in progress or immediately applicable, with a sense of "starting from this moment."

### 能 — vs 5 — gloss: "can" — [verb]  (159/200)  ✅ noun POS removed (root cause fix)
- **Original:** Ability or capacity to do something; can or may; talent or skill; also refers to energy or competence in performing actions.
- **POS fix:** `partsOfSpeech` corrected from `["verb","noun"]` → `["verb"]`. 能's "energy" sense is a bound morpheme (only in 能量/能源), so it never functioned as a standalone noun and should not have carried the noun tag. This eliminated the 能量 citation at the source rather than fighting it in the longDefinition prompt.
- **v10 (verb-only):** Specifically covers ability or skill-based possibility, not permission. It asks whether someone is capable of doing something, not whether they are allowed to.

### 关系 — vs 5 — gloss: "relationship" — [noun, verb]  (261/300)
- **Original:** The connection or relationship between people or things; also means to concern or affect. Broader than "relationship" alone, encompassing professional ties, social connections, and relevance.
- **v9:**
  > noun: Covers social and professional connections as well as abstract links between things or ideas. Cultivating 关系网, a web of mutual obligation and favors, is central to how business and personal matters get done.
  >
  > verb: To concern, bear on, or affect a matter.

---

## Reviewer notes

1. **Function-word rule (rule 2) confirmed.** 怎么 is now fully English ("covering why, in what way, by what means"), with no Chinese construction examples. 土豆 no longer cites 红薯.

2. **One regression — 湖 uses "appears in"** ("the word appears in many famous place names"), violating rule 11. The validator didn't flag it; this is a non-deterministic slip rather than a rule gap. A rerun of just 湖 should clear it.

3. **Three borderline Chinese citations to judge:**
   - **家人 / 工作 self-cite the headword** in characters (家人, 工作). For 家人 it carries a real cultural point (marketing "家人" intimacy); for 工作 it is more incidental. Rule 4 permits citing the target inside a genuine phrase, so neither is a hard violation — your call on whether headword self-citation in Chinese is wanted.
   - **能 cites 能量 / 能力** — ordinary content compounds, not culturally significant. Closest thing to a rule-2 stretch in this batch.

4. **v10 tightened rule 2** to also ban citing the headword itself in Chinese and citing ordinary compounds/derived words (only standalone culturally-significant idioms/phrases allowed). Reran 湖, 家人, 工作, 能: 湖 ("appears in" gone, now 西湖/江湖), 家人 (no headword cite), 工作 (fully English) all clean.

5. **能 — fixed at the root (POS), not in the longDefinition.** 能 kept citing 能量 because it was mis-tagged as a noun: its "energy" sense is a BOUND morpheme that only lives in compounds (能量, 能源) and never stands alone as a noun. Rather than fight this in the longDefinition prompt, the **POS backfill prompt was taught the bound-morpheme concept (new rule 8 + `bound_morpheme` violation code, SCRIPT_VERSION 2)**; re-running POS for 能 produced `["verb"]`, and the regenerated verb-only longDefinition is clean (159 chars, no Chinese).

6. **Bug found + fixed while doing this:** `backfill-parts-of-speech.js` and `backfill-example-sentences.js` both imported `posTags.js` from `'../../shared/lib/...'` (resolves to `scripts/shared/lib`, which does not exist) instead of `'../shared/lib/...'` (`scripts/backfill/shared/lib`). The scripts threw `ERR_MODULE_NOT_FOUND` on startup — they had not been run since the backfill scripts were reorganized into per-language folders. Both import paths corrected.

7. **State:** the 15 `dictionaryentries_zh` rows hold the current values (湖/家人/工作 at v10, 能 at v10 verb-only, the other 11 at v9). Originals backed up at `/tmp/longdef_backup.tsv`. The Spanish script remains reverted to its pre-session state.
