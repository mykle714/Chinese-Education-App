import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";
import type { Language, VocabEntry } from "../../types";
import Bubble from "../bubbles/Bubble";
import { stepPhysics, planSpawn, fillRatio, clampHeldCenter, type Bounds } from "../bubbles/physics";
import { GameHud, GameHudBar, GameHudLabel } from "../shared/GameFrame";
import { makePair, launchBody } from "../bubbles/bodyFactory";
import type { BubbleBody, BubbleFill } from "../bubbles/types";
import {
    MAX_DT,
    CANCEL_ZONE_HEIGHT,
    SCALE_IDLE,
    SCALE_HELD,
    SCALE_HOVER,
    SCALE_LERP,
    DANGER_FILL_RATIO,
    LOSE_FILL_RATIO,
    POP_DURATION_MS,
    WRONG_FEEDBACK_MS,
    POST_DONE_SETTLE_MS,
} from "../bubbles/constants";
import { PAYOUT_BY_COLOR, DRAIN_ONLY_FILL, rollColor } from "./spawnTable";
import { planSpawnBatch, type HydraBoardPair } from "./spawnPlanner";
import { OPENING_DEFINITION_BUBBLES, SCORE_PER_MATCH } from "./constants";
import type { HydraCard, HydraColor, HydraOutcome } from "./types";
import type { ColorBuffers } from "./useColorBuffers";

/**
 * Hydra Bubbles — the playfield (docs/HYDRA_BUBBLES.md).
 *
 * Its own stage rather than Bubble Match's, because almost none of Bubble Match's
 * field behavior applies: no launcher, no queue, no descending ceiling, no drift,
 * and a spawn planner Bubble Match has no concept of. What IS shared is the bubble
 * itself, the placement/separation math and the fill-ratio measure — all from
 * src/games/bubbles/.
 *
 * THE LOOP. Clear a pair → score +2 → the cleared bubble's COLOR buys 0–3 spawn
 * slots → the planner decides what fills them → the buffers supply cards of the
 * rolled colors. The board grows unless the player deliberately takes on their
 * hardest words. See § 3.
 *
 * Referenced by: HydraBubblesPage.tsx.
 */

/**
 * THE PAYOUT PALETTE (§ 2) — Hydra's own hues, deliberately NOT the mastery ramp.
 *
 * ⚠️ THIS IS A THREE-WAY PROBLEM, NOT A TWO-WAY ONE, and that is what the first two
 * attempts got wrong. Hydra puts THREE kinds of bubble on one field: the two payout
 * tiers and the grey English bubbles, which carry no payout meaning at all. A palette
 * that separates drain from bloom beautifully is still broken if either of them reads
 * as English.
 *
 * The history, because each step was rejected for a different reason:
 *
 *   1. THE BAND COLORS (`MARK_TYPE_COLORS`, #EF476F / #FFD166 / #05C793 / #779BE7,
 *      and the `CATEGORY_COLORS` pastels). A tier is a UNION of two bands, so wearing
 *      one band's hue lies about the other half of its contents.
 *   2. EMBER / OCEAN (#D64545 / #1B6CA8). Off the tokens, but not off the READ: the
 *      app trains a learner that red = Unfamiliar and blue = Mastered, so a red bubble
 *      still decodes as "hard card".
 *   3. CHARCOAL / GOLD (2026-08-21 → 2026-08-22). Two hues chosen precisely so neither
 *      could be mistaken for the ramp, separated on value, temperature and ring weight.
 *      It worked, and it was replaced anyway — see below.
 *
 *   4. TWO SHADES OF ONE BLUE (2026-08-22 → 2026-08-24). drain #79B3EE / bloom
 *      `COLORS.blu`. The best-separated ladder this game has had (1.80:1 between the
 *      tiers, against charcoal/gold's 1.22:1) and the only monotonic one — value was
 *      the whole message, darker meant harder. Replaced by request; see YELLOW_DRAIN
 *      for the full trade.
 *
 * ═══ THE LADDER IS NOW YELLOW / BLUE (2026-08-24) ═══
 *
 *              body                        char ink   read
 *   English    #E7E7EA  COLORS.grey        dark       inert — carries no payout info
 *   bloom      #D2EBFF  COLORS.blu         dark       net +1, the known words
 *   drain      #F5E7B4  COLORS.yel         dark       net −1, the hard words
 *
 * ALL THREE TAKE BLACK TEXT, and that is still the constraint on any replacement: the
 * two tiers are one object at two settings, and a rung whose glyphs invert to white
 * stops reading as "the same thing" and starts reading as "a different thing".
 *
 * THE CHANNEL IS HUE, and the three bodies are all at the ramp's 93–94% tier, so the
 * separations are:
 *
 *                      drain vs bloom   drain vs scenery   bloom vs scenery
 *   charcoal/gold      1.22:1           1.33:1             1.09:1
 *   blue ladder        1.80:1           1.79:1             1.00:1
 *   yellow/blue        1.16:1           1.16:1             1.00:1
 *
 * ⚠️ Read that table honestly: on VALUE this is the weakest ladder of the three, and a
 * colour-blind player has less to go on than they did with the blue pair. What carries it
 * is hue distance — hue 92 against hue 250 is the widest warm/cool split in the ramp,
 * which is a strong read for most players and no read at all for some. The lever if it
 * needs fixing is documented on YELLOW_DRAIN, and it is bloom, not drain.
 *
 * ⚠️ BLOOM AND THE SCENERY GREY ARE THE SAME VALUE (1.00:1) — `blu` and `grey` are both
 * the ramp's 93% tier, so bloom-vs-English is carried by chroma alone (a blue tint vs a
 * neutral). It is tolerable because bloom is the bubble you WANT to clear: mistaking
 * scenery for bloom costs a wasted look, not a wrong match.
 * ⚠️ With a yellow drain, lightening bloom to `bluTint` #EEF8FF no longer closes any gap
 * — drain is no longer on hue 250 — so it is now a free move that helps BOTH weak reads
 * at once (bloom off the grey, and a value gap back into the ladder). It costs a
 * near-white bubble on the white `.play` panel. That is the one lever to reach for first.
 *
 * ⚠️ THE MASTERY COLLISION IS NOW HALF WHAT IT WAS. `COLORS.blu` is EXACTLY
 * `CATEGORY_COLORS.Mastered`, and bloom is Mastered + Comfortable — so the pastel is
 * half-true rather than false, which is the best any single token can do for a union.
 * The harder claim was DRAIN's, which used to wear the saturated end of the "mastered"
 * hue while containing Unfamiliar + Target; the yellow retires that. Drain's own risk is
 * different and milder: `yel` (hue 92) sits near `org` (hue 70), which IS Target's fill,
 * and Target is genuinely half of drain — so the nearest misreading is half-true too.
 *
 * ⚠️ TONE-3 PINYIN WAS THE REAL CONSTRAINT ON THIS WHOLE FILE, AND THE YELLOW DRAIN
 * RETIRED IT for the drain rung. The measurements below are kept because they still
 * govern BLOOM (hue 250) and any future move back onto a blue axis.
 * A word bubble renders tone-colored pinyin (`TONE_COLORS`), tone 3 is #779BE7 — a light
 * blue at roughly oklch 68% — and its contrast against a hue-250 body is worst exactly in
 * the MIDDLE of the lightness range:
 *
 *   drain body                          tone 3
 *   #5E9DDC  oklch 68%                  1.04:1   invisible
 *   #79B3EE  oklch 75%  (shipped)       1.25:1   very weak
 *   #CBC9D2  the charcoal that shipped  1.68:1
 *   #1F6CB0  bluA, oklch 52%            1.99:1
 *
 * Both ENDS beat the middle, and "light enough for black text" lands in the middle. So
 * the ladder trades tone-3 pinyin legibility for uniform black glyphs — an explicit
 * choice, since the glyph is what the player is drilling and the pinyin is a crutch on a
 * toggle (the header's `pinyin` chip).
 *
 * ⚠️ The overlay cannot be recolored to escape this: `ForeignText.characterColor` is
 * documented to leave the tone overlay alone, and `TONE_COLORS` are design-owned
 * literals. THE ONLY REAL FIX IS TO LEAVE HUE 250 — a ladder on purple (hue 300,
 * `COLORS.pur`/`purA`) has no tone color anywhere near it and would free the whole
 * lightness range. Teal (195) does not help: tone 2 #05C793 sits next to it.
 */
