import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Popper, Typography } from "@mui/material";
import type { Instance as PopperInstance } from "@popperjs/core";
import { stripParentheses } from "../utils/definitionUtils";
import ForeignText, { type CPCDRowItem, isLatinScriptLang } from "./ForeignText";
import { FONTS } from "../theme/fonts";
import { SIZE } from "../theme/scale";
import { claimHorizontalGesture } from "../utils/segmentScrubLock";
import { claimSegmentSelection, registerSegmentSelectionOwner } from "../utils/segmentSelectionOwner";

type Size = "xs" | "sm" | "md";

// Punctuation should not be highlightable on hover/tap — it carries no lookup value.
// Uses Unicode property escapes to cover ASCII, CJK, and fullwidth punctuation/symbols.
const PUNCTUATION_REGEX = /^[\p{P}\p{S}\s]+$/u;
const isPunctuation = (ch: string): boolean => PUNCTUATION_REGEX.test(ch);

// CSS gap between segment groups when showSegmentSpaces is true.
// Sized proportionally to character width at each size — NOT a native space character.
const SEGMENT_GAP_BY_SIZE: Record<Size, string> = {
  xs: "3px",
  sm: "4px",
  md: "6px",
};

// --- Drag-scrub gesture ------------------------------------------------------
// While a segment is selected, a horizontal drag started ANYWHERE on the screen
// walks the selection word-by-word through this sentence and narrates each word
// it lands on. Enabled per call site by passing `onSegmentSpeak` (est only).
//
// Horizontal travel (px) that advances the selection by one segment. This is the
// gesture's one tuning knob — lower = more sensitive (shorter drag per word).
const SCRUB_STEP_PX = 28;
// Horizontal travel before a gesture is committed to being a scrub (vs. a tap).
const SCRUB_LOCK_PX = 12;
// If the pointer travels this far vertically before locking horizontally, the
// gesture is a scroll and we bail out for the rest of the pointer sequence.
const SCRUB_VERTICAL_ABORT_PX = 12;
// How long after a scrub ends that character taps stay suppressed, so the
// trailing touchend/click of the drag doesn't re-select the word under the finger.
const SCRUB_TAP_SUPPRESS_MS = 300;
// Debounce on SCRUB narration: the word only plays once the selection has sat
// still this long. Sweeping across a sentence therefore narrates the word you
// settle on instead of machine-gunning every word the drag crossed, and a slow
// word-by-word drag still narrates each one (each step outlasts the delay).
// Tap-to-narrate is deliberately NOT debounced — it is a single deliberate act,
// and it must fire inside the touch gesture to satisfy mobile autoplay policy.
const SCRUB_AUDIO_DELAY_MS = 300;

// Vertical offset (px, subtracted from the char glyph's bottom edge) for the
// vocab-word underline. sm sits 1px lower than xs/md to match its glyph metrics.
const VOCAB_UNDERLINE_OFFSET_BY_SIZE: Record<Size, number> = {
  xs: 4,
  sm: 4,
  md: 5,
};

// Latin-script languages render one cell per whitespace-delimited WORD (not per
// character) and have no pinyin overlay. `isLatinScriptLang` is imported from
// ForeignText so the language set lives in exactly one place.

interface SegmentMeta {
  pronunciation?: string;
  definition?: string;
  particleOrClassifier?: { type: 'particle' | 'classifier'; definition: string };
  wordForms?: Record<string, string>;
}

interface SentenceData {
  foreignText: string;
  _segments?: string[];
  segmentMetadata?: Record<string, SegmentMeta>;
  partOfSpeechDict?: Record<string, string>;
  // Per-noun-token grammatical number: a sentence can mix singular and plural nouns
  // (`I put the book on the shelves`). Drives plural-form selection in resolveWordForm.
  numberDict?: Record<string, 'singular' | 'plural'>;
  // Per-verb-token tense: a sentence can mix tenses (`I bought books, will return them`),
  // so each verb's popup gloss inflects on its own tag. Drives verb-form selection in
  // resolveWordForm. (Replaced a single sentence-level `tense`.)
  tenseDict?: Record<string, 'past' | 'present' | 'future'>;
}

