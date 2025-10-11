import { Box, Card, CardContent, Typography, Grid } from "@mui/material";

function MonthlyCalendar() {
    // Get current date information
    const now = new Date();
    const currentMonth = now.toLocaleString('default', { month: 'long' });
    const currentYear = now.getFullYear();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const startingDayOfWeek = firstDayOfMonth.getDay();
    const daysInMonth = lastDayOfMonth.getDate();
    const today = now.getDate();

    // Generate calendar days array
    const calendarDays: (number | null)[] = [];

    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
        calendarDays.push(null);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        calendarDays.push(day);
    }

    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
        <Card sx={{
            background: 'linear-gradient(135deg, #667eea, #764ba2)',
            color: 'white',
            mb: 3
        }}>
            <CardContent sx={{ py: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                    <Typography variant="h4" component="span" sx={{ fontSize: '2rem' }}>
                        📅
                    </Typography>
                    <Box>
                        <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                            {currentMonth} {currentYear}
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.9 }}>
                            Activity calendar coming soon
                        </Typography>
                    </Box>
                </Box>

                {/* Calendar Grid */}
                <Box>
                    {/* Week day headers */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, mb: 1 }}>
                        {weekDays.map((day) => (
                            <Box key={day} sx={{
                                textAlign: 'center',
                                py: 0.5,
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                                opacity: 0.8
                            }}>
                                {day}
                            </Box>
                        ))}
                    </Box>

                    {/* Calendar days */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
                        {calendarDays.map((day, index) => (
                            <Box key={index} sx={{
                                height: 32,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.875rem',
                                borderRadius: 1,
                                backgroundColor: day === today ? 'rgba(255, 255, 255, 0.3)' : 'transparent',
                                fontWeight: day === today ? 'bold' : 'normal',
                                border: day === today ? '1px solid rgba(255, 255, 255, 0.5)' : 'none'
                            }}>
                                {day}
                            </Box>
                        ))}
                    </Box>
                </Box>

                <Typography variant="body2" sx={{
                    textAlign: 'center',
                    opacity: 0.7,
                    mt: 2,
                    fontStyle: 'italic'
                }}>
                    Your activity tracking will appear here soon
                </Typography>
            </CardContent>
        </Card>
    );
}

export default MonthlyCalendar;
