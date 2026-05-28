import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { ThemeProvider, createTheme, type Theme } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';

// Per-surface color tokens for the flashcard learn page.
// All 18 fields must be defined for every theme — no optional fields.
export interface FlashcardPalette {
    background: string;         // page & EIC sheet background
    flashCard: string;          // card face background
    border: string;             // dividers, chip borders, dashed separators
    onSurface: string;          // primary text on any flashcard surface
    textSecondary: string;      // muted labels, inactive tab text, arrow icons
    toggleActiveBg: string;     // pinyin/spaces toggle — active (selected) background
    toggleInactiveBg: string;   // pinyin/spaces toggle — inactive background
    scrim: string;              // EIC modal backdrop overlay
    subtleBg: string;           // example sentence item + expansion section bg
    moreInfoPill: string;       // "More Info" pill button background
    audioBtn: string;           // circular audio button background
    grabber: string;            // drag handle pill on the EIC sheet
    tabUnderline: string;       // active tab ink underline
    imagePlaceholder: string;   // image placeholder box background
    hskPill: string;            // HSK level badge background
    cardShadow: string;         // prominent (front + flying) card box-shadow
    cardShadowSubtle: string;   // back-slot card box-shadow
    sheetShadow: string;        // EIC sheet box-shadow (upward)
}