/**
 * The two rungs: `COLORS.yel` for drain, `COLORS.blu` for bloom.
 *
 * ═══ THE DARK BLUE IS GONE (2026-08-24) ═══
 *
 * Drain used to be `BLUE_DARK` #79B3EE — oklch(75% 0.105 250), a NON-token authored
 * between `blu` (93%) and `bluA` (52%) so that a "two shades of one hue" ladder could
 * keep black text on both rungs. It was replaced with a light yellow by request, and the
 * ladder is two HUES again rather than two values. What that trades, plainly:
 *
 *   LOST — the monotonic value read ("darker is harder"). All three bodies now sit at the
 *          ramp's 93–94% tier, so drain-vs-bloom and drain-vs-scenery are carried by hue
 *          and chroma alone. This is the same weakness the charcoal/gold pair had, and it
 *          is weakest for a colour-blind player. The room to fix it is in BLOOM, not
 *          drain: `COLORS.bluTint` #EEF8FF opens a value gap against both the yellow and
 *          the grey, at the cost of a near-white bubble on the white `.play` panel. That
 *          is a one-token swap on `YELLOW_LIGHT` below.
 *   WON  — tone-3 pinyin, which was "the real constraint on this whole file". Tone 3 is
 *          #779BE7, a light BLUE, and it was nearly invisible on a hue-250 body (1.25:1
 *          on the old drain). On a hue-92 yellow it is separated by hue instead of
 *          fighting for value, so the drain bubble's pinyin is legible for the first time.
 *   WON  — the mastery collision on the harder rung. `COLORS.blu` IS
 *          `CATEGORY_COLORS.Mastered`, so the old drain wore the saturated end of the hue
 *          the app trains as "mastered" while containing Unfamiliar + Target. Drain no
 *          longer makes that claim; bloom's half-true one is unchanged.
 *
 * `COLORS.yel` and not `COLORS.org`: org (hue 70) IS `CATEGORY_COLORS.Target`, and drain
 * is Unfamiliar + Target — a bubble wearing Target's exact fill would read as a band
 * label rather than as a tier. `yel` exists in the ramp precisely to be a gold that is
 * not Target's orange (see its comment in theme/colors.ts).
 *
 * BOTH RUNGS STILL TAKE BLACK TEXT, which remains the constraint on any replacement: the
 * two tiers must be one object at two settings, and a rung whose glyphs invert to white
 * reads as a different KIND of object. `inkOnFill` derives that automatically, so a
 * future swap cannot strand dark text on a dark body.
 */
const YELLOW_DRAIN = COLORS.yel;  // #F5E7B4 — drain: harder words, higher cost
const BLUE_LIGHT = COLORS.blu;    // #D2EBFF — bloom: known words, pays out

/**
 * Bubble fills — a FLAT body, border color == body color.
 *
 * The bubble is the one place in the app where color is not decoration: the player
 * reads the payout tier straight off it while bubbles are moving (§ 2). The border is
 * the body color because the shared `Bubble` draws a fixed 2px border on every bubble
 * in both games — a same-color border is how a bubble reads as ringless without
 * changing its border box. (Hydra used to pair a pastel body with a saturated 3px ring,
 * so ring WEIGHT was a third separation channel; that went on 2026-08-22 when the two
 * bubble games were unified on one style, Bubble Match being the reference —
 * docs/SHELF_REDESIGN.md § 12/16. The blue ladder above buys back far more separation
 * than the ring ever carried.)
 */
const FILL_BY_COLOR: Record<HydraColor, BubbleFill> = {
    drain: { bg: YELLOW_DRAIN, border: YELLOW_DRAIN },
    bloom: { bg: BLUE_LIGHT, border: BLUE_LIGHT },
};

/**
 * English bubbles carry NO payout information — the color channel is reserved for the
 * two tiers (§ 2).
 *
 * IT IS BUBBLE MATCH'S INERT GREY (2026-08-22). Both bubble games now draw their
 * definition bubble in the same `COLORS.grey` token, which is the last piece of the
 * one-bubble-two-palettes unification: the only colors that differ between the two
 * games are the ones that MEAN something (Bubble Match's red word bubble, Hydra's
 * drain/bloom tiers). Scenery is scenery in both.
 *
 * The border is the body color because the shared `Bubble` draws a fixed 2px border —
 * that is how a bubble reads as ringless (see FILL_BY_COLOR).
 *
 * ⚠️ THIS UNDOES THE 2026-08-21 "MOVE THE INERT BUBBLE TO THE LIGHT END" FIX, and it
 * costs real separation. That fix had the English bubble go from grey #ECECEF to pure
 * white precisely because grey sat one value step from the drain body; going back to a
 * grey re-opens that adjacency, and the 3px ring that was the other half of the fix is
 * now gone too. Measured against the two tier bodies:
 *
 *              vs grey #E7E7EA      vs the white it replaced
 *   drain      1.33:1               1.64:1
 *   bloom      1.09:1               1.34:1
 *
 * Bloom is the one to watch: gold #F4DD98 and grey #E7E7EA are within 1.1:1, i.e.
 * effectively the SAME VALUE, so "is this a payout bubble or scenery" is carried by
 * hue and chroma alone — warm saturated vs achromatic. That reads fine for most
 * players and not at all for a color-blind one.
 *
 * IF IT NEEDS FIXING, the move is to darken the TIERS (drain as far as tone 3 tolerates,
 * bloom toward a deeper ochre), not to lighten this bubble back to white — the whole
 * point of the token is that both games' scenery is the same grey.
 */
