import { ICommunityLayoutDAL } from '../dal/interfaces/ICommunityLayoutDAL.js';
import { VocabEntryService } from './VocabEntryService.js';
import { Language, IconLayoutItem } from '../types/index.js';
import { ValidationError, NotFoundError } from '../types/dal.js';
import { isAdvancedLayout } from '../dal/shared/advancedLayout.js';
import {
  CommunityDesign,
  VotedDesignKey,
  VoteResult,
  ApplyDesignResult,
} from '../types/community.js';

/**
 * Orchestrates the Community page (docs/COMMUNITY_PAGE.md): paginated feeds of other users'
 * advanced card-icon layouts, the once-a-week upvote rule, and copying a design onto the
 * viewer's own card. Feed reads + the vote log live in the DAL; the apply flow reuses
 * VocabEntryService (addToLibrary + updateIconLayout) so card-creation/validation stay in one
 * place.
 */
export class CommunityLayoutService {
  constructor(
    private communityLayoutDAL: ICommunityLayoutDAL,
    private vocabEntryService: VocabEntryService,
  ) {}

  getLearningFeed(
    viewerUserId: string,
    language: Language,
    excludeOwners: string[],
    excludeKeys: string[],
    limit: number,
  ): Promise<CommunityDesign[]> {
    return this.communityLayoutDAL.getLearningFeed(viewerUserId, language, excludeOwners, excludeKeys, limit);
  }

  getTopFeed(
    viewerUserId: string,
    language: Language,
    excludeOwners: string[],
    excludeKeys: string[],
    limit: number,
  ): Promise<CommunityDesign[]> {
    return this.communityLayoutDAL.getTopFeed(viewerUserId, language, excludeOwners, excludeKeys, limit);
  }

  getMyVotesThisWeek(viewerUserId: string): Promise<VotedDesignKey[]> {
    return this.communityLayoutDAL.getMyVotesThisWeek(viewerUserId);
  }

  /** Cast a vote (rejected with 'already-voted' if the viewer already voted this design this week). */
  vote(
    voterUserId: string,
    ownerUserId: string,
    entryKey: string,
    language: Language,
  ): Promise<VoteResult> {
    if (voterUserId === ownerUserId) {
      // Shouldn't reach here (feeds exclude the viewer's own designs), but guard anyway.
      throw new ValidationError('You cannot vote for your own design');
    }
    return this.communityLayoutDAL.recordVote(voterUserId, ownerUserId, entryKey, language);
  }

  /** Remove the voter's vote for a design this week (toggle off). Idempotent: false if none existed. */
  unvote(
    voterUserId: string,
    ownerUserId: string,
    entryKey: string,
    language: Language,
  ): Promise<boolean> {
    return this.communityLayoutDAL.removeVote(voterUserId, ownerUserId, entryKey, language);
  }

  /**
   * Copy an owner's advanced design onto the viewer's card.
   *   - viewer doesn't own the word      → add it to the library, then apply → 'added-and-applied'
   *   - viewer owns it, has an advanced
   *     layout, and override !== true     → 'would-override' (no write; client confirms first)
   *   - otherwise                         → overwrite/apply → 'applied'
   * Icons are global (icons8 table), so copying the jsonb needs no per-user download.
   */
  async applyDesign(
    viewerUserId: string,
    ownerUserId: string,
    entryKey: string,
    language: Language,
    override: boolean,
  ): Promise<ApplyDesignResult> {
    if (viewerUserId === ownerUserId) {
      throw new ValidationError('You cannot apply your own design');
    }

    // Snapshot the owner's design and confirm it's genuinely advanced (feeds only show these,
    // but the owner could have changed it between page load and apply).
    const snapshot = await this.communityLayoutDAL.getDesignLayout(ownerUserId, entryKey, language);
    if (!isAdvancedLayout(snapshot)) {
      throw new NotFoundError('That design is no longer available');
    }
    const layout = snapshot as IconLayoutItem[];

    const existing = await this.communityLayoutDAL.findViewerEntry(viewerUserId, entryKey, language);

    if (!existing) {
      // Section-2 "Add card & design": create the card, then apply.
      const { vocabEntryId } = await this.vocabEntryService.addToLibrary(viewerUserId, entryKey, language);
      await this.vocabEntryService.updateIconLayout(viewerUserId, vocabEntryId, language, layout);
      return 'added-and-applied';
    }

    // The viewer already owns the word. Block silently overwriting a hand-made advanced design.
    if (isAdvancedLayout(existing.iconLayout) && !override) {
      return 'would-override';
    }

    await this.vocabEntryService.updateIconLayout(viewerUserId, existing.id, language, layout);
    return 'applied';
  }
}
