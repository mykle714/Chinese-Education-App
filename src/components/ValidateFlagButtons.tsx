import { useEffect, useState } from "react";
import { Box, IconButton, CircularProgress, alpha } from "@mui/material";
import {
  CheckCircle as CheckCircleIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
  Flag as FlagIcon,
  FlagOutlined as FlagOutlinedIcon,
} from "@mui/icons-material";
import { useAuth } from "../AuthContext";
import { apiDelete, apiGet, apiPost } from "../api/http";
import { COLORS } from "../theme/colors";
import type { Language, ValidationField } from "../types";

interface ValidateFlagButtonsProps {
  word1: string;
  language: Language;
  field: ValidationField;
  // Server-known: this field already carries a valid human approval
  // (sentence.humanApproved / entry.definitionsApproved). Used only to decide
  // whether the buttons are worth rendering at all before this validator's own
  // vote has loaded (see `myVote` below) — once `myVote` resolves (including to
  // `null`), it is the source of truth and this prop is ignored.
  alreadyApproved?: boolean;
  className?: string;
}

type Action = "approve" | "flag";

/**
 * Inline Approve/Flag icon buttons for validator accounts
 * (docs/DATA_VALIDATION_SYSTEM.md) — lets a validator review an entry's example
 * sentence or long definition right where it's already displayed (est,
 * LongDefinitionDisplay), instead of only through the Reader document queue.
 *
 * Both icons are always shown side by side; whichever matches this validator's
 * current vote (if any) renders FILLED, the other stays an active outline
 * button so the vote can be switched. Pressing the filled icon again clears
 * the vote (no signal left in the DB). All three transitions go through
 * `ValidationService` via `/api/validation/entry-submit` (POST = set/switch,
 * DELETE = clear) and `/api/validation/entry-status` (GET = this validator's
 * current vote, fetched on mount so the state survives a reload — unlike the
 * old session-only `done` flag). Renders nothing for non-validators.
 */
function ValidateFlagButtons({ word1, language, field, alreadyApproved, className }: ValidateFlagButtonsProps) {
  const { user } = useAuth();
  const [myVote, setMyVote] = useState<Action | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Action | "clear" | null>(null);

  useEffect(() => {
    if (!user?.isValidator) return;
    let cancelled = false;
    (async () => {
      try {
        const { action } = await apiGet<{ action: Action | null }>("/api/validation/entry-status", {
          params: { word1, language, field },
        });
        if (!cancelled) setMyVote(action);
      } catch (err) {
        console.error("Error loading inline validation status:", err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.isValidator, word1, language, field]);

  if (!user?.isValidator) return null;
  // Before the status fetch resolves, fall back to the caller's best-guess
  // signal so an already-approved field doesn't flash empty outline buttons.
  if (!loaded && alreadyApproved) return null;

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const submit = async (action: Action) => {
    if (pending) return;
    if (myVote === action) {
      // Pressing the filled icon again un-votes — leave no signal in the DB.
      setPending("clear");
      try {
        await apiDelete("/api/validation/entry-submit", { params: { word1, language, field } });
        setMyVote(null);
      } catch (err) {
        console.error("Error clearing inline validation:", err);
      } finally {
        setPending(null);
      }
      return;
    }
    setPending(action);
    try {
      await apiPost("/api/validation/entry-submit", { word1, language, field, action });
      setMyVote(action);
    } catch (err) {
      console.error("Error submitting inline validation:", err);
    } finally {
      setPending(null);
    }
  };

  const FlagIconComp = myVote === "flag" ? FlagIcon : FlagOutlinedIcon;
  const ApproveIconComp = myVote === "approve" ? CheckCircleIcon : CheckCircleOutlineIcon;

  return (
    <Box
      className={className ?? "validate-flag-buttons"}
      sx={{ display: "inline-flex", alignItems: "center" }}
    >
      <IconButton
        className="validate-flag-buttons-approve"
        size="small"
        disabled={!!pending}
        onClick={(e) => { stop(e); void submit("approve"); }}
        onMouseDown={stop}
        onTouchStart={stop}
        onTouchEnd={stop}
        aria-label={myVote === "approve" ? "Approved (tap to un-approve)" : "Approve"}
        title={myVote === "approve" ? "Approved (tap to un-approve)" : "Approve"}
        // Approve = green (COLORS.greenMain): once the server has recorded the vote the
        // icon fills green on a faint green disc, so green signals "approval sent".
        sx={myVote === "approve"
          ? { color: COLORS.greenMain, bgcolor: alpha(COLORS.greenMain, 0.14), "&:hover": { bgcolor: alpha(COLORS.greenMain, 0.22) } }
          : undefined}
      >
        {pending === "approve" || (pending === "clear" && myVote === "approve")
          ? <CircularProgress size={16} thickness={5} />
          : <ApproveIconComp fontSize="small" />}
      </IconButton>
      <IconButton
        className="validate-flag-buttons-flag"
        size="small"
        disabled={!!pending}
        onClick={(e) => { stop(e); void submit("flag"); }}
        onMouseDown={stop}
        onTouchStart={stop}
        onTouchEnd={stop}
        aria-label={myVote === "flag" ? "Flagged (tap to unflag)" : "Flag"}
        title={myVote === "flag" ? "Flagged (tap to unflag)" : "Flag"}
        // Flag = orange (COLORS.yellowMain, #FF9E5A): once the server has recorded the
        // flag the icon fills orange on a faint orange disc, so orange signals "flag sent".
        sx={myVote === "flag"
          ? { color: COLORS.yellowMain, bgcolor: alpha(COLORS.yellowMain, 0.14), "&:hover": { bgcolor: alpha(COLORS.yellowMain, 0.22) } }
          : undefined}
      >
        {pending === "flag" || (pending === "clear" && myVote === "flag")
          ? <CircularProgress size={16} thickness={5} />
          : <FlagIconComp fontSize="small" />}
      </IconButton>
    </Box>
  );
}

export default ValidateFlagButtons;
