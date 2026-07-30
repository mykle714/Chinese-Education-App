import { useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { apiDelete, apiGet, apiPost } from "../api/http";
import ValidateFlagButtonsView, { type ValidateAction } from "./ValidateFlagButtonsView";
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
  // Compact variant for tight surfaces — the meta-strip chips (Difficulty / Parts of
  // Speech / Commonality), where a full-size icon button would be taller than the chip
  // it annotates. Shrinks the icons and removes the button padding; behaviour is identical.
  dense?: boolean;
  className?: string;
}

/**
 * Inline Approve/Flag icon buttons for validator accounts
 * (docs/DATA_VALIDATION_SYSTEM.md) — lets a validator review an entry's example
 * sentence or long definition right where it's already displayed (est,
 * LongDefinitionDisplay), instead of only through the Reader document queue.
 *
 * This is the DET-FIELD wrapper: it owns the `/api/validation/entry*` calls and
 * the validator gate, while the icon pair itself (fill/disc styling, spinner,
 * pointer-event handling) lives in `ValidateFlagButtonsView`. The three vote
 * transitions — set, switch, clear — are implemented here:
 * `/api/validation/entrySubmit` (POST = set/switch, DELETE = clear) and
 * `/api/validation/entryStatus` (GET = this validator's current vote, fetched on
 * mount so the state survives a reload). Renders nothing for non-validators.
 */
function ValidateFlagButtons({ word1, language, field, alreadyApproved, dense, className }: ValidateFlagButtonsProps) {
  const { user } = useAuth();
  const [myVote, setMyVote] = useState<ValidateAction | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<ValidateAction | "clear" | null>(null);

  useEffect(() => {
    if (!user?.isValidator) return;
    let cancelled = false;
    (async () => {
      try {
        const { action } = await apiGet<{ action: ValidateAction | null }>("/api/validation/entryStatus", {
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

  const submit = async (action: ValidateAction) => {
    if (pending) return;
    if (myVote === action) {
      // Pressing the filled icon again un-votes — leave no signal in the DB.
      setPending("clear");
      try {
        // No body — the target is identified entirely by querystring, so `undefined`
        // fills apiDelete's optional body slot.
        await apiDelete("/api/validation/entrySubmit", undefined, {
          params: { word1, language, field },
        });
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
      await apiPost("/api/validation/entrySubmit", { word1, language, field, action });
      setMyVote(action);
    } catch (err) {
      console.error("Error submitting inline validation:", err);
    } finally {
      setPending(null);
    }
  };

  return (
    <ValidateFlagButtonsView
      myVote={myVote}
      pending={pending}
      onVote={(action) => { void submit(action); }}
      dense={dense}
      className={className}
    />
  );
}

export default ValidateFlagButtons;
