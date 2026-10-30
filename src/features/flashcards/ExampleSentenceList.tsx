import { Box, Typography } from "@mui/material";
import SegmentedSentenceDisplay from "../../components/SegmentedSentenceDisplay";
import { SpeakerButton } from "./FlashcardsLearnPage/FlashCardSection";
import ValidateFlagButtons from "../../components/ValidateFlagButtons";
import { buildSentencePronunciation } from "../../utils/sentencePronunciation";
import { renderEnglishWithVocabUnderline } from "./exampleSentenceText";
import { FC_FONT } from "./constants";
import { COLORS } from "../../theme/colors";
import { useEipColors } from "./FlashcardsLearnPage/useEipPalette";
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

// THE single source of truth for the est (example-sentence tab) UI, rendered by the
// eip's Examples tab (InfoCardPanelBody) — and through it by every eip host, both cdps
// included (the dictionary cdp mounts the panel inline since 2026-10-10).
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
  const colors = useEipColors();
  // Account-level display preference (users."showSegmentSpaces", migration 129) —
  // read here rather than threaded so every est surface renders identically.
  const { user } = useAuth();
  const showSegmentSpaces = user?.showSegmentSpaces === true;

  return (
    <Box
      className="example-sentence-list"
      // `.esl` — one outlined card per sentence (Tower Tier 2 `.ex`). Provenance shows
      // as the ring's colour (orange = AI) plus the corner tag, so an approved sentence
      // and a generated one can never be mistaken for each other
      // (docs/DATA_VALIDATION_SYSTEM.md).
      sx={{ display: "flex", flexDirection: "column", gap: "10px" }}
    >
      {sentences.map((sentence, index) => {
        // A sentence counts as human-reviewed only when the server attached a valid
        // approval (validations row with the approve stamp whose stored content still
        // matches the det data — computed in enrichExampleSentencesMetadataBatch,
        // docs/DATA_VALIDATION_SYSTEM.md). Anything else renders the AI-generated
        // treatment: an orange ring + the `.aib` corner tag (AiGeneratedBadge "tag").
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
            // `.ex` (Tower Tier 2, 2026-10-29): an outlined CARD — the eip palette's `card`
            // fill in a 1.5px `line` ring, 14px radius. An unapproved (AI) sentence swaps
            // the ring for a 1px AI-orange one and carries the `.aib` tag on its bottom
            // edge — no orange tint any more (that was the shared aiGeneratedSurfaceSx).
            // Rings are inset shadows, so both states are the same size and the list
            // never reflows as sentences are approved.
            backgroundColor: colors.card,
            boxShadow: `inset 0 0 0 ${isHumanApproved ? `1.5px ${colors.line}` : `1px ${COLORS.aiGenerated}`}`,
            borderRadius: "14px",
            // The speaker floats in the top-right action cluster (below), not in the
            // design's left gutter (`.ex .rb`), so the sentence keeps the full width.
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            // Room for the AI tag hanging 9px below the card's edge.
            marginBottom: isHumanApproved ? 0 : "6px",
          }}
        >
          {!isHumanApproved && (
            <AiGeneratedBadge
              className="example-sentence-ai-badge"
              label="AI GENERATED"
              variant="tag"
              face={colors.card}
              ink={colors.ink}
              sx={{ position: "absolute", right: "10px", bottom: "-9px", zIndex: 2 }}
            />
          )}
             {/* Top-right action cluster — the validator Approve/Flag pair and the
              speaker sit on ONE absolutely-positioned row so they read as a single
              group of controls in the corner. The Tower Tier 2 design moves the speaker
              to a left gutter (`.ex .rb`); that layout change was not taken.
              Out of flow on purpose: it floats OVER the card and must never change the
              card's measured size, so a validator's view lays out identically to
              everyone else's.
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
              // `.ex .en`: 13.5px in ink2 (was 11.5px muted).
              fontSize: 13.5,
              color: colors.ink2,
              fontFamily: FC_FONT,
              lineHeight: 1.35,
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
