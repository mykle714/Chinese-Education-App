import { Box, Typography, useTheme } from "@mui/material";
import SegmentedSentenceDisplay from "../../components/SegmentedSentenceDisplay";
import { SpeakerButton } from "./FlashcardsLearnPage/FlashCardSection";
import ValidateFlagButtons from "../../components/ValidateFlagButtons";
import { buildSentencePronunciation } from "../../utils/sentencePronunciation";
import { renderEnglishWithVocabUnderline } from "./exampleSentenceText";
import { FC_FONT } from "./constants";
import { SIZE, LEADING } from "../../theme/scale";
import { aiGeneratedSurfaceSx } from "../../theme/aiGeneratedStyling";
import { AiGeneratedBadge } from "../../components/AiGeneratedBadge";
import { useAuth } from "../../AuthContext";
import { tts } from "../../services/tts";
import type { VocabEntry, Language, ValidationField } from "../../types";

// One example sentence, as stored on a vet/det row.
export type ExampleSentence = NonNullable<VocabEntry["exampleSentences"]>[number];

// The validation system only covers the first 3 example sentences per entry
// (docs/DATA_VALIDATION_SYSTEM.md field model) — index-to-field lookup for the
// inline validator buttons; sentences beyond index 2 get no buttons.
const EXAMPLE_SENTENCE_FIELDS: ValidationField[] = [
  "exampleSentence0", "exampleSentence1", "exampleSentence2",
];

// THE single source of truth for the est (example-sentence tab) UI. Both
// card-detail surfaces render this so they can never drift again:
//   - the eip's Examples tab (InfoCardPanelBody), and
//   - the read-only + saved cdp (VocabCardDetailBody / VocabCardSections).
// Every est feature (headword underline, English-gloss underline, per-segment
// definition popups + drill-in, per-sentence audio, the drag-scrub gesture that
// walks the selection word-by-word with audio) lives here exactly once.
interface ExampleSentenceListProps {
  sentences: ExampleSentence[];
  // Headword to underline within each sentence's foreign text (and, via
  // translatedVocab, its English gloss). Pass the entry's entryKey.
  vocabWord?: string;
  language?: Language;
  showPinyin: boolean;
  showPinyinColor: boolean;
  // NOTE: word spacing is NOT a prop — it is read from the account setting below
  // so no caller can forget to thread it (the cdp did, for exactly that reason).
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
  onSegmentOpen,
  onSpeakSentence,
  speakingKey,
}) => {
  const theme = useTheme();
  const fc = theme.palette.flashcard;
  // Account-level display preference (users."showSegmentSpaces", migration 129) —
  // read here rather than threaded so every est surface renders identically.
  const { user } = useAuth();
  const showSegmentSpaces = user?.showSegmentSpaces === true;

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
          {/* Top-right action cluster — the validator Approve/Flag pair and the
              speaker sit on ONE absolutely-positioned row so they read as a single
              group of controls in the corner (the validate buttons used to live in
              the opposite corner). Out of flow on purpose: it floats OVER the card
              and must never change the card's measured size, so a validator's view
              lays out identically to everyone else's.
              zIndex keeps the row above SegmentedSentenceDisplay's position:relative
              root, which would otherwise paint over (and steal clicks from) it
              because it follows in DOM order. */}
          {(onSpeakSentence || (vocabWord && language && index < EXAMPLE_SENTENCE_FIELDS.length)) && (
            <Box
              className="example-sentence-actions"
              sx={{
                position: "absolute",
                top: 0,
                right: 0,
                zIndex: 2,
                padding: "4px",
                display: "flex",
                alignItems: "center",
                gap: "2px",
              }}
            >
              {vocabWord && language && index < EXAMPLE_SENTENCE_FIELDS.length && (
                // Validator-only (docs/DATA_VALIDATION_SYSTEM.md) — renders nothing
                // for everyone else, leaving the speaker alone in the corner.
                <ValidateFlagButtons
                  className="example-sentence-validate"
                  word1={vocabWord}
                  language={language}
                  field={EXAMPLE_SENTENCE_FIELDS[index]}
                  alreadyApproved={isHumanApproved}
                />
              )}
              {onSpeakSentence && (
                <Box className="example-sentence-speaker">
                  <SpeakerButton
                    onClick={() =>
                      onSpeakSentence(sentence.foreignText, buildSentencePronunciation(sentence))
                    }
                    isLoading={speakingKey === sentence.foreignText}
                  />
                </Box>
              )}
            </Box>
          )}
          <SegmentedSentenceDisplay
            sentence={sentence}
            size="sm"
            flexWrap="wrap"
            className="example-sentence-foreign"
            showPinyin={showPinyin}
            showPinyinColor={showPinyinColor}
            showSegmentSpaces={showSegmentSpaces}
            vocabWord={vocabWord}
            language={language}
            selectable
            onSegmentOpen={onSegmentOpen}
            // Drag-scrub: while a segment is selected, a horizontal drag anywhere
            // on screen walks the selection word-by-word and narrates each word.
            // Reuses the sentence-narration callback (same (text, pronunciation)
            // signature), so it inherits the parent's slow-rate wrapper and is
            // absent whenever narration is off.
            onSegmentSpeak={onSpeakSentence}
            // Unlock the audio context on the gesture's pointerdown — the scrub's
            // own narration fires from pointermove, too late for mobile autoplay
            // policy to treat it as user-initiated.
            onScrubStart={onSpeakSentence ? () => tts.cloud.unlock() : undefined}
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
