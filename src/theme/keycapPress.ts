// The app's RAISED-KEY PRESS — the one press every raised keycap / plate button makes.
//
// A raised key stands on a solid lip. Held, it SNAPS down onto the lip (the lip vanishes);
// released, it SNAPS back up. NO transition either way — the user's call, 2026-10-29: a
// key reads as physical when it clicks, not when it eases. (Until then it was the Deck
// Tower plate's animated press: an 80 ms ease-out sink and a 220 ms overshoot pop.)
//
// CSS `:active`, plus KEYCAP_PRESSED_CLASS set by the app-wide delegate
// (src/utils/keycapPressDelegate.ts) on pointerdown and held at least KEYCAP_MIN_HELD_MS —
// every key that spreads `keycapPressSx` gets it (the sx sets KEYCAP_MARKER_PROPERTY,
// which is how the delegate finds keys). Nothing else to wire.
//
// Consumers: towerPlate.ts → `towerPlatePressSx` (the flp's tower plates), the eip's
// keycaps — EipEntryHeader (the headword tile) and EipAddKey — scp's toolbar keycaps
// (features/discover/SortCardsPage.tsx → `keycapSx`), the Dictionary page's keycaps
// (features/dictionary/DictionaryPageParts.tsx → `Keycap`) and the beginner keyboard's
// keys (features/beginnerKeyboard/PinyinToneKeyboard.tsx → `keyPressSx`). A new raised key
// should spread `keycapPressSx`, not re-type the press.
//
// NOT covered: the Deck Tower's in-scene plates (usePlatePress, rAF-animated iso art, not
// HTML buttons) and the flat, lipless PinyinKeypad keys (a brightness press, no sink).
//
// Docs: docs/EIP_SHEET_GESTURES.md § Add key; docs/DECK_TOWER.md § "Studying the tower".

/**
 * Class that holds a key in its pressed look exactly like `:active` does. Set by the
 * delegate (src/utils/keycapPressDelegate.ts) on every key's pointerdown: it shows the
 * press on the next frame even when the click's work blocks, it survives a drag handle's
 * pointer capture (which moves `:active` off the key), and it carries the minimum held time.
 */
export const KEYCAP_PRESSED_CLASS = "keycap--pressed";

/**
 * Custom property `keycapPressSx` sets to 1 on a key: the delegate's marker for "this
 * element is a raised key". Registered non-inheriting by the delegate.
 */
export const KEYCAP_MARKER_PROPERTY = "--keycap-press";

/**
 * Shortest time a key stays down once pressed (the delegate's hold), ms. A quick tap is released
 * in well under a frame budget's worth of paints, so without a floor the press can be
 * over before it is ever drawn. ~6 frames: long enough to see, short enough that the
 * key never feels held. (Pure-CSS `:active` keys cannot have a floor; it ends on release.)
 */
export const KEYCAP_MIN_HELD_MS = 100;

/**
 * The tower plate's overshoot timing (usePlatePress `POP_MS` 220, ease-out-back). NO
 * LONGER a key press — keys snap. Kept for non-press motion that wants the plate's
 * springy feel: today the scp's drop-target bin grow (features/discover/SortBins.tsx).
 */
export const KEYCAP_POP_TRANSITION = "220ms cubic-bezier(0.34, 1.56, 0.64, 1)";

export interface KeycapPressOptions {
    /** Resting `box-shadow` — the key's ring + its solid lip (+ any cast shadow). */
    restShadow: string;
    /** Held `box-shadow` — normally the ring alone: the lip is gone, the key bottomed out. */
    pressedShadow: string;
    /** How far the key sinks when held, px — its lip height (measured from y = 0). */
    pressedY: number;
    /** Resting offset, px (default 0). EipAddKey's "Added!" rests 2px low, as if half-pressed. */
    restY?: number;
    /** A transform the control already positions itself with; the press composes after it. */
    baseTransform?: string;
}

/**
 * `sx` for a raised key: rest → held (`:active` or KEYCAP_PRESSED_CLASS) sinks it by
 * `pressedY` and swaps the lip for `pressedShadow`, instantly. Spread into the control's
 * own `sx`. Transform and shadow carry no transition — a caller that animates something
 * else (opacity, colour) should list only that property in its own `transition`.
 */
export function keycapPressSx({ restShadow, pressedShadow, pressedY, restY = 0, baseTransform = "" }: KeycapPressOptions) {
    const at = (y: number) => `${baseTransform} translateY(${y}px)`.trim();
    const pressed = {
        transform: at(pressedY),
        boxShadow: pressedShadow,
    };
    // Two keys rather than one combined selector: callers (SortCardsPage) read the
    // `"&:active"` entry by name to reuse the pressed look under their own class.
    return {
        transform: at(restY),
        boxShadow: restShadow,
        // Explicitly none, so no inherited / component-default transition eases the press.
        transition: "none",
        // The delegate's marker (keycapPressDelegate.ts): makes this element a pressable key.
        [KEYCAP_MARKER_PROPERTY]: 1,
        "&:active": pressed,
        [`&.${KEYCAP_PRESSED_CLASS}`]: pressed,
    } as const;
}
