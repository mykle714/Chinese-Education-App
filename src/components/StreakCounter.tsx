import { Box, Card, CardContent, Typography } from "@mui/material";

interface StreakCounterProps {
    currentStreak: number;
    longestStreak: number;
}

function StreakCounter({ currentStreak, longestStreak }: StreakCounterProps) {
    return (
        <Card sx={{
            background: 'linear-gradient(135deg, #ff6b6b, #ff8e53)',
            color: 'white',
            mb: 3
        }}>
            <CardContent sx={{ py: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Typography variant="h4" component="span" sx={{ fontSize: '2rem' }}>
                        🔥
                    </Typography>
                    <Box>
                        <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                            Current Streak
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.9 }}>
                            {longestStreak > 0 && `Personal Best: ${longestStreak} days`}
                        </Typography>
                    </Box>
                </Box>

                <Typography variant="h4" sx={{
                    fontWeight: 'bold',
                    textAlign: 'center',
                    mb: 1,
                    textShadow: '0 1px 2px rgba(0,0,0,0.1)'
                }}>
                    {currentStreak === 0 ? 'Start Today!' : `${currentStreak} ${currentStreak === 1 ? 'Day' : 'Days'}`}
                </Typography>

                {currentStreak === 0 ? (
                    <Typography variant="body2" sx={{
                        textAlign: 'center',
                        opacity: 0.8
                    }}>
                        Begin your learning journey
                    </Typography>
                ) : (
                    <Typography variant="body2" sx={{
                        textAlign: 'center',
                        opacity: 0.8
                    }}>
                        Keep it going! 🎯
                    </Typography>
                )}
            </CardContent>
        </Card>
    );
}

export default StreakCounter;
