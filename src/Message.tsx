import { Typography } from "@mui/material";

function Message() {
    return (
        <Typography
            variant="h3"
            component="h1"
            gutterBottom
            sx={{
                mb: 4,
                fontSize: {
                    xs: 'clamp(2rem, 8vw, 3.5rem)',
                    sm: 'clamp(1.5rem, 5vw, 3rem)'
                }
            }}
        >
            Welcome Back
        </Typography>
    );
}

export default Message;
