import { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import MiniVocabCard from "../../components/MiniVocabCard";
import VoteButton from "./VoteButton";
import type { CommunityDesign, Language, VocabEntry } from "../../types";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * One design thumbnail in a horizontal feed (docs/COMMUNITY_PAGE.md). The preview is the SAME
 * `MiniVocabCard` the /decks page renders (identical color + information layout), fed a
 * VocabEntry built from the design. Tapping the card opens the zoom. Below it: the design owner's
 * name and an inline vote toggle (`VoteButton`).
 */
const CommunityDesignCard: React.FC<{
  design: CommunityDesign;
  voted: boolean;
  voteDeltas: Map<string, number>;
  token: string | null;
  language: Language;
  onVoteChange: (design: CommunityDesign, voted: boolean) => void;
  onOpen: (design: CommunityDesign) => void;
}> = ({ design, voted, voteDeltas, token, language, onVoteChange, onOpen }) => {
  // Adapt the design into the VocabEntry shape MiniVocabCard expects. Stable per design so the
  // memoized card doesn't re-render on unrelated parent updates.
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

  return (
    <Box
      className="community-design-card"
      sx={{ flexShrink: 0, width: 92, display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}
    >
      <MiniVocabCard entry={entry} onClick={() => onOpen(design)} />

      <Box
        className="community-design-card__owner"
        sx={{ display: "flex", alignItems: "center", gap: 0.25, maxWidth: "100%", my: "2px", color: COLORS.textSecondary }}
      >
        <PersonIcon sx={{ fontSize: 13, flexShrink: 0 }} />
        <Typography
          className="community-design-card__owner-name"
          noWrap
          sx={{ fontSize: SIZE.micro, fontWeight: WEIGHT.medium, lineHeight: 1.2 }}
        >
          {/* Credit the designer, not whoever holds the copy that survived dedupe. */}
          {design.authorName || design.ownerName || "A learner"}
        </Typography>
      </Box>

      <VoteButton design={design} voted={voted} voteDeltas={voteDeltas} token={token} language={language} onVoteChange={onVoteChange} size="small" />
    </Box>
  );
};

export default CommunityDesignCard;
