import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from './constants';
import type { Language } from './types';

// Define the User type
interface User {
    id: string;
    email: string;
    name: string;
    selectedLanguage?: Language;
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
    updateLanguage: (language: Language) => Promise<void>;
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
    const [token, setToken] = useState<string | null>(() => {
        const storedToken = localStorage.getItem('token');
        // Handle both null and string 'null' cases
        return (!storedToken || storedToken === 'null' || storedToken === 'undefined') ? null : storedToken;
    });
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    // Check if the user is authenticated on mount
    useEffect(() => {
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
                    } else {
                        // If the token is invalid, clear it
                        console.log('Token validation failed, clearing stored token');
                        localStorage.removeItem('token');
                        setToken(null);
                    }
                } catch (error) {
                    console.error('Error checking authentication:', error);
                    localStorage.removeItem('token');
                    setToken(null);
                }
            } else if (token) {
                // If we have an invalid token, clear it immediately
                console.log('Invalid token detected, clearing:', token);
                localStorage.removeItem('token');
                setToken(null);
            }
            setIsLoading(false);
        };

        checkAuth();
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
            localStorage.setItem('token', data.token);
            navigate('/');
        } catch (error: any) {
            setError(error.message);
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
                body: JSON.stringify({ email, name, password })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Registration failed');
            }

            // After registration, log the user in
            await login(email, password);
        } catch (error: any) {
            setError(error.message);
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

            localStorage.removeItem('token');
            setToken(null);
            setUser(null);
            navigate('/login');
        } catch (error) {
            console.error('Error logging out:', error);
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
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
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
        } catch (error: any) {
            setError(error.message);
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
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
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
        } catch (error: any) {
            setError(error.message);
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
        updateLanguage,
        error
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Create a hook to use the AuthContext
export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
