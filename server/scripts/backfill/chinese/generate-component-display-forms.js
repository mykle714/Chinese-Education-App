/**
 * Generate the beginner keyboard's component DISPLAY FORMS: outlines for components
 * whose standalone font glyph does not look like the component inside the characters
 * a learner actually writes.
 *
 * LAYER: build/asset generation (offline). Reads the committed source face
 * data/hanzi/NotoSansSC-VF.ttf, writes a TS module into the client tree. No database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The keyboard prints each component as a font glyph (`FONTS.hanziComponents`). For
 * ⺈ (U+2E88) that glyph is the COMPACT form — the top of 角 争 负: a tall 丿 and a
 * short 𠃌 with a long diagonal drop. Inside 你 and 尔, the commonest ⺈ characters by
 * far, the hat is WIDE and FLAT with only a small hook. A learner who drew 你's hat saw
 * a chip shaped like something else. Unicode has no separate codepoint for the flat
 * form, so no font glyph can fix it.
 *
 * So the outline is lifted straight out of a host character that shows the wanted form
 * (尔 for ⺈), in the SAME face and weight as the chips, so it sits among them as if it
 * were one more font glyph. The contours are kept at their position in the host's em
 * box — the font's own bound-component glyphs (⺈ included, y ≈ 395–843) sit high in
 * the em the same way, so the swapped chip lines up with its neighbours.
 *
 * The component's IDENTITY is unchanged: the buffer, the lookup and the matcher still
 * say ⺈. Only rendering swaps (src/components/handwriting/ComponentGlyph.tsx), and
 * the old compact glyph moves into the chip's § 6z-7 "covers" bubble.
 *
 * ⚠️ The outline is ALSO a handwriting template (§ 6z-14): a learner copies the shape
 * the chip shows, so generate-handwriting-templates.js turns each path here into stroke
 * medians (lib/outlineMedians.js). After re-running THIS script, re-run that one too,
 * or the chip and the matcher disagree about what ⺈ looks like.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-13.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PICKING CONTOURS
 *
 * A glyph's outline is a list of closed contours, not strokes, but in Noto Sans SC the
 * hat of 尔 is three contours of its own (丿, the wide 横, the hook) that never merge
 * with 小's. Each form names the host and a predicate over a contour's bounding box,
 * plus the EXACT number of contours it expects — a font update that merges or splits
 * them fails loudly here instead of shipping a half-drawn hat.
 *
 * Measured 2026-11-15 (wght 400): 尔's six contours have minY −80 (亅), 67 / 67 (the two
 * dots), and 397 / 414 / 592 (the hat). `minY > 380` takes exactly the hat.
 *
 * USAGE (host or container; tsx for the shared .ts contract, harfbuzzjs for the font)
 *   npx tsx scripts/backfill/chinese/generate-component-display-forms.js
 */
import fs from 'fs';
import path from 'path';
import hbInit from 'harfbuzzjs';
import { REPO_ROOT } from '../shared/lib/repoRoot.js';
import { MEAT_TWO_DOT_FORM, isPrivateComponent } from '../../../contracts/privateComponents.js';

const SOURCE_FONT = path.join(REPO_ROOT, 'data', 'hanzi', 'NotoSansSC-VF.ttf');
const OUTPUT_MODULE = path.join(REPO_ROOT, 'src', 'components', 'handwriting', 'componentDisplayForms.generated.ts');

/** The chips render at `WEIGHT.regular`, so the outline is cut from the 400 instance. */
const WEIGHT = 400;

/**
 * component → where its display outline comes from.
 *   host:          a character whose drawing of the component is the form to show
 *   keep:          predicate on a contour's bbox {minX, minY, maxX, maxY} (font units, y-up)
 *   expectedCount: how many contours `keep` must select
 *   centre:        move the cut so it is centred on the ideographic em (500, 380).
 *                  For a component whose FONT glyph fills the em (卯), or that has no
 *                  font glyph at all (U+E000): left where the host has it, the outline
 *                  would hug one corner of the chip. ⺈ stays put — the font's own ⺈
 *                  sits high in the em too, so the flat hat already lines up.
 */
const DISPLAY_FORMS = [
    { component: '⺈', host: '尔', keep: (box) => box.minY > 380, expectedCount: 3, centre: false },
    // 留's top half (97% of 卯's weight in discoverable words, 2026-11-15). Its seven
    // contours have minY 369–718; 田's four top out at maxY 340.
    { component: '卯', host: '留', keep: (box) => box.minY > 360, expectedCount: 7, centre: true },
    // § 6z-15: the private-use two-dot ⺼ (U+E000), which no font has, cut from 然's
    // top-left. Five contours — 丿, the bar and the downstroke of ㇇, two dots — all
    // inside maxX < 530 and minY > 150 (犬 starts at minX 398 but reaches maxX ≥ 735;
    // 灬 sits below minY 150). Measured 2026-11-15.
    { component: MEAT_TWO_DOT_FORM, host: '然', keep: (box) => box.maxX < 530 && box.minY > 150, expectedCount: 5, centre: true },
];

