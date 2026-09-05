import { useState } from 'react';
import {
  Box, Button, IconButton, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import PlaceIcon from '@mui/icons-material/Place';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import {
  IW_ACTION_STEP_KINDS, IW_ACTION_STEP_LABELS, IW_ACTOR_COMPANION, IW_ACTOR_PLAYER,
  IW_MAX_ACTION_STEPS, IW_MAX_WAIT_SECONDS, isActorStep, isActorStepKind,
  type IWActionStep, type IWActionStepKind,
  type IWNpcAction, type IWNpcOption, type IWScene,
} from '../../../server/contracts/iw';
import { isUnplacedLocationKey } from './useIWSceneDraft';

/**
 * IWSceneActionsPanel — named PLACES and per-NPC authored ACTIONS
 * (docs/IMMERSIVE_WORLD.md § 14 Q42, § 12 phase 1d).
 *
 * LAYER: feature view. Stateless apart from the two "new thing" text inputs, which are
 * local because a half-typed name is not part of the scene until it is committed.
 *
 * THE DIVISION OF LABOUR THIS PANEL EXISTS TO EXPRESS: the model decides **whether** the
 * moment calls for "bring water"; the author decides exactly **what bringing water looks
 * like**. So an action has a NAME the model chooses by, optional guidance on when it fits,
 * and a SCRIPT the engine plays verbatim. The model never improvises movement, and the
 * author never has to anticipate when water is wanted.
 *
 * ⚠️ ONE STEP IS NOT MECHANICAL. `comment` is a BRIEF, not a line: the NPC says a variation
 * of it in its own register, so the same step sounds like 王婶 or like 小陈. Every other
 * step kind is executed exactly as written.
 *
 * PLACES ARE NAMED FIRST, PLACED SECOND. A tag exists as soon as it is named — the map
 * palette then grows a button for it, and clicking cells tags them. Several cells may share
 * a name and `walk_to_tag` heads for the nearest, which is why placing ADDS a cell rather
 * than moving the tag.
 */

export interface IWSceneActionsPanelProps {
  scene: IWScene;
  npcs: IWNpcOption[];
  /** "col,row" → tag, plus `unplaced:` keys for named-but-unplaced tags. */
  locations: Record<string, string>;
  problemsByField: Map<string, string>;
  onAddLocation: (tag: string) => void;
  onRenameLocation: (from: string, to: string) => void;
  onRemoveLocation: (tag: string) => void;
  /** Arm the map's place tool for this tag. */
  onPlaceLocation: (tag: string) => void;
  onAddAction: (npcId: string) => void;
  onUpdateAction: (npcId: string, actionId: string, patch: Partial<IWNpcAction>) => void;
  onRemoveAction: (npcId: string, actionId: string) => void;
}

/** A fresh step of the chosen kind. Switching kind REPLACES the step — the union demands it. */
function blankStep(kind: IWActionStepKind): IWActionStep {
  if (isActorStepKind(kind)) return { kind, actor: IW_ACTOR_PLAYER };
  switch (kind) {
    case 'comment': return { kind, text: '' };
    case 'walk_to_tag': return { kind, tag: '' };
    case 'start_conversation': return { kind, conversationId: '' };
    case 'wait': return { kind, seconds: 2 };
    case 'wait_for_response': return { kind };
  }
}

export default function IWSceneActionsPanel({
  scene, npcs, locations, problemsByField,
  onAddLocation, onRenameLocation, onRemoveLocation, onPlaceLocation,
  onAddAction, onUpdateAction, onRemoveAction,
}: IWSceneActionsPanelProps) {
  const problem = (field: string) => problemsByField.get(field);
  const npcName = (npcId: string) => npcs.find((n) => n.id === npcId)?.name ?? npcId;
  const [newTag, setNewTag] = useState('');

  /** Each distinct tag with how many cells carry it — 0 means named but never placed. */
  const tags = [...new Set(Object.values(locations))].sort().map((tag) => ({
    tag,
    cells: Object.entries(locations)
      .filter(([cell, t]) => t === tag && !isUnplacedLocationKey(cell))
      .map(([cell]) => cell),
  }));

  /** Who a `walk_to_actor` step may target: the two fixed bodies plus the cast. */
  const actorOptions = [
    { id: IW_ACTOR_PLAYER, label: 'the learner' },
    { id: IW_ACTOR_COMPANION, label: 'the companion' },
    ...scene.npcCast.map((m) => ({ id: m.npcId, label: npcName(m.npcId) })),
  ];

  const commitTag = () => {
    const clean = newTag.trim();
    if (!clean) return;
    onAddLocation(clean);
    setNewTag('');
  };

  /** Replace one step of one action, keeping every other step untouched. */
  const patchStep = (
    npcId: string, action: IWNpcAction, index: number, next: IWActionStep,
  ) => onUpdateAction(npcId, action.id, {
    steps: action.steps.map((s, i) => (i === index ? next : s)),
  });

  /** Move a step one slot up or down. Order IS the script, so this is a primary control. */
  const moveStep = (npcId: string, action: IWNpcAction, index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= action.steps.length) return;
    const steps = [...action.steps];
    [steps[index], steps[to]] = [steps[to], steps[index]];
    onUpdateAction(npcId, action.id, { steps });
  };

  return (
    <Box className="iw-scene-actions-panel">
      {/* ── Named places ─────────────────────────────────────────────────── */}
      <Box className="iw-scene-actions-panel__places" sx={{ mb: 3 }}>
        <Typography variant="overline">Places</Typography>
        <Typography sx={{ fontSize: 12, opacity: 0.7, mb: 1 }}>
          Name a spot on the board so an action can send somebody to it. Name it here, then
          tag cells with the matching map tool — several cells may share one name, and a walk
          heads for the nearest.
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <TextField
            className="iw-scene-actions-panel__new-place"
            size="small" label="New place" fullWidth
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitTag(); } }}
          />
          <Button size="small" startIcon={<AddIcon />} onClick={commitTag} disabled={!newTag.trim()}>
            Add
          </Button>
        </Stack>
        {problem('layout.locations') && (
          <Typography color="error" sx={{ fontSize: 12, mb: 1 }}>{problem('layout.locations')}</Typography>
        )}

        <Stack spacing={1}>
          {tags.map(({ tag, cells }) => (
            <Stack key={tag} direction="row" spacing={1} alignItems="center" className="iw-scene-actions-panel__place">
              <TextField
                size="small" fullWidth
                value={tag}
                onChange={(e) => onRenameLocation(tag, e.target.value)}
                // A rename rewrites every step that walked here, so an author can fix a typo
                // without silently invalidating their own scripts.
                helperText={cells.length === 0
                  ? 'Named but not on the board yet — tag a cell with the map tool.'
                  : `${cells.length} cell${cells.length === 1 ? '' : 's'}: ${cells.join(' · ')}`}
                error={cells.length === 0}
              />
              <Tooltip title={`Tag cells as “${tag}”`}>
                <IconButton size="small" onClick={() => onPlaceLocation(tag)}>
                  <PlaceIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete this place and any step that walked to it">
                <IconButton size="small" onClick={() => onRemoveLocation(tag)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
          {tags.length === 0 && (
            <Typography sx={{ fontSize: 12, opacity: 0.6 }}>No places yet.</Typography>
          )}
        </Stack>
      </Box>

      {/* ── Per-NPC actions ──────────────────────────────────────────────── */}
      <Box className="iw-scene-actions-panel__actions">
        <Typography variant="overline">Actions</Typography>
        <Typography sx={{ fontSize: 12, opacity: 0.7, mb: 1 }}>
          What each NPC can be asked to do. The model picks one by name when the moment fits;
          the engine then plays your script exactly — except “Say”, which the NPC paraphrases
          in its own voice.
        </Typography>

        {scene.npcCast.length === 0 && (
          <Typography sx={{ fontSize: 12, opacity: 0.6 }}>Add an NPC to the cast first.</Typography>
        )}

        <Stack spacing={2}>
          {scene.npcCast.map((member, mi) => (
            <Box
              key={member.npcId}
              className="iw-scene-actions-panel__npc"
              sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{npcName(member.npcId)}</Typography>
                <Button size="small" startIcon={<AddIcon />} onClick={() => onAddAction(member.npcId)}>
                  Action
                </Button>
              </Stack>

              <Stack spacing={1.5} sx={{ mt: 1 }}>
                {(member.actions ?? []).map((action, ai) => {
                  const at = `npcCast[${mi}].actions[${ai}]`;
                  return (
                    <Box
                      key={action.id}
                      className="iw-scene-actions-panel__action"
                      sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 1, p: 1.25 }}
                    >
                      <Stack direction="row" spacing={1} alignItems="flex-start">
                        <TextField
                          size="small" label="The model chooses this by name" fullWidth
                          value={action.name}
                          error={!!problem(`${at}.name`)}
                          helperText={problem(`${at}.name`)}
                          onChange={(e) => onUpdateAction(member.npcId, action.id, { name: e.target.value })}
                        />
                        <IconButton
                          size="small" title="Delete this action"
                          onClick={() => onRemoveAction(member.npcId, action.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                      <TextField
                        size="small" label="When it fits (optional)" fullWidth sx={{ mt: 1 }}
                        value={action.when ?? ''}
                        error={!!problem(`${at}.when`)}
                        onChange={(e) => onUpdateAction(member.npcId, action.id, { when: e.target.value })}
                      />

                      {problem(`${at}.steps`) && (
                        <Typography color="error" sx={{ fontSize: 12, mt: 0.5 }}>
                          {problem(`${at}.steps`)}
                        </Typography>
                      )}

                      <Stack spacing={0.75} sx={{ mt: 1 }}>
                        {action.steps.map((step, si) => (
                          <Stack
                            key={si}
                            direction="row" spacing={0.75} alignItems="flex-start"
                            className="iw-scene-actions-panel__step"
                          >
                            <Typography sx={{ fontSize: 12, opacity: 0.5, width: 18, mt: 1.25 }}>
                              {si + 1}
                            </Typography>
                            <TextField
                              size="small" select sx={{ width: 130 }}
                              value={step.kind}
                              error={!!problem(`${at}.steps[${si}].kind`)}
                              onChange={(e) => patchStep(
                                member.npcId, action, si, blankStep(e.target.value as IWActionStepKind),
                              )}
                            >
                              {IW_ACTION_STEP_KINDS.map((k) => (
                                <MenuItem key={k} value={k}>{IW_ACTION_STEP_LABELS[k]}</MenuItem>
                              ))}
                            </TextField>

                            {step.kind === 'comment' && (
                              <TextField
                                size="small" fullWidth placeholder="Roughly what they say"
                                value={step.text}
                                error={!!problem(`${at}.steps[${si}].text`)}
                                helperText={problem(`${at}.steps[${si}].text`)}
                                onChange={(e) => patchStep(member.npcId, action, si, { kind: 'comment', text: e.target.value })}
                              />
                            )}

                            {step.kind === 'walk_to_tag' && (
                              <TextField
                                size="small" select fullWidth
                                value={tags.some((t) => t.tag === step.tag) ? step.tag : ''}
                                error={!!problem(`${at}.steps[${si}].tag`)}
                                helperText={problem(`${at}.steps[${si}].tag`)}
                                onChange={(e) => patchStep(member.npcId, action, si, { kind: 'walk_to_tag', tag: e.target.value })}
                              >
                                {tags.map(({ tag }) => <MenuItem key={tag} value={tag}>{tag}</MenuItem>)}
                              </TextField>
                            )}

                            {/* One control for all seven actor-aimed kinds — move toward or
                                away, turn to face, and the four transactional gestures. They
                                differ only in what the engine animates; the author is
                                answering the same question, *who*. */}
                            {isActorStep(step) && (
                              <TextField
                                size="small" select fullWidth
                                value={actorOptions.some((o) => o.id === step.actor) ? step.actor : ''}
                                error={!!problem(`${at}.steps[${si}].actor`)}
                                helperText={problem(`${at}.steps[${si}].actor`)}
                                onChange={(e) => patchStep(member.npcId, action, si, {
                                  kind: step.kind, actor: e.target.value,
                                })}
                              >
                                {actorOptions
                                  // Aiming at yourself is refused on save, and a walk to self
                                  // would deadlock — so it is not offered either.
                                  .filter((o) => o.id !== member.npcId)
                                  .map((o) => <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>)}
                              </TextField>
                            )}

                            {step.kind === 'start_conversation' && (
                              <TextField
                                size="small" select fullWidth
                                value={scene.conversations.some((c) => c.id === step.conversationId) ? step.conversationId : ''}
                                error={!!problem(`${at}.steps[${si}].conversationId`)}
                                helperText={problem(`${at}.steps[${si}].conversationId`)
                                  ?? (scene.conversations.length === 0 ? 'Author a conversation first.' : undefined)}
                                onChange={(e) => patchStep(member.npcId, action, si, {
                                  kind: 'start_conversation', conversationId: e.target.value,
                                })}
                              >
                                {scene.conversations.map((c) => (
                                  <MenuItem key={c.id} value={c.id}>{c.title?.trim() || c.id}</MenuItem>
                                ))}
                              </TextField>
                            )}

                            {step.kind === 'wait' && (
                              <TextField
                                size="small" type="number" sx={{ width: 110 }} label="seconds"
                                inputProps={{ min: 1, max: IW_MAX_WAIT_SECONDS }}
                                value={step.seconds}
                                error={!!problem(`${at}.steps[${si}].seconds`)}
                                onChange={(e) => patchStep(member.npcId, action, si, { kind: 'wait', seconds: Number(e.target.value) })}
                              />
                            )}

                            {step.kind === 'wait_for_response' && (
                              <Typography sx={{ fontSize: 12, opacity: 0.6, flex: 1, mt: 1.25 }}>
                                The NPC stops and waits — nothing runs while the learner answers.
                              </Typography>
                            )}

                            <IconButton size="small" title="Move up" onClick={() => moveStep(member.npcId, action, si, -1)}>
                              <ArrowUpwardIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" title="Move down" onClick={() => moveStep(member.npcId, action, si, 1)}>
                              <ArrowDownwardIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small" title="Remove step"
                              onClick={() => onUpdateAction(member.npcId, action.id, {
                                steps: action.steps.filter((_, i) => i !== si),
                              })}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        ))}

                        <Button
                          size="small" startIcon={<AddIcon />}
                          disabled={action.steps.length >= IW_MAX_ACTION_STEPS}
                          onClick={() => onUpdateAction(member.npcId, action.id, {
                            // New steps land BEFORE a trailing wait_for_response, which is
                            // almost always where the author means them to go — nothing may
                            // follow that step, so appending would immediately be invalid.
                            steps: insertBeforeTrailingWait(action.steps, { kind: 'wait', seconds: 2 }),
                          })}
                        >
                          Step
                        </Button>
                      </Stack>
                    </Box>
                  );
                })}
                {(member.actions ?? []).length === 0 && (
                  <Typography sx={{ fontSize: 12, opacity: 0.6 }}>
                    No actions — this NPC only talks.
                  </Typography>
                )}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

/**
 * Append `step`, but keep a trailing `wait_for_response` last.
 *
 * Nothing may run after the learner is handed the floor (the validator refuses it), so a
 * plain append would make every "add a step" produce an invalid scene the author then has
 * to reorder. Exported-adjacent logic kept local: nothing else sequences steps.
 */
function insertBeforeTrailingWait(steps: IWActionStep[], step: IWActionStep): IWActionStep[] {
  const last = steps[steps.length - 1];
  if (last?.kind === 'wait_for_response') {
    return [...steps.slice(0, -1), step, last];
  }
  return [...steps, step];
}
