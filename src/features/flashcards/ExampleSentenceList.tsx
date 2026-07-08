import { Box, Typography, useTheme } from "@mui/material";
import SegmentedSentenceDisplay from "../../components/SegmentedSentenceDisplay";
import { SpeakerButton } from "./FlashcardsLearnPage/FlashCardSection";
import { buildSentencePronunciation } from "./FlashcardsLearnPage/sentencePronunciation";
import { renderEnglishWithVocabUnderline } from "./exampleSentenceText";
import { FC_FONT } from "./FlashcardsLearnPage/constants";
import { SIZE, LEADING } from "../../theme/scale";
import { aiGeneratedSurfaceSx } from "../../theme/aiGeneratedStyling";
import { AiGeneratedBadge } from "../../components/AiGeneratedBadge";
import type { VocabEntry, Language } from "../../types";

// One example sentence, as stored on a vet/det row.
export type ExampleSentence = NonNullable<VocabEntry["exampleSentences"]>[number];

// THE single source of truth for the est (example-sentence tab) UI. Both
// card-detail surfaces render this so they can never drift again:
//   - the eip's Examples tab (InfoCardPanelBody), and
//   - the read-only + saved cdp (VocabCardDetailBody / VocabCardSections).
// Every est feature (headword underline, English-gloss underline, per-segment
// definition popups + drill-in, per-sentence audio) lives here exactly once.
interface ExampleSentenceListProps {
  sentences: ExampleSentence[];
  // Headword to underline within each sentence's foreign text (and, via
  // translatedVocab, its English gloss). Pass the entry's entryKey.
  vocabWord?: string;
  language?: Language;
  showPinyin: boolean;
  showPinyinColor: boolean;
  // Renders a real gap between segment groups (eip user toggle). Defaults off.
  showSegmentSpaces?: boolean;
  // Smaller glyph + pinyin, for denser surfaces (the cdp stacks several boxes).
  // Defaults to the eip's full size so the two look identical unless opted out.
  compact?: boolean;
  // When set, tapping a segment's popup drills into that word's card detail.
  onSegmentOpen?: (segment: string) => void;
  // TTS: when provided, each sentence shows a top-right speaker button. Omit to
  // hide audio (e.g. narration disabled in settings).
  onSpeakSentence?: (text: string, pronunciation?: string) => void;
  speakingKey?: string | null;
}

const ExampleSentenceList: React.FC<ExampleSentenceListProps> = ({
  sentences,
  vocabWord,
  language,
  showPinyin,
  showPinyinColor,
  showSegmentSpaces = false,
  compact = false,
  onSegmentOpen,
  onSpeakSentence,
  speakingKey,
}) => {
  const theme = useTheme();
  const fc = theme.palette.flashcard;

  return (
    <Box
      className="example-sentence-list"
      sx={{ display: "flex", flexDirection: "column", gap: "12px" }}
    >
      {sentences.map((sentence, index) => {
        // A sentence counts as human-reviewed only when the server attached a valid
        // approval (validations row with the approve stamp whose stored content still
        // matches the det data — computed in enrichExampleSentencesMetadataBatch,
        // docs/DATA_VALIDATION_SYSTEM.md). Anything else renders the shared
        // AI-generated treatment (orange border/tint + sparkle badge), matching the
        // dictionary AI-fallback result card.
        const isHumanApproved = sentence.humanApproved === true;
        return (
        <Box
          key={index}
          className={
            isHumanApproved
              ? "example-sentence-item"
              : "example-sentence-item example-sentence-item--ai-generated"
          }
          sx={{
            position: "relative",
            // Approved sentences keep the quiet flashcard background; unapproved ones
            // take the shared AI surface (its translucent orange tint replaces subtleBg
            // so the tone matches the dictionary AI card exactly).
            ...(isHumanApproved ? { background: fc.subtleBg } : aiGeneratedSurfaceSx),
            borderRadius: "10px",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          {!isHumanApproved && (
            <AiGeneratedBadge
              className="example-sentence-ai-badge"
              label="AI GENERATED"
            />
          )}
          {onSpeakSentence && (
            // zIndex keeps the speaker above SegmentedSentenceDisplay's
            // position:relative root, which would otherwise paint over (and
            // steal clicks from) this absolutely-positioned button because it
            // follows in DOM order.
            <Box
              className="example-sentence-speaker"
              sx={{ position: "absolute", top: 0, right: 0, zIndex: 2, padding: "4px" }}
            >
              <SpeakerButton
                onClick={() =>
                  onSpeakSentence(sentence.foreignText, buildSentencePronunciation(sentence))
                }
                isLoading={speakingKey === sentence.foreignText}
              />
            </Box>
          )}
          <SegmentedSentenceDisplay
            sentence={sentence}
            size="sm"
            compact={compact}
            flexWrap="wrap"
            className="example-sentence-foreign"
            showPinyin={showPinyin}
            showPinyinColor={showPinyinColor}
            showSegmentSpaces={showSegmentSpaces}
            vocabWord={vocabWord}
            language={language}
            selectable
            onSegmentOpen={onSegmentOpen}
          />
          <Typography
            className="example-sentence-english"
            sx={{
              fontSize: SIZE.caption,
              color: fc.textSecondary,
              fontFamily: FC_FONT,
              lineHeight: LEADING.normal,
            }}
          >
            {renderEnglishWithVocabUnderline(sentence.english, sentence.translatedVocab)}
          </Typography>
        </Box>
        );
      })}
    </Box>
  );
};

export default ExampleSentenceList;