/** Centre of the ideographic em box (0 … 1000 × −120 … 880) — where a full glyph's middle sits. */
const EM_CENTRE_X = 500;
const EM_CENTRE_Y = 380;

/**
 * A component as a TS object key. A private-use codepoint is invisible in an editor and
 * a diff, so it is written as its `\uXXXX` escape instead of the raw character.
 */
function keyLiteral(component) {
    if (!isPrivateComponent(component)) return JSON.stringify(component);
    return `'\\u${component.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}'`;
}

/** Bounding box of one SVG contour from harfbuzz (absolute M/L/Q/C/Z commands only). */
function contourBox(contour) {
    const numbers = (contour.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const xs = numbers.filter((_, index) => index % 2 === 0);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * Shift every x by `dx` and every y by `dy`, and round every coordinate to an integer font unit (1/1000 em —
 * invisible at chip sizes). harfbuzz emits absolute x,y pairs only, so the numbers
 * alternate x, y and every odd one is a y.
 */
function shiftAndRoundPath(contour, dx = 0, dy = 0) {
    let position = 0;
    return contour.replace(/-?\d+(?:\.\d+)?/g, (value) => {
        const isY = position++ % 2 === 1;
        return String(Math.round(Number(value) + (isY ? dy : dx)));
    });
}

async function generateComponentDisplayForms() {
    if (!fs.existsSync(SOURCE_FONT)) {
        throw new Error(`Source font missing: ${SOURCE_FONT} — it is committed; restore it from git.`);
    }
    const hb = await hbInit;
    const face = hb.createFace(hb.createBlob(fs.readFileSync(SOURCE_FONT)), 0);
    const font = hb.createFont(face);
    font.setVariations({ wght: WEIGHT });

    const entries = [];
    for (const form of DISPLAY_FORMS) {
        // Shape the host to get its glyph id (cmap lookup through the shaper).
        const buffer = hb.createBuffer();
        buffer.addText(form.host);
        buffer.guessSegmentProperties();
        hb.shape(font, buffer);
        const glyphId = buffer.json()[0]?.g;
        buffer.destroy();
        if (!glyphId) throw new Error(`${form.host} is not in ${path.basename(SOURCE_FONT)}`);

        const contours = font.glyphToPath(glyphId).split(/(?=M)/).filter(Boolean);
        const kept = contours.filter((contour) => form.keep(contourBox(contour)));
        if (kept.length !== form.expectedCount) {
            throw new Error(
                `${form.component} from ${form.host}: expected ${form.expectedCount} contours, ` +
                `selected ${kept.length} of ${contours.length}. The font changed — re-measure the predicate.`
            );
        }
        let dx = 0;
        let dy = 0;
        if (form.centre) {
            const boxes = kept.map(contourBox);
            const minX = Math.min(...boxes.map((box) => box.minX));
            const maxX = Math.max(...boxes.map((box) => box.maxX));
            const minY = Math.min(...boxes.map((box) => box.minY));
            const maxY = Math.max(...boxes.map((box) => box.maxY));
            dx = EM_CENTRE_X - (minX + maxX) / 2;
            dy = EM_CENTRE_Y - (minY + maxY) / 2;
        }
        entries.push({
            component: form.component,
            host: form.host,
            path: kept.map((contour) => shiftAndRoundPath(contour, dx, dy)).join(''),
        });
        console.log(`  ${form.component} ← ${form.host}: ${kept.length} of ${contours.length} contours`);
    }
    font.destroy();
    face.destroy();

    const body = entries
        .map((entry) => `  // Cut from ${entry.host}.\n  ${keyLiteral(entry.component)}: ${JSON.stringify(entry.path)},`)
        .join('\n');
    const hosts = entries.map((entry) => `  ${keyLiteral(entry.component)}: ${JSON.stringify(entry.host)},`).join('\n');
    const source = `// GENERATED by server/scripts/backfill/chinese/generate-component-display-forms.js — do not edit.
// Spec: docs/BEGINNER_KEYBOARD.md § 6z-13. Source: data/hanzi/NotoSansSC-VF.ttf at wght ${WEIGHT} (SIL OFL 1.1).
//
// component → SVG path in FONT UNITS: a ${face.upem}-unit em, y-UP, baseline at y = 0.
// Rendered by ComponentGlyph.tsx, which flips it into the em box the font glyphs use.

export const COMPONENT_DISPLAY_PATHS: Readonly<Record<string, string>> = {
${body}
};

// component → the host character its outline was cut from. Not read by the client UI:
// generate-handwriting-templates.js uses it to cut the SAME component's hanzi-writer
// strokes out of the same host as the stroke-order guide for § 6z-14.
export const COMPONENT_DISPLAY_HOSTS: Readonly<Record<string, string>> = {
${hosts}
};
`;
    fs.writeFileSync(OUTPUT_MODULE, source);
    console.log(`\n✅ Wrote ${path.relative(REPO_ROOT, OUTPUT_MODULE)}`);
    console.log('   Now re-run generate-handwriting-templates.js so the matcher learns the new outline (§ 6z-14).');
}

generateComponentDisplayForms()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Display-form generation failed:', err);
        process.exit(1);
    });
