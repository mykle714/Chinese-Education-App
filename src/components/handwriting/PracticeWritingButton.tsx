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
import { useState } from "react";
import { Badge, Button, Typography } from "@mui/material";
// Writing practice uses the pencil; the flp icon-layout "edit" uses the brush
// (the two were swapped per design).
import EditIcon from "@mui/icons-material/Edit";
import PracticeWritingPopup from "./PracticeWritingPopup";
import { usePracticeWriting } from "./usePracticeWriting";
import Icon from "../Icon";
import { WORD_TOOL_PILL_SX } from "../wordToolPill";
import { COLORS } from "../../theme/colors";

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
  const [open, setOpen] = useState(false);
  // Stars (completed assistance levels) + the Writing mark, shared with every other
  // host of the popup (usePracticeWriting). Gate: Chinese only (zh_CN recognizer),
  // 1–4 characters — single characters use one large panel, 2–4 the 2×2 grid
  // (docs/HANDWRITING_RECOGNITION.md "Multi-character grid").
  const { eligible, completedLevels, onLevelsChange, onWritingMark } =
    usePracticeWriting(character, { language, vocabEntryId });

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
          // The framework's action gold (`--gld`) with ink on it — v2 has no dark gold ink.
          bgcolor: COLORS.gld,
          color: COLORS.onSurface,
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
        onLevelsChange={onLevelsChange}
        onWritingMark={onWritingMark}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
