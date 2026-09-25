import { useState } from 'react';
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
    CircularProgress,
    Checkbox,
    FormControl,
    FormControlLabel,
    FormHelperText,
    FormLabel,
    Radio,
    RadioGroup,
} from '@mui/material';
import { usePageTitle } from '../hooks/usePageTitle';
import {
    DEMOGRAPHICS_PURPOSE, EARLIEST_BIRTH_DATE, GENDER_CHOICES, PREFER_NOT_LABEL,
    birthDateProblem, todayIsoDate,
} from '../utils/demographics';
import type { UserGender } from '../types';

// Define the form validation schema.
//
// Gender and date of birth (migration 164) are REQUIRED QUESTIONS with an explicit way out:
// "Prefer not to answer" is a real answer (it stores null), but leaving the question untouched
// is not — so the learner makes the choice once, here, rather than being asked again later.
// `gender: ''` is the untouched state; 'prefer-not' maps to null on submit.
const registerSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Please enter a valid email address'),
    password: z.string(),
    confirmPassword: z.string(),
    gender: z.enum(['female', 'male', 'prefer-not'], { errorMap: () => ({ message: 'Choose one' }) }),
    birthDate: z.string(),
    birthDatePreferNot: z.boolean(),
}).refine(data => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword']
}).superRefine((data, ctx) => {
    // The date is only checked when the learner has not opted out of it.
    if (data.birthDatePreferNot) return;
    const problem = birthDateProblem(data.birthDate);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ['birthDate'] });
});

type RegisterFormData = z.infer<typeof registerSchema>;

