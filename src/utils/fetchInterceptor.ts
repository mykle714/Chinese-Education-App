import type { NavigateFunction } from 'react-router-dom';

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
    try {
      // Call the original fetch
      const response = await originalFetch(...args);

      // Check for authentication errors
      if (response.status === 401 || response.status === 403) {
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
    } catch (error) {
      // Pass through any network errors
      throw error;
    }
  };

  console.log('Fetch interceptor initialized - all fetch calls will now check for token expiration');
};
