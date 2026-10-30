import React from "react";
import PageHeader, { HeaderIconButton } from "../../../components/PageHeader";
import AudioModeChip from "../../../components/AudioModeChip";
import { COLORS } from "../../../theme/colors";
import type { LastMarkUndoSnapshot } from "../types";

/**
 * TowerStudyHeader — the flp's header when the session runs inside the Deck Tower, over
 * the tower's sky (docs/DECK_TOWER.md § "Studying the tower"; FlpTowerHost).
 *
 * The same controls as FlashcardsLearnHeader — back, undo, the narration chip, and the
 * minute-points flame PageHeader always draws — in the Deck Tower's own header style: the
 * shelf-redesign PageHeader with no bar, its title and back arrow in white so they read
 * on the sky and on space (`titleColor`), like the tower page's own header. The title
 * names the deck being studied rather than a category: a tower session is always the
 * world's whole Learning deck.
 *
 * Its AUDIO CHIP is the shared AudioModeChip's `outlined` skin in white: no fill, its glyph
 * and label in plain white, the same in every audio mode — the label carries the state —
 * held together by a thin white pill outline so they read as one button. The scp uses the
 * same skin in its ground's ink. The box is sized to the longest label, so it does not
 * resize as it cycles.
 * A filled chip (it was a grey floor plate until 2026-10-26) drew the eye off the card.
 *
 * Its PLATFORM TOGGLE (an eye, crossed out while on) hides the tower's whole platform under
 * the cards (FlpTowerHost `platformHidden`; docs/DECK_TOWER.md § "Studying the tower" →
 * "Hiding the platform"). The icon shows the platform's state: open eye = seen.
 *
 * Kept separate from FlashcardsLearnHeader (rather than a `tone` flag on it) because the
 * two headers stand on different grounds and are expected to diverge — this one belongs
 * to the tower's look.
 *
 * Layer: feature view (src/features/flashcards). Rendered by FlashcardsLearnPage when it
 * has a `tower` host.
 */
interface TowerStudyHeaderProps {
    title: string;
    lastMarkUndoSnapshot: LastMarkUndoSnapshot | null;
    isAnimating: boolean;
    isUndoing: boolean;
    onBack: () => void;
    onUndo: () => void;
    /** The icon-layout editor is open: undo is meaningless then (see FlashcardsLearnHeader). */
    editMode: boolean;
    /** The tower's platform is faded out under the cards (FlpTowerHost `platformHidden`). */
    platformHidden: boolean;
    onPlatformHiddenChange: (hidden: boolean) => void;
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
    platformHidden,
    onPlatformHiddenChange,
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
                <HeaderIconButton
                    className="tower-study-header__platform-toggle"
                    icon={platformHidden ? "visibility_off" : "visibility"}
                    label={platformHidden ? "Show the platform" : "Hide the platform"}
                    color={ON_SKY_INK}
                    onClick={() => onPlatformHiddenChange(!platformHidden)}
                />
                <AudioModeChip
                    className="tower-study-header__audio-chip"
                    outlined
                    ink={ON_SKY_INK}
                />
            </>
        }
    />
);

export default TowerStudyHeader;
