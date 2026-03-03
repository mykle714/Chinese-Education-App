import { Box, Container, Typography } from "@mui/material";
import Message from "../Message";
import { useAuth } from "../AuthContext";
import { useWorkPoints } from "../hooks/useWorkPoints";
import TimeDisplay from "../components/TimeDisplay";
import StreakCounter from "../components/StreakCounter";
import LeaderboardPlaceholder from "../components/LeaderboardPlaceholder";

function HomePage() {
    const { user } = useAuth();
    const {
        totalStudyTimeMinutes,
        currentStreak
    } = useWorkPoints();

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Message />

            {user ? (
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
                    gap: 4
                }}>
                    {/* Left Column - User Dashboard */}
                    <Box>
                        <Box sx={{ mb: 2 }}>
                            {/* Total Study Time Display */}
                            <TimeDisplay totalMinutes={totalStudyTimeMinutes} />

                            {/* Streak Counter */}
                            <StreakCounter
                                currentStreak={currentStreak}
                            />

                        </Box>

                    </Box>

                    {/* Right Column - Leaderboard */}
                    <Box>
                        {/* Test User Message */}
                        {import.meta.env.VITE_TEST_USER_MESSAGE && (
                            <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
                                <Typography variant="body1" color="text.secondary">
                                    📢 {import.meta.env.VITE_TEST_USER_MESSAGE}
                                </Typography>
                            </Box>
                        )}
                        <LeaderboardPlaceholder />
                    </Box>
                </Box>
            ) : (
                <Box sx={{ textAlign: 'center', py: 8 }}>
                    <Typography variant="h5" gutterBottom>
                        Welcome to your Dashboard
                    </Typography>
                    <Typography variant="body1" paragraph>
                        Please log in to view your personalized dashboard with study statistics, streak tracking, and progress calendar.
                    </Typography>
                </Box>
            )}
        </Container>
    );
}

export default HomePage;
