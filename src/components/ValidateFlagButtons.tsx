import { useState } from "react";
import { Box, IconButton, CircularProgress } from "@mui/material";
import {
  CheckCircle as CheckCircleIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
  Flag as FlagIcon,
  FlagOutlined as FlagOutlinedIcon,
} from "@mui/icons-material";
import { useAuth } from "../AuthContext";
import { apiPost } from "../api/http";
import type { Language, ValidationField } from "../types";

interface ValidateFlagButtonsProps {
  word1: string;
  language: Language;
  field: ValidationField;
  // Server-known: this field already carries a valid human approval
  // (sentence.humanApproved / entry.definitionsApproved). The buttons never show
  // once a field is approved — approved content already renders without the
  // AI-generated treatment, so prompting to re-validate it would be redundant.
  // Does NOT track "already flagged" (not surfaced to the client), so a
  // flagged-but-unapproved field still shows buttons. Ignored once THIS component
  // has recorded its own outcome (`done`) — a stale prop must not hide a just-taken
  // action's indicator.
  alreadyApproved?: boolean;
  className?: string;
}

type Action = "approve" | "flag";

/**
 * Inline Approve/Flag icon buttons for validator accounts
 * (docs/DATA_VALIDATION_SYSTEM.md) — lets a validator review an entry's example
 * sentence or long definition right where it's already displayed (est,
 * LongDefinitionDisplay), instead of only through the Reader document queue.
 * Posts directly to `POST /api/validation/entry-submit`
 * (`ValidationService.submitEntryValidation`), which resolves the det row by
 * (word1, language) and composes the approved content server-side — no document,
 * no client-supplied content. Renders nothing for non-validators.
 *
 * Three states:
 *   1. Not a validator, or `alreadyApproved` and no local action yet → renders null.
 *   2. Untouched → two outline IconButtons (styled like `SpeakerButton`: small,
 *      stopPropagation so a tap doesn't bubble into an enclosing flip/drag/segment
 *      handler).
 *   3. After a submit (success, or a 400 — almost always "already validated",
 *      e.g. a double-tap or already recorded via the Reader queue) → the two
 *      buttons are replaced by a single FILLED icon matching the action taken.
 *      This is a status indicator, not a control: plain icon, no IconButton, no
 *      click handler.
 */
function ValidateFlagButtons({ word1, language, field, alreadyApproved, className }: ValidateFlagButtonsProps) {
  const { user } = useAuth();
  const [pending, setPending] = useState<Action | null>(null);
  const [done, setDone] = useState<Action | null>(null);

  if (!user?.isValidator) return null;
  if (alreadyApproved && !done) return null;

  if (done) {
    const DoneIcon = done === "approve" ? CheckCircleIcon : FlagIcon;
    return (
      <Box
        className={className ?? "validate-flag-buttons validate-flag-buttons--done"}
        title={done === "approve" ? "Approved" : "Flagged"}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "5px",
          color: done === "approve" ? "success.main" : "warning.main",
        }}
      >
        <DoneIcon fontSize="small" />
      </Box>
    );
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const submit = async (action: Action) => {
    if (pending) return;
    setPending(action);
    try {
      await apiPost("/api/validation/entry-submit", { word1, language, field, action });
      setDone(action);
    } catch (err) {
      console.error("Error submitting inline validation:", err);
      setDone(action);
    } finally {
      setPending(null);
    }
  };

  return (
    <Box
      className={className ?? "validate-flag-buttons"}
      sx={{ display: "inline-flex", alignItems: "center" }}
    >
      <IconButton
        className="validate-flag-buttons-flag"
        size="small"
        disabled={!!pending}
        onClick={(e) => { stop(e); void submit("flag"); }}
        onMouseDown={stop}
        onTouchStart={stop}
        onTouchEnd={stop}
        aria-label="Flag"
        title="Flag"
      >
        {pending === "flag" ? <CircularProgress size={16} thickness={5} /> : <FlagOutlinedIcon fontSize="small" />}
      </IconButton>
      <IconButton
        className="validate-flag-buttons-approve"
        size="small"
        disabled={!!pending}
        onClick={(e) => { stop(e); void submit("approve"); }}
        onMouseDown={stop}
        onTouchStart={stop}
        onTouchEnd={stop}
        aria-label="Approve"
        title="Approve"
      >
        {pending === "approve" ? <CircularProgress size={16} thickness={5} /> : <CheckCircleOutlineIcon fontSize="small" />}
      </IconButton>
    </Box>
  );
}

export default ValidateFlagButtons;
