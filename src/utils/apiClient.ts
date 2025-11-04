import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../constants';

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

// Response interceptor - handle token expiration
apiClient.interceptors.response.use(
  (response) => {
    // Pass through successful responses
    return response;
  },
  (error: AxiosError) => {
    // Handle 401 (Unauthorized) and 403 (Forbidden) responses
    if (error.response?.status === 401 || error.response?.status === 403) {
      console.log('Token expired or unauthorized, redirecting to login...');
      
      // Clear auth state
      if (clearAuthState) {
        clearAuthState();
      }
      
      // Clear localStorage
      localStorage.removeItem('token');
      
      // Redirect to login
      if (navigateToLogin) {
        navigateToLogin();
      }
    }
    
    return Promise.reject(error);
  }
);

export default apiClient;
