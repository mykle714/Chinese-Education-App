import { useEffect, useRef, useState } from 'react';
import { Box, IconButton } from '@mui/material';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import ForeignText from '../../../components/ForeignText';
import { revealedText } from '../../../engine/iw/revealSchedule';
import type { IWEmote } from '../../../../server/contracts/iw';
import type { IWBubble } from './useIWSceneRuntime';

/**
 * IWSpeechBubbles — the DOM layer that floats over the canvas (§ 5.3a).
 *
 * LAYER: view. It owns no speech state: the runtime hook decides what is said, when it starts
 * and how the glyphs are spaced; this component paints the prefix that is due.
 *
 * ⚠️ **IT IS DOM, NOT PIXI, BECAUSE THE BUBBLE IS `ForeignText`.** That is an app-wide rule
 * rather than an iw preference — foreign words are rendered by one component everywhere, so
 * the CJK typeface setting, tone colour and the pinyin-shift spacing all come for free and
 * cannot drift. Drawing the line with `pixiText` would be a second CJK renderer.
 *
 * ⚠️ **POSITION IS WRITTEN, TEXT IS RENDERED.** Two things change while a bubble is up, at
 * very different rates: WHERE the speaker is (every frame) and HOW MUCH of the line is
 * revealed (a few glyphs a second). The first is written straight to `style.transform` from
 * an animation frame and never touches React; the second is ordinary state, because it
 * changes rarely and has to re-render `ForeignText`. Doing both as state would re-render the
 * page 60×/sec behind a canvas that is already drawing itself.
 *
 * ⚠️ **NO TAP-TO-COMPLETE** (§ 14 Q41). The reveal runs at speech rate and cannot be skipped:
 * with audio as the clock, skipping means either desyncing text from voice or cutting the
 * voice off, and listening is half of what a scene is for. What replaces it is REPLAY — free,
 * because the clip is already decoded — on a bubble that persists after it finishes.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 5.3a, § 6.4, § 14 Q41.
 */

/** One glyph per emote. It drives a face; it is never rendered as words (§ 5.1 line 3). */
const EMOTE_GLYPH: Record<IWEmote, string> = {
  neutral: '',
  curious: '?',
  pleased: '♪',
  confused: '…',
  impatient: '!',
  amused: '~',
};

export interface IWSpeechBubblesProps {
  bubbles: IWBubble[];
  /** Live screen positions, written by the stage every frame. */
  positions: React.MutableRefObject<Map<string, { x: number; y: number }>>;
  language: 'zh' | 'es';
  /** Speak the line again. Offered only for a bubble that had audio behind it (Q41). */
  onReplay(text: string): void;
}

export default function IWSpeechBubbles({ bubbles, positions, language, onReplay }: IWSpeechBubblesProps) {
  return (
    <Box
      className="iw-speech-bubbles"
      // `none` at the layer, `auto` per bubble: a tap that is not on a bubble must reach the
      // world surface underneath (§ 14 Q18 — only the world routes taps by hit-test).
      sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}
    >
      {bubbles.map(bubble => (
        <Bubble
          key={`${bubble.actorId}:${bubble.startedAt}`}
          bubble={bubble}
          positions={positions}
          language={language}
          onReplay={onReplay}
        />
      ))}
    </Box>
  );
}

function Bubble({ bubble, positions, language, onReplay }: {
  bubble: IWBubble;
  positions: React.MutableRefObject<Map<string, { x: number; y: number }>>;
  language: 'zh' | 'es';
  onReplay(text: string): void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState('');

  useEffect(() => {
    let raf = 0;
    let painted = '';
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const root = rootRef.current;
      if (!root) return;

      const at = positions.current.get(bubble.actorId);
      if (at) {
        root.style.transform = `translate3d(${Math.round(at.x)}px, ${Math.round(at.y)}px, 0) translate(-50%, -100%)`;
        root.style.visibility = 'visible';
      } else {
        // The speaker is not being drawn this frame. Hide rather than leave the bubble at a
        // stale position, which reads as a line hanging in mid-air.
        root.style.visibility = 'hidden';
      }

      // The schedule already decided when each glyph is due — spread across the decoded
      // clip's duration, or the fallback cadence when there is no clip. Both paths land here
      // identically, which is § 5.3a's requirement that the learner cannot tell them apart.
      const due = revealedText(bubble.text, bubble.schedule, performance.now() - bubble.startedAt);
      if (due !== painted) {
        painted = due;
        setShown(due);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [bubble, positions]);

  return (
    <Box
      ref={rootRef}
      className={`iw-speech-bubble iw-speech-bubble--${bubble.actorId}`}
      sx={{
        position: 'absolute', top: 0, left: 0, visibility: 'hidden',
        pointerEvents: 'auto',
        display: 'flex', alignItems: 'center', gap: 0.5,
        maxWidth: 260,
        px: 1.2, py: 0.6,
        borderRadius: 2,
        bgcolor: 'rgba(18,18,22,0.88)',
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
      }}
    >
      <Box className="iw-speech-bubble__text">
        <ForeignText text={shown} language={language} size="sm" showPinyin={false} flexWrap="wrap" />
      </Box>
      {EMOTE_GLYPH[bubble.emote] && (
        <Box className="iw-speech-bubble__emote" sx={{ fontSize: 14, opacity: 0.75 }}>
          {EMOTE_GLYPH[bubble.emote]}
        </Box>
      )}
      {bubble.replayable && (
        <IconButton
          className="iw-speech-bubble__replay"
          size="small"
          aria-label="Play this line again"
          onClick={() => onReplay(bubble.text)}
          sx={{ p: 0.25, color: 'rgba(255,255,255,0.6)' }}
        >
          <VolumeUpIcon sx={{ fontSize: 14 }} />
        </IconButton>
      )}
    </Box>
  );
}
