import { useCallback, useEffect, useState } from 'react';

/**
 * useIWEditorLayout — which of the scene editor's side columns are open, and which page the
 * left column is showing (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * LAYER: feature view plumbing. Pure chrome state: nothing here describes a scene, so it is
 * deliberately NOT part of the draft and never makes the editor dirty.
 *
 * WHY IT PERSISTS. Authoring a scene is a long sitting across many loads, and an author who
 * has hidden the details column to paint a board wants it still hidden when they come back.
 * `localStorage` rather than the account: it is a per-BROWSER preference about screen width,
 * not something to sync to a phone, and it needs no column, no endpoint and no migration.
 *
 * EVERY ACCESS IS GUARDED. `localStorage` throws in a private window and can come back with
 * anything at all (hand-edited, or written by an older build), so a read that fails or parses
 * to the wrong shape falls back to {@link DEFAULT_LAYOUT} rather than taking the page down.
 */

/** The left column's two pages: the scene's fields, or the board's tools. */
export type IWLeftPage = 'details' | 'tools';

export interface IWEditorLayout {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftPage: IWLeftPage;
}

/** Everything open, fields first — what a first-time author should meet. */
const DEFAULT_LAYOUT: IWEditorLayout = {
  leftCollapsed: false,
  rightCollapsed: false,
  leftPage: 'details',
};

/** Versioned so a future shape change starts from the defaults instead of half-reading. */
const STORAGE_KEY = 'iw-editor-layout-v1';

function readStored(): IWEditorLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<IWEditorLayout> | null;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_LAYOUT;
    return {
      leftCollapsed: typeof parsed.leftCollapsed === 'boolean' ? parsed.leftCollapsed : DEFAULT_LAYOUT.leftCollapsed,
      rightCollapsed: typeof parsed.rightCollapsed === 'boolean' ? parsed.rightCollapsed : DEFAULT_LAYOUT.rightCollapsed,
      leftPage: parsed.leftPage === 'tools' || parsed.leftPage === 'details' ? parsed.leftPage : DEFAULT_LAYOUT.leftPage,
    };
  } catch {
    // Blocked site data, a private window, or a value some other build wrote.
    return DEFAULT_LAYOUT;
  }
}

export interface IWEditorLayoutControls extends IWEditorLayout {
  setLeftCollapsed: (collapsed: boolean) => void;
  setRightCollapsed: (collapsed: boolean) => void;
  /** Picking a page also REVEALS the left column — see the note on the setter. */
  setLeftPage: (page: IWLeftPage) => void;
}

export function useIWEditorLayout(): IWEditorLayoutControls {
  // Read once, lazily: the initializer runs on mount only, so a second editor mount in the
  // same session does not re-parse and cannot fight the first one's writes.
  const [layout, setLayout] = useState<IWEditorLayout>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Not being able to REMEMBER the layout is not a reason to stop honouring it.
    }
  }, [layout]);

  const setLeftCollapsed = useCallback(
    (leftCollapsed: boolean) => setLayout((l) => ({ ...l, leftCollapsed })), [],
  );
  const setRightCollapsed = useCallback(
    (rightCollapsed: boolean) => setLayout((l) => ({ ...l, rightCollapsed })), [],
  );

  // Asking for a page while the column is hidden can only mean "show me that page" — the
  // cast list's "place this NPC" button does exactly that, jumping from the details page to
  // the tools page, and it must work whether or not the column happens to be open.
  const setLeftPage = useCallback(
    (leftPage: IWLeftPage) => setLayout((l) => ({ ...l, leftPage, leftCollapsed: false })), [],
  );

  return { ...layout, setLeftCollapsed, setRightCollapsed, setLeftPage };
}
