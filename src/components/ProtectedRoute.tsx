import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { Box } from '@mui/material';
import DelayedCircularProgress from './DelayedCircularProgress';

interface ProtectedRouteProps {
    children: React.ReactNode;
    /**
     * Require a FULL account — i.e. bounce public/demo accounts to "/".
     *
     * The polarity is deliberate: this defaults to `false`, so the common case
     * (any signed-in account, including public ones) is what you get by omitting
     * the prop. It used to be the inverse — `allowPublic`, which 25 of the app's
     * 30 routes had to remember to pass. A FORGOTTEN flag didn't error; it
     * silently redirected to "/", which presents as a dead button rather than a
     * crash, and since every local account is `isPublic` it reproduced for
     * everyone. Now the restrictive case is the one you have to type.
     *
     * Callers don't set this by hand any more either — `src/routes/registry.ts`
     * derives it from each route's `access` field.
     *
     * See docs/ARCHITECTURE_REVIEW.md finding 4.
     */
    requireFullAccount?: boolean;
}

function ProtectedRoute({ children, requireFullAccount }: ProtectedRouteProps) {
    const { isAuthenticated, isLoading, user } = useAuth();

    // Show loading spinner while checking authentication
    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
                <DelayedCircularProgress />
            </Box>
        );
    }

    // Redirect to login if not authenticated
    if (!isAuthenticated) {
        return <Navigate to="/login" />;
    }

    // Public/demo accounts may use the app, but not the full-account-only pages.
    if (user?.isPublic && requireFullAccount) {
        return <Navigate to="/" />;
    }

    // Render children if authenticated
    return <>{children}</>;
}

export default ProtectedRoute;
