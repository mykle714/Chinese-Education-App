import React from "react";
import { Box } from "@mui/material";
import PageHeader, { HeaderIconButton } from "../../../components/PageHeader";
import AudioModeChip from "../../../components/AudioModeChip";
import { COLORS } from "../../../theme/colors";
import type { LastMarkUndoSnapshot } from "../types";

/**
 * TowerStudyHeader — the flp's header. The flp runs only inside the Deck Tower, so this
 * is drawn over the tower's sky (docs/DECK_TOWER.md § "Studying the tower"; FlpTowerHost).
 *
 * Its controls — back, undo, the narration chip, and the minute-points flame PageHeader
 * always draws — are in the Deck Tower's own header style: the
 * shelf-redesign PageHeader with no bar, its back arrow in white so it reads on the sky
 * and on space (`titleColor`), like the tower page's own header. It has NO TITLE
 * (dropped 2026-11-08; it named the world — "Flashcards" / "Reading" / "Writing"): the
 * row's width is kept for the session's controls.
 *
 * Its AUDIO CHIP is the shared AudioModeChip's `outlined` skin in white: no fill, its glyph
 * and label in plain white, the same in every audio mode — the label carries the state —
 * held together by a thin white pill outline so they read as one button. The acp uses the
 * same skin in its ground's ink. The box is sized to the longest label, so it does not
 * resize as it cycles. Its label face (975 Maru, like the session's other lettering) comes
 * from the shared outlined skin (`outlinedChipSx`), not from this header.
 * A filled chip (it was a grey floor plate until 2026-10-26) drew the eye off the card.
 *
 * (The plain-paper FlashcardsLearnHeader it once sat beside was deleted with the
 * standalone flp route on 2026-11-04.)
 *
 * Layer: feature view (src/features/flashcards). Rendered by FlashcardsLearnPage.
 */
interface TowerStudyHeaderProps {
    lastMarkUndoSnapshot: LastMarkUndoSnapshot | null;
    isAnimating: boolean;
    isUndoing: boolean;
    onBack: () => void;
    onUndo: () => void;
    /** The icon-layout editor is open: undo is disabled while it is. */
    editMode: boolean;
    /**
     * A game break's area is up: its own header row (GameBreakChrome) is drawn at these
     * same spots from the first frame of the grow, so this header steps aside — kept in
     * the layout (`visibility`, so nothing under it moves) but invisible and untappable,
     * and WITHOUT its flame: every flame runs its own minute-points accrual tick, and the
     * break's row has the one flame while it is up.
     */
    hidden: boolean;
}

/** The header's ink over the sky — the tower page header's (DeckTowerPage `headerTitleColor`). */
const ON_SKY_INK = COLORS.white;

const TowerStudyHeader: React.FC<TowerStudyHeaderProps> = ({
    lastMarkUndoSnapshot,
    isAnimating,
    isUndoing,
    onBack,
    onUndo,
    editMode,
    hidden,
}) => (
    // `display: contents` keeps PageHeader the flex child it always was; `visibility`
    // inherits through it.
    <Box className="tower-study-header" sx={{ display: "contents", visibility: hidden ? "hidden" : "visible" }}>
    <PageHeader
        onBack={onBack}
        showFlame={!hidden}
        // A lateral arrow, not the drill-in chevron: the learner is still on the tower
        // page, and back flies the camera out rather than closing a page.
        arrowDirection="left"
        size="dense"
        titleColor={ON_SKY_INK}
        rightContent={
            <>
                <HeaderIconButton
                    className="tower-study-header__undo"
                    icon="undo"
                    label="Undo last mark"
                    color={ON_SKY_INK}
                    onClick={onUndo}
                    disabled={!lastMarkUndoSnapshot || isAnimating || isUndoing || editMode}
                />
                <AudioModeChip
                    className="tower-study-header__audio-chip"
                    ink={ON_SKY_INK}
                />
            </>
        }
    />
    </Box>
);

export default TowerStudyHeader;
