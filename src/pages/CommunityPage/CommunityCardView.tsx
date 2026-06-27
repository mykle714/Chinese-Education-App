import { useMemo } from "react";
import { Box, useTheme } from "@mui/material";
import CardIconLayer from "../FlashcardsLearnPage/CardIconLayer";
import { ChineseBlock, EnglishBlock } from "../FlashcardsLearnPage/FlashCardSection";
import type { CommunityDesign, VocabEntry } from "../../types";

/**
 * Large read-only render of a community design used by the zoom (docs/COMMUNITY_PAGE.md). Lays
 * out the information EXACTLY like the flp flashcard's second side (back face): the saved icon
 * arrangement fills the face behind the content, and the lower third holds the cpcd word
 * (`ChineseBlock`) above the English definition (`EnglishBlock`) — the same components and
 * geometry (`top: 66.67%`, padding `clamp(16px,7%,72px) 30px`) as `CardFaceSide` in
 * FlashCardSection.tsx. The interactive audio/writing buttons are omitted (no `onSpeak`,
 * `showWriting` off) since this is a preview.
 */
const CommunityCardView: React.FC<{
  design: CommunityDesign;
  width: number;
  height: number;
}> = ({ design, width, height }) => {
  const fc = useTheme().palette.flashcard;

  // Adapt to the VocabEntry shape the back-face blocks consume.
  const entry = useMemo(
    () =>
      ({
        id: 0,
        entryKey: design.entryKey,
        language: design.language,
        pronunciation: design.pronunciation,
        definition: design.definition,
        iconLayout: design.iconLayout,
      }) as unknown as VocabEntry,
    [design],
  );

  const hasIcons = !!design.iconLayout && design.iconLayout.length > 0;

  return (
    <Box
      className="community-card-view"
      sx={{
        width,
        height,
        flexShrink: 0,
        position: "relative",
        backgroundColor: fc.flashCard,
        borderRadius: "12px",
        overflow: "hidden",
        boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
      }}
    >
      {/* Icon arrangement behind the content (same layer the flashcard uses). */}
      {hasIcons && <CardIconLayer layout={design.iconLayout!} />}

      {/* Content padded + positioned in the lower third, mirroring CardFaceSide/CardContent. */}
      <Box
        sx={{
          width: "100%",
          height: "100%",
          padding: "clamp(16px, 7%, 72px) 30px",
          boxSizing: "border-box",
          position: "relative",
          zIndex: 1,
        }}
      >
        <Box sx={{ position: "relative", height: "100%", width: "100%", minHeight: 0 }}>
          <Box
            sx={{
              position: "absolute",
              top: "66.67%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              alignItems: "center",
              boxSizing: "border-box",
            }}
          >
            <ChineseBlock entry={entry} showPinyin showPinyinColor />
            <EnglishBlock entry={entry} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default CommunityCardView;