interface SegmentedSentenceDisplayProps {
  sentence: SentenceData;
  size?: Size;
  compact?: boolean;
  flexWrap?: "nowrap" | "wrap";
  justifyContent?: string;
  className?: string;
  showPinyin?: boolean;
  // When false, pinyin renders in the inherited text color instead of tone colors.
  showPinyinColor?: boolean;
  // When set, draws a single continuous underline beneath characters belonging to this segment
  vocabWord?: string;
  // When true, renders a CSS gap between segment groups instead of uniform overlap
  showSegmentSpaces?: boolean;
  // Language of the sentence. Latin-script languages (e.g. 'es') render one cell
  // per whitespace word instead of per character, with no pinyin overlay.
  language?: string;
  // Layout of the root container. "block" (default) fills its line; "inline" makes the
  // whole display an inline-flex box so it can sit mid-sentence within flowing prose
  // (used when a Chinese run is embedded in a long definition). The popup/highlight
  // geometry is rect-based and works identically in either mode.
  display?: "block" | "inline";
  // Allow the characters/pinyin to be selected (and a text cursor to appear) on
  // desktop. Defaults to false; example-sentence call sites pass true. See
  // CPCDRow.selectable.
  selectable?: boolean;
  // When provided, the definition popup becomes tappable: it shows a trailing
  // drill-in chevron and, on click, calls this with the selected segment's
  // headword so the caller can open the eip for that word. Omit to keep the
  // popup a passive tooltip (e.g. the long-definition display).
  onSegmentOpen?: (segment: string) => void;
  // WHOLE-RUN MODE. When set, this display stops behaving like a word-by-word lookup:
  // a tap/hover anywhere selects the ENTIRE run and the popup shows this translation
  // instead of the tapped segment's gloss. Used for the Chinese phrases cited inside a
  // long definition / comparison paragraph, where the unit the learner cares about is
  // the cited phrase, not its individual words (det `longDefinitionCitations`, migration
  // 126). The popup is passive in this mode — the run is a phrase, not a headword, so
  // there is no single word for `onSegmentOpen` to drill into.
  runTranslation?: string | null;
  // DRAG-SCRUB. When provided, the drag-scrub gesture is enabled: while a segment
  // is selected, a horizontal drag anywhere on screen moves the selection one
  // segment per SCRUB_STEP_PX of travel and calls this with the newly selected
  // segment + its pronunciation so the caller can narrate it. Omit to keep the
  // display tap-only (long definitions, whole-run citations).
  onSegmentSpeak?: (segment: string, pronunciation?: string) => void;
  // Called synchronously on the pointerdown that *may* begin a scrub. Callers use
  // it to unlock the audio context inside a real user gesture — the narration
  // itself fires later, from pointermove, which mobile autoplay policy won't
  // accept as the unlocking gesture. See useTTS.unlockAudio.
  onScrubStart?: () => void;
}

