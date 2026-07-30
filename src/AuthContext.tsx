import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from './constants';
// `User` is the shared wire contract (server/contracts/wire.ts → UserProfile). This
// file used to declare a PRIVATE, non-exported `interface User` that was the only one
// of the app's three User declarations with the current field set — see
// docs/ARCHITECTURE_REVIEW.md finding 2.
import type { Language, User } from './types';
import { apiPost, apiPut, apiDelete } from './api/http';
import { setFetchInterceptorHandlers, setupFetchInterceptor } from './utils/fetchInterceptor';
import { setRefreshHandlers, attemptTokenRefresh, endServerSession } from './utils/tokenRefresh';
import { notifyLogin } from './utils/authSync';
import * as authStorage from './utils/authStorage';
import { authLog, authError, tokenPreview, readBodySafely, rateLimitInfo } from './utils/authDebug';

/**
 * The subset of the profile that account settings can PATCH. Each key maps to one
 * `PUT /api/users/<endpoint>` route; `updateProfile` below sends the patch and mirrors
 * it into local user state.
 */
type ProfilePatch = Partial<
    Pick<User, 'selectedLanguage' | 'avatarIconId' | 'readingGoal' | 'writingGoal' | 'showSegmentSpaces'>
>;

/**
 * Is the in-memory access token usable?
 *
 * This predicate was copy-pasted inline at five call sites. `'null'` / `'undefined'`
 * are guarded as STRINGS because a stringified null used to be persisted to storage;
 * the length check rejects any other junk that is too short to be a JWT.
 */
