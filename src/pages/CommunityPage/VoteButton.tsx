import { useEffect, useState } from "react";
import { Button } from "@mui/material";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import { voteForDesign, unvoteDesign } from "./communityApi";
import type { CommunityDesign, Language } from "../../types";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * Shared upvote TOGGLE for a community design (docs/COMMUNITY_PAGE.md), used below each feed
 * thumbnail AND in the zoom toolbar. Tapping toggles the viewer's vote for the week: not-voted →
 * vote (POST /vote), voted → unvote (POST /unvote). Color encodes state — GREY = not voted,
 * COLORED = voted. Shows the live vote count. Each change calls `onVoteChange(design, voted)` so
 * the parent keeps its `votedKeys` set in sync across both surfaces.
 */
const VoteButton: React.FC<{
  design: CommunityDesign;
  voted: boolean;
  token: string | null;
  language: Language;
  onVoteChange: (design: CommunityDesign, voted: boolean) => void;
  size?: "small" | "large";
}> = ({ design, voted, token, language, onVoteChange, size = "large" }) => {
  const [hasVoted, setHasVoted] = useState(voted);
  const [count, setCount] = useState(design.voteCountThisWeek);
  const [pending, setPending] = useState(false);

  // Reflect external changes (e.g. the parent updated votedKeys from the other surface).
  useEffect(() => { setHasVoted(voted); }, [voted]);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation(); // don't let the tap open/close the zoom
    if (pending) return;
    setPending(true);
    const next = !hasVoted;
    // Optimistic flip so the button responds instantly; revert on failure.
    setHasVoted(next);
    setCount((c) => c + (next ? 1 : -1));
    try {
      if (next) await voteForDesign(token, design.ownerUserId, design.entryKey, language);
      else await unvoteDesign(token, design.ownerUserId, design.entryKey, language);
      onVoteChange(design, next);
    } catch {
      setHasVoted(!next);
      setCount((c) => c + (next ? -1 : 1));
    } finally {
      setPending(false);
    }
  };

  const small = size === "small";

  return (
    <Button
      className="community-vote-button"
      onClick={toggle}
      disabled={pending}
      startIcon={<ThumbUpIcon sx={{ fontSize: small ? 14 : 20 }} />}
      variant="contained"
      disableElevation
      size={small ? "small" : "medium"}
      sx={{
        textTransform: "none",
        fontWeight: WEIGHT.semibold,
        fontSize: small ? SIZE.caption : SIZE.body,
        borderRadius: "999px",
        minWidth: 0,
        px: small ? 1.25 : 2,
        py: small ? 0.25 : undefined,
        // Color encodes vote state: COLORED = voted, GREY = not yet voted (available to vote).
        color: hasVoted ? "#fff" : COLORS.textSecondary,
        backgroundColor: hasVoted ? COLORS.blueMain : COLORS.card,
        "&:hover": {
          backgroundColor: hasVoted ? COLORS.blueMain : COLORS.card,
          filter: "brightness(0.96)",
        },
      }}
    >
      {count}
    </Button>
  );
};

export default VoteButton;
