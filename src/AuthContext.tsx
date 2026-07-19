import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from './constants';
import type { Language } from './types';
import { setFetchInterceptorHandlers, setupFetchInterceptor } from './utils/fetchInterceptor';
import { setRefreshHandlers, attemptTokenRefresh } from './utils/tokenRefresh';
import { notifyLogin } from './utils/authSync';
import * as authStorage from './utils/authStorage';

// Define the User type
interface User {
    id: string;
    email: string;
    name: string;
    isPublic?: boolean;
    isValidator?: boolean; // Gates the Reader "Validate" button + validation endpoints (migration 104)
    isTemplateAuthor?: boolean; // Gates the Night Market template editor + its save endpoints (migration 115); distinct from isValidator
    selectedLanguage?: Language;
    // icons8 id of the chosen profile avatar; null/undefined => name-initial fallback.
    avatarIconId?: string | null;
    // Mastery goal opt-ins (docs/MASTERY_REWORK.md). Recognition + Production are
    // always goals; these two are the account's optional extras.
    readingGoal?: boolean;
    writingGoal?: boolean;
}

// Define the AuthContext type
interface AuthContextType {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, name: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
    deleteAccount: (password: string) => Promise<void>;
    updateLanguage: (language: Language) => Promise<void>;
    updateAvatar: (avatarIconId: string | null) => Promise<void>;
    updateGoals: (goals: { readingGoal?: boolean; writingGoal?: boolean }) => Promise<void>;
    error: string | null;
}

// Create the AuthContext
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Define the AuthProvider props
interface AuthProviderProps {
    children: ReactNode;
}

