// Store navigation and auth clearing functions
let navigateToLogin: (() => void) | null = null;
let clearAuthState: (() => void) | null = null;

// Function to set handlers from AuthContext
export const setFetchInterceptorHandlers = (
  navigate: () => void,
  clearAuth: () => void
) => {
  navigateToLogin = navigate;
  clearAuthState = clearAuth;
};

// Setup global fetch interceptor
export const setupFetchInterceptor = () => {
  // Store the original fetch
  const originalFetch = window.fetch;

  // Override the global fetch
  window.fetch = async (...args): Promise<Response> => {
    // Call the original fetch — network errors propagate naturally
    const response = await originalFetch(...args);

    // Auth endpoints handle their own failures — don't treat /api/auth/* 401s as
    // "session expired" since checkAuth and login manage those paths directly.
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
    const isAuthEndpoint = url.includes('/api/auth/');

    // Check for authentication errors on non-auth endpoints only
    if (!isAuthEndpoint && (response.status === 401 || response.status === 403)) {
      console.log('Token expired or unauthorized (detected by fetch interceptor), redirecting to login...');

      // Clear auth state
      if (clearAuthState) {
        clearAuthState();
      }

      // Clear localStorage
      localStorage.removeItem('token');

      // Set session expired flag in localStorage for LoginPage to detect
      localStorage.setItem('sessionExpired', 'true');

      // Redirect to login
      if (navigateToLogin) {
        navigateToLogin();
      }
    }

    return response;
  };
};
