import { Box, CircularProgress, Typography } from "@mui/material";
import { AutoAwesome } from "@mui/icons-material";
import LongDefinitionDisplay from "../components/LongDefinitionDisplay";
import { ReaderKeycapButton } from "./ReaderMoreInfoKey";
import { EIP_ADD_KEY_SIZES } from "../features/flashcards/FlashcardsLearnPage/eipAddKeySizes";
import { useSentenceExplanation } from "./useSentenceExplanation";
import { useFlashcardLearnSettings } from "../hooks/useFlashcardLearnSettings";
import { EXPLAIN_SENTENCE_MAX_LENGTH } from "../../server/contracts/wire";
import { COLORS } from "../theme/colors";
import { FONTS } from "../theme/fonts";
import { SIZE } from "../theme/scale";
import type { Language } from "../types";

/**
 * ReaderSentenceFace — what the rdb (VocabDisplayCard `customFace`) shows while a whole
 * sentence is highlighted (SENTENCE MODE: the second-tier long-press, or a desktop
 * double-click). Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sentence Explain".
 *
 *   ┌──────────────────────────────────┐
 *   │                    [✦ Explain]   │  ← the Explain key, top right (the More Info key's
 *   │                                  │    recipe, ReaderKeycapButton, with the AI sparkle)
 *   │  explanation, longdef style …    │  ← LongDefinitionDisplay once answered (embedded
 *   │                                  │    Chinese as inline cpcd with tap popups)
 *   └──────────────────────────────────┘
 *
 * Once the answer is showing, the key (and its header row) is removed — the explanation alone
 * fills the face. The key stays, disabled, while the request is in flight.
 *
 * Before Explain is tapped the face holds only the key (owner's call 2026-11-20; sentence
 * content for this face is deferred — docs/DEFERRED_WORK.md). Nothing is requested until the
 * tap, since a cache miss spends the learner's daily AI budget (useSentenceExplanation).
 *
 * The key is withheld (a one-line notice instead) for a selection over
 * EXPLAIN_SENTENCE_MAX_LENGTH (the server would 400) and for non-Chinese documents (the
 * server explains zh only; Spanish is paused).
 *
 * Layer: shared component (src/reading — the reading engine shared by the Reader and cyoa, docs/CYOA_FEATURE.md § 4). Caller: ReaderDocumentPage.
 */

interface ReaderSentenceFaceProps {
    sentence: string;
    language: Language;
}

// The face's one-line status / notice text: the rdb's secondary text.
const statusTextSx = { fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.textSecondary } as const;

export default function ReaderSentenceFace({ sentence, language }: ReaderSentenceFaceProps) {
    const { status, explanation, explanationParts, errorMessage, explain } = useSentenceExplanation(sentence, language);
    const { settings } = useFlashcardLearnSettings();

    const tooLong = sentence.length > EXPLAIN_SENTENCE_MAX_LENGTH;
    const unsupported = language !== "zh";
    const notice = unsupported
        ? "Explain is available for Chinese documents."
        : tooLong
            ? "This selection is too long to explain."
            : null;

    // Once the answer is on screen the key has nothing left to do, so the header row (and its
    // reserved height) goes away and the explanation takes the face's top edge.
    const showHeader = notice !== null || status !== "ready";

    return (
        <Box className="reader-sentence-face" sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
            {showHeader && (
                <Box className="reader-sentence-face__header" sx={{ display: "flex", justifyContent: "flex-end", alignItems: "center", minHeight: 32 }}>
                    {notice ? (
                        <Typography className="reader-sentence-face__notice" sx={{ ...statusTextSx, mr: "auto" }}>
                            {notice}
                        </Typography>
                    ) : (
                        <ReaderKeycapButton
                            className="reader-sentence-face__explain-key"
                            label="Explain"
                            ariaLabel="Explain this sentence with AI"
                            onClick={() => { void explain(); }}
                            // Answering: nothing more to ask for (once answered the key is gone).
                            disabled={status === "loading"}
                            startIcon={(
                                <AutoAwesome
                                    className="reader-sentence-face__explain-sparkle"
                                    sx={{ fontSize: EIP_ADD_KEY_SIZES.regular.icon, color: COLORS.aiGenerated }}
                                />
                            )}
                        />
                    )}
                </Box>
            )}

            {status === "loading" && (
                <Box className="reader-sentence-face__loading" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <CircularProgress size={14} thickness={5} sx={{ color: COLORS.aiGenerated }} />
                    <Typography sx={statusTextSx}>Explaining…</Typography>
                </Box>
            )}

            {status === "ready" && explanation && (
                <LongDefinitionDisplay
                    className="reader-sentence-face__explanation"
                    longDefinition={explanation}
                    longDefinitionParts={explanationParts}
                    showPinyin
                    showPinyinColor={settings.showPinyinColor}
                    sx={{ fontFamily: FONTS.sans, fontSize: SIZE.body, color: COLORS.onSurface }}
                />
            )}

            {status === "empty" && (
                <Typography className="reader-sentence-face__empty" sx={statusTextSx}>
                    No explanation is available for this sentence.
                </Typography>
            )}

            {status === "error" && errorMessage && (
                <Typography className="reader-sentence-face__error" sx={statusTextSx}>
                    {errorMessage}
                </Typography>
            )}
        </Box>
    );
}
