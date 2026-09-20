import React from 'react';
import { Tooltip } from '@mui/material';
import { HeaderCycleChip } from '../../../components/PageHeader';
import { cycleChipWidthCh } from '../../../components/cycleChipSizing';
import { IW_VOLUMES, type IWVolume } from '../../../../server/contracts/iw';

/**
 * The § 4c volume chip — ONE control that reaches all three volumes by tapping.
 *
 * LAYER: feature (presentational). Rendered by `IWComposer`; the composer owns the state,
 * because the volume belongs to the utterance being written rather than to the session.
 *
 * ⚠️ **IT IS `HeaderCycleChip`, THE SAME CONTROL AS THE AUDIO-MODE CHIP** (`AudioModeChip`,
 * docs/AUDIO_PLAYBACK.md), and the reuse is the point rather than a convenience. This is the
 * app's established answer to "a setting with three states that has to fit on a phone": one
 * word saying which state is live, one tap to advance, fixed width so nothing shuffles under
 * the thumb. A second visual language for the same shape would make the learner work out
 * twice that a control cycles.
 *
 * ⚠️ **THIS REPLACES A THREE-BUTTON SEGMENTED GROUP**, which was built first and was wrong on
 * width before it was wrong on anything else: three labelled buttons plus the assist toggle,
 * the field and send do not fit a 360px row without the field collapsing to nothing. A cycle
 * chip is one label wide whatever the state count.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 4c, § 9a.
 */

/**
 * How each volume presents: a glyph from the volume family, one word, and the reach.
 *
 * The labels are the vocabulary § 4c's banners use back at the learner ("A whisper only
 * reaches whoever you are standing in front of"), one for one — the AudioModeChip lesson,
 * where labels shortened to save width forced the learner to re-derive which state they were
 * looking at. One vocabulary, everywhere.
 *
 * ⚠️ THE GLYPH NAMES ARE MATERIAL **SYMBOLS**, and a name absent from that face renders as
 * its own raw uppercase text inside the chip (see `src/components/Icon.tsx`; it has bitten
 * this component family once already). All three names below were checked against
 * https://fonts.google.com/metadata/icons on 2026-09-07 rather than recalled, which is what
 * that header asks for. They are the three-step ramp of one family, so the chip is legible as
 * a loudness control before its label is read.
 *
 * `ariaLabel` carries the reach AND what the tap does, since a screen reader gets neither the
 * glyph nor any hint that the control cycles.
 */
const VOLUME_CHIP: Record<IWVolume, {
  icon: string;
  label: string;
  hint: string;
  ariaLabel: string;
  /**
   * Whether this state is a DEPARTURE from an ordinary speaking voice — it drives the chip's
   * ink/grey inversion. `talk` is how the scene behaved before volumes existed, so it reads
   * as the resting state; whisper and shout light up, because a learner who has left the
   * default needs to see that at a glance before they send the next line into the wrong room.
   */
  active: boolean;
}> = {
  whisper: {
    icon: 'volume_mute',
    label: 'whisper',
    hint: 'Whisper — only whoever you are standing directly in front of will hear it',
    ariaLabel: 'Whispering — only whoever you stand in front of hears it. Activate for a normal voice.',
    active: true,
  },
  talk: {
    icon: 'volume_down',
    label: 'say',
    hint: 'Normal voice — anybody nearby will hear it',
    ariaLabel: 'Normal voice — anybody nearby hears it. Activate to shout.',
    active: false,
  },
  shout: {
    icon: 'volume_up',
    label: 'shout',
    hint: 'Shout — everybody in the scene will hear it, however far away',
    ariaLabel: 'Shouting — everybody in the scene hears it. Activate to whisper.',
    active: true,
  },
};

/**
 * Every state renders at the width of the LONGEST label, so the chip does not resize as it
 * cycles and the text field beside it holds still under the tapping thumb. Derived from the
 * table rather than hard-coded, so renaming or adding a volume resizes the chip instead of
 * silently reintroducing the jump.
 */
const VOLUME_LABEL_WIDTH_CH = cycleChipWidthCh(Object.values(VOLUME_CHIP).map(v => v.label));

/**
 * ⚠️ **`whisper` renders SMALLER than the other two, and the chip does not.** Seven characters
 * would otherwise size all three states — this chip sits in a writing row rather than a header,
 * so the width it takes comes straight out of the text field the learner is actually using.
 * `HeaderCycleChip` shrinks only the long word (`cycleChipFontPx`) and `cycleChipWidthCh`
 * measures the chip at what that word actually occupies, so `say` and `shout` stay full size.
 *
 * Shrinking the type rather than the words is deliberate: abbreviating ("whisp") or dropping to
 * bare icons both hand the learner back the question this control exists to answer at a glance.
 */

/**
 * The cycle order is the loudness ramp — whisper → say → shout → whisper.
 *
 * Derived from `IW_VOLUMES` rather than written out, so the contract's order IS the tap
 * order and the two cannot drift. It matters that it is a ramp: a learner who overshoots
 * knows which way to keep going, which is not true of an arbitrary rotation.
 */
function nextVolume(current: IWVolume): IWVolume {
  const at = IW_VOLUMES.indexOf(current);
  return IW_VOLUMES[(at + 1) % IW_VOLUMES.length];
}

const IWVolumeChip: React.FC<{
  volume: IWVolume;
  onChange(next: IWVolume): void;
  className?: string;
}> = ({ volume, onChange, className }) => {
  const chip = VOLUME_CHIP[volume];
  return (
    <Tooltip title={chip.hint}>
      <span>
        <HeaderCycleChip
          // The state rides in the class as well as the label, so a surrounding surface can
          // restyle one volume without reaching into this file.
          className={['iw-composer__volume', `iw-composer__volume--${volume}`, className ?? '']
            .filter(Boolean).join(' ')}
          active={chip.active}
          widthCh={VOLUME_LABEL_WIDTH_CH}
          icon={chip.icon}
          ariaLabel={chip.ariaLabel}
          onClick={() => onChange(nextVolume(volume))}
        >
          {chip.label}
        </HeaderCycleChip>
      </span>
    </Tooltip>
  );
};

export default IWVolumeChip;
