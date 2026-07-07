/**
 * PracticeWritingButton — the "Practice Writing Me" entry point.
 *
 * A self-contained button that opens the writing-practice popup for a target
 * word. Placed on the eip, the flp main flashcard (back face only, stacked above
 * the audio icon), and the word details page (cdp). Chinese-only for now (the
 * recognizer is zh_CN); renders nothing for other languages.
 *
 * Spec: docs/HANDWRITING_RECOGNITION.md ("Entry points").
 */
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, IconButton, Tooltip } from "@mui/material";
// Writing practice uses the pencil; the flp icon-layout "edit" uses the brush
// (the two were swapped per design).
import EditIcon from "@mui/icons-material/Edit";
import PracticeWritingPopup from "./PracticeWritingPopup";
import { useAuth } from "../../AuthContext";
import { fetchCompletedLevels } from "./completions";
import { API_BASE_URL } from "../../constants";

interface PracticeWritingButtonProps {
  character: string;
  /** Recognition is zh-only; the button renders null for any other/absent language. */
  language: string | undefined;
  /**
   * The learner's vet card id for this word, when opened from a flashcard/eip.
   * When set, a Verify attempt records a Writing mastery mark (docs/MASTERY_REWORK.md);
   * omit on the read-only dictionary cdp (no card to mark).
   */
  vocabEntryId?: number;
  /** Override the default outlined look. */
  variant?: "text" | "outlined" | "contained";
  size?: "small" | "medium" | "large";
  /** Compact icon button for tight headers (e.g. the eip). */
  iconOnly?: boolean;
  /** Hide the gold ★N completion superscript (e.g. on the flashcard, for a clean face). */
  hideStarBadge?: boolean;
}

export default function PracticeWritingButton({
  character,
  language,
  vocabEntryId,
  variant = "outlined",
  size = "small",
  iconOnly = false,
  hideStarBadge = false,
}: PracticeWritingButtonProps) {
  const { token, isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  // Completed assistance levels for this character (the stars). Owned here so the
  // superscript count and the popup's per-tab stars share one source of truth.
  const [completedLevels, setCompletedLevels] = useState<Set<string>>(new Set());

  // Gate: Chinese only (zh_CN recognizer), 1–4 characters. Single characters use
  // one large panel; 2–4 use the 2×2 grid (top-two for 2 chars; +bottom-left for
  // 3; all four for 4). Words longer than 4 chars are excluded — the grid only has
  // four slots (docs/HANDWRITING_RECOGNITION.md "Multi-character grid").
  // [...character] counts code points so surrogate-pair CJK glyphs count as one.
  const charCount = [...character].length;
  const eligible = language === "zh" && charCount >= 1 && charCount <= 4;

  // Load existing stars for this character so the superscript shows before opening.
  useEffect(() => {
    if (!eligible || !token) return;
    let cancelled = false;
    fetchCompletedLevels("zh", character, token)
      .then((levels) => {
        if (!cancelled) setCompletedLevels(new Set(levels));
      })
      .catch(() => {
        /* non-fatal: just show no stars */
      });
    return () => {
      cancelled = true;
    };
  // isAuthenticated not `token`: the star count needn't re-fetch on a silent
  // refresh. See CLAUDE.md "Never reload on token refresh".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, character, isAuthenticated]);

  // Called by the popup when a level is freshly completed (it returns the new set).
  const handleLevelsChange = useCallback((levels: string[]) => {
    setCompletedLevels(new Set(levels));
  }, []);

  // Record a Writing mastery mark on each Verify attempt (positive iff the whole
  // word was written correctly). Fire-and-forget, only when we know the vet card.
  // See docs/MASTERY_REWORK.md.
  const handleWritingMark = useCallback((isCorrect: boolean) => {
    if (vocabEntryId == null || !token || token === "null" || token === "undefined") return;
    fetch(`${API_BASE_URL}/api/flashcards/mark`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
      // excludeIds empty: the drill doesn't use the endpoint's replacement card.
      body: JSON.stringify({ cardId: vocabEntryId, isCorrect, type: "writing", excludeIds: [] }),
    }).catch((err) => console.error(`[PracticeWriting] writing mark failed → card ${vocabEntryId}:`, err));
  }, [vocabEntryId, token]);

  if (!eligible) return null;

  const starCount = completedLevels.size;

  // In the eip the button sits inside flip/drag-sensitive surfaces, so taps must
  // not bubble (mirrors the SpeakerButton / add-to-library stop-propagation).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const openPopup = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(true);
  };

  // Gold star superscript showing how many of the 4 levels are completed. Hidden at
  // zero, or entirely when `hideStarBadge` is set (e.g. the flashcard face, kept
  // clean for zen). Wraps either button variant.
  const withStarBadge = (child: React.ReactNode) => {
    if (hideStarBadge) return child;
    return (
    <Badge
      className="practice-writing-button__stars"
      badgeContent={starCount > 0 ? `★${starCount}` : 0}
      overlap="rectangular"
      sx={{
        "& .MuiBadge-badge": {
          bgcolor: "#F6B73C",
          color: "#3A2A00",
          fontWeight: 700,
          fontSize: "0.65rem",
        },
      }}
    >
      {child}
    </Badge>
    );
  };

  return (
    <>
      {iconOnly
        ? withStarBadge(
            <Tooltip title="Practice writing me">
              <IconButton
                className="practice-writing-button"
                size={size === "large" ? "medium" : "small"}
                aria-label="Practice writing me"
                onClick={openPopup}
                onMouseDown={stop}
                onTouchStart={stop}
                onTouchEnd={stop}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>,
          )
        : withStarBadge(
            <Button
              className="practice-writing-button"
              variant={variant}
              size={size}
              startIcon={<EditIcon />}
              onClick={openPopup}
              onMouseDown={stop}
            >
              Practice Writing Me
            </Button>,
          )}
      <PracticeWritingPopup
        open={open}
        character={character}
        completedLevels={completedLevels}
        onLevelsChange={handleLevelsChange}
        onWritingMark={handleWritingMark}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
