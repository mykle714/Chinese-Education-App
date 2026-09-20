/**
 * Which fields the app-wide beginner keyboard offers itself on.
 *
 * The policy is opt-OUT (§ 7a), so these tests are mostly about the exceptions:
 * getting one wrong means a bar appears over a password box, or fails to appear
 * on the field it was built for.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 7a.
 */
import { describe, it, expect } from 'vitest';
import { isEligible, type FieldTraits } from '../features/beginnerKeyboard/eligibility';

const field = (overrides: Partial<FieldTraits> = {}): FieldTraits => ({
  tag: 'input',
  type: 'text',
  disabled: false,
  readOnly: false,
  optedOut: false,
  ...overrides,
});

describe('beginner keyboard eligibility', () => {
  it('offers itself on ordinary text fields and textareas', () => {
    expect(isEligible(field())).toBe(true);
    expect(isEligible(field({ type: 'search' }))).toBe(true);
    // An input with no type attribute reads back as ''.
    expect(isEligible(field({ type: '' }))).toBe(true);
    expect(isEligible(field({ tag: 'textarea', type: '' }))).toBe(true);
  });

  it('stays away from fields that cannot hold a Chinese character', () => {
    // ⚠️ Not a convenience call. A bar over one of these covers the screen and
    // suggests an action that would corrupt the value.
    for (const type of ['password', 'email', 'number', 'tel', 'url', 'date', 'checkbox']) {
      expect(isEligible(field({ type })), `${type} should be excluded`).toBe(false);
    }
  });

  it('ignores a field nobody can type into', () => {
    expect(isEligible(field({ disabled: true }))).toBe(false);
    expect(isEligible(field({ readOnly: true }))).toBe(false);
  });

  it('honours the opt-out, including on a textarea', () => {
    expect(isEligible(field({ optedOut: true }))).toBe(false);
    expect(isEligible(field({ tag: 'textarea', optedOut: true }))).toBe(false);
  });
});
