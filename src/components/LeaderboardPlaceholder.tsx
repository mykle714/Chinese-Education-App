import { Box, Card, CardContent, Typography, CircularProgress, Alert, Chip, Avatar } from "@mui/material";
import { useLeaderboard } from "../hooks/useLeaderboard";

function LeaderboardPlaceholder() {
    const { entries, loading, error, hasData, isEmpty, refresh } = useLeaderboard();

    if (loading) {
        return (
            <Card sx={{
                background: 'linear-gradient(135deg, #f093fb, #f5576c)',
                color: 'white',
                height: 'fit-content'
            }}>
                <CardContent sx={{ py: 4, textAlign: 'center' }}>
                    <CircularProgress sx={{ color: 'white', mb: 2 }} />
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
                        <Typography variant="h6" component="div" sx={{ fontWeight: 'bold' }}>
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
                        <Typography variant="h6" component="div" sx={{ fontWeight: 'bold' }}>
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
                        <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                            Leaderboard
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.9 }}>
                            Top learners by total work points
                        </Typography>
                    </Box>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {entries.map((entry, index) => {
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
                                    gap: 2,
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
                                {/* Rank */}
                                <Box sx={{ minWidth: '3rem', textAlign: 'center' }}>
                                    <Typography variant="h6" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                                        {getRankEmoji(entry.rank)}
                                    </Typography>
                                </Box>

                                {/* User Avatar */}
                                <Avatar sx={{
                                    bgcolor: 'rgba(255, 255, 255, 0.2)',
                                    color: 'white',
                                    width: 40,
                                    height: 40
                                }}>
                                    {(entry.name || entry.email).charAt(0).toUpperCase()}
                                </Avatar>

                                {/* User Info */}
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                        <Typography
                                            variant="body1"
                                            sx={{
                                                fontWeight: 'bold',
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
                                                    fontSize: '0.7rem'
                                                }}
                                            />
                                        )}
                                    </Box>

                                    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                                        <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.8rem' }}>
                                            🔥 {entry.currentStreak} streak
                                        </Typography>
                                        <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.8rem' }}>
                                            📅 Today: {entry.todaysPoints}
                                        </Typography>
                                        <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.8rem' }}>
                                            📊 Yesterday: {entry.yesterdaysPoints}
                                        </Typography>
                                    </Box>
                                </Box>

                                {/* Total Points */}
                                <Box sx={{ textAlign: 'right' }}>
                                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                                        {entry.totalWorkPoints.toLocaleString()}
                                    </Typography>
                                    <Typography variant="body2" sx={{ opacity: 0.8, fontSize: '0.75rem' }}>
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
                            fontSize: '0.8rem'
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
