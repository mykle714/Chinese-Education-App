import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import CharacterPinyinColorDisplay from "./CharacterPinyinColorDisplay";
import CPCDRow from "./CPCDRow";

type Size = "xs" | "sm" | "md";

interface SegmentMeta {
  pronunciation?: string;
  definition?: string;
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
}) => {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const charRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number; segment: string; definition?: string } | null>(null);
  const [popupPosition, setPopupPosition] = useState<PopupPosition | null>(null);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);

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

      const pronunciation = segmentMetadata[segment]?.pronunciation ?? "";
      const syllables = pronunciation.split(" ");
      const syllableMatches = pronunciation.length > 0 && syllables.length === segmentLength;

      for (let i = 0; i < segmentLength && cursor + i < chars.length; i++) {
        data[cursor + i] = {
          pinyin: syllableMatches ? syllables[i] ?? "" : "",
          segment,
          start: cursor,
          end: cursor + segmentLength - 1,
          definition: segmentMetadata[segment]?.definition,
        };
      }

      cursor += segmentLength;
    }

    // Fallback for mismatched segment arrays
    for (let i = 0; i < chars.length; i++) {
      if (!data[i]) {
        const char = chars[i];
        data[i] = {
          pinyin: "",
          segment: char,
          start: i,
          end: i,
          definition: sentence.segmentMetadata?.[char]?.definition,
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

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) {
        setSelectedRange(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

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

      <CPCDRow size={size} flexWrap={flexWrap} justifyContent={justifyContent} className={className}>
        {chars.map((char, index) => {
          const info = charData[index];
          const isSingleCharSelection = !!selectedRange && selectedRange.start === selectedRange.end && index === selectedRange.start;

          return (
            <Box
              key={index}
              ref={(node: HTMLDivElement | null) => { charRefs.current[index] = node; }}
              sx={{ display: "inline-flex", position: "relative", zIndex: 2 }}
            >
              <CharacterPinyinColorDisplay
                character={char}
                pinyin={info.pinyin}
                showPinyin={!!info.pinyin}
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
          sx={{
            position: "absolute",
            left: popupPosition.left,
            top: popupPosition.top,
            transform: "translateX(-50%)",
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
            {selectedRange.definition}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default SegmentedSentenceDisplay;
