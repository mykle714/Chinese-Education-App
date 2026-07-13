import { Box, Typography, type SxProps, type Theme } from "@mui/material";
import { stripParentheses } from "../utils/definitionUtils";

// Presentation-layer text prep shared by both render paths: strip parenthetical
// asides (mirrors the flp gloss treatment). Blank lines are intentionally left
// intact — the per-POS join in longDefObjectToDisplayString separates each POS
// block with `\n\n`, and with the hosts' `whiteSpace: pre-line` that paints as a
// real blank line between blocks, which is what we want for multi-POS entries.
function prepareText(text: string): string {
  return stripParentheses(text);
}
import type { LongDefinitionPart, Language } from "../types";
import SegmentedSentenceDisplay from "./SegmentedSentenceDisplay";
import { aiGeneratedSurfaceSx } from "../theme/aiGeneratedStyling";
import { AiGeneratedBadge } from "./AiGeneratedBadge";
import ValidateFlagButtons from "./ValidateFlagButtons";

interface LongDefinitionDisplayProps {
  // Raw long-definition string — used for the plain-text fallback when parts are absent.
  longDefinition?: string | null;
  // Server-computed split of longDefinition into English-prose parts and embedded-Chinese
  // parts. When present, Chinese parts render as inline cpcd with the segment popup.
  longDefinitionParts?: LongDefinitionPart[] | null;
  className?: string;
  // Forwarded to the inline cpcd for embedded Chinese (mirrors the example-sentence display).
  showPinyin?: boolean;
  showPinyinColor?: boolean;
  // When provided, the embedded-Chinese segment popup becomes tappable: it shows a
  // drill-in chevron and calls this with the tapped segment's headword so the host can
  // open the eip for that word (same gesture as the example-sentence popups). Omit to
  // keep the popup a passive tooltip (e.g. the cdp, which has no eip).
  onSegmentOpen?: (segment: string) => void;
  // Typography styling (font/color/size) for the prose, supplied by the host surface
  // so this stays presentation-agnostic.
  sx?: SxProps<Theme>;
  // TRUE when the caller's entry.definitionsApproved is falsy — renders the shared
  // AI-generated treatment (orange border/tint + "AI GENERATED" badge, matching the
  // est's unapproved-sentence styling) around the definition text. See
  // docs/DATA_VALIDATION_SYSTEM.md.
  aiGenerated?: boolean;
  // Entry identity for the inline validator Approve/Flag buttons (field is always
  // 'definitions' here — see docs/DATA_VALIDATION_SYSTEM.md). Both must be provided
  // to show the buttons; omit for surfaces with no single backing det entry (e.g.
  // CompareTabBody's AI comparison paragraph, which has no validation field at all).
  word1?: string;
  language?: Language;
}

/**
 * Renders a dictionary entry's long definition. When the server has split it into
 * `longDefinitionParts`, embedded Chinese runs render inline as cpcd (tone-colored
 * characters with pinyin below) carrying the same hover/tap definition popup used by
 * example sentences, while the surrounding English prose flows around them and wraps
 * naturally. Falls back to plain text when parts are unavailable (old payloads / non-zh).
 *
 * Layer: presentational component. The intelligence (segmentation + per-segment
 * definitions) lives server-side in enrichLongDefinitionMetadataBatch; this only renders.
 */
