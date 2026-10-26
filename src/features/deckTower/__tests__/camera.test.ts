import { describe, expect, it } from "vitest";
import { dimetricView, faceAffine, makeCameraProjector, makeProjector } from "../iso";
import { studyCameraView } from "../towerCamera";
import { CARD_D, CARD_W, TOWER_LAYOUT } from "../towerPlatforms";

const UNIT = 20;
const SAMPLES = [
    { x: 0, y: 0, z: 0 },
    { x: 11, y: 0, z: 0 },
    { x: 0, y: 11, z: -1.5 },
    { x: 5.5, y: 5.5, z: 40 },
    { x: 3.1, y: 2.2, z: 0.12 },
];

describe("makeCameraProjector (docs/ISO_ART_FRAMEWORK.md § The camera)", () => {
    it("reproduces the fixed dimetric projector exactly at dimetricView", () => {
        const fixed = makeProjector(UNIT);
        const camera = makeCameraProjector(dimetricView(UNIT, { x: 5.5, y: 5.5, z: 0 }));
        for (const p of SAMPLES) {
            const a = fixed.project(p.x, p.y, p.z);
            const b = camera.project(p.x, p.y, p.z);
            expect(b.x).toBeCloseTo(a.x, 6);
            expect(b.y).toBeCloseTo(a.y, 6);
            expect(camera.scaleAt(p.x, p.y, p.z)).toBeCloseTo(UNIT, 6);
        }
        expect(camera.unit).toBeCloseTo(UNIT, 6);
    });

    it("keeps faceAffine identical to the old hard-coded fixed-view matrix", () => {
        const m = faceAffine(makeProjector(UNIT), 2, { x: 4, y: 7 });
        const o = makeProjector(UNIT).project(0, 0, 2);
        expect(m.a).toBeCloseTo(UNIT, 9);
        expect(m.b).toBeCloseTo(UNIT / 2, 9);
        expect(m.c).toBeCloseTo(-UNIT, 9);
        expect(m.d).toBeCloseTo(UNIT / 2, 9);
        expect(m.e).toBeCloseTo(o.x, 9);
        expect(m.f).toBeCloseTo(o.y, 9);
    });
});

describe("studyCameraView (docs/DECK_TOWER.md § Studying the tower)", () => {
    const card = TOWER_LAYOUT.card;
    const frame = { left: 40, top: 160, width: 300, height: (300 * CARD_D) / CARD_W };

    it("starts on the page's own dimetric frame", () => {
        const fixed = makeProjector(UNIT);
        const camera = makeCameraProjector(studyCameraView(0, { unit: UNIT, card, topZ: 5, frame, bobY: -4 }));
        for (const p of SAMPLES) {
            expect(camera.project(p.x, p.y, p.z).x).toBeCloseTo(fixed.project(p.x, p.y, p.z).x, 6);
            expect(camera.project(p.x, p.y, p.z).y).toBeCloseTo(fixed.project(p.x, p.y, p.z).y, 6);
        }
    });

    it("lands the top face on the frame at e = 1 (shifted by the frozen bob)", () => {
        const topZ = 3.6;
        const bobY = -5;
        const camera = makeCameraProjector(studyCameraView(1, { unit: UNIT, card, topZ, frame, bobY }));
        const tl = camera.project(card.x, card.y, topZ);
        const br = camera.project(card.x + card.w, card.y + card.d, topZ);
        expect(tl.x).toBeCloseTo(frame.left, 6);
        expect(tl.y + bobY).toBeCloseTo(frame.top, 6);
        expect(br.x).toBeCloseTo(frame.left + frame.width, 6);
        expect(br.y + bobY).toBeCloseTo(frame.top + frame.height, 6);
    });

    it("hides everything under the top card behind it (head-on)", () => {
        const topZ = 3.6;
        const camera = makeCameraProjector(studyCameraView(1, { unit: UNIT, card, topZ, frame, bobY: 0 }));
        const tl = camera.project(card.x, card.y, 0);
        const br = camera.project(card.x + card.w, card.y + card.d, 0);
        expect(tl.x).toBeGreaterThan(frame.left);
        expect(tl.y).toBeGreaterThan(frame.top);
        expect(br.x).toBeLessThan(frame.left + frame.width);
        expect(br.y).toBeLessThan(frame.top + frame.height);
    });
});
