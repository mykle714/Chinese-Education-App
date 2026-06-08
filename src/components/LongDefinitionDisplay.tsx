import { Box, Typography, type SxProps, type Theme } from "@mui/material";
import { stripParentheses } from "../utils/definitionUtils";
import type { LongDefinitionPart } from "../types";
import SegmentedSentenceDisplay from "./SegmentedSentenceDisplay";

interface LongDefinitionDisplayProps {
  // Raw long-definition string — used for the plain-text fallback when parts are absent.
  longDefinition?: string | null;
  // Server-computed split of longDefinition into English-prose parts and embedded-Chinese
  // parts. When present, Chinese parts render as inline cpcd with the segment popup.
  longDefinitionParts?: LongDefinitionPart[] | null;
  className?: string;
  // Forwarded to the inline cpcd for embedded Chinese (mirrors the expansion display).
  showPinyin?: boolean;
  showPinyinColor?: boolean;
  // Typography styling (font/color/size) for the prose, supplied by the host surface
  // so this stays presentation-agnostic.
  sx?: SxProps<Theme>;
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
  sx,
}) => {
  // Fallback: no parts (e.g. enrichment didn't run, or pure-English definition that the
  // server still left unsplit) → render the original plain, parenthetical-stripped text.
  if (!longDefinitionParts?.length) {
    if (!longDefinition) return null;
    return (
      <Typography className={className} sx={sx}>
        {stripParentheses(longDefinition)}
      </Typography>
    );
  }

  // Parts path: a block paragraph whose inline children flow together. Chinese runs are
  // inline-flex cpcd; text runs are inline spans. A generous lineHeight keeps the
  // pinyin-below row from colliding with the following wrapped line of prose.
  return (
    <Typography
      component="div"
      className={className}
      sx={[...(Array.isArray(sx) ? sx : [sx]), { lineHeight: 1.9 }]}
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
};

export default LongDefinitionDisplay;
