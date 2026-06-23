import { Box, Card, CardContent, Typography, Alert, Chip, Avatar } from "@mui/material";
import DelayedCircularProgress from "./DelayedCircularProgress";
import { useLeaderboard } from "../hooks/useLeaderboard";
import { API_BASE_URL } from "../constants";
import { SIZE , WEIGHT} from "../theme/scale";

function LeaderboardPlaceholder() {
    const { entries, loading, error, isEmpty } = useLeaderboard();

    if (loading) {
        return (
            <Card sx={{
                background: 'linear-gradient(135deg, #f093fb, #f5576c)',
                color: 'white',
                height: 'fit-content'
            }}>
                <CardContent sx={{ py: 4, textAlign: 'center' }}>
                    <DelayedCircularProgress sx={{ color: 'white', mb: 2 }} />
                    <Typography variant="body1">Loading leaderboard...</Typography>
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card sx={{
                background: 'linear-gradient(135deg, #f093fb, #f5576c)',
                color: 'white',
                height: 'fit-content'
            }}>
                <CardContent sx={{ py: 4 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                        <Typography variant="h4" component="span" sx={{ fontSize: '2rem' }}>
                            🏆
                        </Typography>
                        <Typography variant="h6" component="div" sx={{ fontWeight: WEIGHT.bold }}>
                            Leaderboard
                        </Typography>
                    </Box>
                    <Alert severity="error" sx={{ mb: 2, bgcolor: 'rgba(255,255,255,0.1)', color: 'white' }}>
                        {error}
                    </Alert>
                </CardContent>
            </Card>
        );
    }

    if (isEmpty) {
        return (
            <Card sx={{
                background: 'linear-gradient(135deg, #f093fb, #f5576c)',
                color: 'white',
                height: 'fit-content'
            }}>
                <CardContent sx={{ py: 4 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                        <Typography variant="h4" component="span" sx={{ fontSize: '2rem' }}>
                            🏆
                        </Typography>
                        <Typography variant="h6" component="div" sx={{ fontWeight: WEIGHT.bold }}>
                            Leaderboard
                        </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center', py: 2 }}>
                        <Typography variant="body1" sx={{ opacity: 0.9 }}>
                            No data available yet. Start learning to see rankings!
                        </Typography>
                    </Box>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card sx={{
            background: 'linear-gradient(135deg, #f093fb, #f5576c)',
            color: 'white',
            height: 'fit-content'
        }}>
            <CardContent sx={{ py: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                    <Typography variant="h4" component="span" sx={{ fontSize: '2rem' }}>
                        🏆
                    </Typography>
                    <Box>
                        <Typography variant="h6" component="div" sx={{ fontWeight: WEIGHT.bold, mb: 0.5 }}>
                            Leaderboard
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.9 }}>
                            Top learners by total minute points
                        </Typography>
                    </Box>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {entries.map((entry) => {
                        const isCurrentUser = entry.isCurrentUser;
                        const getRankEmoji = (rank: number) => {
                            switch (rank) {
                                case 1: return '🥇';
                                case 2: return '🥈';
                                case 3: return '🥉';
                                default: return `#${rank}`;
                            }
                        };

                        return (
                            <Box
                                key={entry.userId}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    // No uniform gap — per-element margins below let us
                                    // tighten the rank→avatar spacing while keeping the
                                    // avatar→info and info→points spacing roomy.
                                    p: 2,
                                    borderRadius: 2,
                                    backgroundColor: isCurrentUser
                                        ? 'rgba(255, 255, 255, 0.3)'
                                        : 'rgba(255, 255, 255, 0.1)',
                                    border: isCurrentUser ? '2px solid rgba(255, 255, 255, 0.5)' : 'none',
                                    transition: 'all 0.2s ease-in-out',
                                    '&:hover': {
                                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                                    }
                                }}
                            >
                                {/* Rank — narrower box + tight right margin pulls the
                                    avatar in close, freeing horizontal room for the name. */}
                                <Box sx={{ minWidth: '2rem', textAlign: 'center', mr: 0.5 }}>
                                    <Typography variant="h6" sx={{ fontWeight: WEIGHT.bold, fontSize: SIZE.title }}>
                                        {getRankEmoji(entry.rank)}
                                    </Typography>
                                </Box>

                                {/* User Avatar — shows the user's chosen icons8 icon when
                                    set (src), else falls back to the name/email initial. */}
                                <Avatar
                                    src={
                                        entry.avatarIconId
                                            ? `${API_BASE_URL}/api/icons8/${encodeURIComponent(entry.avatarIconId)}/image`
                                            : undefined
                                    }
                                    imgProps={{ sx: { objectFit: 'contain', p: 0.5 } }}
                                    sx={{
                                        bgcolor: 'rgba(255, 255, 255, 0.2)',
                                        color: 'white',
                                        width: 40,
                                        height: 40
                                    }}
                                >
                                    {(entry.name || entry.email).charAt(0).toUpperCase()}
                                </Avatar>

                                {/* User Info */}
                                <Box sx={{ flex: 1, minWidth: 0, ml: 1.5 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                        <Typography
                                            variant="body1"
                                            title={entry.email}
                                            sx={{
                                                // flex:1 makes the name span the full width of
                                                // the info cell, pushing the "You" chip to the edge.
                                                flex: 1,
                                                minWidth: 0,
                                                fontWeight: WEIGHT.bold,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap'
                                            }}
                                        >
                                            {entry.name || entry.email}
                                        </Typography>
                                        {isCurrentUser && (
                                            <Chip
                                                label="You"
                                                size="small"
                                                sx={{
                                                    bgcolor: 'rgba(255, 255, 255, 0.2)',
                                                    color: 'white',
                                                    height: '20px',
                                                    fontSize: SIZE.micro,
                                                    flexShrink: 0
                                                }}
                                            />
                                        )}
                                    </Box>

                                    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                                        {entry.currentStreak !== null && (
                                            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: SIZE.body }}>
                                                🔥 {entry.currentStreak} streak
                                            </Typography>
                                        )}
                                        <Typography variant="body2" sx={{ opacity: 0.9, fontSize: SIZE.body }}>
                                            🏆 {entry.weeklyAchievements} weekly
                                        </Typography>
                                        <Typography variant="body2" sx={{ opacity: 0.9, fontSize: SIZE.body }}>
                                            📅 Today: {entry.todaysMinutes}
                                        </Typography>
                                        <Typography variant="body2" sx={{ opacity: 0.9, fontSize: SIZE.body }}>
                                            📊 Yesterday: {entry.yesterdaysMinutes}
                                        </Typography>
                                    </Box>
                                </Box>

                                {/* Total Points */}
                                <Box sx={{ textAlign: 'right', ml: 1.5 }}>
                                    <Typography variant="h6" sx={{ fontWeight: WEIGHT.bold }}>
                                        {entry.accumulativeMinutePoints.toLocaleString()}
                                    </Typography>
                                    <Typography variant="body2" sx={{ opacity: 0.8, fontSize: SIZE.caption }}>
                                        points
                                    </Typography>
                                </Box>
                            </Box>
                        );
                    })}
                </Box>

                {entries.length > 5 && (
                    <Box sx={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        borderRadius: 2,
                        p: 2,
                        textAlign: 'center',
                        mt: 2
                    }}>
                        <Typography variant="body2" sx={{
                            opacity: 0.7,
                            fontSize: SIZE.body
                        }}>
                            Showing top {Math.min(entries.length, 10)} learners
                        </Typography>
                    </Box>
                )}
            </CardContent>
        </Card>
    );
}

export default LeaderboardPlaceholder;
