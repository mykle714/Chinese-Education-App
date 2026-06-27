import { useState } from "react";
import { Button, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Snackbar, Alert } from "@mui/material";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import CheckIcon from "@mui/icons-material/Check";
import { applyDesign } from "./communityApi";
import type { CommunityDesign, Language } from "../../types";
import { COLORS } from "../../theme/colors";
import { WEIGHT } from "../../theme/scale";

/**
 * The single shared "apply a community design to my card" action, used identically in BOTH the
 * zoom toolbars of the two feeds (docs/COMMUNITY_PAGE.md). Its label flips on `design.inLibrary`:
 *   - already own the word → "Add design to card"
 *   - don't own it (feed 2) → "Add card & design"
 * If the viewer already has an advanced design on that card, the server replies 'would-override'
 * and we confirm before re-applying with override=true.
 */
const ApplyDesignButton: React.FC<{
  design: CommunityDesign;
  token: string | null;
  language: Language;
  onApplied?: () => void;
}> = ({ design, token, language, onApplied }) => {
  const [status, setStatus] = useState<"idle" | "applying" | "done">("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Toast message after a successful apply (mirrors the dictionary add-to-library snackbar).
  const [toast, setToast] = useState<string | null>(null);

  const label = design.inLibrary ? "Add design to card" : "Add card & design";

  const run = async (override: boolean) => {
    setStatus("applying");
    try {
      const result = await applyDesign(token, design.ownerUserId, design.entryKey, language, override);
      if (result === "would-override") {
        setStatus("idle");
        setConfirmOpen(true); // ask before clobbering the viewer's own advanced design
        return;
      }
      setStatus("done");
      setToast(result === "added-and-applied" ? "Added card & design!" : "Added!");
      onApplied?.();
    } catch {
      setStatus("idle");
      setToast("Couldn't add — please try again");
    }
  };

  return (
    <>
      <Button
        className="apply-design-button"
        variant="contained"
        disableElevation
        disabled={status !== "idle"}
        startIcon={status === "done" ? <CheckIcon /> : <AddPhotoAlternateIcon />}
        onClick={() => run(false)}
        sx={{
          textTransform: "none",
          fontWeight: WEIGHT.semibold,
          borderRadius: "999px",
          color: "#fff",
          backgroundColor: COLORS.greenMain,
          "&:hover": { backgroundColor: COLORS.greenMain, filter: "brightness(0.95)" },
        }}
      >
        {status === "done" ? "Added" : label}
      </Button>

      <Dialog
        className="apply-design-button__override-dialog"
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
      >
        <DialogTitle>Replace your design?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You already have a custom design on “{design.entryKey}”. Adding this one will overwrite it.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setConfirmOpen(false);
              run(true);
            }}
            variant="contained"
            disableElevation
            sx={{ textTransform: "none" }}
          >
            Overwrite
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success/error toast, top-center — same pattern as the dictionary add-to-library flow. */}
      <Snackbar
        className="apply-design-button__toast"
        open={toast !== null}
        autoHideDuration={2500}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert
          severity={toast?.startsWith("Couldn't") ? "error" : "success"}
          variant="filled"
          onClose={() => setToast(null)}
        >
          {toast}
        </Alert>
      </Snackbar>
    </>
  );
};

export default ApplyDesignButton;
