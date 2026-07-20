import { Dialog, Box, Typography } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import CommunityCardView from "./CommunityCardView";
import ApplyDesignButton from "./ApplyDesignButton";
import VoteButton from "./VoteButton";
import type { CommunityDesign, Language } from "../../types";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * The floating zoom for a tapped community design (docs/COMMUNITY_PAGE.md). Mirrors the
 * writing-practice popup chrome: a transparent Dialog over a dark backdrop scrim with no explicit
 * close control — a tap on the (greyed) background dismisses. Below the enlarged card sits
 * a floating toolbar: the shared upvote button (greys out once voted / already voted this week)
 * and the shared apply-to-card button.
 */
const CommunityDesignZoom: React.FC<{
  design: CommunityDesign;
  voted: boolean;
  voteDeltas: Map<string, number>;
  token: string | null;
  language: Language;
  onClose: () => void;
  /** Reflects a vote toggle so the parent keeps its votedKeys set in sync across surfaces. */
  onVoteChange: (design: CommunityDesign, voted: boolean) => void;
}> = ({ design, voted, voteDeltas, token, language, onClose, onVoteChange }) => {
  return (
    <Dialog
      className="community-design-zoom"
      open
      onClose={onClose}
      PaperProps={{
        elevation: 0,
        sx: {
          backgroundColor: "transparent",
          boxShadow: "none",
          overflow: "visible",
          m: 0,
          width: { xs: "100vw", md: 393 },
          maxWidth: "100vw",
          height: { xs: "100dvh", md: "calc(100dvh - 48px)" },
          maxHeight: { xs: "100dvh", md: 932 },
        },
      }}
    >
      <Box
        className="community-design-zoom__surface"
        // A tap on the surface itself (the greyed background, not a floating island) dismisses.
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        sx={{
          position: "relative",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          px: 3,
          boxSizing: "border-box",
        }}
      >
        {/* No close button: tapping the greyed background dismisses (handler above). */}
        <CommunityCardView design={design} width={280} height={394} />

        {/* Design author attribution. */}
        <Box
          className="community-design-zoom__owner"
          onClick={(e) => e.stopPropagation()}
          sx={{ display: "flex", alignItems: "center", gap: 0.5, color: COLORS.textSecondary }}
        >
          <PersonIcon sx={{ fontSize: 16 }} />
          <Typography sx={{ fontSize: SIZE.caption, fontWeight: WEIGHT.medium }}>
            {/* Credit the designer, not whoever holds the copy that survived dedupe. */}
            {design.authorName || design.ownerName || "A learner"}
          </Typography>
        </Box>

        {/* Floating toolbar below the design. */}
        <Box
          className="community-design-zoom__toolbar"
          onClick={(e) => e.stopPropagation()}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            backgroundColor: COLORS.header,
            borderRadius: "999px",
            px: 1.5,
            py: 1,
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          }}
        >
          <VoteButton design={design} voted={voted} voteDeltas={voteDeltas} token={token} language={language} onVoteChange={onVoteChange} size="large" />
          <ApplyDesignButton design={design} token={token} language={language} />
        </Box>
      </Box>
    </Dialog>
  );
};

export default CommunityDesignZoom;
