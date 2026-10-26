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
 * Its AUDIO CHIP is the shared AudioModeChip with no fill (`tone="bare"`): its glyph and
 * label in plain white, the same in every audio mode — the label carries the state — held
 * together by a thin white pill OUTLINE (`AUDIO_OUTLINE_SX`) so they read as one button.
 * The box is sized to the longest label (`fitLabels`), so it does not resize as it cycles.
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

/**
 * The bare audio label's type and glyph, px — a step up from the header chip's 10 px / 13 px
 * now that there is no fill to carry it.
 */
const AUDIO_TEXT_PX = 12;
const AUDIO_ICON_PX = 15;

/**
 * The outline that bundles the bare glyph + label into one button. White, like the header
 * ink over the sky, rather than the app's `COLORS.border` (--line2): a grey hairline is
 * built for paper and goes muddy on the sky. Pill ends, like the tower's other plates.
 */
const AUDIO_OUTLINE_SX = {
    border: `1px solid ${COLORS.white}`,
    borderRadius: "999px",
    padding: "4px 10px",
} as const;

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
                    tone="bare"
                    ink={ON_SKY_INK}
                    sx={{ ...AUDIO_OUTLINE_SX, fontSize: AUDIO_TEXT_PX }}
                    // The tower re-faces all text (index.css `.tower-font-trial`), so the
                    // chip's mono `ch` width would be wrong: size to the real labels.
                    fitLabels
                    iconPx={AUDIO_ICON_PX}
                />
            </>
        }
    />
);

export default TowerStudyHeader;
