import { Box, Typography, type SxProps, type Theme } from "@mui/material";
import { stripParentheses } from "../utils/definitionUtils";

/**
 * Collapse any run of two-or-more newlines (a full blank line) down to a single
 * newline, so paragraph breaks render as a plain line break rather than an empty
 * gap. Both the anchor/culture split WITHIN a POS value and the per-POS join in
 * longDefObjectToDisplayString store their separators as `\n\n`; with the hosts'
 * `whiteSpace: pre-line` those would otherwise paint a blank line. Single newlines
 * are left untouched. Intervening spaces/tabs between the newlines are also eaten.
 */
function collapseBlankLines(text: string): string {
  return text.replace(/\s*\n\s*\n\s*/g, "\n");
}

// Presentation-layer text prep shared by both render paths: collapse blank lines,
// then strip parenthetical asides (mirrors the flp gloss treatment).
function prepareText(text: string): string {
  return stripParentheses(collapseBlankLines(text));
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
    // prepareText has already collapsed each `\n\n` (per-POS join from
    // longDefObjectToDisplayString, and the anchor/culture split within a value) down to
    // a single `\n`; `whiteSpace: pre-line` then preserves that lone newline as a line
    // break — without it the DOM would collapse it and the lines would run together.
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
      // pre-line preserves the single `\n` break (prepareText has collapsed the
      // original `\n\n`) carried inside the text parts — same reason as the plain-text
      // fallback above.
      sx={[
        ...(Array.isArray(sx) ? sx : [sx]),
        { whiteSpace: "pre-line", ...(hasForeignPart && { lineHeight: "31px" }) },
      ]}
    >
      {longDefinitionParts.map((part, index) => {
        if (part.type === "text") {
          // prepareText (blank-line collapse + stripParentheses) is applied per text part;
          // whitespace around embedded Chinese is preserved so words don't run together
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
