import { useState } from "react";
import { Button } from "@mui/material";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import { voteForDesign, unvoteDesign } from "./communityApi";
import { designKey } from "../../types";
import type { CommunityDesign, Language } from "../../types";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";

/**
 * Shared upvote TOGGLE for a community design (docs/COMMUNITY_PAGE.md), used below each feed
 * thumbnail AND in the zoom toolbar. Tapping toggles the viewer's vote for the week: not-voted →
 * vote (POST /vote), voted → unvote (POST /unvote). Color encodes state — GREY = not voted,
 * COLORED = voted.
 *
 * Both the voted state (`voted`) and the vote count are fully driven by parent-owned shared stores
 * so the SAME design shown in multiple rows/the zoom stays consistent: `voted` comes from the
 * parent's `votedKeys`, and the count is `design.voteCountThisWeek + voteDeltas[key]`. `toggle`
 * updates those stores optimistically via `onVoteChange(design, next)` (so every duplicate flips at
 * once) and reverts with the inverse call on network failure. Only the transient `pending` guard is
 * local — it merely debounces double-taps on this instance.
 */
const VoteButton: React.FC<{
  design: CommunityDesign;
  voted: boolean;
  voteDeltas: Map<string, number>;
  token: string | null;
  language: Language;
  onVoteChange: (design: CommunityDesign, voted: boolean) => void;
  size?: "small" | "large";
}> = ({ design, voted, voteDeltas, token, language, onVoteChange, size = "large" }) => {
  const [pending, setPending] = useState(false);
  const count = design.voteCountThisWeek + (voteDeltas.get(designKey(design)) ?? 0);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation(); // don't let the tap open/close the zoom
    if (pending) return;
    setPending(true);
    const next = !voted;
    // Optimistic flip through the shared stores so this button AND every duplicate of this design
    // respond instantly; revert with the inverse toggle on failure.
    onVoteChange(design, next);
    try {
      if (next) await voteForDesign(token, design.ownerUserId, design.entryKey, language);
      else await unvoteDesign(token, design.ownerUserId, design.entryKey, language);
    } catch {
      onVoteChange(design, !next);
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
        color: voted ? "#fff" : COLORS.textSecondary,
        backgroundColor: voted ? COLORS.blueMain : COLORS.card,
        "&:hover": {
          backgroundColor: voted ? COLORS.blueMain : COLORS.card,
          filter: "brightness(0.96)",
        },
      }}
    >
      {count}
    </Button>
  );
};

export default VoteButton;
