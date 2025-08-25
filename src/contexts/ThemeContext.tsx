import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { ThemeProvider, createTheme, type Theme } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';

// Define available theme options
export type ThemeMode = 'light' | 'dark' | 'blue' | 'green';

interface ThemeContextType {
    themeMode: ThemeMode;
    setThemeMode: (mode: ThemeMode) => void;
    availableThemes: { value: ThemeMode; label: string; description: string }[];
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Theme configurations
const createAppTheme = (mode: ThemeMode): Theme => {
    const baseTheme = {
        typography: {
            fontFamily: 'system-ui, Avenir, Helvetica, Arial, sans-serif',
        },
        shape: {
            borderRadius: 8,
        },
    };

    switch (mode) {
        case 'dark':
            return createTheme({
                ...baseTheme,
                palette: {
                    mode: 'dark',
                    primary: {
                        main: '#90caf9',
                        light: '#bbdefb',
                        dark: '#42a5f5',
                    },
                    secondary: {
                        main: '#f48fb1',
                        light: '#f8bbd9',
                        dark: '#f06292',
                    },
                    background: {
                        default: '#121212',
                        paper: '#1e1e1e',
                    },
                    text: {
                        primary: '#ffffff',
                        secondary: 'rgba(255, 255, 255, 0.7)',
                    },
                },
            });

        case 'blue':
            return createTheme({
                ...baseTheme,
                palette: {
                    mode: 'light',
                    primary: {
                        main: '#1976d2',
                        light: '#42a5f5',
                        dark: '#1565c0',
                    },
                    secondary: {
                        main: '#dc004e',
                        light: '#ff5983',
                        dark: '#9a0036',
                    },
                    background: {
                        default: '#f5f7fa',
                        paper: '#ffffff',
                    },
                    text: {
                        primary: '#1a1a1a',
                        secondary: 'rgba(0, 0, 0, 0.6)',
                    },
                },
            });

        case 'green':
            return createTheme({
                ...baseTheme,
                palette: {
                    mode: 'light',
                    primary: {
                        main: '#2e7d32',
                        light: '#4caf50',
                        dark: '#1b5e20',
                    },
                    secondary: {
                        main: '#ff6f00',
                        light: '#ff8f00',
                        dark: '#e65100',
                    },
                    background: {
                        default: '#f1f8e9',
                        paper: '#ffffff',
                    },
                    text: {
                        primary: '#1a1a1a',
                        secondary: 'rgba(0, 0, 0, 0.6)',
                    },
                },
            });

        case 'light':
        default:
            return createTheme({
                ...baseTheme,
                palette: {
                    mode: 'light',
                    primary: {
                        main: '#1976d2',
                        light: '#42a5f5',
                        dark: '#1565c0',
                    },
                    secondary: {
                        main: '#dc004e',
                        light: '#ff5983',
                        dark: '#9a0036',
                    },
                    background: {
                        default: '#ffffff',
                        paper: '#ffffff',
                    },
                    text: {
                        primary: '#1a1a1a',
                        secondary: 'rgba(0, 0, 0, 0.6)',
                    },
                },
            });
    }
};

interface ThemeContextProviderProps {
    children: ReactNode;
}

export function ThemeContextProvider({ children }: ThemeContextProviderProps) {
    const [themeMode, setThemeModeState] = useState<ThemeMode>('light');

    // Available theme options
    const availableThemes = [
        { value: 'light' as ThemeMode, label: 'Light', description: 'Clean and bright theme' },
        { value: 'dark' as ThemeMode, label: 'Dark', description: 'Easy on the eyes in low light' },
        { value: 'blue' as ThemeMode, label: 'Ocean Blue', description: 'Professional blue theme' },
        { value: 'green' as ThemeMode, label: 'Nature Green', description: 'Calming green theme' },
    ];

    // Load theme from localStorage on mount
    useEffect(() => {
        const savedTheme = localStorage.getItem('vocabularyAppTheme') as ThemeMode;
        if (savedTheme && availableThemes.some(theme => theme.value === savedTheme)) {
            setThemeModeState(savedTheme);
        }
    }, []);

    // Save theme to localStorage when it changes
    const setThemeMode = (mode: ThemeMode) => {
        setThemeModeState(mode);
        localStorage.setItem('vocabularyAppTheme', mode);
    };

    const theme = createAppTheme(themeMode);

    const contextValue: ThemeContextType = {
        themeMode,
        setThemeMode,
        availableThemes,
    };

    return (
        <ThemeContext.Provider value={contextValue}>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                {children}
            </ThemeProvider>
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeContextProvider');
    }
    return context;
}
