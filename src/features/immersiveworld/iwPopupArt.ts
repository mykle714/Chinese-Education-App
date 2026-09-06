/**
 * iwPopupArt — the catalogue of pictures a place INTERACTION can show the learner
 * (`popup` step; docs/IMMERSIVE_WORLD.md § 5.4a, § 14 Q43, migration 162).
 *
 * LAYER: feature module, client-only. It resolves art, makes no server call and holds no
 * state.
 *
 * THE CATALOGUE IS A FOLDER, NOT A CONSTANT. Everything in `src/assets/iw-popups/` is
 * offered; adding popup art is dropping a file in, with no code change. That is a deliberate
 * choice about who the tool is for — § 12 phase 1's kill condition is "an author cannot
 * assemble a working scene without engineering help", and a hand-maintained id list would put
 * an engineer between an author and every new picture.
 *
 * ⚠️ **WHICH IS WHY THE SERVER CANNOT VALIDATE AN ID.** These files are client assets behind
 * Vite's fingerprinting; `sceneValidation.ts` never sees them, so it checks only that an id is
 * SHAPED like a file stem (`IW_POPUP_IMAGE_ID`). The editor closes the gap from the other
 * side by only ever offering ids that resolved here. A stem whose file was later deleted shows
 * as a missing picture in the editor — an authoring trap, which § 14 Q42 sub-answer 3 puts
 * squarely on the author.
 *
 * WHY THE STEM AND NOT THE URL IS STORED: the URL carries a content hash that changes on every
 * asset rebuild, so a stored URL would rot at the next deploy. Same reason
 * `masksToSceneLayout` stores decor STEMS — see `immersiveWorldSceneApi.ts`.
 *
 * Referenced by: src/features/immersiveworld/IWScenePlacesPanel.tsx.
 * Documented in docs/IMMERSIVE_WORLD.md § 5.4a.
 */

/**
 * Every file in the popup art folder, eagerly resolved to its final URL.
 *
 * Eager rather than lazy because the picker renders every thumbnail at once — a lazy glob
 * would turn opening one dropdown into a burst of dynamic imports.
 */
const POPUP_MODULES = import.meta.glob<string>(
  '../../assets/iw-popups/*.{png,jpg,jpeg,webp,svg}',
  { eager: true, query: '?url', import: 'default' },
);

/** One picture an author can choose. `id` is the file stem, and it is what gets stored. */
export interface IWPopupImage {
  id: string;
  url: string;
}

/** `../../assets/iw-popups/tea_menu.png` → `tea_menu`. */
const stemOf = (path: string): string =>
  path.split('/').pop()!.replace(/\.[^.]+$/, '');

/**
 * The catalogue, alphabetical by id — a stable order, so the picker does not reshuffle
 * itself when an unrelated file is added.
 */
export const IW_POPUP_IMAGES: IWPopupImage[] = Object.entries(POPUP_MODULES)
  .map(([path, url]) => ({ id: stemOf(path), url }))
  .sort((a, b) => (a.id < b.id ? -1 : 1));

/** The URL for a stored id, or undefined when its file is gone. */
export const popupImageUrl = (id: string): string | undefined =>
  IW_POPUP_IMAGES.find((img) => img.id === id)?.url;
