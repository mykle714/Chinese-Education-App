import React, { useMemo } from "react";
import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { ISO } from "./iso";

/**
 * SpeedLines — the horizontal streaks that sell the Deck Tower's camera dash between
 * worlds (docs/DECK_TOWER.md § "Worlds → The pan").
 *
 * Layer: page-private component (feature module `src/features/deckTower`). Screen space,
 * not iso: a full-stage overlay of flat white bars racing across, opposite to the
 * camera's travel. Mounted only while a pan runs; `strength` (useWorldPan `speed`)
 * fades the whole field in and out, so the lines gather and die with the dash.
 *
 * Flat white like IsoWind's strokes (`ISO.wind`), no gradients — the iso style.
 *
 * Depends on: iso/palette.ts (`ISO.wind`). Depended on by: DeckTowerPage.tsx.
 */

/** How many streaks are on screen. */
const LINE_COUNT = 16;

/** A deterministic PRNG (mulberry32) so the field is the same on every pan. */
function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let r = Math.imul(a ^ (a >>> 15), 1 | a);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

/** A streak crossing from just past the right edge to just past the left one. */
const streakLeftward = keyframes`
    from { transform: translateX(110vw); }
    to   { transform: translateX(-110%); }
`;
const streakRightward = keyframes`
    from { transform: translateX(-110%); }
    to   { transform: translateX(110vw); }
`;

interface SpeedLinesProps {
    /** The camera's travel: +1 right (so the streaks race LEFT), −1 left. */
    direction: -1 | 1;
    /** 0 → 1, the dash's strength (opacity of the whole field). */
    strength: number;
    /** The overlay's bottom edge (the footer bar's height), matching the scroller's. */
    bottom: number | string;
}

const SpeedLines: React.FC<SpeedLinesProps> = ({ direction, strength, bottom }) => {
    // Each streak's lane, length, weight, speed and phase — fixed per mount.
    const lines = useMemo(() => {
        const rand = seededRandom(41);
        return Array.from({ length: LINE_COUNT }, (_, i) => ({
            id: i,
            topPct: 4 + rand() * 88,
            widthPct: 18 + rand() * 34,
            heightPx: 2 + Math.round(rand() * 2),
            durationMs: 260 + rand() * 220,
            delayMs: -rand() * 480,
            opacity: 0.45 + rand() * 0.45,
        }));
    }, []);
    const streak = direction > 0 ? streakLeftward : streakRightward;

    return (
        <Box
            className="deck-tower-page__speed-lines"
            aria-hidden
            sx={{ position: "absolute", zIndex: 1, top: 0, left: 0, right: 0, bottom, overflow: "hidden", pointerEvents: "none", opacity: strength }}
        >
            {lines.map((l) => (
                <Box
                    key={l.id}
                    className="deck-tower-page__speed-line"
                    sx={{
                        position: "absolute",
                        left: 0,
                        top: `${l.topPct}%`,
                        width: `${l.widthPct}%`,
                        height: l.heightPx,
                        borderRadius: l.heightPx,
                        backgroundColor: ISO.wind,
                        opacity: l.opacity,
                        animation: `${streak} ${l.durationMs}ms linear ${l.delayMs}ms infinite`,
                    }}
                />
            ))}
        </Box>
    );
};

export default SpeedLines;
