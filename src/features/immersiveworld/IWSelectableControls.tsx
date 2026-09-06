import {
  Checkbox, Chip, FormControlLabel, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import {
  IW_MAX_UNLOCK_CUES, type IWSelectable,
} from '../../../server/contracts/iw';
import { IW_WARNING_TEXT_SX, warningFieldProps, type IWWarningsByField } from './iwSceneWarnings';

/**
 * IWSelectableControls — the three fields shared by everything a model may CHOOSE: an NPC's
 * authored action, and a selectable overheard conversation
 * (docs/IMMERSIVE_WORLD.md § 14 Q42, § 14 Q44).
 *
 * LAYER: feature view, stateless. It renders `IWSelectable` — `when`, `urgent`, `unlockedBy` —
 * and nothing else, so the two panels that own those fields cannot drift apart in wording,
 * layout or warning marking.
 *
 * ⚠️ IT DOES NOT RENDER THE PER-TYPE FLAG. An action's `interactionOnly` and a conversation's
 * `selectable` are mirror images with opposite polarity (see the contract), so putting both
 * behind one prop would mean a component that flips the meaning of a checkbox based on who
 * called it. Each panel draws its own, right where the difference is visible.
 *
 * THE CUE PICKER IS A MULTI-SELECT OVER ONE MERGED LIST of the scene's complications and
 * events, because "has this happened yet" is the same question about both and an author
 * choosing a gate is not thinking about which list the cue was typed into. The two are still
 * LABELLED apart in the dropdown, since a complication is drawn at random and an event is
 * scheduled — which is exactly the thing that decides whether a gate ever opens.
 */

/** One choosable cue: a complication or an event, flattened for the picker. */
export interface IWCueOption {
  id: string;
  description: string;
  kind: 'complication' | 'event';
}

export interface IWSelectableControlsProps {
  value: IWSelectable;
  /** Field-path prefix for warnings, e.g. `npcCast[0].actions[2]` or `conversations[1]`. */
  at: string;
  problemsByField: IWWarningsByField;
  cues: IWCueOption[];
  /** Placeholder for `when` — the register differs between an action and a conversation. */
  whenLabel: string;
  /** Tooltip-ish hint under `urgent`, in the caller's own terms. */
  urgentHint: string;
  onChange: (patch: Partial<IWSelectable>) => void;
  /**
   * Grey the whole group out. Set when the caller's own flag has already taken this thing off
   * the model's list (an interaction-only action), so the fields read as inert rather than as
   * settings that quietly do nothing.
   */
  disabled?: boolean;
}

export default function IWSelectableControls({
  value, at, problemsByField, cues, whenLabel, urgentHint, onChange, disabled = false,
}: IWSelectableControlsProps) {
  const warn = (field: string) => warningFieldProps(problemsByField, field);
  const problem = (field: string) => problemsByField.get(field);
  const chosen = value.unlockedBy ?? [];
  /** Only cues that still exist — a deleted one must not keep a dead chip on screen. */
  const live = chosen.filter((id) => cues.some((c) => c.id === id));

  return (
    <Stack spacing={1} sx={{ mt: 1, opacity: disabled ? 0.45 : 1 }} className="iw-selectable-controls">
      <TextField
        size="small" label={whenLabel} fullWidth disabled={disabled}
        value={value.when ?? ''}
        {...warn(`${at}.when`)}
        onChange={(e) => onChange({ when: e.target.value })}
      />

      <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap">
        <FormControlLabel
          className="iw-selectable-controls__urgent"
          control={
            <Checkbox
              size="small" disabled={disabled}
              checked={!!value.urgent}
              onChange={(e) => onChange({ urgent: e.target.checked || undefined })}
            />
          }
          label={<Typography sx={{ fontSize: 11 }}>urgent</Typography>}
        />
        {/* The cue picker is hidden entirely when the scene has no complications or events:
            an empty multi-select is a control that can only frustrate, and the author's real
            next step is to go and write a cue. */}
        {cues.length > 0 && (
          <TextField
            size="small" select fullWidth sx={{ minWidth: 200, flex: 1 }} disabled={disabled}
            label="Only after (optional)"
            value={live}
            {...warn(`${at}.unlockedBy`)}
            slotProps={{
              select: {
                multiple: true,
                renderValue: (selected) => (
                  <Stack direction="row" spacing={0.5} flexWrap="wrap">
                    {(selected as string[]).map((id) => (
                      <Chip key={id} label={id} size="small" sx={{ height: 18, fontSize: 10 }} />
                    ))}
                  </Stack>
                ),
              },
            }}
            onChange={(e) => {
              const next = (
                typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value
              ) as string[];
              // Store `undefined` rather than `[]` for "no gate", so an untouched action's
              // payload is byte-identical to what it was before this field existed.
              onChange({ unlockedBy: next.length ? next.slice(0, IW_MAX_UNLOCK_CUES) : undefined });
            }}
          >
            {cues.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                <Typography sx={{ fontSize: 12 }}>
                  {c.kind === 'event' ? '⏱ ' : '⚡ '}
                  {c.description || c.id}
                </Typography>
              </MenuItem>
            ))}
          </TextField>
        )}
      </Stack>

      <Typography sx={{ fontSize: 10, opacity: 0.6 }}>{urgentHint}</Typography>
      {problem(`${at}.unlockedBy`) && (
        <Typography sx={{ ...IW_WARNING_TEXT_SX, fontSize: 11 }}>
          {problem(`${at}.unlockedBy`)}
        </Typography>
      )}
    </Stack>
  );
}
