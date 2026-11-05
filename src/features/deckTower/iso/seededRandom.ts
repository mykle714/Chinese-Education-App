/**
 * seededRandom.ts — mulberry32, a tiny deterministic PRNG: the same seed always yields the
 * same sequence, so a randomised shape (a burn mark's outline, a bolt's zig-zag) draws the
 * same on every render and remount.
 *
 * Depended on by: IsoBurnMark.tsx, IsoLightningBolt.tsx. (StarField.tsx, SpeedLines.tsx and
 * fogClouds.ts each still carry their own copy — candidates to switch over.)
 */
export function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
