import React, { useState } from "react";
import { Box, Typography, IconButton, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from "@mui/material";
import { useTransition, animated } from "@react-spring/web";
import { useAuth } from "../../AuthContext";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import Icon from "../../components/Icon";
import { BentoStrip, BentoSubTile } from "../../components/bento";
import { useGameWins } from "../../hooks/useGameWins";
import { withCollectionParams } from "../../features/flashcards/collectionRef";
import { useSelectedCollection } from "../../features/flashcards/selectedCollection";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import type { GameDef } from "../types";
import { loadGameState, clearGameState, type SavedWordSearchState } from "./gameStateStorage";
import { GAME_KEY, MODE_CONFIGS, TOTAL_WORDS, modeLabel, modeMarkTypes, type WordSearchMode } from "./constants";
import { formatTimeMs } from "../../utils/timeUtils";
import { MARK_TYPE_LABELS } from "../../utils/masteryCompute";

/**
 * Word Search's Games-hub fan-out — a `BentoStrip` of the two mode sub-tiles
 * (Pinyin / No Pinyin), with a leading RESUME sub-tile whenever a saved board exists.
 *
 * Behavior (see docs/WORD_SEARCH_GAME.md §3 / §5b):
 *  - Tapping a mode ALWAYS starts a fresh game. Because both modes share one saved
 *    slot, doing so would clobber any parked board, so if a save exists we confirm
 *    first ("your saved game will be lost").
 *  - Each mode sub-tile's SUBTITLE is the mastery track(s) it feeds. Unlike every
 *    other game, Word Search's two modes feed DIFFERENT tracks — Pinyin → production,
 *    No Pinyin → reading AND production (its prompt is an English gloss, so the find
 *    is recall; its grid is bare characters, so confirming it is reading). Read per
 *    mode through `modeMarkTypes()` — the same list WordSearchPage marks with, so the
 *    label stays unfalsifiable. This replaces the `MarkTypeChip` the old hub card
 *    carried: the artboard puts the track in the subtitle slot ("No Pinyin" over
 *    "Reading & Production"), and a sub-tile has no edge slot to hang a chip in.
 *  - The resume tile restores the single saved board in its saved mode — no warning,
 *    nothing is lost. Its ✕ arms an in-place "delete this?" face; confirming erases
 *    the save and the strip animates the mode tiles left to fill the gap.
 *
 * This lives in the word-search feature (not GamesPage) because it owns
 * word-search-specific state (the saved board, the confirm dialog); GamesPage just
 * renders it in place of a generic strip.
 *
 * Layer: feature component (src/games) built on the shared bento primitive
 * (docs/SHELF_REDESIGN.md § A4).
 */

/** Per-mode ramp hues. The artboard gives BOTH modes `--pur`, because they are two
    faces of one game rather than two difficulties — the colour says "Word Search",
    and the titles say which mode. Kept as a table so that stays a decision. */
const WORD_SEARCH_MODE_HUES: Record<WordSearchMode, "pur"> = {
    "pinyin": "pur",
    "no-pinyin": "pur",
};

/** The resume tile is a real third member of the strip's flex row, so the two mode
    tiles narrow to make room for it and widen again when it is erased. */
const AnimatedTile = animated(Box);

interface WordSearchHubItemProps {
    game: GameDef;
    className?: string;
}

const WordSearchHubItem: React.FC<WordSearchHubItemProps> = ({ game, className }) => {
    const { user } = useAuth();
    const userId = user?.id;
    const slideNavigate = useSlideNavigate();

    // Game-wide lifetime win count for the strip header. Word Search logs every
    // completion under one level bucket, so this is already mode-agnostic; the mode
    // sub-tiles carry no count of their own.
    const { totalWins } = useGameWins(GAME_KEY);

    // The collection chosen in the hub's chip. This strip builds its own links (it
    // navigates imperatively, to confirm before clobbering a save), so unlike a plain
    // tile it has to apply the params itself.
    const selectedCollection = useSelectedCollection();
    const newGamePath = withCollectionParams(game.route, selectedCollection);

    // Saved board (read once on mount). Both modes share this one slot; null when
    // there's nothing to resume. Erasing it (✕) sets this back to null, which drives
    // the leave animation.
    const [savedGame, setSavedGame] = useState<SavedWordSearchState | null>(() =>
        userId ? loadGameState(userId) : null
    );

    // Pending confirm: the mode a player tapped while a save existed, held until they
    // confirm losing it (or cancel).
    const [pendingMode, setPendingMode] = useState<WordSearchMode | null>(null);

    // Whether the resume tile has flipped to its in-place "delete this saved game?"
    // face (armed by the ✕). The erase + collapse only happens on confirm.
    const [confirmingErase, setConfirmingErase] = useState(false);

    // Navigate into a fresh game for `mode`. resume:false → WordSearchPage always
    // fetches a new board.
    const startNewGame = (mode: WordSearchMode) => {
        slideNavigate(newGamePath, { state: { mode, resume: false } });
    };

    const handleModeClick = (e: React.MouseEvent, mode: WordSearchMode) => {
        // Leave modified clicks (new tab/window) to the underlying RouterLink.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (savedGame) {
            setPendingMode(mode); // warn before clobbering the parked board
            return;
        }
        startNewGame(mode);
    };

    const confirmNewGame = () => {
        if (!pendingMode) return;
        if (userId) clearGameState(userId);
        setSavedGame(null);
        const mode = pendingMode;
        setPendingMode(null);
        startNewGame(mode);
    };

    const handleResume = (e: React.MouseEvent) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (!savedGame) return;
        if (confirmingErase) return; // the delete-confirm face owns taps while armed
        // NO collection params on a resume: the saved board was already built from
        // whatever set was selected when it started, and nothing refetches mid-game —
        // appending today's selection would only make the URL claim a set the grid on
        // screen doesn't come from.
        slideNavigate(game.route, { state: { mode: savedGame.mode, resume: true } });
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

    // Confirming actually clears the save and collapses the tile (via the leave
    // transition driven by savedGame → null).
    const confirmErase = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (userId) clearGameState(userId);
        setSavedGame(null);
    };

    // Leave-only animation for the resume tile: it is already open on first paint
    // (`initial` == the enter state), and only the collapse-to-zero on erase is
    // animated.
    //
    // `marginRight` goes to -9 on the way out, not 0: the strip's row spaces its
    // sub-tiles with a 9px flex GAP, and a gap survives its item shrinking to zero
    // width — so without cancelling it the erase would leave a 9px stump until the
    // element unmounted. (The pre-bento version dodged this by spacing with per-child
    // margins instead of a gap; the shared primitive uses a gap, so the tile cancels
    // it here rather than the primitive giving up gaps for one caller.)
    const resumeTransitions = useTransition(savedGame ? [savedGame] : [], {
        keys: () => "word-search-resume",
        initial: { flexGrow: 1, opacity: 1, marginRight: 0 },
        from: { flexGrow: 0.001, opacity: 0, marginRight: -9 },
        enter: { flexGrow: 1, opacity: 1, marginRight: 0 },
        leave: { flexGrow: 0.001, opacity: 0, marginRight: -9 },
        config: { tension: 260, friction: 30 },
    });

    return (
        <>
            <BentoStrip
                className={className ?? "word-search-hub"}
                label={game.title}
                meta={`×${totalWins} wins`}
            >
                    {resumeTransitions((style, saved) => (
                        <AnimatedTile
                            className="word-search-hub__resume"
                            onClick={handleResume}
                            style={style}
                            sx={{
                                position: "relative",
                                flexBasis: 0,
                                // min-width:auto (the flex default) would floor the
                                // collapse at the content's min-content width; 0 lets
                                // the tile animate cleanly to nothing.
                                minWidth: 0,
                                borderRadius: "15px",
                                padding: "11px",
                                minHeight: 80,
                                overflow: "hidden",
                                cursor: "pointer",
                                // Warm neutral, distinct from both mode hues so it reads
                                // as a parked board rather than a third mode.
                                backgroundColor: COLORS.cardBeige,
                            }}
                        >
                            {confirmingErase ? (
                                // Delete-confirmation FACE — the ✕ flips the tile to
                                // this in-place prompt instead of erasing immediately.
                                <>
                                    <Typography
                                        className="word-search-hub__delete-title"
                                        sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.semibold, color: COLORS.onSurface, fontFamily: FONTS.sans, lineHeight: LEADING.normal }}
                                    >
                                        Delete saved game?
                                    </Typography>
                                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                                        <Button
                                            className="word-search-hub__delete-cancel"
                                            onClick={cancelErase}
                                            size="small"
                                            sx={{ minWidth: 0, flex: 1, px: 0.5, py: 0.25, textTransform: "none", fontSize: SIZE.caption, color: COLORS.textSecondary }}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            className="word-search-hub__delete-confirm"
                                            onClick={confirmErase}
                                            variant="contained"
                                            color="error"
                                            size="small"
                                            sx={{ minWidth: 0, flex: 1, px: 0.5, py: 0.25, textTransform: "none", fontSize: SIZE.caption }}
                                        >
                                            Delete
                                        </Button>
                                    </Box>
                                </>
                            ) : (
                                // Normal resume FACE. Laid out like a sub-tile: content
                                // at the foot, so it sits on the same baseline as the
                                // mode tiles beside it.
                                <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                                    <IconButton
                                        className="word-search-hub__resume-erase"
                                        size="small"
                                        aria-label="Delete saved game"
                                        onClick={armErase}
                                        sx={{ position: "absolute", top: 4, right: 4, p: 0.25, color: COLORS.textSecondary }}
                                    >
                                        <Icon name="close" size={16} />
                                    </IconButton>
                                    <Typography
                                        className="word-search-hub__resume-title"
                                        sx={{ fontSize: 12.5, fontWeight: WEIGHT.semibold, color: COLORS.onSurface, fontFamily: FONTS.sans, whiteSpace: "nowrap" }}
                                    >
                                        Resume
                                    </Typography>
                                    <Typography
                                        className="word-search-hub__resume-stats"
                                        sx={{ fontSize: 10.5, color: COLORS.textSecondary, fontFamily: FONTS.mono, whiteSpace: "nowrap" }}
                                    >
                                        {formatTimeMs(saved.elapsedMs)} · {saved.found.length}/{TOTAL_WORDS}
                                    </Typography>
                                    <Typography
                                        className="word-search-hub__resume-mode"
                                        sx={{ fontSize: 10.5, color: COLORS.textSecondary, fontFamily: FONTS.sans, whiteSpace: "nowrap" }}
                                    >
                                        {modeLabel(saved.mode)}
                                    </Typography>
                                </Box>
                            )}
                        </AnimatedTile>
                    ))}

                    {MODE_CONFIGS.map((cfg) => (
                        <BentoSubTile
                            key={`${game.gameId}-${cfg.mode}`}
                            className={`word-search-hub__mode-tile word-search-hub__mode-tile--${cfg.mode}`}
                            to={newGamePath}
                            hue={WORD_SEARCH_MODE_HUES[cfg.mode] ?? game.hue}
                            icon="grid_on"
                            title={modeLabel(cfg.mode)}
                            // The mastery track(s) this mode feeds, straight from the
                            // mode config — see the header note on why it lives here.
                            // No Pinyin reads "Reading & Production": it is the one
                            // board that clears two tracks per find.
                            subtitle={modeMarkTypes(cfg).map((t) => MARK_TYPE_LABELS[t]).join(" & ")}
                            onClick={(e) => handleModeClick(e, cfg.mode)}
                        />
                    ))}
            </BentoStrip>

            <Dialog
                className="word-search-hub__confirm-dialog"
                open={pendingMode !== null}
                onClose={() => setPendingMode(null)}
                maxWidth="xs"
            >
                <DialogTitle sx={{ fontSize: SIZE.bodyLg, fontWeight: WEIGHT.bold }}>Start a new game?</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ fontSize: SIZE.body }}>
                        Starting a new game will erase your saved Word Search game
                        {savedGame ? ` (${modeLabel(savedGame.mode)}, ${savedGame.found.length}/${TOTAL_WORDS} found)` : ""}.
                        This can't be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button className="word-search-hub__confirm-cancel" onClick={() => setPendingMode(null)} size="small">
                        Cancel
                    </Button>
                    <Button className="word-search-hub__confirm-start" onClick={confirmNewGame} variant="contained" color="error" size="small">
                        Start new game
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default WordSearchHubItem;
