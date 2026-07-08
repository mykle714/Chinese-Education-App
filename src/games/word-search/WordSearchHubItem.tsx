import React, { useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Box, Typography, IconButton, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from "@mui/material";
import { styled } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import { useTransition, animated } from "@react-spring/web";
import { useAuth } from "../../AuthContext";
import { useSlideNavigate } from "../../hooks/useSlideNavigate";
import { useDragScroll } from "../../hooks/useDragScroll";
import { cardBaseSx } from "../../components/hubMenuCardBase";
import { HubMenuCardTitle, HubMenuRowIconTile } from "../../components/HubMenu";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import type { GameDef } from "../types";
import { loadGameState, clearGameState, type SavedWordSearchState } from "./gameStateStorage";
import { MODE_CONFIGS, TOTAL_WORDS, formatTimeMs, modeLabel, type WordSearchMode } from "./constants";

/**
 * Word Search's Games-hub fan-out — a horizontally-scrolling strip of the two
 * mode buttons (Pinyin / No Pinyin), with a leading 1:1 RESUME card prepended
 * whenever a saved board exists.
 *
 * Behavior (see docs/WORD_SEARCH_GAME.md §3 / §5b):
 *  - Tapping a mode button ALWAYS starts a fresh game. Because both modes now
 *    share one saved slot, doing so would clobber any parked board, so if a
 *    save exists we confirm first ("your saved game will be lost").
 *  - The resume card (leading, 1:1) restores the single saved board in its
 *    saved mode — no warning, nothing is lost. Its ✕ erases the save; the strip
 *    then animates the mode buttons left to fill the gap (react-spring leave).
 *
 * This lives in the word-search feature (not GamesPage) because it owns
 * word-search-specific state (the saved board, the confirm dialog); GamesPage
 * just renders it in place of a generic HubMenuArrayItem. It reuses the shared
 * hub card look via the exported cardBaseSx / HubMenuCardTitle / HubMenuRowIconTile.
 */

/** Persistent per-mode background colors for the mode sub-cards (moved here from
    GamesPage now that the whole strip is word-search-owned). */
const WORD_SEARCH_MODE_COLORS: Record<WordSearchMode, string> = {
    "pinyin": COLORS.purpleAccent,
    "no-pinyin": COLORS.blueAccent,
};

/** Warm neutral fill for the resume card, distinct from both mode accents so it
    reads as a parked/saved board rather than a third mode. */
const RESUME_CARD_COLOR = COLORS.cardBeige;

// Horizontal strip. Mirrors HubMenu's ArrayScroll (padding 0 10% to line the
// first card up with a full-width row; native touch pan; hidden scrollbar), but
// spaces cards with per-child marginRight instead of a flex `gap` so the leaving
// resume card can collapse its width AND its trailing margin to zero together —
// a flex `gap` would leave a 16px stump until the item unmounted.
const Strip = styled(Box)(() => ({
    display: "flex",
    width: "100%",
    overflowX: "auto",
    padding: "0 10%",
    touchAction: "pan-x",
    scrollbarWidth: "none",
    "&::-webkit-scrollbar": { display: "none" },
}));

const ModeCard = styled(RouterLink, {
    shouldForwardProp: (prop) => prop !== "bgcolor",
})<{ bgcolor: string }>(({ bgcolor }) => ({
    ...cardBaseSx,
    flex: "0 0 70%",
    width: "70%",
    marginRight: 16,
    backgroundColor: bgcolor,
}));

const AnimatedResumeShell = animated(Box);

interface WordSearchHubItemProps {
    game: GameDef;
    /** Resolved game icon (image asset or fallback glyph) — same node reused on
        both mode cards. Built by GamesPage's resolveGameIcon. */
    icon: React.ReactNode;
    className?: string;
}

const WordSearchHubItem: React.FC<WordSearchHubItemProps> = ({ game, icon, className }) => {
    const { user } = useAuth();
    const userId = user?.id;
    const slideNavigate = useSlideNavigate();
    const scrollRef = useRef<HTMLDivElement | null>(null);
    useDragScroll(scrollRef);

    // Saved board (read once on mount). Both modes share this one slot; null when
    // there's nothing to resume. Erasing it (✕) sets this back to null, which
    // drives the leave animation.
    const [savedGame, setSavedGame] = useState<SavedWordSearchState | null>(() =>
        userId ? loadGameState(userId) : null
    );

    // Pending confirm: the mode a player tapped while a save existed, held until
    // they confirm losing it (or cancel).
    const [pendingMode, setPendingMode] = useState<WordSearchMode | null>(null);

    // Whether the resume square has flipped to its in-place "delete this saved
    // game?" confirmation face (armed by the ✕). The actual erase + collapse
    // only happens once the player confirms on that face.
    const [confirmingErase, setConfirmingErase] = useState(false);

    // Navigate into a fresh game for `mode`. resume:false → WordSearchPage always
    // fetches a new board.
    const startNewGame = (mode: WordSearchMode) => {
        slideNavigate(game.route, { state: { mode, resume: false } });
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
        slideNavigate(game.route, { state: { mode: savedGame.mode, resume: true } });
    };

    // ✕ arms the in-place confirmation (it does NOT erase yet).
    const armErase = (e: React.MouseEvent) => {
        e.stopPropagation(); // don't also trigger the card's resume tap
        e.preventDefault();
        setConfirmingErase(true);
    };

    const cancelErase = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setConfirmingErase(false);
    };

    // Confirming actually clears the save and collapses the square (via the
    // leave transition driven by savedGame → null).
    const confirmErase = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (userId) clearGameState(userId);
        setSavedGame(null);
    };

    // Leave-only animation for the resume card: it's already open on first paint
    // (`initial` == the enter state), and only the collapse-to-zero on erase is
    // animated. The square's WIDTH (flexBasis) AND its trailing margin shrink
    // together so the mode buttons slide fully left with no leftover gap.
    const resumeTransitions = useTransition(savedGame ? [savedGame] : [], {
        keys: () => "word-search-resume",
        initial: { flexBasis: "44%", opacity: 1, marginRight: 16 },
        from: { flexBasis: "0%", opacity: 0, marginRight: 0 },
        enter: { flexBasis: "44%", opacity: 1, marginRight: 16 },
        leave: { flexBasis: "0%", opacity: 0, marginRight: 0 },
        config: { tension: 260, friction: 30 },
    });

    return (
        <>
            <Strip ref={scrollRef} className={className ?? "word-search-hub"}>
                {resumeTransitions((style, saved) => (
                    <AnimatedResumeShell
                        className="word-search-hub__resume"
                        onClick={handleResume}
                        style={style}
                        sx={{
                            ...cardBaseSx,
                            // A true 1:1 square: flexBasis (animated above) is the
                            // width, aspectRatio makes height follow it, and
                            // alignSelf:center stops the flex row from stretching it
                            // to the (taller) mode cards' height — which would make
                            // it a rectangle and clip the stats. Tighter padding
                            // than a mode card so the four stat lines fit the square.
                            flexGrow: 0,
                            flexShrink: 0,
                            // min-width:auto (the flex default) would floor the
                            // collapse at the content's min-content width; 0 lets
                            // the width animate cleanly to nothing. border-box folds
                            // the padding INTO the animated flexBasis so a 0% basis
                            // is a truly 0-width card (content-box would leave the
                            // horizontal padding behind as a ~20px stump).
                            minWidth: 0,
                            // minHeight:0 too: with aspectRatio, min-height:auto
                            // (the default) floors the height at the stats' content
                            // height, and the 1:1 ratio then floors the WIDTH to
                            // match — leaving a stump. 0 frees both.
                            minHeight: 0,
                            boxSizing: "border-box",
                            alignSelf: "center",
                            aspectRatio: "1 / 1",
                            padding: 0,
                            overflow: "hidden",
                            cursor: "pointer",
                            backgroundColor: RESUME_CARD_COLOR,
                        }}
                    >
                        {/* All content lives in an absolutely-inset layer so it
                            contributes NO in-flow width to the flex item — that lets
                            the card's animated width collapse cleanly to 0 on erase
                            (in-flow text would otherwise floor it at its min-content
                            width). The layer fills the square when open and is
                            clipped by the card's overflow:hidden as it shrinks. */}
                        <Box
                            className="word-search-hub__resume-inner"
                            sx={{
                                position: "absolute",
                                inset: 0,
                                display: "flex",
                                flexDirection: "column",
                                // Left-aligned + vertically centered, like a real hub
                                // card (title top-left, details below) rather than a
                                // centered stat block.
                                justifyContent: "center",
                                alignItems: "flex-start",
                                gap: 0.5,
                                padding: "14px 16px",
                                overflow: "hidden",
                            }}
                        >
                            {confirmingErase ? (
                                // Delete-confirmation FACE — the ✕ flips the square to
                                // this in-place prompt instead of erasing immediately.
                                <>
                                    <Typography
                                        className="word-search-hub__delete-title"
                                        sx={{ fontSize: SIZE.bodyLg, fontWeight: WEIGHT.medium, color: COLORS.onSurface, fontFamily: FONTS.sans, lineHeight: LEADING.normal }}
                                    >
                                        Delete saved game?
                                    </Typography>
                                    <Box sx={{ display: "flex", gap: 0.75, mt: 0.25, width: "100%" }}>
                                        <Button
                                            className="word-search-hub__delete-cancel"
                                            onClick={cancelErase}
                                            size="small"
                                            sx={{ minWidth: 0, flex: 1, px: 1, py: 0.25, textTransform: "none", fontSize: SIZE.body, color: COLORS.textSecondary }}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            className="word-search-hub__delete-confirm"
                                            onClick={confirmErase}
                                            variant="contained"
                                            color="error"
                                            size="small"
                                            sx={{ minWidth: 0, flex: 1, px: 1, py: 0.25, textTransform: "none", fontSize: SIZE.body }}
                                        >
                                            Delete
                                        </Button>
                                    </Box>
                                </>
                            ) : (
                                // Normal resume FACE.
                                <>
                                    <IconButton
                                        className="word-search-hub__resume-erase"
                                        size="small"
                                        aria-label="Delete saved game"
                                        onClick={armErase}
                                        sx={{ position: "absolute", top: 8, right: 8, p: 0.25, color: COLORS.textSecondary }}
                                    >
                                        <CloseIcon sx={{ fontSize: 18 }} />
                                    </IconButton>
                                    {/* "Resume" styled exactly like a hub-card title
                                        (matches HubMenuCardTitle: bodyLg / medium / onSurface). */}
                                    <Typography
                                        className="word-search-hub__resume-title"
                                        sx={{ fontSize: SIZE.bodyLg, fontWeight: WEIGHT.medium, color: COLORS.onSurface, fontFamily: FONTS.sans, lineHeight: LEADING.normal, whiteSpace: "nowrap" }}
                                    >
                                        Resume
                                    </Typography>
                                    {/* Timer + found count inlined on one row to save
                                        vertical space; mode on its own line below. */}
                                    <Typography
                                        className="word-search-hub__resume-stats"
                                        sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, fontFamily: FONTS.sans, lineHeight: LEADING.normal, whiteSpace: "nowrap" }}
                                    >
                                        ⏱ {formatTimeMs(saved.elapsedMs)} · {saved.found.length}/{TOTAL_WORDS}
                                    </Typography>
                                    <Typography
                                        className="word-search-hub__resume-mode"
                                        sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.medium, color: COLORS.onSurface, fontFamily: FONTS.sans, lineHeight: LEADING.normal, whiteSpace: "nowrap" }}
                                    >
                                        {modeLabel(saved.mode)}
                                    </Typography>
                                </>
                            )}
                        </Box>
                    </AnimatedResumeShell>
                ))}

                {MODE_CONFIGS.map((cfg) => (
                    <ModeCard
                        key={`${game.gameId}-${cfg.mode}`}
                        to={game.route}
                        onClick={(e) => handleModeClick(e, cfg.mode)}
                        bgcolor={WORD_SEARCH_MODE_COLORS[cfg.mode] ?? game.bgColor}
                        className={`word-search-hub__mode-card word-search-hub__mode-card--${cfg.mode}`}
                    >
                        <HubMenuCardTitle title={game.title} subtitle={cfg.label} />
                        <HubMenuRowIconTile className="word-search-hub__mode-icon">{icon}</HubMenuRowIconTile>
                    </ModeCard>
                ))}
            </Strip>

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
