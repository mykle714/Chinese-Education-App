import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, IconButton } from '@mui/material';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import ForeignText from '../../../components/ForeignText';
import SegmentedSentenceDisplay from '../../../components/SegmentedSentenceDisplay';
import { revealedText } from '../../../engine/iw/revealSchedule';
import { clipSegmentsToLength } from './lineReveal';
import { bubbleDock, bubbleOverhang, DOCK_STACK_GAP_PX } from './bubbleDock';
import { LEADING, SIZE, TRACKING, WEIGHT } from '../../../theme/scale';
import { IW_ACTOR_PLAYER, type IWEmote, type IWLineSegments } from '../../../../server/contracts/iw';
import type { IWSpeakerName } from './iwSceneActors';
import type { IWBubble } from './useIWSceneRuntime';

/**
 * IWSpeechBubbles — the DOM layer that floats over the canvas (§ 5.3a): ONE element per
 * named body, which is that body's NAMETAG until they speak and their SPEECH BUBBLE while
 * they do.
 *
 * ⚠️ **THE NAMETAG AND THE BUBBLE ARE THE SAME ELEMENT IN TWO STATES** (2026-09-21), and that
 * is the whole design rather than an implementation shortcut. They occupy the same place —
 * the air just above one head — so as two components they could only ever collide, stack or
 * take turns hiding each other, and all three read as a bug. As one element the transition is
 * the thing the learner sees: the tag grows into the bubble, and the name it was showing
 * shrinks into the bubble's corner, where it goes on saying whose words these are. Nothing is
 * revealed or hidden; a card changes shape.
 *
 * ⚠️ **WHICH IS WHY THE NAME IS `ForeignText` NOW, REVERSING THE RULE THIS FILE USED TO
 * STATE.** The name used to be plain DOM text in both places, on the argument that it is
 * chrome rather than something the learner is being taught. That still holds INSIDE a bubble,
 * where a stacked reading would sit directly above the spoken line's own — so the corner
 * caption uses the INLINE cpcd layout (`layout="inline"`, 老板 lǎobǎn), which costs a row's
 * width instead of a row's height. Idle, there is no line to compete with: a standing NPC's
 * name is the one thing on that part of the board, and an unreadable 老板 over a head is a
 * free reading rep thrown away. So the tag state uses the ordinary stacked layout.
 *
 * ⚠️ **A TAG DOES NOT DOCK; A BUBBLE DOES.** Docking exists so a LINE is never lost when its
 * speaker leaves the screen ({@link bubbleDock}). A name is not a line — nobody needs to be
 * told the name of somebody they cannot see — and a ledge full of the names of off-screen
 * NPCs would bury the one bubble docking is for. An idle tag is therefore drawn at its anchor
 * and simply clipped by the layer, exactly like the body it labels.
 *
 * Everything below this line describes the BUBBLE state, and predates the merge.
 *
 * LAYER: view. It owns no speech state: the runtime hook decides what is said, when it starts
 * and how the glyphs are spaced; this component paints the prefix that is due.
 *
 * ⚠️ **IT IS DOM, NOT PIXI, BECAUSE BOTH STATES ARE `ForeignText`.** That is an app-wide rule
 * rather than an iw preference — foreign words are rendered by one component everywhere, so
 * the CJK typeface setting, tone colour and the pinyin-shift spacing all come for free and
 * cannot drift. Drawing the line with `pixiText` would be a second CJK renderer — and the
 * head label WAS exactly that until it moved here, a monospace `pixiText` that could show an
 * NPC's name but never its reading.
 *
 * ⚠️ **POSITION IS WRITTEN, TEXT IS RENDERED.** Two things change while a tag is up, at
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

/**
 * One emoji per emote, released as a puff above the bubble when a line starts (§ 5.3a). It is
 * never rendered as words (§ 5.1 line 3). `neutral` is empty: no mood, no puff.
 */
const EMOTE_EMOJI: Record<IWEmote, string> = {
  neutral: '',
  curious: '🤔',
  pleased: '😊',
  confused: '😕',
  impatient: '😤',
  amused: '😄',
};

