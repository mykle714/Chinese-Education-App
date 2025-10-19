import { Box, Container, Typography } from "@mui/material";
import Message from "../Message";
import { useAuth } from "../AuthContext";
import { useWorkPoints } from "../hooks/useWorkPoints";
import TimeDisplay from "../components/TimeDisplay";
import StreakCounter from "../components/StreakCounter";
import MonthlyCalendar from "../components/MonthlyCalendar";
import LeaderboardPlaceholder from "../components/LeaderboardPlaceholder";
import ChangelogDisplay from "../components/ChangelogDisplay";

function HomePage() {
    const { user } = useAuth();
    const {
        currentPoints,
        totalWorkPoints,
        currentStreak,
        longestStreak
    } = useWorkPoints();

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Typography variant="h3" component="h1" align="center" gutterBottom sx={{ mb: 4 }}>
                Learning Dashboard
            </Typography>

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
                            {/* Total Work Points Display */}
                            <TimeDisplay totalMinutes={totalWorkPoints} />

                            {/* Streak Counter */}
                            <StreakCounter
                                currentStreak={currentStreak}
                                longestStreak={longestStreak}
                            />

                            {/* Monthly Calendar */}
                            <MonthlyCalendar />
                        </Box>

                        {/* Debug display for work points */}
                        <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
                            <Typography variant="body2" color="text.secondary">
                                <strong>Debug Info:</strong> Daily Points: {currentPoints} | Total Work Points: {totalWorkPoints} | Streak: {currentStreak}
                            </Typography>
                        </Box>
                    </Box>

                    {/* Right Column - Leaderboard */}
                    <Box>
                        <LeaderboardPlaceholder />
                        <ChangelogDisplay />
                    </Box>
                </Box>
            ) : (
                <Box sx={{ textAlign: 'center', py: 8 }}>
                    <Typography variant="h5" gutterBottom>
                        Welcome to the Learning Dashboard
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
