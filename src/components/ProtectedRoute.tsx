import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { Box } from '@mui/material';
import DelayedCircularProgress from './DelayedCircularProgress';
import { reportAuthTrace } from '../utils/errorReporting'; // TEMP: bootstrap-hang diagnosis

interface ProtectedRouteProps {
    children: React.ReactNode;
    allowPublic?: boolean;
}

function ProtectedRoute({ children, allowPublic }: ProtectedRouteProps) {
    const { isAuthenticated, isLoading, user } = useAuth();

    // TEMP: record the gate decision so we can see whether the spinner branch is
    // the terminal state on a "loads forever" load.
    useEffect(() => {
        reportAuthTrace(`ProtectedRoute gate: isLoading=${isLoading} isAuthenticated=${isAuthenticated} isPublic=${user?.isPublic ?? '?'} allowPublic=${!!allowPublic}`);
    }, [isLoading, isAuthenticated, user?.isPublic, allowPublic]);

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

    // Redirect public accounts to home unless this route explicitly allows them
    if (user?.isPublic && !allowPublic) {
        return <Navigate to="/" />;
    }

    // Render children if authenticated
    return <>{children}</>;
}

export default ProtectedRoute;
