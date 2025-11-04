import { useState, useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '../AuthContext';
import {
    Container,
    Typography,
    TextField,
    Button,
    Paper,
    Box,
    Link,
    Alert,
    CircularProgress
} from '@mui/material';

// Define the form validation schema
const loginSchema = z.object({
    email: z.string().email('Please enter a valid email address'),
    password: z.string()
});

type LoginFormData = z.infer<typeof loginSchema>;

function LoginPage() {
    const { login, error } = useAuth();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(error);
    const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);

    const { control, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            email: '',
            password: ''
        }
    });

    // Check for session expiration on mount
    useEffect(() => {
        const sessionExpired = localStorage.getItem('sessionExpired');
        if (sessionExpired === 'true') {
            setSessionExpiredMessage('Your session has expired. Please log in again.');
            // Clear the flag
            localStorage.removeItem('sessionExpired');
        }
    }, []);

    const onSubmit = async (data: LoginFormData) => {
        setIsSubmitting(true);
        setLoginError(null);
        try {
            await login(data.email, data.password);
        } catch (error: any) {
            setLoginError(error.message || 'Login failed. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Paper elevation={3} sx={{ p: 4, borderRadius: 2, maxWidth: 500, mx: 'auto' }}>
                <Typography variant="h4" component="h1" align="center" gutterBottom sx={{ mb: 3 }}>
                    Log In
                </Typography>

                {sessionExpiredMessage && (
                    <Alert severity="warning" sx={{ mb: 3 }}>
                        {sessionExpiredMessage}
                    </Alert>
                )}

                {loginError && (
                    <Alert severity="error" sx={{ mb: 3 }}>
                        {loginError}
                    </Alert>
                )}

                <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
                    <Controller
                        name="email"
                        control={control}
                        render={({ field }) => (
                            <TextField
                                {...field}
                                margin="normal"
                                required
                                fullWidth
                                id="email"
                                label="Email Address"
                                autoComplete="email"
                                autoFocus
                                error={!!errors.email}
                                helperText={errors.email?.message}
                                disabled={isSubmitting}
                            />
                        )}
                    />

                    <Controller
                        name="password"
                        control={control}
                        render={({ field }) => (
                            <TextField
                                {...field}
                                margin="normal"
                                required
                                fullWidth
                                id="password"
                                label="Password"
                                type="password"
                                autoComplete="current-password"
                                error={!!errors.password}
                                helperText={errors.password?.message}
                                disabled={isSubmitting}
                            />
                        )}
                    />

                    <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        sx={{ mt: 3, mb: 2, py: 1.5 }}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? <CircularProgress size={24} /> : 'Log In'}
                    </Button>

                    <Box sx={{ mt: 2, textAlign: 'center' }}>
                        <Typography variant="body2">
                            Don't have an account?{' '}
                            <Link component={RouterLink} to="/register" variant="body2">
                                Register here
                            </Link>
                        </Typography>
                    </Box>
                </Box>
            </Paper>
        </Container>
    );
}

export default LoginPage;
