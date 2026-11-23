import { Box, Typography } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import type { SentenceTilesGameView, SentenceTilesMoveView } from "../../../server/contracts/sentenceTiles";
import { playerName, sectionLabelSx } from "./sentenceTilesStyles";

/**
 * SentenceTilesMoveLog — the game's history, newest first (docs/SENTENCE_TILES_GAME.md § "Pages").
 *
 * Shows every completed move plus YOUR OWN rejected lines (the server never sends the
 * opponent's rejections). A played line is shown joined, as the sentence it forms.
 */
export default function SentenceTilesMoveLog({ game }: { game: SentenceTilesGameView }) {
    if (game.moves.length === 0) return null;
    const who = (m: SentenceTilesMoveView) => (m.userId === game.you.userId ? "You" : playerName(game.opponent));
    return (
        <Box className="sentence-tiles-log">
            <Typography className="sentence-tiles-log__label" sx={sectionLabelSx}>Moves</Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: "4px", padding: "0 16px" }}>
                {[...game.moves].reverse().map((m, i) => (
                    <Box key={`${m.turnNumber}-${m.kind}-${i}`} className={`sentence-tiles-log__row sentence-tiles-log__row--${m.kind}`}
                        sx={{ display: "flex", alignItems: "baseline", gap: "8px", padding: "6px 0", borderBottom: `1px solid ${COLORS.rowBorder}` }}>
                        <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.caption, color: COLORS.textSecondary, width: 22, flexShrink: 0 }}>{m.turnNumber}</Typography>
                        <Typography sx={{ flex: 1, fontFamily: FONTS.sans, fontSize: SIZE.body, color: m.kind === "rejected" ? COLORS.textSecondary : COLORS.onSurface }}>
                            {describe(m, who(m))}
                        </Typography>
                        {m.kind === "play" && (
                            <Typography sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: COLORS.onSurface }}>+{m.points}</Typography>
                        )}
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

function describe(m: SentenceTilesMoveView, who: string): string {
    const line = (m.lineWords ?? []).join("");
    switch (m.kind) {
        case "play": return `${who}: ${line}`;
        case "rejected": return `${who} tried ${line} — rejected`;
        case "exchange": return `${who} swapped ${m.tileCount} tile${m.tileCount === 1 ? "" : "s"}`;
        case "pass": return `${who} passed`;
        case "resign": return `${who} resigned`;
    }
}
