import { apiGet, apiPost, apiDelete, withFallback, ApiError } from '../../api/http';
import { DIRT_FLOOR, type EditorMasks } from '../../engine/market/farmTerrain';
import type { Direction } from '../../engine/market/freeFarmTileset';
import { furnitureSpriteExists, isFurniturePlacement } from '../../engine/market/furniture';
import { freeFarmTileset } from '../../engine/market/freeFarmTileset';
import type {
  IWNpcOption,
  IWScene,
  IWSceneFloor,
  IWSceneLayout,
  IWSceneSummary,
} from '../../../server/contracts/iw';

/**
 * Client API for the Immersive World scene editor (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * Every call goes through `src/api/http.ts` — base URL, Authorization read fresh at call
 * time, throw-on-non-2xx — and **no function here takes a `token`**
 * (docs/FRONTEND_LAYERING.md). Paths are camelCase and must stay in step with
 * `server/routes/immersiveWorldRoutes.ts`.
 *
 * The wire types come from `server/contracts/iw.ts`: the server owns the contract and the
 * client conforms, exactly as `src/types.ts` reaches into `server/contracts/wire.ts`.
 *
 * The whole surface is template-author-gated SERVER-side
 * (`ImmersiveWorldSceneService.assertTemplateAuthor`, phase 1e); the page's own gate is a
 * courtesy that keeps a non-author from staring at an editor that will refuse every save.
 */

export type { IWNpcOption, IWScene, IWSceneFloor, IWSceneLayout, IWSceneSummary };

/**
 * One field-level complaint from the server's scene validator, so the editor can mark up the
 * field. Mirrors `IWSceneProblem` in `server/services/iw/sceneValidation.ts`.
 *
 * It arrives on either of two paths, and the `severity` says which: `'error'` means the save
 * was REFUSED (a structural fault the row cannot hold — a blank name, a broken board), and
 * anything else is a WARNING that came back with a scene that saved fine.
 */