const DEFINITION_FILL: BubbleFill = { bg: COLORS.grey, border: COLORS.grey };

const fillForBody = (body: BubbleBody, color: HydraColor | undefined): BubbleFill =>
    body.kind === "definition" ? DEFINITION_FILL : FILL_BY_COLOR[color ?? "drain"];

/** Both bubbles of one drawn card, whether or not they are currently on the field. */
interface HydraPair {
    pairId: string;
    card: HydraCard;
    word: BubbleBody;
    definition: BubbleBody;
    /**
     * Spawn rounds this card has spent as a stray, feeding the planner's aging
     * lottery (§ 4.2c). Counted HERE rather than in the planner because a "round" is a
     * spawn batch, and only the stage knows when one has happened — the planner is
     * pure and sees a single board snapshot.
     */
    strayRounds: number;
}

interface HydraStageProps {
    buffers: ColorBuffers;
    language: Language;
    showPinyin: boolean;
    showPinyinColor: boolean;
    /** Narrate a word bubble on pickup / match-onto. Undefined when autoplay is off. */
    onSpeak?: (entry: VocabEntry) => void;
    /** Bubbles cleared so far, lifted so the header and the end popup can show it. */
    onScore: (score: number) => void;
    /** A run-ending event. Hydra has no win — see HydraOutcome. */
    onGameOver: (outcome: HydraOutcome, score: number) => void;
    /** Record a recognition mark. Not called once the run is over. */
    onMark: (entry: VocabEntry, isCorrect: boolean) => void;
    /** Freeze the field while a modal covers it (§ 6.4). */
    paused: boolean;
    /**
     * Cleanup mode: the run is over and its end popup has been minimized to a puck.
     * The final board becomes a no-stakes review playground, exactly as Bubble Match
     * does post-loss (see BubbleStage's `cleanupMode`): bubbles stay draggable and
     * matchable so the player can clear the field they lost on, dragging a bubble
     * lights its correct partner green as a drop hint, a partnerless grab flags
     * light-red — and NOTHING is banked. No marks, no score, no spawn payout, and a
     * wrong drop shakes without ending anything (the run has already ended).
     */
    cleanupMode: boolean;
    /**
     * Asked after every CORRECT match: does this clear end the run?
     *
     * Exists for Study Challenge mode, where the run ends the moment the last
     * contested word is cleared and the score is time-to-clear rather than bubbles
     * (docs/HYDRA_BUBBLES.md § 7.5). The stage cannot answer that itself — it does
     * not know which words are contested, and deliberately never learns (Q74) — so
     * the page owns the predicate and the stage owns the ending.
     *
     * Absent for an ordinary run, which is endless.
     */
    shouldEndRun?: (entry: VocabEntry) => boolean;
}

let pairSeq = 0;

