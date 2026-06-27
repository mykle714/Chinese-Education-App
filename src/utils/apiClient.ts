import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../constants';
import { attemptTokenRefresh } from './tokenRefresh';

// Mirror the fetch interceptor: don't auto-refresh on auth-mutation endpoints
// (a 401 there is a real failure / would recurse). /api/auth/me is eligible.
const NO_REFRESH_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/refresh',
];

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // Include cookies for authentication
  headers: {
    'Content-Type': 'application/json',
  },
});

// Store the navigation function - will be set by AuthContext
let navigateToLogin: (() => void) | null = null;
let clearAuthState: (() => void) | null = null;

// Function to set the navigation callback from AuthContext
export const setAuthHandlers = (
  navigate: () => void,
  clearAuth: () => void
) => {
  navigateToLogin = navigate;
  clearAuthState = clearAuth;
};

// Request interceptor - add token if available
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Token is sent via cookies, but we could add it to headers if needed
    const token = localStorage.getItem('token');
    if (token && token !== 'null' && token !== 'undefined') {
      // Optional: Add to headers if your backend expects it
      // config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - transparently refresh + retry on auth failure, then
// fall back to logout. Mirrors the global fetch interceptor's behavior.
apiClient.interceptors.response.use(
  (response) => {
    // Pass through successful responses
    return response;
  },
  async (error: AxiosError) => {
    const status = error.response?.status;
    // `_retried` guards against an infinite refresh/retry loop on the retried call.
    const config = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const url = config?.url ?? '';
    const skipRefresh = NO_REFRESH_PATHS.some((p) => url.includes(p));

    if ((status === 401 || status === 403) && config && !config._retried && !skipRefresh) {
      const newToken = await attemptTokenRefresh();

      if (newToken) {
        // Retry once with the fresh token (cookie is also refreshed server-side).
        config._retried = true;
        config.headers = config.headers ?? {};
        (config.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
        return apiClient(config);
      }

      // Refresh failed: the session is truly over.
      console.log('Session expired and refresh failed — redirecting to login...');
      if (clearAuthState) {
        clearAuthState();
      }
      localStorage.removeItem('token');
      localStorage.setItem('sessionExpired', 'true');
      if (navigateToLogin) {
        navigateToLogin();
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