function isUsableToken(token: string | null): boolean {
    return !!token && token !== 'null' && token !== 'undefined' && token.length > 10;
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
    updateDisplaySettings: (settings: { showSegmentSpaces?: boolean }) => Promise<void>;
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
        authLog('checkAuth effect fired', {
            token: tokenPreview(token),
            hasUser: !!user,
            isLoading,
        });
        if (token && user) {
            authLog('checkAuth: skipped (token + user already present)');
            return;
        }
        const checkAuth = async () => {
            // Only proceed if we have a valid token
            if (isUsableToken(token)) {
                try {
                    // Deliberately a RAW fetch, not apiGet: this call decides whether the
                    // session is alive, and its non-ok branch must be handled here rather
                    // than routed through the interceptor's refresh-and-retry.
                    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        },
                        credentials: 'include' // Include cookies for new DAL architecture
                    });

                    if (response.ok) {
                        const userData = await response.json();
                        authLog('checkAuth: /me OK', { userId: userData?.id });
                        setUser(userData);
                        notifyLogin(token);
                    } else {
                        authError('checkAuth: /me REJECTED — this CLEARS the session', {
                            status: response.status,
                            token: tokenPreview(token),
                        });
                        // The access token is unusable. End the session on the
                        // server as well before clearing it locally: setToken(null)
                        // re-runs this effect down the no-token branch, which
                        // silently refreshes — and if the refresh cookie were still
                        // alive it would mint another token that fails /me the same
                        // way, spinning this effect forever (each turn nulling
                        // `user`, which also clobbers a login the user just made).
                        // Revoking makes the follow-up refresh fail once and stop.
                        console.log('Token validation failed, ending session');
                        await endServerSession();
                        setToken(null);
                    }
                } catch (error) {
                    // Network/parse failure — clear locally only. This is not a
                    // credential verdict, so we must NOT revoke a session that may
                    // still be perfectly good once the network recovers.
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
                authLog('checkAuth: no usable access token — attempting silent refresh');
                const refreshed = await attemptTokenRefresh();
                authLog('checkAuth: silent refresh result', {
                    refreshed: tokenPreview(refreshed),
                    // A refresh that returns a token IDENTICAL to the one already in
                    // state is a hang: React bails out of the re-render, so this
                    // effect never re-runs and isLoading stays true forever (the
                    // login screen then renders nothing at all).
                    identicalToStateToken: !!refreshed && refreshed === token,
                });
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
        authLog('login: POST /api/auth/login', { email, apiBase: API_BASE_URL });
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

            // Read the body ONCE, defensively: a bare response.json() on a
            // non-JSON error body (nginx HTML 502, empty 429) throws a SyntaxError,
            // and the user would see "Unexpected token <" instead of the server's
            // actual complaint.
            const { json: body, text: rawBody } = await readBodySafely(response);

            if (!response.ok) {
                authError('login: server REJECTED', {
                    ...rateLimitInfo(response),
                    error: body?.error,
                    code: body?.code,
                    rawBody: body ? undefined : rawBody.slice(0, 300),
                });
                throw new Error(
                    (typeof body?.error === 'string' && body.error) ||
                    `Login failed (HTTP ${response.status})`
                );
            }

            const data = body as { user?: User; token?: string } | null;
            if (!data?.token || !data.user) {
                // 200 with a malformed payload — would otherwise leave the app in a
                // half-logged-in state (user set, no token) with no error shown.
                authError('login: 200 but payload is malformed', { rawBody: rawBody.slice(0, 300) });
                throw new Error('Login failed: the server returned an unexpected response');
            }

            authLog('login: server ACCEPTED', {
                userId: data.user.id,
                token: tokenPreview(data.token),
                sameAsCurrentToken: data.token === token,
            });

            setUser(data.user);
            setToken(data.token);
            authStorage.setToken(data.token);
            notifyLogin(data.token);
            navigate('/');
            authLog('login: state set + navigated to /');
        } catch (error: unknown) {
            authError('login: threw', error);
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
            // Shared with the interceptor's session-expiry path: revokes the
            // refresh token server-side and clears both auth cookies.
            await endServerSession();

            setToken(null);
            setUser(null);
            navigate('/login');
        } catch (error) {
            console.error('Error logging out:', error);
        }
    };

    /**
     * Run an authenticated account mutation: assert a usable token, call `fn`, and
     * funnel any failure into `error` state before rethrowing.
     *
     * The token check is a UX guard, not the security boundary — every one of these
     * endpoints authenticates server-side. It exists so a logged-out click reports
     * "You must be logged in to …" instead of bouncing off a 401.
     */
    const withAuth = async <T,>(action: string, fn: () => Promise<T>): Promise<T> => {
        setError(null);
        try {
            if (!isUsableToken(token)) {
                throw new Error(`You must be logged in to ${action}`);
            }
            return await fn();
        } catch (err: unknown) {
            // ApiError's message is already derived from the server's `error` field.
            setError(err instanceof Error ? err.message : `Failed to ${action}`);
            throw err;
        }
    };

    // Delete account function
    const deleteAccount = async (password: string) =>
        withAuth('delete your account', async () => {
            await apiDelete('/api/auth/deleteAccount', { password });
            // Clear local state and redirect
            authStorage.clearToken();
            setToken(null);
            setUser(null);
            navigate('/login');
        });

    // Change password function. Returns nothing: both call sites (ProfilePage,
    // SettingsPage) only await it, and the refreshed user is applied here.
    const changePassword = async (currentPassword: string, newPassword: string): Promise<void> =>
        withAuth('change your password', async () => {
            const data = await apiPost<{ user: User }>('/api/auth/changePassword', {
                currentPassword,
                newPassword,
            });
            setUser(data.user);
        });

    /**
     * The one account-settings write path.
     *
     * `updateLanguage` / `updateAvatar` / `updateGoals` / `updateDisplaySettings` were
     * four ~30-line functions differing ONLY in URL, payload and error string — see
     * docs/ARCHITECTURE_REVIEW.md finding 5. They are now four one-liners over this.
     * Each PUT still hits its own endpoint (the routes validate different fields), and
     * the local user state is patched optimistically with the same object that was sent.
     */
    const updateProfile = async (endpoint: string, action: string, patch: ProfilePatch) =>
        withAuth(action, async () => {
            await apiPut(`/api/users/${endpoint}`, patch);
            setUser((current) => (current ? { ...current, ...patch } : current));
        });

    const updateLanguage = (language: Language) =>
        updateProfile('language', 'update your language preference', { selectedLanguage: language });

    /** Persist the chosen avatar (an icons8 id) or clear it (null). */
    const updateAvatar = (avatarIconId: string | null) =>
        updateProfile('avatar', 'update your avatar', { avatarIconId });

    /**
     * Toggle the account's Reading / Writing mastery goals (docs/MASTERY_REWORK.md).
     * Enabling a goal can demote some Mastered cards to Comfortable (the pbh math
     * reweights across more goal tracks) — surfaced in the account settings copy.
     */
    const updateGoals = (goals: { readingGoal?: boolean; writingGoal?: boolean }) =>
        updateProfile('goals', 'update your goals', goals);

    /**
     * Toggle the account's display preferences (currently just word spacing in
     * segmented sentences — docs/EXAMPLE_SENTENCES.md). Purely cosmetic, so unlike
     * updateGoals it has no downstream effect on mastery data.
     */
    const updateDisplaySettings = (settings: { showSegmentSpaces?: boolean }) =>
        updateProfile('displaySettings', 'update your display settings', settings);

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
        updateDisplaySettings,
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
