/**
 * lookalikes.ts — curated look-alike characters for the writing flp's graded back face
 * (docs/WRITING_PRACTICE_REWORK.md § 3c "Look-alike notice").
 *
 * Grading is strict top-1 (handwritingRecognizer.ts → `normalizeCandidates`): writing 未
 * for 末 is wrong, and stays wrong. What this table adds is the EXPLANATION — when the
 * recognizer read the learner's ink as a known look-alike of the target, the card's back
 * names the other character and says how to tell the two apart.
 *
 * MODEL: a GROUP is a set of characters that are all confusable with one another. Each
 * member carries its pinyin and a `tell` — the one feature that sets it apart from every
 * other member, written as the PREDICATE of a sentence whose subject is the character:
 * the notice prints "目 is a tall box with two bars inside instead of one". A contrast
 * ("instead of one") is used only where it holds against EVERY other member, so the
 * same sentence works whichever partner the learner's ink was read as. The notice shows
 * the TARGET's tell: how to write the character that was asked for.
 *
 * Curated, not computed: only pairs listed here fire (a miss read as any other character
 * shows no notice). A character belongs to at most one group — `LOOKALIKES` is built
 * once and throws on a duplicate, so a second listing cannot silently shadow the first.
 * Tests: src/__tests__/lookalikes.test.ts.
 *
 * Layer: pure client data + lookup (no React). Referenced by:
 * src/features/flashcards/FlashcardsLearnPage/useWritingFlashcard.tsx (→ `findLookalike`).
 */

export interface LookalikeChar {
    char: string;
    /** Tone-marked standalone reading, space-free. The writing flp swaps the TARGET's for
     *  the card's in-word syllable (useWritingFlashcard → `lookalikeFor`), so a polyphone
     *  listed here shows its context reading there. */
    pinyin: string;
    /** What sets this character apart from its group — a predicate; the notice prefixes the char. */
    tell: string;
}

/** A recognized look-alike: the character asked for and the one the ink was read as. */
export interface LookalikeMatch {
    target: LookalikeChar;
    recognized: LookalikeChar;
}

type Group = Array<[char: string, pinyin: string, tell: string]>;

