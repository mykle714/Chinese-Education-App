import {
  Box, Checkbox, FormControlLabel, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import {
  IW_FACINGS, IW_FACING_LABELS,
  IW_MAX_SCENE_DIM, IW_MIN_SCENE_DIM,
  type IWNpcOption, type IWScene, type IWSceneCastMember,
} from '../../../server/contracts/iw';

/**
 * IWSceneDetailsPanel — the scene's IDENTITY, its completion pair and its cast
 * (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * LAYER: feature view. Stateless: every field reads from the draft and writes through the
 * callbacks, so there is exactly one copy of a scene in the editor.
 *
 * THE NPC CONTROL IS A PICKER, NEVER A TEXT FIELD (§ 14 Q2). Its options come from the
 * server's projection of the code registry, which is what turns "an id that no longer
 * resolves" from a runtime failure into an impossible input. Nothing here shows or edits
 * an NPC's prose — that is the § 11 layer-1 boundary, and it is why `IWNpcOption` carries
 * a name and an occupation and nothing else.
 */

export interface IWSceneDetailsPanelProps {
  scene: IWScene;
  npcs: IWNpcOption[];
  /** Field paths the last refused save complained about, for inline marking. */
  problemsByField: Map<string, string>;
  onUpdate: (patch: Partial<IWScene>) => void;
  onAddCastMember: (npcId: string) => void;
  onRemoveCastMember: (npcId: string) => void;
  onUpdateCastMember: (npcId: string, patch: Partial<IWSceneCastMember>) => void;
  /** Select this NPC's placement tool — the bridge from the cast list to the map. */
  onPlaceNpc: (npcId: string) => void;
}

const SECTION_SX = { mb: 2.5 } as const;

export default function IWSceneDetailsPanel({
  scene, npcs, problemsByField, onUpdate,
  onAddCastMember, onRemoveCastMember, onUpdateCastMember, onPlaceNpc,
}: IWSceneDetailsPanelProps) {

  /** The complaint against one field path, if the last save produced one. */
  const problem = (field: string) => problemsByField.get(field);

  const castIds = new Set(scene.npcCast.map((m) => m.npcId));
  // THE COMPANION IS NEVER OFFERED. He is in every scene by definition, and his position is
  // the scene's own companion start cell rather than a cast row — so casting him would be a
  // second answer to "where does he stand". The server refuses it too
  // (`sceneValidation.ts`); this filter is the convenience, not the boundary.
  const uncastNpcs = npcs.filter((n) => !castIds.has(n.id) && !n.isCompanion);
  /** Only a cast NPC with a completionRule can end the scene — the validator agrees. */
  const completerOptions = npcs.filter((n) => castIds.has(n.id) && n.canComplete && !n.isCompanion);

  /**
   * The completer's own authored actions — the only candidates for "does what".
   * Read off the cast entry rather than kept in state, so renaming an action in the actions
   * panel re-labels this picker with no wiring between the two panels.
   */
  const completerActions =
    scene.npcCast.find((m) => m.npcId === scene.completerNpcId)?.actions ?? [];

  return (
    <Box className="iw-scene-details-panel">
      <Box className="iw-scene-details-panel__identity" sx={SECTION_SX}>
        <Typography variant="overline">Scene</Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <TextField
            className="iw-scene-details-panel__name"
            label="Name"
            size="small"
            value={scene.name}
            error={!!problem('name')}
            helperText={problem('name')}
            onChange={(e) => onUpdate({ name: e.target.value })}
          />
          <TextField
            className="iw-scene-details-panel__language"
            label="Language"
            size="small"
            select
            value={scene.language}
            // Changing the language changes the whole cast: NPCs belong to exactly one
            // language (§ 14 Q8), so the existing cast and its completer are cleared rather
            // than left pointing at characters who cannot appear.
            onChange={(e) => onUpdate({
              language: e.target.value as 'zh' | 'es',
              npcCast: [],
              completerNpcId: '',
              conversations: [],
            })}
          >
            <MenuItem value="zh">Chinese</MenuItem>
            <MenuItem value="es">Spanish</MenuItem>
          </TextField>
          <FormControlLabel
            className="iw-scene-details-panel__published"
            control={
              <Checkbox
                checked={scene.published}
                onChange={(e) => onUpdate({ published: e.target.checked })}
              />
            }
            label="Published (learners can be given this scene)"
          />
        </Stack>
      </Box>

      <Box className="iw-scene-details-panel__board" sx={SECTION_SX}>
        <Typography variant="overline">Board</Typography>
        <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
          <TextField
            className="iw-scene-details-panel__width"
            label="Width" size="small" type="number"
            inputProps={{ min: IW_MIN_SCENE_DIM, max: IW_MAX_SCENE_DIM }}
            value={scene.width}
            error={!!problem('width')}
            helperText={problem('width')}
            onChange={(e) => onUpdate({ width: Number(e.target.value) })}
          />
          <TextField
            className="iw-scene-details-panel__height"
            label="Height" size="small" type="number"
            inputProps={{ min: IW_MIN_SCENE_DIM, max: IW_MAX_SCENE_DIM }}
            value={scene.height}
            onChange={(e) => onUpdate({ height: Number(e.target.value) })}
          />
        </Stack>
        {/* The two start cells are PLACED on the map, not typed here — but the direction
            each body faces has no gesture, so it gets a control. Same picker as a cast
            member's facing below, because it is the same choice. */}
        <Stack direction="row" spacing={1.5} sx={{ mt: 1.5 }}>
          <TextField
            className="iw-scene-details-panel__player-facing"
            label={`Player faces (at ${scene.playerStartCol}, ${scene.playerStartRow})`}
            size="small" select fullWidth
            value={scene.playerStartFacing}
            error={!!problem('playerStartFacing')}
            onChange={(e) => onUpdate({ playerStartFacing: e.target.value as IWScene['playerStartFacing'] })}
          >
            {IW_FACINGS.map((f) => (
              <MenuItem key={f} value={f}>{IW_FACING_LABELS[f]}</MenuItem>
            ))}
          </TextField>
          <TextField
            className="iw-scene-details-panel__companion-facing"
            label={`Companion faces (at ${scene.companionStartCol}, ${scene.companionStartRow})`}
            size="small" select fullWidth
            value={scene.companionStartFacing}
            error={!!problem('companionStartFacing')}
            onChange={(e) => onUpdate({ companionStartFacing: e.target.value as IWScene['companionStartFacing'] })}
          >
            {IW_FACINGS.map((f) => (
              <MenuItem key={f} value={f}>{IW_FACING_LABELS[f]}</MenuItem>
            ))}
          </TextField>
        </Stack>
        <Typography sx={{ mt: 1, fontSize: 12, opacity: 0.7 }}>
          Place both start cells on the map with the Player (Z) and Companion (X) tools. The
          scene opens by walking the player to the companion, so give them some distance.
        </Typography>
        {(problem('playerStartCol') || problem('companionStartCol')) && (
          <Typography className="iw-scene-details-panel__start-error" color="error" sx={{ fontSize: 12 }}>
            {problem('playerStartCol') ?? problem('companionStartCol')}
          </Typography>
        )}
      </Box>

      <Box className="iw-scene-details-panel__cast" sx={SECTION_SX}>
        <Typography variant="overline">Cast</Typography>
        <TextField
          className="iw-scene-details-panel__add-npc"
          label="Add an NPC"
          size="small"
          select
          value=""
          fullWidth
          sx={{ mt: 1 }}
          onChange={(e) => e.target.value && onAddCastMember(e.target.value)}
          disabled={uncastNpcs.length === 0}
          helperText={uncastNpcs.length === 0 ? 'Every castable NPC for this language is already here. (The companion is always present and is placed with his own start cell.)' : undefined}
        >
          {uncastNpcs.map((npc) => (
            <MenuItem key={npc.id} value={npc.id}>
              {npc.name} ({npc.romanization}) — {npc.occupation}
            </MenuItem>
          ))}
        </TextField>

        <Stack spacing={1} sx={{ mt: 1.5 }}>
          {scene.npcCast.map((member, i) => {
            const npc = npcs.find((n) => n.id === member.npcId);
            return (
              <Stack
                key={member.npcId}
                className="iw-scene-details-panel__cast-row"
                direction="row"
                spacing={1}
                alignItems="center"
              >
                <Typography sx={{ flex: 1, fontSize: 14 }}>
                  {npc?.name ?? member.npcId}
                  <Box component="span" sx={{ opacity: 0.6, ml: 0.5 }}>
                    ({member.col}, {member.row})
                  </Box>
                </Typography>
                <TextField
                  label="Facing" size="small" select sx={{ width: 90 }}
                  value={member.facing}
                  onChange={(e) => onUpdateCastMember(member.npcId, { facing: e.target.value as IWSceneCastMember['facing'] })}
                >
                  {IW_FACINGS.map((f) => <MenuItem key={f} value={f}>{f.toUpperCase()}</MenuItem>)}
                </TextField>
                <IconButton
                  className="iw-scene-details-panel__place-npc"
                  size="small"
                  title="Place on the map"
                  onClick={() => onPlaceNpc(member.npcId)}
                >
                  <MyLocationIcon fontSize="small" />
                </IconButton>
                <IconButton
                  className="iw-scene-details-panel__remove-npc"
                  size="small"
                  title="Remove from the scene"
                  onClick={() => onRemoveCastMember(member.npcId)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
                {problem(`npcCast[${i}].col`) && (
                  <Typography color="error" sx={{ fontSize: 11 }}>{problem(`npcCast[${i}].col`)}</Typography>
                )}
              </Stack>
            );
          })}
        </Stack>
      </Box>

      <Box className="iw-scene-details-panel__completion" sx={SECTION_SX}>
        <Typography variant="overline">Completion</Typography>
        <Typography sx={{ fontSize: 12, opacity: 0.7, mb: 1 }}>
          A scene ends when one NPC does one thing — never on a counter, and it can never be
          failed. Only a cast member written with a completion rule can be chosen.
        </Typography>
        <Stack direction="row" spacing={1.5}>
          <TextField
            className="iw-scene-details-panel__completer"
            label="Who" size="small" select fullWidth
            value={completerOptions.some((n) => n.id === scene.completerNpcId) ? scene.completerNpcId : ''}
            error={!!problem('completerNpcId')}
            helperText={problem('completerNpcId') ??
              (completerOptions.length === 0 ? 'Add an NPC who can complete a scene to the cast.' : undefined)}
            onChange={(e) => onUpdate({ completerNpcId: e.target.value })}
          >
            {completerOptions.map((npc) => (
              <MenuItem key={npc.id} value={npc.id}>{npc.name}</MenuItem>
            ))}
          </TextField>
          {/* The completion action is one of the completer's OWN authored actions — there is
              no fixed list of ending verbs. Empty until an NPC is chosen and given actions,
              which is the right shape: you cannot nominate an ending you have not written. */}
          <TextField
            className="iw-scene-details-panel__completion-action"
            label="Does what" size="small" select fullWidth
            value={completerActions.some((a) => a.id === scene.completionAction) ? scene.completionAction : ''}
            error={!!problem('completionAction')}
            helperText={problem('completionAction') ??
              (scene.completerNpcId && completerActions.length === 0
                ? 'Program an action for this NPC first — the one that ends the scene.'
                : undefined)}
            disabled={completerActions.length === 0}
            onChange={(e) => onUpdate({ completionAction: e.target.value })}
          >
            {completerActions.map((action) => (
              <MenuItem key={action.id} value={action.id}>{action.name || action.id}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </Box>
    </Box>
  );
}
