import { Container, Typography, Button, Box, Paper } from "@mui/material";
import { useNavigate } from "react-router-dom";
import HomeIcon from "@mui/icons-material/Home";

function NotFoundPage() {
    const navigate = useNavigate();

    return (
        <Container maxWidth="lg" sx={{ py: 8 }}>
            <Paper elevation={3} sx={{ p: 4, textAlign: "center" }}>
                <Typography variant="h1" component="h1" gutterBottom>
                    404
                </Typography>
                <Typography variant="h4" component="h2" gutterBottom>
                    Page Not Found
                </Typography>
                <Typography variant="body1" paragraph sx={{ mb: 4 }}>
                    The page you are looking for doesn't exist or has been moved.
                </Typography>
                <Box>
                    <Button
                        variant="contained"
                        color="primary"
                        startIcon={<HomeIcon />}
                        onClick={() => navigate("/")}
                        size="large"
                    >
                        Go to Home
                    </Button>
                </Box>
            </Paper>
        </Container>
    );
}

export default NotFoundPage;
