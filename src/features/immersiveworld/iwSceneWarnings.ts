import type { TextFieldProps } from '@mui/material';

/**
 * Inline marking for the scene editor's validator complaints.
 *
 * LAYER: feature-local view helper. It holds no state and makes no server call — it only
 * turns "this field has a complaint" into MUI props, so the three authoring panels mark a
 * field the same way without each inventing its own colour.
 *
 * WHY AMBER AND NOT RED (2026-09-05). The server validator no longer refuses a save over an
 * unfinished scene: `saveScene` stores it and hands back `warnings`
 * (`server/services/iw/sceneValidation.ts`). A field painted with MUI's `error` colour would
 * be telling the author their work was rejected when it was in fact saved, so warnings get
 * the warning palette. The rare STRUCTURAL refusal is announced by the page's red banner —
 * the one place that still means "this did not save".
 *
 * Referenced by: IWSceneDetailsPanel, IWSceneContentPanel, IWSceneActionsPanel,
 * IWSceneEditorPage (which builds the map). Documented in docs/IMMERSIVE_WORLD.md § 12.
 */

/** Field path ("npcCast[2].npcId") → the first complaint against it. */
export type IWWarningsByField = Map<string, string>;

/**
 * MUI TextField props marking one field's warning, or nothing when the field is clean.
 *
 * Deliberately returns NO `sx`: several call sites pass their own (a fixed width, a top
 * margin), and a returned `sx` would silently win or lose depending on spread order. The
 * amber comes from `color` + `focused` (border and label) and from `FormHelperTextProps`
 * (the message), none of which any call site sets.
 */
export function warningFieldProps(
  warnings: IWWarningsByField,
  field: string,
): Partial<TextFieldProps> {
  const message = warnings.get(field);
  if (!message) return {};
  return {
    color: 'warning',
    focused: true,
    helperText: message,
    FormHelperTextProps: { sx: { color: 'warning.main' } },
  };
}

/** Colour for a warning shown as loose text, where there is no field to attach it to. */
export const IW_WARNING_TEXT_SX = { color: 'warning.main' } as const;
