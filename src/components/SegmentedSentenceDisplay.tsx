import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Popper, Typography } from "@mui/material";
import type { Instance as PopperInstance } from "@popperjs/core";
import { stripParentheses } from "../utils/definitionUtils";
import ForeignText, { type CPCDRowItem, isLatinScriptLang } from "./ForeignText";
import { FONTS } from "../theme/fonts";
import { SIZE } from "../theme/scale";
import { claimSegmentSelection, registerSegmentSelectionOwner } from "../utils/segmentSelectionOwner";
import { pickDrillRung } from "../utils/segmentDrill";
import type { SegmentDrillRung } from "../types";

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
  // Shorter det headwords inside this segment, longest-first — the tap-to-drill chain.
  // See src/utils/segmentDrill.ts and docs/SEGMENT_DRILL_DOWN.md.
  drill?: SegmentDrillRung[];
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
  // TAP-TO-NARRATE. When provided, tapping a segment calls this with that segment
  // + its pronunciation so the caller can narrate it. Omit to keep the display
  // silent (long definitions, whole-run citations). Whole-run mode never narrates:
  // its selection is a phrase, not a headword.
  onSegmentSpeak?: (segment: string, pronunciation?: string) => void;
}

/**
 * The current selection, in this display's absolute character indices.
 *
 * `segment` is the selected TEXT — the tapped GSA segment at first, then each narrower
 * drill rung (src/utils/segmentDrill.ts) as the learner keeps tapping. It doubles as the
 * headword the popup's chevron opens, and it is deliberately EMPTY in whole-run mode,
 * where the selection is a cited phrase rather than a word (see `isPopupInteractive`).
 *
 * `pronunciation` is carried on the range rather than looked up from `segmentMetadata`
 * at narration time, because a drill rung is not a key in that map — only top-level
 * segments are.
 */
interface SelectedRange {
  start: number;
  end: number;
  segment: string;
  definition?: string;
  pronunciation?: string;
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
  const [selectedRange, setSelectedRange] = useState<SelectedRange | null>(null);
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

  // Mirror of selectedRange, kept in sync synchronously by the handlers that write
  // it. Tap handling reads the PREVIOUS selection to decide select-vs-deselect, and
  // must not do that from inside a setState updater (a side effect — narration —
  // hangs off the decision, and StrictMode invokes updaters twice).
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
  // open at once.
  const selectionTokenRef = useRef({});
  useEffect(
    () =>
      registerSegmentSelectionOwner(selectionTokenRef.current, () => {
        // Clear the ref alongside the state: the tap handler reads the ref, and a
        // stale range there would let the next tap read as a DRILL into a selection
        // this display no longer owns.
        selectedRangeRef.current = null;
        setSelectedRange(null);
      }),
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

  // Tap anywhere off this row (and off the popup) dismisses the selection.
  useEffect(() => {
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
  }, []);

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
  const rangeFromIndex = (charIndex: number): SelectedRange => {
    if (isWholeRun) {
      return { start: 0, end: Math.max(chars.length - 1, 0), segment: "", definition: runTranslation ?? undefined };
    }
    return segmentRangeAt(charIndex);
  };

  // The tapped character's whole GSA segment, as a selection. Split out of
  // rangeFromIndex because the drill uses it too: it is whole-run mode's second rung.
  const segmentRangeAt = (charIndex: number): SelectedRange => {
    const info = charData[charIndex];
    return {
      start: info.start,
      end: info.end,
      segment: info.segment,
      definition: info.definition,
      pronunciation: sentence.segmentMetadata?.[info.segment]?.pronunciation,
    };
  };

  // --- Tap-to-drill -------------------------------------------------------------
  // A tap that lands INSIDE the current selection narrows it instead of dismissing it:
  // the longest dictionary headword that still covers the tapped character wins, and
  // when nothing narrower is left the selection cancels. See src/utils/segmentDrill.ts
  // for the rule and docs/SEGMENT_DRILL_DOWN.md for the gesture.
  //
  // Returns the next rung, or null meaning "cancel".
  const drillFromIndex = (current: SelectedRange, charIndex: number): SelectedRange | null => {
    const info = charData[charIndex];

    // Whole-run mode's first rung is the entire cited phrase, which has no drill list of
    // its own (it is a clause, not a headword — see `runTranslation`). Its next rung is
    // the GSA segment under the finger; from there the segment's own rungs take over.
    // A punctuation cell, or a segment the dictionary can't gloss, ends the chain rather
    // than opening an empty popup.
    if (current.segment === "") {
      const segmentRange = segmentRangeAt(charIndex);
      const narrower = segmentRange.end - segmentRange.start < current.end - current.start;
      if (narrower) return segmentRange.definition ? segmentRange : null;
      // The run IS a single segment, so its span already equals the current selection —
      // fall through and drill into that segment's rungs.
    }

    // Rungs always come from the TOP-LEVEL segment's list, whatever rung we are standing
    // on: pickDrillRung filters by containment in `current`, so 中华人民共和国's own list
    // supplies 人民 first and then 人 / 民 once the selection has narrowed to 人民.
    const rung = pickDrillRung(
      sentence.segmentMetadata?.[info.segment]?.drill,
      info.start,
      current,
      charIndex
    );
    if (!rung) return null;
    return {
      start: rung.start,
      end: rung.end,
      segment: rung.text,
      definition: rung.definition,
      pronunciation: rung.pronunciation,
    };
  };

  const selectFromIndex = (charIndex: number) => {
    claimSegmentSelection(selectionTokenRef.current);
    setSelectedRange(rangeFromIndex(charIndex));
  };

  const toggleFromIndex = (charIndex: number) => {
    // Read the previous range from the ref rather than from a setState updater:
    // narration is a side effect and must not run inside the updater (StrictMode
    // invokes updaters twice). The ref is also advanced synchronously here, so a
    // fast second tap sees this tap's result.
    const prev = selectedRangeRef.current;
    // A tap inside the live selection DRILLS (narrow, then eventually cancel); a tap
    // anywhere else starts a fresh selection on that character's segment. This is what
    // replaced the old plain deselect-on-second-tap — cancelling is now just the end of
    // the drill chain, which a single-character selection reaches immediately, so a
    // one-character segment still toggles exactly as it always did.
    const isDrill = !!prev && charIndex >= prev.start && charIndex <= prev.end;
    const resolved = isDrill ? drillFromIndex(prev!, charIndex) : rangeFromIndex(charIndex);
    // Claim before writing our own state — the claim clears OTHER displays only,
    // so ordering is safe, and a cancelling tap needs no claim (nobody else holds one).
    if (resolved) claimSegmentSelection(selectionTokenRef.current);
    selectedRangeRef.current = resolved;
    setSelectedRange(resolved);
    // Tapping a segment narrates it — only when the caller wired narration (est) and
    // the tap resolved to something (a tap that cancels the selection stays silent).
    // Each drill rung narrates in turn; whole-run mode has an empty segment, so a
    // citation stays silent until the drill reaches a real headword inside it. This runs inside the
    // touchend gesture, which is what satisfies mobile autoplay policy.
    if (resolved && resolved.segment) {
      // The range carries its own pronunciation: a drill rung is not a key in
      // segmentMetadata (only top-level segments are), so the map lookup is only the
      // fallback for ranges built before this field existed.
      onSegmentSpeak?.(
        resolved.segment,
        resolved.pronunciation ?? sentence.segmentMetadata?.[resolved.segment]?.pronunciation
      );
    }
  };

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
      // characters).
      onPointerDown={() => setSelectedRange(null)}
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
