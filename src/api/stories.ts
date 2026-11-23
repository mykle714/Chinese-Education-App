/**
 * stories.ts — Adventures (cyoa) API calls (docs/CYOA_FEATURE.md § 6.3).
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 nothing here takes a `token`: every call goes through
 * src/api/http.ts, which resolves the Authorization header at call time.
 *
 * Wire types come straight from the shared contract (server/contracts/stories.ts), so
 * there is no client-side mirror to drift.
 *
 * Server: server/routes/storyRoutes.ts → StoryController. Mounted only while
 * FEATURE_FLAGS.cyoa is on; with it off every call 404s (the client hides the entry points
 * under the same flag, so nothing calls these).
 *
 * Callers: features/cyoa/AdventuresPage.tsx (list, create), features/cyoa/useStoryPlay.ts
 * (play, choose), features/cyoa/useStoryEdit.ts (every author call). Every author call is
 * refused server-side (403) unless users."isAuthor" AND the story is the caller's own.
 */
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './http';
import type {
    StoryChooseBody,
    StoryCreateBody,
    StoryEditResponse,
    StoryListResponse,
    StoryPassageEdit,
    StoryPassageOrderBody,
    StoryPassageSaveBody,
    StoryPlayResponse,
    StoryPublishResponse,
    StoryUpdateBody,
} from '../../server/contracts/stories';

/** `/api/stories/:id` — every story-scoped path starts here. */
const storyPath = (storyId: string) => `/api/stories/${encodeURIComponent(storyId)}`;

/** The learner list: published stories plus, for an author, their own drafts. */
export function fetchStories(): Promise<StoryListResponse> {
    return apiGet<StoryListResponse>('/api/stories');
}

/**
 * Open a story: resumes on the saved passage, or starts at the start passage. 404 when the
 * story is unpublished/deleted (and not the caller's own).
 */
export function fetchStoryPlay(storyId: string): Promise<StoryPlayResponse> {
    return apiGet<StoryPlayResponse>(`${storyPath(storyId)}/play`);
}

/**
 * Take a choice on the current passage. The server saves progress (or records the ending)
 * and returns the passage the choice leads to. 400 when the choice is no longer on the
 * learner's current passage (an author edit replaced it) or has no target yet.
 */
export function chooseStoryChoice(storyId: string, choiceId: string): Promise<StoryPlayResponse> {
    const body: StoryChooseBody = { choiceId };
    return apiPost<StoryPlayResponse>(`${storyPath(storyId)}/choose`, body);
}

// ── Author (docs/CYOA_FEATURE.md § 5) ─────────────────────────────────────────

/** A new story with one empty start passage. */
export function createStory(body: StoryCreateBody): Promise<StoryEditResponse> {
    return apiPost<StoryEditResponse>('/api/stories', body);
}

/** The whole graph plus the live publish warnings. */
export function fetchStoryEdit(storyId: string): Promise<StoryEditResponse> {
    return apiGet<StoryEditResponse>(`${storyPath(storyId)}/edit`);
}

/** Title, icon and/or start passage. Returns the whole graph again. */
export function updateStory(storyId: string, body: StoryUpdateBody): Promise<StoryEditResponse> {
    return apiPatch<StoryEditResponse>(storyPath(storyId), body);
}

/** Delete the story and everything under it (learners' progress and endings too). */
export function deleteStory(storyId: string): Promise<void> {
    return apiDelete<void>(storyPath(storyId));
}

/** A new empty passage (no choices — so an ending until it gets some). */
export function createStoryPassage(storyId: string): Promise<StoryPassageEdit> {
    return apiPost<StoryPassageEdit>(`${storyPath(storyId)}/passages`);
}

/** Set the passages' order (exactly the story's passage ids). Returns the whole graph again. */
export function reorderStoryPassages(storyId: string, passageIds: string[]): Promise<StoryEditResponse> {
    const body: StoryPassageOrderBody = { passageIds };
    return apiPut<StoryEditResponse>(`${storyPath(storyId)}/passages/order`, body);
}

/** Copy a passage (body, ending name, choices) into a new one right after it. Returns the whole graph again. */
export function duplicateStoryPassage(storyId: string, passageId: string): Promise<StoryEditResponse> {
    return apiPost<StoryEditResponse>(`${storyPath(storyId)}/passages/${encodeURIComponent(passageId)}/duplicate`);
}

/** Overwrite a passage; its choices are REPLACED (new ids). */
export function saveStoryPassage(storyId: string, passageId: string, body: StoryPassageSaveBody): Promise<StoryPassageEdit> {
    return apiPut<StoryPassageEdit>(`${storyPath(storyId)}/passages/${encodeURIComponent(passageId)}`, body);
}

/** Delete a passage (400 for the start passage). Choices into it lose their target. */
export function deleteStoryPassage(storyId: string, passageId: string): Promise<void> {
    return apiDelete<void>(`${storyPath(storyId)}/passages/${encodeURIComponent(passageId)}`);
}

/** Publish: computes the story's commonality; warns, never blocks. */
export function publishStory(storyId: string): Promise<StoryPublishResponse> {
    return apiPost<StoryPublishResponse>(`${storyPath(storyId)}/publish`);
}

/** Hide from learners; their progress and endings are kept. */
export function unpublishStory(storyId: string): Promise<void> {
    return apiPost<void>(`${storyPath(storyId)}/unpublish`);
}