const LongDefinitionDisplay: React.FC<LongDefinitionDisplayProps> = ({
  longDefinition,
  longDefinitionParts,
  className,
  showPinyin,
  showPinyinColor,
  onSegmentOpen,
  sx,
  aiGenerated = false,
  word1,
  language,
}) => {
  // Absolutely-positioned inline validator buttons (renders nothing for
  // non-validators, or once definitionsApproved is already true) — laid out by
  // `finalize` below inside whichever wrapper the content ends up in, top-right
  // corner (mirrors the est speaker button's corner placement, opposite side of
  // ExampleSentenceList's validate buttons since this is a single block rather
  // than a per-sentence list). `aiGenerated` is the caller's `!definitionsApproved`
  // (see prop doc above), so its inverse is exactly "already approved".
  const validateButtonsNode = word1 && language ? (
    <Box sx={{ position: "absolute", top: 0, right: 0, zIndex: 2, padding: "4px" }}>
      <ValidateFlagButtons word1={word1} language={language} field="definitions" alreadyApproved={!aiGenerated} />
    </Box>
  ) : null;

  // Wraps rendered content in whatever's needed to host the validate buttons +/or
  // the AI-generated treatment, without adding an extra DOM wrapper when neither
  // applies (i.e. existing callers that pass neither aiGenerated nor word1/language
  // keep rendering exactly as before).
  const finalize = (content: React.ReactNode): React.ReactElement => {
    if (aiGenerated) return wrapAiGenerated(content, validateButtonsNode);
    if (validateButtonsNode) {
      return (
        <Box className="long-definition-display--validatable" sx={{ position: "relative" }}>
          {validateButtonsNode}
          {content}
        </Box>
      );
    }
    return <>{content}</>;
  };

  // Fallback: no parts (e.g. enrichment didn't run, or pure-English definition that the
  // server still left unsplit) → render the original plain, parenthetical-stripped text.
  if (!longDefinitionParts?.length) {
    if (!longDefinition) return null;
    // `whiteSpace: pre-line` preserves the newlines carried in the text — the per-POS
    // `\n\n` from longDefObjectToDisplayString renders as a blank line between POS
    // blocks, and single `\n`s as line breaks — without it the DOM would collapse them
    // and the lines/blocks would run together.
    const text = (
      <Typography className={className} sx={[...(Array.isArray(sx) ? sx : [sx]), { whiteSpace: "pre-line" }]}>
        {prepareText(longDefinition)}
      </Typography>
    );
    return finalize(text);
  }

  // Parts path: a block paragraph whose inline children flow together. Chinese runs are
  // inline-flex cpcd; text runs are inline spans.
  //
  // Line rhythm: an xs cpcd contributes ~31px to its line box (39px intrinsic height
  // minus the wrapper's -4px vertical margins below), taller than a plain prose line at
  // the hosts' 14px/1.6 (~22px). Rather than letting cpcd-bearing lines stand out taller,
  // we pin EVERY line to the cpcd height with a px lineHeight so the whole paragraph has
  // one uniform rhythm. Only applied when a cpcd run is actually present — an all-text
  // parts array keeps the host's own lineHeight.
  const hasForeignPart = longDefinitionParts.some((part) => part.type !== "text");
  const parts = (
    <Typography
      component="div"
      className={className}
      // pre-line preserves the newlines carried inside the text parts — the per-POS
      // `\n\n` renders as a blank line between POS blocks — same reason as the
      // plain-text fallback above.
      sx={[
        ...(Array.isArray(sx) ? sx : [sx]),
        { whiteSpace: "pre-line", ...(hasForeignPart && { lineHeight: "31px" }) },
      ]}
    >
      {longDefinitionParts.map((part, index) => {
        if (part.type === "text") {
          // prepareText (stripParentheses) is applied per text part; whitespace and
          // newlines around embedded Chinese are preserved so words don't run together
          // across part boundaries.
          return <span key={index}>{prepareText(part.value)}</span>;
        }
        return (
          <Box
            key={index}
            component="span"
            className="mobile-demo-long-definition-foreign"
            // inline-block wrapper keeps the cpcd run as a single inline unit within the
            // prose; verticalAlign middle centers it on the surrounding text line.
            // The symmetric NEGATIVE vertical margins shrink the cpcd's line-box
            // footprint (it's ~15px taller than a prose line at xs: char + pinyin row +
            // padding) so the char/pinyin overhang into the surrounding half-leading
            // instead of pushing the line open. -4px per side eats the cpcd's 2px
            // internal padding plus ~2px of slack; the glyphs still paint (no clipping).
            sx={{ display: "inline-block", verticalAlign: "middle", mx: "1px", my: "-4px" }}
          >
            <SegmentedSentenceDisplay
              display="inline"
              size="xs"
              flexWrap="nowrap"
              showPinyin={showPinyin}
              showPinyinColor={showPinyinColor}
              onSegmentOpen={onSegmentOpen}
              sentence={{
                foreignText: part.foreignText,
                _segments: part._segments,
                segmentMetadata: part.segmentMetadata,
              }}
            />
          </Box>
        );
      })}
    </Typography>
  );
  return finalize(parts);
};

// Wraps the rendered definition in the shared AI-generated surface (orange
// border/tint) plus badge, and (when given) the absolutely-positioned inline
// validator buttons — needs position:relative to host those. A dedicated helper
// (rather than inlining twice) so the two render branches above stay visually
// identical when unapproved.
function wrapAiGenerated(content: React.ReactNode, validateButtonsNode?: React.ReactNode): React.ReactElement {
  return (
    <Box
      className="long-definition-display--ai-generated"
      sx={{ ...aiGeneratedSurfaceSx, borderRadius: "10px", padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px", position: "relative" }}
    >
      <AiGeneratedBadge className="long-definition-ai-badge" label="AI GENERATED" />
      {validateButtonsNode}
      {content}
    </Box>
  );
}

export default LongDefinitionDisplay;
