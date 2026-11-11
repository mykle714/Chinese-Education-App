import React, { useId } from "react";
import { EMOTE_GAP, HEAD_CENTRE, HEAD_RADIUS } from "./pawnFigure";
import { shadeHex } from "./palette";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import IsoText from "./IsoText";
import { IDLE_EXIT_MS, KNIT_CLICK_MS, SING_MS, SNEEZE_SNAP_MS, type PawnIdleKind } from "./pawnIdles";
import { EMOTE_DRAW_SCALE } from "./usePawnMotion";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * PawnIdleProps — the marks an idle animation draws round the pawn (docs/HINT_PAWN.md
 * § "Idle animations"; the poses are pawnIdles.ts's):
 *   - doze: big ink "Z"s drifting up off the head, one after another, for as long as it sleeps;
 *   - sing: ♪ / ♫ notes floating up and to the right, swaying;
 *   - sneeze: a white puff bursting out in front of the face on the snap (SNEEZE_SNAP_MS);
 *   - knit: two needles clicking in front of the chest, a scarf growing under them, and a
 *     yarn ball on the floor with its strand running up to the work.
 * The notes are ink glyphs on small white discs — the "!" bubble's white-and-ink (owner,
 * 2026-11-08). The Z's are bare, larger ink glyphs, free-floating (owner, 2026-11-08).
 *
 * Drawn inside IsoPawn's head anchor, in its units (EMOTE_DRAW_SCALE per camera-facing
 * world unit; origin just over the head's top, y down). The anchor follows the BENT head for
 * the doze, the song and the sneeze (usePawnMotion `marksFollowHead`), so their marks come
 * off a drooping or tipped-back head; for knitting it stays on the upright head, so the
 * yarn ball on the floor does not slide as the head bobs. Reaching the chest and the floor
 * from the head converts world heights through the projector — exact under the fixed view
 * (the hint pawn's), approximate under a moving camera.
 *
 * `ending` (a lasting idle easing out) fades everything over IDLE_EXIT_MS. Every animation
 * is CSS, so it starts when this mounts — IsoPawn mounts it when the idle actually starts
 * (usePawnMotion `activeIdle`), not when it was cued.
 *
 * Layer: iso framework presentation. Depended on by: iso/IsoPawn.tsx.
 */

const HEAD_TOP = EMOTE_GAP * EMOTE_DRAW_SCALE;
const HEAD_R = HEAD_RADIUS * EMOTE_DRAW_SCALE;
const HEAD_CY = HEAD_TOP + HEAD_R;

/** A mark's white disc: the radius, in anchor units. */
const MARK_DISC_R = 15;

/** The doze Z's: one starts every DOZE_Z_GAP_MS; each drifts up for DOZE_Z_DRIFT_MS. */
const DOZE_Z_DRIFT_MS = 3000;
const DOZE_Z_GAP_MS = 2000;
/** Three Z's (DOZE_ZS) take turns, so each one's loop is three gaps long. */
const DOZE_Z_CYCLE_MS = 3 * DOZE_Z_GAP_MS;
/** The scarf: it grows SCARF_RATE anchor units a second, up to SCARF_MAX_LEN (an hour's worth —
 *  long past the bottom of any screen, so in practice it grows forever). */
const SCARF_RATE = 2;
const SCARF_MAX_LEN = SCARF_RATE * 3600;
/** A keyframe stop at fraction `f` of a Z's drift, as a percentage of its whole loop. */
const pct = (f: number) => `${((f * DOZE_Z_DRIFT_MS) / DOZE_Z_CYCLE_MS) * 100}%`;

const IDLE_PROPS_CSS = `
.iso-pawn__idle-props { transition: opacity ${IDLE_EXIT_MS}ms ease-out; }
.iso-pawn__idle-props--ending { opacity: 0; }
.iso-pawn__idle-mark, .iso-pawn__sneeze-puff { transform-box: fill-box; }
/* One Z's drift takes the first DOZE_Z_DRIFT_MS of its DOZE_Z_CYCLE_MS loop; it stays gone
   for the rest, so the three staggered Z's leave a lull between them. */
@keyframes iso-pawn-doze-z {
    0% { transform: translate(0, 0) scale(0.5); opacity: 0; }
    ${pct(0.18)} { opacity: 1; }
    ${pct(0.75)} { opacity: 1; }
    ${pct(1)}, 100% { transform: translate(44px, -78px) scale(1.15); opacity: 0; }
}
.iso-pawn__idle-mark--z { transform-origin: center; animation: iso-pawn-doze-z ${DOZE_Z_CYCLE_MS}ms ease-out infinite both; }
@keyframes iso-pawn-sing-note {
    0% { transform: translate(0, 0) rotate(-10deg) scale(0.6); opacity: 0; }
    15% { opacity: 1; }
    40% { transform: translate(22px, -34px) rotate(12deg) scale(1); }
    70% { transform: translate(34px, -60px) rotate(-10deg) scale(1); opacity: 1; }
    100% { transform: translate(52px, -88px) rotate(8deg) scale(0.95); opacity: 0; }
}
.iso-pawn__idle-mark--note { transform-origin: center; animation: iso-pawn-sing-note 1500ms ease-out both; }
@keyframes iso-pawn-sneeze-puff {
    0% { transform: translate(0, 0) scale(0.2); opacity: 0; }
    12% { opacity: 0.95; }
    100% { transform: translate(var(--puff-dx), var(--puff-dy)) scale(1.25); opacity: 0; }
}
.iso-pawn__sneeze-puff { transform-origin: center; animation: iso-pawn-sneeze-puff 620ms ease-out ${SNEEZE_SNAP_MS}ms both; }
@keyframes iso-pawn-needle-a { 0%, 100% { transform: rotate(28deg); } 50% { transform: rotate(14deg); } }
@keyframes iso-pawn-needle-b { 0%, 100% { transform: rotate(-28deg); } 50% { transform: rotate(-14deg); } }
.iso-pawn__needle { transform-origin: 0 0; }
.iso-pawn__needle--a { animation: iso-pawn-needle-a ${KNIT_CLICK_MS}ms ease-in-out infinite; }
.iso-pawn__needle--b { animation: iso-pawn-needle-b ${KNIT_CLICK_MS}ms ease-in-out infinite; }
/* The scarf feeds down out of the needles at SCARF_RATE, starting from nothing. */
@keyframes iso-pawn-scarf-grow { from { transform: translateY(-${SCARF_MAX_LEN}px); } to { transform: translateY(0); } }
.iso-pawn__scarf { animation: iso-pawn-scarf-grow ${(SCARF_MAX_LEN / SCARF_RATE) * 1000}ms linear both; }
@media (prefers-reduced-motion: reduce) {
    .iso-pawn__idle-props { display: none; }
}
`;

/** An ink glyph on a white disc, centred on the origin. */
const MarkDisc: React.FC<{ glyph: string; r?: number; white: string; ink: string }> = ({ glyph, r = MARK_DISC_R, white, ink }) => (
    <>
        <circle r={r} fill={white} />
        <IsoText
            fontSize={r * 1.25}
            fontFamily={FONTS.cjk}
            fontWeight={WEIGHT.bold}
            textAnchor="middle"
            fill={ink}
        >
            {glyph}
        </IsoText>
    </>
);

// ── Doze ─────────────────────────────────────────────────────────────────────

/**
 * Three Z's in turn, DOZE_Z_GAP_MS apart, each a little bigger than the last. Free-floating ink
 * glyphs with no disc behind them (owner, 2026-11-08) — bigger than the song's notes, so the
 * sleep reads from across the card. `size` is the font size, in anchor units.
 */
const DOZE_ZS = [
    { size: 24, delay: 0 },
    { size: 30, delay: DOZE_Z_GAP_MS },
    { size: 36, delay: 2 * DOZE_Z_GAP_MS },
] as const;

const PawnDozeZs: React.FC<{ ink: string }> = ({ ink }) => (
    <g className="iso-pawn__doze-zs" transform={`translate(${HEAD_R * 0.7} ${HEAD_TOP - 8})`}>
        {DOZE_ZS.map((z, i) => (
            <g key={i} className="iso-pawn__idle-mark iso-pawn__idle-mark--z" style={{ animationDelay: `${z.delay}ms` }}>
                <IsoText
                    fontSize={z.size}
                    fontFamily={FONTS.cjk}
                    fontWeight={WEIGHT.bold}
                    textAnchor="middle"
                    fill={ink}
                >
                    Z
                </IsoText>
            </g>
        ))}
    </g>
);

// ── Sing ─────────────────────────────────────────────────────────────────────

/** Notes in turn over the song (SING_MS): a new one every half second, alternating glyphs. */
const SING_NOTES = Array.from({ length: Math.floor((SING_MS - 1500) / 500) + 1 }, (_, i) => ({
    glyph: i % 2 === 0 ? "♪" : "♫",
    delay: 250 + i * 500,
    x: i % 2 === 0 ? 0 : 10,
}));

const PawnSingNotes: React.FC<{ white: string; ink: string }> = ({ white, ink }) => (
    <g className="iso-pawn__sing-notes" transform={`translate(${HEAD_R * 0.9} ${HEAD_TOP - 4})`}>
        {SING_NOTES.map((n, i) => (
            <g key={i} transform={`translate(${n.x} 0)`}>
                <g className="iso-pawn__idle-mark iso-pawn__idle-mark--note" style={{ animationDelay: `${n.delay}ms` }}>
                    <MarkDisc glyph={n.glyph} white={white} ink={ink} />
                </g>
            </g>
        ))}
    </g>
);

// ── Sneeze ───────────────────────────────────────────────────────────────────

/**
 * The puff, in front of the face: the head snaps toward the pawn's facing (screen-right and
 * toward the viewer), so the discs fly right and a little down. [cx, cy, r, dx, dy].
 */
const SNEEZE_PUFFS: readonly [number, number, number, number, number][] = [
    [HEAD_R * 1.1, HEAD_CY + 4, 11, 46, 10],
    [HEAD_R * 1.2, HEAD_CY - 6, 9, 40, -14],
    [HEAD_R * 1.0, HEAD_CY + 14, 8, 34, 26],
];

const PawnSneezePuff: React.FC<{ white: string }> = ({ white }) => (
    <g className="iso-pawn__sneeze" fill={white}>
        {SNEEZE_PUFFS.map(([cx, cy, r, dx, dy], i) => (
            <circle
                key={i}
                className="iso-pawn__sneeze-puff"
                cx={cx}
                cy={cy}
                r={r}
                style={{ "--puff-dx": `${dx}px`, "--puff-dy": `${dy}px` } as React.CSSProperties}
            />
        ))}
    </g>
);

// ── Knit ─────────────────────────────────────────────────────────────────────

/** Where the needles cross: this high off the feet (world z), a little right of the body's axis (it faces right). */
const NEEDLES_Z = 0.95;
const NEEDLES_X = 8;
const NEEDLE_HALF = 30;
/** Shaft thickness and the knob on its back end (anchor units). */
const NEEDLE_W = 4;
const KNOB_R = 3;
/** The scarf's width, and the spacing of its knitted ribs, anchor units. */
const SCARF_W = 24;
const SCARF_RIB_GAP = 46 / 6;
/** The yarn ball: on the slab, screen-left of the pawn and a touch in front of its feet. */
const BALL_X = -44;
const BALL_R = 13;

const PawnKnitting: React.FC<{ white: string; yarn: string }> = ({ white, yarn }) => {
    const proj = useIsoProjector();
    // Anchor units per world unit of HEIGHT: the anchor draws EMOTE_DRAW_SCALE per facing
    // unit, and a height of 1 is `heightUnit` px where a facing unit is `facingScaleAt` px.
    const perHeight = (EMOTE_DRAW_SCALE * proj.heightUnit) / proj.facingScaleAt(0, 0, 0);
    const yAt = (z: number) => HEAD_CY + (HEAD_CENTRE - z) * perHeight;
    const needlesY = yAt(NEEDLES_Z);
    const floorY = yAt(0);
    const ballY = floorY + 4 - BALL_R;
    const rib = shadeHex(yarn, 0.18);
    const scarfClipId = `iso-pawn-scarf-clip-${useId().replace(/:/g, "")}`;
    return (
        <g className="iso-pawn__knitting">
            {/* The yarn ball, a couple of wound turns drawn over it, and the strand up to the work. */}
            <g className="iso-pawn__yarn-ball" transform={`translate(${BALL_X} ${ballY})`}>
                <circle r={BALL_R} fill={yarn} />
                <path d={`M ${-BALL_R * 0.8} ${-BALL_R * 0.3} Q 0 ${-BALL_R * 1.1} ${BALL_R * 0.8} ${-BALL_R * 0.2}`} fill="none" stroke={rib} strokeWidth={2} />
                <path d={`M ${-BALL_R * 0.7} ${BALL_R * 0.4} Q 0 ${-BALL_R * 0.4} ${BALL_R * 0.75} ${BALL_R * 0.5}`} fill="none" stroke={rib} strokeWidth={2} />
            </g>
            <path
                className="iso-pawn__yarn-strand"
                d={`M ${BALL_X + BALL_R * 0.5} ${ballY - BALL_R * 0.8} Q ${BALL_X - 6} ${needlesY + 10} ${NEEDLES_X - SCARF_W / 2} ${needlesY + 4}`}
                fill="none"
                stroke={yarn}
                strokeWidth={2.5}
                strokeLinecap="round"
            />
            {/* The scarf hangs off the needles and grows for as long as the pawn knits, from
                nothing, down past the slab and eventually off the bottom of the screen. It is
                one long ribbed strip sliding down out of a clip at the needles, so new rows
                appear at the needles and the finished ones travel down with the scarf. */}
            <clipPath id={scarfClipId}>
                <rect width={SCARF_W} height={SCARF_MAX_LEN} />
            </clipPath>
            <g transform={`translate(${NEEDLES_X - SCARF_W / 2} ${needlesY + 2})`} clipPath={`url(#${scarfClipId})`}>
                <g className="iso-pawn__scarf">
                    <rect width={SCARF_W} height={SCARF_MAX_LEN} rx={3} fill={yarn} />
                    {/* The ribs: one vertical stroke as wide as the scarf, dashed into bars. */}
                    <line
                        x1={SCARF_W / 2}
                        x2={SCARF_W / 2}
                        y1={0}
                        y2={SCARF_MAX_LEN}
                        stroke={rib}
                        strokeWidth={SCARF_W - 6}
                        strokeDasharray={`2 ${SCARF_RIB_GAP - 2}`}
                    />
                </g>
            </g>
            {/* The needles, crossing and clicking (one click per KNIT_CLICK_MS, the head's bob). */}
            <g className="iso-pawn__needles" transform={`translate(${NEEDLES_X} ${needlesY})`}>
                {(["a", "b"] as const).map((n) => {
                    const knobX = n === "a" ? -NEEDLE_HALF : NEEDLE_HALF;
                    return (
                        <g key={n} className={`iso-pawn__needle iso-pawn__needle--${n}`}>
                            {/* One plain white body, shaft and knob together — no outline
                                (owner, 2026-11-08). */}
                            <g className="iso-pawn__needle-body" fill={white} stroke={white}>
                                <line x1={-NEEDLE_HALF} y1={0} x2={NEEDLE_HALF} y2={0} strokeWidth={NEEDLE_W} strokeLinecap="round" />
                                {/* The knob on the needle's back end. */}
                                <circle cx={knobX} cy={0} r={KNOB_R} stroke="none" />
                            </g>
                        </g>
                    );
                })}
            </g>
        </g>
    );
};

/** The marks for `kind`, faded out while `ending`. */
const PawnIdleProps: React.FC<{ kind: PawnIdleKind; ending: boolean }> = ({ kind, ending }) => {
    const palette = useIsoPalette();
    return (
        <g className={ending ? "iso-pawn__idle-props iso-pawn__idle-props--ending" : "iso-pawn__idle-props"}>
            <style>{IDLE_PROPS_CSS}</style>
            {kind === "doze" && <PawnDozeZs ink={palette.ink} />}
            {kind === "sing" && <PawnSingNotes white={palette.white} ink={palette.ink} />}
            {kind === "sneeze" && <PawnSneezePuff white={palette.white} />}
            {kind === "knit" && <PawnKnitting white={palette.white} yarn={palette.yarn} />}
        </g>
    );
};

export default PawnIdleProps;