// Create the AuthProvider component
export function AuthProvider({ children }: AuthProviderProps) {
    const [user, setUser] = useState<User | null>(null);
    // authStorage holds the access token in memory only (never persisted) — on a
    // fresh load this is null and checkAuth's silent-refresh path restores the
    // session from the httpOnly refresh cookie.
    const [token, setToken] = useState<string | null>(authStorage.getToken);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    // Set up auth handlers for the API client and fetch interceptor
    useEffect(() => {
        const handleTokenExpiration = () => {
            // Clear auth state
            authStorage.clearToken();
            setToken(null);
            setUser(null);
            // Navigate to login
            navigate('/login');
        };

        const clearAuth = () => {
            authStorage.clearToken();
            setToken(null);
            setUser(null);
        };

        // Register handlers with the global fetch interceptor — the single auth
        // layer now that all HTTP goes through fetch (api/http.ts).
        setFetchInterceptorHandlers(handleTokenExpiration, clearAuth);

        // When the shared refresh core mints a new access token, mirror it into
        // React state (authStorage's in-memory slot is already updated by the
        // refresh core). This keeps the Authorization header future requests
        // send in sync.
        setRefreshHandlers((newToken: string) => {
            setToken(newToken);
        });

        // Setup the global fetch interceptor
        setupFetchInterceptor();
    }, [navigate]);

    // Check if the user is authenticated on mount
    useEffect(() => {
        // A *pure access-token refresh* changes `token` while we already have an
        // authenticated `user` — the authenticated user is unchanged, so skip the
        // redundant GET /api/auth/me. Besides saving a round-trip, this narrows the
        // window in which a token change kicks off another request that could race
        // the refresh rotation and trip "Refresh token reuse detected" (the
        // mid-edit logout). Initial load AND the silent-refresh-on-load path both
        // have user === null, so they fall through and still validate/refresh below.
        if (token && user) return;
        const checkAuth = async () => {
            // Only proceed if we have a valid token
            if (token && token !== 'null' && token !== 'undefined' && token.length > 10) {
                try {
                    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        },
                        credentials: 'include' // Include cookies for new DAL architecture
                    });

                    if (response.ok) {
                        const userData = await response.json();
                        setUser(userData);
                        notifyLogin(token);
                    } else {
                        // If the token is invalid, clear it
                        console.log('Token validation failed, clearing stored token');
                        authStorage.clearToken();
                        setToken(null);
                    }
                } catch (error) {
                    console.error('Error checking authentication:', error);
                    authStorage.clearToken();
                    setToken(null);
                }
            } else {
                // No usable access token in memory (normal on every fresh load —
                // the token is never persisted). A valid httpOnly refresh cookie
                // may still exist — try a silent refresh so a reload keeps the
                // user signed in. On success the refresh handler sets the token,
                // re-running this effect down the validToken path above.
                if (token) {
                    console.log('Invalid token detected, clearing:', token);
                    authStorage.clearToken();
                }
                const refreshed = await attemptTokenRefresh();
                if (!refreshed) {
                    setToken(null);
                    setIsLoading(false);
                }
                // On success, KEEP isLoading=true: `user` is still null here, so
                // ending the loading state now would let ProtectedRoute bounce to
                // /login before the re-run of this effect (triggered by the token
                // the refresh handler just set) fetches /api/auth/me and sets the
                // user. The re-run's valid-token path ends the loading state.
                return;
            }
            setIsLoading(false);
        };

        checkAuth();
        // Intentionally keyed on `token` only. `user` is read solely as a guard to
        // skip re-validation on a refresh-driven token change; we must NOT re-run
        // this effect when `user` changes (that would re-fire on every setUser).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    // Login function
    const login = async (email: string, password: string) => {
        setError(null);
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                // We intentionally don't hash passwords on the client side for several security reasons:
                // 1. If we hash on the client, the hash itself becomes the effective password, which doesn't add security
                // 2. It prevents the server from implementing proper salting strategies
                // 3. The industry standard is to send passwords over HTTPS (encrypted connection) and hash on the server
                // 4. Client-side hashing can interfere with proper password storage practices
                body: JSON.stringify({ email, password }),
                credentials: 'include' // Include cookies
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Login failed');
            }

            const data = await response.json();
            setUser(data.user);
            setToken(data.token);
            authStorage.setToken(data.token);
            notifyLogin(data.token);
            navigate('/');
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : 'Login failed');
            throw error;
        }
    };

    // Register function
    const register = async (email: string, name: string, password: string) => {
        setError(null);
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, name, password }),
                credentials: 'include'
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Registration failed');
            }

            // After registration, log the user in
            await login(email, password);
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : 'Registration failed');
            throw error;
        }
    };

    // Logout function
    const logout = async () => {
        try {
            await fetch(`${API_BASE_URL}/api/auth/logout`, {
                method: 'POST',
                credentials: 'include' // Include cookies
            });

            authStorage.clearToken();
            setToken(null);
            setUser(null);
            navigate('/login');
        } catch (error) {
            console.error('Error logging out:', error);
        }
    };

    // Delete account function
    const deleteAccount = async (password: string) => {
        setError(null);
        try {
            if (!token || token === 'null' || token === 'undefined' || token.length <= 10) {
                throw new Error('You must be logged in to delete your account');
            }

            const response = await fetch(`${API_BASE_URL}/api/auth/delete-account`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ password })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete account');
            }

            // Clear local state and redirect
            authStorage.clearToken();
            setToken(null);
            setUser(null);
            navigate('/login');
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : 'Failed to delete account');
            throw error;
        }
    };

    // Change password function
    const changePassword = async (currentPassword: string, newPassword: string) => {
        setError(null);
        try {
            if (!token || token === 'null' || token === 'undefined' || token.length <= 10) {
                throw new Error('You must be logged in to change your password');
            }

            const response = await fetch(`${API_BASE_URL}/api/auth/change-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include', // Include cookies for new DAL architecture
                body: JSON.stringify({ currentPassword, newPassword })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to change password');
            }

            const data = await response.json();
            setUser(data.user);
            return data;
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : 'Failed to change password');
            throw error;
        }
    };

    // Update preferred language function
    const updateLanguage = async (language: Language) => {
        setError(null);
        try {
            if (!token || token === 'null' || token === 'undefined' || token.length <= 10) {
                throw new Error('You must be logged in to update your language preference');
            }

            const response = await fetch(`${API_BASE_URL}/api/users/language`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ selectedLanguage: language })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update language preference');
            }

            const data = await response.json();
            setUser({ ...user!, selectedLanguage: language });
            return data;
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : 'Failed to update language preference');
            throw error;
        }
    };

    // Persist the user's chosen avatar (an icons8 id) or clear it (null). Mirrors
    // updateLanguage: PUT to the server, then optimistically patch local user state.
    const updateAvatar = async (avatarIconId: string | null) => {
        setError(null);
        try {
            if (!token || token === 'null' || token === 'undefined' || token.length <= 10) {
                throw new Error('You must be logged in to update your avatar');
            }

            const response = await fetch(`${API_BASE_URL}/api/users/avatar`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ avatarIconId })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to update avatar');
            }

            setUser({ ...user!, avatarIconId });
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : 'Failed to update avatar');
            throw error;
        }
    };

    // Toggle the account's Reading / Writing mastery goals (docs/MASTERY_REWORK.md).
    // Enabling a goal can demote some Mastered cards to Comfortable (the pbh math
    // reweights across more goal tracks) — surfaced in the account settings copy.
    const updateGoals = async (goals: { readingGoal?: boolean; writingGoal?: boolean }) => {
        setError(null);
        try {
            if (!token || token === 'null' || token === 'undefined' || token.length <= 10) {
                throw new Error('You must be logged in to update your goals');
            }

            const response = await fetch(`${API_BASE_URL}/api/users/goals`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                credentials: 'include',
                body: JSON.stringify(goals)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to update goals');
            }

            setUser({ ...user!, ...goals });
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : 'Failed to update goals');
            throw error;
        }
    };

    const value = {
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
        changePassword,
        deleteAccount,
        updateLanguage,
        updateAvatar,
        updateGoals,
        error
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Custom hook to use the AuthContext — intentionally co-located with the provider
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
