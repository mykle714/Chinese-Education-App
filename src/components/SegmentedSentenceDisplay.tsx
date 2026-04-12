import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { stripParentheses } from "../utils/definitionUtils";
import CharacterPinyinColorDisplay from "./CharacterPinyinColorDisplay";
import CPCDRow from "./CPCDRow";

type Size = "xs" | "sm" | "md";

interface SegmentMeta {
  pronunciation?: string;
  definition?: string;
  particleOrClassifier?: { type: 'particle' | 'classifier'; definition: string };
}

interface SentenceData {
  chinese: string;
  _segments?: string[];
  segmentMetadata?: Record<string, SegmentMeta>;
}

interface SegmentedSentenceDisplayProps {
  sentence: SentenceData;
  size?: Size;
  compact?: boolean;
  flexWrap?: "nowrap" | "wrap";
  justifyContent?: string;
  className?: string;
  showPinyin?: boolean;
  // When set, draws a single continuous underline beneath characters belonging to this segment
  vocabWord?: string;
}

interface CharRenderData {
  pinyin: string;
  segment: string;
  start: number;
  end: number;
  definition?: string;
}

interface PopupPosition {
  left: number;
  top: number;
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

const SegmentedSentenceDisplay: React.FC<SegmentedSentenceDisplayProps> = ({
  sentence,
  size = "sm",
  compact = false,
  flexWrap = "wrap",
  justifyContent,
  className,
  showPinyin,
  vocabWord,
}) => {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const charRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number; segment: string; definition?: string } | null>(null);
  const [popupPosition, setPopupPosition] = useState<PopupPosition | null>(null);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const [vocabUnderlineRects, setVocabUnderlineRects] = useState<HighlightRect[]>([]);

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
      const definition = meta?.particleOrClassifier?.definition ?? meta?.definition;

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
        data[i] = {
          pinyin: "",
          segment: char,
          start: i,
          end: i,
          definition: fallbackMeta?.particleOrClassifier?.definition ?? fallbackMeta?.definition,
        };
      }
    }

    return data as CharRenderData[];
  }, [chars, sentence._segments, sentence.segmentMetadata]);

  useEffect(() => {
    if (!selectedRange || !rowRef.current) {
      setPopupPosition(null);
      setHighlightRects([]);
      return;
    }

    const startEl = charRefs.current[selectedRange.start];
    const endEl = charRefs.current[selectedRange.end];
    if (!startEl || !endEl) {
      setPopupPosition(null);
      setHighlightRects([]);
      return;
    }

    const rowRect = rowRef.current.getBoundingClientRect();
    const startRect = startEl.getBoundingClientRect();
    const endRect = endEl.getBoundingClientRect();
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

    const popupBottom = rows.length > 0
      ? Math.max(...rows.map((row) => row.bottom)) - rowRect.top
      : Math.max(startRect.bottom, endRect.bottom) - rowRect.top;

    setPopupPosition({
      left: ((startRect.left + endRect.right) / 2) - rowRect.left,
      top: popupBottom + 6,
    });
  }, [selectedRange, chars.length]);

  // After the popup renders, measure its actual width and clamp its left position so it
  // never overflows the container. useLayoutEffect runs before paint so there's no flicker.
  // (CSS transform centering can't be used because transforms don't affect layout — the
  // browser computes available width as containerWidth - left, squeezing content near edges.)
  useLayoutEffect(() => {
    if (!selectedRange?.definition || !popupPosition || !popupRef.current || !rowRef.current) return;
    const popupWidth = popupRef.current.offsetWidth;
    const rowWidth = rowRef.current.offsetWidth;
    const midpoint = popupPosition.left;
    const clamped = Math.min(
      Math.max(midpoint - popupWidth / 2, 0),
      rowWidth - popupWidth
    );
    popupRef.current.style.left = `${clamped}px`;
  }, [selectedRange, popupPosition]);

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
  }, [vocabWord, charData]);

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

  const showPopup = !!(selectedRange && selectedRange.definition && popupPosition);

  return (
    <Box
      ref={rowRef}
      sx={{ position: "relative", width: "100%" }}
      onMouseLeave={() => setSelectedRange(null)}
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

      <CPCDRow size={size} flexWrap={flexWrap} justifyContent={justifyContent} className={className}>
        {chars.map((char, index) => {
          const info = charData[index];
          const isSingleCharSelection = !!selectedRange && selectedRange.start === selectedRange.end && index === selectedRange.start;

          return (
            <Box
              key={index}
              ref={(node: HTMLDivElement | null) => { charRefs.current[index] = node; }}
              sx={{ display: "inline-flex", position: "relative", zIndex: 2 }}
              // Stop propagation so character taps don't trigger the container's deselect handler
              onPointerDown={(e) => e.stopPropagation()}
            >
              <CharacterPinyinColorDisplay
                character={char}
                pinyin={info.pinyin}
                showPinyin={showPinyin !== false && !!info.pinyin}
                size={size}
                useToneColor={true}
                compact={compact}
                interactive
                selected={isSingleCharSelection}
                onHoverStart={() => selectFromIndex(index)}
                onTapToggle={() => toggleFromIndex(index)}
              />
            </Box>
          );
        })}
      </CPCDRow>

      {showPopup && (
        <Box
          ref={popupRef}
          sx={{
            position: "absolute",
            left: 0, // always start at left edge so natural width is measured before useLayoutEffect repositions
            top: popupPosition.top,
            backgroundColor: "#FFFFFF",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: "8px",
            boxShadow: 2,
            px: 1.25,
            py: 0.75,
            maxWidth: "220px",
            zIndex: 10,
            pointerEvents: "none",
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
            {stripParentheses(selectedRange.definition!)}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default SegmentedSentenceDisplay;
