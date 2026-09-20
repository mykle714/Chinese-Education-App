/**
 * IWLookupResults — the hint tray's chip strip (§ 9a).
 *
 * LAYER: presentation, inside `features/immersiveworld`. It owns no query and no paging
 * state; `IWComposer` fetches, and this renders what arrived and says when the learner has
 * reached the end of it.
 *
 * ⚠️ **SPLIT OUT OF `IWComposer`, AND IT INHERITS THAT FILE'S THROWAWAY STATUS.** § 12
 * phase 2 requires the whole writing assistant to be replaceable by the beginner keyboard
 * in one deletion; nothing outside this folder imports either file.
 *
 * ── A result is the WORD AND NOTHING ELSE ────────────────────────────────────────────
 * A cpcd row with its pinyin, at `sm` so the overlay is readable, with no English beside
 * it. The learner arrived here already knowing what they meant — they typed it — so the
 * only open question is how the word is written and said; a gloss column would spend the
 * row's width repeating the query back. It also keeps `ddCollisionKey`
 * (GLOSS_CONFUSABILITY.md) out of scope: that rule binds surfaces that ask a learner to
 * CHOOSE between English glosses, and this one never shows one.
 *
 * ── Why the strip pages rather than showing everything ───────────────────────────────
 * The tray asks for `LOOKUP_PAGE_SIZE` results at a time. When the learner scrolls (or,
 * on desktop, arrows) to the right edge, `onReachEnd` fires and the composer appends the
 * next page — the strip grows rather than being replaced, so nothing they already read
 * moves. The shared hook also fires `onReachEnd` when the strip does not overflow AT ALL,
 * which is what keeps a wide desktop from stranding the learner on a short first page with
 * no way to ask for more.
 *
 * ── The arrows are desktop-only ──────────────────────────────────────────────────────
 * Same reasoning, and the same code, as the beginner keyboard's candidate row: a touch
 * user swipes the strip, a mouse user has no horizontal gesture and the scrollbars are
 * hidden app-wide. See `useHorizontalScrollArrows`.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 9a.
 */
import { Box, ButtonBase, CircularProgress } from '@mui/material';
import ScrollArrow from '../../../components/ScrollArrow';
import { useHorizontalScrollArrows } from '../../../hooks/useHorizontalScrollArrows';
import ForeignText from '../../../components/ForeignText';
import type { DictionaryEntry } from '../../../types';

export interface IWLookupResultsProps {
  results: DictionaryEntry[];
  language: 'zh' | 'es';
  /** A further page is in flight: a trailing spinner holds its place in the strip. */
  loadingMore: boolean;
  /** Insert this word into the sentence being composed. */
  onSelect(word: string): void;
  /** The learner has reached the right edge; the composer decides whether more exists. */
  onReachEnd(): void;
}

export default function IWLookupResults({
  results,
  language,
  loadingMore,
  onSelect,
  onReachEnd,
}: IWLookupResultsProps) {
  // `results` is the re-measure trigger: it is replaced wholesale on a new query and
  // extended on every appended page, and both change the strip's scroll width.
  const { scrollerRef, showArrows, canScrollLeft, canScrollRight, page, onScroll } =
    useHorizontalScrollArrows({ deps: results, onReachEnd });

  const arrow = (direction: -1 | 1) => {
    if (!showArrows) return null;
    return (
      <ScrollArrow
        direction={direction}
        enabled={direction === -1 ? canScrollLeft : canScrollRight}
        onClick={() => page(direction)}
        classBlock="iw-composer__result"
        label={direction === -1 ? 'Scroll dictionary results left' : 'Scroll dictionary results right'}
      />
    );
  };

  return (
    <Box className="iw-composer__results" sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
      {arrow(-1)}

      <Box
        ref={scrollerRef}
        className="iw-composer__results-scroller"
        onScroll={onScroll}
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 1.25,
          // The app is otherwise touchAction: none, so this strip opts in deliberately —
          // the same exception the keyboard's candidate row takes.
          overflowX: 'auto',
          overflowY: 'hidden',
          touchAction: 'pan-x',
          pb: 0.5,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {results.map(entry => (
          <ButtonBase
            key={entry.id}
            className="iw-composer__result"
            onClick={() => onSelect(entry.word1)}
            sx={{ borderRadius: 1, px: 0.5, py: 0.25, flex: '0 0 auto' }}
            aria-label={`Insert ${entry.word1}`}
          >
            <ForeignText
              text={entry.word1}
              pronunciation={entry.pronunciation}
              language={language}
              size="sm"
              compact
            />
          </ButtonBase>
        ))}
        {loadingMore && (
          <Box
            className="iw-composer__results-more"
            sx={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', px: 1 }}
          >
            <CircularProgress size={12} />
          </Box>
        )}
      </Box>

      {arrow(1)}
    </Box>
  );
}
