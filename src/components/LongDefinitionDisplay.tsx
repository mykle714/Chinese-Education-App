import { Box, Typography, type SxProps, type Theme } from "@mui/material";
import { stripParentheses } from "../utils/definitionUtils";
import type { LongDefinitionPart } from "../types";
import SegmentedSentenceDisplay from "./SegmentedSentenceDisplay";
import { aiGeneratedSurfaceSx } from "../theme/aiGeneratedStyling";
import { AiGeneratedBadge } from "./AiGeneratedBadge";

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
}) => {
  // Fallback: no parts (e.g. enrichment didn't run, or pure-English definition that the
  // server still left unsplit) → render the original plain, parenthetical-stripped text.
  if (!longDefinitionParts?.length) {
    if (!longDefinition) return null;
    // `whiteSpace: pre-line` preserves the `\n\n` that longDefObjectToDisplayString
    // inserts BETWEEN per-POS entries (server/utils/definitions.ts) — without it the
    // DOM collapses the break and the POS senses run together on one line.
    const text = (
      <Typography className={className} sx={[...(Array.isArray(sx) ? sx : [sx]), { whiteSpace: "pre-line" }]}>
        {stripParentheses(longDefinition)}
      </Typography>
    );
    return aiGenerated ? wrapAiGenerated(text) : text;
  }

  // Parts path: a block paragraph whose inline children flow together. Chinese runs are
  // inline-flex cpcd; text runs are inline spans. A generous lineHeight keeps the
  // pinyin-below row from colliding with the following wrapped line of prose.
  const parts = (
    <Typography
      component="div"
      className={className}
      // pre-line preserves the per-POS `\n\n` break carried inside the text parts
      // (same reason as the plain-text fallback above).
      sx={[...(Array.isArray(sx) ? sx : [sx]), { lineHeight: 1.9, whiteSpace: "pre-line" }]}
    >
      {longDefinitionParts.map((part, index) => {
        if (part.type === "text") {
          // stripParentheses is applied per text part; whitespace around embedded Chinese
          // is preserved so words don't run together across part boundaries.
          return <span key={index}>{stripParentheses(part.value)}</span>;
        }
        return (
          <Box
            key={index}
            component="span"
            className="mobile-demo-long-definition-foreign"
            // inline-block wrapper keeps the cpcd run as a single inline unit within the
            // prose; verticalAlign middle centers it on the surrounding text line.
            sx={{ display: "inline-block", verticalAlign: "middle", mx: "1px" }}
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
  return aiGenerated ? wrapAiGenerated(parts) : parts;
};

// Wraps the rendered definition in the shared AI-generated surface (orange
// border/tint) plus badge. A dedicated helper (rather than inlining twice) so the
// two render branches above stay visually identical when unapproved.
function wrapAiGenerated(content: React.ReactNode): React.ReactElement {
  return (
    <Box
      className="long-definition-display--ai-generated"
      sx={{ ...aiGeneratedSurfaceSx, borderRadius: "10px", padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px" }}
    >
      <AiGeneratedBadge className="long-definition-ai-badge" label="AI GENERATED" />
      {content}
    </Box>
  );
}

export default LongDefinitionDisplay;