const GROUPS: Group[] = [
    [
        ["人", "rén", "joins at the top, and the left stroke is longer instead of the right"],
        ["入", "rù", "joins at the top, and the right stroke is longer instead of the left"],
        ["八", "bā", "has two strokes that stand apart instead of meeting at the top"],
    ],
    [
        ["土", "tǔ", "has the longer horizontal at the bottom instead of the top"],
        ["士", "shì", "has the longer horizontal on top instead of the bottom"],
        ["工", "gōng", "has a vertical that stops at the top horizontal instead of crossing it"],
    ],
    [
        ["己", "jǐ", "leaves the top left fully open instead of closing it"],
        ["已", "yǐ", "closes the top left halfway instead of all the way"],
        ["巳", "sì", "closes the top left all the way instead of leaving it open"],
    ],
    [
        ["木", "mù", "has a single horizontal, with no second bar"],
        ["本", "běn", "has a short bar across the bottom of the vertical instead of a second horizontal"],
        ["未", "wèi", "has two horizontals, and the top one is shorter instead of longer"],
        ["末", "mò", "has two horizontals, and the top one is longer instead of shorter"],
    ],
    [
        ["休", "xiū", "has 木 on the right instead of 本"],
        ["体", "tǐ", "has 本 on the right instead of 木"],
    ],
    [
        ["日", "rì", "is a tall, narrow box with one bar inside and nothing on top"],
        ["曰", "yuē", "is a wide, squat box instead of a tall one"],
        ["目", "mù", "is a tall box with two bars inside instead of one, and nothing on top"],
        ["白", "bái", "has a short slanted stroke on top and one bar inside instead of two"],
        ["自", "zì", "has a short slanted stroke on top and two bars inside instead of one"],
    ],
    [
        ["千", "qiān", "starts with a slanted stroke on top instead of a flat one"],
        ["干", "gān", "has a flat top and a vertical that ends straight instead of hooking"],
        ["于", "yú", "has a flat top and a vertical that ends in a hook instead of straight"],
    ],
    [
        ["天", "tiān", "has a flat top, and nothing pokes up through it"],
        ["夭", "yāo", "starts with a slanted stroke instead of a flat one"],
        ["夫", "fū", "has the vertical poking up through the top horizontal instead of stopping under it"],
    ],
    [
        ["大", "dà", "has no dot"],
        ["太", "tài", "has a dot under the left sweep instead of at the upper right"],
        ["犬", "quǎn", "has a dot at the upper right instead of under the sweep"],
    ],
    [
        ["王", "wáng", "is just three horizontals and a vertical, with no dot"],
        ["玉", "yù", "has a dot at the lower right instead of on top"],
        ["主", "zhǔ", "has a dot on top instead of at the lower right"],
        ["壬", "rén", "starts with a slanted stroke, and its middle horizontal is the longest"],
    ],
    [
        ["刀", "dāo", "keeps the sweep under the hooked stroke's top instead of poking through"],
        ["力", "lì", "has the sweep poking up through the top instead of staying under it"],
        ["刃", "rèn", "has an extra dot beside the sweep"],
    ],
    [
        ["午", "wǔ", "has a vertical that stops at the top horizontal instead of poking through"],
        ["牛", "niú", "has a vertical that pokes up through the top horizontal instead of stopping"],
    ],
    [
        ["田", "tián", "keeps the vertical inside the box instead of poking out"],
        ["由", "yóu", "has the vertical poking out the top only, not the bottom"],
        ["甲", "jiǎ", "has the vertical poking out the bottom only, not the top"],
        ["申", "shēn", "has the vertical poking out the top and the bottom"],
    ],
    [
        ["免", "miǎn", "has no dot"],
        ["兔", "tù", "has a dot at the lower right"],
    ],
    [
        ["鸟", "niǎo", "has a dot inside the top"],
        ["乌", "wū", "has no dot inside the top"],
    ],
    [
        ["今", "jīn", "ends with a short bar and a turning stroke, with no short vertical below"],
        ["令", "lìng", "ends with a short vertical under the turning stroke instead of a short bar above it"],
    ],
    [
        ["母", "mǔ", "has two dots inside instead of a slanted stroke"],
        ["毋", "wú", "has one slanted stroke through the middle instead of two dots"],
    ],
    [
        ["失", "shī", "has the vertical poking up through the top"],
        ["矢", "shǐ", "starts with a short slanted stroke, and nothing pokes through the top"],
    ],
    [
        ["侯", "hóu", "has no short vertical after the person radical"],
        ["候", "hòu", "has a short vertical between the person radical and the right side"],
    ],
    [
        ["准", "zhǔn", "has two dots on the left (冫) instead of three"],
        ["淮", "huái", "has three dots on the left (氵) instead of two"],
    ],
    [
        ["冶", "yě", "has two dots on the left (冫) instead of three"],
        ["治", "zhì", "has three dots on the left (氵) instead of two"],
    ],
    [
        ["苦", "kǔ", "has 古 under the grass instead of 右"],
        ["若", "ruò", "has 右 under the grass instead of 古"],
    ],
    [
        ["折", "zhé", "has 扌 on the left and a plain 斤 on the right"],
        ["拆", "chāi", "has an extra dot under 斤"],
        ["析", "xī", "has 木 on the left instead of 扌"],
    ],
    [
        ["问", "wèn", "has 口 inside the door instead of 日"],
        ["间", "jiān", "has 日 inside the door instead of 口"],
    ],
    [
        ["买", "mǎi", "has nothing on top"],
        ["卖", "mài", "has a 十 on top"],
    ],
    [
        ["坏", "huài", "has 土 on the left instead of 忄"],
        ["怀", "huái", "has 忄 on the left instead of 土"],
    ],
    [
        ["历", "lì", "has 力 inside 厂 instead of 万"],
        ["厉", "lì", "has 万 inside 厂 instead of 力"],
    ],
    [
        ["风", "fēng", "has ㄨ inside instead of 又"],
        ["凤", "fèng", "has 又 inside instead of ㄨ"],
    ],
    [
        ["处", "chù", "has 夂 on the left instead of 夕"],
        ["外", "wài", "has 夕 on the left instead of 夂"],
    ],
    [
        ["了", "le", "has no horizontal"],
        ["子", "zǐ", "has a horizontal across the middle"],
    ],
    [
        ["予", "yǔ", "ends in the hooked vertical, with no extra stroke"],
        ["矛", "máo", "has an extra slanted stroke at the lower left"],
    ],
];

/** char → its group (the group's members, the char itself included). */
const LOOKALIKES: ReadonlyMap<string, readonly LookalikeChar[]> = (() => {
    const map = new Map<string, LookalikeChar[]>();
    for (const group of GROUPS) {
        const members = group.map(([char, pinyin, tell]) => ({ char, pinyin, tell }));
        for (const m of members) {
            if (map.has(m.char)) throw new Error(`lookalikes: "${m.char}" is listed in two groups`);
            map.set(m.char, members);
        }
    }
    return map;
})();

/**
 * The look-alike match when `recognized` (the recognizer's top-1 for the learner's ink)
 * is a DIFFERENT member of `target`'s group; null otherwise — including a correct
 * answer, an unlisted target, or a miss read as some unrelated character.
 */
export function findLookalike(target: string, recognized: string | null | undefined): LookalikeMatch | null {
    if (!recognized || recognized === target) return null;
    const group = LOOKALIKES.get(target);
    if (!group) return null;
    const t = group.find((m) => m.char === target);
    const r = group.find((m) => m.char === recognized);
    return t && r ? { target: t, recognized: r } : null;
}
