/**
 * shadeHex — the tower style's wall shading (docs/ISO_ART_FRAMEWORK.md § "Palette"). Lives
 * in theme/ rather than the iso kit because tower-style surfaces outside the scene use it
 * too: the game break's plates and the Match Speed slab (theme/towerSlab.ts).
 *
 * Depended on by: src/features/deckTower/iso/palette.ts (re-exports both), towerSlab.ts,
 * src/timeOfDay/wash.ts,
 * features/flashcards/FlashcardsLearnPage/gameBreak/GameBreakCard.tsx.
 */

/** Hex → [h 0–360, s 0–1, l 0–1]. */
function hexToHsl(hex: string): [number, number, number] {
    const n = parseInt(hex.replace("#", ""), 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const dlt = max - min;
    const s = l > 0.5 ? dlt / (2 - max - min) : dlt / (max + min);
    let h: number;
    if (max === r) h = (g - b) / dlt + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / dlt + 2;
    else h = (r - g) / dlt + 4;
    return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] =
        h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
        h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Darkens (amount > 0) or lightens (amount < 0) a hex by moving its HSL lightness,
 * nudging saturation UP as it darkens. Plain mixing toward ink would grey the walls
 * out; the style's walls stay saturated (a darker ORANGE, not a muddier yellow).
 */
export function shadeHex(hex: string, amount: number): string {
    const [h, s, l] = hexToHsl(hex);
    const nl = Math.min(1, Math.max(0, l - amount));
    const ns = Math.min(1, s + Math.max(0, amount) * 0.35);
    return hslToHex(h, ns, nl);
}

/**
 * Blends hex `a` toward hex `b` by `t` (0 = a, 1 = b), channel by channel in sRGB. Used
 * for colours that change continuously (the Deck Tower's sky → space backdrop); the two
 * ends share a hue there, so plain RGB mixing does not grey out in the middle.
 */
export function mixHex(a: string, b: string, t: number): string {
    const na = parseInt(a.replace("#", ""), 16);
    const nb = parseInt(b.replace("#", ""), 16);
    const u = Math.min(1, Math.max(0, t));
    const ch = (shift: number) => {
        const ca = (na >> shift) & 255;
        const cb = (nb >> shift) & 255;
        return Math.round(ca + (cb - ca) * u).toString(16).padStart(2, "0");
    };
    return `#${ch(16)}${ch(8)}${ch(0)}`;
}
