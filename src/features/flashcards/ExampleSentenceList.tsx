import { Box, Typography, useTheme } from "@mui/material";
import SegmentedSentenceDisplay from "../../components/SegmentedSentenceDisplay";
import { SpeakerButton } from "./FlashcardsLearnPage/FlashCardSection";
import ValidateFlagButtons from "../../components/ValidateFlagButtons";
import { buildSentencePronunciation } from "../../utils/sentencePronunciation";
import { renderEnglishWithVocabUnderline } from "./exampleSentenceText";
import { FC_FONT } from "./constants";
import { aiGeneratedSurfaceSx } from "../../theme/aiGeneratedStyling";
import { AiGeneratedBadge } from "../../components/AiGeneratedBadge";
import { useAuth } from "../../AuthContext";
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
// definition popups + drill-in, per-sentence audio, per-word tap-to-narrate)
// lives here exactly once.
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
      // `.esl` — one card per sentence, on the page's own ground rather than in a
      // bordered box: provenance is the only thing that draws a border here, so an
      // approved sentence and a generated one can never be mistaken for each other
      // (docs/DATA_VALIDATION_SYSTEM.md, artboard 24).
      sx={{ display: "flex", flexDirection: "column", gap: "10px" }}
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
            // Approved sentences keep the quiet flashcard background AND a TRANSPARENT
            // border of the same width as the AI one: without it the two states are
            // different sizes and the list reflows as sentences are approved. Spread
            // FIRST so `aiGeneratedSurfaceSx`'s own border wins for the AI case.
            ...(isHumanApproved ? { background: fc.subtleBg, border: "1px solid transparent" } : aiGeneratedSurfaceSx),
            borderRadius: "12px",
            padding: "11px 13px 12px",
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
            // Tap-to-narrate: tapping a word speaks it. Reuses the sentence-narration
            // callback (same (text, pronunciation) signature), so it inherits the
            // parent's slow-rate wrapper and is absent whenever narration is off.
            onSegmentSpeak={onSpeakSentence}
          />
          <Typography
            className="example-sentence-english"
            sx={{
              fontSize: 11.5,
              color: fc.textSecondary,
              fontFamily: FC_FONT,
              lineHeight: 1.5,
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