/** How long one mood puff lives, in either motion. Long enough to be noticed mid-reveal. */
const EMOTE_PUFF_MS = 1400;
/** Rendered emoji size. The puff's physics works on its CENTRE, so this is also its extent. */
const EMOTE_PUFF_PX = 22;
/** Anchored float: how far the puff drifts straight up over its life. */
const EMOTE_FLOAT_RISE_PX = 34;
/**
 * Docked launch, in px and px/s. Upward speed and gravity together set the arc's apex
 * (v² / 2g ≈ 45px), which is kept short on purpose — a docked bubble is at the TOP of the
 * layer, so height above it is exactly the space the layer clips away.
 */
const EMOTE_LAUNCH = {
  upMin: 230, upMax: 290,
  sideMin: 70, sideMax: 150,
  gravity: 700,
  /** Degrees per second of tumble, signed to the side it flies toward. */
  spin: 140,
} as const;
/**
 * The puff layer's z-index: in front of the page header (which sets none) and the footer
 * (`FooterPresenter`, 100), BEHIND sheets and their scrims (`SheetPanel`, 1200+) — an eip
 * opened by tapping a word mid-puff must not have an emoji flying across it.
 */
const EMOTE_PUFF_Z_INDEX = 1100;
/** Fraction of the life spent fully opaque before the fade begins. */
const EMOTE_PUFF_HOLD = 0.55;

/**
 * The "this is you" marker's colour — a scarlet chosen to stay legible on BOTH grounds a board
 * can have: the page-light dirt plateau and the charcoal wood void (`iwBoardVoid.ts`). A local
 * constant rather than a theme token because the theme's semantic reds were all set to ink by
 * the shelf redesign (`COLORS.dangerInk`), and this is not a danger signal anyway.
 */
const PLAYER_MARKER_COLOR = '#E0242F';

export interface IWSpeechBubblesProps {
  bubbles: IWBubble[];
  /** Tap-to-look-up data by exact line text (§ 5.3b). A miss renders plain text. */
  lineSegments: Record<string, IWLineSegments>;
  /**
   * actorId → the name that body wears: over the head while it is idle, in the corner of its
   * bubble while it speaks. Built by the page from the runtime's `speakerLabels` (plus the
   * learner's own "You", whom only a view has a word for), so this component never has to
   * know what an `IWSceneBody` is.
   *
   * ⚠️ **THIS IS ALSO THE LIST OF WHO GETS A NAMETAG.** An id absent here is simply not
   * labelled — which is how the learner stays bare (their body IS where they are looking) and
   * how an NPC the code no longer defines still gets a plain tag from its id.
   */
  speakerNames: Record<string, IWSpeakerName>;
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
  /**
   * The mood puffs' own layer, painted above EVERY tag. State rather than a ref because the
   * puffs portal into it, so they have to re-render once it exists.
   */
  const [puffLayer, setPuffLayer] = useState<HTMLDivElement | null>(null);
  /** Every mounted tag's root, keyed by ACTOR id. Written on mount/unmount. */
  const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  /** The list order, as a ref: the frame loop needs it without being re-registered per render. */
  const orderRef = useRef<{ actorId: string; speaking: boolean }[]>([]);
  /** The learner's "this is you" arrow. Positioned by the same frame loop as the tags. */
  const playerMarkerRef = useRef<HTMLDivElement | null>(null);

  /**
   * One entry per body that has something to show: everybody with a name, plus anybody
   * speaking (the learner has no nametag but does get a bubble).
   *
   * ⚠️ **KEYED BY ACTOR ID, NOT BY UTTERANCE**, which is what makes the morph possible at all:
   * the tag element must SURVIVE the moment its owner starts and stops speaking, or React
   * remounts it and the growth is a flicker. It is also why two consecutive lines from one
   * speaker now reuse one element — the reveal loop keys on the bubble itself, so it still
   * restarts.
   *
   * ⚠️ **SPEAKERS COME FIRST**, because order is what {@link bubbleDock} hands out ledge slots
   * by. Idle tags never dock and never claim a slot, so their position in this list is free.
   */
  const tags = useMemo(() => {
    const speaking = new Set(bubbles.map(b => b.actorId));
    const list: { actorId: string; bubble: IWBubble | null }[] =
      bubbles.map(bubble => ({ actorId: bubble.actorId, bubble }));
    for (const actorId of Object.keys(speakerNames)) {
      // The learner wears no tag. Their name exists only for the bubble state above, where a
      // docked bubble is the one place their own words need attributing.
      if (actorId === IW_ACTOR_PLAYER || speaking.has(actorId)) continue;
      list.push({ actorId, bubble: null });
    }
    return list;
  }, [bubbles, speakerNames]);
  orderRef.current = tags.map(({ actorId, bubble }) => ({ actorId, speaking: bubble !== null }));

