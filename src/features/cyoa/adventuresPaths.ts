/**
 * adventuresPaths.ts — the Adventures (cyoa) route paths, in one place
 * (docs/CYOA_FEATURE.md § 7).
 *
 * The route ROWS live in src/routes/routeMeta.ts and the menu row in
 * src/components/menuPopover/menuDestinations.ts; those files spell the paths as literals
 * (every other row does), so a rename must touch them too. This module is for the
 * feature's own navigate() calls.
 *
 * Layer: feature constants (src/features/cyoa). Depended on by: AdventuresPage.tsx,
 * StoryPlayPage.tsx, StoryEditorPage.tsx, PassageEditorPage.tsx.
 */

/** The story list. */
export const ADVENTURES_LIST_PATH = "/adventures";

/** One story's reader. */
export function storyPlayPath(storyId: string): string {
    return `${ADVENTURES_LIST_PATH}/${encodeURIComponent(storyId)}`;
}

/** The author's story editor (§ 5): title, icon, publish, the passage list. */
export function storyEditPath(storyId: string): string {
    return `${storyPlayPath(storyId)}/edit`;
}

/** The author's passage editor: the text, the ending name, up to four choices. */
export function passageEditPath(storyId: string, passageId: string): string {
    return `${storyEditPath(storyId)}/${encodeURIComponent(passageId)}`;
}
