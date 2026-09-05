import { Box, Button, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { COLORS } from '../../theme/colors';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { IW_CONVERSATION_LINE_MS } from '../../../server/contracts/iw';
import type {
  IWComplication, IWConversation, IWNpcOption, IWScene,
} from '../../../server/contracts/iw';

/**
 * IWSceneContentPanel — the two authored LISTS a scene carries besides its cast:
 * complications and NPC-to-NPC conversations (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * LAYER: feature view. Stateless; every edit is a patch back to the draft.
 *
 * WHAT EACH LIST IS FOR, because they are easy to confuse:
 *  - **Complications** are ENVIRONMENTAL (§ 14 Q31). Each turn carries a 20% chance that one
 *    fires, and it is then drawn from this pool — so a run can have several, and a pool of
 *    one just repeats itself. Everyone present reacts in character; they belong to the
 *    world, not to an NPC, which is why nothing here asks who owns one. They are also the
 *    only thing making day 12 different from day 11 in a once-per-day feature.
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
  const problem = (field: string) => problemsByField.get(field);
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
        <Typography sx={{ fontSize: 12, opacity: 0.7, mb: 1 }}>
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
                error={!!problem(`complications[${i}].description`)}
                helperText={problem(`complications[${i}].description`)}
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
        <Typography sx={{ fontSize: 12, opacity: 0.7, mb: 1 }}>
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
                      error={!!problem(`conversations[${i}].turns[${t}].npcId`)}
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
                      error={!!problem(`conversations[${i}].turns[${t}].text`)}
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
