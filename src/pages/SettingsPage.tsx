import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Snackbar, Switch } from '@mui/material';
import LeafPage from '../components/LeafPage';
import Icon from '../components/Icon';
import { SettingsSection, OptionRow, SwitchRow } from '../components/primitives';
import { useTheme, type ThemeMode } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { LANGUAGE_FLAGS, LANGUAGE_NAMES } from '../types';
import type { Language } from '../types';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSlideNavigate } from '../hooks/useSlideNavigate';
import { useTTSSettings, AUDIO_MODE_ORDER, type AudioMode } from '../hooks/useTTSSettings';
import { useFlashcardLearnSettings } from '../hooks/useFlashcardLearnSettings';
import { COLORS } from '../theme/colors';
import { FONTS } from '../theme/fonts';

// The narration control's three states, in the order they appear. Copy is
// deliberately concrete about the COST of each route rather than naming the
// mechanism: a learner cannot act on "media element vs Web Audio", but can act on
// "pauses your music" and "follows the silent switch". See docs/AUDIO_PLAYBACK.md.
const AUDIO_MODE_COPY: Record<AudioMode, { title: string; subtitle: string }> = {
    off: {
        title: 'Off',
        subtitle: 'Nothing plays on its own. Tap a speaker button to hear a word.',
    },
    passthrough: {
        title: 'Play over everything',
        subtitle: 'Plays even when your phone is on silent. Pauses music, and adds playback controls to your lock screen.',
    },
    media: {
        title: 'Play alongside media',
        subtitle: "Mixes with music and video without interrupting them, but stays silent when your phone's silent switch is on.",
    },
};

// Order comes from AUDIO_MODE_ORDER, the same constant the header chip cycles
// through — so the list here and the tap sequence there can never disagree.
const AUDIO_MODE_OPTIONS = AUDIO_MODE_ORDER.map((value) => ({ value, ...AUDIO_MODE_COPY[value] }));

/**
 * Settings · preferences (`/settings`) — artboard 11 of the shelf redesign
 * (docs/SHELF_REDESIGN.md entry 11).
 *
 * The READ-heavy half of settings: theme, learning language, narration, display, and a
 * chevron row down to `/settings/account` (artboard 11b, `AccountSecurityPage`) which
 * holds the write-heavy half — the password form and the danger zone.
 *
 * Everything here is a `SettingsSection` (`.set`) holding `OptionRow`s (`.opt`) and
 * `SwitchRow`s (`.sw`). It replaced a 675-line stack of MUI `Paper` + `CardContent` +
 * `FormControl` + `RadioGroup` + full-width `Card` option tiles.
 *
 * ⚠️ NO `Container`, NO page padding. `.set`'s own `14px 18px 0` margin is the gutter;
 * the old `<Container maxWidth="sm" sx={{ py: 4 }}>` would double it.
 *
 * Depended on by: docs/SHELF_REDESIGN.md entry 11, docs/LEAF_NODE_PAGES.md,
 * docs/UX_AND_NAVIGATION.md, docs/EXAMPLE_SENTENCES.md (the word-spacing toggle).
 */

/**
 * The swatch each theme is represented by in the four-across row.
 *
 * ⚠️ THESE ARE NOT THE THEMES' REAL PALETTES. Each is the one colour that best says
 * "this is what the app will look like" at 44px — the ground for Light and Dark, the
 * accent hue for Ocean and Nature — because the themes' own tokens (D4: Dark, Ocean and
 * Nature are not re-derived for this design yet) would render three near-identical
 * off-whites. Revisit when those palettes land; until then a swatch is a signpost, not
 * a preview.
 */
const THEME_SWATCHES: Record<ThemeMode, string> = {
    light: COLORS.background,
    dark: '#26252B',
    blue: COLORS.blu,
    green: COLORS.grn,
};

