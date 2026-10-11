import { Chip } from "@mui/material";
import type { VocabEntry } from "../../types";
import { getBandMid } from "../../utils/categoryColors";
import { SIZE, WEIGHT } from "../../theme/scale";
import { MetadataChipRow } from "./FlashcardsLearnPage/styled";
import { FC_FONT } from "./constants";
import { COLORS } from "../../theme/colors";

// The category badge row for the read-only dictionary cdp (DictionaryCardDetailPage),
// shown above its inline eip panel. See docs/LEAF_NODE_PAGES.md.
//
// This file used to also hold `VocabCardSections` — the stacked Definition / Breakdown
// / Examples / Synonyms boxes the dictionary cdp drew below its hero card. Deleted
// 2026-10-10: the dictionary cdp now mounts the eip panel itself (InfoCardPanelBody),
// so both cdps show the word's extra info through the same component.

// Badge pills — category only (color-coded). Difficulty used to sit here as a second
// pill, but it now lives in the eip definition tab's meta strip (DefinitionFacts)
// alongside Parts of Speech + Commonality.
export const VocabCardBadges: React.FC<{ entry: VocabEntry }> = ({ entry }) => {
    if (!entry.category) return null;
    return (
        <MetadataChipRow className="vocab-card-detail__badges-row" sx={{ justifyContent: "flex-start", marginBottom: 0 }}>
            <Chip
                className="vocab-card-detail__category-chip"
                label={entry.category}
                size="small"
                sx={{
                    // v2: a band CHIP takes the band's MID tier (artboard 18's band
                    // pill is `--{hue}K` = `--{hue}M`), not the large-fill surface.
                    // Ink + the ramp's inset ring: white text is unreadable on any
                    // ramp fill, and the ring keeps the pill's edge on the card.
                    backgroundColor: getBandMid(entry.category),
                    color: COLORS.onSurface,
                    boxShadow: `inset 0 0 0 1px ${COLORS.markOutline}`,
                    fontSize: SIZE.micro,
                    fontWeight: WEIGHT.bold,
                    fontFamily: FC_FONT,
                    height: 22,
                }}
            />
        </MetadataChipRow>
    );
};
