import { describe, expect, it } from "vitest";
import { hiddenBehind, insideRoundedRect, seededRandom } from "../iso";
import { BURN_MARK_RADIUS, insetRect } from "../iso";
import { MAX_BURNS, NO_LIGHTNING, STRIKE_HIT_RADIUS, pickStrikePoint, scorchFits, struckPawn, withStrike } from "../towerLightning";
import { TOWER_LAYOUT } from "../towerPlatforms";

/** Open walkable floor right of the tower, where a whole scorch fits. */
const OPEN = { x: 9.6, y: 5 };

describe("towerLightning", () => {
    it("only strikes where the whole scorch fits on walkable, visible floor", () => {
        const rnd = seededRandom(7);
        const tower = { rect: TOWER_LAYOUT.card, zTop: 1 };
        const R = BURN_MARK_RADIUS;
        for (let i = 0; i < 500; i++) {
            const at = pickStrikePoint(rnd);
            expect(at).not.toBeNull();
            if (!at) continue;
            // The mark's full radius stays inside the walkable area…
            expect(insideRoundedRect(at, insetRect(TOWER_LAYOUT.roam.area, R))).toBe(true);
            // …and clear of the tower, the lever's hatch and the plate.
            for (const r of [...TOWER_LAYOUT.roam.obstacles, TOWER_LAYOUT.labelPlate]) {
                expect(insideRoundedRect(at, insetRect(r, -R))).toBe(false);
            }
            expect(hiddenBehind(at.x, at.y, tower)).toBe(false);
        }
    });

    it("leaves no burn where the scorch would not fit (an aimed tester strike)", () => {
        const nearTower = { x: TOWER_LAYOUT.card.x + TOWER_LAYOUT.card.w + 0.5, y: TOWER_LAYOUT.card.y + 2 };
        expect(scorchFits(nearTower)).toBe(false);
        const w = withStrike(NO_LIGHTNING, { id: 1, at: nearTower }, 4);
        expect(w.burns).toHaveLength(0);
        expect(w.crispyPawns).toEqual([4]);
    });

    it("hits the nearest floor pawn within the radius, and no pawn off the floor", () => {
        const at = { x: 9, y: 7 };
        expect(struckPawn(at, [{ key: 1, spot: { x: 9 + STRIKE_HIT_RADIUS * 0.9, y: 7 } }])).toBe(1);
        expect(struckPawn(at, [{ key: 1, spot: { x: 9 + STRIKE_HIT_RADIUS * 1.1, y: 7 } }])).toBeNull();
        expect(struckPawn(at, [{ key: 1, spot: null }])).toBeNull();
        expect(
            struckPawn(at, [
                { key: 1, spot: { x: 9.5, y: 7 } },
                { key: 2, spot: { x: 9.1, y: 7 } },
            ]),
        ).toBe(2);
    });

    it("records burns (capped), and makes a struck pawn crispy with its shock id", () => {
        let w = NO_LIGHTNING;
        for (let id = 1; id <= MAX_BURNS + 5; id++) w = withStrike(w, { id, at: OPEN }, null);
        expect(w.burns).toHaveLength(MAX_BURNS);
        expect(w.burns[0].id).toBe(6);
        expect(w.crispyPawns).toEqual([]);
        w = withStrike(w, { id: 99, at: OPEN }, 3);
        w = withStrike(w, { id: 100, at: OPEN }, 3);
        expect(w.crispyPawns).toEqual([3]);
        expect(w.shockIds[3]).toBe(100);
    });
});