export interface IWSceneProblem {
  field: string;
  message: string;
  severity?: 'error' | 'warning';
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout ⇄ editor masks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialize the painted layers into a scene `layout`.
 *
 * Mirrors `masksToDefinition` in the night market's `templateEditorApi.ts` MINUS the two
 * night-market-only lists: a scene has no occupant slots to unlock (`placeholder`) and no
 * per-version overlay (`condition`). Decor URLs are resolved back to their stable filename
 * STEM through the tileset, so a stored layout survives asset re-fingerprinting across
 * builds — the same reason that function does it.
 */
export function masksToSceneLayout(
  masks: EditorMasks,
  places: Record<string, string> = {},
): IWSceneLayout {
  const decor: Record<string, string> = {};
  for (const [cell, url] of [...masks.decor].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const stem = freeFarmTileset.stemOf(url);
    if (stem) decor[cell] = stem; // skip any unresolved url defensively
  }
  return {
    terrain1: [...masks.terrain1],
    terrain2: [...masks.terrain2],
    // NO street/communal: those are the night market's two WALKABLE classes, and a scene
    // paints the inverse (IWSceneLayout's header). The editor never paints them, so
    // `masks.street`/`masks.communal` are always empty here — they exist only because
    // `EditorMasks` is the night market's shape.
    //
    // The scene's OWN two masks (2026-09-19) do ride in EditorMasks, like `floor` and
    // `furniture` before them, so they need no separate argument. Both are sorted for the
    // same reason the decor map is: an unchanged board must produce an unchanged jsonb blob.
    unwalkable: [...(masks.unwalkable ?? [])].sort(),
    forcedDirection: Object.fromEntries(
      [...(masks.forcedDirection ?? [])].sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    decor,
    // Named places (§ 14 Q42) are NOT part of EditorMasks — that type is the night market's
    // and has no concept of a tagged cell — so the draft keeps them alongside the masks and
    // they are folded in here, at the same seam where the masks are.
    //
    // ⚠️ WRITES `places` ONLY (2026-09-06). The pre-rename key was `locations`, and this is
    // the ONE writer of either — so every save heals a row that still carries the old one.
    // Reads go through `scenePlaces`, never through the field, precisely because the two
    // sides are deliberately asymmetric.
    places,
    // Placed furniture (the lumeish pack). Sorted by anchor so an unchanged board produces an
    // unchanged jsonb blob — the same stable-diff treatment the decor map gets above.
    furniture: [...(masks.furniture ?? [])]
      .sort((a, b) => a.col - b.col || a.row - b.row || a.id - b.id),
    // The board floor rides in the layout because that is where everything spatial lives.
    // Written even when it is dirt, so a scene that was decked and then reverted persists
    // the revert rather than falling back to the "absent ⇒ dirt" default by accident.
    floor: masks.floor ?? DIRT_FLOOR,
  };
}

/**
 * Rebuild the editor's mask layers from a stored scene `layout`.
 *
 * `placeholder`, `condition`, `street` and `communal` come back EMPTY and stay empty: `EditorMasks` is the
 * night market editor's shape and the shared viewer expects those keys, but a scene never
 * paints them. That is the one place iw pays for reusing the nme's authoring surface, and
 * it is cheaper than forking the viewer.
 */
export function sceneLayoutToMasks(layout: IWSceneLayout | undefined): EditorMasks {
  const decor = new Map<string, string>();
  for (const [cell, stem] of Object.entries(layout?.decor ?? {})) {
    const url = freeFarmTileset.get(stem);
    if (url) decor.set(cell, url);
  }
  return {
    terrain1: new Set(layout?.terrain1 ?? []),
    terrain2: new Set(layout?.terrain2 ?? []),
    // The scene's two walkability masks. ABSENT ⇒ EMPTY, with no fallback to the old
    // derive-from-blocking-decor rule: the 2026-09-19 cutover was deliberate (see
    // IWSceneLayout's header), so a pre-cutover scene opens fully walkable and is repainted
    // by hand. Reading `layout.decor` here to synthesize walls would quietly re-create the
    // object↔walkability coupling the change exists to remove.
    unwalkable: new Set(layout?.unwalkable ?? []),
    forcedDirection: new Map(
      Object.entries(layout?.forcedDirection ?? {}) as [string, Direction][],
    ),
    // Empty like placeholder/condition below, and for the same reason — but note these two
    // USED to be authored (before 2026-09-05). A layout stored back then still carries the
    // keys; dropping them here is what retires them, with no migration.
    street: new Set<string>(),
    communal: new Set<string>(),
    placeholder: [],
    condition: new Set<string>(),
    decor,
    // Furniture placements. Structurally-invalid records are dropped, and so are placements
    // whose sprite the pack no longer ships — a stale id would occupy cells invisibly and
    // could never be erased. Scenes authored before the Furniture tool carry no key at all.
    furniture: (Array.isArray(layout?.furniture) ? layout.furniture : [])
      .filter(isFurniturePlacement)
      .filter(furnitureSpriteExists),
    // Scenes authored before the floor row carry no `floor` at all — they are dirt boards.
    floor: layout?.floor ?? DIRT_FLOOR,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Calls
// ─────────────────────────────────────────────────────────────────────────────

/** Scene summaries for the Load list, newest-updated first. */
export async function listScenes(language?: 'zh' | 'es'): Promise<IWSceneSummary[]> {
  const data = await withFallback(
    apiGet<{ scenes?: IWSceneSummary[] }>('/api/immersiveWorld/scenes', {
      params: language ? { language } : undefined,
    }),
    'Failed to list scenes',
  );
  return data.scenes ?? [];
}

/** One whole scene, blobs inline. */
export async function loadScene(id: string): Promise<IWScene> {
  const data = await withFallback(
    apiGet<{ scene: IWScene }>(`/api/immersiveWorld/scenes/${encodeURIComponent(id)}`),
    'Failed to load scene',
  );
  return data.scene;
}

/**
 * The cast for one language — the NPC picker's source. An author chooses WHICH NPC stands
 * where; they never write NPC text (§ 11 layer 1), which is why this returns a projection
 * and not the NPC.
 */
export async function listNpcs(language: 'zh' | 'es'): Promise<IWNpcOption[]> {
  const data = await withFallback(
    apiGet<{ npcs?: IWNpcOption[] }>('/api/immersiveWorld/npcs', { params: { language } }),
    'Failed to list NPCs',
  );
  return data.npcs ?? [];
}

/** Whether `name` is free within `language`. `exceptId` excludes the scene being renamed. */
export async function checkSceneNameAvailable(
  language: 'zh' | 'es',
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const data = await withFallback(
    apiGet<{ available?: boolean }>('/api/immersiveWorld/scenes/nameAvailable', {
      params: exceptId ? { language, name, exceptId } : { language, name },
    }),
    'Failed to check scene name',
  );
  return !!data.available;
}

/**
 * Create (no `id`) or overwrite (`id` present) one scene.
 *
 * Resolves with the stored scene AND the validator's `warnings` — a save SUCCEEDS with a
 * half-built scene (2026-09-05), so "saved" and "finished" are two different answers and the
 * caller gets both. Only a structural fault throws, and that ApiError's body carries
 * `problems` — every field-level complaint at once, because fixing a scene one error per
 * round trip is the tool being annoying in exactly the way phase 1's kill condition describes.
 */
export async function saveScene(scene: IWScene): Promise<{ scene: IWScene; warnings: IWSceneProblem[] }> {
  const data = await withFallback(
    apiPost<{ scene: IWScene; warnings?: IWSceneProblem[] }>('/api/immersiveWorld/scenes', { scene }),
    'Failed to save scene',
  );
  return { scene: data.scene, warnings: Array.isArray(data.warnings) ? data.warnings : [] };
}

/** Delete a scene. Refused with 409 once the scene has been played — unpublish instead. */
export async function deleteScene(id: string): Promise<void> {
  await withFallback(
    apiDelete<unknown>(`/api/immersiveWorld/scenes/${encodeURIComponent(id)}`),
    'Failed to delete scene',
  );
}

/**
 * Pull the per-field `problems` list off a thrown ApiError, if it carries one.
 * `ApiError` (src/api/http.ts) keeps the parsed error body at `response.data`, so this is
 * the one place that shape is read.
 */
/**
 * The message to show for a failed call, or `fallback` when the error carries none.
 *
 * Exists so the editor page never has to type `catch (error: any)` to reach `.message` —
 * five of those were the only ESLint ERRORS in the whole client, and each one silently
 * opted that catch block out of type checking. Sits beside {@link problemsFromError}
 * because both answer the same question: what does this rejected promise actually say?
 */
export function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

export function problemsFromError(error: unknown): IWSceneProblem[] {
  const body = (error as ApiError | undefined)?.response?.data as { problems?: unknown } | undefined;
  return Array.isArray(body?.problems) ? (body.problems as IWSceneProblem[]) : [];
}
