import React, { useState } from "react";
import { Box, Typography, IconButton, Button } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS, RAMP } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import { GameOptionTile, OPTION_TITLE_SX } from "../shared/GameCard";
import { GAME_HUE } from "./constants";

interface WordSearchResumeTileProps {
    /** Tap on the normal face. Never fires while the delete-confirm face is armed. */
    onResume: (e: React.MouseEvent) => void;
    /** The ✕ → Delete confirmation went through; the caller clears the save slot. */
    onErase: () => void;
    /** BEM block of the launching surface (`games-page`, `reading-games-carousel`). */
    classPrefix: string;
    /** The game's registry glyph — worn as the tile's corner ghost, echoing the
     *  parent card's ghost. */
    glyph: string;
}

/**
 * The parked-board RESUME tile — shared by both Word Search launch surfaces: the Games
 * hub (`WordSearchHubItem`, Pinyin slot) and the Reading Center games carousel
 * (`ReadingGamesCarousel`, No Pinyin slot), both placing it through
 * `buildWordSearchCard` as the `GameCard`'s "resume" option, so the two cannot drift
 * apart. Drawn on `GameOptionTile` — the SAME shell as a Bubble Match level tile, so
 * radius / padding / floor / outline / title type are shared, not copied. Spans TWO
 * of GameCard's option slots (two Bubble Match levels plus the gap between them,
 * ~180–207px × 62px): the delete face reads "Delete?" with Cancel / Delete stacked.
 *
 * Ground is the card hue's TINT tier (`RAMP[GAME_HUE].tint`) — the near-white second
 * tone of the purple card, so it reads as part of the card yet stands off it. The
 * normal face wears the game glyph as a small corner ghost (the parent card's ghost,
 * scaled down), pulled inward (`ERASE_CLEAR_RIGHT`) so it sits just left of the ✕
 * instead of under it.
 *
 * Normal face: just "Resume" and a ✕ in the top-right corner — no parked time or
 * found count (the tile is a plain way back in, not a progress readout). No mode label: each launch surface owns exactly one save
 * slot (hub = Pinyin, Reading Center = No Pinyin), so the mode is implied by where
 * the tile sits. The ✕ flips the tile in place to a
 * delete-confirm face; only its Delete calls `onErase`.
 *
 * Layer: feature component (src/games/word-search). The host owns the save slot and
 * navigation; this tile owns only the armed/unarmed face state.
 * Docs: docs/WORD_SEARCH_GAME.md § "Resume card", docs/READING_WRITING_CENTERS.md.
 */
/** The ghost's right offset: the ✕ button sits at right 4 and is ~20px wide (16px
 *  glyph + 2px padding each side), so a ghost whose right edge is at 26px clears it. */
const ERASE_CLEAR_RIGHT = 26;

const WordSearchResumeTile: React.FC<WordSearchResumeTileProps> = ({
    onResume, onErase, classPrefix, glyph,
}) => {
    // Whether the ✕ has flipped the tile to its "delete this saved game?" face.
    const [confirmingErase, setConfirmingErase] = useState(false);

    const handleClick = (e: React.MouseEvent) => {
        if (confirmingErase) return; // the delete-confirm face owns taps while armed
        onResume(e);
    };

    // ✕ arms the in-place confirmation (it does NOT erase yet).
    const armErase = (e: React.MouseEvent) => {
        e.stopPropagation(); // don't also trigger the tile's resume tap
        e.preventDefault();
        setConfirmingErase(true);
    };

    const cancelErase = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setConfirmingErase(false);
    };

    const confirmErase = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onErase();
    };

    // The buttons drop their vertical padding and pin a 16px line so the stacked
    // title + two buttons fit a 62px-tall slot.
    const buttonSx = { py: 0, minHeight: 0, lineHeight: "16px" };

    return (
        // The card hue's near-white tint tier. A `div` (not a button): both faces
        // contain buttons of their own. The ghost glyph shows on the normal face only —
        // behind the delete-confirm copy it would just be noise.
        <GameOptionTile
            className={`${classPrefix}__resume`}
            ground={RAMP[GAME_HUE].tint}
            onClick={handleClick}
            glyph={confirmingErase ? undefined : glyph}
            glyphClassName={`${classPrefix}__resume-ghost`}
            glyphRight={ERASE_CLEAR_RIGHT}
        >
            {confirmingErase ? (
                // Delete-confirmation FACE. ABSOLUTELY INSET, and that is load-bearing:
                // a flex row sizes its cross axis to its tallest item, so anything this
                // face measured would become the height of the tiles beside it (arming
                // the ✕ used to grow the whole hub strip). Out of flow it contributes
                // nothing; the row's height stays owned by its other tiles.
                // (docs/WORD_SEARCH_GAME.md § "Resume card".)
                <Box
                    className={`${classPrefix}__delete-face`}
                    sx={{
                        position: "absolute",
                        inset: "6px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                    }}
                >
                    <Typography
                        className={`${classPrefix}__delete-title`}
                        // The copy must hold ONE line — the inset face is clipped rather
                        // than able to push the tile taller, and a ~86–100px level slot
                        // only fits "Delete?".
                        sx={{
                            fontSize: SIZE.caption, fontWeight: WEIGHT.semibold, color: COLORS.onSurface,
                            fontFamily: FONTS.sans, lineHeight: LEADING.tight, whiteSpace: "nowrap",
                            textAlign: "center",
                        }}
                    >
                        Delete?
                    </Typography>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: "2px", mt: "2px" }}>
                        <Button
                            className={`${classPrefix}__delete-cancel`}
                            onClick={cancelErase}
                            size="small"
                            sx={{ minWidth: 0, flex: 1, px: 0.5, ...buttonSx, textTransform: "none", fontSize: SIZE.caption, color: COLORS.textSecondary }}
                        >
                            Cancel
                        </Button>
                        <Button
                            className={`${classPrefix}__delete-confirm`}
                            onClick={confirmErase}
                            variant="contained"
                            color="error"
                            size="small"
                            sx={{ minWidth: 0, flex: 1, px: 0.5, ...buttonSx, textTransform: "none", fontSize: SIZE.caption }}
                        >
                            Delete
                        </Button>
                    </Box>
                </Box>
            ) : (
                // Normal resume FACE — the shell foot-aligns it, so it shares a baseline
                // with the level tiles beside it.
                <>
                    <IconButton
                        className={`${classPrefix}__resume-erase`}
                        size="small"
                        aria-label="Delete saved game"
                        onClick={armErase}
                        sx={{ position: "absolute", top: 4, right: 4, p: 0.25, color: COLORS.textSecondary }}
                    >
                        <Icon name="close" size={16} />
                    </IconButton>
                    <Typography
                        className={`${classPrefix}__resume-title`}
                        sx={{ ...OPTION_TITLE_SX, whiteSpace: "nowrap" }}
                    >
                        Resume
                    </Typography>
                </>
            )}
        </GameOptionTile>
    );
};

export default WordSearchResumeTile;
