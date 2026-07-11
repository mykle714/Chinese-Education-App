import { useState } from "react";
import { Box, IconButton, CircularProgress } from "@mui/material";
import { CheckCircle as CheckCircleIcon, Flag as FlagIcon } from "@mui/icons-material";
import { useAuth } from "../AuthContext";
import { apiPost } from "../api/http";
import type { Language, ValidationField } from "../types";

interface ValidateFlagButtonsProps {
  word1: string;
  language: Language;
  field: ValidationField;
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
 * Styled like `SpeakerButton` (small IconButton, stopPropagation so a tap doesn't
 * bubble into an enclosing flip/drag/segment handler).
 */
function ValidateFlagButtons({ word1, language, field, className }: ValidateFlagButtonsProps) {
  const { user } = useAuth();
  const [pending, setPending] = useState<Action | null>(null);
  // Once this validator has recorded an outcome for this (entry, field) — either by
  // a successful submit, or a 400 telling us it was already recorded elsewhere
  // (e.g. via the Reader queue) — the buttons lock to reflect it.
  const [done, setDone] = useState<Action | null>(null);

  if (!user?.isValidator) return null;

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const submit = async (action: Action) => {
    if (pending || done) return;
    setPending(action);
    try {
      await apiPost("/api/validation/entry-submit", { word1, language, field, action });
      setDone(action);
    } catch (err) {
      // A 400 here is almost always "already validated" (the button race — two
      // taps, or already recorded via the Reader queue) rather than something
      // actionable, so treat it the same as success: lock the buttons rather than
      // leaving them clickable for a retry that will just 400 again.
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
        disabled={!!pending || !!done}
        color={done === "flag" ? "warning" : undefined}
        onClick={(e) => { stop(e); void submit("flag"); }}
        onMouseDown={stop}
        onTouchStart={stop}
        onTouchEnd={stop}
        aria-label="Flag"
        title="Flag"
      >
        {pending === "flag" ? <CircularProgress size={16} thickness={5} /> : <FlagIcon fontSize="small" />}
      </IconButton>
      <IconButton
        className="validate-flag-buttons-approve"
        size="small"
        disabled={!!pending || !!done}
        color={done === "approve" ? "success" : undefined}
        onClick={(e) => { stop(e); void submit("approve"); }}
        onMouseDown={stop}
        onTouchStart={stop}
        onTouchEnd={stop}
        aria-label="Approve"
        title="Approve"
      >
        {pending === "approve" ? <CircularProgress size={16} thickness={5} /> : <CheckCircleIcon fontSize="small" />}
      </IconButton>
    </Box>
  );
}

export default ValidateFlagButtons;
