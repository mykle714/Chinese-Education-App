import { Box, Button, Checkbox, FormControlLabel, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { COLORS } from '../../theme/colors';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { IW_CONVERSATION_LINE_MS, IW_MAX_EVENT_DELAY_SECONDS } from '../../../server/contracts/iw';
import type {
  IWComplication, IWConversation, IWNpcOption, IWScene, IWSceneEvent,
} from '../../../server/contracts/iw';
import { IW_WARNING_TEXT_SX, warningFieldProps } from './iwSceneWarnings';
import IWSelectableControls, { type IWCueOption } from './IWSelectableControls';
import { iwZebraItemSx, iwZebraNestedItemSx } from './iwListZebra';

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
 *    The cast may speak in one, and so may the companion — he is on the board in every
 *    scene, so the learner can overhear him talking to an NPC.
 *
 * ⚠️ There was a third list, **essential words**, removed on 2026-09-05 as out of spec.
 * § 9.4's point 3 went with it: the model's vocabulary guidance is now the learner's level
 * and the learner's own library, with nothing authored per scene.
 */

export interface IWSceneContentPanelProps {
  scene: IWScene;
  npcs: IWNpcOption[];
  problemsByField: Map<string, string>;
  /** The scene's complications and events, merged — what a conversation's gate may name. */
  cues: IWCueOption[];
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
  scene, npcs, problemsByField, cues, onUpdate,
}: IWSceneContentPanelProps) {
  /** Amber marking props for one field. Warnings do not refuse a save, so they do not
   *  paint like errors — see `iwSceneWarnings.ts`. */
  const warn = (field: string) => warningFieldProps(problemsByField, field);
  const problem = (field: string) => problemsByField.get(field);
  const npcName = (npcId: string) => npcs.find((n) => n.id === npcId)?.name ?? npcId;

  /**
   * Who may speak a line in an overheard conversation: THE CAST, plus THE COMPANION.
   * The companion is not castable — he is placed by the scene's own companion start cell
   * rather than by a cast entry — but he stands on the board in every scene, so an authored
   * exchange between him and a cast member is one the learner can walk up on like any
   * other. He is appended last so the cast keeps its authored order in the dropdown.
   * The server enforces the same set; see `sceneValidation.ts` → `validateConversations`.
   */
  const companionId = npcs.find((n) => n.isCompanion)?.id;
  const speakers = [
    ...scene.npcCast.map((m) => m.npcId),
    ...(companionId ? [companionId] : []),
  ];

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
  /**
   * ⚠️ THE CHECKBOX ARMS A TIMER, IT DOES NOT FIRE THE EVENT (label corrected 2026-09-06).
   * It used to read "at scene open" beside a box labelled "seconds", which an author can only
   * read as *this happens when the scene opens* — the delay then looking like a detail. What
   * it actually means is *the scene arms this the moment it opens, and it comes due N seconds
   * later*, which is the same earliest-legal-moment semantics a `schedule_event` step has.
   * Hence "schedule at scene open" + "after (s)". No field changed; `atStartSeconds` already
   * did exactly this.
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
            <Stack
              key={complication.id}
              className="iw-scene-content-panel__complication-row"
              direction="row" spacing={1} alignItems="flex-start"
              sx={iwZebraItemSx(i)}
            >
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
            <Stack
              key={event.id}
              className="iw-scene-content-panel__event-row"
              direction="row" spacing={1} alignItems="flex-start"
              sx={iwZebraItemSx(i)}
            >
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
                    label={<Typography sx={{ fontSize: 11 }}>schedule at scene open</Typography>}
                  />
                  {event.atStartSeconds !== undefined && (
                    <TextField
                      className="iw-scene-content-panel__event-delay"
                      size="small" type="number" label="after (s)" sx={{ width: 110 }}
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
          tap to pause, so this is a study surface as much as ambience. Tick the box on one and
          its FIRST speaker may also start it unprompted, the way they pick an action. Every
          line is held for{' '}
          {IW_CONVERSATION_LINE_MS / 1000} seconds — pacing is not authored, so write lines a
          learner can read in that time.
        </Typography>

        <Stack spacing={2}>
          {scene.conversations.map((conv, i) => (
            <Box
              key={conv.id}
              className="iw-scene-content-panel__conversation"
              // Zebra ground + the outline it already had. The turns inside stripe as well,
              // restarting at white so the first one merges with this ground.
              sx={{ ...iwZebraItemSx(i), border: `1px solid ${COLORS.border}`, p: 1.5 }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small" fullWidth
                  // The label changes with `selectable`, because the field's AUDIENCE does:
                  // for a choosable conversation the title is what the NPC picks it by, so
                  // calling it "for you, never shown" would be actively wrong.
                  label={conv.selectable
                    ? 'Title — the NPC chooses it by this'
                    : 'Title (for you, never shown)'}
                  value={conv.title ?? ''}
                  {...warn(`conversations[${i}].title`)}
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

              {/* ── Can the first speaker start this on their own? (2026-09-06) ──
                  Opt-IN, unlike an action's opt-OUT `interactionOnly`: every conversation
                  authored before this existed was script-only, and flipping them all to
                  spontaneous would change what those scenes do. */}
              <FormControlLabel
                className="iw-scene-content-panel__conversation-selectable"
                control={
                  <Checkbox
                    size="small"
                    checked={!!conv.selectable}
                    onChange={(e) => patchConversation(i, { selectable: e.target.checked || undefined })}
                  />
                }
                label={(
                  <Typography sx={{ fontSize: 11 }}>
                    {conv.turns[0]?.npcId
                      ? `${npcName(conv.turns[0].npcId)} may start this when the moment suits`
                      : 'whoever speaks first may start this when the moment suits'}
                  </Typography>
                )}
              />
              {problem(`conversations[${i}].selectable`) && (
                <Typography sx={{ ...IW_WARNING_TEXT_SX, fontSize: 11 }}>
                  {problem(`conversations[${i}].selectable`)}
                </Typography>
              )}

              {/* The same three fields an action has — rendered only once the conversation is
                  choosable, since `when`/urgency/gating are all about being CHOSEN and mean
                  nothing for one a script fires. */}
              {conv.selectable && (
                <IWSelectableControls
                  value={conv}
                  at={`conversations[${i}]`}
                  problemsByField={problemsByField}
                  cues={cues}
                  whenLabel="When it fits (optional)"
                  urgentHint="Urgent leans the first speaker toward starting this when nothing more pressing is happening. It still yields to the learner."
                  onChange={(patch) => patchConversation(i, patch)}
                />
              )}

              <Stack spacing={1} sx={{ mt: 1.5 }}>
                {conv.turns.map((turn, t) => (
                  <Stack
                    key={t}
                    direction="row" spacing={1} alignItems="flex-start"
                    className="iw-scene-content-panel__turn"
                    sx={iwZebraNestedItemSx(t)}
                  >
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
