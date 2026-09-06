import { useState } from 'react';
import {
  Box, Button, Collapse, IconButton, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteIcon from '@mui/icons-material/Delete';
import PlaceIcon from '@mui/icons-material/Place';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import {
  IW_INTERACTION_STEP_KINDS, IW_INTERACTION_STEP_LABELS,
  IW_MAX_EVENT_DELAY_SECONDS, IW_MAX_INTERACTION_STEPS,
  IW_MAX_POPUP_CAPTION_LENGTH, IW_MAX_WAIT_SECONDS,
  type IWInteractionStep, type IWInteractionStepKind,
  type IWNpcOption, type IWScene,
} from '../../../server/contracts/iw';
import { IW_POPUP_IMAGES, popupImageUrl } from './iwPopupArt';
import { isPlacedCell } from './useIWSceneDraft';
import { IW_WARNING_TEXT_SX, warningFieldProps } from './iwSceneWarnings';

/**
 * IWScenePlacesPanel — named PLACES and, hanging off each one, the INTERACTION that runs
 * when the learner walks up to it (docs/IMMERSIVE_WORLD.md § 5.4a, § 14 Q42/Q43).
 *
 * LAYER: feature view. Stateless apart from the new-place input and which place is expanded —
 * a half-typed name is not part of the scene, and which row is open is about looking rather
 * than authoring.
 *
 * WHY PLACES LEFT `IWSceneActionsPanel`. They used to be its bottom section, a supporting
 * vocabulary for the scripts above. Interactions changed what a place IS: it is now a thing
 * that can carry behaviour of its own, so the section grew a whole step editor and the two
 * halves stopped being one panel's worth of idea. The visual order is unchanged — the page
 * renders this immediately below the actions — so an author sees the same column they did.
 *
 * THE ONE RULE WORTH KNOWING WHILE READING THIS FILE: **an interaction is a property of a
 * place, not a sibling of one.** There is no "add interaction" button and no list of
 * interactions anywhere; a place with steps is interactive, a place with none is an ordinary
 * walk destination, and deleting the last step is how you go back. That is why the draft
 * hook's setter takes a whole step list and removes the entry when it is empty.
 *
 * WHAT AN INTERACTION CAN DO, and why it is a shorter menu than an NPC action's: an
 * interaction has no performer, so every step written from inside a body — walk, face, wait
 * for the learner — has no subject here. The one step that needs one names it (`npc_action`),
 * and the one genuinely new capability is `popup`, the first thing in the feature with
 * something to SHOW rather than something to say.
 *
 * ⚠️ `npc_action` IS ONE DROPDOWN, NOT TWO. An authored action is inherently an NPC's — it
 * lives on that NPC's cast entry and its id is unique only within them — so the picker lists
 * every action in the scene as "王婶 — take payment" and choosing one fills in both halves of
 * the step. Asking *who* separately would be a control whose every legal answer the second
 * control already implies.
 */

export interface IWScenePlacesPanelProps {
  scene: IWScene;
  npcs: IWNpcOption[];
  /** tag → "col,row", or the empty string for a named-but-unplaced tag. */
  places: Record<string, string>;
  problemsByField: Map<string, string>;
  onAddPlace: (tag: string) => void;
  onRenamePlace: (from: string, to: string) => void;
  onRemovePlace: (tag: string) => void;
  /** Arm the map's place tool for this tag. */
  onPutOnBoard: (tag: string) => void;
  /** Replace one place's whole interaction script. An empty list makes the place inert. */
  onSetInteraction: (tag: string, steps: IWInteractionStep[]) => void;
}

/**
 * A fresh step of the chosen kind. Switching kind REPLACES the step rather than mutating it,
 * because the union demands it — the same rule `IWSceneActionsPanel.blankStep` follows.
 */
function blankInteractionStep(kind: IWInteractionStepKind): IWInteractionStep {
  switch (kind) {
    // Pre-picks the first picture when there is one: a popup with no image is the single
    // most likely half-finished step, and the catalogue is usually small.
    case 'popup': return { kind, imageId: IW_POPUP_IMAGES[0]?.id ?? '', caption: '' };
    case 'npc_action': return { kind, npcId: '', actionId: '' };
    case 'start_conversation': return { kind, conversationId: '' };
    // 20s and no event pre-picked — the delay has a sensible default, the referent never does.
    case 'schedule_event': return { kind, eventId: '', seconds: 20 };
    case 'wait': return { kind, seconds: 2 };
  }
}

export default function IWScenePlacesPanel({
  scene, npcs, places, problemsByField,
  onAddPlace, onRenamePlace, onRemovePlace, onPutOnBoard, onSetInteraction,
}: IWScenePlacesPanelProps) {
  const problem = (field: string) => problemsByField.get(field);
  const warn = (field: string) => warningFieldProps(problemsByField, field);
  const npcName = (npcId: string) => npcs.find((n) => n.id === npcId)?.name ?? npcId;

  const [newTag, setNewTag] = useState('');
  /** Which place's interaction script is expanded. One at a time — the editor is tall. */
  const [openTag, setOpenTag] = useState<string | null>(null);

  const interactions = scene.interactions ?? {};

  /** Every place, alphabetical. `cell` is empty for one that was named but never placed. */
  const tags = Object.entries(places)
    .map(([tag, cell]) => ({ tag, cell: isPlacedCell(cell) ? cell : '' }))
    .sort((a, b) => (a.tag < b.tag ? -1 : 1));

  /**
   * EVERY authored action in the scene, flattened, each carrying the NPC it belongs to.
   *
   * An action is inherently an NPC's — it lives on that NPC's cast entry, and its id is
   * unique only WITHIN them — so choosing the action already answers *who*. The step stores
   * both halves (and the validator checks them as a pair, since `pay` on 王婶 and `pay` on
   * 小陈 are different scripts), but the AUTHOR is only asked once: a separate "who" dropdown
   * would be a second control whose every legal answer is implied by the first.
   *
   * Cast order, then authored order — not alphabetical. Both are orders the author chose, and
   * this list should read like the Actions panel above it rather than re-sorting their work.
   */
  const actionOptions = scene.npcCast.flatMap((m) =>
    (m.actions ?? []).map((a) => ({
      npcId: m.npcId,
      actionId: a.id,
      /** "王婶 — take payment". The NPC has to be in the label; the id alone says nothing. */
      label: `${npcName(m.npcId)} — ${a.name.trim() || a.id}`,
    })),
  );

  /** The composite select value. `::` cannot occur in either half — both are authored ids. */
  const actionKey = (npcId: string, actionId: string) => `${npcId}::${actionId}`;

  const commitTag = () => {
    const clean = newTag.trim();
    if (!clean) return;
    onAddPlace(clean);
    setNewTag('');
  };

  /** Replace one step of one place's script, keeping the rest untouched. */
  const patchStep = (tag: string, steps: IWInteractionStep[], index: number, next: IWInteractionStep) =>
    onSetInteraction(tag, steps.map((s, i) => (i === index ? next : s)));

  /** Move a step one slot. Order IS the script, so this is a primary control. */
  const moveStep = (tag: string, steps: IWInteractionStep[], index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    [next[index], next[to]] = [next[to], next[index]];
    onSetInteraction(tag, next);
  };

  return (
    <Box className="iw-scene-places-panel" sx={{ mb: 3 }}>
      <Typography variant="overline">Places</Typography>
      <Typography sx={{ fontSize: 11, opacity: 0.7, mb: 1 }}>
        Name a spot on the board so an action can send somebody to it. Name it here, then
        click its cell with the matching map tool along the top of the board — each place sits
        on exactly one cell, and clicking again moves it. Several places may name the same
        cell — if more than one of them is interactive, walking there runs them all, in name
        order.
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
        <TextField
          className="iw-scene-places-panel__new-place"
          size="small" label="New place" fullWidth
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitTag(); } }}
        />
        <Button size="small" startIcon={<AddIcon />} onClick={commitTag} disabled={!newTag.trim()}>
          Add
        </Button>
      </Stack>
      {problem('layout.places') && (
        <Typography sx={{ ...IW_WARNING_TEXT_SX, fontSize: 11, mb: 1 }}>{problem('layout.places')}</Typography>
      )}

      <Stack spacing={1}>
        {tags.map(({ tag, cell }) => {
          const steps = interactions[tag] ?? [];
          const open = openTag === tag;
          const at = `interactions.${tag}`;
          return (
            <Box
              key={tag}
              className="iw-scene-places-panel__place"
              sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small" fullWidth
                  value={tag}
                  onChange={(e) => onRenamePlace(tag, e.target.value)}
                  // A rename rewrites every step that walked here AND carries the place's own
                  // interaction across, so an author can fix a typo without silently
                  // invalidating their own scripts. Refused when the name is already taken.
                  helperText={cell
                    ? `Cell ${cell}${steps.length ? ` · ${steps.length} interaction step${steps.length === 1 ? '' : 's'}` : ''}`
                    : 'Named but not on the board yet — click its cell with the map tool.'}
                  error={!cell}
                />
                <Tooltip title={steps.length
                  ? 'Edit what happens when the learner walks up here'
                  : 'Make this place interactive — what happens when the learner walks up'}
                >
                  <IconButton
                    size="small"
                    className="iw-scene-places-panel__interact-btn"
                    color={steps.length ? 'primary' : 'default'}
                    onClick={() => setOpenTag(open ? null : tag)}
                  >
                    <TouchAppIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={`Put “${tag}” on a cell`}>
                  <IconButton size="small" onClick={() => onPutOnBoard(tag)}>
                    <PlaceIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete this place, its interaction, and any step that walked to it">
                  <IconButton size="small" onClick={() => onRemovePlace(tag)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>

              {/* The place-level complaints: a tag nothing names, or two interactive tags
                  fighting over one cell. Shown whether or not the script is expanded, since
                  neither is a fault of any individual step. */}
              {problem(at) && (
                <Typography sx={{ ...IW_WARNING_TEXT_SX, fontSize: 11, mt: 0.5 }}>{problem(at)}</Typography>
              )}

              <Collapse in={open} unmountOnExit>
                <Box className="iw-scene-places-panel__interaction" sx={{ mt: 1, pl: 1, borderLeft: '2px solid', borderColor: 'divider' }}>
                  <Typography sx={{ fontSize: 11, opacity: 0.7, mb: 1 }}>
                    Runs when the learner walks up to this place. They walk as close as they
                    can get; if they cannot reach it, nothing fires.
                  </Typography>

                  <Stack spacing={0.75}>
                    {steps.map((step, si) => (
                      <Stack
                        key={si}
                        direction="row" spacing={0.5} alignItems="flex-start"
                        className="iw-scene-places-panel__step"
                      >
                        <Typography sx={{ fontSize: 11, opacity: 0.5, width: 12, mt: 1.25, flex: '0 0 auto' }}>{si + 1}</Typography>
                        <TextField
                          size="small" select sx={{ width: 140, flex: '0 0 auto' }}
                          value={step.kind}
                          {...warn(`${at}.steps[${si}].kind`)}
                          onChange={(e) => patchStep(
                            tag, steps, si, blankInteractionStep(e.target.value as IWInteractionStepKind),
                          )}
                        >
                          {IW_INTERACTION_STEP_KINDS.map((k) => (
                            <MenuItem key={k} value={k}>{IW_INTERACTION_STEP_LABELS[k]}</MenuItem>
                          ))}
                        </TextField>

                        {/* Show a picture — the one thing an interaction can do that an
                            authored action cannot. The thumbnail is the confirmation that the
                            stored STEM still resolves to a file; a blank one means the art was
                            renamed or deleted out from under the scene. */}
                        {step.kind === 'popup' && (
                          <>
                            <TextField
                              size="small" select sx={{ width: 140, flex: '0 0 auto' }}
                              value={IW_POPUP_IMAGES.some((im) => im.id === step.imageId) ? step.imageId : ''}
                              {...warn(`${at}.steps[${si}].imageId`)}
                              helperText={problem(`${at}.steps[${si}].imageId`)
                                ?? (IW_POPUP_IMAGES.length === 0
                                  ? 'No popup art yet — add files to src/assets/iw-popups/.'
                                  : undefined)}
                              onChange={(e) => patchStep(tag, steps, si, {
                                kind: 'popup', imageId: e.target.value, caption: step.caption,
                              })}
                            >
                              {IW_POPUP_IMAGES.map((im) => (
                                <MenuItem key={im.id} value={im.id}>{im.id}</MenuItem>
                              ))}
                            </TextField>
                            {popupImageUrl(step.imageId) && (
                              <Box
                                component="img"
                                className="iw-scene-places-panel__popup-thumb"
                                src={popupImageUrl(step.imageId)}
                                alt={step.imageId}
                                sx={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 0.5, mt: 0.5 }}
                              />
                            )}
                            <TextField
                              size="small" fullWidth placeholder="Caption (optional)"
                              inputProps={{ maxLength: IW_MAX_POPUP_CAPTION_LENGTH }}
                              value={step.caption ?? ''}
                              {...warn(`${at}.steps[${si}].caption`)}
                              onChange={(e) => patchStep(tag, steps, si, {
                                kind: 'popup', imageId: step.imageId, caption: e.target.value,
                              })}
                            />
                          </>
                        )}

                        {/* Dialogue and behaviour both come through here, by reference: the
                            action stays in the NPC's repertoire, so the same script is both
                            something the model may choose and something this place triggers.
                            Only NPCs that HAVE actions are offered — an NPC with none would be
                            a dead end in the second dropdown. */}
                        {/* ONE control, not two. An authored action is inherently an NPC's
                            — it hangs off their cast entry — so picking the action answers
                            *who* as well. The step still stores the pair, because an action
                            id means nothing without the NPC it belongs to. Only NPCs with
                            actions appear at all: an NPC with none would be a dead end. */}
                        {step.kind === 'npc_action' && (
                          <TextField
                            size="small" select fullWidth
                            value={actionOptions.some((o) => o.npcId === step.npcId && o.actionId === step.actionId)
                              ? actionKey(step.npcId, step.actionId)
                              : ''}
                            {...warn(`${at}.steps[${si}].actionId`)}
                            helperText={problem(`${at}.steps[${si}].actionId`)
                              ?? problem(`${at}.steps[${si}].npcId`)
                              ?? (actionOptions.length === 0 ? 'Give an NPC an action first.' : undefined)}
                            onChange={(e) => {
                              const [npcId, actionId] = e.target.value.split('::');
                              patchStep(tag, steps, si, { kind: 'npc_action', npcId, actionId });
                            }}
                          >
                            {actionOptions.map((o) => (
                              <MenuItem key={actionKey(o.npcId, o.actionId)} value={actionKey(o.npcId, o.actionId)}>
                                {o.label}
                              </MenuItem>
                            ))}
                          </TextField>
                        )}

                        {step.kind === 'start_conversation' && (
                          <TextField
                            size="small" select fullWidth
                            value={scene.conversations.some((c) => c.id === step.conversationId) ? step.conversationId : ''}
                            {...warn(`${at}.steps[${si}].conversationId`)}
                            helperText={problem(`${at}.steps[${si}].conversationId`)
                              ?? (scene.conversations.length === 0 ? 'Author a conversation first.' : undefined)}
                            onChange={(e) => patchStep(tag, steps, si, {
                              kind: 'start_conversation', conversationId: e.target.value,
                            })}
                          >
                            {scene.conversations.map((c) => (
                              <MenuItem key={c.id} value={c.id}>{c.title?.trim() || c.id}</MenuItem>
                            ))}
                          </TextField>
                        )}

                        {step.kind === 'schedule_event' && (
                          <>
                            <TextField
                              size="small" select fullWidth
                              value={scene.events.some((ev) => ev.id === step.eventId) ? step.eventId : ''}
                              {...warn(`${at}.steps[${si}].eventId`)}
                              helperText={problem(`${at}.steps[${si}].eventId`)
                                ?? (scene.events.length === 0 ? 'Author an event first.' : undefined)}
                              onChange={(e) => patchStep(tag, steps, si, {
                                kind: 'schedule_event', eventId: e.target.value, seconds: step.seconds,
                              })}
                            >
                              {scene.events.map((ev) => (
                                <MenuItem key={ev.id} value={ev.id}>{ev.description.trim() || ev.id}</MenuItem>
                              ))}
                            </TextField>
                            <TextField
                              size="small" type="number" sx={{ width: 110 }} label="in seconds"
                              inputProps={{ min: 0, max: IW_MAX_EVENT_DELAY_SECONDS }}
                              value={step.seconds}
                              {...warn(`${at}.steps[${si}].seconds`)}
                              onChange={(e) => patchStep(tag, steps, si, {
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
                            onChange={(e) => patchStep(tag, steps, si, { kind: 'wait', seconds: Number(e.target.value) })}
                          />
                        )}

                        {/* Dense, like the action panel's row: the padding these three shed
                            goes straight to the step's payload field. */}
                        <IconButton size="small" sx={{ p: 0.25, flex: '0 0 auto' }} title="Move up" onClick={() => moveStep(tag, steps, si, -1)}>
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" sx={{ p: 0.25, flex: '0 0 auto' }} title="Move down" onClick={() => moveStep(tag, steps, si, 1)}>
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small" sx={{ p: 0.25, flex: '0 0 auto' }}
                          // Removing the LAST step makes the place inert again — the draft hook
                          // drops the entry rather than storing an empty script.
                          title={steps.length === 1 ? 'Remove step (this place stops being interactive)' : 'Remove step'}
                          onClick={() => onSetInteraction(tag, steps.filter((_, i) => i !== si))}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    ))}

                    {steps.length === 0 && (
                      <Typography sx={{ fontSize: 11, opacity: 0.6 }}>
                        Nothing happens here yet — this is an ordinary place to walk to.
                      </Typography>
                    )}

                    <Box>
                      <Button
                        size="small" startIcon={<AddIcon />}
                        disabled={steps.length >= IW_MAX_INTERACTION_STEPS}
                        onClick={() => onSetInteraction(tag, [...steps, blankInteractionStep('popup')])}
                      >
                        Step
                      </Button>
                    </Box>
                  </Stack>
                </Box>
              </Collapse>
            </Box>
          );
        })}
        {tags.length === 0 && (
          <Typography sx={{ fontSize: 11, opacity: 0.6 }}>No places yet.</Typography>
        )}
      </Stack>
    </Box>
  );
}
