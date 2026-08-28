/**
 * PracticeWritingButton — the "Practice Writing Me" entry point.
 *
 * A self-contained button that opens the writing-practice popup for a target
 * word. It has two appearances and one behaviour (see `appearance`): the `.wtl`
 * word-tools rail above the card on the flp and both cdps (rail), and any plain
 * action row (labeled). Chinese-only for now (the recognizer is zh_CN); renders
 * nothing for other languages.
 *
 * There is no longer an on-card appearance: the compact `icon` button that used to
 * stack above the speaker on the card face was removed on 2026-08-28 in favour of
 * the rail, so Practice Writing has exactly one entry point per page.
 *
 * Spec: docs/HANDWRITING_RECOGNITION.md ("Entry points").
 */
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Typography } from "@mui/material";
// Writing practice uses the pencil; the flp icon-layout "edit" uses the brush
// (the two were swapped per design).
import EditIcon from "@mui/icons-material/Edit";
import PracticeWritingPopup from "./PracticeWritingPopup";
import { useAuth } from "../../AuthContext";
import { fetchCompletedLevels } from "./completions";
import { markFlashcard } from "../../api/flashcards";
import Icon from "../Icon";
import { WORD_TOOL_PILL_SX } from "../wordToolPill";

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
  /** Override the default outlined look. Ignored by the `rail` appearance. */
  variant?: "text" | "outlined" | "contained";
  size?: "small" | "medium" | "large";
  /**
   * Which of the two shapes this entry point takes. One component rather than two
   * because the star fetch, the popup and the Writing mark are the same behaviour on
   * every surface — only the trigger's shape differs.
   *
   *   `labeled` — the default MUI outlined button, "Practice Writing Me".
   *   `rail`    — the shelf system's `.wtl` pill, "Write it", for `WordToolsRail`
   *               (artboards 18–25). Its look comes from WORD_TOOL_PILL_SX so the two
   *               pills on that rail cannot drift apart.
   */
  appearance?: "labeled" | "rail";
}

export default function PracticeWritingButton({
  character,
  language,
  vocabEntryId,
  variant = "outlined",
  size = "small",
  appearance = "labeled",
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
    // Gated on isAuthenticated rather than on the token string: the mark is only
    // meaningful for a signed-in user, and `isAuthenticated` is the stable identity
    // (the raw token rotates every ~15 min). markFlashcard supplies the header.
    if (vocabEntryId == null || !isAuthenticated) return;
    // excludeIds defaults to []: the drill doesn't use the endpoint's replacement card.
    markFlashcard({ cardId: vocabEntryId, isCorrect, type: "writing", surface: "practice-writing" })
      .catch((err) => console.error(`[PracticeWriting] writing mark failed → card ${vocabEntryId}:`, err));
  }, [vocabEntryId, isAuthenticated]);

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
  // zero. Wraps either button variant.
  const withStarBadge = (child: React.ReactNode) => (
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

  // The two triggers, keyed by appearance. Each is wrapped in the same star badge
  // and opens the same popup below.
  const trigger =
    appearance === "rail" ? (
      // "Write it", not "Practice Writing Me": the rail sits beside "Compare", and a
      // four-word label next to a one-word one makes the pair read as one button and
      // one sentence. The glyph is the design's `draw`, not the MUI pencil, so the
      // rail's two icons come from the same face.
      <Typography
        component="button"
        type="button"
        className="practice-writing-button practice-writing-button--rail"
        onClick={openPopup}
        onMouseDown={stop}
        onTouchStart={stop}
        sx={WORD_TOOL_PILL_SX}
      >
        <Icon name="draw" size={17} />
        Write it
      </Typography>
    ) : (
      <Button
        className="practice-writing-button"
        variant={variant}
        size={size}
        startIcon={<EditIcon />}
        onClick={openPopup}
        onMouseDown={stop}
      >
        Practice Writing Me
      </Button>
    );

  return (
    <>
      {withStarBadge(trigger)}
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