interface CharRenderData {
  pinyin: string;
  segment: string;
  start: number;
  end: number;
  definition?: string;
}

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface HighlightRow {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// Selects the contextually appropriate English form from a wordForms map.
// Verbs prefer tense-specific keys (past/present/future); other POS use their tag directly.
// Nouns prefer the plural form ('noun_plural') when this token is plural in the sentence,
// otherwise the singular ('noun'). When a verb is used nominally (tagged "noun" in this
// sentence's partOfSpeechDict), fall back to the gerund form since verb entries have no
// dedicated "noun" key.
function resolveWordForm(
  wordForms: Record<string, string>,
  pos: string | undefined,
  tense: string | undefined,
  number: 'singular' | 'plural' | undefined
): string | undefined {
  if (!pos) return undefined;
  if (tense && (pos === 'verb' || pos === 'auxiliary verb')) {
    return wordForms[tense] ?? wordForms[pos];
  }
  if (pos === 'noun') {
    if (number === 'plural') {
      return wordForms['noun_plural'] ?? wordForms['noun'] ?? wordForms['gerund'];
    }
    return wordForms['noun'] ?? wordForms['gerund'];
  }
  return wordForms[pos];
}

const SegmentedSentenceDisplay: React.FC<SegmentedSentenceDisplayProps> = ({
  sentence,
  size = "sm",
  compact = false,
  flexWrap = "wrap",
  justifyContent,
  className,
  showPinyin,
  showPinyinColor = true,
  vocabWord,
  showSegmentSpaces = false,
  language,
  display = "block",
  selectable = false,
  onSegmentOpen,
  runTranslation,
  onSegmentSpeak,
  onScrubStart,
}) => {
  // Whole-run mode is on only when a translation actually arrived for this run — a run the
  // backfill hasn't reached yet falls back to the per-segment popup.
  const isWholeRun = !!runTranslation?.trim();
  // Latin-script languages tokenize on whitespace (one cell per word) and never
  // show a pinyin overlay or per-character segmentation.
  const isLatin = isLatinScriptLang(language);
  const rowRef = useRef<HTMLDivElement | null>(null);
  // The popup renders through a Popper portal, so it lives outside rowRef in the
  // DOM. We keep a ref to it so the outside-tap dismiss handler can tell a tap on
  // the popup apart from a tap on empty space (and not close it out from under the
  // click that opens the eip).
  const popupRef = useRef<HTMLDivElement | null>(null);
  // The live popper.js instance (exposed by Popper's popperRef). We call its
  // update() to re-run placement after the popup's content reflows post-open.
  const popperInstanceRef = useRef<PopperInstance | null>(null);
  const charRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number; segment: string; definition?: string } | null>(null);
  // Viewport-space rect of the highlighted word(s); used as Popper anchor so the
  // popup escapes any ancestor scroll container's overflow clipping.
  const [popupAnchorRect, setPopupAnchorRect] = useState<DOMRect | null>(null);
  // True while the interactive popup is being pressed, so we can grey it out as
  // tap feedback. Driven explicitly (not via the CSS :active pseudo) because the
  // pointerdown handler calls preventDefault(), which can suppress :active.
  const [popupPressed, setPopupPressed] = useState(false);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const [vocabUnderlineRects, setVocabUnderlineRects] = useState<HighlightRect[]>([]);
  // Pending dismiss timer. Armed when the mouse leaves the row or popup; cancelled
  // when the mouse re-enters either, so users can move from word → popup without
  // the popup disappearing mid-traversal.
  const dismissTimerRef = useRef<number | null>(null);

  // --- Drag-scrub state ------------------------------------------------------
  // Enabled only when the caller wired narration AND this display is in
  // per-segment mode (a whole-run citation has no word-by-word selection to walk).
  const scrubEnabled = !!onSegmentSpeak && !isWholeRun;
  // Mirror of selectedRange for the document-level scrub listeners. Those listeners
  // are installed once per selection *existence* (not per selection *value*), so
  // they must not close over a specific range — their own setSelectedRange calls
  // would otherwise tear the gesture's listeners down mid-drag.
  const selectedRangeRef = useRef(selectedRange);
  useEffect(() => {
    selectedRangeRef.current = selectedRange;
  }, [selectedRange]);

  // --- App-wide "one selection at a time" --------------------------------------
  // Each sentence is its own display with its own selection state, and this
  // display's tap-to-dismiss rule can't distinguish a sibling's characters from
  // its own (both match `.cpcd-row__char-cell`). So selecting is an explicit
  // CLAIM: every other mounted display clears itself. Without it, tapping a word
  // in a second sentence leaves the first sentence's word selected — two popups
  // open, and two competing claims on horizontal gestures for the scrub to walk.
  // Pending (debounced) scrub narration. Only ever one in flight: each step
  // replaces the previous word's pending play, so a fast sweep collapses to a
  // single utterance for the word the drag comes to rest on. Declared up here
  // because the selection-owner callback below also has to drop it.
  const narrationTimerRef = useRef<number | null>(null);
  const cancelPendingNarration = useCallback(() => {
    if (narrationTimerRef.current !== null) {
      window.clearTimeout(narrationTimerRef.current);
      narrationTimerRef.current = null;
    }
  }, []);

  const selectionTokenRef = useRef({});
  useEffect(
    () =>
      registerSegmentSelectionOwner(selectionTokenRef.current, () => {
        // Clear the ref alongside the state: the scrub's document listeners read
        // the ref, and a stale range there would let a drag resurrect a selection
        // this display no longer owns. A queued narration goes with it — the word
        // it belongs to is no longer selected anywhere.
        selectedRangeRef.current = null;
        cancelPendingNarration();
        setSelectedRange(null);
      }),
    [cancelPendingNarration]
  );
  // True from the moment a scrub locks until SCRUB_TAP_SUPPRESS_MS after it ends.
  // Character cells select on touchend, and touchend targets the element the touch
  // STARTED on — so without this, ending a scrub re-selects the word the drag began
  // over, undoing the scrub's final step.
  const suppressTapRef = useRef(false);
  const suppressTapTimerRef = useRef<number | null>(null);
  // In-flight gesture state. Lives in a ref, not in the effect's closure, because
  // the listeners are re-installed whenever a callback prop's identity changes —
  // which happens mid-drag (narration flips the parent's `speakingKey`). Closure
  // state would silently reset the drag at that moment; ref state survives it.
  const gestureRef = useRef({
    armed: false,
    pointerId: -1,
    originX: 0,
    originY: 0,
    locked: false,
    // X position the next step is measured from; advanced by exactly one step
    // width per step, so a slow drag ratchets word by word.
    ratchetX: 0,
  });
  // Latest callback props, read by the listeners so their identity is not a
  // dependency of the listener-install effect.
  const onSegmentSpeakRef = useRef(onSegmentSpeak);
  const onScrubStartRef = useRef(onScrubStart);
  useEffect(() => {
    onSegmentSpeakRef.current = onSegmentSpeak;
    onScrubStartRef.current = onScrubStart;
  });
  // Reads callbacks/timers through refs only, so the scrub's long-lived document
  // listeners can safely close over the first render's copy of this function.
  const queueSegmentNarration = useCallback((segment: string, pronunciation?: string) => {
    cancelPendingNarration();
    narrationTimerRef.current = window.setTimeout(() => {
      narrationTimerRef.current = null;
      onSegmentSpeakRef.current?.(segment, pronunciation);
    }, SCRUB_AUDIO_DELAY_MS);
  }, [cancelPendingNarration]);

  useEffect(
    () => () => {
      if (suppressTapTimerRef.current !== null) window.clearTimeout(suppressTapTimerRef.current);
      if (narrationTimerRef.current !== null) window.clearTimeout(narrationTimerRef.current);
    },
    []
  );

  const cancelDismiss = () => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };

  const scheduleDismiss = () => {
    cancelDismiss();
    dismissTimerRef.current = window.setTimeout(() => {
      setSelectedRange(null);
      dismissTimerRef.current = null;
    }, 120);
  };

  useEffect(() => cancelDismiss, []);

  // For Latin script each cell is a whole word (split on whitespace); for CJK each
  // cell is one character.
  const chars = useMemo(
    () => (isLatin ? sentence.foreignText.split(/\s+/).filter(Boolean) : [...sentence.foreignText]),
    [sentence.foreignText, isLatin]
  );

  const charData = useMemo<CharRenderData[]>(() => {
    // Latin script: one cell per word, no pinyin, definition keyed by the word
    // token exactly as DictionaryDAL.enrichSpanishExampleSentencesMetadataBatch stored it.
    if (isLatin) {
      const segmentMetadata = sentence.segmentMetadata ?? {};
      return chars.map((word, i) => ({
        pinyin: "",
        segment: word,
        start: i,
        end: i,
        definition: segmentMetadata[word]?.definition,
      }));
    }

    const data: (CharRenderData | undefined)[] = new Array(chars.length);
    const segments = sentence._segments?.length ? sentence._segments : chars;
    const segmentMetadata = sentence.segmentMetadata ?? {};
    let cursor = 0;

    for (const segment of segments) {
      const segmentChars = [...segment];
      const segmentLength = segmentChars.length;
      if (segmentLength === 0) continue;
      if (cursor >= chars.length) break;

      const meta = segmentMetadata[segment];
      const pronunciation = meta?.pronunciation ?? "";
      const syllables = pronunciation.split(" ");
      const syllableMatches = pronunciation.length > 0 && syllables.length === segmentLength;
      // Prefer particle/classifier definition when tagged — it's the contextually correct sense
      let definition = meta?.particleOrClassifier?.definition ?? meta?.definition;
      // If the segment has wordForms and POS context is available, use the conjugated form
      if (meta?.wordForms && sentence.partOfSpeechDict && !meta.particleOrClassifier) {
        const pos = sentence.partOfSpeechDict[segment];
        const number = sentence.numberDict?.[segment];
        const form = resolveWordForm(meta.wordForms, pos, sentence.tenseDict?.[segment], number);
        if (form) definition = form;
      }

      for (let i = 0; i < segmentLength && cursor + i < chars.length; i++) {
        data[cursor + i] = {
          pinyin: syllableMatches ? syllables[i] ?? "" : "",
          segment,
          start: cursor,
          end: cursor + segmentLength - 1,
          definition,
        };
      }

      cursor += segmentLength;
    }

    // Fallback for mismatched segment arrays
    for (let i = 0; i < chars.length; i++) {
      if (!data[i]) {
        const char = chars[i];
        const fallbackMeta = sentence.segmentMetadata?.[char];
        let fallbackDefinition = fallbackMeta?.particleOrClassifier?.definition ?? fallbackMeta?.definition;
        if (fallbackMeta?.wordForms && sentence.partOfSpeechDict && !fallbackMeta.particleOrClassifier) {
          const pos = sentence.partOfSpeechDict[char];
          const number = sentence.numberDict?.[char];
          const form = resolveWordForm(fallbackMeta.wordForms, pos, sentence.tenseDict?.[char], number);
          if (form) fallbackDefinition = form;
        }
        data[i] = {
          pinyin: "",
          segment: char,
          start: i,
          end: i,
          definition: fallbackDefinition,
        };
      }
    }

    return data as CharRenderData[];
  }, [chars, sentence._segments, sentence.segmentMetadata, isLatin]);

  // Groups consecutive characters that share the same segment (same `start` index).
  // Used when showSegmentSpaces is true to render each word as its own CPCDRow.
  const segmentGroups = useMemo<{ key: number; indices: number[] }[]>(() => {
    const groups: { key: number; indices: number[] }[] = [];
    for (let i = 0; i < chars.length; i++) {
      const start = charData[i].start;
      const last = groups[groups.length - 1];
      if (last && last.key === start) {
        last.indices.push(i);
      } else {
        groups.push({ key: start, indices: [i] });
      }
    }
    return groups;
  }, [chars.length, charData]);

  // The ordered list of segments a scrub can land on: one entry per segment head
  // (charData[i].start === i), punctuation excluded — it carries no gloss and no
  // audio, exactly as it is inert to taps. Index into this list IS the scrub
  // position, so stepping is a simple ±1 with clamping at both ends.
  const scrubSegments = useMemo(
    () =>
      charData
        .map((info, index) => ({ info, index }))
        .filter(({ info, index }) => info && info.start === index && !isPunctuation(info.segment))
        .map(({ info }) => ({
          start: info.start,
          end: info.end,
          segment: info.segment,
          definition: info.definition,
        })),
    [charData]
  );

  useEffect(() => {
    if (!selectedRange || !rowRef.current) {
      setPopupAnchorRect(null);
      setHighlightRects([]);
      return;
    }

    const startEl = charRefs.current[selectedRange.start];
    const endEl = charRefs.current[selectedRange.end];
    if (!startEl || !endEl) {
      setPopupAnchorRect(null);
      setHighlightRects([]);
      return;
    }

    const rowRect = rowRef.current.getBoundingClientRect();
    const rows: HighlightRow[] = [];
    const sameRowTolerance = 1;

    for (let i = selectedRange.start; i <= selectedRange.end; i++) {
      const charEl = charRefs.current[i];
      if (!charEl) continue;
      const rect = charEl.getBoundingClientRect();
      const existingRow = rows.find((row) => Math.abs(row.top - rect.top) <= sameRowTolerance);

      if (existingRow) {
        existingRow.left = Math.min(existingRow.left, rect.left);
        existingRow.right = Math.max(existingRow.right, rect.right);
        existingRow.top = Math.min(existingRow.top, rect.top);
        existingRow.bottom = Math.max(existingRow.bottom, rect.bottom);
      } else {
        rows.push({
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
        });
      }
    }

    rows.sort((a, b) => a.top - b.top);

    setHighlightRects(
      rows.map((row) => ({
        left: row.left - rowRect.left,
        top: row.top - rowRect.top,
        width: Math.max(row.right - row.left, 0),
        height: Math.max(row.bottom - row.top, 0),
      }))
    );

    // Anchor the popup to the topmost highlighted row (in viewport coords) so
    // Popper can place the popup above it. For multi-line selections this keeps
    // the popup floating over the first line rather than centered between lines.
    if (rows.length > 0) {
      const top = rows[0];
      setPopupAnchorRect(new DOMRect(top.left, top.top, top.right - top.left, top.bottom - top.top));
    } else {
      setPopupAnchorRect(null);
    }
  }, [selectedRange, chars.length, showSegmentSpaces]);

  useEffect(() => {
    // With scrub enabled the dismiss decision moves to POINTERUP (see the scrub
    // effect): a scrub may start anywhere on screen, including outside this row,
    // and clearing on pointerdown would destroy the selection the drag is meant
    // to move. Tap-to-dismiss still happens — just one event later.
    if (scrubEnabled) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // Keep the popup open when the tap is on the row or on the popup itself;
      // the popup tap is what triggers the eip-open click.
      if (!rowRef.current?.contains(target) && !popupRef.current?.contains(target)) {
        setSelectedRange(null);
      }
    };

    // Use capture phase so this fires before any child's stopPropagation()
    // (e.g. characters in sibling SegmentedSentenceDisplay instances).
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [scrubEnabled]);

  // Measure DOM positions of vocab word chars and compute underline rects.
  // useLayoutEffect ensures measurement runs after the browser has laid out the DOM,
  // so charRefs have their final positions on first render.
  useLayoutEffect(() => {
    if (!vocabWord || !rowRef.current) {
      setVocabUnderlineRects([]);
      return;
    }

    // Find the first run of consecutive characters that spell out vocabWord.
    // This works even when the sentence's _segments didn't unify the word
    // (e.g. because vocabWord has a matchException in the dictionary).
    const vocabChars = [...vocabWord];
    let matchStart = -1;
    for (let i = 0; i <= chars.length - vocabChars.length; i++) {
      if (vocabChars.every((ch, j) => chars[i + j] === ch)) {
        matchStart = i;
        break; // underline only the first occurrence
      }
    }

    const vocabIndices: number[] = [];
    if (matchStart !== -1) {
      // Expand from the vocab word match to cover the full segment(s) it belongs to.
      // e.g. if vocabWord is "学" but the segment is "学生", underline "学生".
      let segStart = matchStart;
      let segEnd = matchStart + vocabChars.length - 1;
      for (let j = matchStart; j < matchStart + vocabChars.length; j++) {
        const info = charData[j];
        if (info) {
          segStart = Math.min(segStart, info.start);
          segEnd = Math.max(segEnd, info.end);
        }
      }
      for (let j = segStart; j <= segEnd; j++) vocabIndices.push(j);
    }

    if (vocabIndices.length === 0) {
      setVocabUnderlineRects([]);
      return;
    }

    const rowRect = rowRef.current.getBoundingClientRect();
    const rows: HighlightRow[] = [];
    const sameRowTolerance = 1;

    for (const index of vocabIndices) {
      const charEl = charRefs.current[index];
      if (!charEl) continue;
      // Measure the character glyph element so the underline sits directly
      // below the character text, above the pinyin row.
      const charTextEl = charEl.querySelector('.char-pinyin-display__character');
      const rect = (charTextEl ?? charEl).getBoundingClientRect();
      const existingRow = rows.find((row) => Math.abs(row.top - rect.top) <= sameRowTolerance);
      if (existingRow) {
        existingRow.left = Math.min(existingRow.left, rect.left);
        existingRow.right = Math.max(existingRow.right, rect.right);
        existingRow.top = Math.min(existingRow.top, rect.top);
        existingRow.bottom = Math.max(existingRow.bottom, rect.bottom);
      } else {
        rows.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
      }
    }

    setVocabUnderlineRects(
      rows.map((row) => ({
        left: Math.floor(row.left - rowRect.left) + 1,
        top: Math.floor(row.bottom - rowRect.top - VOCAB_UNDERLINE_OFFSET_BY_SIZE[size]),
        width: Math.max(Math.floor(row.right - row.left) - 2, 0),
        height: 0,
      }))
    );
  }, [vocabWord, charData, chars, showSegmentSpaces, size]);

  // The range a tap on `charIndex` selects: the tapped SEGMENT normally, or the entire run
  // (with the run translation as its popup text) in whole-run mode. `segment` stays empty in
  // whole-run mode so the popup renders passive — see isPopupInteractive.
  const rangeFromIndex = (charIndex: number): { start: number; end: number; segment: string; definition?: string } => {
    if (isWholeRun) {
      return { start: 0, end: Math.max(chars.length - 1, 0), segment: "", definition: runTranslation ?? undefined };
    }
    const info = charData[charIndex];
    return { start: info.start, end: info.end, segment: info.segment, definition: info.definition };
  };

  const selectFromIndex = (charIndex: number) => {
    // A scrub in progress owns the selection — ignore hover/tap selection until it settles.
    if (suppressTapRef.current) return;
    claimSegmentSelection(selectionTokenRef.current);
    setSelectedRange(rangeFromIndex(charIndex));
  };

  const toggleFromIndex = (charIndex: number) => {
    if (suppressTapRef.current) return;
    const next = rangeFromIndex(charIndex);
    // Read the previous range from the ref rather than from a setState updater:
    // narration is a side effect and must not run inside the updater (StrictMode
    // invokes updaters twice). The ref is also advanced synchronously here, same
    // as the scrub's step(), so a fast second tap sees this tap's result.
    const prev = selectedRangeRef.current;
    const isDeselect = !!prev && prev.start === next.start && prev.end === next.end && prev.segment === next.segment;
    const resolved = isDeselect ? null : next;
    // Claim before writing our own state — the claim clears OTHER displays only,
    // so ordering is safe, and a deselect needs no claim (nobody else holds one).
    if (resolved) claimSegmentSelection(selectionTokenRef.current);
    selectedRangeRef.current = resolved;
    setSelectedRange(resolved);
    // A tap supersedes any word a just-finished scrub had queued — otherwise the
    // previous word would still speak on top of (or right after) this one.
    cancelPendingNarration();
    // Tapping a segment narrates it — the same per-segment narration the drag-scrub
    // uses. Only when the caller wired narration (est) and the tap SELECTS (a tap
    // that dismisses the popup stays silent). Whole-run mode has an empty segment,
    // so citations stay silent too. This runs inside the touchend gesture, which is
    // what satisfies mobile autoplay policy.
    if (resolved && resolved.segment) {
      onSegmentSpeakRef.current?.(
        resolved.segment,
        sentence.segmentMetadata?.[resolved.segment]?.pronunciation
      );
    }
  };

  // --- Drag-scrub gesture ----------------------------------------------------
  // Installed on the DOCUMENT (so the drag can start anywhere on screen) and only
  // while this sentence actually holds a selection — which is also what keeps
  // sibling sentences from all reacting to the same drag.
  //
  // Gesture shape (see the SCRUB_* constants):
  //   pointerdown → arm, remember the origin, let the caller unlock audio
  //   pointermove → commit to a scrub once horizontal travel dominates; thereafter
  //                 every SCRUB_STEP_PX of travel ratchets the selection one segment
  //                 and narrates it. Vertical-dominant travel aborts the gesture so
  //                 the panel scrolls normally.
  //   pointerup   → if no scrub happened, apply the deferred tap-to-dismiss
  const hasSelection = !!selectedRange;

  // While this sentence holds a selection, the scrub OWNS horizontal gestures:
  // the eip's swipe-to-change-tab stands down (see segmentScrubLock) so one drag
  // can't both walk the words and slide the panel. Releasing the selection hands
  // side-swiping back — that is the documented way to page the eip again.
  useEffect(() => {
    if (!scrubEnabled || !hasSelection) return;
    return claimHorizontalGesture();
  }, [scrubEnabled, hasSelection]);

  useEffect(() => {
    if (!scrubEnabled || !hasSelection || scrubSegments.length === 0) return;

    const gesture = gestureRef.current;
    const stepPx = SCRUB_STEP_PX;

    // Index of the currently selected segment within scrubSegments, or -1 when the
    // selection is something scrubbing doesn't track (e.g. a stale range).
    const currentIndex = (): number => {
      const selected = selectedRangeRef.current;
      if (!selected) return -1;
      return scrubSegments.findIndex((s) => s.start === selected.start && s.end === selected.end);
    };

    // Move the selection one segment in `direction` and narrate it.
    // Returns false when clamped at the first/last segment (no wrap-around).
    const step = (direction: 1 | -1): boolean => {
      const next = currentIndex() + direction;
      if (next < 0 || next >= scrubSegments.length) return false;
      const target = scrubSegments[next];
      const range = {
        start: target.start,
        end: target.end,
        segment: target.segment,
        definition: target.definition,
      };
      // Update the ref synchronously: one fast pointermove can cross several step
      // widths, and each iteration's currentIndex() must see the previous step's
      // result. React state won't have committed yet at that point.
      selectedRangeRef.current = range;
      setSelectedRange(range);
      // Debounced, not immediate — see SCRUB_AUDIO_DELAY_MS. The audio context was
      // already unlocked by onScrubStart on this gesture's pointerdown, so playing
      // from a timer is still allowed.
      queueSegmentNarration(
        target.segment,
        sentence.segmentMetadata?.[target.segment]?.pronunciation
      );
      return true;
    };

    const endScrubSuppression = () => {
      if (suppressTapTimerRef.current !== null) window.clearTimeout(suppressTapTimerRef.current);
      suppressTapTimerRef.current = window.setTimeout(() => {
        suppressTapRef.current = false;
        suppressTapTimerRef.current = null;
      }, SCRUB_TAP_SUPPRESS_MS);
    };

    const handleDown = (event: PointerEvent) => {
      if (gesture.armed) return; // ignore secondary pointers (second finger, etc.)
      gesture.armed = true;
      gesture.pointerId = event.pointerId;
      gesture.originX = event.clientX;
      gesture.originY = event.clientY;
      gesture.ratchetX = event.clientX;
      gesture.locked = false;
      // Must run inside the gesture: narration starts from pointermove, which is
      // too late to satisfy mobile autoplay policy on its own.
      onScrubStartRef.current?.();
    };

    const handleMove = (event: PointerEvent) => {
      if (!gesture.armed || event.pointerId !== gesture.pointerId) return;
      const dx = event.clientX - gesture.originX;
      const dy = event.clientY - gesture.originY;

      if (!gesture.locked) {
        // Vertical-dominant travel means the user is scrolling — disarm for the
        // rest of this pointer sequence so the scroll runs untouched.
        if (Math.abs(dy) > SCRUB_VERTICAL_ABORT_PX && Math.abs(dy) >= Math.abs(dx)) {
          gesture.armed = false;
          return;
        }
        if (Math.abs(dx) < SCRUB_LOCK_PX || Math.abs(dx) <= Math.abs(dy)) return;
        gesture.locked = true;
        suppressTapRef.current = true;
        // NOTE: the ratchet is deliberately NOT re-based here — it still measures
        // from the gesture's origin, so the first word lands at exactly
        // SCRUB_STEP_PX of travel rather than at lock distance + a full step.
        // A mouse drag over selectable sentence text would otherwise paint a text
        // selection across the page; suppress it for the duration of the scrub.
        document.body.style.userSelect = "none";
        window.getSelection?.()?.removeAllRanges();
      }

      // Ratchet: consume one step width per segment moved. On a clamp (sentence
      // edge) we re-base to the current X so reversing direction responds
      // immediately instead of first paying back the overshoot.
      while (event.clientX - gesture.ratchetX >= stepPx) {
        if (!step(1)) {
          gesture.ratchetX = event.clientX;
          break;
        }
        gesture.ratchetX += stepPx;
      }
      while (gesture.ratchetX - event.clientX >= stepPx) {
        if (!step(-1)) {
          gesture.ratchetX = event.clientX;
          break;
        }
        gesture.ratchetX -= stepPx;
      }
    };

    const handleUp = (event: PointerEvent) => {
      if (!gesture.armed || event.pointerId !== gesture.pointerId) return;
      gesture.armed = false;

      if (gesture.locked) {
        gesture.locked = false;
        document.body.style.userSelect = "";
        endScrubSuppression();
        return;
      }

      // No scrub happened → this was a tap. Apply the dismiss rule that normally
      // lives on pointerdown: taps land on characters (they select themselves) or
      // on the popup (it opens the eip); anything else clears the selection.
      const target = event.target as Element | null;
      const node = target as Node | null;
      const onPopup = !!node && !!popupRef.current?.contains(node);
      const onCharacter = !!target?.closest?.(".cpcd-row__char-cell");
      if (!onPopup && !onCharacter) {
        // Dismissing also drops any word still queued from an earlier scrub, so
        // audio can't arrive after the selection it belongs to is gone.
        cancelPendingNarration();
        selectedRangeRef.current = null;
        setSelectedRange(null);
      }
    };

    const handleCancel = (event: PointerEvent) => {
      if (!gesture.armed || event.pointerId !== gesture.pointerId) return;
      gesture.armed = false;
      if (gesture.locked) {
        gesture.locked = false;
        document.body.style.userSelect = "";
        endScrubSuppression();
      }
    };

    // Capture phase so a child's stopPropagation() (notably the popup's) can't hide
    // the gesture from us. Passive: we never preventDefault — a scrub coexists with
    // whatever the browser does natively.
    const options: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener("pointerdown", handleDown, options);
    document.addEventListener("pointermove", handleMove, options);
    document.addEventListener("pointerup", handleUp, options);
    document.addEventListener("pointercancel", handleCancel, options);
    return () => {
      document.removeEventListener("pointerdown", handleDown, options);
      document.removeEventListener("pointermove", handleMove, options);
      document.removeEventListener("pointerup", handleUp, options);
      document.removeEventListener("pointercancel", handleCancel, options);
    };
    // Callback props are read through refs, so they are deliberately NOT deps:
    // their identity churns mid-drag (narration flips the parent's speakingKey)
    // and re-installing listeners on every such render is pure waste.
  }, [scrubEnabled, hasSelection, scrubSegments, sentence.segmentMetadata, queueSegmentNarration, cancelPendingNarration]);

  // Safety net: if this display unmounts mid-scrub (panel closed, card advanced),
  // restore the page's text selectability that the scrub disabled.
  useEffect(
    () => () => {
      if (gestureRef.current.locked) document.body.style.userSelect = "";
    },
    []
  );

  const showPopup = !!(selectedRange && selectedRange.definition && popupAnchorRect);

  // Popper measures the popup once when it opens and positions it from that width.
  // If the content reflows afterward — most commonly the definition's web font
  // finishing loading on the very first open — the box stays placed against the
  // stale (fallback-font) width and looks mis-sized until it's reopened (by which
  // point the font is cached). Observing the popup's size and re-running Popper's
  // update() on every change keeps placement in sync with the real rendered width.
  useEffect(() => {
    const el = popupRef.current;
    if (!showPopup || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      popperInstanceRef.current?.update();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [showPopup]);
  // The popup is tappable (chevron + eip-open) only when the caller wired
  // onSegmentOpen and we have a concrete segment headword to open.
  const isPopupInteractive = !!onSegmentOpen && !!selectedRange?.segment;

  // Popper accepts a "virtual element" anchor — an object with getBoundingClientRect.
  // We rebuild it whenever popupAnchorRect changes so Popper reflows the popup.
  const popperAnchorEl = useMemo(
    () => (popupAnchorRect ? { getBoundingClientRect: () => popupAnchorRect, nodeType: 1 } : null),
    [popupAnchorRect]
  );

  return (
    <Box
      ref={rowRef}
      sx={
        display === "inline"
          ? // Inline-flex so the run flows within surrounding prose; verticalAlign middle
            // vertically centers the whole cpcd unit (glyph + pinyin row) on the text line.
            { position: "relative", display: "inline-flex", verticalAlign: "middle" }
          : { position: "relative", width: "100%" }
      }
      onMouseEnter={cancelDismiss}
      onMouseLeave={scheduleDismiss}
      // Deselect when tapping container background (whitespace between/around
      // characters). With scrub enabled this is deferred to pointerup inside the
      // scrub effect — a drag that begins on the background must be able to move
      // the selection, not destroy it.
      onPointerDown={scrubEnabled ? undefined : () => setSelectedRange(null)}
    >
      {highlightRects.map((highlightRect, index) => (
        <Box
          key={`highlight-${index}`}
          sx={{
            position: "absolute",
            left: highlightRect.left,
            top: highlightRect.top,
            width: highlightRect.width,
            height: highlightRect.height,
            borderRadius: "6px",
            border: "1px solid",
            borderColor: "text.primary",
            backgroundColor: "rgba(119, 155, 231, 0.15)",
            boxSizing: "border-box",
            zIndex: 1,
            pointerEvents: "none",
          }}
        />
      ))}

      {vocabUnderlineRects.map((rect, index) => (
        <Box
          key={`vocab-underline-${index}`}
          sx={{
            position: "absolute",
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: 0,
            borderTop: "1.5px solid",
            borderColor: "text.primary",
            zIndex: 1,
            pointerEvents: "none",
          }}
        />
      ))}

      {(() => {
        // Build CPCDRow items for a given range of indices. Wires per-character
        // refs, interactivity, and selection state from the surrounding component.
        const buildItems = (indices: number[]): CPCDRowItem[] => indices.map((index) => {
          const char = chars[index];
          const info = charData[index];
          const charIsPunctuation = isPunctuation(char);
          // Punctuation is normally inert (it has no gloss to show), but in whole-run mode
          // every cell selects the same whole run — so a tap on the comma inside a cited
          // clause must work like a tap on its characters.
          const inert = charIsPunctuation && !isWholeRun;
          const isSingleCharSelection = !inert && !!selectedRange && selectedRange.start === selectedRange.end && index === selectedRange.start;
          return {
            character: char,
            pinyin: info.pinyin,
            showPinyin: showPinyin !== false && !!info.pinyin,
            useToneColor: showPinyinColor,
            interactive: !inert,
            selected: isSingleCharSelection,
            onHoverStart: inert ? undefined : () => selectFromIndex(index),
            onTapToggle: inert ? undefined : () => toggleFromIndex(index),
            cellRef: (node) => { charRefs.current[index] = node; },
          };
        });

        if (showSegmentSpaces || isLatin) {
          // Spaced mode: each segment is its own CPCDRow; the outer Box provides the inter-segment gap.
          // Latin script always uses this so words are separated by real spacing.
          // flexWrap/justifyContent/className belong on the outer container so wrapping happens at
          // word boundaries, not mid-segment.
          return (
            <Box
              className={className}
              sx={{
                display: "flex",
                flexDirection: "row",
                flexWrap,
                gap: SEGMENT_GAP_BY_SIZE[size],
                ...(justifyContent && { justifyContent }),
              }}
            >
              {segmentGroups.map((group) => (
                <ForeignText
                  key={group.key}
                  size={size}
                  compact={compact}
                  flexWrap="nowrap"
                  selectable={selectable}
                  items={buildItems(group.indices)}
                />
              ))}
            </Box>
          );
        }

        return (
          <ForeignText
            size={size}
            compact={compact}
            flexWrap={flexWrap}
            justifyContent={justifyContent}
            className={className}
            selectable={selectable}
            items={buildItems(chars.map((_, i) => i))}
          />
        );
      })()}

      {/* Render into a portal via Popper so the popup escapes any ancestor's
          overflow:auto/hidden (e.g. the EIP scroll container) and is never clipped. */}
      <Popper
        open={showPopup}
        anchorEl={popperAnchorEl}
        popperRef={popperInstanceRef}
        placement="top"
        modifiers={[
          { name: "offset", options: { offset: [0, 6] } },
          { name: "preventOverflow", options: { boundary: "viewport", padding: 8 } },
          { name: "flip", options: { fallbackPlacements: ["bottom"] } },
        ]}
        sx={{ zIndex: 1300 }}
      >
        <Box
          ref={popupRef}
          className="segment-definition-popup"
          onMouseEnter={cancelDismiss}
          onMouseLeave={scheduleDismiss}
          // When interactive, the popup must fully absorb the tap. We open on
          // pointerup and, on both pointerdown and pointerup, call:
          //   - stopPropagation() so the event doesn't bubble in the React tree to
          //     the row Box's onPointerDown (which would clear the selection). Note
          //     the Popper is portaled in the DOM but is still a React child of the
          //     row, so React events DO bubble to it.
          //   - preventDefault() on pointerdown to suppress the compatibility
          //     mouse/click synthesis on touch. Without it, that ghost click fires
          //     ~after the popup closes and lands on whatever is now behind it
          //     (the "tap registers behind the popup" bug).
          onPointerDown={
            isPopupInteractive
              ? (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setPopupPressed(true);
                }
              : undefined
          }
          onPointerUp={
            isPopupInteractive
              ? (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setPopupPressed(false);
                  if (selectedRange?.segment) onSegmentOpen!(selectedRange.segment);
                  setSelectedRange(null);
                }
              : undefined
          }
          // Cancel the pressed state if the finger/pointer leaves the popup or the
          // gesture is aborted (e.g. scroll), so it doesn't stay greyed out.
          onPointerLeave={isPopupInteractive ? () => setPopupPressed(false) : undefined}
          onPointerCancel={isPopupInteractive ? () => setPopupPressed(false) : undefined}
          sx={{
            backgroundColor: "#FFFFFF",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: "8px",
            boxShadow: 2,
            px: 1.25,
            py: 0.75,
            maxWidth: "220px",
            ...(isPopupInteractive && {
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              // Grey the whole card while pressed so a registered tap is obvious.
              transition: "background-color 100ms ease",
              backgroundColor: popupPressed ? "action.selected" : "#FFFFFF",
            }),
          }}
        >
          <Typography
            className="segment-definition-popup__text"
            sx={{
              fontSize: SIZE.caption,
              lineHeight: 1.3,
              color: "text.primary",
              fontFamily: FONTS.sans,
              textAlign: "center",
              wordBreak: "break-word",
              ...(isPopupInteractive && { flex: 1, textAlign: "left" }),
            }}
          >
            {selectedRange?.definition ? stripParentheses(selectedRange.definition) : ""}
          </Typography>
          {isPopupInteractive && (
            // Same drill-in chevron the breakdown/used-in rows use, so "chevron =
            // opens the eip for this word" stays a consistent gesture across the card.
            <Box
              className="segment-definition-popup__chevron"
              component="span"
              sx={{
                flexShrink: 0,
                fontSize: SIZE.body,
                lineHeight: 1,
                color: "text.secondary",
                fontFamily: FONTS.sans,
              }}
            >
              ›
            </Box>
          )}
        </Box>
      </Popper>
    </Box>
  );
};

export default SegmentedSentenceDisplay;
