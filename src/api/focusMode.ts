/**
 * focusMode.ts — the client's calls to `/api/focus` (docs/FOCUS_MODE.md § 6).
 *
 * Takes no `token` (docs/FRONTEND_LAYERING.md § 3.2): src/api/http.ts reads auth at call
 * time. Server counterpart: server/controllers/FocusModeController.ts.
 *
 * Called by: src/features/focusMode/* and src/features/deckTower/useFocusLever.ts.
 */
import { apiGet, apiPost } from './http';
import type { FocusStatusResponse } from '../../server/contracts/focusMode';
import type { MasteryWorldId } from '../../server/contracts/wire';

/** Every world's focus state. Takes today's snapshot for a focused world that has none. */
export function fetchFocusStatus(): Promise<FocusStatusResponse> {
    return apiGet<FocusStatusResponse>('/api/focus');
}

/** The Deck Tower lever: switch one world's focus mode on or off. */
export function setFocusMode(world: MasteryWorldId, on: boolean): Promise<FocusStatusResponse> {
    return apiPost<FocusStatusResponse>('/api/focus', { world, on });
}

/** Tell the server these worlds' "focus mode turned off" popups were shown. */
export function acknowledgeFocusNotices(worlds: MasteryWorldId[]): Promise<void> {
    return apiPost<void>('/api/focus/notices/ack', { worlds });
}
