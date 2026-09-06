import { Box, Button, Checkbox, FormControlLabel, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { COLORS } from '../../theme/colors';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { IW_CONVERSATION_LINE_MS, IW_MAX_EVENT_DELAY_SECONDS } from '../../../server/contracts/iw';
import type {
  IWComplication, IWConversation, IWNpcOption, IWScene, IWSceneEvent,
} from '../../../server/contracts/iw';
import { warningFieldProps } from './iwSceneWarnings';

/**
 * IWSceneContentPanel — the three authored LISTS a scene carries besides its cast:
 * complications, events and NPC-to-NPC conversations (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * LAYER: feature view. Stateless; every edit is a patch back to the draft.
 *
 * WHAT EACH LIST IS FOR, because they are easy to confuse:
 *  - **Complications** are ENVIRONMENTAL (§ 14 Q31). Each turn carries a 20% chance that one
 *    fires, and it is then drawn from this pool — so a run can have several, and a pool of
 *    one just repeats itself. Everyone present reacts in character; they belong to the
 *    world, not to an NPC, which is why nothing here asks who owns one. They are also the
 *    only thing making day 12 different from day 11 in a once-per-day feature.
 *  - **Events** (migration 161) are the SAME KIND OF FACT as a complication — one line, the
 *    world's, everyone present reacts in character — with a different trigger. A complication
 *    is drawn at random; an event is SCHEDULED: by a `Schedule event` step inside an authored
 *    action, or by the event's own "at scene open" delay. That is the whole difference, and it
 *    is why they are two lists: the random roll must never spring an authored beat before its
 *    cue, and a script must never be able to arm the surprise.
 *  - **Conversations** are canned, pre-reviewed exchanges the learner can OVERHEAR and tap
 *    to pause (§ 14 Q6). They cost nothing per line because no model call is made for them.
 *    Only cast members may speak in one — never the companion, who walks in with the
 *    learner and so is never overheard.
 *
 * ⚠️ There was a third list, **essential words**, removed on 2026-09-05 as out of spec.
 * § 9.4's point 3 went with it: the model's vocabulary guidance is now the learner's level
 * and the learner's own library, with nothing authored per scene.
 */

export interface IWSceneContentPanelProps {
  scene: IWScene;
  npcs: IWNpcOption[];
  problemsByField: Map<string, string>;
  onUpdate: (patch: Partial<IWScene>) => void;
}

/** A short, stable, human-legible id — the author never types one. */
function makeId(prefix: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!taken.has(id)) return id;
  }
}