function SettingsPage() {
    usePageTitle("Settings");
    const navigate = useNavigate();
    const slideNavigate = useSlideNavigate();
    const { themeMode, setThemeMode, availableThemes } = useTheme();
    const { user, updateLanguage, updateDisplaySettings } = useAuth();
    const [languageSuccess, setLanguageSuccess] = useState(false);
    const [languageError, setLanguageError] = useState<string | null>(null);
    const { mode: audioMode, setMode: setAudioMode } = useTTSSettings();
    // Tone coloring lives in the flp learn-settings blob (it is read by every surface
    // that renders a reading); this page is simply where it is now EDITED.
    const { settings: learnSettings, update: updateLearnSettings } = useFlashcardLearnSettings();

    const activeTheme = availableThemes.find((t) => t.value === themeMode);

    /**
     * Arrow-key navigation for the theme swatch row.
     *
     * A `role="radiogroup"` of `role="radio"` buttons is only half a radio group
     * without this: the ARIA contract is ONE tab stop for the group, with arrows moving
     * (and moving the selection) inside it. Paired with the roving `tabIndex` below —
     * only the selected swatch is tabbable, so Tab enters the group once and leaves it
     * once instead of stopping four times.
     *
     * Both axes are handled because the row is horizontal on screen but a
     * screen-reader user may drive it either way.
     */
    const handleSwatchKeyDown = (e: ReactKeyboardEvent, index: number) => {
        const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (delta === 0) return;
        e.preventDefault();
        const next = availableThemes[(index + delta + availableThemes.length) % availableThemes.length];
        setThemeMode(next.value);
        // Focus has to follow the selection or the next arrow press comes from the old
        // element and the group appears to jump.
        const row = (e.currentTarget as HTMLElement).parentElement;
        row?.querySelector<HTMLElement>(`.settings-page__theme-swatch--${next.value}`)?.focus();
    };

    // Display preferences (docs/EXAMPLE_SENTENCES.md). Word spacing is account-level
    // (users."showSegmentSpaces", migration 129) rather than a device-local flp toggle,
    // so the eip and the cdp can never disagree. Chinese-only: Latin-script sentences
    // are always rendered spaced (SegmentedSentenceDisplay's isLatin branch), so the
    // switch would be a no-op for Spanish. selectedLanguage is nullable with a 'zh'
    // default in the DB, so treat "unset" as Chinese.
    const [displaySaving, setDisplaySaving] = useState(false);
    const showDisplaySettings = (user?.selectedLanguage ?? 'zh') === 'zh';
    const handleToggleSegmentSpaces = async (next: boolean) => {
        setDisplaySaving(true);
        try {
            await updateDisplaySettings({ showSegmentSpaces: next });
        } catch {
            /* AuthContext surfaces the error; the switch reverts with the user state */
        } finally {
            setDisplaySaving(false);
        }
    };

    const handleLanguageChange = async (newLanguage: Language) => {
        try {
            await updateLanguage(newLanguage);
            setLanguageSuccess(true);
            setLanguageError(null);
        } catch (error: unknown) {
            setLanguageError(error instanceof Error ? error.message : 'Failed to update language preference');
            setLanguageSuccess(false);
        }
    };

    // The FLAG + NAME both come from the shared contract (server/contracts/wire.ts) so
    // this picker cannot drift from every other place a language is named — it used to
    // hardcode its own copy, which is how "Chinese (Mandarin)" survived here after the
    // rename. Only the description, which is picker-specific prose, lives locally.
    const availableLanguages: { value: Language; label: string; description: string }[] = [
        {
            value: 'zh',
            label: `${LANGUAGE_FLAGS.zh} ${LANGUAGE_NAMES.zh}`,
            description: 'Simplified and traditional, with pinyin',
        },
        {
            value: 'es',
            label: `${LANGUAGE_FLAGS.es} ${LANGUAGE_NAMES.es}`,
            description: 'Plain text — no pronunciation overlay',
        },
    ];

    return (
        // Settings is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md): no footer, DOWN
        // back arrow (→ Account, since it opens from the gear in the Account
        // header), slides up on enter / down on exit. Phone-frame sizing comes from
        // MobileDemoFrame via Layout.tsx (/settings is in MOBILE_DEMO_PATHS).
        <LeafPage title="Settings" onBack={() => navigate("/account")} className="settings-page">
            <Box className="settings-page__scroll" sx={{ flex: 1, overflowY: "auto" }}>
                {/* ── Colour theme — a four-swatch row ────────────────────────────
                    The artboard's argument, and it is a good one: four full option
                    cards cost a third of the screen for a choice made once. The row
                    is a radiogroup so arrow keys still move between the four. */}
                <SettingsSection
                    className="settings-page__theme-section"
                    icon="palette"
                    title="Color Theme"
                    description="Choose a theme that suits your learning environment."
                >
                    <Box
                        className="settings-page__theme-swatches"
                        role="radiogroup"
                        aria-label="Color theme"
                        sx={{ display: 'flex', gap: '9px', marginTop: '11px' }}
                    >
                        {availableThemes.map((theme, index) => {
                            const selected = themeMode === theme.value;
                            return (
                                <Box
                                    key={theme.value}
                                    component="button"
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    aria-label={`${theme.label} — ${theme.description}`}
                                    className={`settings-page__theme-swatch settings-page__theme-swatch--${theme.value}`}
                                    onClick={() => setThemeMode(theme.value)}
                                    onKeyDown={(e: ReactKeyboardEvent) => handleSwatchKeyDown(e, index)}
                                    // Roving tabindex — see handleSwatchKeyDown.
                                    tabIndex={selected ? 0 : -1}
                                    sx={{
                                        flex: 1,
                                        minWidth: 0,
                                        textAlign: 'center',
                                        background: 'none',
                                        border: 'none',
                                        padding: 0,
                                        cursor: 'pointer',
                                    }}
                                >
                                    <Box
                                        className="settings-page__theme-swatch-chip"
                                        sx={{
                                            height: 44,
                                            borderRadius: '12px',
                                            backgroundColor: THEME_SWATCHES[theme.value],
                                            // Selection is a RING rather than a border so the
                                            // swatch's own 44px height never changes — four
                                            // chips in a row must stay on one baseline.
                                            boxShadow: selected ? `0 0 0 1.5px ${COLORS.onSurface}` : 'none',
                                            border: selected ? 'none' : `1px solid ${COLORS.rowBorder}`,
                                        }}
                                    />
                                    <Typography
                                        className="settings-page__theme-swatch-label"
                                        sx={{
                                            fontFamily: FONTS.sans,
                                            fontSize: 11.5,
                                            fontWeight: selected ? 600 : 400,
                                            color: selected ? COLORS.onSurface : COLORS.textSecondary,
                                            marginTop: '5px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {theme.label}
                                    </Typography>
                                </Box>
                            );
                        })}
                    </Box>
                    {/* The chosen theme's description, which the swatch row has no room
                        for. This is also where the old "your preference is saved
                        automatically" Alert went: an info banner for a control that
                        applies instantly is a banner nobody needs. */}
                    {activeTheme && (
                        <Typography
                            className="settings-page__theme-active-note"
                            sx={{
                                fontFamily: FONTS.sans,
                                fontSize: 12,
                                color: COLORS.textSecondary,
                                lineHeight: 1.45,
                                marginTop: '9px',
                            }}
                        >
                            {activeTheme.label} · {activeTheme.description}
                        </Typography>
                    )}
                </SettingsSection>

                {/* ── Learning language ──────────────────────────────────────────── */}
                <SettingsSection
                    className="settings-page__language-section"
                    icon="language"
                    title="Learning Language"
                    description="Filters your vocabulary entries and dictionary lookups."
                >
                    {availableLanguages.map((lang) => (
                        <OptionRow
                            key={lang.value}
                            className={`settings-page__language-option settings-page__language-option--${lang.value}`}
                            name="learning-language"
                            value={lang.value}
                            checked={(user?.selectedLanguage ?? 'zh') === lang.value}
                            onChange={(value) => handleLanguageChange(value as Language)}
                            title={lang.label}
                            subtitle={lang.description}
                        />
                    ))}
                </SettingsSection>

                {/* ── Narration (TTS) ─────────────────────────────────────────────
                    The app's ONE narration setting. Three states on one axis for the
                    reader, two fields underneath (autoplay + route) so that turning
                    audio off and back on restores the route they picked — see
                    useTTSSettings and docs/AUDIO_PLAYBACK.md. Rendered as OptionRows
                    (not a Switch) to match the Learning Language section, the app's
                    other pick-one control. A speaker button always speaks, in every
                    state, which is why "Off" describes autoplay rather than silence. */}
                <SettingsSection
                    className="narration-settings-section"
                    icon="volume_up"
                    title="Narration"
                    description="How the app plays audio on your phone."
                >
                    {AUDIO_MODE_OPTIONS.map((option) => (
                        <OptionRow
                            key={option.value}
                            className={`narration-mode-option narration-mode-option--${option.value}`}
                            name="narration-mode"
                            value={option.value}
                            checked={audioMode === option.value}
                            onChange={(value) => setAudioMode(value as AudioMode)}
                            title={option.title}
                            subtitle={option.subtitle}
                        />
                    ))}
                </SettingsSection>

                {/* ── Display — Chinese only (see showDisplaySettings) ───────────── */}
                {showDisplaySettings && (
                    <SettingsSection
                        className="settings-page__display-section"
                        icon="space_bar"
                        title="Display"
                    >
                        <SwitchRow
                            className="settings-page__segment-spaces-row"
                            title="Show spaces between words"
                            subtitle="Separates each word in example sentences, everywhere they appear."
                            control={
                                <Switch
                                    checked={user?.showSegmentSpaces === true}
                                    disabled={displaySaving}
                                    onChange={(e) => handleToggleSegmentSpaces(e.target.checked)}
                                    inputProps={{ 'aria-label': 'Show spaces between words' }}
                                />
                            }
                        />
                        {/* Tone coloring. Moved here from the flp settings sheet on
                            2026-08-28 (that sheet was then empty and was deleted): it is
                            a DISPLAY preference, applying to every reading the app
                            renders — flp, cdp, eip, the games, example sentences — not a
                            study control belonging to one page. Unlike the row above it
                            is still device-local (`flashcard.learn-settings`), not an
                            account column; it sits beside one because they answer the
                            same kind of question, not because they share a store. */}
                        <SwitchRow
                            className="settings-page__pinyin-color-row"
                            title="Color pinyin by tone"
                            subtitle="Tints each syllable by its tone, everywhere pinyin appears."
                            control={
                                <Switch
                                    checked={learnSettings.showPinyinColor}
                                    onChange={(e) => updateLearnSettings({ showPinyinColor: e.target.checked })}
                                    inputProps={{ 'aria-label': 'Color pinyin by tone' }}
                                />
                            }
                        />
                    </SettingsSection>
                )}

                {/* ── Down to the write-heavy half (artboard 11b) ─────────────────
                    A `.set` with no body: the artboard collapses the section card into
                    a single tappable row when all it does is navigate. */}
                <Box
                    component="button"
                    type="button"
                    className="settings-page__account-security-row"
                    onClick={() => slideNavigate('/settings/account')}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        width: 'calc(100% - 36px)',
                        margin: '14px 18px 0',
                        padding: '15px 16px',
                        borderRadius: '18px',
                        backgroundColor: COLORS.white,
                        border: `1px solid ${COLORS.rowBorder}`,
                        cursor: 'pointer',
                        textAlign: 'left',
                    }}
                >
                    <Icon name="lock" size={19} color={COLORS.iconColor} />
                    <Typography
                        sx={{
                            flex: 1,
                            fontFamily: FONTS.sans,
                            fontSize: 14,
                            fontWeight: 600,
                            color: COLORS.onSurface,
                        }}
                    >
                        Account &amp; security
                    </Typography>
                    <Icon name="chevron_right" size={18} color={COLORS.textFaint} />
                </Box>

                {/* Bottom clearance — a leaf page has no footer, but the last section
                    still needs air under it when the list is scrolled to the end. */}
                <Box className="settings-page__bottom-clearance" sx={{ height: 28 }} />
            </Box>

            {/* Success/Error Snackbars */}
            <Snackbar
                open={languageSuccess}
                autoHideDuration={3000}
                onClose={() => setLanguageSuccess(false)}
                message="Language preference updated successfully!"
            />
            <Snackbar
                open={!!languageError}
                autoHideDuration={5000}
                onClose={() => setLanguageError(null)}
                message={languageError}
            />
        </LeafPage>
    );
}

export default SettingsPage;
