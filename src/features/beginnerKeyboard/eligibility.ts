/**
 * Which text fields the beginner keyboard offers itself on.
 *
 * LAYER: client feature logic, pure apart from reading DOM properties. Separated
 * from the provider so the policy is one readable list and can be tested.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 7a (app-wide host surface).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE POLICY IS OPT-OUT, NOT OPT-IN
 *
 * § 7a settled that the keyboard is available anywhere a text field is focused,
 * so the default is YES and this file lists the exceptions. An opt-in list would
 * have meant touching every input in the app and would have quietly missed every
 * one added later.
 *
 * ⚠️ The exclusions are about the field's CONTENT TYPE, not about convenience. A
 * password or a numeric amount cannot sensibly receive a Chinese character, and
 * offering a bar over one is worse than useless: it covers the screen and
 * suggests an action that would corrupt the value.
 */

/** Input types that can meaningfully hold a Chinese character. */
const ALLOWED_INPUT_TYPES = new Set(['text', 'search', '']);

/**
 * Routes the keyboard never offers itself on, matched against `location.pathname`.
 *
 * These are the desktop-only, template-author-only AUTHORING surfaces (the night
 * market template editor and the immersive-world scene editor). Every field on
 * them holds authoring metadata — a scene name, a tile id, a numeric size — that
 * is typed in English or ASCII, so a handwriting bar covering the bottom of a
 * dense three-column tool is pure obstruction.
 *
 * This is a PATH exclusion rather than the `off` attribute because both pages
 * open MUI dialogs and menus, which render through a portal into `document.body`
 * and therefore escape the attribute's `closest()` inheritance. One entry per
 * page here beats chasing every portal.
 */
const DISABLED_PATHS = new Set([
  '/night-market/template-editor',
  '/immersive-world/scene-editor',
]);

/** Is the beginner keyboard switched off wholesale for this route? */
export function isKeyboardDisabledPath(pathname: string): boolean {
  // Tolerate a trailing slash so '/x' and '/x/' behave the same.
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return DISABLED_PATHS.has(normalized);
}

/**
 * The one attribute this feature reads off the page, with two values:
 *
 *   `off`  — never raise the keyboard on this field (or anything inside it).
 *   `keep` — interacting with this element does not DISMISS an open keyboard.
 *
 * Both are inherited: put either on a field or on any ancestor to cover a whole
 * region.
 *
 * `keep` exists because focus became a TRIGGER rather than a binding (2026-09-09,
 * § 6z): the keyboard now survives losing focus, and everything that is not
 * explicitly kept dismisses it. The controls that sit *beside* a field and act on
 * what the learner is composing — a send button, a volume chip, a helper toggle —
 * would otherwise close the keyboard mid-sentence.
 */
export const OPT_OUT_ATTRIBUTE = 'data-beginner-keyboard';

/** Attribute value marking a region that must not dismiss an open keyboard. */
export const KEEP_OPEN_VALUE = 'keep';

/** CSS selector for a `keep` region, so callers need not re-spell the attribute. */
export const KEEP_OPEN_SELECTOR = `[${OPT_OUT_ATTRIBUTE}="${KEEP_OPEN_VALUE}"]`;

/**
 * Does interacting with this target leave an open keyboard up?
 *
 * True for anything inside a `keep` region. The host's own surface is NOT handled
 * here — the provider owns that check, because the host class is the provider's
 * to define.
 */
export function isKeepOpenTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(KEEP_OPEN_SELECTOR) !== null;
}

export type EditableField = HTMLInputElement | HTMLTextAreaElement;

/** Narrow an arbitrary focus target to a field we could drive. */
export function asEditableField(target: EventTarget | null): EditableField | null {
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement) return target;
  return null;
}

/** The field facts the policy actually depends on — no DOM types. */
export interface FieldTraits {
  /** 'textarea', or 'input'. A textarea has no type to check. */
  tag: 'input' | 'textarea';
  /** The input's resolved `type`. Ignored for a textarea. */
  type: string;
  disabled: boolean;
  readOnly: boolean;
  /** True when the field or an ancestor carries the opt-out. */
  optedOut: boolean;
}

/**
 * The policy, as a pure predicate.
 *
 * Split from the DOM read below so it can be tested — the suite runs in a node
 * environment with no `HTMLInputElement` to construct.
 *
 * Deliberately does NOT consider whether the user is learning Chinese. The
 * keyboard is a way to type characters the learner cannot spell in pinyin, and
 * the app has no notion of "this field expects Chinese" — a dictionary search,
 * a deck name and a document body can all take it.
 */
export function isEligible(traits: FieldTraits): boolean {
  // A field nobody can type into cannot want a keyboard.
  if (traits.disabled || traits.readOnly) return false;
  // A whole form or dialog can decline in one place.
  if (traits.optedOut) return false;
  // A textarea always holds free text; only inputs carry a content type.
  if (traits.tag === 'textarea') return true;
  // `type` normalizes to lowercase and defaults to "text"; an unknown value
  // reads back as "text" too, so this is the complete allow-list.
  return ALLOWED_INPUT_TYPES.has(traits.type);
}

/** Read the traits off a live element. */
export function traitsOf(field: EditableField): FieldTraits {
  return {
    tag: field instanceof HTMLTextAreaElement ? 'textarea' : 'input',
    type: field instanceof HTMLTextAreaElement ? '' : field.type,
    disabled: field.disabled,
    readOnly: field.readOnly,
    optedOut: field.closest(`[${OPT_OUT_ATTRIBUTE}="off"]`) !== null,
  };
}

/** Whether to offer the keyboard on this field. */
export function isEligibleField(field: EditableField): boolean {
  return isEligible(traitsOf(field));
}