export default function IWSceneContentPanel({
  scene, npcs, problemsByField, onUpdate,
}: IWSceneContentPanelProps) {
  /** Amber marking props for one field. Warnings do not refuse a save, so they do not
   *  paint like errors — see `iwSceneWarnings.ts`. */
  const warn = (field: string) => warningFieldProps(problemsByField, field);
  const npcName = (npcId: string) => npcs.find((n) => n.id === npcId)?.name ?? npcId;

  /**
   * Who may speak a line in an overheard conversation: THE CAST, and nobody else.
   * The companion is deliberately absent — he walks in with the learner, so he is never a
   * voice the learner OVERHEARS; an exchange he is part of is one he is having, which is the
   * live NPC path rather than this authored playback. He is also not castable at all. The
   * server enforces the same rule; see `sceneValidation.ts` → `validateConversations`.
   */
  const speakers = scene.npcCast.map((m) => m.npcId);

  // ── Complications ─────────────────────────────────────────────────────────
  const patchComplication = (i: number, patch: Partial<IWComplication>) => {
    const next = scene.complications.map((c, j) => (j === i ? { ...c, ...patch } : c));
    onUpdate({ complications: next });
  };
  const addComplication = () => onUpdate({
    complications: [
      ...scene.complications,
      { id: makeId('c', new Set(scene.complications.map((c) => c.id))), description: '' },
    ],
  });

  // ── Events (migration 161) ────────────────────────────────────────────────
  const patchEvent = (i: number, patch: Partial<IWSceneEvent>) => {
    onUpdate({ events: scene.events.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  };
  const addEvent = () => onUpdate({
    events: [
      ...scene.events,
      { id: makeId('e', new Set(scene.events.map((e) => e.id))), description: '' },
    ],
  });
  /**
   * Toggle "at scene open". UNDEFINED, not 0, is the off state: 0 is a meaningful value
   * (fire at the first legal moment), so the checkbox has to add and remove the field rather
   * than write a sentinel number into it.
   */
  const toggleAtStart = (i: number, on: boolean) => {
    const next = scene.events.map((e, j) => {
      if (j !== i) return e;
      if (!on) {
        // Delete the key rather than zeroing it — see the doc comment above.
        const rest = { ...e };
        delete rest.atStartSeconds;
        return rest;
      }
      return { ...e, atStartSeconds: e.atStartSeconds ?? 10 };
    });
    onUpdate({ events: next });
  };

  // ── Conversations ─────────────────────────────────────────────────────────
  const patchConversation = (i: number, patch: Partial<IWConversation>) => {
    onUpdate({ conversations: scene.conversations.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  };
  const addConversation = () => onUpdate({
    conversations: [
      ...scene.conversations,
      { id: makeId('conv', new Set(scene.conversations.map((c) => c.id))), title: '', turns: [] },
    ],
  });

  return (
    <Box className="iw-scene-content-panel">
      {/* ── Complications ── */}
      <Box className="iw-scene-content-panel__complications" sx={{ mb: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="overline">Complications</Typography>
          <Button size="small" startIcon={<AddIcon />} onClick={addComplication}>Add</Button>
        </Stack>
        <Typography sx={{ fontSize: 11, opacity: 0.7, mb: 1 }}>
          Something that happens to the WORLD — the rain starts, a queue forms, the order
          arrives wrong. One is drawn per run; everyone present reacts in character.
        </Typography>
        <Stack spacing={1}>
          {scene.complications.map((complication, i) => (
            <Stack key={complication.id} direction="row" spacing={1} alignItems="flex-start">
              <TextField
                className="iw-scene-content-panel__complication"
                size="small" fullWidth multiline
                label={`Complication ${complication.id}`}
                value={complication.description}
                {...warn(`complications[${i}].description`)}
                onChange={(e) => patchComplication(i, { description: e.target.value })}
              />
              <IconButton
                size="small"
                title="Remove"
                onClick={() => onUpdate({ complications: scene.complications.filter((_, j) => j !== i) })}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
        </Stack>
      </Box>

      {/* ── Events ── */}
      <Box className="iw-scene-content-panel__events" sx={{ mb: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="overline">Events</Typography>
          <Button size="small" startIcon={<AddIcon />} onClick={addEvent}>Add</Button>
        </Stack>
        <Typography sx={{ fontSize: 11, opacity: 0.7, mb: 1 }}>
          The same kind of world fact as a complication — but SCHEDULED, never drawn. An action
          arms one with a “Schedule event” step, or tick “at scene open” to arm it as the scene
          begins. The engine fires it at the next legal moment, never while the learner is
          answering.
        </Typography>
        <Stack spacing={1}>
          {scene.events.map((event, i) => (
            <Stack key={event.id} direction="row" spacing={1} alignItems="flex-start">
              <Stack spacing={0.5} sx={{ flex: 1 }}>
                <TextField
                  className="iw-scene-content-panel__event"
                  size="small" fullWidth multiline
                  label={`Event ${event.id}`}
                  placeholder="The kitchen sends out the noodles."
                  value={event.description}
                  {...warn(`events[${i}].description`)}
                  onChange={(e) => patchEvent(i, { description: e.target.value })}
                />
                <Stack direction="row" spacing={1} alignItems="center">
                  <FormControlLabel
                    className="iw-scene-content-panel__event-at-start"
                    control={
                      <Checkbox
                        size="small"
                        checked={event.atStartSeconds !== undefined}
                        onChange={(e) => toggleAtStart(i, e.target.checked)}
                      />
                    }
                    label={<Typography sx={{ fontSize: 11 }}>at scene open</Typography>}
                  />
                  {event.atStartSeconds !== undefined && (
                    <TextField
                      className="iw-scene-content-panel__event-delay"
                      size="small" type="number" label="seconds" sx={{ width: 110 }}
                      inputProps={{ min: 0, max: IW_MAX_EVENT_DELAY_SECONDS }}
                      value={event.atStartSeconds}
                      {...warn(`events[${i}].atStartSeconds`)}
                      onChange={(e) => patchEvent(i, { atStartSeconds: Number(e.target.value) })}
                    />
                  )}
                </Stack>
              </Stack>
              <IconButton
                size="small"
                title="Remove"
                onClick={() => onUpdate({ events: scene.events.filter((_, j) => j !== i) })}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
        </Stack>
      </Box>

      {/* ── Overheard conversations ── */}
      <Box className="iw-scene-content-panel__conversations">
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="overline">Overheard conversations</Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={addConversation}
            // Two people are needed to overhear an exchange between them — but one cast
            // member is enough to START authoring one, and the validator is what insists on
            // a speaker per line.
            disabled={speakers.length < 1}
          >
            Add
          </Button>
        </Stack>
        <Typography sx={{ fontSize: 11, opacity: 0.7, mb: 1 }}>
          Fixed lines between cast members, played back with no model calls. The learner can
          tap to pause, so this is a study surface as much as ambience. Every line is held for{' '}
          {IW_CONVERSATION_LINE_MS / 1000} seconds — pacing is not authored, so write lines a
          learner can read in that time.
        </Typography>

        <Stack spacing={2}>
          {scene.conversations.map((conv, i) => (
            <Box
              key={conv.id}
              className="iw-scene-content-panel__conversation"
              sx={{ border: `1px solid ${COLORS.border}`, borderRadius: 1, p: 1.5 }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small" label="Title (for you, never shown)" fullWidth
                  value={conv.title ?? ''}
                  onChange={(e) => patchConversation(i, { title: e.target.value })}
                />
                <IconButton
                  size="small"
                  title="Remove conversation"
                  onClick={() => onUpdate({ conversations: scene.conversations.filter((_, j) => j !== i) })}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>

              <Stack spacing={1} sx={{ mt: 1.5 }}>
                {conv.turns.map((turn, t) => (
                  <Stack key={t} direction="row" spacing={1} alignItems="flex-start">
                    <TextField
                      size="small" select label="Who" sx={{ width: 130 }}
                      value={speakers.includes(turn.npcId) ? turn.npcId : ''}
                      {...warn(`conversations[${i}].turns[${t}].npcId`)}
                      onChange={(e) => patchConversation(i, {
                        turns: conv.turns.map((x, j) => (j === t ? { ...x, npcId: e.target.value } : x)),
                      })}
                    >
                      {speakers.map((npcId) => (
                        <MenuItem key={npcId} value={npcId}>{npcName(npcId)}</MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      size="small" label="Line" fullWidth
                      value={turn.text}
                      {...warn(`conversations[${i}].turns[${t}].text`)}
                      onChange={(e) => patchConversation(i, {
                        turns: conv.turns.map((x, j) => (j === t ? { ...x, text: e.target.value } : x)),
                      })}
                    />
                    <IconButton
                      size="small"
                      title="Remove line"
                      onClick={() => patchConversation(i, { turns: conv.turns.filter((_, j) => j !== t) })}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  disabled={speakers.length === 0}
                  onClick={() => patchConversation(i, {
                    // A new line starts with NO speaker: who says it is the author's first
                    // decision, and pre-filling the first cast member quietly makes it for
                    // them. The empty value is a save error until they choose.
                    turns: [...conv.turns, { npcId: '', text: '' }],
                  })}
                >
                  Add line
                </Button>
              </Stack>
            </Box>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}