  /**
   * ⚠️ **POSITIONING IS ONE LOOP FOR THE WHOLE LAYER, NOT ONE PER TAG.** Docking is not a
   * per-bubble decision: bubbles that dock at the same moment have to be given separate slots
   * on the ledge, which can only be decided by something that can see all of them. Each
   * speaking tag still runs its own reveal loop, because that IS per-bubble state.
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
      // tag's layout is measured against another's half-applied transform.
      const measured = orderRef.current.map(({ actorId, speaking }) => {
        const node = nodesRef.current.get(actorId);
        if (!node) return null;
        const anchor = positions.current.get(actorId);
        if (!anchor) return { node, speaking, anchor: null, size: { width: 0, height: 0 }, overhang: 0 };
        const size = { width: node.offsetWidth, height: node.offsetHeight };
        return { node, speaking, anchor, size, overhang: bubbleOverhang(anchor, size, layer) };
      });

      // Pass 2 — place. Docked bubbles claim ledge slots in list order and stack downward by
      // their real heights, so a two-line bubble does not sit under a one-line one.
      let stackOffset = 0;
      for (const item of measured) {
        if (!item) continue;
        const { node, speaking, anchor, size } = item;
        if (!anchor) {
          // The body is not being drawn this frame. Hide rather than leave the tag at a stale
          // position, which reads as a name (or a line) hanging in mid-air.
          node.style.visibility = 'hidden';
          continue;
        }
        // An idle nametag is drawn at its anchor and nowhere else — see the header's note on
        // why only a LINE earns a trip to the ledge.
        const placed = speaking ? bubbleDock({ anchor, size, layer, stackOffset }) : { ...anchor, t: 0 };
        // Only a bubble that has actually started travelling claims ledge space, and it claims
        // it in proportion to how docked it is — so the bubbles below it slide down as this one
        // arrives instead of jumping when it lands.
        stackOffset += (size.height + DOCK_STACK_GAP_PX) * placed.t;
        node.style.transform =
          `translate3d(${Math.round(placed.x)}px, ${Math.round(placed.y)}px, 0) translate(-50%, -100%)`;
        node.style.visibility = 'visible';
        node.dataset.docked = placed.t > 0.99 ? 'true' : 'false';
      }

      // The learner's arrow hangs off the same head anchor their bubble does, so the two
      // would stack in one patch of air. While they speak the bubble already says "this is
      // you", so the arrow steps aside rather than fighting it for the space.
      const markerEl = playerMarkerRef.current;
      if (markerEl) {
        const anchor = positions.current.get(IW_ACTOR_PLAYER);
        const playerSpeaking = orderRef.current.some(t => t.actorId === IW_ACTOR_PLAYER && t.speaking);
        if (!anchor || playerSpeaking) {
          markerEl.style.visibility = 'hidden';
        } else {
          markerEl.style.transform =
            `translate3d(${Math.round(anchor.x)}px, ${Math.round(anchor.y)}px, 0) translate(-50%, -100%)`;
          markerEl.style.visibility = 'visible';
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [positions]);

  return (
    <Box
      ref={layerRef}
      className="iw-actor-tags"
      // `none` at the layer, `auto` per SPEAKING tag: a tap that is not on a bubble must
      // reach the world surface underneath (§ 14 Q18 — only the world routes taps by
      // hit-test). See the tag's own note for why an idle nametag stays transparent.
      sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}
    >
      {/**
        * THE LEARNER'S "THIS IS YOU" ARROW. The learner wears no nametag (see `tags`), so on a
        * board of look-alike sprites this is what finds them at a glance. DOM rather than Pixi
        * so it keeps one screen size at every zoom rung, like the tags beside it. Static, and
        * first in the layer so every nametag and bubble paints over it.
        */}
      <Box
        ref={playerMarkerRef}
        className="iw-player-marker"
        aria-hidden
        sx={{
          position: 'absolute', top: 0, left: 0, visibility: 'hidden',
          display: 'flex', color: PLAYER_MARKER_COLOR,
          // A dark halo, so the scarlet separates from warm wood and light dirt alike.
          filter: 'drop-shadow(0 0 1.5px rgba(0,0,0,0.75)) drop-shadow(0 1px 2px rgba(0,0,0,0.35))',
        }}
      >
        {/* The glyph box has ~8px of empty air under the chevron; pull it down so the point,
            not the box, sits at the anchor's gap above the head. */}
        <KeyboardArrowDownRoundedIcon className="iw-player-marker__icon" sx={{ fontSize: 30, mb: '-8px' }} />
      </Box>
      {tags.map(({ actorId, bubble }) => (
        <ActorTag
          key={actorId}
          actorId={actorId}
          bubble={bubble}
          // Hand the root up so the layer's single positioning loop can place it (see above).
          register={(node) => {
            if (node) nodesRef.current.set(actorId, node);
            else nodesRef.current.delete(actorId);
          }}
          // Looked up by EXACT text. The line the server segmented is the line before
          // `guardNpcLine` ran, so a sanitized line simply misses and stays plain rather than
          // painting one line's segments over another's characters.
          line={bubble ? lineSegments[bubble.text] : undefined}
          speaker={speakerNames[actorId]}
          language={language}
          onReplay={onReplay}
          onSegmentOpen={onSegmentOpen}
          puffLayer={puffLayer}
        />
      ))}
      {/**
        * ⚠️ **THE PUFFS ARE NOT DRAWN INSIDE THEIR TAGS, OR EVEN INSIDE THIS LAYER.**
        *
        * Not inside a tag: each tag is its own stacking context (it is positioned by
        * `transform`), so anything inside it can never paint above a tag later in the list — a
        * launched puff falling past the docked bubble below its own went BEHIND it — and inside
        * its own tag it tied with the line's `zIndex: 1` word highlights, which come later in the
        * DOM and so won.
        *
        * Not inside this layer: it is `overflow: hidden`, and so is the page's content box, so a
        * puff launched off a docked bubble at the top edge was cut off at the page header. The
        * puffs are instead portaled to a FIXED, full-viewport layer on `document.body`, which
        * paints over the page header ({@link EMOTE_PUFF_Z_INDEX}). {@link EmotePuff} tracks its
        * tag's position itself, in viewport px.
        */}
      {createPortal(
        <Box
          ref={setPuffLayer}
          className="iw-actor-tags__puffs"
          sx={{
            position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden',
            zIndex: EMOTE_PUFF_Z_INDEX,
          }}
        />,
        document.body,
      )}
    </Box>
  );
}

