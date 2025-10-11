import { Box, Card, CardContent, Typography } from "@mui/material";
import { convertMinutesToTimeFormat, formatTimeBreakdown } from "../utils/timeUtils";

interface TimeDisplayProps {
    totalMinutes: number;
}

function TimeDisplay({ totalMinutes }: TimeDisplayProps) {
    const timeBreakdown = convertMinutesToTimeFormat(totalMinutes);
    const formattedTime = formatTimeBreakdown(timeBreakdown);

    return (
        <Card sx={{
            background: 'linear-gradient(135deg, #4facfe, #00f2fe)',
            color: 'white',
            mb: 3
        }}>
            <CardContent sx={{ py: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Typography variant="h4" component="span" sx={{ fontSize: '2rem' }}>
                        ⏰
                    </Typography>
                    <Box>
                        <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                            Total Study Time
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.9 }}>
                            All-time accumulated learning
                        </Typography>
                    </Box>
                </Box>

                <Typography variant="h5" sx={{
                    fontWeight: 'bold',
                    textAlign: 'center',
                    mb: 1,
                    textShadow: '0 1px 2px rgba(0,0,0,0.1)'
                }}>
                    {formattedTime}
                </Typography>

                <Typography variant="body2" sx={{
                    textAlign: 'center',
                    opacity: 0.8
                }}>
                    {totalMinutes} total minutes earned
                </Typography>
            </CardContent>
        </Card>
    );
}

export default TimeDisplay;
