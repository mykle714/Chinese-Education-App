import { useEffect, useRef } from "react";
import { Box, TextField, InputAdornment, IconButton, Typography, Divider, CircularProgress } from "@mui/material";
import { Search, Clear } from "@mui/icons-material";
import CommunityFeedRow from "./CommunityFeedRow";
import { fetchEntryFeed } from "./communityApi";
import { useDictionarySearch } from "../../hooks/useDictionarySearch";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";
import type { CommunityDesign, DictionaryEntry, Language } from "../../types";

// Supplementary to the dictionary page's own search — no pagination UI, just enough results to
// head a handful of per-entry design rows.
const SEARCH_LIMIT = 20;

/** One matched dictionary entry, headed by its word + gloss, followed by its designs feed. */
const EntryDesignsSection: React.FC<{
  entry: DictionaryEntry;
  token: string | null;
  language: Language;
  votedKeys: Set<string>;
  voteDeltas: Map<string, number>;
  onVoteChange: (design: CommunityDesign, voted: boolean) => void;
}> = ({ entry, token, language, votedKeys, voteDeltas, onVoteChange }) => (
  <Box className="community-search-bar__entry-section" sx={{ mb: 2 }}>
    <Box sx={{ px: 2, mb: 0.5 }}>
      <Typography sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: COLORS.onSurface }}>
        {entry.word1}
        {entry.pronunciation ? ` · ${entry.pronunciation}` : ""}
      </Typography>
      {entry.definitions?.[0] && (
        <Typography sx={{ fontSize: SIZE.caption, color: COLORS.textSecondary }} noWrap>
          {entry.definitions[0]}
        </Typography>
      )}
    </Box>
    <CommunityFeedRow
      title=""
      fetchPage={(owners, keys, limit) => fetchEntryFeed(token, language, entry.word1, owners, keys, limit)}
      votedKeys={votedKeys}
      voteDeltas={voteDeltas}
      onVoteChange={onVoteChange}
      token={token}
      language={language}
      emptyHint="No shared designs yet for this word."
    />
  </Box>
);

/**
 * Community page's search bar (docs/COMMUNITY_PAGE.md) — shares its search behavior
 * (`useDictionarySearch`) with the dictionary page: 400ms-debounced input, CJK-segment mode for
 * multi-character Chinese input, plain `/api/dictionary/search` otherwise (including
 * numbered-pinyin queries like "jian4 shen1" — see DictionaryDAL's `buildNumberedPinyinPattern`).
 * Instead of showing dictionary entry cards, each matched entry heads a "highest rated designs
 * for this word" feed (CommunityFeedRow, scoped to that entry via /api/community/entry-feed).
 */
const CommunitySearchBar: React.FC<{
  token: string | null;
  language: Language;
  votedKeys: Set<string>;
  voteDeltas: Map<string, number>;
  onVoteChange: (design: CommunityDesign, voted: boolean) => void;
  onActiveChange: (active: boolean) => void;
}> = ({ token, language, votedKeys, voteDeltas, onVoteChange, onActiveChange }) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const {
    searchInput, setSearchInput, debouncedSearchTerm, entries, segmentGroups,
    isSegmentMode, loading, clearSearch,
  } = useDictionarySearch(SEARCH_LIMIT);

  useEffect(() => {
    onActiveChange(debouncedSearchTerm.trim().length > 0);
  }, [debouncedSearchTerm, onActiveChange]);

  return (
    <Box className="community-search-bar">
      <Box sx={{ px: 2, mt: 2, mb: 2 }}>
        <TextField
          className="community-search-bar__input"
          fullWidth
          placeholder={`Search ${language.toUpperCase()} dictionary for designs...`}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          inputRef={searchInputRef}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search />
              </InputAdornment>
            ),
            endAdornment: searchInput && (
              <InputAdornment position="end">
                <IconButton aria-label="clear search" onClick={clearSearch} edge="end" size="small">
                  <Clear />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {!loading && isSegmentMode && segmentGroups.length > 0 && (
        <Box>
          {segmentGroups.filter((g) => g.exactEntries.length > 0).map((group, idx) => (
            <Box key={`exact-${group.segment}`}>
              {idx > 0 && <Divider sx={{ my: 2 }} />}
              {group.exactEntries.map((entry) => (
                <EntryDesignsSection
                  key={entry.id}
                  entry={entry}
                  token={token}
                  language={language}
                  votedKeys={votedKeys}
                  voteDeltas={voteDeltas}
                  onVoteChange={onVoteChange}
                />
              ))}
            </Box>
          ))}
          {segmentGroups.filter((g) => g.prefixEntries.length > 0).map((group) => (
            <Box key={`prefix-${group.segment}`}>
              <Divider sx={{ my: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Starts with "{group.segment}"
                </Typography>
              </Divider>
              {group.prefixEntries.map((entry) => (
                <EntryDesignsSection
                  key={entry.id}
                  entry={entry}
                  token={token}
                  language={language}
                  votedKeys={votedKeys}
                  voteDeltas={voteDeltas}
                  onVoteChange={onVoteChange}
                />
              ))}
            </Box>
          ))}
        </Box>
      )}

      {!loading && !isSegmentMode && entries.length > 0 && (
        <Box>
          {entries.map((entry) => (
            <EntryDesignsSection
              key={entry.id}
              entry={entry}
              token={token}
              language={language}
              votedKeys={votedKeys}
              voteDeltas={voteDeltas}
              onVoteChange={onVoteChange}
            />
          ))}
        </Box>
      )}

      {!loading && debouncedSearchTerm.trim() && entries.length === 0 && segmentGroups.length === 0 && (
        <Typography sx={{ fontSize: SIZE.body, color: COLORS.textSecondary, px: 2, py: 2 }}>
          No results found for "{debouncedSearchTerm}"
        </Typography>
      )}
    </Box>
  );
};

export default CommunitySearchBar;
