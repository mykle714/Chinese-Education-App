import { CARD_THICKNESS, fallFromSky, plateLaunchApexMs, POKE_JUMP_HEIGHT, SKY_FALL_HEIGHT } from "../../features/deckTower/iso";
import { fallMs, fallParams, pawnGravity, type FallType } from "../../theme/gravity";
import { TRAP_DOOR } from "../../features/deckTower/deckTransitions";
import { PLATE_POP_SETTLE_MS, plateSettleMs } from "../../features/deckTower/useDeckSwap";
import { launchFall } from "../../features/deckTower/launch/launchDrop";

/**
 * gravityTimings.ts — /gravity-lab's readout: how long each fall in the iso world takes at
 * each fall type's parameters in force (src/theme/gravity.ts → `fallParams(type)`: gravity,
 * start speed, jerk), plus the timing rules they must not break.
 *
 * Layer: page logic (dev lab). Pure apart from reading the knobs THROUGH the real
 * production functions — every number here comes from the same code the Deck Tower runs
 * (`fallFromSky`, `TRAP_DOOR.plan`, gravity.ts → `fallMs`, `plateLaunchApexMs`, `plateSettleMs`), so
 * the table cannot drift from the app. Call it on every render after the lab's
 * `useGravityVersion()` subscription. The pawn's upward
 * throws (plate launch, poke) are set by height and ignore start speed and jerk.
 *
 * The launch screen's row uses the cover's own drop geometry (launch/launchDrop.ts →
 * `launchFall`) for an iPhone 16-tall cover. Not listed: the flp hint pawn's drop (HintPawn.tsx → `hintPawnDrop`, `fallFromHeight` from a per-arrival height).
 *
 * Docs: docs/GRAVITY_LAB.md § "Timings and checks".
 */

export interface GravityTimingRow {
    /** The fall type the row's timing comes from (`pawn` = the pawn's throws, on the sky fall's gravity). */
    type: FallType | "pawn";
    /** What falls. */
    effect: string;
    /** Which case of it (the distance, the tower size). */
    detail: string;
    ms: number;
}

export interface GravityCheck {
    rule: string;
    ok: boolean;
    /** The numbers behind the verdict. */
    detail: string;
}

/** Card counts the trap door rows are sampled at. */
const SAMPLE_TOWERS = [20, 100, 400] as const;
/** A sky drop's lift: DeckTowerPage → DROP_MIN_LIFT (the shortest drop), and a typical phone screen's worth. */
const SAMPLE_DROP_LIFTS = [8, 40] as const;
/**
 * The trap door's fall distance for a tower of `cards`: its height plus the platform and
 * clearance below it, roughly as DeckTowerPage → `fitScene` measures it on a phone.
 * Approximate on purpose — the row is a feel for scale; the stage measures its own exactly.
 */
const trapDistanceFor = (cards: number) => cards * CARD_THICKNESS + 12;
/** The launch screen's cover on an iPhone 16 (its full screen height, CSS px). */
const LAUNCH_COVER_PX = 852;

/** A throw up and back down to `height`: constant gravity only — start speed and jerk are fall knobs, not throw knobs. */
const freeFallMs = (height: number, g: number) => Math.sqrt((2 * height) / g) * 1000;

export function gravityTimings(): { rows: GravityTimingRow[]; checks: GravityCheck[] } {
    const g = pawnGravity();
    const skyFall = fallFromSky();
    // The shortest swap the trap door can make (a zero-length fall): its ready beat is the
    // floor the sky fall's landing must stay under (pawnEntrances.ts → "Ceiling").
    const shortestTrapReady = TRAP_DOOR.plan({ fallDistance: 0 }).readyMs;
    const apexMs = plateLaunchApexMs(g);
    const collapse = fallParams("collapse");
    const skyDrop = fallParams("skyDrop");

    const rows: GravityTimingRow[] = [
        { type: "pawn", effect: "Plate launch", detail: "release → apex (2.4 u)", ms: apexMs },
        { type: "pawn", effect: "Poke jump", detail: `up and back down (${POKE_JUMP_HEIGHT} u)`, ms: 2 * freeFallMs(POKE_JUMP_HEIGHT, g) },
        { type: "skyFall", effect: "Sky fall", detail: `${SKY_FALL_HEIGHT} u → floor`, ms: skyFall.landMs },
        ...SAMPLE_TOWERS.map((cards) => {
            const plan = TRAP_DOOR.plan({ fallDistance: trapDistanceFor(cards) });
            return { type: "trapDoor" as const, effect: "Tower falls", detail: `${cards} cards (whole swap ${Math.round(plateSettleMs() + plan.durationMs)} ms)`, ms: plan.clearedMs };
        }),
        ...SAMPLE_DROP_LIFTS.map((lift) => ({ type: "skyDrop" as const, effect: "Tower lands", detail: `${lift} u lift`, ms: fallMs(lift, skyDrop) })),
        { type: "collapse", effect: "Run settles", detail: "1 card gap", ms: fallMs(CARD_THICKNESS, collapse) },
        { type: "collapse", effect: "Run settles", detail: "70 card gap", ms: fallMs(70 * CARD_THICKNESS, collapse) },
        { type: "launchScreen", effect: "Pawn drop", detail: `iPhone 16 (${launchFall(LAUNCH_COVER_PX).units.toFixed(1)} u)`, ms: fallMs(launchFall(LAUNCH_COVER_PX).units, fallParams("launchScreen")) },
    ];

    const checks: GravityCheck[] = [
        {
            rule: "Sky fall lands before the trap door's ready beat",
            ok: skyFall.landMs < shortestTrapReady,
            detail: `${Math.round(skyFall.landMs)} ms vs ${Math.round(shortestTrapReady)} ms — else the new pawn pops in mid-fall`,
        },
        {
            rule: "Plate launch peaks inside the plate's own settle",
            ok: apexMs <= PLATE_POP_SETTLE_MS,
            detail: `${Math.round(apexMs)} ms vs ${PLATE_POP_SETTLE_MS} ms — past it, every deck swap waits for the pawn's apex (sky fall gravity)`,
        },
    ];
    return { rows, checks };
}
