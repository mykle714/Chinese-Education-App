import React from "react";
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
 * shelf-redesign PageHeader with no bar, its title and back arrow in white so they read
 * on the sky and on space (`titleColor`), like the tower page's own header. The title
 * names the deck being studied rather than a category: a tower session is always the
 * world's whole Learning deck.
 *
 * Its AUDIO CHIP is the shared AudioModeChip's `outlined` skin in white: no fill, its glyph
 * and label in plain white, the same in every audio mode — the label carries the state —
 * held together by a thin white pill outline so they read as one button. The ancp uses the
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
    title: string;
    lastMarkUndoSnapshot: LastMarkUndoSnapshot | null;
    isAnimating: boolean;
    isUndoing: boolean;
    onBack: () => void;
    onUndo: () => void;
    /** The icon-layout editor is open: undo is disabled while it is. */
    editMode: boolean;
}

/** The header's ink over the sky — the tower page header's (DeckTowerPage `headerTitleColor`). */
const ON_SKY_INK = COLORS.white;

const TowerStudyHeader: React.FC<TowerStudyHeaderProps> = ({
    title,
    lastMarkUndoSnapshot,
    isAnimating,
    isUndoing,
    onBack,
    onUndo,
    editMode,
}) => (
    <PageHeader
        title={title}
        onBack={onBack}
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
);

export default TowerStudyHeader;
