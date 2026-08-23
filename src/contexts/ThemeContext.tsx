import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { ThemeProvider, createTheme, type Theme } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import { FONTS } from '../theme/fonts';
import { SIZE, WEIGHT, LEADING, TRACKING } from '../theme/scale';
import { DD_TONES } from '../utils/cardTextColor';
// The neutral surface/ink tokens this file restates verbatim. Only the values whose
// SEMANTIC name matches the token are pulled from here — see the note below on the
// several palettes that share values by coincidence.
import { COLORS } from '../theme/colors';

// Per-surface color tokens for the flashcard learn page.
// All 19 fields must be defined for every theme — no optional fields.
export interface FlashcardPalette {
    background: string;         // page & EIC sheet background
    flashCard: string;          // card face background
    border: string;             // dividers, chip borders, dashed separators
    onSurface: string;          // primary text on any flashcard surface
    // dd color (flp card faces + eip header gloss), all languages. The English gloss is
    // supporting text next to the headword, so it is de-emphasized one step off `onSurface`
    // rather than sharing it. Always one of the two DD_TONES — this token just says which
    // tone the card theme runs; a per-card Contrast pick overrides the choice with the
    // other tone from the same pair.
    dd: string;
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
    // Typography variants are mapped onto the shared type scale (src/theme/scale.ts)
    // so every <Typography> across the app draws from the same 9-step ramp.
    const baseTheme = {
        typography: {
            fontFamily: FONTS.sans,
            h1: { fontSize: SIZE.display, fontWeight: WEIGHT.bold, lineHeight: LEADING.none },
            h2: { fontSize: SIZE.heading, fontWeight: WEIGHT.bold, lineHeight: LEADING.tight },
            h3: { fontSize: SIZE.heading, fontWeight: WEIGHT.bold, lineHeight: LEADING.tight },
            h4: { fontSize: SIZE.title, fontWeight: WEIGHT.bold, lineHeight: LEADING.tight },
            h5: { fontSize: SIZE.title, fontWeight: WEIGHT.semibold, lineHeight: LEADING.tight },
            h6: { fontSize: SIZE.subtitle, fontWeight: WEIGHT.semibold, lineHeight: LEADING.tight },
            subtitle1: { fontSize: SIZE.bodyLg, fontWeight: WEIGHT.medium, lineHeight: LEADING.normal },
            subtitle2: { fontSize: SIZE.body, fontWeight: WEIGHT.semibold, lineHeight: LEADING.normal },
            body1: { fontSize: SIZE.bodyLg, fontWeight: WEIGHT.regular, lineHeight: LEADING.normal },
            body2: { fontSize: SIZE.body, fontWeight: WEIGHT.regular, lineHeight: LEADING.normal },
            caption: { fontSize: SIZE.caption, fontWeight: WEIGHT.medium, lineHeight: LEADING.normal },
            button: { fontSize: SIZE.body, fontWeight: WEIGHT.semibold, lineHeight: LEADING.normal, letterSpacing: TRACKING.wide, textTransform: 'none' as const },
            overline: { fontSize: SIZE.micro, fontWeight: WEIGHT.semibold, lineHeight: LEADING.none, letterSpacing: TRACKING.caps, textTransform: 'uppercase' as const },
        },
        shape: {
            borderRadius: 8,
        },
        // ── The shelf system's INTERACTIVE atoms (docs/SHELF_REDESIGN.md § A5) ──
        //
        // The design's `.btn2` / `.btn3` / `.chip` / `.field` / `.mode` are skins on
        // controls MUI already ships, so they land HERE rather than as five new wrapper
        // components. That is a deliberate call: the app has ~157 `<Button>`s, 35
        // `<TextField>`s and 14 `<Chip>`s, and a wrapper would have meant touching every
        // one of those call sites to change how they look. A theme override reaches all
        // of them and leaves the code alone.
        //
        // SCOPING RULE, and it matters: SHAPE is overridden for every color (a pill is a
        // pill whether it is destructive or not), but GROUND AND INK are overridden only
        // on the `*Primary` slots. `color="error"` / `"success"` buttons keep their
        // semantic hue — repainting those ink-black would erase the one thing they are
        // saying. Anything with no explicit `color` defaults to primary and so picks up
        // the design's ink automatically.
        //
        // ⚠️ These live on the SHARED base theme, so the Dark / Ocean / Nature themes
        // inherit an ink-black button on their own grounds. That is knowingly wrong and
        // knowingly deferred: decision D4 runs the app on one light palette during the
        // redesign and the other three are not re-derived yet.
        components: {
            MuiButton: {
                defaultProps: {
                    // The design draws no elevation on either button; MUI's default
                    // contained shadow fights the flat paper ground.
                    disableElevation: true,
                },
                styleOverrides: {
                    root: {
                        fontFamily: FONTS.sans,
                        textTransform: 'none' as const,
                        fontWeight: WEIGHT.semibold,
                        gap: '7px',
                    },
                    // `.btn2` — the dark pill CTA.
                    contained: {
                        borderRadius: '999px',
                        padding: '11px 16px',
                        fontSize: 13,
                    },
                    containedPrimary: {
                        backgroundColor: COLORS.onSurface,
                        color: '#fff',
                        '&:hover': { backgroundColor: COLORS.iconColor },
                    },
                    // `.btn3` — the outlined secondary. Radius 14, not a pill: the design
                    // uses it as a full-width block action, and a 999px block reads as a
                    // stretched pill rather than a button.
                    outlined: {
                        borderRadius: '14px',
                        padding: '13px',
                        fontSize: 13.5,
                    },
                    outlinedPrimary: {
                        borderColor: COLORS.border,
                        color: COLORS.iconColor,
                        '&:hover': { borderColor: COLORS.onSurface, backgroundColor: COLORS.rowHoverBg },
                    },
                },
            },
            // `.chip` / `.chip.on` — the filter pill. OUTLINED is the resting state and
            // FILLED is the selected one, which inverts MUI's usual reading of those two
            // variants; that inversion is the design's, and it is why a selected chip is
            // built as `variant="filled"` rather than by adding a class.
            MuiChip: {
                styleOverrides: {
                    root: {
                        fontFamily: FONTS.sans,
                        fontSize: 12,
                        fontWeight: WEIGHT.medium,
                        borderRadius: '999px',
                        height: 'auto',
                    },
                    label: { padding: '7px 12px' },
                    // Scoped the same way the buttons are — but Chip needs it spelled out,
                    // because MUI's chip variant slots (`outlined` / `filled`) apply to
                    // EVERY colour, not just primary. Repainting them flat would have
                    // erased the reader's `color="error"` "Vocab processing failed" chip
                    // and the dictionary's info chips. `colorDefault` + `*Primary` is the
                    // exact set that means "no semantic colour was asked for".
                    outlined: {
                        '&.MuiChip-colorDefault, &.MuiChip-outlinedPrimary': {
                            borderColor: COLORS.border,
                            color: COLORS.iconColor,
                        },
                    },
                    filled: {
                        '&.MuiChip-colorDefault, &.MuiChip-filledPrimary': {
                            backgroundColor: COLORS.onSurface,
                            color: '#fff',
                        },
                    },
                },
            },
            // `.field` — the outlined input shell. The design's leading icon is not
            // reproduced here; it is per-call-site (`InputProps.startAdornment`), and
            // forcing one in the theme would put a search glyph on every text field.
            MuiOutlinedInput: {
                styleOverrides: {
                    root: {
                        borderRadius: '15px',
                        backgroundColor: COLORS.white,
                        fontFamily: FONTS.sans,
                        fontSize: 14.5,
                    },
                    notchedOutline: { borderColor: COLORS.border },
                    input: { padding: '13px 15px' },
                },
            },
            // `.mode` — the segmented control: one outlined box, hairline-divided, with
            // the selected segment inverted to ink. MUI's default gives each button its
            // own border and rounds the group's ends; both are undone here.
            MuiToggleButtonGroup: {
                styleOverrides: {
                    root: {
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: '14px',
                        overflow: 'hidden',
                        backgroundColor: COLORS.white,
                    },
                    grouped: {
                        flex: 1,
                        border: 'none',
                        borderRadius: 0,
                        '&:not(:last-of-type)': { borderRight: `1px solid ${COLORS.rowBorder}` },
                    },
                },
            },
            MuiToggleButton: {
                styleOverrides: {
                    root: {
                        fontFamily: FONTS.sans,
                        textTransform: 'none' as const,
                        fontSize: 13.5,
                        fontWeight: WEIGHT.semibold,
                        padding: '14px 4px',
                        color: COLORS.iconColor,
                        '&.Mui-selected': {
                            backgroundColor: COLORS.onSurface,
                            color: '#fff',
                            '&:hover': { backgroundColor: COLORS.iconColor },
                        },
                    },
                },
            },
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
                        dd:                 DD_TONES.light,
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
                        onSurface:          COLORS.onSurface,
                        dd:                 DD_TONES.dark,
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
                        onSurface:          COLORS.onSurface,
                        dd:                 DD_TONES.dark,
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
                    eic: { header: COLORS.header },
                    flashcard: {
                        background:         COLORS.background,
                        flashCard:          COLORS.card,
                        border:             'rgba(92,92,102,0.18)',
                        onSurface:          COLORS.onSurface,
                        dd:                 DD_TONES.dark,
                        textSecondary:      '#6E6E73',
                        toggleActiveBg:     '#5C5C66',
                        toggleInactiveBg:   '#F2F2F4',
                        scrim:              'rgba(20,17,12,0.45)',
                        subtleBg:           'rgba(0,0,0,0.03)',
                        moreInfoPill:       'rgba(255,255,255,0.6)',
                        audioBtn:           'rgba(29,27,32,0.06)',
                        grabber:            'rgba(29,27,32,0.18)',
                        tabUnderline:       COLORS.onSurface,
                        imagePlaceholder:   '#ffffff',
                        hskPill:            COLORS.hskChip,
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