function RegisterPage() {
    usePageTitle("Register");
    const { register, error } = useAuth();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [registerError, setRegisterError] = useState<string | null>(error);

    const { control, handleSubmit, watch, setValue, formState: { errors } } = useForm<RegisterFormData>({
        resolver: zodResolver(registerSchema),
        defaultValues: {
            name: '',
            email: '',
            password: '',
            confirmPassword: '',
            // Untouched — the enum rejects '', which is what makes the question required.
            gender: '' as RegisterFormData['gender'],
            birthDate: '',
            birthDatePreferNot: false,
        }
    });
    const birthDatePreferNot = watch('birthDatePreferNot');

    const onSubmit = async (data: RegisterFormData) => {
        setIsSubmitting(true);
        setRegisterError(null);
        try {
            await register(data.email, data.name, data.password, {
                gender: data.gender === 'prefer-not' ? null : (data.gender as UserGender),
                birthDate: data.birthDatePreferNot ? null : data.birthDate,
            });
        } catch (error: unknown) {
            setRegisterError(error instanceof Error ? error.message : 'Registration failed. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Paper elevation={3} sx={{ p: 4, borderRadius: 2, maxWidth: 500, mx: 'auto' }}>
                <Typography variant="h4" component="h1" align="center" gutterBottom sx={{ mb: 3 }}>
                    Create Account
                </Typography>

                {registerError && (
                    <Alert severity="error" sx={{ mb: 3 }}>
                        {registerError}
                    </Alert>
                )}

                <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
                    <Controller
                        name="name"
                        control={control}
                        render={({ field }) => (
                            <TextField
                                {...field}
                                margin="normal"
                                required
                                fullWidth
                                id="name"
                                label="Full Name"
                                autoComplete="name"
                                autoFocus
                                error={!!errors.name}
                                helperText={errors.name?.message}
                                disabled={isSubmitting}
                            />
                        )}
                    />

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
                                autoComplete="new-password"
                                error={!!errors.password}
                                helperText={errors.password?.message}
                                disabled={isSubmitting}
                            />
                        )}
                    />

                    <Controller
                        name="confirmPassword"
                        control={control}
                        render={({ field }) => (
                            <TextField
                                {...field}
                                margin="normal"
                                required
                                fullWidth
                                id="confirmPassword"
                                label="Confirm Password"
                                type="password"
                                autoComplete="new-password"
                                error={!!errors.confirmPassword}
                                helperText={errors.confirmPassword?.message}
                                disabled={isSubmitting}
                            />
                        )}
                    />

                    {/* ── About you (migration 164) — gender + date of birth ─────────
                        Both required, both with "Prefer not to answer". Read by Immersive
                        World only; see src/utils/demographics.ts for the shared copy. */}
                    <Box className="register-page__about-you" sx={{ mt: 3 }}>
                        <Typography className="register-page__about-you-purpose" variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                            {DEMOGRAPHICS_PURPOSE}
                        </Typography>

                        <Controller
                            name="gender"
                            control={control}
                            render={({ field }) => (
                                <FormControl
                                    className="register-page__gender-field"
                                    required
                                    error={!!errors.gender}
                                    disabled={isSubmitting}
                                    fullWidth
                                >
                                    <FormLabel className="register-page__gender-label" id="register-gender-label">Gender</FormLabel>
                                    <RadioGroup
                                        className="register-page__gender-options"
                                        row
                                        aria-labelledby="register-gender-label"
                                        value={field.value}
                                        onChange={(e) => field.onChange(e.target.value)}
                                    >
                                        {GENDER_CHOICES.map((choice) => (
                                            <FormControlLabel
                                                key={choice.value}
                                                className={`register-page__gender-option register-page__gender-option--${choice.value}`}
                                                value={choice.value}
                                                control={<Radio />}
                                                label={choice.label}
                                            />
                                        ))}
                                        <FormControlLabel
                                            className="register-page__gender-option register-page__gender-option--prefer-not"
                                            value="prefer-not"
                                            control={<Radio />}
                                            label={PREFER_NOT_LABEL}
                                        />
                                    </RadioGroup>
                                    {errors.gender && (
                                        <FormHelperText className="register-page__gender-error">{errors.gender.message}</FormHelperText>
                                    )}
                                </FormControl>
                            )}
                        />

                        <Controller
                            name="birthDate"
                            control={control}
                            render={({ field }) => (
                                <TextField
                                    {...field}
                                    className="register-page__birth-date-field"
                                    margin="normal"
                                    required={!birthDatePreferNot}
                                    fullWidth
                                    id="birthDate"
                                    label="Date of birth"
                                    type="date"
                                    autoComplete="bday"
                                    InputLabelProps={{ shrink: true }}
                                    inputProps={{ min: EARLIEST_BIRTH_DATE, max: todayIsoDate() }}
                                    error={!birthDatePreferNot && !!errors.birthDate}
                                    helperText={!birthDatePreferNot && errors.birthDate?.message}
                                    disabled={isSubmitting || birthDatePreferNot}
                                />
                            )}
                        />
                        <Controller
                            name="birthDatePreferNot"
                            control={control}
                            render={({ field }) => (
                                <FormControlLabel
                                    className="register-page__birth-date-prefer-not"
                                    control={
                                        <Checkbox
                                            checked={field.value}
                                            onChange={(e) => {
                                                field.onChange(e.target.checked);
                                                // Opting out discards anything typed, so the field
                                                // does not look like it will be sent.
                                                if (e.target.checked) setValue('birthDate', '');
                                            }}
                                            disabled={isSubmitting}
                                        />
                                    }
                                    label={PREFER_NOT_LABEL}
                                />
                            )}
                        />
                    </Box>

                    <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        sx={{ mt: 3, mb: 2, py: 1.5 }}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? <CircularProgress size={24} /> : 'Register'}
                    </Button>

                    <Box sx={{ mt: 2, textAlign: 'center' }}>
                        <Typography variant="body2">
                            Already have an account?{' '}
                            <Link component={RouterLink} to="/login" variant="body2">
                                Log in here
                            </Link>
                        </Typography>
                    </Box>
                </Box>
            </Paper>
        </Container>
    );
}

export default RegisterPage;
