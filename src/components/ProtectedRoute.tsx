import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useBootCover } from '../hooks/useBootCover';
import type { LoginRedirectState } from '../utils/loginRedirect';
import { Box } from '@mui/material';
import DelayedCircularProgress from './DelayedCircularProgress';

interface ProtectedRouteProps {
    children: React.ReactNode;
}

/**
 * Renders its page only for a signed-in account; otherwise redirects to `/login`.
 * (A `requireFullAccount` prop bounced `isPublic` accounts to "/"; it went with `isPublic`
 * on 2026-11-14, docs/LOGIN_REWORK.md Q7.)
 */
function ProtectedRoute({ children }: ProtectedRouteProps) {
    const { isAuthenticated, isLoading } = useAuth();
    const location = useLocation();
    // Up only during the launch (docs/LOGIN_REWORK.md § 1): tells a cold-start deep link
    // apart from a session that ended mid-use.
    const { up: launching } = useBootCover();

    // Show loading spinner while checking authentication
    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
                <DelayedCircularProgress />
            </Box>
        );
    }

    // Redirect to login if not authenticated. `replace`, so Back from the login screen does
    // not return to this page only to be bounced again (the old back-button trap, R2).
    //
    // Return-to (R1, docs/LOGIN_REWORK.md Q2) is for a COLD-START DEEP LINK only: a launch
    // that opened on this page while signed out comes back here after login. A session that
    // ends mid-use (the interceptor's path, logout) lands on `/` instead, so no `from` is
    // passed once the boot cover has gone.
    if (!isAuthenticated) {
        const state: LoginRedirectState | undefined = launching
            ? { from: location.pathname + location.search + location.hash }
            : undefined;
        return <Navigate to="/login" replace state={state} />;
    }

    // Render children if authenticated
    return <>{children}</>;
}

export default ProtectedRoute;