const HydraStage: React.FC<HydraStageProps> = ({
    buffers,
    language,
    showPinyin,
    showPinyinColor,
    onSpeak,
    onScore,
    onGameOver,
    onMark,
    paused,
    cleanupMode,
    shouldEndRun,
}) => {
    const stageRef = useRef<HTMLDivElement>(null);
    const bodiesRef = useRef<BubbleBody[]>([]);
    const pairsRef = useRef<Map<string, HydraPair>>(new Map());
    const nodeMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
    // The play area: the stage MINUS the bottom cancel strip (§ 7.1b), with a `top`
    // that never moves because Hydra has no descending ceiling. Kept as a Bounds so
    // the shared physics and planSpawn take it unchanged — which is also what keeps
    // the strip out of the fill ratio the spawn table and the loss both read.
    const boundsRef = useRef<Bounds>({ width: 0, top: 0, height: 0 });

    // Interaction.
    const heldIdRef = useRef<string | null>(null);
    const hoveredIdRef = useRef<string | null>(null);
    const grabOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const stageRectRef = useRef<DOMRect | null>(null);
    // FULL stage height, including the cancel strip. `boundsRef.height` stops at the
    // strip's top edge (that edge IS the play-area floor), so the drag needs the
    // untrimmed number to let a held bubble travel down into the strip.
    const fullHeightRef = useRef(0);
    // Purely cosmetic: tints the strip while a held bubble is over it. The release
    // path re-derives the same predicate from geometry rather than trusting this, so
    // a dropped pointer event can never make the strip lie about what a drop will do.
    const [overCancelZone, setOverCancelZone] = useState(false);
    const pausedRef = useRef(paused);
    pausedRef.current = paused;

    // Lifecycle.
    const phaseRef = useRef<"playing" | "done">("playing");
    const scoreRef = useRef(0);
    const pendingTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const rafRef = useRef(0);
    const loopRunningRef = useRef(false);
    const lastFrameRef = useRef(0);
    const doneSinceRef = useRef(0);
    // Cleanup mode (mirrors the prop, read from the ref-only pointer handlers and the
    // frame callback) plus the bubble currently green-revealed as a drop hint.
    const cleanupModeRef = useRef(cleanupMode);
    const revealedPartnerIdRef = useRef<string | null>(null);

    const [, setTick] = useState(0);
    const forceRender = useCallback(() => setTick((t) => t + 1), []);
    const [danger, setDanger] = useState(false);
    // Permanently silences the danger vignette once the board turns into a review
    // playground — the alarm has nothing left to warn about, and a pulsing red wash
    // makes the field harder to read while it is being cleared.
    const [dangerDismissed, setDangerDismissed] = useState(false);
    const [squeeze, setSqueeze] = useState(false);
    /**
     * The field's fill ratio, QUANTIZED TO 5% STEPS for the HUD bar (§ 3).
     *
     * The raw ratio changes every frame — bubbles are always settling — so storing it
     * as-is would re-render the stage 60 times a second for a 4px bar. Bucketing means
     * at most ~20 state writes across a whole run, and React bails out on the rest.
     * The physics and the spawn table keep reading the exact ratio; only the display
     * is coarse.
     */
    const [fillBucket, setFillBucket] = useState(0);
    const [score, setScore] = useState(0);

    const registerNode = useCallback((id: string, el: HTMLDivElement | null) => {
        if (el) nodeMapRef.current.set(id, el);
        else nodeMapRef.current.delete(id);
    }, []);

    const writeTransform = useCallback((b: BubbleBody) => {
        const node = nodeMapRef.current.get(b.id);
        if (!node) return;
        // The node is laid out at full size; the grow-in is a scale, so the translate
        // offset is by targetRadius (never the animating radius) to keep the visual
        // center pinned at (x, y).
        const grow = b.targetRadius > 0 ? b.radius / b.targetRadius : 1;
        node.style.transform =
            `translate(${b.x - b.targetRadius}px, ${b.y - b.targetRadius}px) scale(${grow * b.scale})`;
    }, []);

    // ---- Board queries ------------------------------------------------------
    const onField = useCallback(
        (body: BubbleBody) => bodiesRef.current.some((b) => b.id === body.id),
        []
    );

    /** The planner's view of the board — presence per card, plus the live fill. */
    const boardView = useCallback((): { fill: number; pairs: HydraBoardPair[] } => {
        const pairs: HydraBoardPair[] = [];
        for (const pair of pairsRef.current.values()) {
            const hasWord = onField(pair.word);
            const hasDefinition = onField(pair.definition);
            // A card with neither half on the board is finished; leaving it in the
            // view would let the planner "complete" a pair the player already cleared.
            if (!hasWord && !hasDefinition) continue;
            pairs.push({
                pairId: pair.pairId,
                color: pair.card.color,
                hasWord,
                hasDefinition,
                unmatchedRounds: pair.strayRounds,
            });
        }
        return { fill: fillRatio(bodiesRef.current, boundsRef.current), pairs };
    }, [onField]);

    // ---- Spawning -----------------------------------------------------------
    /** Place one body: pick a spot under the 20% rule, then let it grow in. */
    const place = useCallback((body: BubbleBody) => {
        const { x, y } = planSpawn(body.targetRadius, boundsRef.current, bodiesRef.current);
        launchBody(body, x, y);
        bodiesRef.current.push(body);
    }, []);

    /**
     * Draw a card of `color` and register both its bubbles. Returns null only when
     * the color could not be supplied even after waiting — the caller skips that slot
     * rather than stalling the run (§ 6.2b).
     *
     * ASYNC because `buffers.draw` waits out a dry buffer instead of substituting a
     * different color. A spawn batch therefore resolves over one network round trip
     * in the worst case; the bubbles simply arrive a beat later, which on a clockless
     * game costs the player nothing.
     */
    const drawPair = useCallback(async (color: HydraColor): Promise<HydraPair | null> => {
        const card = await buffers.draw(color);
        if (!card) return null;
        const pairId = `h${pairSeq++}`;
        const [word, definition] = makePair(pairId, card.entry);
        const pair: HydraPair = { pairId, card, word, definition, strayRounds: 0 };
        pairsRef.current.set(pairId, pair);
        return pair;
    }, [buffers]);

    /**
     * Execute a planned batch (§ 4). Actions are applied IN ORDER, and cards planned
     * earlier in the batch are resolved through `plannedToReal` so a later
     * `complete` can refer to one of them.
     */
    const runSpawnBatch = useCallback(async (payout: number) => {
        // AGE THE STRAYS FIRST (§ 4.2c). One spawn batch is one "round": every card
        // still showing a single half has waited another one, and any card that is a
        // live match is reset. The planner reads these counters to decide whether a
        // slot completes an old stray instead of introducing a new card, which is what
        // stops the board silting up with orphans the player can never act on.
        for (const pair of pairsRef.current.values()) {
            const hasWord = onField(pair.word);
            const hasDefinition = onField(pair.definition);
            if (!hasWord && !hasDefinition) continue; // finished card; about to be dropped
            pair.strayRounds = hasWord === hasDefinition ? 0 : pair.strayRounds + 1;
        }

        const actions = planSpawnBatch(boardView(), payout);
        const plannedToReal = new Map<string, string>();

        for (const action of actions) {
            // The batch AWAITS buffer refills, so the run can end (overflow loss in
            // the rAF loop, or a teardown for Play Again) between two slots. Placing
            // the remaining bubbles then drops them onto a board that is already
            // frozen and scored. Re-checked every slot rather than once up front,
            // because each `drawPair` below is another suspension point.
            if (phaseRef.current !== "playing") return;
            if (action.type === "complete") {
                const pairId = plannedToReal.get(action.pairId) ?? action.pairId;
                const pair = pairsRef.current.get(pairId);
                if (!pair) continue; // stale plan — the pair left the board; skip the slot
                const body = action.kind === "word" ? pair.word : pair.definition;
                if (!onField(body)) place(body);
                continue;
            }

            const pair = await drawPair(action.color);
            if (phaseRef.current !== "playing") return;
            if (!pair) continue; // color unsupplied even after waiting — skip the slot
            plannedToReal.set(action.plannedId, pair.pairId);
            if (action.type === "newPair") {
                place(pair.word);
                place(pair.definition);
            } else {
                place(action.kind === "word" ? pair.word : pair.definition);
            }
        }

        buffers.topUp();
        forceRender();
    }, [boardView, drawPair, place, onField, buffers, forceRender]);

    // ---- Run end ------------------------------------------------------------
    const finishRun = useCallback((outcome: HydraOutcome) => {
        if (phaseRef.current === "done") return;
        phaseRef.current = "done";
        // Force-drop anything still held so the field freezes clean and a late
        // pointerup cannot resolve a match after the run is over.
        const heldId = heldIdRef.current;
        if (heldId) {
            heldIdRef.current = null;
            const held = bodiesRef.current.find((b) => b.id === heldId);
            if (held) {
                held.status = "idle";
                held.targetScale = SCALE_IDLE;
            }
        }
        const hoveredId = hoveredIdRef.current;
        if (hoveredId) {
            const hov = bodiesRef.current.find((b) => b.id === hoveredId);
            if (hov && hov.status === "hovered") {
                hov.status = "idle";
                hov.targetScale = SCALE_IDLE;
            }
            hoveredIdRef.current = null;
        }
        forceRender();
        onGameOver(outcome, scoreRef.current);
    }, [onGameOver, forceRender]);

    // ---- rAF loop -----------------------------------------------------------
    const stepFrame = useCallback((now: number) => {
        if (pausedRef.current) {
            // Re-base the clock so the whole paused span does not arrive as one huge
            // dt on the first live frame.
            lastFrameRef.current = now;
            rafRef.current = requestAnimationFrame(stepFrame);
            return;
        }
        const dt = Math.min((now - lastFrameRef.current) / 1000, MAX_DT);
        lastFrameRef.current = now;
        const bodies = bodiesRef.current;
        const bounds = boundsRef.current;

        // No drift: Hydra's bubbles are placed and stay put (§ 1). Separation still
        // runs, so a growing bubble shoves its neighbors to make room.
        stepPhysics(bodies, dt, bounds, { drift: false });

        let anyAnimating = false;
        for (const b of bodies) {
            b.scale += (b.targetScale - b.scale) * SCALE_LERP;
            if (Math.abs(b.targetScale - b.scale) < 0.001) b.scale = b.targetScale;
            else anyAnimating = true;
            if (b.status === "growing") anyAnimating = true;
            writeTransform(b);
        }

        const ratio = fillRatio(bodies, bounds);
        if (phaseRef.current === "playing" && ratio >= LOSE_FILL_RATIO) {
            // OVERFLOW (§ 7.1). Hydra has no descending ceiling and no residual
            // safety net: the field only ever fills from spawns, and every spawn is
            // an event the player caused, so area alone is the honest signal.
            finishRun("overflow");
        }

        const bucket = Math.round(ratio * 20) / 20;
        setFillBucket((prev) => (prev === bucket ? prev : bucket));

        const isDanger = ratio >= DANGER_FILL_RATIO;
        setDanger((prev) => (prev === isDanger ? prev : isDanger));
        // The squeeze band (§ 3.1): from here the table rolls drain only.
        const inSqueeze = ratio >= DRAIN_ONLY_FILL;
        setSqueeze((prev) => (prev === inSqueeze ? prev : inSqueeze));

        // Post-run shutdown: stop writing transforms to every node once the field
        // goes static behind the end popup, with a grace cap for the over-packed
        // case that never fully settles.
        // Cleanup is the exception: bubbles must keep separating and settling as the
        // player drags and clears them, so the loop stays live for as long as the
        // review board is up.
        if (phaseRef.current === "done" && !cleanupModeRef.current) {
            if (doneSinceRef.current === 0) doneSinceRef.current = now;
            if (!anyAnimating || now - doneSinceRef.current >= POST_DONE_SETTLE_MS) {
                loopRunningRef.current = false;
                return;
            }
        } else {
            doneSinceRef.current = 0;
        }

        rafRef.current = requestAnimationFrame(stepFrame);
    }, [writeTransform, finishRun]);

    const startLoop = useCallback(() => {
        if (loopRunningRef.current) return;
        loopRunningRef.current = true;
        lastFrameRef.current = performance.now();
        doneSinceRef.current = 0;
        rafRef.current = requestAnimationFrame(stepFrame);
    }, [stepFrame]);

    // ---- Setup --------------------------------------------------------------
    useEffect(() => {
        phaseRef.current = "playing";
        scoreRef.current = 0;
        setScore(0);
        setDanger(false);
        setFillBucket(0);
        setSqueeze(false);
        bodiesRef.current = [];
        pairsRef.current.clear();
        nodeMapRef.current.clear();
        heldIdRef.current = null;
        hoveredIdRef.current = null;

        const measure = () => {
            const rect = stageRef.current?.getBoundingClientRect();
            if (!rect) return;
            fullHeightRef.current = rect.height;
            // The play area EXCLUDES the bottom cancel strip, exactly as Bubble Match
            // does. One measurement drives three things at once: nothing spawns into
            // the strip (planSpawn), settled bubbles are walled out of it (physics),
            // and the strip is not counted as playable area by the fill ratio — so
            // the overflow loss and the spawn table still read the same number (§ 3.1).
            boundsRef.current = {
                width: rect.width,
                top: 0,
                height: rect.height - CANCEL_ZONE_HEIGHT,
            };
        };
        measure();
        window.addEventListener("resize", measure);

        // THE OPENING BOARD (§ 1): one live pair plus one English stray — 1 Chinese +
        // 2 English. The stray is English because the ratio rule carries the odd
        // bubble as English (§ 4.2), so the opening board is already balanced.
        //
        // COLORS COME FROM THE TABLE, NOT FROM HERE (2026-08-18). Both slots roll
        // `rollColor(0)` — an empty board, which is the fill the opening board has by
        // definition. They used to be hard-coded to two of the old four colors
        // outright, which made the opening a second, silent source of truth for an
        // economy the table already owns: a retune of the fill-0 row would have left
        // the opening untouched. The fill-0
        // row is now bloom-only, so this still opens on a bloom pair — but because the
        // table says so.
        //
        // CANCELLED ON CLEANUP, and this is load-bearing. Seeding became ASYNC when
        // `draw` started waiting out a dry buffer, which opened a window this effect
        // never had before: the effect can be torn down and re-run while a seed is
        // still awaiting its first card. React's StrictMode double-invokes mount
        // effects, so in dev that happens on EVERY entry — run 1 awaits, cleanup
        // fires, run 2 resets `bodiesRef` and seeds again, then run 1's await
        // resolves and places its bubbles into the fresh board. The board opened with
        // exactly double the bubbles (2 Chinese + 4 English).
        //
        // It is not a dev-only concern: the stage is remounted on `runId` for Play
        // Again, so a slow seed from the previous run could bleed into the next one.
        // The flag is closed over by this effect's own closure, so each run cancels
        // only itself.
        let cancelled = false;
        const seedOpening = async () => {
            // Checked before each draw as well as after, so a cancelled seed stops
            // consuming buffer stock rather than just declining to place it.
            if (cancelled) return;
            const first = await drawPair(rollColor(0));
            if (cancelled) return;
            if (first) {
                place(first.word);
                place(first.definition);
            }
            for (let i = 1; i < OPENING_DEFINITION_BUBBLES; i++) {
                if (cancelled) return;
                const stray = await drawPair(rollColor(0));
                if (cancelled) return;
                if (stray) place(stray.definition);
            }
            buffers.topUp();
            forceRender();
        };
        void seedOpening();
        startLoop();

        return () => {
            cancelled = true;
            window.removeEventListener("resize", measure);
            cancelAnimationFrame(rafRef.current);
            loopRunningRef.current = false;
            pendingTimeoutsRef.current.forEach(clearTimeout);
            pendingTimeoutsRef.current = [];
        };
        // Mount-only: the stage is remounted (keyed on runId) for a fresh run.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- Drag → hover → match ----------------------------------------------
    // Only an opposite-kind bubble can ever pair, so a same-kind bubble is not a
    // hover target and dropping onto it is a no-op rather than a fatal wrong match.
    const findHoverTarget = useCallback((held: BubbleBody): BubbleBody | null => {
        let best: BubbleBody | null = null;
        let bestDist = Infinity;
        for (const b of bodiesRef.current) {
            if (b.id === held.id) continue;
            if (b.kind === held.kind) continue;
            if (b.status === "correct" || b.status === "wrong" || b.status === "growing") continue;
            const d = Math.hypot(b.x - held.x, b.y - held.y);
            if (d < held.radius + b.radius && d < bestDist) {
                best = b;
                bestDist = d;
            }
        }
        return best;
    }, []);

    const setStatus = useCallback((body: BubbleBody, status: BubbleBody["status"], targetScale: number) => {
        body.status = status;
        body.targetScale = targetScale;
    }, []);

    const colorOf = useCallback(
        (pairId: string): HydraColor | undefined => pairsRef.current.get(pairId)?.card.color,
        []
    );

    // ---- Cleanup mode (post-run review, end popup minimized) ----------------
    // The same no-stakes playground Bubble Match offers after a loss, ported here
    // because Hydra's board is the more interesting one to review: an overflow loss
    // leaves a packed field of words the player never got to, and a wrong-match loss
    // leaves the pair that ended the run sitting right there. Matches pop and clear
    // as they do in play, but bank nothing (docs/HYDRA_BUBBLES.md § 7.6).

    // Drop the current green partner hint back to idle. Guarded on the "revealed"
    // status so it never clobbers a partner that has since become correct/wrong.
    const clearRevealedPartner = useCallback(() => {
        const pid = revealedPartnerIdRef.current;
        revealedPartnerIdRef.current = null;
        if (!pid) return;
        const p = bodiesRef.current.find((b) => b.id === pid);
        if (p && p.status === "revealed") setStatus(p, "idle", SCALE_IDLE);
    }, [setStatus]);

    // Light the held bubble's partner green (drop hint). Only one is lit at a time.
    // Returns false when this bubble has no partner on the field — Hydra's board is
    // mostly STRAYS (§ 4.2), so an unmatchable grab is the common case here, not the
    // edge case it is in Bubble Match; the caller flags the grab light-red for it.
    const revealPartner = useCallback(
        (held: BubbleBody): boolean => {
            clearRevealedPartner();
            const partner = bodiesRef.current.find(
                (b) => b.id !== held.id && b.pairId === held.pairId && b.status === "idle"
            );
            if (!partner) return false;
            setStatus(partner, "revealed", SCALE_IDLE);
            revealedPartnerIdRef.current = partner.id;
            forceRender();
            return true;
        },
        [clearRevealedPartner, setStatus, forceRender]
    );

    // Keep the ref in sync. Entering cleanup silences the danger vignette, releases
    // the pair left frozen red by a wrong-match loss (a "wrong" body is not grabbable,
    // and those two are exactly the ones the player most wants to re-try), and
    // restarts the self-stopped physics loop so the frozen field goes live for
    // dragging. Leaving it tears down any lingering hint and lets the loop settle.
    useEffect(() => {
        cleanupModeRef.current = cleanupMode;
        if (cleanupMode) {
            setDangerDismissed(true);
            for (const b of bodiesRef.current) {
                if (b.status === "wrong") setStatus(b, "idle", SCALE_IDLE);
            }
            forceRender();
            startLoop();
        } else {
            clearRevealedPartner();
        }
    }, [cleanupMode, startLoop, clearRevealedPartner, setStatus, forceRender]);

    const onPointerDown = useCallback((id: string, e: React.PointerEvent) => {
        // Grabbable while playing, OR during post-run cleanup (run over, popup
        // minimized). A paused field is never grabbable in either mode.
        const cleanup = cleanupModeRef.current;
        if ((phaseRef.current !== "playing" && !cleanup) || pausedRef.current) return;
        const body = bodiesRef.current.find((b) => b.id === id);
        if (!body || body.status === "correct" || body.status === "wrong") return;

        const rect = stageRef.current?.getBoundingClientRect();
        if (!rect) return;
        stageRectRef.current = rect;

        // Grabbing a still-growing bubble finishes its grow-in instantly, so it is
        // dragged and matched as a normal, complete bubble.
        if (body.status === "growing") body.radius = body.targetRadius;

        heldIdRef.current = id;
        grabOffsetRef.current = {
            x: e.clientX - rect.left - body.x,
            y: e.clientY - rect.top - body.y,
        };
        setStatus(body, "held", SCALE_HELD);

        // Cleanup: light this bubble's partner green as a drop hint. With no partner
        // on the field it can never be matched, so the grabbed bubble itself is
        // flagged light-red instead of the usual held dim, for as long as it is held.
        if (cleanup && !revealPartner(body)) {
            setStatus(body, "nomatch", SCALE_HELD);
        }
        forceRender();

        if (body.kind === "word" && onSpeak) onSpeak(body.entry);
    }, [forceRender, onSpeak, setStatus, revealPartner]);

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            const heldId = heldIdRef.current;
            if (!heldId) return;
            const held = bodiesRef.current.find((b) => b.id === heldId);
            const rect = stageRectRef.current;
            if (!held || !rect) return;

            const bounds = boundsRef.current;
            const px = e.clientX - rect.left - grabOffsetRef.current.x;
            const py = e.clientY - rect.top - grabOffsetRef.current.y;
            // The looser bounds a HELD body gets: off the bottom into the cancel strip,
            // and a radius past either side wall. Only the held bubble is exempt —
            // settled bodies are still walled in by the physics step, which glides this
            // one back too once it is released. See clampHeldCenter.
            const at = clampHeldCenter(held, bounds, fullHeightRef.current, px, py);
            held.x = at.x;
            held.y = at.y;

            // Tint the strip while the held bubble overlaps it (feedback only — the
            // decision is re-derived on release from the same predicate).
            const inZone = held.y + held.radius > bounds.height;
            setOverCancelZone((prev) => (prev === inZone ? prev : inZone));

            // Written now rather than next frame so the drag tracks the pointer with
            // no added latency.
            held.scale += (held.targetScale - held.scale) * SCALE_LERP;
            writeTransform(held);

            // Update the hover highlight. The green-revealed partner (cleanup drop
            // hint) is skipped so it stays green while still acting as the drop
            // target — hoveredIdRef still points at it, so the drop resolves.
            const target = findHoverTarget(held);
            const prevHoverId = hoveredIdRef.current;
            if (target?.id !== prevHoverId) {
                if (prevHoverId) {
                    const prev = bodiesRef.current.find((b) => b.id === prevHoverId);
                    if (prev && prev.status === "hovered") setStatus(prev, "idle", SCALE_IDLE);
                }
                if (target && target.id !== revealedPartnerIdRef.current) {
                    setStatus(target, "hovered", SCALE_HOVER);
                }
                hoveredIdRef.current = target?.id ?? null;
                forceRender();
            }
        };

        const onUp = () => {
            const heldId = heldIdRef.current;
            if (!heldId) return;
            heldIdRef.current = null;
            const held = bodiesRef.current.find((b) => b.id === heldId);
            if (!held) return;

            const targetId = hoveredIdRef.current;
            hoveredIdRef.current = null;
            const target = targetId
                ? bodiesRef.current.find((b) => b.id === targetId) ?? null
                : null;

            // Cleanup mode (post-run review, popup minimized) resolves drops exactly
            // as play does — pop on correct, shake on wrong — but banks NOTHING: no
            // mark, no score, no payout spawn, and no second run end.
            const cleanup = cleanupModeRef.current;

            // A release that lands after the run ended, and we are NOT reviewing
            // (e.g. the pointer came up in the same tick the board overflowed):
            // resolve nothing.
            if (phaseRef.current !== "playing" && !cleanup) {
                setStatus(held, "idle", SCALE_IDLE);
                if (target && target.status === "hovered") setStatus(target, "idle", SCALE_IDLE);
                forceRender();
                return;
            }

            // The drag is ending — retire the green partner hint. Guarded on the
            // "revealed" status, so if the hint bubble IS the drop target it is left
            // alone here and picks up its correct/wrong status below.
            clearRevealedPartner();

            // Dropped on empty space — not a wrong match, just a drop. Only a drop
            // ONTO a bubble is a judgement (§ 7.1).
            if (!target) {
                setStatus(held, "idle", SCALE_IDLE);
                setOverCancelZone(false);
                forceRender();
                return;
            }

            // THE CANCEL STRIP (§ 7.1b). Its top edge is the play-area floor, so the
            // held bubble straddles it exactly when its lower edge passes
            // `bounds.height`. A drop in the strip abandons the match: no mark, no
            // shake, no run end. A CORRECT match still counts, so the strip can never
            // cost the player a match they had actually earned.
            const inCancelZone = held.y + held.radius > boundsRef.current.height;
            const correct = held.pairId === target.pairId;

            if (inCancelZone && !correct) {
                setStatus(held, "idle", SCALE_IDLE);
                // The target was lit by onMove while the drag passed over it; put it
                // back or it stays enlarged on a board that never resolved anything.
                if (target.status === "hovered") setStatus(target, "idle", SCALE_IDLE);
                setOverCancelZone(false);
                forceRender();
                return;
            }

            if (target.kind === "word" && onSpeak) onSpeak(target.entry);
            setOverCancelZone(false);

            if (!correct) {
                // ONE WRONG MATCH ENDS THE RUN — immediate, no confirmation (§ 7.1).
                // The negative mark goes on the CHINESE bubble's card, matching Bubble
                // Match: a registered match is always one word + one definition, and
                // the recognition track belongs to the foreign side.
                //
                // In cleanup there is no run left to end and no mark to bank: the pair
                // just shakes and settles back to idle, so a wrong guess on the review
                // board costs nothing but still reads as wrong.
                setStatus(held, "wrong", held.targetScale);
                setStatus(target, "wrong", target.targetScale);
                forceRender();
                if (cleanup) {
                    const to = setTimeout(() => {
                        if (bodiesRef.current.includes(held)) setStatus(held, "idle", SCALE_IDLE);
                        if (bodiesRef.current.includes(target)) setStatus(target, "idle", SCALE_IDLE);
                        forceRender();
                    }, WRONG_FEEDBACK_MS);
                    pendingTimeoutsRef.current.push(to);
                    return;
                }
                const chinese = held.kind === "word" ? held : target;
                onMark(chinese.entry, false);
                // Let the shake play before the popup lands, so the player sees WHAT
                // went wrong rather than a score card appearing out of nowhere.
                const to = setTimeout(() => finishRun("wrongMatch"), WRONG_FEEDBACK_MS);
                pendingTimeoutsRef.current.push(to);
                return;
            }

            // Correct: score, mark, pop, then pay out the cleared color's spawns —
            // all of which a cleanup match skips. It only pops and removes the pair,
            // so the review board drains toward empty and never refills.
            if (!cleanup) {
                onMark(held.entry, true);
                scoreRef.current += SCORE_PER_MATCH;
                setScore(scoreRef.current);
                onScore(scoreRef.current);
            }
            setStatus(held, "correct", SCALE_IDLE);
            setStatus(target, "correct", SCALE_IDLE);
            forceRender();

            // The challenge round's last contested word: the run is over, but only
            // after the pop plays — a board that freezes mid-animation reads as a
            // crash rather than as a finish. The payout batch below is skipped for the
            // same reason it is skipped after any ending: `phaseRef` is not "playing"
            // by then.
            const endsRun = shouldEndRun?.(held.entry) ?? false;

            const clearedColor = colorOf(held.pairId) ?? "drain";
            const to = setTimeout(() => {
                bodiesRef.current = bodiesRef.current.filter(
                    (b) => b.id !== held.id && b.id !== target.id
                );
                nodeMapRef.current.delete(held.id);
                nodeMapRef.current.delete(target.id);
                // The card is spent for this run: retired from the buffers so it is
                // not immediately re-served as its own replacement. A cleanup clear
                // does NOT spend it — the run is already over, and retiring it would
                // only make it scarcer for the next one.
                if (!cleanup) buffers.release(held.entry.id);
                pairsRef.current.delete(held.pairId);
                // THE PAYOUT (§ 2). Planned against the board as it stands AFTER the
                // pair is removed, which is what makes the fill-keyed table read the
                // number the player is actually looking at.
                if (endsRun && !cleanup) {
                    forceRender();
                    finishRun("challengeComplete");
                    return;
                }
                if (phaseRef.current === "playing") {
                    // Fire-and-forget: the batch awaits buffer refills, and the
                    // match animation must not block on the network.
                    void runSpawnBatch(PAYOUT_BY_COLOR[clearedColor]);
                }
                forceRender();
            }, POP_DURATION_MS);
            pendingTimeoutsRef.current.push(to);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
        };
    }, [findHoverTarget, forceRender, onSpeak, setStatus, writeTransform, onMark, onScore, finishRun, runSpawnBatch, colorOf, buffers, shouldEndRun, clearRevealedPartner]);

    return (
        <>
        {/* HUD — a real row above the field (docs/SHELF_REDESIGN.md § 16), not the
            overlay it used to be at `top: 8`, where bubbles drifted under the score.

            The MODE slot doubles as the squeeze warning. There is only one mode, so
            "endless" is a constant and would be dead pixels — but the moment the table
            goes drain-only that slot has something urgent to say, and saying it where
            the mode was keeps the strip to three facts instead of four.

            The bar is the FILL RATIO, not progress: an endless run has no denominator,
            and fill is the number that actually ends it (LOSE_FILL_RATIO) as well as the
            one the spawn table is keyed on. It goes red on the danger band, so the bar
            and the vignette raise the alarm together. */}
        <GameHud className="hydra-stage__hud">
            {squeeze && !dangerDismissed ? (
                <GameHudLabel
                    className="hydra-stage__squeeze"
                    // The label names the DRAIN tier, so it takes drain's HUE — but its
                    // INK (`COLORS.yelA`), not its body fill. The bubbles wear the 94%
                    // pastel; a pastel is a fill that things sit on, and as text on the
                    // HUD's own tint it would be a smudge (the palette states this rule
                    // for every pastel in the app). Same hue, right tier: the warning and
                    // the bubbles it is about still read as one thing, and this one is
                    // legible. It was `BLUE_DARK` when drain was a mid-value blue, which
                    // was the one lightness where a body colour could double as ink.
                    //
                    // The copy says what the board can now DO, not which tier is
                    // spawning. "drain only" is the internal name (types.ts) and means
                    // nothing to a player; "shrink only" is the same fact stated as the
                    // consequence they are about to live with.
                    color={COLORS.yelA}
                >
                    shrink only
                </GameHudLabel>
            ) : (
                <GameHudLabel className="hydra-stage__mode">endless</GameHudLabel>
            )}
            <GameHudLabel className="hydra-stage__score">{score} cleared</GameHudLabel>
            <GameHudBar
                className="hydra-stage__fill-bar"
                fraction={fillBucket}
                color={danger && !dangerDismissed ? COLORS.dangerInk : COLORS.teaA}
            />
        </GameHud>
        <Box
            ref={stageRef}
            className="hydra-stage"
            sx={{
                position: "relative",
                flex: 1,
                minHeight: 0,
                width: "100%",
                overflow: "hidden",
                // The `.play` panel is the field's ground now (docs/SHELF_REDESIGN.md
                // § A6) — a second paper fill inside a white panel read as a box in a box.
                backgroundColor: "transparent",
                // The stage owns all touch input; dragging must never scroll the page.
                touchAction: "none",
                overscrollBehavior: "contain",
            }}
        >
            {/* Danger vignette — same warning band as Bubble Match (0.72 → 0.94). */}
            <Box
                className="hydra-stage__danger-glow"
                sx={{
                    position: "absolute",
                    inset: 0,
                    pointerEvents: "none",
                    zIndex: 40,
                    background:
                        "radial-gradient(125% 125% at 50% 50%, rgba(244,67,54,0) 18%, rgba(244,67,54,0.45) 48%, rgba(229,57,53,0.78) 76%, rgba(198,40,40,0.95) 100%)",
                    opacity: danger && !dangerDismissed ? 1 : 0,
                    transition: "opacity 0.35s ease",
                    animation: danger && !dangerDismissed ? "hydraDangerPulse 0.9s ease-in-out infinite" : "none",
                    "@keyframes hydraDangerPulse": {
                        "0%, 100%": { opacity: 0.7 },
                        "50%": { opacity: 1 },
                    },
                }}
            />

            {bodiesRef.current.map((body) => (
                <Bubble
                    key={body.id}
                    body={body}
                    status={body.status}
                    fill={fillForBody(body, colorOf(body.pairId))}
                    showPinyin={showPinyin && language === "zh"}
                    showPinyinColor={showPinyinColor}
                    // The borrowed-card mark. Hydra streams its cards, so it can never
                    // name the lent ones up front the way an itemized pre-round notice
                    // does — the badge on the bubble is the whole telling (§ 6.4).
                    //
                    // WORD BUBBLE ONLY, and that is correctness, not taste: both bubbles
                    // of a pair carry the same entry, so badging the definition side too
                    // would let a player pair them by badge instead of by reading — the
                    // foreign-side-only rule from docs/PROVISIONAL_CARDS.md § 5.
                    lent={body.kind === "word" && body.entry.starterPackBucket === "provisional"}
                    registerNode={registerNode}
                    onPointerDown={onPointerDown}
                />
            ))}

            {/* SAFE-RELEASE STRIP (§ 7.1b). Its top edge is the play-area floor (see
                measure()), so settled bubbles never enter it and a bubble dragged in
                is walled back out on release. Hydra needs this more than Bubble Match
                does: one wrong match ends the run outright, and on a board near the
                0.94 loss line there may be no empty space left to drop onto — every
                release would land on some bubble. Without the strip a crowded board
                makes backing out of a drag impossible. */}
            <Box
                className="hydra-stage__cancel-zone"
                sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: `${CANCEL_ZONE_HEIGHT}px`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    // The drag is tracked on window listeners; the strip must not
                    // intercept pointer events aimed at the stage or its bubbles.
                    pointerEvents: "none",
                    // Under the HUD (50) and under the bubbles, so a held bubble
                    // renders ON TOP of the strip while hovering it.
                    zIndex: 5,
                    borderTop: "2px dashed",
                    borderColor: overCancelZone ? "rgba(244,67,54,0.85)" : "rgba(0,0,0,0.12)",
                    backgroundColor: overCancelZone ? "rgba(244,67,54,0.06)" : "rgba(0,0,0,0.02)",
                    transition: "background-color 0.15s ease, border-color 0.15s ease",
                }}
            >
                <Typography
                    className="hydra-stage__cancel-zone-label"
                    sx={{
                        fontSize: SIZE.body,
                        fontWeight: WEIGHT.bold,
                        color: overCancelZone ? "#F44336" : "#9a9a9a",
                        letterSpacing: 0.3,
                    }}
                >
                    drop here to cancel match
                </Typography>
            </Box>
        </Box>
        </>
    );
};

export default HydraStage;
