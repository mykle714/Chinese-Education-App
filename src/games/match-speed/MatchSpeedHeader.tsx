import React from "react";
import { HeaderIconButton } from "../../components/PageHeader";

interface MatchSpeedHeaderProps {
    /** Open the settings sheet (pinyin / tone colors / autoplay). */
    onSettingsClick: () => void;
}

/**
 * Right-side header controls for Match Speed: the settings cog and the
 * minute-points fire badge, and nothing else.
 *
 * The pinyin / color / autoplay toggles used to live here inline and the run clock
 * sat beside them; the toggles moved into MatchSpeedSettingsDialog (they are
 * set-once-and-forget, not per-tap controls) and the clock moved to a bar above the
 * board — it belongs to the play area, where the player is already looking, not to
 * the page chrome. See MatchSpeedTimerBar.
 *
 * Match Speed is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md), so the header + down
 * chevron come from LeafPage/LeafPageHeader; this component just fills LeafPage's
 * `rightContent` slot.
 *
 * See docs/MATCH_SPEED_GAME.md § Page shell, header, and chrome.
 */
const MatchSpeedHeaderControls: React.FC<MatchSpeedHeaderProps> = ({ onSettingsClick }) => (
    <>
        <HeaderIconButton
            className="match-speed__settings-btn"
            icon="settings"
            label="Open settings"
            onClick={onSettingsClick}
        />
    </>
);

export default MatchSpeedHeaderControls;
