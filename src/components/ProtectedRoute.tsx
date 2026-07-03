import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { Box } from '@mui/material';
import DelayedCircularProgress from './DelayedCircularProgress';

interface ProtectedRouteProps {
    children: React.ReactNode;
    allowPublic?: boolean;
}

function ProtectedRoute({ children, allowPublic }: ProtectedRouteProps) {
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

    // Redirect public accounts to home unless this route explicitly allows them
    if (user?.isPublic && !allowPublic) {
        return <Navigate to="/" />;
    }

    // Render children if authenticated
    return <>{children}</>;
}

export default ProtectedRoute;
