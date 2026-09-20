import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, IconButton } from '@mui/material';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import ForeignText from '../../../components/ForeignText';
import SegmentedSentenceDisplay from '../../../components/SegmentedSentenceDisplay';
import { revealedText } from '../../../engine/iw/revealSchedule';
import { clipSegmentsToLength } from './lineReveal';
import { bubbleDock, bubbleOverhang, DOCK_STACK_GAP_PX } from './bubbleDock';
import { LEADING, SIZE, TRACKING, WEIGHT } from '../../../theme/scale';
import type { IWEmote, IWLineSegments } from '../../../../server/contracts/iw';
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
 * ⚠️ **THE LINE IS THE EST'S `SegmentedSentenceDisplay`, NOT A SECOND LOOKUP UI** (§ 5.3b).
 * When a line's segmentation is known, the bubble hands it to the same component an example
 * sentence uses, so a word tapped in a bubble opens the same popup, the same drill chain and
 * the same tone colours as the identical word tapped in the est. Two lookup affordances that
 * merely resembled each other would be the drift this reuse exists to prevent. Without
 * segmentation — a non-`zh` scene, a dictionary hiccup, or simply a turn whose `segments`
 * event has not landed yet — it falls back to plain `ForeignText`, which is what every bubble
 * rendered before this existed.
 *
 * ⚠️ **REVEAL IS APPLIED TO THE SEGMENT LIST, NOT ONLY TO THE STRING.** `SegmentedSentenceDisplay`
 * walks a cursor across `[...foreignText]` consuming each segment's length, so handing it a
 * truncated line with the FULL segment list would leave the last segment claiming characters
 * that are not there — and its measured highlight rect, which the popup anchors to, would be
 * measured against them. {@link clipSegmentsToLength} truncates both together.
 *
 * ⚠️ **THE BUBBLE IS ANCHORED WHILE IT FITS AND DOCKS WHEN IT DOES NOT** ({@link bubbleDock}).
 * On screen it sits exactly over the head, uncorrected. As the speaker is panned or walked past
 * an edge the bubble slides to a ledge at the top centre of the layer, in proportion to how far
 * its box overhangs — a blend, not a switch, so panning back brings it home along the same path.
 *
 * That is deliberately NOT the edge clamp withdrawn on 2026-09-07, which nudged a bubble the
 * minimum distance back inside the layer: it still read as anchored while pointing at the wrong
 * body, and two speakers near one edge landed on the same clamped spot, so the one cue that says
 * WHO is talking failed exactly when the screen got crowded. Docking keeps attribution honest by
 * being obvious — the bubble travels visibly to a fixed ledge that is plainly not a head, and
 * simultaneous off-screen speakers each get their own slot rather than one unreadable pile. What
 * it buys back is the case the withdrawal accepted as a cost: a line is never simply unreadable
 * because its speaker is behind the camera.
 *
 * The layer stays `overflow: hidden` — a bubble mid-blend is still partly outside, and without
 * it that would paint over the composer and the rest of the page.
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
  /** Tap-to-look-up data by exact line text (§ 5.3b). A miss renders plain text. */
  lineSegments: Record<string, IWLineSegments>;
  /**
   * actorId → the name printed at the top of that speaker's bubble. Built by the page from
   * the runtime's bodies (plus the learner's own "You"), so this component never has to know
   * what an `IWSceneBody` is. A missing id renders an unlabelled bubble rather than an id.
   */
  speakerNames: Record<string, string>;
  /** Live screen positions, written by the stage every frame. */
  positions: React.MutableRefObject<Map<string, { x: number; y: number }>>;
  language: 'zh' | 'es';
  /**
   * Speak the line again — offered on every bubble somebody else spoke (Q41), including one
   * that was never narrated because audio is muted. It must be wired to the DELIBERATE
   * `speakSentence`, never `autoSpeakSentence`: the whole point is that it speaks under mute.
   */
  onReplay(text: string): void;
  /**
   * Open the eip for a tapped word (§ 5.3c). Given, the caption card grows the est's drill-in
   * chevron; omitted, it stays the passive tooltip it was before the eip was mounted here.
   */
  onSegmentOpen?(segment: string): void;
}

