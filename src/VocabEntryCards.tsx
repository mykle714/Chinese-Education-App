import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import {
  Box,
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Alert,
  CardActionArea,
  Divider,
  Chip
} from '@mui/material';

// HSK Level type
type HskLevel = 'HSK1' | 'HSK2' | 'HSK3' | 'HSK4' | 'HSK5' | 'HSK6';

interface VocabEntry {
  id: number;
  entryKey: string;
  entryValue: string;
  isCustomTag?: boolean | null;
  hskLevelTag?: HskLevel | null;
  createdAt: string;
}

const ENTRIES_PER_PAGE = 10;

// Helper function to get HSK level number
const getHskNumber = (hskLevel: HskLevel) => {
  switch (hskLevel) {
    case 'HSK1': return '1';
    case 'HSK2': return '2';
    case 'HSK3': return '3';
    case 'HSK4': return '4';
    case 'HSK5': return '5';
    case 'HSK6': return '6';
    default: return '1'; // Default fallback
  }
};

// Helper function to render tag badges
const renderTags = (entry: VocabEntry) => (
  <Box sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 0.5 }}>
    {entry.isCustomTag === true && (
      <Chip
        label="Custom"
        size="small"
        color="primary"
        sx={{ fontSize: '0.7rem', height: '20px' }}
      />
    )}
    {entry.hskLevelTag && (
      <Box
        sx={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          backgroundColor: 'secondary.main',
          color: 'secondary.contrastText',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 'bold'
        }}
      >
        {getHskNumber(entry.hskLevelTag)}
      </Box>
    )}
  </Box>
);

interface VocabEntryCardsProps {
  refreshTrigger?: number;
}

const VocabEntryCards = ({ refreshTrigger }: VocabEntryCardsProps) => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [offset, setOffset] = useState<number>(0);
  const [, setTotal] = useState<number>(0);

  const observer = useRef<IntersectionObserver | null>(null);
  const lastEntryElementRef = useCallback((node: HTMLDivElement | null) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setOffset(prevOffset => prevOffset + ENTRIES_PER_PAGE);
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, hasMore]);

  // Initial load
  useEffect(() => {
    fetchEntries(0);
  }, [token]);

  // Fetch more entries when offset changes
  useEffect(() => {
    if (offset > 0) {
      fetchEntries(offset);
    }
  }, [offset, token]);

  // Refresh entries when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      setOffset(0);
      setEntries([]);
      setError(null);
      setErrorCode(null);
      fetchEntries(0);
    }
  }, [refreshTrigger, token]);

  const fetchEntries = async (currentOffset: number) => {
    setLoading(true);

    try {
      // Fetch vocabulary entries from our Express API with pagination
      const response = await fetch(`http://localhost:3001/api/vocabEntries/paginated?limit=${ENTRIES_PER_PAGE}&offset=${currentOffset}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw {
          message: errorData.error || 'Failed to fetch vocabulary entries',
          code: errorData.code || 'ERR_FETCH_FAILED'
        };
      }

      const result = await response.json();

      if (currentOffset === 0) {
        // First page, replace entries
        setEntries(result.entries);
      } else {
        // Subsequent pages, append entries
        setEntries(prev => [...prev, ...result.entries]);
      }

      setTotal(result.total);
      setHasMore(result.hasMore);
      setLoading(false);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch vocabulary entries';
      const errorCode = err.code || 'ERR_UNKNOWN';
      setError(errorMessage);
      setErrorCode(errorCode);
      setLoading(false);
      console.error(err);
    }
  };

  if (loading && entries.length === 0) return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
      <CircularProgress />
    </Box>
  );

  if (error) return (
    <Alert severity="error">
      Error: {error} {errorCode && <span>[Error Code: {errorCode}]</span>}
    </Alert>
  );

  if (entries.length === 0) return (
    <Alert severity="info">No vocabulary entries available</Alert>
  );

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: {
        xs: '1fr',
        sm: 'repeat(2, 1fr)',
        md: 'repeat(3, 1fr)'
      },
      gap: 3
    }}>
      {entries.map((entry, index) => (
        <Box
          key={entry.id}
          ref={index === entries.length - 1 ? lastEntryElementRef : undefined}
        >
          <Card
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              '&:hover': {
                transform: 'translateY(-5px)',
                boxShadow: 6
              }
            }}
          >
            {renderTags(entry)}
            <CardActionArea
              sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
              onClick={() => navigate(`/entries/${entry.id}`)}
            >
              <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <Typography variant="h5" component="h2" gutterBottom>
                  {entry.entryKey}
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" color="text.secondary" sx={{ flexGrow: 1, mb: 2 }}>
                  {entry.entryValue}
                </Typography>
                {entry.createdAt && (
                  <>
                    <Divider sx={{ mt: 'auto' }} />
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                      Added: {new Date(entry.createdAt).toLocaleDateString()}
                    </Typography>
                  </>
                )}
              </CardContent>
            </CardActionArea>
          </Card>
        </Box>
      ))}

      {loading && entries.length > 0 && (
        <Box gridColumn="1/-1" display="flex" justifyContent="center" p={2}>
          <CircularProgress size={30} />
        </Box>
      )}
    </Box>
  );
};

export default VocabEntryCards;
