import { Box, IconButton, CircularProgress, alpha } from "@mui/material";
import {
  CheckCircle as CheckCircleIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
  Flag as FlagIcon,
  FlagOutlined as FlagOutlinedIcon,
} from "@mui/icons-material";
import { COLORS } from "../theme/colors";

export type ValidateAction = "approve" | "flag";

interface ValidateFlagButtonsViewProps {
  /** This validator's current vote, or null if they haven't voted. */
  myVote: ValidateAction | null;
  /** Which transition is in flight, so only that icon spins. */
  pending: ValidateAction | "clear" | null;
  /**
   * Called with the tapped action. The WRAPPER decides what it means: tapping
   * the icon that already matches `myVote` is an un-vote, tapping the other is
   * a switch. Keeping that decision in the wrapper lets this stay pure.
   */
  onVote: (action: ValidateAction) => void;
  /** Compact variant for tight surfaces (meta-strip chips). */
  dense?: boolean;
  className?: string;
}

/**
 * Presentational Approve/Flag icon pair, used by `ValidateFlagButtons` to review
 * a det entry's field (definitions, est, …) — see docs/DATA_VALIDATION_SYSTEM.md.
 *
 * Split from its container so the icon pair, fill/disc styling and per-icon
 * spinner stay free of any knowledge of the endpoints behind them.
 *
 * The contract:
 *   • Approve on the LEFT, Flag on the RIGHT, both always rendered.
 *   • The icon matching the current vote renders FILLED on a faint same-colour
 *     disc (approve → green, flag → orange), so colour means "sent".
 *   • Tapping the other icon SWITCHES the vote; tapping the current one CLEARS it.
 *   • Pointer events are stopped so a tap never reaches an enclosing flip/drag
 *     handler or a game button underneath.
 */
function ValidateFlagButtonsView({
  myVote,
  pending,
  onVote,
  dense,
  className,
}: ValidateFlagButtonsViewProps) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const FlagIconComp = myVote === "flag" ? FlagIcon : FlagOutlinedIcon;
  const ApproveIconComp = myVote === "approve" ? CheckCircleIcon : CheckCircleOutlineIcon;

  // Dense chips shrink the hit target, so keep the two buttons from touching and
  // let the icon carry the size. Merged UNDER each button's vote colouring below.
  const denseSx = dense ? { padding: "2px" } : undefined;
  const iconFontSize = dense ? "0.95rem" : undefined;
  const spinnerSize = dense ? 12 : 16;

  return (
    <Box
      className={className ?? "validate-flag-buttons"}
      sx={{ display: "inline-flex", alignItems: "center" }}
    >
      <IconButton
        className="validate-flag-buttons-approve"
        size="small"
        disabled={!!pending}
        onClick={(e) => { stop(e); onVote("approve"); }}
        onMouseDown={stop}
        onTouchStart={stop}
        onTouchEnd={stop}
        aria-label={myVote === "approve" ? "Approve (tap to undo)" : "Approve"}
        title={myVote === "approve" ? "Approve (tap to undo)" : "Approve"}
        sx={{
          ...denseSx,
          ...(myVote === "approve"
            ? { color: COLORS.greenMain, bgcolor: alpha(COLORS.greenMain, 0.14), "&:hover": { bgcolor: alpha(COLORS.greenMain, 0.22) } }
            : {}),
        }}
      >
        {pending === "approve" || (pending === "clear" && myVote === "approve")
          ? <CircularProgress size={spinnerSize} thickness={5} />
          : <ApproveIconComp fontSize="small" sx={{ fontSize: iconFontSize }} />}
      </IconButton>
      <IconButton
        className="validate-flag-buttons-flag"
        size="small"
        disabled={!!pending}
        onClick={(e) => { stop(e); onVote("flag"); }}
        onMouseDown={stop}
        onTouchStart={stop}
        onTouchEnd={stop}
        aria-label={myVote === "flag" ? "Flag (tap to undo)" : "Flag"}
        title={myVote === "flag" ? "Flag (tap to undo)" : "Flag"}
        sx={{
          ...denseSx,
          ...(myVote === "flag"
            ? { color: COLORS.yellowMain, bgcolor: alpha(COLORS.yellowMain, 0.14), "&:hover": { bgcolor: alpha(COLORS.yellowMain, 0.22) } }
            : {}),
        }}
      >
        {pending === "flag" || (pending === "clear" && myVote === "flag")
          ? <CircularProgress size={spinnerSize} thickness={5} />
          : <FlagIconComp fontSize="small" sx={{ fontSize: iconFontSize }} />}
      </IconButton>
    </Box>
  );
}

export default ValidateFlagButtonsView;