export default function IWSpeechBubbles({
  bubbles, lineSegments, speakerNames, positions, language, onReplay, onSegmentOpen,
}: IWSpeechBubblesProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  /** Every mounted bubble's root, keyed the same way the list is. Written on mount/unmount. */
  const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  /** The list order, as a ref: the frame loop needs it without being re-registered per render. */
  const orderRef = useRef<{ key: string; actorId: string }[]>([]);
  orderRef.current = bubbles.map(b => ({ key: bubbleKey(b), actorId: b.actorId }));

  /**
   * ⚠️ **POSITIONING IS ONE LOOP FOR THE WHOLE LAYER, NOT ONE PER BUBBLE.** Docking is not a
   * per-bubble decision any more: bubbles that dock at the same moment have to be given
   * separate slots on the ledge, which can only be decided by something that can see all of
   * them. Each bubble still runs its own reveal loop, because that IS per-bubble state.
   *
   * Like the reveal loop, this writes `style.transform` directly and sets no React state.
   */
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const layerEl = layerRef.current;
      if (!layerEl) return;
      const layer = { width: layerEl.clientWidth, height: layerEl.clientHeight };

      // Pass 1 — measure. Anchors and boxes are read before anything is written, so no
      // bubble's layout is measured against another's half-applied transform.
      const measured = orderRef.current.map(({ key, actorId }) => {
        const node = nodesRef.current.get(key);
        if (!node) return null;
        const anchor = positions.current.get(actorId);
        if (!anchor) return { node, anchor: null, size: { width: 0, height: 0 }, overhang: 0 };
        const size = { width: node.offsetWidth, height: node.offsetHeight };
        return { node, anchor, size, overhang: bubbleOverhang(anchor, size, layer) };
      });

      // Pass 2 — place. Docked bubbles claim ledge slots in list order and stack downward by
      // their real heights, so a two-line bubble does not sit under a one-line one.
      let stackOffset = 0;
      for (const item of measured) {
        if (!item) continue;
        const { node, anchor, size } = item;
        if (!anchor) {
          // The speaker is not being drawn this frame. Hide rather than leave the bubble at a
          // stale position, which reads as a line hanging in mid-air.
          node.style.visibility = 'hidden';
          continue;
        }
        const placed = bubbleDock({ anchor, size, layer, stackOffset });
        // Only a bubble that has actually started travelling claims ledge space, and it claims
        // it in proportion to how docked it is — so the bubbles below it slide down as this one
        // arrives instead of jumping when it lands.
        stackOffset += (size.height + DOCK_STACK_GAP_PX) * placed.t;
        node.style.transform =
          `translate3d(${Math.round(placed.x)}px, ${Math.round(placed.y)}px, 0) translate(-50%, -100%)`;
        node.style.visibility = 'visible';
        node.dataset.docked = placed.t > 0.99 ? 'true' : 'false';
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [positions]);

  return (
    <Box
      ref={layerRef}
      className="iw-speech-bubbles"
      // `none` at the layer, `auto` per bubble: a tap that is not on a bubble must reach the
      // world surface underneath (§ 14 Q18 — only the world routes taps by hit-test).
      sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}
    >
      {bubbles.map(bubble => (
        <Bubble
          key={bubbleKey(bubble)}
          bubble={bubble}
          // Hand the root up so the layer's single positioning loop can place it (see above).
          register={(node) => {
            const key = bubbleKey(bubble);
            if (node) nodesRef.current.set(key, node);
            else nodesRef.current.delete(key);
          }}
          // Looked up by EXACT text. The line the server segmented is the line before
          // `guardNpcLine` ran, so a sanitized line simply misses and stays plain rather than
          // painting one line's segments over another's characters.
          line={lineSegments[bubble.text]}
          speakerName={speakerNames[bubble.actorId] ?? ''}
          language={language}
          onReplay={onReplay}
          onSegmentOpen={onSegmentOpen}
        />
      ))}
    </Box>
  );
}

/** The list key, and therefore the id the layer's positioning loop registers a root under. */
function bubbleKey(bubble: IWBubble): string {
  return `${bubble.actorId}:${bubble.startedAt}`;
}

