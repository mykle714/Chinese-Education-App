import { useEffect, useState } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import { useAuth } from '../../AuthContext';
import { SettingsSection, OptionRow } from '../../components/primitives';
import type { UserGender } from '../../types';
import {
    DEMOGRAPHICS_PURPOSE, EARLIEST_BIRTH_DATE, GENDER_CHOICES, PREFER_NOT_LABEL,
    birthDateProblem, todayIsoDate,
} from '../../utils/demographics';

/**
 * The Settings half of the signup question "who are you?" — `users."gender"` and
 * `users."birthDate"` (migration 164). Two sections rather than one because the page's rule
 * is ONE control per card: two radio groups in one card read as one broken group (see the
 * Voice section's note in SettingsPage).
 *
 * Both save on the tap, like every other row on the page — there is no Save button anywhere in
 * Settings, and a form that needed one here would be the odd one out.
 *
 * `null` is a real answer ("Prefer not to answer"), not a missing one: selecting it sends null
 * and the learner goes back to the pre-164 behaviour (default iw body, no description to NPCs).
 *
 * Layer: page-owned (only SettingsPage renders it), split out because SettingsPage is already
 * well past the ~300-line mark. Depended on by: docs/IMMERSIVE_WORLD.md § 5.5.
 */
export function AboutYouSections() {
    const { user, updateDemographics } = useAuth();
    const gender = user?.gender ?? null;
    const savedBirthDate = user?.birthDate ?? null;

    // The date section's radio is LOCAL state, not derived from `savedBirthDate`: picking
    // "Enter my date of birth" must reveal an empty field WITHOUT saving anything, because there
    // is no date yet to save. It follows the account afterwards — a stored date always shows the
    // field.
    const [enteringDate, setEnteringDate] = useState(false);
    const showDateField = enteringDate || savedBirthDate !== null;
    const [draftDate, setDraftDate] = useState(savedBirthDate ?? '');
    const [dateError, setDateError] = useState<string | null>(null);
    /** A failed write, tagged with the section it belongs under. */
    const [saveError, setSaveError] = useState<{ section: 'gender' | 'birthDate'; message: string } | null>(null);

    // Keep the field in step with the account — `user` can arrive after mount, and a save from
    // another tab/device lands here too. Keyed on the VALUE, so a typed-but-invalid draft is
    // not overwritten by re-renders that did not change the stored date.
    useEffect(() => {
        setDraftDate(savedBirthDate ?? '');
    }, [savedBirthDate]);

    /** Every write goes through here so a failure surfaces once, under its own section. */
    const save = async (patch: { gender?: UserGender | null; birthDate?: string | null }) => {
        const section = patch.gender !== undefined ? 'gender' : 'birthDate';
        setSaveError(null);
        try {
            await updateDemographics(patch);
        } catch (error) {
            setSaveError({
                section,
                message: error instanceof Error ? error.message : 'Could not save your details',
            });
        }
    };

    const errorLine = (section: 'gender' | 'birthDate') =>
        saveError?.section === section && (
            <Typography
                className="about-you-save-error"
                variant="caption"
                color="error"
                sx={{ display: 'block', pt: 1 }}
            >
                {saveError.message}
            </Typography>
        );

    const handleGender = (value: string) => {
        const next = value === 'prefer-not' ? null : (value as UserGender);
        if (next === gender) return; // no-op tap on the current answer
        void save({ gender: next });
    };

    const handleDateMode = (value: string) => {
        if (value === 'enter') {
            setEnteringDate(true);
            return; // nothing to save until a date is typed
        }
        setEnteringDate(false);
        setDraftDate('');
        setDateError(null);
        if (savedBirthDate !== null) void save({ birthDate: null });
    };

    /**
     * Save once the field holds a complete, valid date. A native date input only reports a
     * value when all three parts are filled, so this fires on the last part, not on every
     * keystroke; an invalid one shows its reason under the field and is not sent.
     */
    const handleDateChange = (value: string) => {
        setDraftDate(value);
        if (!value) {
            setDateError(null);
            return;
        }
        const problem = birthDateProblem(value);
        setDateError(problem);
        if (!problem && value !== savedBirthDate) void save({ birthDate: value });
    };

    return (
        <>
            <SettingsSection
                className="about-you-gender-section"
                icon="person"
                title="Gender"
                description={DEMOGRAPHICS_PURPOSE}
            >
                {GENDER_CHOICES.map((choice) => (
                    <OptionRow
                        key={choice.value}
                        className={`about-you-gender-option about-you-gender-option--${choice.value}`}
                        name="about-you-gender"
                        value={choice.value}
                        checked={gender === choice.value}
                        onChange={handleGender}
                        title={choice.label}
                    />
                ))}
                <OptionRow
                    className="about-you-gender-option about-you-gender-option--prefer-not"
                    name="about-you-gender"
                    value="prefer-not"
                    checked={gender === null}
                    onChange={handleGender}
                    title={PREFER_NOT_LABEL}
                />
                {errorLine('gender')}
            </SettingsSection>

            <SettingsSection
                className="about-you-birth-date-section"
                icon="cake"
                title="Date of birth"
                description="Private. Characters only get a rough idea of your age, never the date."
            >
                <OptionRow
                    className="about-you-birth-date-option about-you-birth-date-option--enter"
                    name="about-you-birth-date"
                    value="enter"
                    checked={showDateField}
                    onChange={handleDateMode}
                    title="Enter my date of birth"
                />
                {showDateField && (
                    <Box className="about-you-birth-date-field-wrap" sx={{ pt: 1, pb: 0.5 }}>
                        <TextField
                            className="about-you-birth-date-field"
                            type="date"
                            fullWidth
                            size="small"
                            label="Date of birth"
                            value={draftDate}
                            onChange={(e) => handleDateChange(e.target.value)}
                            error={!!dateError}
                            helperText={dateError ?? ' '}
                            InputLabelProps={{ shrink: true }}
                            inputProps={{ min: EARLIEST_BIRTH_DATE, max: todayIsoDate() }}
                        />
                    </Box>
                )}
                <OptionRow
                    className="about-you-birth-date-option about-you-birth-date-option--prefer-not"
                    name="about-you-birth-date"
                    value="prefer-not"
                    checked={!showDateField}
                    onChange={handleDateMode}
                    title={PREFER_NOT_LABEL}
                />
                {errorLine('birthDate')}
            </SettingsSection>
        </>
    );
}
