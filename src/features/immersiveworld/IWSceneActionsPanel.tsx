import {
  Box, Button, Checkbox, FormControlLabel, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import {
  IW_ACTION_STEP_KINDS, IW_ACTION_STEP_LABELS, IW_ACTOR_COMPANION, IW_ACTOR_PLAYER,
  IW_MAX_ACTION_STEPS, IW_MAX_EVENT_DELAY_SECONDS, IW_MAX_WAIT_SECONDS, isActorStep, isActorStepKind,
  type IWActionStep, type IWActionStepKind,
  type IWNpcAction, type IWNpcOption, type IWScene,
} from '../../../server/contracts/iw';
import { isPlacedCell } from './useIWSceneDraft';
import { iwZebraItemSx } from './iwListZebra';
import IWSelectableControls, { type IWCueOption } from './IWSelectableControls';
import { IW_WARNING_TEXT_SX, warningFieldProps } from './iwSceneWarnings';

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
 * ⚠️ PLACES LEFT THIS FILE (2026-09-05, migration 162). They were its bottom section while a
 * place was only a supporting vocabulary — a name a step could walk to. Interactions made a
 * place a thing that carries behaviour of its own, so authoring one grew a whole step editor
 * and moved to `IWScenePlacesPanel`, which the page renders directly below this. The `walk_to
 * _tag` dropdown here still READS `places`; it just no longer edits them.
 */

export interface IWSceneActionsPanelProps {
  scene: IWScene;
  npcs: IWNpcOption[];
  /**
   * tag → "col,row" (empty for a named-but-unplaced tag). Read-only here: this panel offers
   * places to `walk_to_tag` steps but no longer authors them — that moved to
   * `IWScenePlacesPanel` when a place grew an interaction of its own.
   */
  places: Record<string, string>;
  problemsByField: Map<string, string>;
  /**
   * The scene's complications and events, merged — what an action's `unlockedBy` gate may
   * name. Passed in rather than derived here so the picker and the validator read the same
   * pool (the validator merges the same two lists).
   */
  cues: IWCueOption[];
  onAddAction: (npcId: string) => void;
  onUpdateAction: (npcId: string, actionId: string, patch: Partial<IWNpcAction>) => void;
  onRemoveAction: (npcId: string, actionId: string) => void;
}

/** A fresh step of the chosen kind. Switching kind REPLACES the step — the union demands it. */
function blankStep(kind: IWActionStepKind): IWActionStep {
  if (isActorStepKind(kind)) return { kind, actor: IW_ACTOR_PLAYER };
  switch (kind) {
    case 'comment': return { kind, text: '' };
    // No speaker pre-picked, and both optional halves left out: a blank `prompt_npc` is a
    // legal, meaningful step (somebody say something now) once a speaker is chosen, so the
    // factory must not invent a target or a brief the author did not ask for.
    case 'prompt_npc': return { kind, npcId: '' };
    case 'walk_to_tag': return { kind, tag: '' };
    case 'ai_walk': return { kind, instruction: '' };
    case 'start_conversation': return { kind, conversationId: '' };
    case 'wait': return { kind, seconds: 2 };
    // 20s, and no event pre-picked: the delay has a sensible default, the referent never does.
    case 'schedule_event': return { kind, eventId: '', seconds: 20 };
    case 'wait_for_response': return { kind };
  }
}

export default function IWSceneActionsPanel({
  scene, npcs, places, problemsByField, cues,
  onAddAction, onUpdateAction, onRemoveAction,
}: IWSceneActionsPanelProps) {
  const problem = (field: string) => problemsByField.get(field);
  /** Amber marking props for one field. Warnings do not refuse a save, so they do not
   *  paint like errors — see `iwSceneWarnings.ts`. */
  const warn = (field: string) => warningFieldProps(problemsByField, field);
  const npcName = (npcId: string) => npcs.find((n) => n.id === npcId)?.name ?? npcId;

  /** Every place, alphabetical. `cell` is empty for one that was named but never placed. */
  const tags = Object.entries(places)
    .map(([tag, cell]) => ({ tag, cell: isPlacedCell(cell) ? cell : '' }))
    .sort((a, b) => (a.tag < b.tag ? -1 : 1));

  /**
   * Who a `prompt_npc` step may make SPEAK: the cast, plus the companion — every body that
   * has an NPC sheet to render a line from. The learner is absent on purpose; they are a
   * legal addressee and never a speaker.
   */
  const promptSpeakerOptions = [
    { id: IW_ACTOR_COMPANION, label: 'the companion' },
    ...scene.npcCast.map((m) => ({ id: m.npcId, label: npcName(m.npcId) })),
  ];

  /** Who a `walk_to_actor` step may target: the two fixed bodies plus the cast. */
  const actorOptions = [
    { id: IW_ACTOR_PLAYER, label: 'the learner' },
    { id: IW_ACTOR_COMPANION, label: 'the companion' },
    ...scene.npcCast.map((m) => ({ id: m.npcId, label: npcName(m.npcId) })),
  ];

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
      {/* ── Per-NPC actions ──────────────────────────────────────────────── */}
      <Box className="iw-scene-actions-panel__actions" sx={{ mb: 3 }}>
        <Typography variant="overline">Actions</Typography>
        <Typography sx={{ fontSize: 11, opacity: 0.7, mb: 1 }}>
          What each NPC can be asked to do. The model picks one by name when the moment fits;
          the engine then plays your script exactly — except “Say”, which the NPC paraphrases
          in its own voice.
        </Typography>

        {scene.npcCast.length === 0 && (
          <Typography sx={{ fontSize: 11, opacity: 0.6 }}>Add an NPC to the cast first.</Typography>
        )}

        <Stack spacing={2}>
          {scene.npcCast.map((member, mi) => (
            <Box
              key={member.npcId}
              className="iw-scene-actions-panel__npc"
              // Padding is deliberately tight (px < py): the step row inside is the widest
              // thing in the column, and side padding is the cheapest space to give it back.
              // The zebra ground goes on the NPC and stops there — the action boxes inside
              // keep their dashed outline on it (see `iwListZebra`).
              sx={{ ...iwZebraItemSx(mi), border: '1px solid', borderColor: 'divider', py: 1.25 }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{npcName(member.npcId)}</Typography>
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
                      sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 1, px: 0.75, py: 1 }}
                    >
                      <Stack direction="row" spacing={1} alignItems="flex-start">
                        <TextField
                          size="small" label="The model chooses this by name" fullWidth
                          value={action.name}
                          {...warn(`${at}.name`)}
                          onChange={(e) => onUpdateAction(member.npcId, action.id, { name: e.target.value })}
                        />
                        <IconButton
                          size="small" title="Delete this action"
                          onClick={() => onRemoveAction(member.npcId, action.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                      {/* The three fields every model-choosable thing has. Greyed — not
                          hidden — when the action is interaction-only, so an author who
                          ticks that box can see what it just switched off. */}
                      <IWSelectableControls
                        value={action}
                        at={at}
                        problemsByField={problemsByField}
                        cues={cues}
                        whenLabel="When it fits (optional)"
                        urgentHint="Urgent leans the model toward this when nothing more pressing is happening — it is never a guarantee. A beat that must happen is an event on a timer."
                        disabled={!!action.interactionOnly}
                        onChange={(patch) => onUpdateAction(member.npcId, action.id, patch)}
                      />

                      {/* The action-only flag, drawn here rather than inside the shared
                          controls because its polarity is the opposite of a conversation's
                          `selectable` — see the contract. */}
                      <FormControlLabel
                        className="iw-scene-actions-panel__interaction-only"
                        control={
                          <Checkbox
                            size="small"
                            checked={!!action.interactionOnly}
                            onChange={(e) => onUpdateAction(
                              member.npcId, action.id, { interactionOnly: e.target.checked || undefined },
                            )}
                          />
                        }
                        label={(
                          <Typography sx={{ fontSize: 11 }}>
                            only a place interaction runs this — never offered to the model
                          </Typography>
                        )}
                      />
                      {problem(`${at}.interactionOnly`) && (
                        <Typography sx={{ ...IW_WARNING_TEXT_SX, fontSize: 11 }}>
                          {problem(`${at}.interactionOnly`)}
                        </Typography>
                      )}
                      {problem(`${at}.urgent`) && (
                        <Typography sx={{ ...IW_WARNING_TEXT_SX, fontSize: 11 }}>
                          {problem(`${at}.urgent`)}
                        </Typography>
                      )}

                      {problem(`${at}.steps`) && (
                        <Typography sx={{ ...IW_WARNING_TEXT_SX, fontSize: 11, mt: 0.5 }}>
                          {problem(`${at}.steps`)}
                        </Typography>
                      )}

                      <Stack spacing={0.75} sx={{ mt: 1 }}>
                        {action.steps.map((step, si) => (
                          <Stack
                            key={si}
                            direction="row" spacing={0.5} alignItems="flex-start"
                            className="iw-scene-actions-panel__step"
                          >
                            <Typography sx={{ fontSize: 11, opacity: 0.5, width: 12, mt: 1.25, flex: '0 0 auto' }}>
                              {si + 1}
                            </Typography>
                            <TextField
                              size="small" select sx={{ width: 124, flex: '0 0 auto' }}
                              value={step.kind}
                              {...warn(`${at}.steps[${si}].kind`)}
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
                                {...warn(`${at}.steps[${si}].text`)}
                                onChange={(e) => patchStep(member.npcId, action, si, { kind: 'comment', text: e.target.value })}
                              />
                            )}

                            {/* Prompt an NPC to speak (2026-09-19) — the one step whose
                                SUBJECT is somebody other than the performer, which is why it
                                is the only step row with a "who speaks" control. Both the
                                addressee and the brief are optional, and blank means "the
                                model decides" rather than "nothing": the placeholders say so
                                because an empty field otherwise reads as unfinished. */}
                            {step.kind === 'prompt_npc' && (
                              <>
                                <TextField
                                  size="small" select sx={{ width: 150, flex: '0 0 auto' }} label="who speaks"
                                  value={promptSpeakerOptions.some((o) => o.id === step.npcId) ? step.npcId : ''}
                                  {...warn(`${at}.steps[${si}].npcId`)}
                                  onChange={(e) => patchStep(member.npcId, action, si, {
                                    ...step, kind: 'prompt_npc', npcId: e.target.value,
                                  })}
                                >
                                  {promptSpeakerOptions
                                    // The performer is excluded because a Say step already
                                    // says it, and the learner because they speak for
                                    // themselves — both are refused on save too.
                                    .filter((o) => o.id !== member.npcId)
                                    .map((o) => <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>)}
                                </TextField>
                                <TextField
                                  size="small" select sx={{ width: 150, flex: '0 0 auto' }} label="to"
                                  value={actorOptions.some((o) => o.id === step.target) ? step.target : ''}
                                  {...warn(`${at}.steps[${si}].target`)}
                                  onChange={(e) => patchStep(member.npcId, action, si, {
                                    ...step, kind: 'prompt_npc', target: e.target.value || undefined,
                                  })}
                                >
                                  <MenuItem value="">whoever the model picks</MenuItem>
                                  {actorOptions
                                    .filter((o) => o.id !== step.npcId)
                                    .map((o) => <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>)}
                                </TextField>
                                <TextField
                                  size="small" fullWidth
                                  placeholder="Roughly what they say — leave blank to let the model decide"
                                  value={step.instruction ?? ''}
                                  {...warn(`${at}.steps[${si}].instruction`)}
                                  onChange={(e) => patchStep(member.npcId, action, si, {
                                    ...step, kind: 'prompt_npc', instruction: e.target.value || undefined,
                                  })}
                                />
                              </>
                            )}

                            {step.kind === 'walk_to_tag' && (
                              <TextField
                                size="small" select fullWidth
                                value={tags.some((t) => t.tag === step.tag) ? step.tag : ''}
                                {...warn(`${at}.steps[${si}].tag`)}
                                onChange={(e) => patchStep(member.npcId, action, si, { kind: 'walk_to_tag', tag: e.target.value })}
                              >
                                {tags.map(({ tag }) => <MenuItem key={tag} value={tag}>{tag}</MenuItem>)}
                              </TextField>
                            )}

                            {/* The one step whose destination the AUTHOR does not pick. The
                                model chooses from this scene's places and people, so the
                                field is a brief, not a name. It picks WHERE and nothing
                                else — the walk itself is the same computed traversal as
                                every other walk step. */}
                            {step.kind === 'ai_walk' && (
                              <TextField
                                size="small" fullWidth
                                placeholder="Where should they go? e.g. to whoever has been waiting longest"
                                value={step.instruction}
                                {...warn(`${at}.steps[${si}].instruction`)}
                                helperText={problem(`${at}.steps[${si}].instruction`)
                                  ?? 'The model picks one of this scene’s places or people.'}
                                onChange={(e) => patchStep(member.npcId, action, si, {
                                  kind: 'ai_walk', instruction: e.target.value,
                                })}
                              />
                            )}

                            {/* One control for all three actor-aimed kinds — move toward,
                                move away, turn to face. They differ only in what the engine
                                animates; the author is answering the same question, *who*. */}
                            {isActorStep(step) && (
                              <TextField
                                size="small" select fullWidth
                                value={actorOptions.some((o) => o.id === step.actor) ? step.actor : ''}
                                {...warn(`${at}.steps[${si}].actor`)}
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
                                {...warn(`${at}.steps[${si}].conversationId`)}
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

                            {/* Schedule event (migration 161): the one step that sets
                                something in motion the NPC does not perform. It does NOT
                                hold them — use Wait for that — so the two controls read
                                "which fact" and "how long from now, at the earliest". */}
                            {step.kind === 'schedule_event' && (
                              <>
                                <TextField
                                  size="small" select fullWidth
                                  value={scene.events.some((ev) => ev.id === step.eventId) ? step.eventId : ''}
                                  {...warn(`${at}.steps[${si}].eventId`)}
                                  helperText={problem(`${at}.steps[${si}].eventId`)
                                    ?? (scene.events.length === 0 ? 'Author an event first.' : undefined)}
                                  onChange={(e) => patchStep(member.npcId, action, si, {
                                    kind: 'schedule_event', eventId: e.target.value, seconds: step.seconds,
                                  })}
                                >
                                  {scene.events.map((ev) => (
                                    <MenuItem key={ev.id} value={ev.id}>
                                      {ev.description.trim() || ev.id}
                                    </MenuItem>
                                  ))}
                                </TextField>
                                <TextField
                                  size="small" type="number" sx={{ width: 110 }} label="in seconds"
                                  inputProps={{ min: 0, max: IW_MAX_EVENT_DELAY_SECONDS }}
                                  value={step.seconds}
                                  {...warn(`${at}.steps[${si}].seconds`)}
                                  onChange={(e) => patchStep(member.npcId, action, si, {
                                    kind: 'schedule_event', eventId: step.eventId, seconds: Number(e.target.value),
                                  })}
                                />
                              </>
                            )}

                            {step.kind === 'wait' && (
                              <TextField
                                size="small" type="number" sx={{ width: 110 }} label="seconds"
                                inputProps={{ min: 1, max: IW_MAX_WAIT_SECONDS }}
                                value={step.seconds}
                                {...warn(`${at}.steps[${si}].seconds`)}
                                onChange={(e) => patchStep(member.npcId, action, si, { kind: 'wait', seconds: Number(e.target.value) })}
                              />
                            )}

                            {/* The row's three fixed controls, drawn dense: their default
                                padding costs ~30px the payload field would otherwise have. */}
                            <IconButton size="small" sx={{ p: 0.25, flex: '0 0 auto' }} title="Move up" onClick={() => moveStep(member.npcId, action, si, -1)}>
                              <ArrowUpwardIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" sx={{ p: 0.25, flex: '0 0 auto' }} title="Move down" onClick={() => moveStep(member.npcId, action, si, 1)}>
                              <ArrowDownwardIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small" sx={{ p: 0.25, flex: '0 0 auto' }} title="Remove step"
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
                            // A plain append. It used to have to dodge a trailing
                            // `wait_for_response`, because nothing was allowed to follow that
                            // step; since 2026-09-20 the script RESUMES from it, so a step
                            // after it is the ordinary case and the author is free to put one
                            // there. Reordering is the up/down arrows' job either way.
                            steps: [...action.steps, { kind: 'wait', seconds: 2 }],
                          })}
                        >
                          Step
                        </Button>
                      </Stack>
                    </Box>
                  );
                })}
                {(member.actions ?? []).length === 0 && (
                  <Typography sx={{ fontSize: 11, opacity: 0.6 }}>
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