/**
 * One body's tag: their name over their head, grown into a speech bubble while they talk.
 *
 * ⚠️ **THE NAME LIVES IN THE SAME ELEMENT IN BOTH STATES.** The header row is rendered
 * unconditionally and holds the name in either case — only its cpcd LAYOUT changes (stacked
 * when idle, inline when speaking). That is what lets the browser animate the move rather
 * than swapping one component for another: the box the name sits in persists, so its size
 * change is a transition and the name visibly settles into the corner.
 */
function ActorTag({ actorId, bubble, line, speaker, language, register, onReplay, onSegmentOpen, puffLayer }: {
  actorId: string;
  /** The line this body is speaking, or null — which is the whole state distinction. */
  bubble: IWBubble | null;
  line: IWLineSegments | undefined;
  /** Undefined when this body has no name at all — only a speaking learner reaches that. */
  speaker: IWSpeakerName | undefined;
  language: 'zh' | 'es';
  register(node: HTMLDivElement | null): void;
  onReplay(text: string): void;
  onSegmentOpen?(segment: string): void;
  /** Where this tag's mood puff is drawn — above every tag, not inside this one. */
  puffLayer: HTMLDivElement | null;
}) {
  const speaking = bubble !== null;
  /** This tag's root, for the puff to track. `register` still hands it up to the layer too. */
  const tagRef = useRef<HTMLDivElement | null>(null);
  const setTagNode = useCallback((node: HTMLDivElement | null) => {
    tagRef.current = node;
    register(node);
  }, [register]);
  const [shown, setShown] = useState('');

  // Reveal only — WHERE this tag goes is the layer's job (docking needs to see every bubble at
  // once). This loop still exists separately because the revealed prefix is React state on
  // this component and changes a few times a second, not 60×.
  useEffect(() => {
    // Idle: nothing is being said, so there is nothing to reveal and no loop to run. The
    // emptied string also means a tag that has just stopped speaking does not keep the last
    // line's prefix in a hidden box, silently holding the element's old width.
    if (!bubble) {
      setShown('');
      return undefined;
    }
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
    if (!bubble || !line || !shown) return null;
    // A line whose segmentation was built for DIFFERENT text cannot be trusted to partition
    // this one. Cheaper and safer to fall back than to paint a misaligned popup.
    if (line.foreignText !== bubble.text) return null;
    return {
      foreignText: shown,
      _segments: clipSegmentsToLength(line.segments, [...shown].length),
      segmentMetadata: line.segmentMetadata,
    };
  }, [bubble, line, shown]);

  return (
    <Box
      ref={setTagNode}
      className={`iw-actor-tag iw-actor-tag--${speaking ? 'speaking' : 'idle'} iw-actor-tag--${actorId}`}
      sx={{
        position: 'absolute', top: 0, left: 0, visibility: 'hidden',
        // ⚠️ **ONLY A SPEAKING TAG TAKES POINTER EVENTS.** A bubble has things to press — a
        // word to look up (§ 5.3c), the replay button — so it must. An idle nametag has
        // nothing, and it hovers over board the learner taps to walk (§ 14 Q18): left `auto`
        // it would silently eat every tap aimed at the tile above a head, which reads as the
        // world ignoring you rather than as a label being in the way.
        pointerEvents: speaking ? 'auto' : 'none',
        // ⚠️ **A BUBBLE PAINTS OVER EVERY IDLE NAMETAG.** DOM order alone would do the
        // opposite: `tags` lists speakers FIRST (for ledge slots), so every idle tag after them
        // would paint on top of a bubble it overlaps — a neighbour's name sitting across the
        // line being read. The line is what the learner is looking at; a name is chrome.
        // (This also makes each tag a stacking context, so the mood puff's own `zIndex` is
        // scoped to its bubble — still over idle tags, since the bubble itself is.)
        zIndex: speaking ? 1 : 0,
        // A column: a header row (name + emote + replay) over the spoken line. See the
        // header block below for why the chrome sits above the speech rather than beside it.
        display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.15,
        maxWidth: speaking ? 260 : 220,
        px: speaking ? 1.2 : 0.7,
        py: speaking ? 0.6 : 0.3,
        borderRadius: speaking ? 2 : 1.5,
        // ⚠️ A BUBBLE IS A LIGHT CARD, FOR THE SAME REASON THE COMPOSER IS. It shipped dark
        // (`rgba(18,18,22,0.88)`) while its contents — `ForeignText`, and now the est's
        // `SegmentedSentenceDisplay` — render in the theme's DARK-on-light text colour, so the
        // spoken line was near-invisible on it. The fix is the ground, not a white override:
        // the est's own tapped-segment card (`CpcdPopup`) is a white card, and a bubble that
        // opens one has to be the same material or the popup reads as a foreign object landing
        // on top of a different design.
        //
        // The nametag is the SAME material at a smaller size, which is what makes the growth
        // read as one card changing shape rather than one card replacing another.
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        boxShadow: speaking ? '0 4px 18px rgba(0,0,0,0.28)' : '0 2px 8px rgba(0,0,0,0.22)',
        // The growth itself. Only the box's own properties are transitioned: the text inside
        // swaps layout in one frame, and trying to tween that would mean measuring two cpcd
        // renderings per frame to interpolate between them.
        transition: 'max-width 180ms ease, padding 180ms ease, border-radius 180ms ease, box-shadow 180ms ease',
      }}
    >
      {/**
        * The header row: WHO this is and the replay button — everything that is not the line
        * itself. Idle, it is the entire tag. The mood is NOT here any more; see the puff below.
        *
        * ⚠️ **THE CHROME IS ABOVE THE SPEECH, NOT BESIDE IT.** The emote glyph (since replaced
        * by the puff) and the replay icon used to sit at the end of the text row, where they competed for the bubble's
        * 260px with the one thing worth reading and pushed a line into an extra wrap. On their
        * own row they cost height only when they have something to say, and they read as what
        * they are: attribution, not words the speaker said.
        *
        * ⚠️ **THE NAME IS `ForeignText` IN BOTH STATES, IN TWO DIFFERENT LAYOUTS** — see the
        * file header for why that reverses the old "the name is plain chrome" rule. Stacked
        * (`row`) while idle, where the name is the only thing on this patch of board; INLINE
        * while speaking, where a second stacked reading directly above the line's own would be
        * two pronunciations competing for one glance.
        *
        * The name matters most exactly when the tag is NOT over its head: a docked bubble has
        * left its speaker behind (see {@link bubbleDock}), and the name is then the only thing
        * that says whose words these are.
        */}
      {(speaker || bubble?.replayable) && (
        <Box
          className="iw-actor-tag__header"
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}
        >
          <Box
            className="iw-actor-tag__name"
            sx={{
              flex: 1,
              minWidth: 0,
              lineHeight: LEADING.tight,
              // Muted only in the corner. Idle it is the subject of its own card, so it takes
              // the ordinary text colour — and `CPCDInline` inherits this, which is how the
              // caption's glyphs go grey without a second colour prop.
              color: speaking ? 'text.secondary' : 'text.primary',
            }}
          >
            {speaker?.foreign ? (
              <ForeignText
                text={speaker.text}
                // ⚠️ `pinyin`, NEVER the NPC's `romanization` — see {@link IWSpeakerName}. This
                // is an ordinary cpcd row taking an ordinary per-character reading; nothing
                // about a nametag is a special rendering.
                pronunciation={speaker.pinyin || null}
                language={language}
                // Small in both states, and smaller still inline — `CPCDInline` is a caption
                // scale by construction (see its header), so this is one size key, not two.
                size="xs"
                layout={speaking ? 'inline' : 'row'}
                showPinyin
                // A tag floats over a canvas that owns dragging, so a text cursor here would
                // only ever be an accident.
                selectable={false}
              />
            ) : (
              <Box
                className="iw-actor-tag__name-plain"
                sx={{
                  fontSize: SIZE.micro,
                  fontWeight: WEIGHT.semibold,
                  letterSpacing: TRACKING.wide,
                  // The name never pushes the bubble wider than the line it labels; a long one
                  // is cut rather than wrapped, because two rows of chrome above one row of
                  // speech inverts what the bubble is for.
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {speaker?.text ?? ''}
              </Box>
            )}
          </Box>
          {bubble?.replayable && (
            <IconButton
              className="iw-actor-tag__replay"
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
      {/**
        * The mood puff (2026-09-23): the line's emote as an emoji released once as the line
        * starts. It replaced a static glyph in the header row, which sat there for the whole
        * line as one more piece of chrome to read; a mood is an event — the moment somebody says
        * something WITH a feeling — so it is shown as one. See {@link EmotePuff} for its two
        * motions (float over a head, launch off a docked bubble).
        *
        * ⚠️ **PORTALED INTO THE PUFF LAYER, NOT A CHILD OF THE TAG**, so it paints in front of
        * every bubble (see the layer's note). It still belongs to this tag in React terms — it
        * unmounts with the line — and follows the tag by reading its box every frame.
        *
        * ⚠️ **KEYED BY `startedAt`**, so each new line remounts it and replays the animation —
        * the tag element itself survives consecutive lines from one speaker (see `tags`).
        */}
      {bubble && EMOTE_EMOJI[bubble.emote] && puffLayer && createPortal(
        <EmotePuff key={bubble.startedAt} emote={bubble.emote} tagRef={tagRef} />,
        puffLayer,
      )}
      {bubble && (
        <Box className="iw-actor-tag__line">
          {segmented ? (
            <SegmentedSentenceDisplay
              className="iw-actor-tag__segments"
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
      )}
    </Box>
  );
}

/**
 * One mood puff. It picks its motion from where the bubble is when the line starts:
 *
 * - **Anchored** (the bubble sits over its speaker's head): it rises straight up off the
 *   bubble's top edge and fades — a thought leaving the head it belongs to.
 * - **Docked** (the speaker is off screen and the bubble has travelled to the ledge at the top
 *   of the layer, {@link bubbleDock}): it LAUNCHES from a random point inside the bubble, up and
 *   out to a random side, then falls under gravity as it fades. The anchored float would rise
 *   straight into the layer's clipped top edge here and be cut off almost at once; a launch
 *   spends most of its life falling back down into view instead.
 *
 * ⚠️ **THE MOTION IS DECIDED ONCE, ON THE FIRST FRAME, AND NEVER SWITCHED.** It reads the
 * tag's `data-docked`, which the layer's positioning loop writes every frame. That loop's
 * callback is queued ahead of this one, so the first read already reflects the new line's
 * placement. A bubble that docks or un-docks MID-puff keeps its original motion — the puff
 * is over in under a second and a half, and a mid-flight change of physics reads as a glitch.
 *
 * ⚠️ **POSITION IS WRITTEN, NOT RENDERED** — the same rule as the tags themselves (see the file
 * header): the simulation writes `style.transform` and `style.opacity` from an animation frame
 * and sets no React state, so a puff costs no re-renders.
 *
 * Reduced motion: neither path moves; the emoji appears in place and fades.
 */
function EmotePuff({ emote, tagRef }: {
  emote: IWEmote;
  /** The tag this puff belongs to. The puff lives in another layer, so it cannot use its parent. */
  tagRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    const tag = tagRef.current;
    const layer = el?.parentElement;
    if (!el || !tag || !layer) return undefined;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let t0 = 0;
    /** Where, in the tag's own px, the puff's centre starts, and how it then moves. */
    let path: (s: number) => { x: number; y: number; rot: number } = () => ({ x: 0, y: 0, rot: 0 });

    const frame = (now: number) => {
      if (!t0) {
        t0 = now;
        const w = tag.offsetWidth;
        const h = tag.offsetHeight;
        if (tag.dataset.docked === 'true') {
          // Launch from anywhere in the bubble, toward either side.
          const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
          const x0 = rand(0.15, 0.85) * w;
          const y0 = rand(0.2, 0.8) * h;
          const dir = Math.random() < 0.5 ? -1 : 1;
          const vx = dir * rand(EMOTE_LAUNCH.sideMin, EMOTE_LAUNCH.sideMax);
          const vy = -rand(EMOTE_LAUNCH.upMin, EMOTE_LAUNCH.upMax);
          path = still
            ? () => ({ x: x0, y: y0, rot: 0 })
            // Plain projectile motion: s is seconds since launch.
            : (sec) => ({
              x: x0 + vx * sec,
              y: y0 + vy * sec + 0.5 * EMOTE_LAUNCH.gravity * sec * sec,
              rot: dir * EMOTE_LAUNCH.spin * sec,
            });
        } else {
          // Float: start centred just above the top edge and ease upward.
          const x0 = w / 2;
          const y0 = -EMOTE_PUFF_PX / 2 - 2;
          path = still
            ? () => ({ x: x0, y: y0, rot: 0 })
            : (sec) => {
              const k = Math.min(1, (sec * 1000) / EMOTE_PUFF_MS);
              return { x: x0, y: y0 - EMOTE_FLOAT_RISE_PX * (1 - (1 - k) * (1 - k)), rot: 0 };
            };
        }
      }
      raf = requestAnimationFrame(frame);
      // A tag whose body is not drawn this frame is hidden by the layer loop; hide with it.
      if (tag.style.visibility === 'hidden') {
        el.style.visibility = 'hidden';
        return;
      }
      el.style.visibility = 'visible';
      // The path is in the TAG's own px, so the puff rides the bubble as it moves. Its box is
      // read after the layer loop has placed it this frame (that callback is queued first).
      const tagBox = tag.getBoundingClientRect();
      const layerBox = layer.getBoundingClientRect();
      const ox = tagBox.left - layerBox.left;
      const oy = tagBox.top - layerBox.top;
      const elapsed = now - t0;
      const k = elapsed / EMOTE_PUFF_MS;
      if (k >= 1) {
        // Done: leave it invisible rather than unmounting — the next line's puff replaces it.
        el.style.opacity = '0';
        cancelAnimationFrame(raf);
        return;
      }
      const { x, y, rot } = path(elapsed / 1000);
      // A quick pop-in (first 10%), a hold, then a linear fade to nothing.
      const scale = Math.min(1, 0.6 + 4 * k);
      const opacity = k < EMOTE_PUFF_HOLD ? Math.min(1, k * 10) : 1 - (k - EMOTE_PUFF_HOLD) / (1 - EMOTE_PUFF_HOLD);
      el.style.transform =
        `translate3d(${(ox + x).toFixed(1)}px, ${(oy + y).toFixed(1)}px, 0) translate(-50%, -50%) rotate(${rot.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
      el.style.opacity = opacity.toFixed(3);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [tagRef]);

  return (
    <Box
      ref={ref}
      className={`iw-actor-tag__emote-puff iw-actor-tag__emote-puff--${emote}`}
      aria-hidden
      sx={{
        position: 'absolute', top: 0, left: 0,
        fontSize: EMOTE_PUFF_PX, lineHeight: 1,
        pointerEvents: 'none',
        // Hidden until the first frame has placed it, so it never flashes at the tag's corner.
        opacity: 0,
        willChange: 'transform, opacity',
      }}
    >
      {EMOTE_EMOJI[emote]}
    </Box>
  );
}