function Bubble({ bubble, line, speakerName, language, register, onReplay, onSegmentOpen }: {
  bubble: IWBubble;
  line: IWLineSegments | undefined;
  /** Empty when the speaker has no name to print — the bubble then looks exactly as before. */
  speakerName: string;
  language: 'zh' | 'es';
  register(node: HTMLDivElement | null): void;
  onReplay(text: string): void;
  onSegmentOpen?(segment: string): void;
}) {
  const [shown, setShown] = useState('');

  // Reveal only — WHERE this bubble goes is the layer's job now (docking needs to see every
  // bubble at once). This loop still exists separately because the revealed prefix is React
  // state on this component and changes a few times a second, not 60×.
  useEffect(() => {
    let raf = 0;
    let painted = '';
    const frame = () => {
      raf = requestAnimationFrame(frame);
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
  }, [bubble]);

  /**
   * The revealed prefix, as the est's `SentenceData`.
   *
   * Recomputed only when the revealed LENGTH changes — a few times a second, not per frame —
   * because `shown` is state and this memo hangs off it. `null` whenever there is nothing to
   * segment: no data for this line, a length mismatch (the guard rewrote the text), or an
   * empty reveal.
   */
  const segmented = useMemo(() => {
    if (!line || !shown) return null;
    // A line whose segmentation was built for DIFFERENT text cannot be trusted to partition
    // this one. Cheaper and safer to fall back than to paint a misaligned popup.
    if (line.foreignText !== bubble.text) return null;
    return {
      foreignText: shown,
      _segments: clipSegmentsToLength(line.segments, [...shown].length),
      segmentMetadata: line.segmentMetadata,
    };
  }, [line, shown, bubble.text]);

  return (
    <Box
      ref={register}
      className={`iw-speech-bubble iw-speech-bubble--${bubble.actorId}`}
      sx={{
        position: 'absolute', top: 0, left: 0, visibility: 'hidden',
        pointerEvents: 'auto',
        // A column: a header row (name + emote + replay) over the spoken line. See the
        // header block below for why the chrome sits above the speech rather than beside it.
        display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.15,
        maxWidth: 260,
        px: 1.2, py: 0.6,
        borderRadius: 2,
        // ⚠️ A BUBBLE IS A LIGHT CARD, FOR THE SAME REASON THE COMPOSER IS. It shipped dark
        // (`rgba(18,18,22,0.88)`) while its contents — `ForeignText`, and now the est's
        // `SegmentedSentenceDisplay` — render in the theme's DARK-on-light text colour, so the
        // spoken line was near-invisible on it. The fix is the ground, not a white override:
        // the est's own tapped-segment card (`CpcdPopup`) is a white card, and a bubble that
        // opens one has to be the same material or the popup reads as a foreign object landing
        // on top of a different design.
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        boxShadow: '0 4px 18px rgba(0,0,0,0.28)',
      }}
    >
      {/**
        * The header row: WHO is talking, HOW they feel, and the replay button — everything
        * about the line that is not the line.
        *
        * ⚠️ **THE CHROME IS ABOVE THE SPEECH, NOT BESIDE IT.** The emote glyph and the replay
        * icon used to sit at the end of the text row, where they competed for the bubble's
        * 260px with the one thing worth reading and pushed a line into an extra wrap. On their
        * own row they cost height only when they have something to say, and they read as what
        * they are: attribution, not words the speaker said.
        *
        * ⚠️ **THE NAME IS UI CHROME, NOT LEARNABLE TEXT** — which is why it is plain DOM text
        * and not `ForeignText`. A speaker's `name` is often Chinese (老板), but this line is a
        * caption identifying who is talking, not a word the learner is being taught: giving it
        * tone colour and a pinyin row would make it compete with the line underneath. The
        * stage's own head label (`IWSceneStage` → `LABEL_STYLE`) prints the same string the
        * same way, so the two places a speaker is named agree.
        *
        * The name matters most exactly when the head label is NOT visible: a docked bubble has
        * left its speaker behind (see {@link bubbleDock}), and the name is then the only thing
        * that says whose words these are.
        */}
      {(speakerName || EMOTE_GLYPH[bubble.emote] || bubble.replayable) && (
        <Box
          className="iw-speech-bubble__header"
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}
        >
          <Box
            className="iw-speech-bubble__speaker"
            sx={{
              flex: 1,
              fontSize: SIZE.micro,
              fontWeight: WEIGHT.semibold,
              letterSpacing: TRACKING.wide,
              lineHeight: LEADING.tight,
              color: 'text.secondary',
              // The name never pushes the bubble wider than the line it labels; a long one is
              // cut rather than wrapped, because two rows of chrome above one row of speech
              // inverts what the bubble is for.
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {speakerName}
          </Box>
          {EMOTE_GLYPH[bubble.emote] && (
            <Box className="iw-speech-bubble__emote" sx={{ flexShrink: 0, fontSize: 14, opacity: 0.75 }}>
              {EMOTE_GLYPH[bubble.emote]}
            </Box>
          )}
          {bubble.replayable && (
            <IconButton
              className="iw-speech-bubble__replay"
              size="small"
              aria-label="Play this line again"
              onClick={() => onReplay(bubble.text)}
              sx={{ flexShrink: 0, p: 0.25, ml: -0.25, mr: -0.5, color: 'text.secondary' }}
            >
              <VolumeUpIcon sx={{ fontSize: 14 }} />
            </IconButton>
          )}
        </Box>
      )}
      <Box className="iw-speech-bubble__text">
        {segmented ? (
          <SegmentedSentenceDisplay
            className="iw-speech-bubble__segments"
            sentence={segmented}
            language={language}
            size="sm"
            flexWrap="wrap"
            // ⚠️ ON, and worth the height. A bubble is the ONLY place a learner meets a word
            // they were not taught — the est and the flashcard both show pinyin, and a spoken
            // line without it is the one surface where an unknown character is unreadable
            // rather than merely unknown. `ForeignText`/`CPCDRow` render the tone-coloured
            // pinyin row, so this is the app's one pinyin renderer, not a second one.
            showPinyin
            // A bubble floats over a canvas that owns dragging, so a text cursor here would
            // only ever be an accident.
            selectable={false}
            // § 5.3c. The est's own drill-in, on the est's own component: the caption card
            // gains a chevron and opens the eip for the tapped word. Every bubble gets it,
            // the learner's echoed line included — one lookup behaviour, no per-speaker rule.
            onSegmentOpen={onSegmentOpen}
          />
        ) : (
          // Same reasoning as the segmented branch: pinyin is on, so the two paths stay
          // indistinguishable to the learner (§ 5.3b) rather than differing by a whole row.
          <ForeignText text={shown} language={language} size="sm" showPinyin flexWrap="wrap" />
        )}
      </Box>
    </Box>
  );
}
