import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Popper, Typography } from "@mui/material";
import { stripParentheses } from "../utils/definitionUtils";
import CPCDRow, { type CPCDRowItem } from "./CPCDRow";

type Size = "sm" | "md";

// Punctuation should not be highlightable on hover/tap — it carries no lookup value.
// Uses Unicode property escapes to cover ASCII, CJK, and fullwidth punctuation/symbols.
const PUNCTUATION_REGEX = /^[\p{P}\p{S}\s]+$/u;
const isPunctuation = (ch: string): boolean => PUNCTUATION_REGEX.test(ch);

// CSS gap between segment groups when showSegmentSpaces is true.
// Sized proportionally to character width at each size — NOT a native space character.
const SEGMENT_GAP_BY_SIZE: Record<Size, string> = {
  sm: "4px",
  md: "6px",
};

interface SegmentMeta {
  pronunciation?: string;
  definition?: string;
  particleOrClassifier?: { type: 'particle' | 'classifier'; definition: string };
  wordForms?: Record<string, string>;
}

interface SentenceData {
  chinese: string;
  _segments?: string[];
  segmentMetadata?: Record<string, SegmentMeta>;
  tense?: 'past' | 'present' | 'future';
  partOfSpeechDict?: Record<string, string>;
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
// When a verb is used nominally (tagged "noun" in this sentence's partOfSpeechDict),
// fall back to the gerund form since verb entries have no dedicated "noun" key.
function resolveWordForm(
  wordForms: Record<string, string>,
  pos: string | undefined,
  tense: string | undefined
): string | undefined {
  if (!pos) return undefined;
  if (tense && (pos === 'verb' || pos === 'auxiliary verb')) {
    return wordForms[tense] ?? wordForms[pos];
  }
  if (pos === 'noun') {
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
}) => {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const charRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number; segment: string; definition?: string } | null>(null);
  // Viewport-space rect of the highlighted word(s); used as Popper anchor so the
  // popup escapes any ancestor scroll container's overflow clipping.
  const [popupAnchorRect, setPopupAnchorRect] = useState<DOMRect | null>(null);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const [vocabUnderlineRects, setVocabUnderlineRects] = useState<HighlightRect[]>([]);
  // Pending dismiss timer. Armed when the mouse leaves the row or popup; cancelled
  // when the mouse re-enters either, so users can move from word → popup without
  // the popup disappearing mid-traversal.
  const dismissTimerRef = useRef<number | null>(null);

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

  const chars = useMemo(() => [...sentence.chinese], [sentence.chinese]);

  const charData = useMemo<CharRenderData[]>(() => {
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
        const form = resolveWordForm(meta.wordForms, pos, sentence.tense);
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
          const form = resolveWordForm(fallbackMeta.wordForms, pos, sentence.tense);
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
  }, [chars, sentence._segments, sentence.segmentMetadata]);

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

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) {
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
        top: Math.floor(row.bottom - rowRect.top - 1),
        width: Math.max(Math.floor(row.right - row.left) - 2, 0),
        height: 0,
      }))
    );
  }, [vocabWord, charData, chars, showSegmentSpaces]);

  const selectFromIndex = (charIndex: number) => {
    const info = charData[charIndex];
    setSelectedRange({
      start: info.start,
      end: info.end,
      segment: info.segment,
      definition: info.definition,
    });
  };

  const toggleFromIndex = (charIndex: number) => {
    const info = charData[charIndex];
    setSelectedRange((prev) => {
      if (prev && prev.start === info.start && prev.end === info.end && prev.segment === info.segment) {
        return null;
      }
      return {
        start: info.start,
        end: info.end,
        segment: info.segment,
        definition: info.definition,
      };
    });
  };

  const showPopup = !!(selectedRange && selectedRange.definition && popupAnchorRect);

  // Popper accepts a "virtual element" anchor — an object with getBoundingClientRect.
  // We rebuild it whenever popupAnchorRect changes so Popper reflows the popup.
  const popperAnchorEl = useMemo(
    () => (popupAnchorRect ? { getBoundingClientRect: () => popupAnchorRect, nodeType: 1 } : null),
    [popupAnchorRect]
  );

  return (
    <Box
      ref={rowRef}
      sx={{ position: "relative", width: "100%" }}
      onMouseEnter={cancelDismiss}
      onMouseLeave={scheduleDismiss}
      // Deselect when tapping container background (whitespace between/around characters)
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
          const isSingleCharSelection = !charIsPunctuation && !!selectedRange && selectedRange.start === selectedRange.end && index === selectedRange.start;
          return {
            character: char,
            pinyin: info.pinyin,
            showPinyin: showPinyin !== false && !!info.pinyin,
            useToneColor: showPinyinColor,
            interactive: !charIsPunctuation,
            selected: isSingleCharSelection,
            onHoverStart: charIsPunctuation ? undefined : () => selectFromIndex(index),
            onTapToggle: charIsPunctuation ? undefined : () => toggleFromIndex(index),
            cellRef: (node) => { charRefs.current[index] = node; },
          };
        });

        if (showSegmentSpaces) {
          // Spaced mode: each segment is its own CPCDRow; the outer Box provides the inter-segment gap.
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
                <CPCDRow
                  key={group.key}
                  size={size}
                  compact={compact}
                  flexWrap="nowrap"
                  items={buildItems(group.indices)}
                />
              ))}
            </Box>
          );
        }

        return (
          <CPCDRow
            size={size}
            compact={compact}
            flexWrap={flexWrap}
            justifyContent={justifyContent}
            className={className}
            items={buildItems(chars.map((_, i) => i))}
          />
        );
      })()}

      {/* Render into a portal via Popper so the popup escapes any ancestor's
          overflow:auto/hidden (e.g. the EIP scroll container) and is never clipped. */}
      <Popper
        open={showPopup}
        anchorEl={popperAnchorEl}
        placement="top"
        modifiers={[
          { name: "offset", options: { offset: [0, 6] } },
          { name: "preventOverflow", options: { boundary: "viewport", padding: 8 } },
          { name: "flip", options: { fallbackPlacements: ["bottom"] } },
        ]}
        sx={{ zIndex: 1300 }}
      >
        <Box
          onMouseEnter={cancelDismiss}
          onMouseLeave={scheduleDismiss}
          sx={{
            backgroundColor: "#FFFFFF",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: "8px",
            boxShadow: 2,
            px: 1.25,
            py: 0.75,
            maxWidth: "220px",
          }}
        >
          <Typography
            sx={{
              fontSize: "0.72rem",
              lineHeight: 1.3,
              color: "text.primary",
              fontFamily: '"Inter", sans-serif',
              textAlign: "center",
              wordBreak: "break-word",
            }}
          >
            {selectedRange?.definition ? stripParentheses(selectedRange.definition) : ""}
          </Typography>
        </Box>
      </Popper>
    </Box>
  );
};

export default SegmentedSentenceDisplay;
