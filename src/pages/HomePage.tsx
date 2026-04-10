import { Box, Container, Typography } from "@mui/material";
import Message from "../Message";
import { useWorkPoints } from "../hooks/useWorkPoints";
import TimeDisplay from "../components/TimeDisplay";
import StreakCounter from "../components/StreakCounter";
import MonthlyCalendar from "../components/MonthlyCalendar";
import LeaderboardPlaceholder from "../components/LeaderboardPlaceholder";
import ChangelogDisplay from "../components/ChangelogDisplay";

function HomePage() {
    const {
        totalStudyTimeMinutes,
        currentStreak
    } = useWorkPoints();

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Message />

            <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
                gap: 4
            }}>
                {/* Left Column - User Dashboard */}
                <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ mb: 2 }}>
                        {/* Total Study Time Display */}
                        <TimeDisplay totalMinutes={totalStudyTimeMinutes} />

                        {/* Streak Counter */}
                        <StreakCounter currentStreak={currentStreak} />

                        {/* Monthly Activity Calendar */}
                        <MonthlyCalendar />
                    </Box>
                </Box>

                {/* Right Column - Leaderboard & Changelog */}
                <Box sx={{ minWidth: 0 }}>
                    {/* Test User Message */}
                    {import.meta.env.VITE_TEST_USER_MESSAGE && (
                        <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
                            <Typography variant="body1" color="text.secondary">
                                📢 {import.meta.env.VITE_TEST_USER_MESSAGE}
                            </Typography>
                        </Box>
                    )}
                    <LeaderboardPlaceholder />
                    <ChangelogDisplay />
                </Box>
            </Box>
        </Container>
    );
}

export default HomePage;