// Augment MUI's Palette so every theme can define flashcard and eic tokens.
declare module '@mui/material/styles' {
    interface Palette {
        eic: { header: string };
        flashcard: FlashcardPalette;
    }
    interface PaletteOptions {
        eic?: { header?: string };
        flashcard?: FlashcardPalette;
    }
}

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
                        primary: '#eeeeee',
                        secondary: 'rgba(255, 255, 255, 0.7)',
                    },
                    eic: { header: '#2c2c2c' },
                    flashcard: {
                        background:         '#121212',
                        flashCard:          '#2c2c2c',
                        border:             'rgba(255,255,255,0.1)',
                        onSurface:          '#eeeeee',
                        textSecondary:      'rgba(255,255,255,0.45)',
                        toggleActiveBg:     '#4a4a4a',
                        toggleInactiveBg:   '#2a2a2a',
                        scrim:              'rgba(0,0,0,0.65)',
                        subtleBg:           'rgba(255,255,255,0.05)',
                        moreInfoPill:       'rgba(255,255,255,0.08)',
                        audioBtn:           'rgba(255,255,255,0.08)',
                        grabber:            'rgba(255,255,255,0.2)',
                        tabUnderline:       '#eeeeee',
                        imagePlaceholder:   '#3a3a3a',
                        hskPill:            '#5B8DEF',
                        cardShadow:         '2px 4px 12px rgba(0,0,0,0.6)',
                        cardShadowSubtle:   '1px 2px 6px rgba(0,0,0,0.5)',
                        sheetShadow:        '0 -8px 32px rgba(0,0,0,0.6)',
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
                        primary: '#333333',
                        secondary: 'rgba(0, 0, 0, 0.6)',
                    },
                    eic: { header: '#B5C7E3' },
                    flashcard: {
                        background:         '#F9F7F2',
                        flashCard:          '#BACFE6',
                        border:             'rgba(92,92,102,0.18)',
                        onSurface:          '#1C1C1E',
                        textSecondary:      '#8A8480',
                        toggleActiveBg:     '#C8D9EF',   // old light-blue surface, now the accent
                        toggleInactiveBg:   '#D7D7D4',
                        scrim:              'rgba(20,17,12,0.45)',
                        subtleBg:           'rgba(0,0,0,0.03)',
                        moreInfoPill:       'rgba(255,255,255,0.6)',
                        audioBtn:           'rgba(29,27,32,0.06)',
                        grabber:            'rgba(29,27,32,0.18)',
                        tabUnderline:       '#C8D9EF',   // old light-blue surface, now the accent
                        imagePlaceholder:   '#ffffff',
                        hskPill:            '#BACFE6',   // old light-blue card color, now the accent
                        cardShadow:         '2px 4px 4px rgba(0,0,0,0.25)',
                        cardShadowSubtle:   '1px 2px 3px rgba(0,0,0,0.15)',
                        sheetShadow:        '0 -8px 32px rgba(0,0,0,0.18)',
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
                        primary: '#333333',
                        secondary: 'rgba(0, 0, 0, 0.6)',
                    },
                    eic: { header: '#BFD3BF' },
                    flashcard: {
                        background:         '#F9F7F2',
                        flashCard:          '#CCDFC5',
                        border:             'rgba(92,92,102,0.18)',
                        onSurface:          '#1C1C1E',
                        textSecondary:      '#8A8480',
                        toggleActiveBg:     '#BDD9B5',   // old light-green surface, now the accent
                        toggleInactiveBg:   '#D7D7D4',
                        scrim:              'rgba(20,17,12,0.45)',
                        subtleBg:           'rgba(0,0,0,0.03)',
                        moreInfoPill:       'rgba(255,255,255,0.6)',
                        audioBtn:           'rgba(29,27,32,0.06)',
                        grabber:            'rgba(29,27,32,0.18)',
                        tabUnderline:       '#BDD9B5',   // old light-green surface, now the accent
                        imagePlaceholder:   '#ffffff',
                        hskPill:            '#AECBA4',   // old light-green card color, now the accent
                        cardShadow:         '2px 4px 4px rgba(0,0,0,0.25)',
                        cardShadowSubtle:   '1px 2px 3px rgba(0,0,0,0.15)',
                        sheetShadow:        '0 -8px 32px rgba(0,0,0,0.18)',
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
                        primary: '#333333',
                        secondary: 'rgba(0, 0, 0, 0.6)',
                    },
                    eic: { header: '#DDDDE0' },
                    flashcard: {
                        background:         '#F7F7F8',
                        flashCard:          '#ECECEE',
                        border:             'rgba(92,92,102,0.18)',
                        onSurface:          '#1C1C1E',
                        textSecondary:      '#6E6E73',
                        toggleActiveBg:     '#5C5C66',
                        toggleInactiveBg:   '#E4E4E7',
                        scrim:              'rgba(20,17,12,0.45)',
                        subtleBg:           'rgba(0,0,0,0.03)',
                        moreInfoPill:       'rgba(255,255,255,0.6)',
                        audioBtn:           'rgba(29,27,32,0.06)',
                        grabber:            'rgba(29,27,32,0.18)',
                        tabUnderline:       '#1C1C1E',
                        imagePlaceholder:   '#ffffff',
                        hskPill:            '#779BE7',
                        cardShadow:         '2px 4px 4px rgba(0,0,0,0.25)',
                        cardShadowSubtle:   '1px 2px 3px rgba(0,0,0,0.15)',
                        sheetShadow:        '0 -8px 32px rgba(0,0,0,0.18)',
                    },
                },
            });
    }
};

interface ThemeContextProviderProps {
    children: ReactNode;
}

// Static list of available themes — defined outside the component so the array
// reference is stable and doesn't need to be a dependency in useEffect calls.
const availableThemes = [
    { value: 'light' as ThemeMode, label: 'Light', description: 'Clean and bright theme' },
    { value: 'dark' as ThemeMode, label: 'Dark', description: 'Easy on the eyes in low light' },
    { value: 'blue' as ThemeMode, label: 'Ocean Blue', description: 'Professional blue theme' },
    { value: 'green' as ThemeMode, label: 'Nature Green', description: 'Calming green theme' },
];

export function ThemeContextProvider({ children }: ThemeContextProviderProps) {
    const [themeMode, setThemeModeState] = useState<ThemeMode>('light');

    // Load theme from localStorage on mount — availableThemes is module-level (not reactive)
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

// Custom hook to use the theme context — intentionally co-located with the provider
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeContextProvider');
    }
    return context;
}
