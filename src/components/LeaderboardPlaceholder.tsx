import { Box, Card, CardContent, Typography } from "@mui/material";

function LeaderboardPlaceholder() {
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
                            Competition coming soon
                        </Typography>
                    </Box>
                </Box>

                <Box sx={{ textAlign: 'center', py: 4 }}>
                    <Typography variant="h3" sx={{
                        fontSize: '4rem',
                        mb: 2,
                        opacity: 0.3
                    }}>
                        🚀
                    </Typography>
                    <Typography variant="h6" sx={{
                        fontWeight: 'bold',
                        mb: 1
                    }}>
                        Coming Soon!
                    </Typography>
                    <Typography variant="body2" sx={{
                        opacity: 0.8,
                        lineHeight: 1.6
                    }}>
                        Compare your progress with other learners and climb the ranks!
                    </Typography>
                </Box>

                <Box sx={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    borderRadius: 2,
                    p: 2,
                    textAlign: 'center'
                }}>
                    <Typography variant="body2" sx={{
                        opacity: 0.7,
                        fontStyle: 'italic'
                    }}>
                        Weekly and monthly rankings, achievements, and friendly competition features are in development
                    </Typography>
                </Box>
            </CardContent>
        </Card>
    );
}

export default LeaderboardPlaceholder;
